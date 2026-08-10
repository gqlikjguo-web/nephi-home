"use strict";

const crypto = require("node:crypto");
const { openPostgres } = require("./postgres-client");
const { loadSeedManifest, normalizeSeedInput } = require("./postgres-seed");

function integrityError(code, message, details = {}, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  if (cause) error.cause = cause;
  return error;
}

function canonicalConflict(message, details = {}) {
  throw integrityError("ACCEPTANCE_DATA_CANONICAL_CONFLICT", message, details);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function hashAcceptanceDataSnapshot(snapshot) {
  const data = snapshot && snapshot.data ? snapshot.data : snapshot;
  return crypto.createHash("sha256").update(stableJson(data)).digest("hex");
}

function unique(values, field) {
  if (new Set(values).size !== values.length) canonicalConflict(`${field} contains duplicates`, { field });
}

function nextDate(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) canonicalConflict("availability date is invalid", { date });
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function safeIdentifier(value, field) {
  const identifier = String(value || "").trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) canonicalConflict(`${field} is invalid`, { field });
  return `"${identifier}"`;
}

function canonicalSnapshotData(input) {
  const { property, bundles, availability } = normalizeSeedInput(input);
  unique(property.rooms.map((room) => room.id), "rooms.id");
  unique(bundles.map((bundle) => bundle.id), "bundles.id");
  unique(property.faqs.map((faq) => String(faq.question || "")), "faqs.question");
  unique(property.faqs.map((faq) => String(faq.knowledgeKey || "")).filter(Boolean), "faqs.knowledgeKey");
  if (!availability.days.length) canonicalConflict("availability horizon is empty", { field: "availability.days" });
  unique(availability.days.map((day) => day.date), "availability.days.date");
  for (let index = 1; index < availability.days.length; index += 1) {
    if (availability.days[index].date !== nextDate(availability.days[index - 1].date)) {
      canonicalConflict("availability horizon is not contiguous", { previous: availability.days[index - 1].date, current: availability.days[index].date });
    }
  }

  const roomIds = property.rooms.map((room) => room.id);
  const inventoryIds = [...roomIds, ...bundles.map((bundle) => bundle.id)].sort();
  for (const bundle of bundles) {
    unique(bundle.memberRoomIds, `bundles.${bundle.id}.memberRoomIds`);
    if ([bundle.basePrice, bundle.mondayThursdayPrice, bundle.fridayPrice, bundle.saturdayHolidayPrice, bundle.sundayPrice].some((price) => price > 0)) {
      canonicalConflict("positive structured bundle pricing lacks effective-data authority", { bundleId: bundle.id, field: "bundlePricing" });
    }
  }
  for (const day of availability.days) {
    const actualInventoryIds = Object.keys(day.inventory).sort();
    if (stableJson(actualInventoryIds) !== stableJson(inventoryIds)) {
      canonicalConflict("availability inventory scope is incomplete", { date: day.date, expectedInventoryIds: inventoryIds, actualInventoryIds });
    }
  }

  const legacyMapping = availability.storage === "legacy" ? availability.legacyColumns || {} : null;
  const legacyInventory = legacyMapping && legacyMapping.inventory && typeof legacyMapping.inventory === "object"
    ? Object.entries(legacyMapping.inventory).sort(([left], [right]) => left.localeCompare(right))
    : [];
  if (availability.storage === "legacy") {
    if (!legacyInventory.length) canonicalConflict("legacy availability mapping is missing", { field: "availability.legacyColumns.inventory" });
    const aggregateInventoryId = String(legacyMapping.aggregateInventoryId || "");
    if (!bundles.some((bundle) => bundle.id === aggregateInventoryId)) canonicalConflict("legacy aggregate bundle is invalid", { aggregateInventoryId });
    safeIdentifier(legacyMapping.aggregateColumn, "availability.legacyColumns.aggregateColumn");
    for (const [inventoryId, column] of legacyInventory) {
      if (!roomIds.includes(inventoryId)) canonicalConflict("legacy room mapping is invalid", { inventoryId });
      safeIdentifier(column, `availability.legacyColumns.inventory.${inventoryId}`);
    }
  }

  const rooms = property.rooms.map((room, position) => ({
    id: room.id,
    name: room.name,
    displayName: room.name,
    roomCode: "",
    capacity: room.capacity,
    highlights: [],
    type: room.type,
    description: room.description,
    position,
    enabled: room.enabled,
    basePrice: 0,
    weekdayPrice: 0,
    fridayPrice: 0,
    saturdayPrice: 0,
    mondayThursdayPrice: 0,
    saturdayHolidayPrice: 0,
    sundayPrice: 0
  }));
  const knowledgeItems = property.faqs.map((faq, position) => ({
    knowledgeId: `faq_${position + 1}`,
    question: String(faq.question || ""),
    answer: String(faq.answer || ""),
    knowledgeKey: faq.knowledgeKey ? String(faq.knowledgeKey) : null,
    position
  }));
  const canonicalBundles = bundles.map((bundle) => ({
    id: bundle.id,
    name: bundle.name,
    capacity: bundle.capacity,
    basePrice: bundle.basePrice,
    mondayThursdayPrice: bundle.mondayThursdayPrice,
    fridayPrice: bundle.fridayPrice,
    saturdayHolidayPrice: bundle.saturdayHolidayPrice,
    sundayPrice: bundle.sundayPrice,
    enabled: bundle.enabled,
    entertainmentAmenities: [],
    memberRoomIds: bundle.memberRoomIds.slice()
  }));
  const normalizedAvailability = availability.days.flatMap((day) => Object.entries(day.inventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([inventoryId, status]) => ({ date: day.date, inventoryId, status, remaining: status === "available" ? 1 : 0 })));
  const legacyAvailability = availability.storage === "legacy" ? availability.days.map((day) => {
    const values = Object.fromEntries(legacyInventory.map(([inventoryId, column]) => [column, day.inventory[inventoryId]]));
    const aggregateInventoryId = String(legacyMapping.aggregateInventoryId);
    values[String(legacyMapping.aggregateColumn)] = day.inventory[aggregateInventoryId];
    return { date: day.date, values };
  }) : [];

  return {
    schemaVersion: 1,
    property: {
      propertyId: property.propertyId,
      displayName: property.displayName,
      settings: { ...property.settings, currency: property.currency },
      rooms
    },
    knowledgeItems,
    bundles: canonicalBundles,
    priceOverrides: [],
    availability: {
      storage: availability.storage,
      legacyColumns: availability.storage === "legacy" ? legacyMapping : null,
      horizon: {
        from: availability.days[0].date,
        to: availability.days[availability.days.length - 1].date,
        dayCount: availability.days.length
      },
      normalized: normalizedAvailability,
      legacy: legacyAvailability,
      bundleLegacy: []
    }
  };
}

