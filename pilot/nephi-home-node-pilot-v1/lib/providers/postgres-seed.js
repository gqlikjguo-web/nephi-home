"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { openPostgres } = require("./postgres-client");
const { validateFriendlyProperty } = require("../friendly-property-import");

const PROPERTY_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const INVENTORY_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const STATUS = new Set(["available", "closed"]);
const FIXTURE_STATUS = Object.freeze({ open: "available", closed: "closed" });

function requiredText(value, field, maxLength = 200) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) throw new Error(`${field} is invalid`);
  return text;
}

function integer(value, field, minimum = 0) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) throw new Error(`${field} is invalid`);
  return number;
}

function readManifestFile(fileName, baseDirectory) {
  const relative = String(fileName || "").trim();
  if (!relative) throw new Error("seed manifest reference is required");
  const resolved = path.resolve(baseDirectory, relative);
  const withinBase = path.relative(baseDirectory, resolved);
  if (withinBase.startsWith("..") || path.isAbsolute(withinBase)) throw new Error("seed manifest reference is invalid");
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function expandSeedManifest(manifest, baseDirectory) {
  const sourceProperty = validateFriendlyProperty(readManifestFile(manifest.propertyFile, baseDirectory));
  const sourceAvailability = readManifestFile(manifest.availabilityFile, baseDirectory);
  if (!sourceAvailability || !Array.isArray(sourceAvailability.days)) throw new Error("seed availability fixture is invalid");
  if (sourceProperty.propertyId !== sourceAvailability.propertyId) throw new Error("seed property scope mismatch");
  const mappings = Array.isArray(manifest.roomMappings) ? manifest.roomMappings : [];
  if (mappings.length !== sourceProperty.rooms.length) throw new Error("seed room mapping is incomplete");
  const rooms = mappings.map((mapping, index) => ({
    ...sourceProperty.rooms[index],
    id: requiredText(mapping.roomId, `roomMappings[${index}].roomId`, 80)
  }));
  const bundles = Array.isArray(manifest.bundles) ? manifest.bundles : [];
  return {
    property: {
      propertyId: sourceProperty.propertyId,
      displayName: sourceProperty.name,
      currency: "TWD",
      rooms,
      settings: {
        currency: "TWD",
        commonAnswers: sourceProperty.safeFacts,
        pricing: sourceProperty.pricing,
        humanHandoffSituations: sourceProperty.humanHandoffSituations,
        contactLink: "",
        onboarding: sourceProperty.onboarding
      },
      faqs: sourceProperty.faqs
    },
    bundles,
    availability: {
      propertyId: sourceAvailability.propertyId,
      storage: manifest.availabilityStorage || "normalized",
      legacyColumns: manifest.legacyColumns || null,
      days: sourceAvailability.days.map((day, dayIndex) => {
        const date = requiredText(day && day.date, `availability.days[${dayIndex}].date`, 10);
        return {
          date,
          inventory: Object.fromEntries(mappings.map((mapping, mappingIndex) => {
            const roomId = requiredText(mapping.roomId, `roomMappings[${mappingIndex}].roomId`, 80);
            const sourceKey = requiredText(mapping.sourceAvailabilityKey, `roomMappings[${mappingIndex}].sourceAvailabilityKey`, 80);
            const status = FIXTURE_STATUS[day[sourceKey]];
            if (!status) throw new Error(`availability.days[${dayIndex}].${sourceKey} is invalid`);
            return [roomId, status];
          }))
        };
      })
    }
  };
}

function loadSeedManifest(manifestPath) {
  const source = String(manifestPath || "").trim();
  if (!source) throw new Error("seed manifest path is required");
  const resolved = path.resolve(source);
  const manifest = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return expandSeedManifest(manifest, path.dirname(resolved));
}

function normalizeSeedInput(value) {
  if (!value) throw new Error("explicit seed input is required");
  const input = value;
  const property = input.property || {};
  const propertyId = requiredText(property.propertyId, "property.propertyId", 64);
  if (!PROPERTY_ID.test(propertyId)) throw new Error("property.propertyId is invalid");
  const rooms = (property.rooms || []).map((room, index) => {
    const id = requiredText(room && room.id, `property.rooms[${index}].id`, 80);
    if (!INVENTORY_ID.test(id)) throw new Error(`property.rooms[${index}].id is invalid`);
    return {
      id,
      name: requiredText(room && room.name, `property.rooms[${index}].name`, 80),
      capacity: integer(room && room.capacity, `property.rooms[${index}].capacity`, 1),
      type: String(room && room.type || "custom"),
      description: String(room && room.description || ""),
      enabled: room && room.enabled !== false
    };
  });
  if (!rooms.length || new Set(rooms.map((room) => room.id)).size !== rooms.length) throw new Error("property.rooms is invalid");
  const roomIds = new Set(rooms.map((room) => room.id));
  const bundles = (input.bundles || []).map((bundle, index) => {
    const id = requiredText(bundle && bundle.id, `bundles[${index}].id`, 80);
    const memberRoomIds = [...new Set((bundle.memberRoomIds || []).map(String))];
    if (!INVENTORY_ID.test(id) || !memberRoomIds.length || memberRoomIds.some((roomId) => !roomIds.has(roomId))) {
      throw new Error(`bundles[${index}] is invalid`);
    }
    return {
      id,
      name: requiredText(bundle.name, `bundles[${index}].name`, 80),
      capacity: integer(bundle.capacity, `bundles[${index}].capacity`, 1),
      basePrice: integer(bundle.basePrice || 0, `bundles[${index}].basePrice`),
      mondayThursdayPrice: integer(bundle.mondayThursdayPrice || bundle.basePrice || 0, `bundles[${index}].mondayThursdayPrice`),
      fridayPrice: integer(bundle.fridayPrice || bundle.basePrice || 0, `bundles[${index}].fridayPrice`),
      saturdayHolidayPrice: integer(bundle.saturdayHolidayPrice || bundle.basePrice || 0, `bundles[${index}].saturdayHolidayPrice`),
      sundayPrice: integer(bundle.sundayPrice || bundle.basePrice || 0, `bundles[${index}].sundayPrice`),
      enabled: bundle.enabled !== false,
      memberRoomIds
    };
  });
  const inventoryIds = new Set([...roomIds, ...bundles.map((bundle) => bundle.id)]);
  const availability = input.availability || {};
  if (availability.propertyId !== propertyId) throw new Error("seed availability property scope mismatch");
  const days = (availability.days || []).map((day, index) => {
    const date = requiredText(day && day.date, `availability.days[${index}].date`, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`availability.days[${index}].date is invalid`);
    const inventory = { ...(day.inventory || {}) };
    for (const bundle of bundles) {
      if (!Object.hasOwn(inventory, bundle.id)) {
        inventory[bundle.id] = bundle.memberRoomIds.every((roomId) => inventory[roomId] === "available")
          ? "available"
          : "closed";
      }
    }
    for (const [inventoryId, status] of Object.entries(inventory)) {
      if (!inventoryIds.has(inventoryId) || !STATUS.has(status)) throw new Error(`availability.days[${index}].inventory is invalid`);
    }
    return { date, inventory };
  });
  return {
    property: {
      propertyId,
      displayName: requiredText(property.displayName, "property.displayName", 80),
      currency: String(property.currency || "TWD"),
      rooms,
      settings: property.settings && typeof property.settings === "object" ? property.settings : {},
      faqs: Array.isArray(property.faqs) ? property.faqs : []
    },
    bundles,
    availability: {
      propertyId,
      days,
      storage: availability.storage === "legacy" ? "legacy" : "normalized",
      legacyColumns: availability.legacyColumns || null
    }
  };
}

function safeIdentifier(value, field) {
  const identifier = requiredText(value, field, 80);
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`${field} is invalid`);
  return `"${identifier}"`;
}

