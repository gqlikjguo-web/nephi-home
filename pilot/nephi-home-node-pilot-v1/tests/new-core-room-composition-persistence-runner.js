"use strict";

// FAKE_INTEGRATION: actual provider and existing migrations, isolated PGlite.
// A missing/unguarded JSONB writer, discarded payload, or foreign reference
// must break this test. No production writes or inferred room membership.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createProviders } = require("../lib/providers/provider-factory");
const { createMvpService } = require("../lib/mvp-service");

const composition = () => ({
  schemaVersion: 1, revision: 0, inventoryComplete: true,
  physicalRooms: [
    { physicalRoomId: "unit-east", roomTypeId: "type-family", publicName: "East suite" },
    { physicalRoomId: "unit-west", roomTypeId: "type-family", publicName: "West suite" },
    { physicalRoomId: "unit-loft", roomTypeId: "type-loft", publicName: "Loft" }
  ],
  bundleCompositions: [{ bundleId: "package", complete: true, memberPhysicalRoomIds: ["unit-west", "unit-loft"] }]
});

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-contract-"));
  const connection = { kind: "pglite", dataDir };
  let db, providers, app;
  let cases = 0;
  try {
    await migratePostgres(connection);
    db = await openPostgres(connection);
    for (const id of ["scope-alpha", "scope-beta"]) {
      await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [id, "Contract Lodge"]);
      await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)", [id, JSON.stringify({ commonAnswers: { checkInTime: "16:00" }, propertyFacts: [], preservedSetting: { value: 7 } })]);
      for (const type of ["type-family", "type-loft"]) await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,position) VALUES($1,$2,$2,8,'custom',0)", [id, type]);
      await db.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price) VALUES($1,'package','Package',20,1000)", [id]);
      for (const type of ["type-family", "type-loft"]) await db.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,'package',$2,0)", [id, type]);
    }
    await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,position) VALUES('scope-beta','foreign-type','Foreign',5,'custom',0)");
    await db.close(); db = null;
    providers = createProviders({ postgresConnection: connection });
    const service = createMvpService(providers);
    assert.equal(typeof service.updateRoomComposition, "function", "formal composition writer must exist");
    const write = value => service.updateRoomComposition({ customerId: "scope-alpha", composition: value });
    const read = () => service.getRoomComposition("scope-alpha");
    assert.equal(read().composition, null); cases++;
    const input = composition();
    const saved = write(input);
    assert.equal(saved.composition.revision, 1);
    assert.deepEqual(saved.composition, { ...input, revision: 1 });
    assert.equal(input.revision, 0, "writer cannot mutate caller"); cases++;
    assert.deepEqual(read(), saved); cases++;
    assert.equal(service.getRoomComposition("scope-beta").composition, null); cases++;
    assert.throws(() => write(input), { code: "ROOM_COMPOSITION_REVISION_CONFLICT" }); cases++;
    for (const invalid of [undefined, null, [], {}, { ...composition(), schemaVersion: 2 },
      { ...composition(), physicalRoomCount: 3 },
      { ...composition(), inventoryComplete: "true" },
      { ...composition(), physicalRooms: [...composition().physicalRooms, composition().physicalRooms[0]] },
      { ...composition(), physicalRooms: [{ physicalRoomId: "x", roomTypeId: "foreign-type", publicName: "Foreign" }] },
      { ...composition(), bundleCompositions: [{ bundleId: "package", complete: true, memberPhysicalRoomIds: ["missing"] }] },
      { ...composition(), bundleCompositions: [{ bundleId: "package", complete: true, memberPhysicalRoomIds: ["unit-west", "unit-west"] }] },
      { ...composition(), bundleCompositions: [{ bundleId: "foreign-package", complete: true, memberPhysicalRoomIds: ["unit-west"] }] }
    ]) {
      const candidate = invalid && !Array.isArray(invalid) ? { ...invalid, revision: 1 } : invalid;
      assert.throws(() => write(candidate), { code: "INVALID_ROOM_COMPOSITION" });
      assert.deepEqual(read(), saved, "invalid input must not mutate stored composition"); cases++;
    }
    service.updatePropertyFacts({ customerId: "scope-alpha", facts: [] });
    assert.deepEqual(read(), saved, "existing facts writer must preserve composition"); cases++;
    providers.customerSettings.updatePropertyProfile("scope-alpha", { displayName: "Contract Lodge", contactLink: "" });
    assert.deepEqual(read(), saved, "profile writer must preserve composition"); cases++;
    const next = write({ ...saved.composition, inventoryComplete: false });
    assert.equal(next.composition.revision, 2); cases++;
    // Provider teardown/reopen proves durable JSONB, not a memory-only mirror.
    await providers.close(); providers = createProviders({ postgresConnection: connection });
    assert.deepEqual(providers.customerSettings.getProperty("scope-alpha").roomCompositionV1, next.composition); cases++;
    const { query } = require("./new-core-room-composition-query-runner");
    const storedProperty = providers.customerSettings.getProperty("scope-alpha");
    const final = await query(storedProperty, [{ text: "這個包套的正式房間組成？", capability: "lodging_room_composition", subject: { kind: "bundle", catalogIdentity: "package" } }]);
    assert.equal(final.result.earliestFailure, null); assert.equal(final.validated, true);
    assert.equal(final.result.artifacts.executionOutcomes[0].facts.physicalRoomCount, 2);
    assert.ok(final.result.finalResponse.replyText.includes("West suite"));
    assert.ok(final.result.finalResponse.replyText.includes("Loft")); cases++;
    const { policy } = require("./new-core-operator-policy-runner");
    const reopenedService = createMvpService(providers);
    for (const id of ["scope-alpha", "scope-beta"]) for (const status of ["allowed", "not_allowed", "conditional", "unknown"]) {
      const text = status === "unknown" ? "" : "正式政策以公告條件為準。";
      reopenedService.updatePropertyFacts({ customerId: id, facts: [policy(status, text)] });
      const loaded = providers.customerSettings.getProperty(id);
      assert.equal(loaded.propertyFacts[0].status, status);
      const answer = await query(loaded, [{ text: "正式登錄的服務政策是什麼？", capability: "policy", subject: { kind: "policy", catalogIdentity: "operator_access" } }]);
      assert.equal(answer.result.earliestFailure, null);
      if (status === "unknown") { assert.equal(answer.result.finalDecision.internalAction, "reply"); assert.equal(answer.result.finalDecision.action, "no_reply"); assert.equal(answer.result.finalResponse.shouldReply, false); assert.equal(answer.result.finalResponse.replyText, ""); assert.equal(answer.result.artifacts.claimValidation.ok, true); }
      else assert.equal(answer.validated, true);
      assert.equal(answer.result.artifacts.executionOutcomes[0].outcome, status === "unknown" ? "unknown" : "answered");
      assert.notEqual(answer.result.finalDecision.action, "handoff"); cases++;
    }
    // The existing HTTP authentication/property guard must protect the new
    // writer. The isolated session is a test double, not a real admin login.
    const { createApp } = require("../server");
    const { sessionTokenHash } = require("../lib/admin-auth");
    const session = "composition-isolated-session";
    providers.persistence.getAdminSession = async hash => hash === sessionTokenHash(session) ? { propertyId: "scope-alpha", username: "owner" } : null;
    app = createApp({ providers, adminAuthRequired: true, lineBindingEnv: {} });
    const { url } = await app.start(0, "127.0.0.1");
    const request = async (propertyId, authenticated) => fetch(url + "/api/room-composition", {
      method: "PUT", headers: { "content-type": "application/json", ...(authenticated ? { cookie: `nephi_admin_session=${session}` } : {}) },
      body: JSON.stringify({ propertyId, composition: next.composition })
    });
    assert.equal((await request("scope-alpha", false)).status, 401); cases++;
    assert.equal((await request("scope-beta", true)).status, 403); cases++;
    assert.equal(providers.customerSettings.getProperty("scope-beta").roomCompositionV1, undefined);
    const response = await request("scope-alpha", true);
    assert.equal(response.status, 200);
    const responseBody = await response.json();
    assert.equal(responseBody.data.composition.revision, 3); cases++;
    await app.stop(); app = null; providers = null;
    db = await openPostgres(connection);
    const stored = await db.query("SELECT settings FROM property_settings WHERE property_id='scope-alpha'");
    assert.deepEqual(stored.rows[0].settings.preservedSetting, { value: 7 }); cases++;
    assert.equal(stored.rows[0].settings.commonAnswers.checkInTime, "16:00"); cases++;
  } finally {
    if (app) await app.stop();
    if (db) await db.close();
    if (providers) await providers.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`room composition persistence: ${cases}/${cases} PASS (FAKE_INTEGRATION)`);
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run, composition };
