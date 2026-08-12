"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { loadSeedManifest, seedPostgres } = require("../lib/providers/postgres-seed");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "fixtures", "postgres-seed.json");
const PROPERTY_ID = "nephi_home";

function assertPermanentAcceptanceIntegrityGate() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["verify:test-only-acceptance-data"],
    "node tests/test-only-acceptance-data-integrity-runner.js",
    "the deterministic acceptance-data gate must have a stable package entry point"
  );
  const deployedRunner = fs.readFileSync(path.join(ROOT, "scripts", "run-deployed-conversation-acceptance.js"), "utf8");
  const mainStart = deployedRunner.indexOf("async function main(env = process.env)");
  const initialization = deployedRunner.indexOf("await runOperationalReadOnlyAcceptance({", mainStart);
  assert.ok(
    mainStart >= 0 && initialization > mainStart,
    "operational business integrity must wrap the acceptance matrix"
  );
  assert.match(deployedRunner, /const before = await readIntegrity\(integrityInput\);[\s\S]*summary = await runMatrix\(matrixInput\);[\s\S]*const after = await readIntegrity\(integrityInput\);/, "the matrix must be enclosed by two operational integrity reads");
  assert.equal(deployedRunner.slice(mainStart).includes("loadAcceptanceDataSnapshot(ACCEPTANCE_DATA_MANIFEST_PATH)"), false, "operational deployed acceptance must not load or initialize repository fixture facts");
  assert.match(
    deployedRunner,
    /const runScope = createAcceptanceRunScope\(commit, randomUuid\(\)\);/,
    "each acceptance execution must use a fresh run scope"
  );
  const providerSource = fs.readFileSync(path.join(ROOT, "lib", "providers", "test-only-acceptance-data.js"), "utf8");
  const operationalStart = providerSource.indexOf("async function readOperationalBusinessSnapshot(");
  const operationalEnd = providerSource.indexOf("function unique(", operationalStart);
  const operationalSource = providerSource.slice(operationalStart, operationalEnd);
  assert.ok(operationalStart >= 0 && operationalEnd > operationalStart, "the operational snapshot reader must be present");
  const operationalQueries = [...operationalSource.matchAll(/client\.query\("([^"]+)"/g)].map((match) => match[1]);
  assert.ok(operationalQueries.length >= 10 && operationalQueries.every((query) => query.startsWith("SELECT ")), "the operational reader must contain SELECT-only business access");
  assert.doesNotMatch(operationalSource, /\b(?:syncTestOnlyAcceptanceData|writeSnapshot)\b/, "the operational reader must not reach fixture mutation functions");
}

async function withClient(connection, work) {
  const client = await openPostgres(connection);
  try { return await work(client); } finally { await client.close(); }
}

