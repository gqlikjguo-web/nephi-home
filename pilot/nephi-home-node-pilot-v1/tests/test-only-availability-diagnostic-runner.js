"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openPostgres } = require("../lib/providers/postgres-client");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { createApp } = require("../server");
const { runtimeConfig } = require("../config/runtime");

const PROPERTY_ID = "nephi_home";
const FROM = "2026-08-05";
const TO = "2026-08-08";

async function get(url) {
  const response = await fetch(url);
  const payload = await response.json();
  return { response, body: payload.data || payload };
}

async function countRows(connection) {
  const client = await openPostgres(connection);
  try {
    const tables = ["room_types", "availability_days", "inventory_availability_days", "availability_blocks", "bundle_offers", "bundle_offer_members", "bundle_availability_days"];
    const counts = {};
    for (const table of tables) counts[table] = Number((await client.query(`SELECT count(*) count FROM ${table}`)).rows[0].count);
    return counts;
  } finally { await client.close(); }
}

async function seed(connection) {
  const client = await openPostgres(connection);
  try {
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [PROPERTY_ID, "測試民宿"]);
    await client.query("INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb)", [PROPERTY_ID]);
    for (const [position, room] of [[0, ["room301", "301", 2]], [1, ["room302", "302", 2]], [2, ["room401", "401", 4]], [3, ["room402", "402", 4]]]) {
      await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,position,enabled) VALUES($1,$2,$3,$4,$5,true)", [PROPERTY_ID, room[0], room[1], room[2], position]);
    }
    await client.query("INSERT INTO availability_days(property_id,stay_date,room301,room302,room401,room402,whole_house) VALUES($1,'2026-08-05','available','closed','available','available','available')", [PROPERTY_ID]);
    await client.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,'room301','2026-08-06','available',1),($1,'room302','2026-08-06','closed',0),($1,'room401','2026-08-06','available',1),($1,'room402','2026-08-06','available',1)", [PROPERTY_ID]);
    await client.query("INSERT INTO availability_blocks(property_id,block_id,room_id,starts_on,ends_on,status,metadata) VALUES($1,'maintenance-1','room302','2026-08-05','2026-08-07','closed','{\"privateNote\":\"must-not-leak\"}'::jsonb)", [PROPERTY_ID]);
    await client.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,enabled) VALUES($1,'bundle_all','包棟',12,10000,true)", [PROPERTY_ID]);
    for (const [position, roomId] of ["room301", "room302", "room401", "room402"].entries()) await client.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,'bundle_all',$2,$3)", [PROPERTY_ID, roomId, position]);
    await client.query("INSERT INTO bundle_availability_days(property_id,bundle_id,stay_date,status) VALUES($1,'bundle_all','2026-08-05','available')", [PROPERTY_ID]);
  } finally { await client.close(); }
}

async function run() {
  assert.equal(runtimeConfig({ TEST_ONLY_ENVIRONMENT: "true" }).testOnlyEnvironment, true);
  assert.equal(runtimeConfig({ TEST_ONLY_AVAILABILITY_STARTUP_DIAGNOSTIC: "true" }).testOnlyAvailabilityStartupDiagnostic, true);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "availability-diagnostic-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  const originalLog = console.log;
  let app;
  try {
    await migratePostgres(connection);
    await seed(connection);
    const before = await countRows(connection);
    const providers = createPostgresProviders(connection);
    const logs = [];
    console.log = (...args) => logs.push(args.map(String).join(" "));
    app = createApp({ providers, adminAuthRequired: true, testOnlyEnvironment: true, testOnlyAvailabilityStartupDiagnosticEnabled: true, lineChannelIdentityGuardRequired: false });
    const running = await app.start(0, "127.0.0.1");
    const route = `${running.url}/api/admin/test-only/availability-diagnostic`;

    assert.equal((await get(route)).response.status, 404, "the temporary HTTP diagnostic must be removed");
    const diagnosticLogs = logs.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter((entry) => entry && entry.scope === "test-only-availability-startup-diagnostic");
    assert.equal(diagnosticLogs.length, 1, "startup must emit the diagnostic exactly once");
    const result = diagnosticLogs[0];
    assert.deepEqual({ testOnly: result.testOnly, propertyId: result.propertyId, from: result.from, toExclusive: result.toExclusive }, { testOnly: true, propertyId: PROPERTY_ID, from: FROM, toExclusive: TO });
    assert.deepEqual(result.steps, [
      { step: "postgres_snapshot", propertyId: PROPERTY_ID, from: FROM, toExclusive: TO },
      { step: "frontend_availability_resolver", propertyId: PROPERTY_ID, from: FROM, toExclusive: TO }
    ]);
    assert.deepEqual(result.postgres.roomTypes.map((item) => item.roomId), ["room301", "room302", "room401", "room402"]);
    assert.deepEqual(result.postgres.legacyAvailabilityRows.map((item) => item.date), ["2026-08-05"]);
    assert.equal(result.postgres.inventoryAvailabilityRows.length, 4);
    assert.deepEqual(result.postgres.availabilityBlocks, [{ blockId: "maintenance-1", roomId: "room302", startsOn: "2026-08-05", endsOn: "2026-08-07", status: "closed" }]);
    assert.deepEqual(result.postgres.bundleMembers.map((item) => item.roomId), ["room301", "room302", "room401", "room402"]);
    assert.deepEqual(result.frontendAvailabilityResolver.map((item) => item.checkIn), ["2026-08-05", "2026-08-06", "2026-08-07"]);
    assert.equal(result.frontendAvailabilityResolver[1].result.availabilityReliable, true);
    assert.deepEqual(result.frontendAvailabilityResolver[1].result.rooms.map((item) => item.id), ["room301", "room401", "room402"]);

    const serialized = JSON.stringify(result);
    for (const forbidden of ["DATABASE_URL", "postgres://", "password", "token", "cookie", "LINE", "channelSecret", "channelAccessToken", "privateNote", "must-not-leak"]) assert.equal(serialized.includes(forbidden), false, `diagnostic leaked ${forbidden}`);
    assert.deepEqual(await countRows(connection), before, "the diagnostic must not modify PostgreSQL state");

    await app.stop(); app = null;
    const json = () => createJsonProviders({ dataFile: path.join(temp, `${Math.random()}.json`), seedFile: path.resolve(__dirname, "../fixtures/seed.json") });
    const disabledLogs = [];
    console.log = (...args) => disabledLogs.push(args.map(String).join(" "));
    const disabled = createApp({ providers: json(), adminAuthRequired: false, testOnlyEnvironment: true, testOnlyAvailabilityStartupDiagnosticEnabled: false, lineChannelIdentityGuardRequired: false });
    const disabledRunning = await disabled.start(0, "127.0.0.1");
    try { assert.equal(disabledLogs.length, 0); } finally { await disabled.stop(); }
    const nonTest = createApp({ providers: json(), adminAuthRequired: false, testOnlyEnvironment: false, testOnlyAvailabilityStartupDiagnosticEnabled: true, lineChannelIdentityGuardRequired: false });
    const nonTestRunning = await nonTest.start(0, "127.0.0.1");
    try { assert.equal(disabledLogs.length, 0); } finally { await nonTest.stop(); }

    originalLog(JSON.stringify({ suite: "test-only-availability-diagnostic", caseCount: 20, passCount: 20, failCount: 0 }));
  } finally {
    console.log = originalLog;
    if (app) await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