function loadAcceptanceDataSnapshot(manifestPath) {
  let data;
  try {
    data = canonicalSnapshotData(loadSeedManifest(manifestPath));
  } catch (error) {
    if (error && error.code === "ACCEPTANCE_DATA_CANONICAL_CONFLICT") throw error;
    throw integrityError("ACCEPTANCE_DATA_CANONICAL_CONFLICT", error && error.message || "canonical acceptance data is invalid", {}, error);
  }
  return {
    data,
    snapshotHash: hashAcceptanceDataSnapshot(data),
    authority: {
      explicit: ["property_settings", "room_identity_capacity", "bundle_identity_membership_capacity", "knowledge_items", "availability_fixture_horizon"],
      requiresOperatorConfirmation: ["partial_bundle_pricing", "payment_deposit", "cancellation_refund", "room_bundle_effective_pricing", "availability_outside_fixture_horizon"]
    }
  };
}

function requireScope({ testOnly, acceptancePropertyId, snapshot }) {
  if (testOnly !== true) throw integrityError("TEST_ONLY_ACCEPTANCE_DATA_SCOPE_REQUIRED", "test-only acceptance data scope is required");
  const expected = String(snapshot && snapshot.data && snapshot.data.property && snapshot.data.property.propertyId || "");
  const actual = String(acceptancePropertyId || "").trim();
  if (!actual || actual !== expected) {
    throw integrityError("TEST_ONLY_ACCEPTANCE_PROPERTY_MISMATCH", "acceptance property does not match the repository snapshot", { expectedPropertyId: expected, actualPropertyId: actual });
  }
}

