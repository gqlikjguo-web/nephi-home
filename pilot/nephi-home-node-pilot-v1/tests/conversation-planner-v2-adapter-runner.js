"use strict";

const assert = require("node:assert/strict");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");

const messageText = "8/29有房嗎";
function output() {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 1 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "8/29", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-29", checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null },
    tasks: [{ candidateIndex: 0, taskId: "availability", groundingId: "availability-grounding", type: "availability", sourceText: messageText, detailIntent: "general", requestedOutputs: ["availability"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, stayCandidate: { dateExpression: { rawText: "8/29", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-29", checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null }, confidence: 1 }],
    semanticGroundings: [{ groundingId: "availability-grounding", provenanceRelationCandidateIndexes: [0], evidenceRefs: [{ eventId: "event", messageRef: "message", startOffset: 0, endOffset: messageText.length, quote: messageText }], subject: { scope: "property_owned", catalogIdentity: null }, relation: "property_fact", requestedOutput: "answer" }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateHistoryTurnRefs: [], evidenceRefs: [{ eventId: "event", messageRef: "message", startOffset: 0, endOffset: messageText.length, quote: messageText }] }],
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "understood"
  };
}
function input() {
  return { currentMessage: messageText, currentMessages: [messageText], sourceEvents: [{ eventId: "event", messageRef: "message", messageText }], catalog: { propertyId: "p", rooms: [], amenities: [], policies: [], faqs: [], propertyFacts: [], transportFacts: [] }, contextSnapshot: { scope: {}, cycles: [] } };
}

(async () => {
  let calls = 0;
  const planner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("temporary network failure");
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ output_text: JSON.stringify({ ...output(), semanticCandidates: [{ modelOwned: "must be discarded" }] }) }) };
  } });
  const result = await planner.classify(input());
  assert.equal(calls, 2, "transport failure retains one bounded retry");
  assert.equal(result.tasks[0].type, "availability");
  assert.deepEqual(result.semanticGroundings, output().semanticGroundings, "provider adapter must retain the independent source-bound semantic grounding");
  assert.equal(Object.hasOwn(result, "semanticCandidates"), false, "provider semantic ledger is never authoritative");
  const diagnostic = result[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(diagnostic.providerAttemptCount, 2);
  assert.equal(diagnostic.retryPerformed, true);

  let localCalls = 0;
  const invalid = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    localCalls += 1;
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ output_text: JSON.stringify({ ...output(), tasks: [] }) }) };
  } });
  await assert.rejects(() => invalid.classify(input()), (error) => error && error.code === "planner_local_contract_failure", "grounding ownership mismatch must fail closed at the provider boundary");
  assert.equal(localCalls, 1, "local grounding failure must not add a second AI classification call");

  let missingGroundingCalls = 0;
  const missingGrounding = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    missingGroundingCalls += 1;
    const providerOutput = output();
    delete providerOutput.semanticGroundings;
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ output_text: JSON.stringify(providerOutput) }) };
  } });
  await assert.rejects(() => missingGrounding.classify(input()), (error) => error && error.code === "planner_local_contract_failure", "missing semantic grounding ledger must fail closed");
  assert.equal(missingGroundingCalls, 1, "missing grounding must not add a second AI classification call");
  console.log("conversation planner v2 adapter: PASS");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
