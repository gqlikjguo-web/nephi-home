"use strict";
// FAKE_INTEGRATION: existing PostgreSQL provider with isolated PGlite;
// queued Understanding, official core/Resolver/FinalResponse. No live writes.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createProviders } = require("../lib/providers/provider-factory");
const { createMvpService } = require("../lib/mvp-service");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const NOW = "2026-09-14T04:30:00.000Z";
async function answer(property, identity, { capability = "policy", kind = "policy", purpose = "lodging_question", safetyCandidate = null } = {}) {
  const scope = { propertyId: property.propertyId, channel: "isolated", userId: "actor" };
  const text = "Please provide the published arrival or departure instructions.";
  const refs = [{ eventId: "event", messageRef: "event", startOffset: 0, endOffset: text.length, quote: text }];
  return executeNewCoreTurn({ scope, property, now: NOW,
    state: createConversationStateV3({ ...scope, createdAt: NOW, updatedAt: NOW, expiresAt: "2026-09-15T04:30:00.000Z" }),
    input: { turnId: "event", traceId: "event", message: text, recentConversation: [], sourceEvents: [{ eventId: "event", messageRef: "event", role: "guest", timestamp: NOW, messageKind: "text", messageText: text }] },
    providerConfig: { apiKey: "isolated-model-double" },
    resolver: { availability: () => { throw Error("unexpected inventory"); }, availableDates: () => { throw Error("unexpected inventory"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, fetchImpl: async () => {
      const unit = { unitId: "request", contextLinkCandidateId: "link", purpose, capability, subject: { kind, catalogIdentity: identity }, stayDependent: false, temporalCandidate: null, safetyCandidate, quantityCandidate: null, slotCandidates: [], evidenceRefs: refs, confidenceBand: "high" };
      const envelope = { understandingOutput: { schemaVersion: 1, turnId: "event", units: [unit] }, contextLinkCandidates: [{ unitId: "request", contextLinkCandidateId: "link", relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: refs, referencedHistoryEventRefs: [] }] };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(envelope) }] }] }) };
    } }) });
}
async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "guest-time-text-"));
  const connection = { kind: "pglite", dataDir }; let db, providers, app, cases = 0;
  try {
    await migratePostgres(connection); db = await openPostgres(connection);
    const settings = { commonAnswers: { checkInTime: "15:00", checkOutTime: "11:00", earlyCheckInPolicy: "Early arrival by prior arrangement.", latestArrivalTime: "22:00" }, propertyFacts: [], preserved: { value: 7 } };
    for (const id of ["arrival-alpha", "arrival-beta"]) {
      await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,'Lodge')", [id]);
      await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)", [id, JSON.stringify(settings)]);
    }
    await db.close(); db = null; providers = createProviders({ postgresConnection: connection });
    const service = createMvpService(providers);
    const profile = () => service.getPropertyProfile("arrival-alpha");
    const write = changes => service.updatePropertyProfile({ ...profile(), ...changes, customerId: "arrival-alpha" });
    assert.equal(profile().checkInGuestText, ""); assert.equal(profile().checkOutGuestText, ""); cases++;
    const checkInGuestText = "您好，15:00後可自行入住\n請保留  原文間距。", checkOutGuestText = "您好，早上11:00前可自行退房";
    write({ checkInGuestText, checkOutGuestText });
    assert.equal(profile().checkInGuestText, checkInGuestText); assert.equal(profile().checkOutGuestText, checkOutGuestText); cases++;
    assert.equal(profile().checkInTime, "15:00"); assert.equal(profile().checkOutTime, "11:00"); cases++;
    assert.equal(service.getPropertyProfile("arrival-beta").checkInGuestText, ""); cases++;
    const property = () => providers.customerSettings.getProperty("arrival-alpha");
    for (const [id, expected] of [["check_in", checkInGuestText], ["check_out", checkOutGuestText], ["check_in__early_arrival_policy", settings.commonAnswers.earlyCheckInPolicy], ["check_in__latest_arrival_policy", "22:00"]]) {
      const r = await answer(property(), id); assert.equal(r.earliestFailure, null);
      assert.equal(r.finalDecision.action, "reply"); assert.equal(r.finalResponse.replyText, expected);
      assert.equal(r.artifacts.executionOutcomes[0].facts.answer, expected); cases++;
    }
    const count = buildPropertyCatalog(property()).policies.length;
    // Existing clients omitting new fields must not clear saved operator data.
    const oldClient = { ...profile(), customerId: "arrival-alpha" }; delete oldClient.checkInGuestText; delete oldClient.checkOutGuestText;
    service.updatePropertyProfile(oldClient); assert.equal(profile().checkInGuestText, checkInGuestText); cases++;
    for (const bad of [7, {}, [], null, "x".repeat(501)]) assert.throws(() => write({ checkInGuestText: bad }), { code: "INVALID_PROFILE_GUEST_TEXT" }); cases++;
    await providers.close(); providers = createProviders({ postgresConnection: connection });
    assert.equal(providers.customerSettings.getProperty("arrival-alpha").commonAnswers.checkInGuestText, checkInGuestText); cases++;
    const reloadedService = createMvpService(providers);
    reloadedService.updatePropertyProfile({ ...reloadedService.getPropertyProfile("arrival-alpha"), customerId: "arrival-alpha", checkInGuestText: "", checkOutGuestText: "" });
    for (const [id, expected] of [["check_in", "15:00"], ["check_out", "11:00"]]) {
      assert.equal((await answer(property(), id)).finalResponse.replyText, expected); cases++;
    }
    assert.equal(buildPropertyCatalog(property()).policies.length, count); cases++;
    const {createApp}=require("../server"),{sessionTokenHash}=require("../lib/admin-auth");
    const session="isolated-profile-owner";
    providers.persistence.getAdminSession=async hash=>hash===sessionTokenHash(session)?{propertyId:"arrival-alpha",username:"owner"}:null;
    app=createApp({providers,adminAuthRequired:true,lineBindingEnv:{}});
    const {url}=await app.start(0,"127.0.0.1");
    const payload={...reloadedService.getPropertyProfile("arrival-alpha"),propertyId:"arrival-alpha",checkInGuestText,checkOutGuestText};
    const request=(body,authenticated=true)=>fetch(url+"/api/property-profile",{method:"PUT",headers:{"content-type":"application/json",...(authenticated?{cookie:`nephi_admin_session=${session}`}:{})},body:JSON.stringify(body)});
    assert.equal((await request(payload,false)).status,401);cases++;
    assert.equal((await request({...payload,propertyId:"arrival-beta"})).status,403);cases++;
    const saved=await request(payload);assert.equal(saved.status,200);assert.equal((await saved.json()).data.checkInGuestText,checkInGuestText);cases++;
    const get=await fetch(url+"/api/property-profile?propertyId=arrival-alpha",{headers:{cookie:`nephi_admin_session=${session}`}});
    assert.equal((await get.json()).data.checkOutGuestText,checkOutGuestText);cases++;
    assert.equal((await request({...payload,checkInGuestText:{}})).status,400);cases++;
    await app.stop();app=null;providers=null;db = await openPostgres(connection);
    const stored = (await db.query("SELECT settings FROM property_settings WHERE property_id='arrival-alpha'")).rows[0].settings;
    assert.deepEqual(stored.preserved, { value: 7 }); assert.equal(stored.commonAnswers.checkInTime, "15:00"); cases++;
    console.log(`custom arrival/departure text: ${cases}/${cases} PASS (FAKE_INTEGRATION)`);
  } finally { if(app)await app.stop(); if (db) await db.close(); if (providers) await providers.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
}
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { answer };