async function readDatabaseSnapshot(client, canonical) {
  const propertyId = canonical.property.propertyId;
  const propertyResult = await client.query("SELECT display_name FROM properties WHERE property_id=$1", [propertyId]);
  const settingsResult = await client.query("SELECT settings FROM property_settings WHERE property_id=$1", [propertyId]);
  const roomResult = await client.query(
    "SELECT room_id,name,display_name,room_code,capacity,highlights,type,description,position,enabled,base_price,weekday_price,friday_price,saturday_price,monday_thursday_price,saturday_holiday_price,sunday_price FROM room_types WHERE property_id=$1 ORDER BY position,room_id",
    [propertyId]
  );
  const knowledgeResult = await client.query(
    "SELECT knowledge_id,question,answer,knowledge_key,position FROM knowledge_items WHERE property_id=$1 ORDER BY position,knowledge_id",
    [propertyId]
  );
  const bundleResult = await client.query(
    "SELECT bundle_id,name,capacity,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled,entertainment_amenities FROM bundle_offers WHERE property_id=$1 ORDER BY bundle_id",
    [propertyId]
  );
  const memberResult = await client.query(
    "SELECT bundle_id,room_id,position FROM bundle_offer_members WHERE property_id=$1 ORDER BY bundle_id,position,room_id",
    [propertyId]
  );
  const overrideResult = await client.query(
    "SELECT room_id,stay_date::text date,price,currency FROM room_price_overrides WHERE property_id=$1 ORDER BY stay_date,room_id",
    [propertyId]
  );
  const normalizedResult = await client.query(
    "SELECT stay_date::text date,inventory_id,status,remaining FROM inventory_availability_days WHERE property_id=$1 ORDER BY stay_date,inventory_id",
    [propertyId]
  );
  const bundleLegacyResult = await client.query(
    "SELECT stay_date::text date,bundle_id,status FROM bundle_availability_days WHERE property_id=$1 ORDER BY stay_date,bundle_id",
    [propertyId]
  );
  let legacyRows = [];
  if (canonical.availability.storage === "legacy") {
    const mapping = canonical.availability.legacyColumns;
    const columns = [...Object.values(mapping.inventory), mapping.aggregateColumn].map((column, index) => safeIdentifier(column, `legacyColumns[${index}]`));
    const result = await client.query(
      `SELECT stay_date::text date,${columns.join(",")} FROM availability_days WHERE property_id=$1 ORDER BY stay_date`,
      [propertyId]
    );
    legacyRows = result.rows.map((row) => ({
      date: row.date.slice(0, 10),
      values: Object.fromEntries([...Object.values(mapping.inventory), mapping.aggregateColumn].map((column) => [column, row[column]]))
    }));
  }
  const membersByBundle = new Map();
  for (const row of memberResult.rows) {
    const members = membersByBundle.get(row.bundle_id) || [];
    members.push(row.room_id);
    membersByBundle.set(row.bundle_id, members);
  }
  return {
    schemaVersion: 1,
    property: {
      propertyId,
      displayName: propertyResult.rows[0] && propertyResult.rows[0].display_name || "",
      settings: settingsResult.rows[0] && settingsResult.rows[0].settings || {},
      rooms: roomResult.rows.map((row) => ({
        id: row.room_id,
        name: row.name,
        displayName: row.display_name,
        roomCode: row.room_code,
        capacity: Number(row.capacity),
        highlights: Array.isArray(row.highlights) ? row.highlights : [],
        type: row.type,
        description: row.description,
        position: Number(row.position),
        enabled: Boolean(row.enabled),
        basePrice: Number(row.base_price),
        weekdayPrice: Number(row.weekday_price),
        fridayPrice: Number(row.friday_price),
        saturdayPrice: Number(row.saturday_price),
        mondayThursdayPrice: Number(row.monday_thursday_price),
        saturdayHolidayPrice: Number(row.saturday_holiday_price),
        sundayPrice: Number(row.sunday_price)
      }))
    },
    knowledgeItems: knowledgeResult.rows.map((row) => ({
      knowledgeId: row.knowledge_id,
      question: row.question,
      answer: row.answer,
      knowledgeKey: row.knowledge_key || null,
      position: Number(row.position)
    })),
    bundles: bundleResult.rows.map((row) => ({
      id: row.bundle_id,
      name: row.name,
      capacity: Number(row.capacity),
      basePrice: Number(row.base_price),
      mondayThursdayPrice: Number(row.monday_thursday_price),
      fridayPrice: Number(row.friday_price),
      saturdayHolidayPrice: Number(row.saturday_holiday_price),
      sundayPrice: Number(row.sunday_price),
      enabled: Boolean(row.enabled),
      entertainmentAmenities: Array.isArray(row.entertainment_amenities) ? row.entertainment_amenities : [],
      memberRoomIds: membersByBundle.get(row.bundle_id) || []
    })),
    priceOverrides: overrideResult.rows.map((row) => ({ roomId: row.room_id, date: row.date.slice(0, 10), price: Number(row.price), currency: row.currency })),
    availability: {
      storage: canonical.availability.storage,
      legacyColumns: canonical.availability.legacyColumns,
      horizon: canonical.availability.horizon,
      normalized: normalizedResult.rows.map((row) => ({ date: row.date.slice(0, 10), inventoryId: row.inventory_id, status: row.status, remaining: Number(row.remaining) })),
      legacy: legacyRows,
      bundleLegacy: bundleLegacyResult.rows.map((row) => ({ date: row.date.slice(0, 10), bundleId: row.bundle_id, status: row.status }))
    }
  };
}