async function seedAvailability(client, propertyId, availability, bundles) {
  if (availability.storage !== "legacy") {
    for (const day of availability.days) {
      for (const [inventoryId,status] of Object.entries(day.inventory)) {
        await client.query(
          "INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,$2,$3,$4,$5)",
          [propertyId,inventoryId,day.date,status,status === "available" ? 1 : 0]
        );
      }
    }
    return;
  }
  const mapping = availability.legacyColumns || {};
  const inventoryColumns = mapping.inventory && typeof mapping.inventory === "object" ? mapping.inventory : {};
  const entries = Object.entries(inventoryColumns);
  if (!entries.length) throw new Error("legacy availability inventory mapping is required");
  const aggregateColumn = safeIdentifier(mapping.aggregateColumn, "legacyColumns.aggregateColumn");
  const aggregateInventoryId = requiredText(mapping.aggregateInventoryId, "legacyColumns.aggregateInventoryId", 80);
  const bundle = bundles.find((item) => item.id === aggregateInventoryId);
  if (!bundle) throw new Error("legacy availability aggregate bundle is invalid");
  const columns = entries.map(([,column], index) => safeIdentifier(column, `legacyColumns.inventory[${index}]`));
  for (const day of availability.days) {
    const statuses = entries.map(([inventoryId]) => day.inventory[inventoryId]);
    if (statuses.some((status) => !STATUS.has(status))) throw new Error("legacy availability status is invalid");
    const aggregate = bundle.memberRoomIds.every((roomId) => day.inventory[roomId] === "available")
      ? "available"
      : "closed";
    const placeholders = statuses.map((unused,index) => `$${index + 3}`);
    await client.query(
      `INSERT INTO availability_days(property_id,stay_date,${columns.join(",")},${aggregateColumn}) VALUES($1,$2,${placeholders.join(",")},$${statuses.length + 3})`,
      [propertyId,day.date,...statuses,aggregate]
    );
  }
}

