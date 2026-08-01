"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { createMvpService } = require("../lib/mvp-service");
const { createApp } = require("../server");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(ROOT, "migrations", "020_inventory_availability_authority.sql");
const PROPERTY_ID = "legacy_property";
const OTHER_PROPERTY_ID = "other_property";

async function seedConflictingAuthority(connection) {
  const client = await openPostgres(connection);
  try {
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,'Legacy property'),($2,'Other property')", [PROPERTY_ID, OTHER_PROPERTY_ID]);
    await client.query("INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb),($2,'{}'::jsonb)", [PROPERTY_ID, OTHER_PROPERTY_ID]);
    for (const [position, roomId, capacity] of [[0,"room301",2],[1,"room302",4],[2,"room401",2],[3,"room402",4]]) {
      await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,position,enabled) VALUES($1,$2,$2,$3,$4,true)", [PROPERTY_ID, roomId, capacity, position]);
    }
    await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,position,enabled) VALUES($1,'other_room','Other room',2,0,true)", [OTHER_PROPERTY_ID]);
    await client.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,enabled) VALUES($1,'bundle_all','Whole property',12,10000,true)", [PROPERTY_ID]);
    for (const [position, roomId] of ["room301","room302","room401","room402"].entries()) {
      await client.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,'bundle_all',$2,$3)", [PROPERTY_ID, roomId, position]);
    }
    await client.query("INSERT INTO availability_days(property_id,stay_date,room301,room302,room401,room402,whole_house) VALUES ($1,'2026-08-05','closed','closed','available','available','closed'),($1,'2026-08-06','closed','closed','available','available','closed'),($1,'2026-08-07','available','available','available','available','available')", [PROPERTY_ID]);
    await client.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES ($1,'bundle_all','2026-08-05','closed',0),($1,'room301','2026-08-05','closed',0),($1,'room302','2026-08-05','closed',0),($1,'room401','2026-08-05','closed',0),($1,'room402','2026-08-05','closed',0),($1,'room401','2026-08-06','closed',0),($1,'room402','2026-08-06','closed',0),($1,'room301','2026-08-07','closed',0),($1,'room302','2026-08-07','closed',0),($1,'room401','2026-08-07','closed',0),($1,'room402','2026-08-07','closed',0),($2,'other_room','2026-08-06','available',1)", [PROPERTY_ID, OTHER_PROPERTY_ID]);
  } finally {
    await client.close();
  }
}

async function applyAuthorityMigration(connection) {
  const client = await openPostgres(connection);
  try {
    await client.exec(fs.readFileSync(MIGRATION, "utf8"));
  } finally {
    await client.close();
  }
}

async function normalizedSnapshot(connection) {
  const client = await openPostgres(connection);
  try {
    return (await client.query("SELECT property_id,inventory_id,stay_date::text date,status,remaining FROM inventory_availability_days ORDER BY property_id,stay_date,inventory_id")).rows.map((row) => ({
      propertyId: row.property_id,
      inventoryId: row.inventory_id,
      date: row.date.slice(0, 10),
      status: row.status,
      remaining: Number(row.remaining)
    }));
  } finally {
    await client.close();
  }
}

function assertRuntimeUsesOneAuthority() {
  const source = fs.readFileSync(path.join(ROOT, "lib", "providers", "postgres-worker.js"), "utf8");
  const getRows = source.slice(source.indexOf('if (name === "getRows")'), source.indexOf('if (name === "getDayNotes")'));
  assert.match(getRows, /inventory_availability_days/);
  assert.doesNotMatch(getRows, /\b(?:availability_days|bundle_availability_days)\b/, "active availability reads must not merge a second runtime authority");
  const migration = fs.readFileSync(MIGRATION, "utf8");
  assert.doesNotMatch(migration, /nephi_home|2026-08-0[5-7]|room(?:301|302|401|402)/, "authority migration must be property-, date-, and room-neutral");
}