function mismatchError(expected, actual) {
  const expectedHash = hashAcceptanceDataSnapshot(expected);
  const actualHash = hashAcceptanceDataSnapshot(actual);
  return integrityError("ACCEPTANCE_DATA_INTEGRITY_FAILURE", "test-only PostgreSQL does not match the repository acceptance snapshot", { expectedHash, actualHash });
}

async function verifyWithClient(client, snapshot) {
  const actual = await readDatabaseSnapshot(client, snapshot.data);
  if (stableJson(actual) !== stableJson(snapshot.data)) throw mismatchError(snapshot.data, actual);
  return {
    status: "verified",
    propertyId: snapshot.data.property.propertyId,
    snapshotHash: snapshot.snapshotHash,
    roomCount: snapshot.data.property.rooms.length,
    bundleCount: snapshot.data.bundles.length,
    knowledgeItemCount: snapshot.data.knowledgeItems.length,
    availabilityDayCount: snapshot.data.availability.horizon.dayCount
  };
}

async function writeSnapshot(client, snapshot) {
  const data = snapshot.data;
  const propertyId = data.property.propertyId;
  const existing = await client.query("SELECT property_id FROM properties WHERE property_id=$1 FOR UPDATE", [propertyId]);
  if (existing.rows.length) {
    await client.query("UPDATE properties SET display_name=$2,updated_at=now() WHERE property_id=$1", [propertyId, data.property.displayName]);
  } else {
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [propertyId, data.property.displayName]);
  }
  await client.query(
    "INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(property_id) DO UPDATE SET settings=excluded.settings",
    [propertyId, JSON.stringify(data.property.settings)]
  );

  await client.query("DELETE FROM bundle_availability_days WHERE property_id=$1", [propertyId]);
  await client.query("DELETE FROM inventory_availability_days WHERE property_id=$1", [propertyId]);
  await client.query("DELETE FROM availability_days WHERE property_id=$1", [propertyId]);
  await client.query("DELETE FROM room_price_overrides WHERE property_id=$1", [propertyId]);
  await client.query("DELETE FROM bundle_offer_members WHERE property_id=$1", [propertyId]);
  await client.query("DELETE FROM bundle_offers WHERE property_id=$1", [propertyId]);
  await client.query("DELETE FROM knowledge_items WHERE property_id=$1", [propertyId]);

  for (const room of data.property.rooms) {
    await client.query(
      "INSERT INTO room_types(property_id,room_id,name,display_name,room_code,capacity,highlights,type,description,position,enabled,base_price,weekday_price,friday_price,saturday_price,monday_thursday_price,saturday_holiday_price,sunday_price) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT(property_id,room_id) DO UPDATE SET name=excluded.name,display_name=excluded.display_name,room_code=excluded.room_code,capacity=excluded.capacity,highlights=excluded.highlights,type=excluded.type,description=excluded.description,position=excluded.position,enabled=excluded.enabled,base_price=excluded.base_price,weekday_price=excluded.weekday_price,friday_price=excluded.friday_price,saturday_price=excluded.saturday_price,monday_thursday_price=excluded.monday_thursday_price,saturday_holiday_price=excluded.saturday_holiday_price,sunday_price=excluded.sunday_price",
      [propertyId, room.id, room.name, room.displayName, room.roomCode, room.capacity, JSON.stringify(room.highlights), room.type, room.description, room.position, room.enabled, room.basePrice, room.weekdayPrice, room.fridayPrice, room.saturdayPrice, room.mondayThursdayPrice, room.saturdayHolidayPrice, room.sundayPrice]
    );
  }
  const expectedRoomIds = new Set(data.property.rooms.map((room) => room.id));
  const existingRooms = await client.query("SELECT room_id FROM room_types WHERE property_id=$1", [propertyId]);
  for (const row of existingRooms.rows) {
    if (!expectedRoomIds.has(row.room_id)) await client.query("DELETE FROM room_types WHERE property_id=$1 AND room_id=$2", [propertyId, row.room_id]);
  }
  for (const item of data.knowledgeItems) {
    await client.query(
      "INSERT INTO knowledge_items(property_id,knowledge_id,question,answer,knowledge_key,position) VALUES($1,$2,$3,$4,$5,$6)",
      [propertyId, item.knowledgeId, item.question, item.answer, item.knowledgeKey, item.position]
    );
  }
  for (const bundle of data.bundles) {
    await client.query(
      "INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled,entertainment_amenities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)",
      [propertyId, bundle.id, bundle.name, bundle.capacity, bundle.basePrice, bundle.mondayThursdayPrice, bundle.fridayPrice, bundle.saturdayHolidayPrice, bundle.sundayPrice, bundle.enabled, JSON.stringify(bundle.entertainmentAmenities)]
    );
    for (let position = 0; position < bundle.memberRoomIds.length; position += 1) {
      await client.query(
        "INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,$2,$3,$4)",
        [propertyId, bundle.id, bundle.memberRoomIds[position], position]
      );
    }
  }
  for (const item of data.availability.normalized) {
    await client.query(
      "INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,$2,$3,$4,$5)",
      [propertyId, item.inventoryId, item.date, item.status, item.remaining]
    );
  }
  if (data.availability.storage === "legacy") {
    const mapping = data.availability.legacyColumns;
    const rawColumns = [...Object.values(mapping.inventory), mapping.aggregateColumn];
    const columns = rawColumns.map((column, index) => safeIdentifier(column, `legacyColumns[${index}]`));
    for (const day of data.availability.legacy) {
      const placeholders = rawColumns.map((unused, index) => `$${index + 3}`);
      await client.query(
        `INSERT INTO availability_days(property_id,stay_date,${columns.join(",")}) VALUES($1,$2,${placeholders.join(",")})`,
        [propertyId, day.date, ...rawColumns.map((column) => day.values[column])]
      );
    }
  }
}

