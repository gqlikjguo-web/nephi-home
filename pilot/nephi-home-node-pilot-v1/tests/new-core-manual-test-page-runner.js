"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { bindRecentConversationToCycles, buildManualTestFailureDiagnostics, normalizeManualTestFailureRefs, turnStateSnapshot } = require("../lib/new-core/manual-test-service");
const { aggregateUnitOutcomes } = require("../lib/new-core/unit-aggregator");

const root = path.resolve(__dirname, "..");
const adminSessionValue = crypto.randomUUID();
const cookie = `nephi_admin_session=${adminSessionValue}`;
const now = () => new Date("2026-08-29T12:00:00.000Z");
let calls = 0;
const historyLengths = [];
let factsPropertyName = "";

function nextState(state, timestamp) {
  calls += 1;
  return state;
}

async function fakeTurn({ input, state, property, sideEffectGuard, now: timestamp }) {
  factsPropertyName = property.displayName;
  historyLengths.push(input.recentConversation.length);
  if (input.message === "provider failure") { const error = new Error("failed"); error.code = "UNDERSTANDING_PROVIDER_FAILURE"; throw error; }
  if (input.message === "side effect") sideEffectGuard.lineSend();
  if (input.message === "diagnostic failure") return {
    state, understanding: { summary: "", units: [] }, lifecycle: [], routing: [],
    resolver: { name: "existing canonical Resolver", foundOfficialData: false, status: "NOT_APPLICABLE" },
    finalDecision: { action: "no_reply", reasonCode: "new_core_no_reply", taskIds: [], missingFields: [], reviewRequired: false, executionSummary: {} },
    finalResponse: { action: "no_reply", shouldReply: false, replyText: "" },
    earliestFailure: { layer: "C03", failureCode: "CAPABILITY_SUBJECT_CONFLICT" },
    failedUnitDiagnostics: [{
      unitId: "unit-diagnostic", purpose: "lodging_question", capability: "availability",
      subject: { kind: "room", catalogIdentity: null }, temporalCandidate: { rawText: "8/31", kind: "partial", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null },
      safetyCandidate: null, readiness: null,
      failureCodes: { C03: "CAPABILITY_SUBJECT_CONFLICT", C06: null, C07: null },
      earliestFailure: { layer: "C03", failureCode: "CAPABILITY_SUBJECT_CONFLICT" }
    }], requestedModel: "gpt-5.6-luna", resolvedModel: "gpt-5.6-luna"
  };
  const continuation = calls > 0;
  return { state: nextState(state, timestamp), understanding: { summary: continuation ? "補充日期，承接正式 pending cycle" : "詢問包棟價格，缺日期", units: [{ purpose: "lodging_question", capability: "price", subject: { kind: "bundle", catalogIdentity: "bundle_all" } }] }, lifecycle: [continuation ? "CONTINUE" : "START"], routing: [continuation ? "ANSWER" : "CLARIFY"], resolver: { name: "existing canonical Resolver", foundOfficialData: continuation, status: continuation ? "answered" : "NOT_APPLICABLE" }, finalDecision: continuation ? { action: "reply", reasonCode: "execution_answered", taskIds: ["formal-cycle-1"], missingFields: [], reviewRequired: false, executionSummary: {} } : { action: "clarification", reasonCode: "missing_information", taskIds: ["formal-cycle-1"], missingFields: ["checkIn", "checkOut"], reviewRequired: false, executionSummary: { notReadyTaskIds: ["formal-cycle-1"] } }, finalResponse: continuation ? { action: "reply", shouldReply: true, replyText: "正式資料預計回覆" } : { action: "clarification", shouldReply: true, replyText: "請提供入住日期。" }, earliestFailure: null, requestedModel: "gpt-5.6-luna", resolvedModel: "gpt-5.6-luna" };
}

