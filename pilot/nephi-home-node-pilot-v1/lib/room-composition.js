"use strict";

// A typed, operator-authored JSONB value. Scope is supplied by the owning
// PostgreSQL row, never by a field inside the candidate document.
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value, keys) {
  return object(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}
function text(value) {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 160;
}

function validateRoomComposition(value, inventory) {
  const invalid = code => ({ valid: false, errors: [code] });
  if (!exact(value, ["schemaVersion", "revision", "inventoryComplete", "physicalRooms", "bundleCompositions"])) return invalid("composition_shape");
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0
    || typeof value.inventoryComplete !== "boolean" || !Array.isArray(value.physicalRooms)
    || !Array.isArray(value.bundleCompositions) || value.physicalRooms.length > 10000
    || value.bundleCompositions.length > 10000) return invalid("composition_value");
  if (!object(inventory) || !text(inventory.propertyId) || !Array.isArray(inventory.roomTypes)
    || !Array.isArray(inventory.bundles)) return invalid("composition_inventory_unavailable");
  const types = new Set(inventory.roomTypes.map(room => room.id));
  const bundles = new Map(inventory.bundles.map(bundle => [bundle.id, bundle]));
  const physical = new Map();
  for (const room of value.physicalRooms) {
    if (!exact(room, ["physicalRoomId", "roomTypeId", "publicName"])
      || !text(room.physicalRoomId) || !text(room.roomTypeId) || !text(room.publicName)
      || physical.has(room.physicalRoomId) || !types.has(room.roomTypeId)) return invalid("physical_room_reference");
    physical.set(room.physicalRoomId, room);
  }
  const seenBundles = new Set();
  for (const item of value.bundleCompositions) {
    if (!exact(item, ["bundleId", "complete", "memberPhysicalRoomIds"])
      || !text(item.bundleId) || typeof item.complete !== "boolean"
      || !Array.isArray(item.memberPhysicalRoomIds) || !bundles.has(item.bundleId)
      || seenBundles.has(item.bundleId)) return invalid("bundle_composition_shape");
    seenBundles.add(item.bundleId);
    const members = new Set();
    const memberTypes = new Set(bundles.get(item.bundleId).memberRoomIds);
    for (const id of item.memberPhysicalRoomIds) {
      if (!text(id) || members.has(id) || !physical.has(id)
        || !memberTypes.has(physical.get(id).roomTypeId)) return invalid("bundle_physical_reference");
      members.add(id);
    }
    // Complete composition cannot omit a formally configured member type.
    if (item.complete && (!members.size || [...memberTypes].some(type =>
      !item.memberPhysicalRoomIds.some(id => physical.get(id).roomTypeId === type)))) return invalid("bundle_composition_incomplete");
  }
  return { valid: true, errors: [] };
}

function resolveRoomComposition(property, entity, detailIntent = "general") {
  const document = property.roomCompositionV1;
  const inventory = property.roomCompositionInventory;
  const selectedIds = entity.status === "matched_set" ? entity.canonicalSet
    : entity.status === "resolved" ? [entity.canonicalId] : [];
  const selectedProducts = (property.rooms || []).filter(room => selectedIds.includes(room.id));
  const subject = selectedIds.length ? selectedProducts.map(room => room.name).join("、") : property.displayName;
  const unknown = () => ({ outcome: "unknown", reason: "room_composition_unconfirmed", facts: { subject } });
  if (document === undefined) return unknown();
  if (!inventory || inventory.propertyId !== property.propertyId
    || !validateRoomComposition(document, inventory).valid) return {
    outcome: "technical_error", reason: "room_composition_invalid_formal_data", facts: {}
  };
  let ids = [], complete = true;
  const addProduct = id => {
    if (inventory.roomTypes.some(type => type.id === id)) {
      ids.push(...document.physicalRooms.filter(room => room.roomTypeId === id).map(room => room.physicalRoomId));
      complete = complete && document.inventoryComplete;
    } else if (inventory.bundles.some(bundle => bundle.id === id)) {
      const composition = document.bundleCompositions.find(bundle => bundle.bundleId === id);
      ids.push(...(composition?.memberPhysicalRoomIds || []));
      complete = complete && composition?.complete === true;
    } else complete = false;
  };
  if (entity.category === "other" && entity.canonicalId === null && !entity.canonicalSet.length) {
    ids = document.physicalRooms.map(room => room.physicalRoomId);
    complete = document.inventoryComplete;
  } else if (entity.status === "resolved") addProduct(entity.canonicalId);
  else if (entity.status === "matched_set" && entity.canonicalSet.length) entity.canonicalSet.forEach(addProduct);
  else complete = false;
  if (!complete) return unknown();
  const members = [...new Set(ids)].map(id => document.physicalRooms.find(room => room.physicalRoomId === id));
  if (detailIntent === "room_types") {
    const typeIds = [...new Set(members.map(room => room.roomTypeId))];
    const roomTypes = typeIds.map(id => inventory.roomTypes.find(type => type.id === id));
    if (roomTypes.some(type => !text(type?.name))) return {
      outcome: "technical_error", reason: "room_composition_invalid_formal_data", facts: {}
    };
    return { outcome: "answered", facts: {
      subject, roomTypes: roomTypes.map(type => ({ roomTypeId: type.id, publicName: type.name })),
      compositionRevision: document.revision, propertyId: property.propertyId,
      source: "postgresql.property_settings.roomCompositionV1",
      roomTypeSource: "postgresql.room_types"
    } };
  }
  return { outcome: "answered", facts: {
    subject, physicalRoomCount: members.length,
    physicalRooms: members.map(room => ({ ...room })),
    compositionRevision: document.revision,
    source: "postgresql.property_settings.roomCompositionV1", propertyId: property.propertyId
  } };
}

module.exports = { validateRoomComposition, resolveRoomComposition };
