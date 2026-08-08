"use strict";

const assert = require("node:assert/strict");
const { compileSemanticCandidates, validateSemanticCandidates, missingSemanticCandidates } = require("../lib/conversation-engine-v2/semantic-candidate-contract");
const { validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");

const message = "Is Garden Suite A available on 2026-08-20 for two guests?";
const input = {
  catalog: {
    propertyId: "compiler-property",
    rooms: [{ canonicalId: "garden-suite-a" }],
    amenities: [], policies: [], faqs: []
  },
  sourceEvents: [{ eventId: "event-1", messageRef: "message-1", messageText: message }]
};
const evidenceRefs = [{ eventId: "event-1", messageRef: "message-1", startOffset: 0, endOffset: message.length, quote: message }];

function baseOutput() {
  const refs = evidenceRefs.map((ref) => ({ ...ref }));
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 1 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "2026-08-20", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-20", checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: 2 },
    tasks: [{ candidateIndex: 0, taskId: "availability", type: "availability", sourceText: message, detailIntent: "general", requestedOutputs: ["availability"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true, entity: { category: "room", rawText: "Garden Suite A", canonicalCandidate: "garden-suite-a", confidence: 1 }, stayCandidate: { dateExpression: { rawText: "2026-08-20", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-20", checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: 2 }, confidence: 1 }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: refs }],
    semanticCandidates: [{ semanticKind: "lodging_scope", capability: "availability", canonicalIdentityCandidate: "garden-suite-a", evidenceRefs: refs, lodgingScopeCandidate: { bundleCanonicalCandidate: null, roomCanonicalCandidates: ["garden-suite-a"], guestCountCandidate: 2 }, temporalSemanticCandidate: { rawText: "2026-08-20", kind: "absolute", anchor: "message_time" }, propertyCatalogIdentity: "garden-suite-a" }],
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "availability"
  };
}

function main() {
  const compiled = compileSemanticCandidates(baseOutput(), input);
  assert.match(compiled.semanticCandidates[0].candidateId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "compiler, not Planner, allocates opaque candidate IDs");
  assert.match(compiled.semanticCandidates[0].lodgingScopeCandidate.scopeId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "compiler, not Planner, allocates opaque scope IDs");
  assert.deepEqual(compiled.tasks[0].semanticCandidateIds, [compiled.semanticCandidates[0].candidateId]);
  assert.equal(compiled.tasks[0].lodgingScopeId, compiled.semanticCandidates[0].lodgingScopeCandidate.scopeId);
  assert.equal(validateSemanticCandidates(compiled, input).invalidCandidateIds.length, 0);
  assert.equal(missingSemanticCandidates(compiled, input, compiled.semanticCandidates).length, 0);
  assert.equal(validatePlannerOutput(compiled).ok, true);

  const invalidIdentity = baseOutput();
  invalidIdentity.semanticCandidates[0].propertyCatalogIdentity = "invented-room";
  assert.equal(validateSemanticCandidates(compileSemanticCandidates(invalidIdentity, input), input).invalidCandidateIds.length, 1, "compiler must leave an ungrounded catalog identity for validator fail-closed handling");

  const invalidEvidence = baseOutput();
  invalidEvidence.semanticCandidates[0].evidenceRefs[0] = { ...evidenceRefs[0], quote: "invented evidence" };
  assert.equal(validateSemanticCandidates(compileSemanticCandidates(invalidEvidence, input), input).invalidCandidateIds.length, 1, "compiler must leave source-unverifiable evidence for validator fail-closed handling");

  const multiTask = baseOutput();
  multiTask.tasks.push({ ...multiTask.tasks[0], candidateIndex: 1, taskId: "availability-followup", sourceText: "Is Garden Suite A still available?" });
  multiTask.contextRelationCandidates.push({ candidateIndex: 1, kind: "continue", candidateRequestCycleRefs: ["cycle-1"], evidenceRefs: multiTask.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })) });
  const multiCompiled = compileSemanticCandidates(multiTask, input);
  assert.equal(multiCompiled.tasks.length, 2, "compiler preserves multi-turn task decomposition");
  assert.equal(multiCompiled.contextRelationCandidates[1].kind, "continue", "compiler does not alter context relations");
  assert.equal(multiCompiled.tasks.every((task) => task.semanticCandidateIds.length === 1), true, "compiler establishes task ownership for every compatible task");

  console.log(JSON.stringify({ suite: "semantic-candidate-ledger-compiler", caseCount: 11, passCount: 11, failCount: 0 }));
}

main();