async function verifyTestOnlyAcceptanceData(options = {}) {
  const snapshot = options.snapshot || loadAcceptanceDataSnapshot(options.manifestPath);
  requireScope({ ...options, snapshot });
  const client = await openPostgres(options.connection);
  try {
    return await client.transaction((transaction) => verifyWithClient(transaction, snapshot));
  } finally {
    await client.close();
  }
}

async function syncTestOnlyAcceptanceData(options = {}) {
  const snapshot = loadAcceptanceDataSnapshot(options.manifestPath);
  requireScope({ ...options, snapshot });
  const expectedSnapshotHash = String(options.expectedSnapshotHash || "").trim().toLowerCase();
  if (expectedSnapshotHash && expectedSnapshotHash !== snapshot.snapshotHash) {
    throw integrityError("ACCEPTANCE_DATA_SNAPSHOT_MISMATCH", "caller snapshot hash does not match the deployed repository snapshot", {
      expectedSnapshotHash,
      repositorySnapshotHash: snapshot.snapshotHash
    });
  }
  const client = await openPostgres(options.connection);
  try {
    return await client.transaction(async (transaction) => {
      try {
        await writeSnapshot(transaction, snapshot);
        return await verifyWithClient(transaction, snapshot);
      } catch (error) {
        if (error && error.code === "ACCEPTANCE_DATA_INTEGRITY_FAILURE") throw error;
        throw integrityError("ACCEPTANCE_DATA_INTEGRITY_FAILURE", "test-only acceptance data transaction failed", {}, error);
      }
    });
  } finally {
    await client.close();
  }
}

module.exports = {
  hashAcceptanceDataSnapshot,
  loadAcceptanceDataSnapshot,
  syncTestOnlyAcceptanceData,
  verifyTestOnlyAcceptanceData
};