async function installStaleAcceptanceData(connection) {
  await withClient(connection, async (client) => {
    await client.query("UPDATE properties SET display_name='Stale property' WHERE property_id=$1", [PROPERTY_ID]);
    await client.query(
      "UPDATE property_settings SET settings=$2::jsonb WHERE property_id=$1",
      [PROPERTY_ID, JSON.stringify({ currency: "TWD", commonAnswers: { paymentRule: "先匯款一半當訂金" } })]
    );
    await client.query(
      "UPDATE room_types SET name='Stale 301',display_name='Stale 301',room_code='OLD',capacity=9,highlights='[\"stale\"]'::jsonb,monday_thursday_price=9999,friday_price=9999,saturday_holiday_price=9999,sunday_price=9999 WHERE property_id=$1 AND room_id='room301'",
      [PROPERTY_ID]
    );
    await client.query(
      "UPDATE knowledge_items SET answer='stale answer' WHERE property_id=$1 AND knowledge_id='faq_1'",
      [PROPERTY_ID]
    );
    await client.query(
      "INSERT INTO knowledge_items(property_id,knowledge_id,question,answer,knowledge_key,position) VALUES($1,'faq_stale','stale question','stale answer','stale_key',999)",
      [PROPERTY_ID]
    );
    await client.query(
      "UPDATE bundle_offers SET name='12人包棟',capacity=12,base_price=13000,monday_thursday_price=13000,friday_price=13000,saturday_holiday_price=18000,sunday_price=13000,entertainment_amenities='[{\"key\":\"stale\",\"provided\":true}]'::jsonb WHERE property_id=$1 AND bundle_id='bundle_four_room_whole_house'",
      [PROPERTY_ID]
    );
    await client.query(
      "UPDATE bundle_offer_members SET position=99 WHERE property_id=$1 AND bundle_id='bundle_four_room_whole_house' AND room_id='room402'",
      [PROPERTY_ID]
    );
    await client.query(
      "INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled) VALUES($1,'stale_partial_bundle','Stale partial bundle',4,5000,5000,5000,5000,5000,true)",
      [PROPERTY_ID]
    );
    await client.query(
      "INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,'stale_partial_bundle','room301',0)",
      [PROPERTY_ID]
    );
    await client.query(
      "INSERT INTO room_price_overrides(property_id,room_id,stay_date,price,currency) VALUES($1,'room301','2026-08-27',8888,'TWD')",
      [PROPERTY_ID]
    );
    await client.query(
      "UPDATE availability_days SET room301='closed',whole_house='closed' WHERE property_id=$1 AND stay_date='2026-08-27'",
      [PROPERTY_ID]
    );
    await client.query(
      "INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,'room301','2026-08-27','closed',0),($1,'room301','2026-09-01','available',1)",
      [PROPERTY_ID]
    );
    await client.query(
      "INSERT INTO bundle_availability_days(property_id,bundle_id,stay_date,status) VALUES($1,'bundle_four_room_whole_house','2026-08-27','closed')",
      [PROPERTY_ID]
    );
    await client.query(
      "INSERT INTO conversation_states(property_id,channel_id,line_user_id,state) VALUES($1,'test-acceptance:nephi_home','preserved-user','{\"revision\":7}'::jsonb)",
      [PROPERTY_ID]
    );
    await client.query(
      "INSERT INTO message_logs(property_id,channel_id,event_id,review_id,line_user_id,processing_status,status,needs_review,payload) VALUES($1,'test-acceptance:nephi_home','preserved-event','preserved-review','preserved-user','complete','complete',false,'{\"preserve\":true}'::jsonb)",
      [PROPERTY_ID]
    );
  });
}

async function assertLegacySeedLeavesStaleData(connection, seedInput) {
  const result = await seedPostgres(connection, seedInput);
  assert.equal(result.seeded, false);
  await withClient(connection, async (client) => {
    const settings = await client.query("SELECT settings FROM property_settings WHERE property_id=$1", [PROPERTY_ID]);
    assert.equal(settings.rows[0].settings.commonAnswers.paymentRule, "先匯款一半當訂金");
    const room = await client.query("SELECT name,capacity,monday_thursday_price FROM room_types WHERE property_id=$1 AND room_id='room301'", [PROPERTY_ID]);
    assert.equal(room.rows[0].name, "Stale 301");
    assert.equal(Number(room.rows[0].capacity), 9);
    assert.equal(Number(room.rows[0].monday_thursday_price), 9999);
    const bundle = await client.query("SELECT name,capacity,base_price FROM bundle_offers WHERE property_id=$1 AND bundle_id='bundle_four_room_whole_house'", [PROPERTY_ID]);
    assert.equal(bundle.rows[0].name, "12人包棟");
    assert.equal(Number(bundle.rows[0].capacity), 12);
    assert.equal(Number(bundle.rows[0].base_price), 13000);
    const availability = await client.query("SELECT status FROM inventory_availability_days WHERE property_id=$1 AND inventory_id='room301' AND stay_date='2026-08-27'", [PROPERTY_ID]);
    assert.equal(availability.rows[0].status, "closed");
  });
  console.log("existing-property legacy seed stale reproduction: PASS");
}