async function ensureBundles(client, propertyId, bundles) {
  for (const bundle of bundles) {
    await client.query(
      "INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING",
      [propertyId,bundle.id,bundle.name,bundle.capacity,bundle.basePrice,bundle.mondayThursdayPrice,bundle.fridayPrice,bundle.saturdayHolidayPrice,bundle.sundayPrice,bundle.enabled]
    );
    for (let index = 0; index < bundle.memberRoomIds.length; index += 1) {
      await client.query(
        "INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [propertyId,bundle.id,bundle.memberRoomIds[index],index]
      );
    }
  }
}

async function seedPostgres(connection, value) {
  const input = normalizeSeedInput(value);
  const { property, bundles, availability } = input;
  const client = await openPostgres(connection);
  let transactionStarted = false;
  try {
    const existing = await client.query("SELECT property_id FROM properties WHERE property_id=$1", [property.propertyId]);
    if (existing.rows.length) {
      await materializeCanonicalKnowledgeKeys(client, property);
      await ensureBundles(client, property.propertyId, bundles);
      return { seeded: false, propertyId: property.propertyId };
    }
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [property.propertyId, property.displayName]);
    for (let index = 0; index < property.rooms.length; index += 1) {
      const room = property.rooms[index];
      await client.query(
        "INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [property.propertyId,room.id,room.name,room.capacity,room.type,room.description,index,room.enabled]
      );
    }
    await client.query(
      "INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)",
      [property.propertyId,JSON.stringify({ ...property.settings, currency: property.currency })]
    );
    for (let index = 0; index < property.faqs.length; index += 1) {
      const faq = property.faqs[index];
      await client.query(
        "INSERT INTO knowledge_items(property_id,knowledge_id,question,answer,knowledge_key,position) VALUES($1,$2,$3,$4,$5,$6)",
        [property.propertyId,`faq_${index + 1}`,faq.question,faq.answer,faq.knowledgeKey || null,index]
      );
    }
    await ensureBundles(client, property.propertyId, bundles);
    await seedAvailability(client, property.propertyId, availability, bundles);
    await client.query("COMMIT");
    transactionStarted = false;
    return {
      seeded: true,
      propertyId: property.propertyId,
      roomTypeCount: property.rooms.length,
      knowledgeItemCount: property.faqs.length,
      availabilityDayCount: availability.days.length
    };
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.close();
  }
}

async function materializeCanonicalKnowledgeKeys(client, property) {
  for (const faq of property.faqs || []) {
    if (!faq.knowledgeKey) continue;
    await client.query(
      "UPDATE knowledge_items SET knowledge_key=$3 WHERE property_id=$1 AND question=$2 AND COALESCE(knowledge_key,'')=''",
      [property.propertyId,faq.question,faq.knowledgeKey]
    );
  }
}

module.exports = {
  seedPostgres,
  loadSeedManifest,
  materializeCanonicalKnowledgeKeys,
  normalizeSeedInput
};
