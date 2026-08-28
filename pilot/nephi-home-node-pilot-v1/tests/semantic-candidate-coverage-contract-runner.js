"use strict";

const assert = require("node:assert/strict");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");
const { plannerJsonSchema, plannerProviderJsonSchema, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { compileSemanticCandidates } = require("../lib/conversation-engine-v2/semantic-candidate-contract");

const message = "Please tell me whether parking is available.";
const eventId = "semantic-coverage";
const providerOutput = {
  schemaVersion: 2,
  discourse: { relation: "new_request", confidence: 1 },
  stateOperations: [],
  stay: {
    dateExpression: { rawText: "", kind: "none", anchor: "none" },
    checkInCandidate: null,
    checkOutCandidate: null,
    nightsCandidate: null,
    guestCountCandidate: null
  },
  tasks: [{
    candidateIndex: 0,
    taskId: "parking",
    groundingId: "parking-grounding",
    type: "amenity",
    sourceText: message,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    entity: { category: "amenity", rawText: "parking", canonicalCandidate: "parking", confidence: 1 },
    stayCandidate: null,
    confidence: 1
  }],
  semanticGroundings: [{
    groundingId: "parking-grounding",
    provenanceRelationCandidateIndexes: [0],
    evidenceRefs: [{ eventId, messageRef: "", startOffset: 0, endOffset: message.length, quote: message }],
    subject: { scope: "property_owned", catalogIdentity: "parking" },
    relation: "property_fact",
    requestedOutput: "answer"
  }],
  contextRelationCandidates: [{
    candidateIndex: 0,
    kind: "new_request",
    candidateRequestCycleRefs: [],
    evidenceRefs: [{ eventId, messageRef: "", startOffset: 0, endOffset: message.length, quote: message }]
  }],
  ambiguities: [],
  missingInformation: [],
  needsHuman: false,
  shouldIgnore: false,
  reason: "provider semantic understanding"
};

(async () => {
  const internalSchema = plannerJsonSchema();
  const providerSchema = plannerProviderJsonSchema();
  assert.ok(internalSchema.required.includes("semanticCandidates"), "the controlled core keeps its semantic ledger contract");
  assert.equal(providerSchema.required.includes("semanticCandidates"), false, "the model must not own semantic candidate coverage");
  assert.equal(Object.hasOwn(providerSchema.properties.tasks.items.properties, "semanticCandidateIds"), false);
  assert.equal(Object.hasOwn(providerSchema.properties.tasks.items.properties, "lodgingScopeId"), false);

  let calls = 0;
  const planner = new TestOnlyOpenAiConversationPlanner({
    apiKey: "test-key",
    model: "test-model",
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify(providerOutput) }) };
    }
  });
  const classified = await planner.classify({
    currentMessage: message,
    currentMessages: [message],
    sourceEvents: [{ eventId, messageText: message }],
    eventTimestamp: 1,
    catalog: {
      propertyId: "semantic-contract-property",
      displayName: "Semantic Contract Property",
      timezone: "Asia/Taipei",
      rooms: [],
      amenities: [{ canonicalId: "parking", category: "amenity", publicName: "Parking", aliases: [], status: "confirmed_yes", answer: "Parking is available." }],
      policies: [],
      faqs: []
    },
    contextSnapshot: { scope: {}, cycles: [] }
  });
  assert.equal(calls, 1, "semantic coverage must not trigger a second provider call");
  assert.equal(Object.hasOwn(classified, "semanticCandidates"), false);

  const compiled = compileSemanticCandidates(classified, {
    sourceEvents: [{ eventId, messageText: message }],
    catalog: {
      propertyId: "semantic-contract-property",
      amenities: [{ canonicalId: "parking", category: "amenity", publicName: "Parking", aliases: [] }],
      rooms: [], policies: [], faqs: []
    }
  }, { synthesizeMissingCandidates: true });
  assert.equal(Array.isArray(compiled.semanticCandidates), true, "the controlled core must deterministically compile the omitted ledger");
  assert.equal(validatePlannerOutput(compiled).ok, true, "deterministic compilation must restore the strict internal contract");
  assert.equal(compiled.tasks[0].semanticCandidateIds.length > 0, true);

  console.log("semantic candidate coverage contract: PASS (engine-owned deterministic compilation)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
