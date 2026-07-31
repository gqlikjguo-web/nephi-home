"use strict";

// This runner uses a deterministic test-only Planner.  HTTP routing, admin
// authorization, event claiming, persistence, and the V2 Engine remain real.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { sessionTokenHash } = require("../lib/admin-auth");

const propertyId = "demo_homestay_a";
const adminToken = "test-only-platform-admin-token";
const now = () => new Date("2026-07-31T04:00:00.000Z");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stay(checkIn = null) { return { dateExpression: { rawText: checkIn || "", kind: checkIn ? "absolute" : "none", anchor: checkIn ? "message_time" : "none" }, checkInCandidate: checkIn, checkOutCandidate: null, nightsCandidate: checkIn ? 1 : null, guestCountCandidate: null }; }
function relation(source, kind = "new_request", refs = [], candidateIndex = 0) { return { candidateIndex, kind, candidateRequestCycleRefs: refs, evidenceRefs: [{ eventId: source.eventId, messageRef: "", startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }] }; }
function planTask({ taskId, type, sourceText, dependsOnStayContext, canonicalCandidate = null, category = "other", stayCandidate = null }) { return { candidateIndex: 0, taskId, type, sourceText, detailIntent: "general", requestedOutputs: [type === "availability" ? "availability" : "answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext, stayCandidate, entity: { category, rawText: canonicalCandidate || "", canonicalCandidate, confidence: 0.99 }, confidence: 0.99 }; }
function plannerOutput({ sourceEvents, currentMessage }) {
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

async function request(url, method, body, cookie = `nephi_admin_session=${adminToken}`) {
  const response = await fetch(`${url}/api/admin/test-only/conversation-acceptance`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const payload = await response.json();
  return { response, body: payload.data || payload };
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-acceptance-api-"));
  const providers = createJsonProviders({ dataFile: path.join(temp, "store.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), now });
  const sessions = new Map([[sessionTokenHash(adminToken), { propertyId, username: "platform", userId: "platform-user" }]]);
  providers.persistence.getAdminSession = (tokenHash) => sessions.get(tokenHash) || null;
  providers.onboarding = { isPlatformAdmin: (_propertyId, username, userId) => username === "platform" && userId === "platform-user" };
  const app = createApp({ providers, adminAuthRequired: true, testOnlyEnvironment: true, testOnlyAcceptanceEnabled: true, lineChannelIdentityGuardRequired: false, now, testOnlyOverrides: { planner: { classify: plannerOutput } } });
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
    const mixed = await post("mixed", "mixed", "mixed-1");
    assert.deepEqual(mixed.body.taskResults.map((item) => item.status), ["answered", "needs_human"], "mixed tasks must retain independent results through the Engine");
    assert.equal(mixed.body.finalDecision.action, "handoff");
    const timeout = await post("timeout", "planner timeout", "timeout-1");
    const plannerError = timeout.body.trace.find((entry) => entry.stage === "planner_error");
    assert.ok(plannerError && plannerError.timeout && plannerError.retryPerformed && plannerError.providerAttemptCount === 2, "planner timeout/retry summaries must be safely traced");

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

    const clearA = await request(running.url, "DELETE", { customerId: propertyId, conversationId: "A" });
    assert.equal(clearA.response.status, 200); assert.equal(stateFor("A"), null); assert.ok(stateFor("B"), "clearing A must not affect B");
    const denied = await request(running.url, "POST", { customerId: propertyId, conversationId: "denied", messageText: "parking" }, "nephi_admin_session=not-admin");
    assert.equal(denied.response.status, 401);

    const trace = continued.body.trace;
    for (const stage of ["planner", "context_execution", "canonical_request", "formal_request", "query_plan", "executor", "claim_validator", "final_decision"]) assert.ok(trace.some((entry) => entry.stage === stage), `safe trace must include ${stage}`);
    const serialized = JSON.stringify(trace);
    for (const forbidden of ["sk-", "OPENAI_API_KEY", "LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET", "DATABASE_URL", "postgres://", "platform-admin-token", "parking followup"]) assert.equal(serialized.includes(forbidden), false, `safe trace leaked ${forbidden}`);
    assert.equal(continued.body.finalDecision.action, "reply");

    const disabled = createApp({ providers: createJsonProviders({ dataFile: path.join(temp, "disabled.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), now }), adminAuthRequired: false, testOnlyEnvironment: true, testOnlyAcceptanceEnabled: false, lineChannelIdentityGuardRequired: false, now });
    const disabledRunning = await disabled.start(0, "127.0.0.1");
    try { assert.equal((await request(disabledRunning.url, "POST", { customerId: propertyId, conversationId: "x", messageText: "parking" }).then((x) => x.response.status)), 404); assert.equal((await request(disabledRunning.url, "DELETE", { customerId: propertyId, conversationId: "x" }).then((x) => x.response.status)), 404); } finally { await disabled.stop(); }
    const nonTest = createApp({ providers: createJsonProviders({ dataFile: path.join(temp, "non-test.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), now }), adminAuthRequired: false, testOnlyEnvironment: false, testOnlyAcceptanceEnabled: true, lineChannelIdentityGuardRequired: false, now });
    const nonTestRunning = await nonTest.start(0, "127.0.0.1");
    try { assert.equal((await request(nonTestRunning.url, "POST", { customerId: propertyId, conversationId: "x", messageText: "parking" }).then((x) => x.response.status)), 404); assert.equal((await request(nonTestRunning.url, "DELETE", { customerId: propertyId, conversationId: "x" }).then((x) => x.response.status)), 404); } finally { await nonTest.stop(); }
    console.log(JSON.stringify({ suite: "test-only-conversation-acceptance-api", caseCount: 15, passCount: 15, failCount: 0 }));
  } finally { await app.stop(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
