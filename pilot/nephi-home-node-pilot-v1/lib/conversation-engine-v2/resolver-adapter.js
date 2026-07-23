"use strict";

function availabilityRequest(propertyId, request, resolved) {
  const entity = resolved && resolved.status === "resolved" ? resolved.entity : null;
  const roomTypeSet = resolved && resolved.status === "matched_set" ? resolved.entities.map((item) => item.canonicalId).filter(Boolean) : [];
  const confirmedEntityId = request && request.inventory && request.inventory.entityId || null;
  return {
    customerId: propertyId,
    checkIn: request.stay.checkIn,
    checkOut: request.stay.checkOut,
    guests: request.stay.guests || null,
    roomType: entity ? entity.canonicalId : confirmedEntityId || "all",
    ...(roomTypeSet.length ? { roomTypeSet } : {}),
    queryMode: request.inventory.mode || "any"
  };
}

function availabilityFacts(result, propertyId) {
  return {
    checkIn: result.checkIn,
    checkOut: result.checkOut,
    availableInventory: (result.rooms || []).map((room) => ({ canonicalId: room.id, publicName: room.publicDisplayName || room.displayName || room.publicName || room.name, capacity: Number(room.capacity) || null, category: room.inventoryType === "bundle" ? "bundle" : "room" })),
    availability: (result.rooms || []).length ? "available" : "full",
    source: "availability_resolver",
    propertyId
  };
}

function availabilityTraceSummary(request, result) {
  return {
    request: { customerId: request.customerId, checkIn: request.checkIn || null, checkOut: request.checkOut || null, dateFrom: request.dateFrom || null, dateTo: request.dateTo || null, nights: request.nights || null, guests: request.guests || null, roomType: request.roomType || "all", roomTypeSet: request.roomTypeSet || [], queryMode: request.queryMode || "any" },
    response: result && result.status ? { status: result.status, source: result.source || "", dates: (result.dates || []).map((item) => ({ checkIn: item.checkIn, checkOut: item.checkOut, available: Boolean(item.available), roomTypes: (item.roomTypes || []).map((room) => ({ roomTypeId: room.roomTypeId, roomTypeName: room.roomTypeName })) })) } : { customerId: result && result.customerId || "", availabilityReliable: Boolean(result && result.availabilityReliable), rooms: (result && result.rooms || []).map((room) => ({ id: room.id, name: room.publicDisplayName || room.displayName || room.publicName || room.name || "" })) }
  };
}

function resolveAvailability({ availabilityResolver, propertyId, request, resolved }) {
  if (typeof availabilityResolver !== "function") throw new Error("availability_resolver_required");
  const contractRequest = availabilityRequest(propertyId, request, resolved);
  const result = availabilityResolver(contractRequest);
  if (!result || result.customerId !== propertyId) throw new Error("availability_resolver_invalid_result");
  return { result, facts: availabilityFacts(result, propertyId) };
}

function resolveAvailableDates({ availableDatesResolver, propertyId, request, resolved }) {
  if (typeof availableDatesResolver !== "function") throw new Error("available_dates_resolver_required");
  const entity = resolved && resolved.status === "resolved" ? resolved.entity : null;
  const roomTypeSet = resolved && resolved.status === "matched_set" ? resolved.entities.map((item) => item.canonicalId).filter(Boolean) : [];
  const confirmedEntityId = request && request.inventory && request.inventory.entityId || null;
  const result = availableDatesResolver({ customerId: propertyId, dateFrom: request.stay.searchRange.from, dateTo: request.stay.searchRange.to, nights: request.stay.nights || 1, guests: request.stay.guests || null, roomType: entity ? entity.canonicalId : confirmedEntityId || "all", ...(roomTypeSet.length ? { roomTypeSet } : {}), queryMode: request.inventory.mode || "any" });
  if (!result || !["answered", "unknown", "unreliable"].includes(result.status)) throw new Error("available_dates_resolver_invalid_result");
  return result;
}

module.exports = { availabilityRequest, availabilityFacts, availabilityTraceSummary, resolveAvailability, resolveAvailableDates };