async function json(url, method = "GET", body, sentCookie = cookie) {
  const response = await fetch(url, { method, headers: { ...(sentCookie ? { cookie: sentCookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json(); return { status: response.status, body: payload };
}

(async () => {
  const pendingState = {
    scope: { propertyId: "nephi_home", channel: "new-core-manual-test", userId: "manual-test:test" },
    tasks: [{
      taskId: "pending-price-bundle", taskType: "pricing", productType: "bundle", productId: "bundle_all",
      roomTypeId: null, bundleId: "bundle_all", checkIn: null, checkOut: null, guestCount: 4,
      searchFrom: null, searchTo: null, entityId: "bundle_all", entityCategory: "bundle", detailIntent: "general",
      knownFields: ["guestCount", "productId"], missingFields: ["checkIn", "checkOut"], status: "needs_clarification",
      createdAt: "2026-08-29T11:59:00.000Z", updatedAt: "2026-08-29T11:59:00.000Z", expiresAt: "2026-08-30T11:59:00.000Z"
    }]
  };
  const pendingSnapshot = turnStateSnapshot(pendingState, pendingState.scope, "2026-08-29T12:00:00.000Z");
  assert.deepEqual(pendingSnapshot.referenceableCycles[0], {
    requestCycleId: "pending-price-bundle", requestKind: "pricing", capability: "price", status: "pending",
    expiresAt: "2026-08-30T11:59:00.000Z", subject: { kind: "bundle", catalogIdentity: "bundle_all" },
    missingFields: ["checkIn", "checkOut"],
    confirmedValues: { checkIn: null, checkOut: null, guestCount: 4, searchFrom: null, searchTo: null },
    slotRefs: ["guestCount", "productId"]
  });
  const boundHistory = bindRecentConversationToCycles([{ turnId: "prior-turn", timestamp: "2026-08-29T11:59:00.000Z", input: "想了解包棟價格" }], pendingState, pendingSnapshot.referenceableCycles);
  assert.deepEqual(boundHistory[0].referenceableCycleIds, ["pending-price-bundle"]);

  const mappedFailures = normalizeManualTestFailureRefs([
    { unitId: "unit-availability", failureCode: "ROUTE_PURPOSE_CONFLICT" },
    { unitId: "unit-availability", failureCode: "ROUTE_PURPOSE_CONFLICT" }
  ]);
  assert.deepEqual(mappedFailures, [
    { unitId: "unit-availability", failureCode: "ROUTE_PURPOSE_CONFLICT" }
  ]);
  assert.equal(Object.isFrozen(mappedFailures), true);
  assert.equal(Object.isFrozen(mappedFailures[0]), true);
  const mappedAggregation = aggregateUnitOutcomes({
    turnId: "turn-manual-upstream-failure",
    validatedUnits: [],
    lifecycleDecisions: [],
    routingDecisions: [],
    failedUnits: mappedFailures
  });
  assert.equal(mappedAggregation.ok, true, mappedAggregation.code);
  assert.equal(mappedAggregation.value.failedUnits[0].failureCode, "ROUTE_PURPOSE_CONFLICT");

  const failedUnit = {
    unitId: "unit-availability", evidenceRefs: [], purpose: "lodging_question", capability: "availability",
    subject: { kind: "property", catalogIdentity: null }, stayDependent: true,
    temporalCandidate: { rawText: "今天", kind: "relative_date", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null },
    contextLinkCandidateId: "link-availability", safetyCandidate: null,
    slotCandidates: [], confidenceBand: "high"
  };
  const failureDiagnostics = buildManualTestFailureDiagnostics({
    understanding: {
      understandingOutput: { schemaVersion: 1, turnId: "turn-failure", units: [failedUnit] },
      failedUnits: []
    },
    outcomes: [{
      unit: failedUnit,
      readiness: { unitId: "unit-availability", status: "READY", missingGuestFields: [] },
      failure: { layer: "C07", failureCode: "ROUTING_READINESS_INVALID" }
    }]
  });
  assert.deepEqual(failureDiagnostics, [{
    unitId: "unit-availability",
    purpose: "lodging_question",
    capability: "availability",
    subject: { kind: "property", catalogIdentity: null },
    temporalCandidate: { rawText: "今天", kind: "relative_date", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null },
    safetyCandidate: null,
    readiness: { status: "READY", missingGuestFields: [] },
    failureCodes: { C03: null, C06: null, C07: "ROUTING_READINESS_INVALID" },
    earliestFailure: { layer: "C07", failureCode: "ROUTING_READINESS_INVALID" }
  }]);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-manual-page-"));
  const providers = createJsonProviders({ dataFile: path.join(temp, "data.json"), seedFile: path.join(root, "fixtures/seed.json"), now });
  const factsProviders = createJsonProviders({ dataFile: path.join(temp, "facts-data.json"), seedFile: path.join(root, "fixtures/seed.json"), now });
  const demoProperty = providers.customerSettings.getProperty("demo_homestay_a");
  const originalGetProperty = providers.customerSettings.getProperty.bind(providers.customerSettings);
  providers.customerSettings.getProperty = (id) => id === "nephi_home" ? { ...demoProperty, propertyId: "nephi_home" } : originalGetProperty(id);
  const factsDemoProperty = factsProviders.customerSettings.getProperty("demo_homestay_a");
  const factsOriginalGetProperty = factsProviders.customerSettings.getProperty.bind(factsProviders.customerSettings);
  factsProviders.customerSettings.getProperty = (id) => id === "nephi_home" ? { ...factsDemoProperty, propertyId: "nephi_home", displayName: "正式 facts authority" } : factsOriginalGetProperty(id);
  providers.persistence.getAdminSession = async (hash) => hash && hash.length === 64 ? { userId: "admin-owner", propertyId: "nephi_home", username: "owner", properties: [{ propertyId: "nephi_home" }] } : null;
  const app = createApp({ providers, newCoreManualTestFactsProviders: factsProviders, adminAuthRequired: true, now, runtimeEnv: { OPENAI_API_KEY: Array(33).join("x") }, newCoreManualTestExecuteTurn: fakeTurn, lineBindingEnv: {} });
  const running = await app.start(0, "127.0.0.1");
  try {
    const denied = await fetch(`${running.url}/admin/new-core-test`); assert.equal(denied.status, 401);
    const page = await fetch(`${running.url}/admin/new-core-test`, { headers: { cookie } }); assert.equal(page.status, 200); const html = await page.text(); assert.match(html, /JunZan AI 新核心測試/); assert.match(html, /gpt-5\.6-luna/); assert.doesNotMatch(html, /model.*select/iu);
    const forged = await json(`${running.url}/api/admin/new-core-test/sessions`, "POST", { propertyId: "other" }); assert.equal(forged.status, 403);
    const created = await json(`${running.url}/api/admin/new-core-test/sessions`, "POST", {}); assert.equal(created.status, 201, JSON.stringify(created.body)); const id = created.body.data.testSessionId; assert.match(id, /^[0-9a-f-]{36}$/i);
    const diagnosticFailure = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "diagnostic failure" }); assert.equal(diagnosticFailure.status, 201, JSON.stringify(diagnosticFailure.body));
    assert.deepEqual(diagnosticFailure.body.data.diagnostic.failedUnits[0], {
      unitId: "unit-diagnostic", purpose: "lodging_question", capability: "availability",
      subject: { kind: "room", catalogIdentity: null }, temporalCandidate: { rawText: "8/31", kind: "partial", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null },
      safetyCandidate: null, readiness: null,
      failureCodes: { C03: "CAPABILITY_SUBJECT_CONFLICT", C06: null, C07: null },
      earliestFailure: { layer: "C03", failureCode: "CAPABILITY_SUBJECT_CONFLICT" }
    });
    const persistedDiagnostic = await json(`${running.url}/api/admin/new-core-test/records/${diagnosticFailure.body.data.traceId}`);
    assert.deepEqual(persistedDiagnostic.body.data.diagnostic.failedUnits, diagnosticFailure.body.data.diagnostic.failedUnits);
    const first = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "想了解包棟價格" }); assert.equal(first.status, 201, JSON.stringify(first.body)); assert.equal(first.body.data.diagnostic.context[0], "START"); assert.equal(first.body.data.diagnostic.finalResponse.action, "clarification");
    assert.equal(factsPropertyName, "正式 facts authority", "manual test must read property facts from the dedicated facts authority");
    const second = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "9/20" }); assert.equal(second.status, 201); assert.equal(second.body.data.diagnostic.context[0], "CONTINUE"); assert.equal(second.body.data.predictedResponse, "正式資料預計回覆");
    assert.deepEqual(second.body.data.diagnostic.sideEffectCounters, { LINE_SEND: 0, PRODUCTION_STATE_WRITE: 0, PRODUCTION_MESSAGE_WRITE: 0, PRODUCTION_REVIEW_WRITE: 0, BOOKING_MUTATION: 0, FACTS_PROPERTY_MUTATION: 0 });
    const injected = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "x", model: "gpt-4.1-mini" }); assert.equal(injected.status, 400);
    const reviewed = await json(`${running.url}/api/admin/new-core-test/turns/${second.body.data.turnId}/review`, "PATCH", { status: "PROBLEM", problemCategory: "Context承接錯", note: "人工備註" }); assert.equal(reviewed.status, 200); assert.equal(reviewed.body.data.manualReview.status, "PROBLEM");
    const records = await json(`${running.url}/api/admin/new-core-test/records?filter=problem`); assert.equal(records.status, 200); assert.equal(records.body.data.items.length, 1);
    const trace = await json(`${running.url}/api/admin/new-core-test/records/${second.body.data.traceId}`); assert.equal(trace.status, 200); assert.equal(trace.body.data.traceId, second.body.data.traceId);
    const reset = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/new-conversation`, "POST", {}); assert.equal(reset.status, 200); assert.equal(reset.body.data.generation, 2);
    const afterReset = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "新對話" }); assert.equal(afterReset.status, 201); assert.equal(historyLengths.at(-1), 0, "new generation must not send old turns to C01");
    const providerFailure = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "provider failure" }); assert.equal(providerFailure.status, 201); assert.equal(providerFailure.body.data.diagnostic.failureCode, "UNDERSTANDING_PROVIDER_FAILURE"); assert.equal(providerFailure.body.data.diagnostic.finalResponse.action, "handoff");
    const sideEffect = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "side effect" }); assert.equal(sideEffect.status, 201); assert.equal(sideEffect.body.data.diagnostic.failureCode, "TEST_LINE_SEND_FORBIDDEN"); assert.equal(sideEffect.body.data.diagnostic.sideEffectCounters.LINE_SEND, 1);
    assert.equal(calls, 3);
    const source = fs.readFileSync(path.join(root, "lib/new-core/manual-test-service.js"), "utf8"); assert.match(source, /callOpenAIUnderstandingV1/); assert.match(source, /reduceConversationStateV3/); assert.match(source, /executeCanonicalQueryPlans/); assert.match(source, /buildFinalDecision/); assert.match(source, /buildFinalResponse/); assert.doesNotMatch(source, /gpt-4\.1-mini|process\.env\.OPENAI_MODEL|messagingApi|appendMessageLog|setConversationState/);
    const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
    assert.match(serverSource, /NEW_CORE_MANUAL_TEST_FACTS_DATABASE_URL/);
    assert.match(serverSource, /NEW_CORE_MANUAL_TEST_FACTS_AUTHORITY_REQUIRED/);
    for (const secret of ["apiKey", "authorization", "cookie", "reasoning", "prompt", "databaseUrl"]) assert.equal(JSON.stringify(second.body.data.diagnostic).includes(secret), false);
    console.log(JSON.stringify({ suite: "new-core-manual-test-page", caseCount: 29, passCount: 29, fakeIntegration: true, realOpenAICalls: 0, sideEffects: second.body.data.diagnostic.sideEffectCounters }));
  } finally { await app.stop(); }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
