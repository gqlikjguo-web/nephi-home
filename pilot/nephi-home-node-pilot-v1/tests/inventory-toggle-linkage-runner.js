"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { createMvpService } = require("../lib/mvp-service");

const PROPERTY_ID = "toggle_property";
const ROOM_IDS = ["room_a", "room_b", "room_c", "room_d"];
const BUNDLE_ID = "bundle_all";
const NOW = new Date("2026-08-01T00:00:00.000Z");

function propertySeed() {
  return {
    testOnly: true,
    seedDays: 40,
    homestays: [{
      customerId: PROPERTY_ID,
      name: "Toggle Property",
      safeFacts: {},
      rooms: [
        ...ROOM_IDS.map((id, index) => ({ id, name: `Room ${String.fromCharCode(65 + index)}`, capacity: 2, type: "room", enabled: true })),
        { id: BUNDLE_ID, name: "Whole property", capacity: 8, type: "bundle", inventoryType: "bundle", enabled: true, memberRoomIds: ROOM_IDS.slice() }
      ]
    }],
    messageLogs: { [PROPERTY_ID]: [] }
  };
}

function assertSiblingsAvailable(row, message) {
  for (const roomId of ROOM_IDS.slice(1)) assert.equal(row[roomId], "available", `${message}: ${roomId} must remain available`);
}

function runToggleContract(availability, label) {
  let row = availability.setDay(PROPERTY_ID, "2026-08-02", ROOM_IDS[0], "closed");
  assert.equal(row[ROOM_IDS[0]], "closed", `${label}: closing a room must close that room`);
  assert.equal(row[BUNDLE_ID], "available", `${label}: closing a room for individual sale must preserve the independently open bundle`);
  assertSiblingsAvailable(row, `${label}: room close`);

  for (const roomId of ROOM_IDS) availability.setDay(PROPERTY_ID, "2026-08-03", roomId, "closed");
  row = availability.setDay(PROPERTY_ID, "2026-08-03", BUNDLE_ID, "available");
  assert.equal(row[BUNDLE_ID], "available", `${label}: bundle must open independently`);
  for (const roomId of ROOM_IDS) assert.equal(row[roomId], "closed", `${label}: opening a bundle must not open ${roomId}`);

  row = availability.setDay(PROPERTY_ID, "2026-08-04", BUNDLE_ID, "closed");
  assert.equal(row[BUNDLE_ID], "closed", `${label}: closing a bundle must close only the bundle`);
  for (const roomId of ROOM_IDS) assert.equal(row[roomId], "available", `${label}: closing a bundle must not close ${roomId}`);

  availability.setDay(PROPERTY_ID, "2026-08-05", BUNDLE_ID, "closed");
  row = availability.setDay(PROPERTY_ID, "2026-08-05", ROOM_IDS[0], "available");
  assert.equal(row[ROOM_IDS[0]], "available", `${label}: a room must open independently`);
  assert.equal(row[BUNDLE_ID], "closed", `${label}: opening a room must not open a closed bundle`);

  row = availability.setDay(PROPERTY_ID, "2026-08-06", ROOM_IDS[0], "closed");
  assert.equal(row[BUNDLE_ID], "available", `${label}: room close must not change the independently open bundle`);
  row = availability.setDay(PROPERTY_ID, "2026-08-06", ROOM_IDS[0], "available");
  assert.equal(row[ROOM_IDS[0]], "available", `${label}: the room must reopen`);
  assert.equal(row[BUNDLE_ID], "available", `${label}: reopening a room must preserve the bundle state`);

  availability.setDay(PROPERTY_ID, "2026-08-07", BUNDLE_ID, "closed");
  row = availability.setDay(PROPERTY_ID, "2026-08-07", ROOM_IDS[0], "closed");
  assert.equal(row[BUNDLE_ID], "closed", `${label}: closing a room while the bundle is closed must leave it closed`);
  assertSiblingsAvailable(row, `${label}: closed-bundle room close`);

  availability.setDay(PROPERTY_ID, "2026-08-08", ROOM_IDS[0], "closed");
  availability.setDay(PROPERTY_ID, "2026-08-08", BUNDLE_ID, "available");
  row = availability.setDay(PROPERTY_ID, "2026-08-08", ROOM_IDS[0], "closed");
  assert.equal(row[BUNDLE_ID], "available", `${label}: repeated closed status must not retrigger the room open-to-closed rule`);
  assertSiblingsAvailable(row, `${label}: repeated room close`);
}

