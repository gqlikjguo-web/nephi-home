"use strict";
// FAKE_INTEGRATION: actual server, PostgreSQL providers (local PGlite), coordinator,
// adapter and core. Only OpenAI HTTP and LINE transport are isolated. No State seed.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createProviders } = require("../lib/providers/provider-factory");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { attachPropertyScopedLineBinding, waitFor } = require("./helpers/property-scoped-line-webhook");

const NOW = new Date("2026-09-24T03:00:00Z");
const DB_ID = "dpg-da6qo0jbc2fs738f11v0-a";
const SERVICE_ID = "srv-d9bqupbbc2fs73aselig";
const localEnv = {
  TEST_ONLY_ENVIRONMENT: "true",
  RENDER_SERVICE_ID: SERVICE_ID,
  DATABASE_URL: `postgresql://fixture@${DB_ID}/nephi_home_node_pilot_test_only`,
  NEW_CORE_MANUAL_TEST_FACTS_DATABASE_URL: `postgresql://fixture@${DB_ID}/nephi_home_node_pilot_test_only`,
  OPENAI_API_KEY: crypto.randomBytes(24).toString("hex")
};
const firstText = "Two guests need Room A availability";
const secondText = "2026-10-12入住，2026-10-14退房";
function envelope(c01) {
  const event = c01.sourceEvents[0];
  const ref = { eventId: event.eventId, messageRef: event.messageRef, startOffset: 0,
    endOffset: event.messageText.length, quote: event.messageText };
  const supplement = event.messageText === secondText;
  const prior = c01.recentConversation.find(item => item.messageText === firstText);
  return { understandingOutput: { schemaVersion: 1, turnId: c01.turnId, units: [{
    unitId: `unit-${event.eventId}`, evidenceRefs: [ref], purpose: "lodging_question",
    capability: "availability", subject: { kind: "room", catalogIdentity: "room-a" },
    stayDependent: true, temporalCandidate: supplement ? { kind: "date_range", rawText: secondText,
      checkInCandidate: "2026-10-12", checkOutCandidate: "2026-10-14", nightsCandidate: 2 } : null,
    contextLinkCandidateId: "link", safetyCandidate: null, confidenceBand: "high",
    slotCandidates: supplement ? [] : [{ slotCandidateId: "guests", slot: "guest_count", value: 2,
      operation: "SET", evidenceRefs: [ref] }]
  }] }, contextLinkCandidates: [{ contextLinkCandidateId: "link", unitId: `unit-${event.eventId}`,
    relationKind: supplement ? "SUPPLEMENT" : "NEW_REQUEST", currentSourceEvidenceRefs: [ref],
    referencedHistoryEventRefs: supplement && prior ? [{ eventId: prior.eventId, messageRef: prior.messageRef }] : [] }] };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-manual-ingress-"));
  const connection = { kind: "pglite", dataDir: path.join(dir, "db") };
  await migratePostgres(connection);
  const db = await openPostgres(connection);
  await db.query("INSERT INTO properties(property_id,display_name) VALUES('nephi_home','Harness fixture')");
  await db.query("INSERT INTO property_settings(property_id,settings) VALUES('nephi_home',$1::jsonb)", [JSON.stringify({currency:"TWD",businessProfile:{publicSlug:"harnessfixture"}})]);
  await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,position,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price) VALUES('nephi_home','room-a','Room A',2,'double',0,1200,1200,1200,1200,1200)");
  await db.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES('nephi_home','room-a','2026-10-12','available',1),('nephi_home','room-a','2026-10-13','available',1)");
  await db.query("INSERT INTO commercial_ai_subscriptions(property_id,status) VALUES('nephi_home','legacy')");
  await db.close();
  const providers = createProviders({ postgresConnection: connection });
  providers.commercial.setLimit("nephi_home", 1000);
  const binding = attachPropertyScopedLineBinding({ providers, propertyId: "nephi_home" });
  const nativeFetch = globalThis.fetch;
  const calls = [], stages = [], lineSends = [];
  let credentialReads = 0;
  const getBinding = providers.lineBindings.getLineBindingByWebhookKey.bind(providers.lineBindings);
  providers.lineBindings.getLineBindingByWebhookKey = (...args) => { credentialReads++; return getBinding(...args); };
  let holdFirst, releaseFirst;
  const firstEntered = new Promise(resolve => holdFirst = resolve);
  const firstRelease = new Promise(resolve => releaseFirst = resolve);
  let hold = false;
  for (const name of ["claimMessageEvent", "getConversationState", "setConversationState", "listRecentMessages"]) {
    const original = providers.persistence[name].bind(providers.persistence);
    providers.persistence[name] = (...args) => { stages.push({ name, args: args.slice(0,3) }); return original(...args); };
  }
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname === "127.0.0.1") return nativeFetch(url, options);
    assert.equal(new URL(url).hostname, "api.openai.com", "no LINE/profile or other external HTTP permitted");
    const body = JSON.parse(options.body);
    const c01 = JSON.parse(body.input.find(item => item.role === "developer").content[0].text);
    calls.push(c01);
    if (hold) { hold = false; holdFirst(); await firstRelease; }
    return new Response(JSON.stringify({ model: "gpt-5.6-luna", status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(envelope(c01)) }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), { status: 200 });
  };
  const app = createApp({ providers, testOnlyEnvironment: true, enableProductionLineEngine: true,
    newCoreManualTestFactsProviders: providers, runtimeEnv: localEnv, adminAuthRequired: true,
    now: () => NOW, lineBindingEnv: binding.lineBindingEnv, openAiTestEnv: {},
    publicBrandEnv: { PUBLIC_BASE_URL: "https://test.example" },
    lineReplyClientFactory: () => ({ replyMessageWithHttpInfo: async body => { lineSends.push(body); return {httpResponse:{status:200}}; } }) });
  const running = await app.start(0, "127.0.0.1");
  async function request(route, body) {
    const r = await fetch(running.url + "/api/admin/new-core-test" + route,
      { method: body === undefined ? "GET" : "POST", headers: {"content-type":"application/json"},
        ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    const value = await r.json(); return {status:r.status, ...value};
  }
  try {
    const session = (await request("/sessions", {})).data;
    assert.equal(providers.persistence.listMessageLogs("nephi_home").length, 0);
    const route = `/sessions/${session.testSessionId}/turns`;
    const first = await request(route, {input:firstText});
    assert.equal(first.status, 201, JSON.stringify(first));
    const record = providers.persistence.findMessageByEventId("nephi_home", first.data.turnId);
    assert.ok(record, "manual browser input must claim/save a production message event, not bypass the adapter");
    assert.equal(record.processingStatus, "reply_succeeded");
    const saved = providers.persistence.getConversationState("nephi_home", record.channelId, record.lineUserId);
    assert.equal(saved.revision, 1); assert.equal(saved.tasks[0].guestCount, 2);
    assert.equal(first.data.diagnostic.finalDecision.action, "clarification");
    const second = await request(route, {input:secondText});
    assert.equal(second.status, 201, JSON.stringify(second));
    assert.equal(second.data.diagnostic.earliestFailure, null);
    assert.equal(second.data.diagnostic.finalDecision.action, "reply");
    assert.match(second.data.predictedResponse, /2,?400/);
    assert.ok(calls[1].recentConversation.some(item => item.eventId === first.data.turnId));
    const after = providers.persistence.getConversationState("nephi_home", record.channelId, record.lineUserId);
    assert.equal(after.revision, 2); assert.equal(after.tasks[0].guestCount, 2);
    assert.equal(after.tasks[0].checkIn, "2026-10-12");
    const ui = providers.persistence.getNewCoreTestSession(session.testSessionId, session.ownerId, "nephi_home");
    assert.equal(ui.state.revision, 0, "UI record must not become a second Context State authority");
    assert.deepEqual(ui.state.tasks, []);
    assert.equal(lineSends.length, 0, "manual messages must never select the configured LINE client");
    assert.equal(credentialReads, 0, "manual transport must never resolve LINE binding credentials");
    for (const name of ["claimMessageEvent", "getConversationState", "setConversationState", "listRecentMessages"])
      assert.ok(stages.some(item => item.name === name), name);
    assert.equal((await request(route, {input:firstText,state:{}})).status, 400);
    assert.equal((await request(route, {input:firstText,model:"different"})).status, 400);
    assert.equal((await request("/sessions", {propertyId:"other"})).status, 403);
    const other = (await request("/sessions", {})).data;
    await request(`/sessions/${other.testSessionId}/turns`, {input:firstText});
    assert.equal(calls.at(-1).recentConversation.length, 0, "another manual guest cannot inherit history");
    await request(`/sessions/${session.testSessionId}/new-conversation`, {});
    hold = true;
    const pendingFirst = request(route, {input:firstText});
    await firstEntered;
    const pendingSecond = request(route, {input:secondText});
    await waitFor(() => providers.persistence.listMessageLogs("nephi_home").length === 5);
    assert.equal(calls.length, 4, "coordinator must serialize second message while first Understanding is in flight");
    releaseFirst();
    const pair = await Promise.all([pendingFirst, pendingSecond]);
    assert.ok(pair.every(item => item.status === 201), JSON.stringify(pair));
    assert.equal(calls[3].recentConversation.length, 0, "reset must not inherit old guest State/history");
    assert.ok(calls[4].recentConversation.some(item => item.eventId === pair[0].data.turnId));
    assert.equal(pair[1].data.diagnostic.finalDecision.action, "reply");
    assert.equal(lineSends.length, 0);
    // Same server's real webhook, with synthetic binding and isolated LINE transport.
    const event = { type:"message", webhookEventId:"signed-control", replyToken:"synthetic-control",
      timestamp:NOW.getTime(), source:{type:"group",userId:"signed-control-guest"},
      message:{type:"text",id:"signed-control",text:firstText} };
    assert.equal((await binding.post(running.url,JSON.stringify({events:[event,event]}))).status,200);
    await waitFor(() => providers.persistence.findMessageByEventId("nephi_home","signed-control")?.processingStatus === "reply_succeeded", 8000);
    assert.equal(calls.length, 6, "duplicate LINE event must remain deduplicated");
    assert.equal(lineSends.length, 1, "only signed-control uses configured LINE client");
    assert.equal(calls[5].recentConversation.length, 0);
    assert.equal(providers.persistence.getConversationState("nephi_home",record.channelId,record.lineUserId).revision,2);
    const beforeRejected = providers.persistence.listMessageLogs("nephi_home").length;
    for (const [key,value] of [["RENDER_SERVICE_ID","wrong-service"],
      ["DATABASE_URL","postgresql://fixture@unapproved.invalid/unknown"],
      ["NEW_CORE_MANUAL_TEST_FACTS_DATABASE_URL","postgresql://fixture@unapproved.invalid/unknown"],
      ["DATABASE_URL",`${localEnv.DATABASE_URL}?host=unapproved.invalid`]]) {
      const previous = localEnv[key]; localEnv[key] = value;
      try { assert.equal((await request(route, {input:firstText})).status, 401); }
      finally { localEnv[key] = previous; }
    }
    assert.equal(providers.persistence.listMessageLogs("nephi_home").length, beforeRejected,
      "misconfigured manual entry must reject before claiming any message");
    assert.equal(calls.length, 6, "misconfigured entry must not call OpenAI");
    const invalidWebhook = await binding.post(running.url,JSON.stringify({events:[event],manualTransport:{binding:{propertyId:"nephi_home"}}}),{signature:"invalid"});
    assert.equal(invalidWebhook.status,401,"browser isolation must not weaken public webhook signature authentication");
    const fixedAdmin = await fetch(`${running.url}/api/admin/session`);
    assert.equal(fixedAdmin.status,200,"verified fixed deployment must use the same scoped admin identity");
    assert.equal((await fixedAdmin.json()).data.propertyId,"nephi_home");
    console.log(JSON.stringify({classification:"FAKE_INTEGRATION",caseCount:11,passCount:11,
      paths:["manual-page HTTP","signed LINE webhook"],coreCalls:calls.length,realOpenAICalls:0,
      nativeStores:["message_logs","event_claims","conversation_states"],uiStateAuthority:false}));
  } finally { releaseFirst(); await app.stop(); globalThis.fetch = nativeFetch; }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