function writeConflictingManifest(tempDirectory) {
  const property = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "nephi-home-property.json"), "utf8"));
  const availability = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "nephi-home-availability-2026-07-14-to-2026-08-31.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  manifest.propertyFile = "property.json";
  manifest.availabilityFile = "availability.json";
  manifest.roomMappings[1].roomId = manifest.roomMappings[0].roomId;
  fs.writeFileSync(path.join(tempDirectory, "property.json"), JSON.stringify(property));
  fs.writeFileSync(path.join(tempDirectory, "availability.json"), JSON.stringify(availability));
  const manifestPath = path.join(tempDirectory, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

async function assertSynchronizedData(connection, snapshotHash) {
  await withClient(connection, async (client) => {
    const property = await client.query("SELECT display_name FROM properties WHERE property_id=$1", [PROPERTY_ID]);
    assert.equal(property.rows[0].display_name, "尼腓的家");
    const room = await client.query("SELECT name,display_name,room_code,capacity,highlights,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price FROM room_types WHERE property_id=$1 AND room_id='room301'", [PROPERTY_ID]);
    assert.deepEqual(
      { ...room.rows[0], capacity: Number(room.rows[0].capacity), monday_thursday_price: Number(room.rows[0].monday_thursday_price), friday_price: Number(room.rows[0].friday_price), saturday_holiday_price: Number(room.rows[0].saturday_holiday_price), sunday_price: Number(room.rows[0].sunday_price) },
      { name: "301 雙人房", display_name: "301 雙人房", room_code: "", capacity: 2, highlights: [], monday_thursday_price: 0, friday_price: 0, saturday_holiday_price: 0, sunday_price: 0 }
    );
    const bundle = await client.query("SELECT bundle_id,name,capacity,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,entertainment_amenities FROM bundle_offers WHERE property_id=$1 ORDER BY bundle_id", [PROPERTY_ID]);
    assert.deepEqual(bundle.rows.map((row) => ({ ...row, capacity: Number(row.capacity), base_price: Number(row.base_price), monday_thursday_price: Number(row.monday_thursday_price), friday_price: Number(row.friday_price), saturday_holiday_price: Number(row.saturday_holiday_price), sunday_price: Number(row.sunday_price) })), [{ bundle_id: "bundle_four_room_whole_house", name: "四房包棟", capacity: 10, base_price: 0, monday_thursday_price: 0, friday_price: 0, saturday_holiday_price: 0, sunday_price: 0, entertainment_amenities: [] }]);
    const members = await client.query("SELECT room_id,position FROM bundle_offer_members WHERE property_id=$1 AND bundle_id='bundle_four_room_whole_house' ORDER BY position", [PROPERTY_ID]);
    assert.deepEqual(members.rows.map((row) => ({ roomId: row.room_id, position: Number(row.position) })), [
      { roomId: "room301", position: 0 },
      { roomId: "room302", position: 1 },
      { roomId: "room401", position: 2 },
      { roomId: "room402", position: 3 }
    ]);
    assert.equal(Number((await client.query("SELECT count(*) count FROM knowledge_items WHERE property_id=$1", [PROPERTY_ID])).rows[0].count), 18);
    assert.equal(Number((await client.query("SELECT count(*) count FROM room_price_overrides WHERE property_id=$1", [PROPERTY_ID])).rows[0].count), 0);
    assert.equal(Number((await client.query("SELECT count(*) count FROM inventory_availability_days WHERE property_id=$1", [PROPERTY_ID])).rows[0].count), 245);
    assert.equal(Number((await client.query("SELECT count(*) count FROM availability_days WHERE property_id=$1", [PROPERTY_ID])).rows[0].count), 49);
    assert.equal(Number((await client.query("SELECT count(*) count FROM bundle_availability_days WHERE property_id=$1", [PROPERTY_ID])).rows[0].count), 0);
    const active = await client.query("SELECT status FROM inventory_availability_days WHERE property_id=$1 AND inventory_id='room301' AND stay_date='2026-08-27'", [PROPERTY_ID]);
    assert.equal(active.rows[0].status, "available");
    assert.equal(Number((await client.query("SELECT count(*) count FROM conversation_states WHERE property_id=$1 AND line_user_id='preserved-user'", [PROPERTY_ID])).rows[0].count), 1);
    assert.equal(Number((await client.query("SELECT count(*) count FROM message_logs WHERE property_id=$1 AND event_id='preserved-event'", [PROPERTY_ID])).rows[0].count), 1);
  });
  assert.match(snapshotHash, /^[0-9a-f]{64}$/);
}

async function run() {
  assertPermanentAcceptanceIntegrityGate();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acceptance-data-integrity-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  const seedInput = loadSeedManifest(MANIFEST_PATH);
  try {
    await migratePostgres(connection);
    await seedPostgres(connection, seedInput);
    await withClient(connection, (client) => client.query("INSERT INTO properties(property_id,display_name) VALUES('sibling_property','Sibling')"));
    await installStaleAcceptanceData(connection);
    await assertLegacySeedLeavesStaleData(connection, seedInput);

    const {
      hashAcceptanceDataSnapshot,
      loadAcceptanceDataSnapshot,
      readOperationalAcceptanceDataIntegrity,
      syncTestOnlyAcceptanceData,
      verifyTestOnlyAcceptanceData
    } = require("../lib/providers/test-only-acceptance-data");
    const acceptanceDataSource = fs.readFileSync(path.resolve(__dirname, "../lib/providers/test-only-acceptance-data.js"), "utf8");
    assert.match(acceptanceDataSource, /transaction\.query\("SET TRANSACTION READ ONLY"\)/, "operational snapshot collection must explicitly mark its PostgreSQL transaction read-only");

    const snapshot = loadAcceptanceDataSnapshot(MANIFEST_PATH);
    const operationalBefore = await readOperationalAcceptanceDataIntegrity({ connection, acceptancePropertyId: PROPERTY_ID, testOnly: true });
    assert.equal(operationalBefore.mode, "operational_read_only");
    assert.match(operationalBefore.businessHash, /^[0-9a-f]{64}$/);
    assert.equal(Object.hasOwn(operationalBefore, "snapshot"), false, "operational integrity must not expose business data unless explicitly requested");
    const operationalSnapshot = await readOperationalAcceptanceDataIntegrity({ connection, acceptancePropertyId: PROPERTY_ID, testOnly: true, includeSnapshot: true });
    assert.deepEqual(Object.keys(operationalSnapshot.snapshot).sort(), ["availability", "bundles", "bundleMembers", "knowledgeItems", "priceOverrides", "rooms"].sort());
    assert.equal(operationalSnapshot.businessHash, hashAcceptanceDataSnapshot(operationalSnapshot.snapshot), "the business hash must cover exactly the emitted redacted snapshot");
    assert.equal(operationalSnapshot.snapshot.rooms.some((room) => room.id === "room301"), true);
    assert.equal(operationalSnapshot.snapshot.bundles.some((bundle) => bundle.id === "bundle_four_room_whole_house"), true);
    assert.equal(operationalSnapshot.snapshot.knowledgeItems.some((item) => item.knowledgeId === "faq_1"), true);
    const serializedOperationalSnapshot = JSON.stringify(operationalSnapshot);
    for (const forbidden of ["settings", "lineBinding", "channel_secret", "channel_access_token", "admin", "session", "conversation"]) {
      assert.equal(serializedOperationalSnapshot.includes(forbidden), false, `snapshot must exclude sensitive domain: ${forbidden}`);
    }
    assert.equal(
      (await withClient(connection, (client) => client.query("SELECT name FROM room_types WHERE property_id=$1 AND room_id='room301'", [PROPERTY_ID]))).rows[0].name,
      "Stale 301",
      "operational read-only integrity must never repair or replace operational facts"
    );
    await withClient(connection, async (client) => {
      await client.query("INSERT INTO conversation_states(property_id,channel_id,line_user_id,state) VALUES($1,'runtime-only','runtime-only','{}'::jsonb)", [PROPERTY_ID]);
      await client.query("INSERT INTO message_logs(property_id,channel_id,event_id,review_id,line_user_id,processing_status,status,needs_review,payload) VALUES($1,'runtime-only','runtime-only','runtime-only','runtime-only','complete','complete',false,'{}'::jsonb)", [PROPERTY_ID]);
    });
    const operationalAfterRuntime = await readOperationalAcceptanceDataIntegrity({ connection, acceptancePropertyId: PROPERTY_ID, testOnly: true });
    assert.equal(operationalAfterRuntime.businessHash, operationalBefore.businessHash, "runtime logs and conversation state must be excluded from the business hash");
    await withClient(connection, (client) => client.query("UPDATE room_types SET display_name='Business mutation sentinel' WHERE property_id=$1 AND room_id='room301'", [PROPERTY_ID]));
    const operationalAfterBusiness = await readOperationalAcceptanceDataIntegrity({ connection, acceptancePropertyId: PROPERTY_ID, testOnly: true });
    assert.notEqual(operationalAfterBusiness.businessHash, operationalBefore.businessHash, "a business authority mutation must change the business hash");
    await withClient(connection, (client) => client.query("UPDATE room_types SET display_name='Stale 301' WHERE property_id=$1 AND room_id='room301'", [PROPERTY_ID]));
    await withClient(connection, (client) => client.query(
      "INSERT INTO property_line_bindings(property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled) VALUES($1,$2,$3::jsonb,$4::jsonb,true)",
      [PROPERTY_ID, "private-webhook-key", JSON.stringify({ ciphertext: "private-secret-ciphertext" }), JSON.stringify({ ciphertext: "private-token-ciphertext" })]
    ));
    const operationalWithLine = await readOperationalAcceptanceDataIntegrity({ connection, acceptancePropertyId: PROPERTY_ID, testOnly: true });
    assert.equal(Object.hasOwn(operationalWithLine, "lineBinding"), false, "operational snapshot metadata must exclude the LINE binding domain entirely");
    for (const secret of ["private-webhook-key", "private-secret-ciphertext", "private-token-ciphertext"]) {
      assert.equal(JSON.stringify(operationalWithLine).includes(secret), false, "operational integrity results must not expose LINE credential material");
    }
    await assert.rejects(
      syncTestOnlyAcceptanceData({
        connection,
        manifestPath: MANIFEST_PATH,
        acceptancePropertyId: PROPERTY_ID,
        expectedSnapshotHash: "f".repeat(64),
        testOnly: true
      }),
      (error) => error && error.code === "ACCEPTANCE_DATA_SNAPSHOT_MISMATCH"
    );
    assert.equal(
      (await withClient(connection, (client) => client.query("SELECT name FROM room_types WHERE property_id=$1 AND room_id='room301'", [PROPERTY_ID]))).rows[0].name,
      "Stale 301",
      "a caller/repository hash mismatch must not write any acceptance data"
    );
    await assert.rejects(
      syncTestOnlyAcceptanceData({ connection, manifestPath: MANIFEST_PATH, acceptancePropertyId: PROPERTY_ID, testOnly: false }),
      (error) => error && error.code === "TEST_ONLY_ACCEPTANCE_DATA_SCOPE_REQUIRED"
    );
    await assert.rejects(
      syncTestOnlyAcceptanceData({ connection, manifestPath: MANIFEST_PATH, acceptancePropertyId: "sibling_property", testOnly: true }),
      (error) => error && error.code === "TEST_ONLY_ACCEPTANCE_PROPERTY_MISMATCH"
    );
    const result = await syncTestOnlyAcceptanceData({ connection, manifestPath: MANIFEST_PATH, acceptancePropertyId: PROPERTY_ID, testOnly: true });
    assert.equal(result.status, "verified");
    assert.equal(result.propertyId, PROPERTY_ID);
    assert.equal(result.snapshotHash, snapshot.snapshotHash);
    assert.equal(result.roomCount, 4);
    assert.equal(result.bundleCount, 1);
    assert.equal(result.knowledgeItemCount, 18);
    assert.equal(result.availabilityDayCount, 49);
    await assertSynchronizedData(connection, result.snapshotHash);
    assert.equal((await withClient(connection, (client) => client.query("SELECT display_name FROM properties WHERE property_id='sibling_property'"))).rows[0].display_name, "Sibling");

    const verified = await verifyTestOnlyAcceptanceData({ connection, snapshot, acceptancePropertyId: PROPERTY_ID, testOnly: true });
    assert.equal(verified.snapshotHash, snapshot.snapshotHash);

    await withClient(connection, async (client) => {
      await client.query("UPDATE properties SET display_name='Rollback sentinel' WHERE property_id=$1", [PROPERTY_ID]);
      await client.query("UPDATE room_types SET name='Rollback stale room' WHERE property_id=$1 AND room_id='room301'", [PROPERTY_ID]);
      await client.query("ALTER TABLE room_types ADD CONSTRAINT acceptance_sync_forced_failure CHECK(name <> '301 雙人房')");
    });
    await assert.rejects(
      syncTestOnlyAcceptanceData({ connection, manifestPath: MANIFEST_PATH, acceptancePropertyId: PROPERTY_ID, testOnly: true }),
      (error) => error && error.code === "ACCEPTANCE_DATA_INTEGRITY_FAILURE"
    );
    assert.equal((await withClient(connection, (client) => client.query("SELECT display_name FROM properties WHERE property_id=$1", [PROPERTY_ID]))).rows[0].display_name, "Rollback sentinel");

    const conflictDirectory = fs.mkdtempSync(path.join(temp, "conflict-"));
    const conflictManifest = writeConflictingManifest(conflictDirectory);
    assert.throws(
      () => loadAcceptanceDataSnapshot(conflictManifest),
      (error) => error && error.code === "ACCEPTANCE_DATA_CANONICAL_CONFLICT"
    );

    console.log(JSON.stringify({ suite: "test-only-acceptance-data-integrity", caseCount: 20, passCount: 20, failCount: 0 }));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