function runRangeContract(providers, label) {
  const service = createMvpService(providers, { now: () => NOW });
  service.setMonth({ customerId: PROPERTY_ID, year: 2026, month: 8, roomId: ROOM_IDS[0], status: "closed" });
  service.setMonth({ customerId: PROPERTY_ID, year: 2026, month: 8, roomId: BUNDLE_ID, status: "available" });
  let row = providers.availability.getRows(PROPERTY_ID, "2026-08-10", "2026-08-11")[0];
  assert.equal(row[BUNDLE_ID], "available", `${label}: month bundle open must remain independent`);
  assert.equal(row[ROOM_IDS[0]], "closed", `${label}: month bundle open must not open a closed room`);

  service.applyBatch({ customerId: PROPERTY_ID, year: 2026, month: 8, text: "15 Room B" });
  row = providers.availability.getRows(PROPERTY_ID, "2026-08-15", "2026-08-16")[0];
  assert.equal(row[ROOM_IDS[1]], "closed", `${label}: batch must close the selected room`);
  assert.equal(row[BUNDLE_ID], "available", `${label}: batch room close must preserve an independently open bundle`);
  assert.equal(row[ROOM_IDS[2]], "available", `${label}: batch room close must preserve sibling rooms`);
}

function runSearchContract(providers, label) {
  const service = createMvpService(providers, { now: () => NOW });
  const search = (date, queryMode) => service.searchAvailability({
    customerId: PROPERTY_ID,
    checkIn: date,
    checkOut: new Date(Date.parse(`${date}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10),
    queryMode,
    roomType: "all"
  }).rooms.map((room) => room.id);
  const setRooms = (date, status) => {
    for (const roomId of ROOM_IDS) providers.availability.setDay(PROPERTY_ID, date, roomId, status);
  };

  setRooms("2026-08-20", "closed");
  let row = providers.availability.setDay(PROPERTY_ID, "2026-08-20", BUNDLE_ID, "available");
  assert.equal(row[BUNDLE_ID], "available", `${label}: explicit bundle open must be canonical`);
  for (const roomId of ROOM_IDS) assert.equal(row[roomId], "closed", `${label}: explicit bundle open must preserve closed ${roomId}`);
  assert.deepEqual(search("2026-08-20", "bundle_only"), [BUNDLE_ID], `${label}: available bundle must remain sellable while all member rooms are closed`);
  assert.deepEqual(search("2026-08-20", "room_only"), [], `${label}: closed member rooms must not be offered as rooms`);
  assert.deepEqual(search("2026-08-20", "any"), [BUNDLE_ID], `${label}: any mode must offer only the available bundle when its members are closed`);

  setRooms("2026-08-21", "available");
  providers.availability.setDay(PROPERTY_ID, "2026-08-21", BUNDLE_ID, "closed");
  assert.deepEqual(search("2026-08-21", "bundle_only"), [], `${label}: a closed bundle must remain unavailable while all members are available`);

  setRooms("2026-08-22", "available");
  providers.availability.setDay(PROPERTY_ID, "2026-08-22", BUNDLE_ID, "available");
  assert.deepEqual(search("2026-08-22", "bundle_only"), [BUNDLE_ID], `${label}: an available bundle with available members must be offered`);

  setRooms("2026-08-23", "available");
  providers.availability.setDay(PROPERTY_ID, "2026-08-23", BUNDLE_ID, "available");
  setRooms("2026-08-23", "closed");
  row = providers.availability.getRows(PROPERTY_ID, "2026-08-23", "2026-08-24")[0];
  assert.equal(row[BUNDLE_ID], "available", `${label}: opening the bundle before closing every room must preserve bundle availability`);
  assert.deepEqual(search("2026-08-23", "bundle_only"), [BUNDLE_ID], `${label}: bundle-only search must be independent of room-close ordering`);
  assert.deepEqual(search("2026-08-23", "room_only"), [], `${label}: closing member rooms must still remove them from individual-room search`);

  setRooms("2026-08-24", "closed");
  row = providers.availability.setDay(PROPERTY_ID, "2026-08-24", BUNDLE_ID, "available");
  assert.equal(row[BUNDLE_ID], "available", `${label}: opening the bundle after closing every room must produce the same state`);
  assert.deepEqual(search("2026-08-24", "bundle_only"), [BUNDLE_ID], `${label}: reverse operation order must return the bundle`);
  assert.deepEqual(search("2026-08-24", "room_only"), [], `${label}: reverse operation order must keep rooms unavailable individually`);
}

function createJsonFixture(temp) {
  const seedFile = path.join(temp, "seed.json");
  fs.writeFileSync(seedFile, JSON.stringify(propertySeed()), "utf8");
  return createJsonProviders({ dataFile: path.join(temp, "store.json"), seedFile, now: () => NOW });
}

async function seedPostgresFixture(connection) {
  const client = await openPostgres(connection);
  try {
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,'Toggle Property')", [PROPERTY_ID]);
    await client.query("INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb)", [PROPERTY_ID]);
    for (let index = 0; index < ROOM_IDS.length; index += 1) {
      await client.query(
        "INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position,enabled) VALUES($1,$2,$3,2,'room','',$4,true)",
        [PROPERTY_ID, ROOM_IDS[index], `Room ${String.fromCharCode(65 + index)}`, index]
      );
    }
    await client.query(
      "INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,enabled) VALUES($1,$2,'Whole property',8,0,true)",
      [PROPERTY_ID, BUNDLE_ID]
    );
    for (let index = 0; index < ROOM_IDS.length; index += 1) {
      await client.query(
        "INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,$2,$3,$4)",
        [PROPERTY_ID, BUNDLE_ID, ROOM_IDS[index], index]
      );
    }
    for (const inventoryId of [...ROOM_IDS, BUNDLE_ID]) {
      await client.query(
        "INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) SELECT $1,$2,d,'available',1 FROM generate_series('2026-08-01'::date,'2026-08-31'::date,interval '1 day') d",
        [PROPERTY_ID, inventoryId]
      );
    }
  } finally {
    await client.close();
  }
}

async function run() {
  const jsonTemp = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-toggle-json-"));
  try {
    const providers = createJsonFixture(jsonTemp);
    runToggleContract(providers.availability, "JSON provider");
    runRangeContract(providers, "JSON service range path");
    runSearchContract(providers, "JSON service search path");
  } finally {
    fs.rmSync(jsonTemp, { recursive: true, force: true });
  }

  const postgresTemp = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-toggle-postgres-"));
  const connection = { kind: "pglite", dataDir: path.join(postgresTemp, "database") };
  let providers;
  try {
    await migratePostgres(connection);
    await seedPostgresFixture(connection);
    providers = createPostgresProviders(connection);
    runToggleContract(providers.availability, "PostgreSQL provider");
    runRangeContract(providers, "PostgreSQL service range path");
    runSearchContract(providers, "PostgreSQL service search path");
  } finally {
    if (providers) await providers.close();
    fs.rmSync(postgresTemp, { recursive: true, force: true });
  }

  console.log("inventory toggle linkage: PASS");
}

if (require.main === module) run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { run };