function assertConsistentResults(service) {
  const adminRows = service.getMonth(PROPERTY_ID, 2026, 8).rows.filter((row) => row.date >= "2026-08-05" && row.date <= "2026-08-07");
  assert.deepEqual(adminRows.map((row) => [row.date, row.room301, row.room302, row.room401, row.room402, row.bundle_all]), [
    ["2026-08-05", "closed", "closed", "available", "available", "closed"],
    ["2026-08-06", "closed", "closed", "available", "available", "closed"],
    ["2026-08-07", "available", "available", "available", "available", "available"]
  ]);
  const expected = [["room401","room402"],["room401","room402"],["room301","room302","room401","room402","bundle_all"]];
  for (const [index, date] of ["2026-08-05","2026-08-06","2026-08-07"].entries()) {
    const frontend = service.searchAvailability({ customerId: PROPERTY_ID, checkIn: date, checkOut: `2026-08-0${6 + index}`, guests: 2, roomType: "all", queryMode: "any" });
    const lineResolver = service.searchAvailability({ customerId: PROPERTY_ID, checkIn: date, checkOut: `2026-08-0${6 + index}`, guests: 2, roomType: "all", queryMode: "any" });
    assert.equal(frontend.availabilityReliable, true);
    assert.deepEqual(frontend.rooms.map((room) => room.id), expected[index]);
    assert.deepEqual(lineResolver.rooms.map((room) => room.id), expected[index]);
  }
  assert.deepEqual(service.searchAvailability({ customerId: OTHER_PROPERTY_ID, checkIn: "2026-08-06", checkOut: "2026-08-07", guests: 2, roomType: "all", queryMode: "any" }).rooms.map((room) => room.id), ["other_room"]);
}

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "availability-authority-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  let providers, app;
  try {
    await migratePostgres(connection);
    await seedConflictingAuthority(connection);
    await applyAuthorityMigration(connection);
    const first = await normalizedSnapshot(connection);
    await applyAuthorityMigration(connection);
    assert.deepEqual(await normalizedSnapshot(connection), first, "the one-time authority migration must be idempotent");
    assert.equal(first.filter((row) => row.propertyId === PROPERTY_ID).length, 15, "all room and bundle dates must be initialized before any toggle");
    assert.deepEqual(first.filter((row) => row.propertyId === OTHER_PROPERTY_ID), [{ propertyId: OTHER_PROPERTY_ID, inventoryId: "other_room", date: "2026-08-06", status: "available", remaining: 1 }], "another property must remain unchanged");

    providers = createPostgresProviders(connection);
    const firstService = createMvpService(providers);
    assertConsistentResults(firstService);
    app = createApp({ providers, adminAuthRequired: false, testOnlyEnvironment: false, lineChannelIdentityGuardRequired: false });
    const running = await app.start(0, "127.0.0.1");
    const frontendResponse = await fetch(`${running.url}/api/public/availability?slug=legacyproperty&checkIn=2026-08-06&checkOut=2026-08-07&guests=2&queryMode=any&roomType=all`);
    const frontendPayload = await frontendResponse.json();
    assert.equal(frontendResponse.status, 200, "the untouched public frontend's first request must succeed");
    assert.deepEqual(frontendPayload.data.rooms.map((room) => room.id), ["room401", "room402"]);
    assert.deepEqual(frontendPayload.data.bundles, []);
    const adminResponse = await fetch(`${running.url}/api/availability/month?propertyId=${PROPERTY_ID}&year=2026&month=8`);
    const adminPayload = await adminResponse.json();
    assert.equal(adminResponse.status, 200);
    assert.deepEqual(adminPayload.data.rows.find((row) => row.date === "2026-08-06"), firstService.getMonth(PROPERTY_ID, 2026, 8).rows.find((row) => row.date === "2026-08-06"), "admin and frontend must read the same normalized authority");
    await app.stop(); app = null; providers = null;
    providers = createPostgresProviders(connection);
    assertConsistentResults(createMvpService(providers));
    assertRuntimeUsesOneAuthority();
    console.log("availability authority migration: PASS");
  } finally {
    if (app) await app.stop();
    if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { run };
