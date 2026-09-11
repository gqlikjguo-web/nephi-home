"use strict";

const assert = require("node:assert/strict");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");

const messageText = "8/29有房嗎";
const output = {
  schemaVersion: 2,
  discourse: { relation: "new_request", confidence: 1 },
  stateOperations: [],
  stay: { dateExpression: { rawText: "8/29", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-29", checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null },
  tasks: [{ candidateIndex: 0, taskId: "availability", type: "availability", sourceText: messageText, detailIntent: "general", requestedOutputs: ["availability"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, stayCandidate: { dateExpression: { rawText: "8/29", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-29", checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null }, confidence: 1 }],
  contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateHistoryTurnRefs: [], evidenceRefs: [{ eventId: "event", messageRef: "message", startOffset: 0, endOffset: messageText.length, quote: messageText }] }],
  ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "understood"
};
output.tasks[0].groundingId = "availability-grounding";
output.tasks[0].entity = { category: "room", rawText: "", canonicalCandidate: "fixture-room", confidence: 1 };
output.semanticGroundings = [{ groundingId: "availability-grounding",
  subject: { scope: "property_owned", catalogIdentity: "fixture-room" },
  relation: "inventory_availability", requestedOutput: "answer",
  provenanceRelationCandidateIndexes: [0], evidenceRefs: output.contextRelationCandidates[0].evidenceRefs
}];

(async () => {
  let providerCalls = 0;
  let criticCalls = 0;
  const planner = new TestOnlyOpenAiConversationPlanner({
    apiKey: "test-key",
    model: "test-model",
    retryDelayMs: 0,
    coverageCritic: { review: async () => { criticCalls += 1; throw new Error("critic must be unreachable"); } },
    fetchImpl: async () => {
      providerCalls += 1;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ output_text: JSON.stringify(output) }) };
    }
  });
  const result = await planner.classify({ currentMessage: messageText, currentMessages: [messageText], sourceEvents: [{ eventId: "event", messageRef: "message", messageText }], catalog: { propertyId: "p", rooms: [{ canonicalId: "fixture-room", category: "room", publicName: "Fixture room" }], amenities: [], policies: [], faqs: [], propertyFacts: [], transportFacts: [] }, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(providerCalls, 1, "one understood plan uses one provider call");
  assert.equal(criticCalls, 0, "coverage critic is not part of the active Planner path");
  assert.equal(Object.hasOwn(result, "semanticCandidates"), false);
  console.log("coverage critic planner integration: PASS (inactive in simplified provider path)");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
