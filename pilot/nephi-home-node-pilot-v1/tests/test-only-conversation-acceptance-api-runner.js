"use strict";

// This runner uses a deterministic test-only Planner.  HTTP routing, admin
// authorization, event claiming, persistence, and the V2 Engine remain real.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { runtimeConfig } = require("../config/runtime");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");
const { sessionTokenHash } = require("../lib/admin-auth");
const { migrateFakePlannerOutput, encodeFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const propertyId = "demo_homestay_a";
const adminToken = "test-only-platform-admin-token";
const now = () => new Date("2026-07-31T04:00:00.000Z");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stay(checkIn = null) { return { dateExpression: { rawText: checkIn || "", kind: checkIn ? "absolute" : "none", anchor: checkIn ? "message_time" : "none" }, checkInCandidate: checkIn, checkOutCandidate: null, nightsCandidate: checkIn ? 1 : null, guestCountCandidate: null }; }
function relation(source, kind = "new_request", refs = [], candidateIndex = 0) { return { candidateIndex, kind, candidateRequestCycleRefs: refs, evidenceRefs: [{ eventId: source.eventId, messageRef: "", startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }] }; }
function planTask({ taskId, type, sourceText, dependsOnStayContext, canonicalCandidate = null, category = "other", stayCandidate = null }) { return { candidateIndex: 0, taskId, type, sourceText, detailIntent: "general", requestedOutputs: [type === "availability" ? "availability" : "answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext, stayCandidate, entity: { category, rawText: canonicalCandidate || "", canonicalCandidate, confidence: 0.99 }, confidence: 0.99 }; }
function plannerOutput(input) { return migrateFakePlannerOutput(plannerOutputUnchecked(input)); }
function plannerOutputUnchecked({ sourceEvents, currentMessage }) {
  const source = sourceEvents[0];
  const base = { schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations: [], stay: stay(), ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "test_only_acceptance_fixture" };
  if (currentMessage === "planner timeout") { const error = new Error("test planner timeout"); Object.assign(error, { name: "AbortError", timeout: true, retryPerformed: true, retrySucceeded: false, retryable: true, providerAttemptCount: 2, firstAttemptErrorCategory: "timeout", finalErrorCategory: "timeout", providerAttempts: [{ attempt: 1, timeout: true, timeoutMs: 10, errorCategory: "timeout" }, { attempt: 2, timeout: true, timeoutMs: 10, errorCategory: "timeout" }] }); throw error; }
  if (currentMessage === "need dates") {
    const task = planTask({ taskId: "availability", type: "availability", sourceText: currentMessage, dependsOnStayContext: true, canonicalCandidate: "room301", category: "room", stayCandidate: stay() });
    return { ...base, tasks: [task], missingInformation: ["stay.checkIn"], contextRelationCandidates: [relation(source)] };
  }
  if (currentMessage === "2026-08-06") {
    const task = planTask({ taskId: "date-slot", type: "availability", sourceText: currentMessage, dependsOnStayContext: true, stayCandidate: stay("2026-08-06") });
    return { ...base, tasks: [task], stay: stay("2026-08-06"), contextRelationCandidates: [relation(source)] };
  }
  if (currentMessage === "parking") {
    const task = planTask({ taskId: "parking", type: "amenity", sourceText: currentMessage, dependsOnStayContext: false, canonicalCandidate: "parking", category: "amenity" });
    return { ...base, tasks: [task], contextRelationCandidates: [relation(source)] };
  }
  if (currentMessage === "parking followup") {
    const task = planTask({ taskId: "parking-followup", type: "amenity", sourceText: currentMessage, dependsOnStayContext: false, canonicalCandidate: "parking", category: "amenity" });
    return { ...base, discourse: { relation: "continue", confidence: 0.99 }, tasks: [task], contextRelationCandidates: [relation(source, "supplement_existing", ["parking"])] };
  }
  if (currentMessage === "mixed") {
    const parking = planTask({ taskId: "mixed-parking", type: "amenity", sourceText: currentMessage, dependsOnStayContext: false, canonicalCandidate: "parking", category: "amenity" });
    const human = planTask({ taskId: "mixed-human", type: "high_risk", sourceText: currentMessage, dependsOnStayContext: false }); human.candidateIndex = 1; human.requestedOutputs = ["handoff"]; human.entity.rawText = "human help";
    return { ...base, needsHuman: true, tasks: [parking, human], contextRelationCandidates: [relation(source), relation(source, "new_request", [], 1)] };
  }
  const task = planTask({ taskId: "mixed-parking", type: "amenity", sourceText: currentMessage, dependsOnStayContext: false, canonicalCandidate: "parking", category: "amenity" });
  return { ...base, tasks: [task], contextRelationCandidates: [relation(source)] };
}

const SEMANTIC_LEDGER_DIAGNOSTIC_MESSAGE = "semantic diagnostic";
const SEMANTIC_LEDGER_DIAGNOSTIC_CANDIDATE_ID = "70000000-0000-4000-8000-000000000001";
const semanticLedgerDiagnosticProvider = new TestOnlyOpenAiConversationPlanner({
  apiKey: "test-only-local-key",
  model: "test-only-local-model",
  retryDelayMs: 0,
  fetchImpl: async () => ({
    ok: true,
    json: async () => ({ output_text: encodeFakePlannerOutput({
      schemaVersion: 2,
      discourse: { relation: "new_request", confidence: 1 },
      stateOperations: [],
      stay: stay(),
      tasks: [{
        taskId: "policy",
        candidateIndex: 0,
        type: "policy",
        sourceText: SEMANTIC_LEDGER_DIAGNOSTIC_MESSAGE,
        requestedOutputs: ["answer"],
        eligibilityEvidence: { kind: "none", sourceText: "" },
        dependsOnStayContext: false,
        entity: { category: "policy", rawText: SEMANTIC_LEDGER_DIAGNOSTIC_MESSAGE, canonicalCandidate: null, confidence: 1 },
        confidence: 1,
        semanticCandidateIds: [SEMANTIC_LEDGER_DIAGNOSTIC_CANDIDATE_ID],
        lodgingScopeId: null
      }],
      contextRelationCandidates: [{
        candidateIndex: 0,
        kind: "new_request",
        candidateRequestCycleRefs: [],
        evidenceRefs: [{ eventId: "semantic-ledger-event", messageRef: "semantic-ledger-message", startOffset: 0, endOffset: SEMANTIC_LEDGER_DIAGNOSTIC_MESSAGE.length, quote: SEMANTIC_LEDGER_DIAGNOSTIC_MESSAGE }]
      }],
      semanticCandidates: [{
        candidateId: SEMANTIC_LEDGER_DIAGNOSTIC_CANDIDATE_ID,
        semanticKind: "capability",
        capability: "policy",
        canonicalIdentityCandidate: "policy",
        evidenceRefs: [],
        lodgingScopeCandidate: null,
        temporalSemanticCandidate: null,
        propertyCatalogIdentity: null
      }],
      ambiguities: [],
      missingInformation: [],
      needsHuman: false,
      shouldIgnore: false,
      reason: "semantic_ledger_diagnostic_fixture"
    }) })
  })
});

const plannerWithSemanticLedgerDiagnostic = {
  classify(input) {
    return input.currentMessage === SEMANTIC_LEDGER_DIAGNOSTIC_MESSAGE
      ? semanticLedgerDiagnosticProvider.classify(input)
      : plannerOutput(input);
  }
};

async function request(url, method, body, cookie = `nephi_admin_session=${adminToken}`, authorization = "") {
  const response = await fetch(`${url}/api/admin/test-only/conversation-acceptance`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) });
  const payload = await response.json();
  return { response, body: payload.data || payload };
}

(async () => {
  assert.equal(runtimeConfig({ TEST_ONLY_ACCEPTANCE_ENABLED: "true" }).testOnlyAcceptanceEnabled, true, "runtime config must parse the deployed acceptance flag");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-acceptance-api-"));
  const providers = createJsonProviders({ dataFile: path.join(temp, "store.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), now });
  const sessions = new Map([[sessionTokenHash(adminToken), { propertyId, username: "platform", userId: "platform-user" }]]);
  providers.persistence.getAdminSession = (tokenHash) => sessions.get(tokenHash) || null;
  providers.onboarding = { isPlatformAdmin: (_propertyId, username, userId) => username === "platform" && userId === "platform-user" };
  const app = createApp({ providers, adminAuthRequired: true, testOnlyEnvironment: true, testOnlyAcceptanceEnabled: true, now, testOnlyOverrides: { planner: plannerWithSemanticLedgerDiagnostic } });
  const engineFinalResponses = new Map();
  const originalEngineProcess = app.conversationEngineV2.process.bind(app.conversationEngineV2);
  app.conversationEngineV2.process = async (input) => {
    const result = await originalEngineProcess(input);
    engineFinalResponses.set(input.eventId, clone(result.finalResponse));
    return result;
  };
  const running = await app.start(0, "127.0.0.1");
  try {
    const post = (conversationId, messageText, eventId) => request(running.url, "POST", { customerId: propertyId, conversationId, messageText, ...(eventId ? { eventId } : {}) });
    const stateFor = (conversationId, id = propertyId) => providers.persistence.getConversationState(id, `test-acceptance:${id}`, `test-only-conversation:${crypto.createHash("sha256").update(conversationId).digest("hex").slice(0, 32)}`);

    const first = await post("A", "need dates", "a-1");
    const firstState = clone(stateFor("A"));
    assert.equal(first.response.status, 200); assert.equal(firstState.schemaVersion, 3); assert.equal(firstState.tasks[0].status, "pending");
    const second = await post("A", "2026-08-06", "a-2");
    const secondState = stateFor("A");
    assert.equal(second.response.status, 200); assert.equal(secondState.schemaVersion, 3); assert.equal(secondState.tasks.length, 1); assert.equal(secondState.tasks[0].taskId, "availability"); assert.equal(secondState.tasks[0].status, "answered");
    assert.ok(second.body.trace.some((entry) => entry.stage === "context_execution" && entry.items[0].contextTaskId === "availability" && entry.items[0].slotSources.checkIn === "current_turn"), "slot supplement must resume the original pending task through the reducer");

    const completed = await post("A", "parking", "a-3");
    const continued = await post("A", "parking followup", "a-4");
    assert.equal(completed.body.claimValidation.ok, true); assert.equal(continued.body.claimValidation.ok, true);
    assert.ok(continued.body.trace.some((entry) => entry.stage === "context_execution" && entry.items[0].contextTaskId === "parking"), "a completed task must be reusable only through reducer context");
    assert.ok(continued.body.trace.some((entry) => entry.stage === "claim_validator")); assert.ok(continued.body.trace.some((entry) => entry.stage === "final_decision"));
    assert.equal(continued.body.finalResponse.action, "reply");
    assert.equal(continued.body.finalResponse.shouldReply, true);
    assert.equal(typeof continued.body.finalResponse.replyText, "string");
    assert.ok(continued.body.finalResponse.replyText.length > 0, "acceptance must expose the Engine's unique FinalResponse");
    assert.deepEqual(continued.body.finalResponse, engineFinalResponses.get("a-4"), "acceptance must project the unique Engine result without recomposition");
    assert.equal(continued.body.taskResults[0].dataSource, "property_catalog");
    assert.equal(continued.body.taskResults[0].facts.subject, "停車");
    assert.equal(Object.hasOwn(continued.body.taskResults[0].facts, "propertyId"), false, "safe facts must omit provider scope internals");
    const mixed = await post("mixed", "mixed", "mixed-1");
    assert.deepEqual(mixed.body.taskResults.map((item) => item.status), ["answered", "needs_human"], "mixed tasks must retain independent results through the Engine");
    assert.equal(mixed.body.finalDecision.action, "handoff");
    const timeout = await post("timeout", "planner timeout", "timeout-1");
    const plannerError = timeout.body.trace.find((entry) => entry.stage === "planner_error");
    assert.ok(plannerError && plannerError.timeout && plannerError.retryPerformed && plannerError.providerAttemptCount === 2, "planner timeout/retry summaries must be safely traced");
    const semanticLedgerDiagnostic = await post("semantic-ledger", SEMANTIC_LEDGER_DIAGNOSTIC_MESSAGE, "semantic-ledger-1");
    const semanticLedgerPlannerTrace = semanticLedgerDiagnostic.body.trace.find((entry) => entry.stage === "planner");
    assert.equal(semanticLedgerDiagnostic.response.status, 200);
    assert.equal(semanticLedgerPlannerTrace.parserSucceeded, true);
    assert.equal(semanticLedgerPlannerTrace.providerAttemptCount, 1);
    assert.equal(semanticLedgerPlannerTrace.retryPerformed, false);
    assert.deepEqual(semanticLedgerPlannerTrace.semanticLedgerBoundaries, [
      { stage: "raw_parsed_output", candidateCount: 1, validCandidateCount: 0, invalidCandidateCount: 1, ownershipCount: 1, failureCodes: ["evidence_refs"], evidenceFailureCodes: ["missing_refs"] },
      { stage: "compile_before", candidateCount: 1, validCandidateCount: 0, invalidCandidateCount: 1, ownershipCount: 1, failureCodes: ["evidence_refs"], evidenceFailureCodes: ["missing_refs"] },
      { stage: "compile_after", candidateCount: 1, validCandidateCount: 0, invalidCandidateCount: 1, ownershipCount: 0, failureCodes: ["evidence_refs"], evidenceFailureCodes: ["missing_refs"] },
      { stage: "validate", candidateCount: 1, validCandidateCount: 0, invalidCandidateCount: 1, ownershipCount: 0, failureCodes: ["evidence_refs"], evidenceFailureCodes: ["missing_refs"] }
    ], "provider diagnostic must survive Engine, safe formatting, captureSafeTrace, and acceptance trace projection");
    assert.equal(JSON.stringify(semanticLedgerPlannerTrace).includes(SEMANTIC_LEDGER_DIAGNOSTIC_MESSAGE), false, "acceptance planner trace must not retain fixture message text");

    await post("B", "need dates", "b-1");
    assert.notDeepEqual(stateFor("A"), stateFor("B"), "conversation IDs must be isolated");
    const beta = await post("A", "parking", "beta-1").then((value) => value); // same id but different property tested below through direct request
    assert.equal(beta.response.status, 200);
    const otherProperty = await request(running.url, "POST", { customerId: "demo_homestay_b", conversationId: "A", messageText: "parking", eventId: "property-b-1" });
    assert.equal(otherProperty.response.status, 200); assert.notDeepEqual(stateFor("A"), stateFor("A", "demo_homestay_b"), "properties must be isolated");

    const duplicateBefore = clone(stateFor("B")); const duplicate = await post("B", "parking", "b-1");
    assert.equal(duplicate.body.duplicate, true); assert.deepEqual(stateFor("B"), duplicateBefore, "a redelivered event must not execute or write state");
    const generatedOne = await post("generated-1", "parking"); const generatedTwo = await post("generated-2", "parking");
    assert.notEqual(generatedOne.body.eventId, generatedTwo.body.eventId, "missing event IDs must receive distinct generated events");

    const established = await request(running.url, "POST", { customerId: propertyId, conversationId: "operator-context", messageText: "parking", eventId: "operator-context-1", establishOperatorContext: true });
    assert.equal(established.response.status, 200);
    assert.deepEqual(established.body.operatorContext, {
      established: true,
      source: "engine_final_response",
      eventId: "operator-context-1",
      finalResponse: engineFinalResponses.get("operator-context-1")
    }, "operator prior must be the Engine's actual response rather than directly written state");
    const forbiddenStateInjection = await request(running.url, "POST", { customerId: propertyId, conversationId: "operator-context", messageText: "parking", eventId: "operator-context-2", conversationState: { tasks: [] } });
    assert.equal(forbiddenStateInjection.response.status, 400, "the controlled endpoint must reject direct Conversation State injection");

    const nativeConversationId = "native-events";
    assert.equal(stateFor(nativeConversationId), null);
    for (const nativeType of ["sticker", "image", "video", "file"]) {
      const native = await request(running.url, "POST", {
        customerId: propertyId,
        conversationId: nativeConversationId,
        eventId: `native-${nativeType}`,
        lineEvent: { type: "message", message: { type: nativeType } }
      });
      assert.equal(native.response.status, 200, `${nativeType} must use the controlled native LINE event path`);
      assert.equal(native.body.nativeEvent.type, nativeType);
      assert.equal(native.body.nativeEvent.engineInvoked, false);
      assert.equal(native.body.finalDecision.action, "no_reply");
      assert.equal(native.body.finalDecision.reasonCode, "line_non_text_event_ignored");
      assert.deepEqual(native.body.finalResponse, { action: "no_reply", shouldReply: false, replyText: "" });
      assert.equal(native.body.claimValidation.ok, true);
      assert.equal(native.body.claimValidation.notApplicable, true);
      assert.equal(native.body.trace.some((entry) => entry.stage === "planner"), false, "native events must be filtered at LINE transport before Planner");
    }
    assert.equal(stateFor(nativeConversationId), null, "native events must not create or mutate Conversation State");
    const disguisedText = await request(running.url, "POST", { customerId: propertyId, conversationId: "native-disguised", eventId: "native-text", lineEvent: { type: "message", message: { type: "text", text: "parking" } } });
    assert.equal(disguisedText.response.status, 400, "native injection must not accept a text event through the non-text path");

    const clearA = await request(running.url, "DELETE", { customerId: propertyId, conversationId: "A" });
    assert.equal(clearA.response.status, 200); assert.equal(stateFor("A"), null); assert.ok(stateFor("B"), "clearing A must not affect B");
    const denied = await request(running.url, "POST", { customerId: propertyId, conversationId: "denied", messageText: "parking" }, "nephi_admin_session=not-admin");
    assert.equal(denied.response.status, 401);

    const trace = continued.body.trace;
    for (const stage of ["planner", "validation", "semantic_contract", "context_execution", "canonical_request", "formal_request", "query_plan", "executor", "claim_validator", "final_decision"]) assert.ok(trace.some((entry) => entry.stage === stage), `safe trace must include ${stage}`);
    const serialized = JSON.stringify(trace);
    for (const forbidden of ["sk-", "OPENAI_API_KEY", "LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET", "DATABASE_URL", "postgres://", "platform-admin-token", "parking followup"]) assert.equal(serialized.includes(forbidden), false, `safe trace leaked ${forbidden}`);
    assert.equal(continued.body.finalDecision.action, "reply");
    for (const result of [continued.body, mixed.body, timeout.body]) {
      assert.equal(result.finalResponse.replyText.includes("一定有房"), false);
      assert.equal(result.finalResponse.replyText.includes("已完成訂房"), false);
    }
    const allowedFactKeys = new Set(["subject", "status", "answer", "locationMapUrl", "detailIntent", "availability", "checkIn", "checkOut", "detailProvided", "detailNeedsConfirmation", "amenities", "availableDates", "range", "availableInventory", "applicableBundles", "prices"]);
    for (const task of continued.body.taskResults) for (const key of Object.keys(task.facts)) assert.equal(allowedFactKeys.has(key), true, `unsafe acceptance fact key: ${key}`);

    const disabled = createApp({ providers: createJsonProviders({ dataFile: path.join(temp, "disabled.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), now }), adminAuthRequired: false, testOnlyEnvironment: true, testOnlyAcceptanceEnabled: false, now });
    const disabledRunning = await disabled.start(0, "127.0.0.1");
    try { assert.equal((await request(disabledRunning.url, "POST", { customerId: propertyId, conversationId: "x", messageText: "parking" }).then((x) => x.response.status)), 404); assert.equal((await request(disabledRunning.url, "DELETE", { customerId: propertyId, conversationId: "x" }).then((x) => x.response.status)), 404); } finally { await disabled.stop(); }
    const nonTest = createApp({ providers: createJsonProviders({ dataFile: path.join(temp, "non-test.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), now }), adminAuthRequired: false, testOnlyEnvironment: false, testOnlyAcceptanceEnabled: true, now });
    const nonTestRunning = await nonTest.start(0, "127.0.0.1");
    try { assert.equal((await request(nonTestRunning.url, "POST", { customerId: propertyId, conversationId: "x", messageText: "parking" }).then((x) => x.response.status)), 404); assert.equal((await request(nonTestRunning.url, "DELETE", { customerId: propertyId, conversationId: "x" }).then((x) => x.response.status)), 404); } finally { await nonTest.stop(); }

    const oidcProviders = createJsonProviders({ dataFile: path.join(temp, "oidc.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), now });
    const oidcApp = createApp({ providers: oidcProviders, adminAuthRequired: false, testOnlyEnvironment: true, testOnlyAcceptanceEnabled: true, testOnlyAcceptanceOidcVerifier: async (token) => token === "valid-oidc-token", now, testOnlyOverrides: { planner: { classify: plannerOutput } } });
    const oidcRunning = await oidcApp.start(0, "127.0.0.1");
    const oidcLogs = [];
    const originalConsoleLog = console.log;
    console.log = (...items) => { oidcLogs.push(items.map(String).join(" ")); };
    try {
      const allowed = await request(oidcRunning.url, "POST", { customerId: propertyId, conversationId: "oidc", messageText: "parking", eventId: "oidc-1" }, "", "Bearer valid-oidc-token");
      assert.equal(allowed.response.status, 200, "a verified GitHub Actions OIDC identity must be accepted without a user session");
      const rejected = await request(oidcRunning.url, "POST", { customerId: propertyId, conversationId: "oidc-rejected", messageText: "parking", eventId: "oidc-2" }, "", "Bearer invalid-oidc-token");
      assert.equal(rejected.response.status, 403, "an invalid OIDC identity must fail closed");
      assert.equal(JSON.stringify(rejected.body).includes("invalid-oidc-token"), false, "OIDC tokens must never be reflected in responses");
    } finally { console.log = originalConsoleLog; await oidcApp.stop(); }
    assert.equal(oidcLogs.some((entry) => entry.includes("valid-oidc-token") || entry.includes("invalid-oidc-token")), false, "OIDC tokens must never be written to logs");

    const previousTestOnly = process.env.TEST_ONLY_ENVIRONMENT;
    const previousAcceptance = process.env.TEST_ONLY_ACCEPTANCE_ENABLED;
    process.env.TEST_ONLY_ENVIRONMENT = "true";
    process.env.TEST_ONLY_ACCEPTANCE_ENABLED = "true";
    const envApp = createApp({ providers: createJsonProviders({ dataFile: path.join(temp, "env-enabled.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), now }), adminAuthRequired: false, deploymentCommit: "c56c7df564fed841a65c851b94adc7fa820841f5", testOnlyAcceptanceOidcFetch: async () => ({ ok: true, json: async () => ({ keys: [] }) }), now, testOnlyOverrides: { planner: { classify: plannerOutput } } });
    if (previousTestOnly === undefined) delete process.env.TEST_ONLY_ENVIRONMENT; else process.env.TEST_ONLY_ENVIRONMENT = previousTestOnly;
    if (previousAcceptance === undefined) delete process.env.TEST_ONLY_ACCEPTANCE_ENABLED; else process.env.TEST_ONLY_ACCEPTANCE_ENABLED = previousAcceptance;
    const envRunning = await envApp.start(0, "127.0.0.1");
    try {
      const envStatus = await request(envRunning.url, "POST", { customerId: propertyId, conversationId: "env", messageText: "parking" }, "").then((value) => value.response.status);
      assert.equal(envStatus, 401, "parsed runtime flags must enable the protected handler even without direct createApp flags");
      const oidcRejected = await request(envRunning.url, "POST", { customerId: propertyId, conversationId: "env-oidc", messageText: "parking" }, "", "Bearer malformed-token");
      assert.equal(oidcRejected.response.status, 403, "the enabled runtime must wire the production OIDC verifier and fail closed");
    } finally { await envApp.stop(); }
    console.log(JSON.stringify({ suite: "test-only-conversation-acceptance-api", caseCount: 31, passCount: 31, failCount: 0 }));
  } finally { await app.stop(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
