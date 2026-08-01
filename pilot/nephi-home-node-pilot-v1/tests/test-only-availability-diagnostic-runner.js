"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openPostgres } = require("../lib/providers/postgres-client");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { sessionTokenHash } = require("../lib/admin-auth");
const { createApp } = require("../server");
const { runtimeConfig } = require("../config/runtime");

const ADMIN_TOKEN = "diagnostic-platform-admin-token";
const PROPERTY_ID = "nephi_home";
const FROM = "2026-08-05";
const TO = "2026-08-08";

async function get(url, cookie = `nephi_admin_session=${ADMIN_TOKEN}`) {
  const response = await fetch(url, { headers: cookie ? { cookie } : {} });
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
  assert.equal(runtimeConfig({ TEST_ONLY_AVAILABILITY_DIAGNOSTIC: "true" }).testOnlyAvailabilityDiagnostic, true);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "availability-diagnostic-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  let app;
  try {
    await migratePostgres(connection);
    await seed(connection);
    const before = await countRows(connection);
    const providers = createPostgresProviders(connection);
    providers.persistence.getAdminSession = (tokenHash) => tokenHash === sessionTokenHash(ADMIN_TOKEN) ? { propertyId: PROPERTY_ID, username: "platform", userId: "platform-user" } : null;
    providers.onboarding.isPlatformAdmin = () => true;
    app = createApp({ providers, adminAuthRequired: true, testOnlyEnvironment: true, testOnlyAvailabilityDiagnosticEnabled: true, lineChannelIdentityGuardRequired: false });
    const running = await app.start(0, "127.0.0.1");
    const route = `${running.url}/api/admin/test-only/availability-diagnostic`;

    assert.equal((await get(route, "")).response.status, 401, "the diagnostic must require the existing admin session");
    assert.equal((await get(`${route}?propertyId=other&from=1900-01-01`)).response.status, 400, "the diagnostic must reject caller-controlled scope");

    const result = await get(route);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.scope, { testOnly: true, propertyId: PROPERTY_ID, from: FROM, toExclusive: TO });
    assert.deepEqual(result.body.postgres.roomTypes.map((item) => item.roomId), ["room301", "room302", "room401", "room402"]);
    assert.deepEqual(result.body.postgres.legacyAvailabilityRows.map((item) => item.date), ["2026-08-05"]);
    assert.equal(result.body.postgres.inventoryAvailabilityRows.length, 4);
    assert.deepEqual(result.body.postgres.availabilityBlocks, [{ blockId: "maintenance-1", roomId: "room302", startsOn: "2026-08-05", endsOn: "2026-08-07", status: "closed" }]);
    assert.deepEqual(result.body.postgres.bundleMembers.map((item) => item.roomId), ["room301", "room302", "room401", "room402"]);
    assert.deepEqual(result.body.adminApi.rows.map((item) => item.date), ["2026-08-05", "2026-08-06"]);
    assert.equal(result.body.publicApi[1].empty, false);
    assert.equal(result.body.lineAvailabilityResolver[1].availabilityReliable, true);
    assert.deepEqual(result.body.publicApi[1].rooms.map((item) => item.id), result.body.lineAvailabilityResolver[1].rooms.map((item) => item.id));

    const serialized = JSON.stringify(result.body);
    for (const forbidden of ["DATABASE_URL", "postgres://", "password", "token", "channelSecret", "channelAccessToken", "privateNote", "must-not-leak"]) assert.equal(serialized.includes(forbidden), false, `diagnostic leaked ${forbidden}`);
    assert.deepEqual(await countRows(connection), before, "the diagnostic must not modify PostgreSQL state");

    await app.stop(); app = null;
    const json = () => createJsonProviders({ dataFile: path.join(temp, `${Math.random()}.json`), seedFile: path.resolve(__dirname, "../fixtures/seed.json") });
    const disabled = createApp({ providers: json(), adminAuthRequired: false, testOnlyEnvironment: true, testOnlyAvailabilityDiagnosticEnabled: false, lineChannelIdentityGuardRequired: false });
    const disabledRunning = await disabled.start(0, "127.0.0.1");
    try { assert.equal((await get(`${disabledRunning.url}/api/admin/test-only/availability-diagnostic`)).response.status, 404); } finally { await disabled.stop(); }
    const nonTest = createApp({ providers: json(), adminAuthRequired: false, testOnlyEnvironment: false, testOnlyAvailabilityDiagnosticEnabled: true, lineChannelIdentityGuardRequired: false });
    const nonTestRunning = await nonTest.start(0, "127.0.0.1");
    try { assert.equal((await get(`${nonTestRunning.url}/api/admin/test-only/availability-diagnostic`)).response.status, 404); } finally { await nonTest.stop(); }

    console.log(JSON.stringify({ suite: "test-only-availability-diagnostic", caseCount: 18, passCount: 18, failCount: 0 }));
  } finally {
    if (app) await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
