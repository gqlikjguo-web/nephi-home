"use strict";

const assert = require("node:assert/strict");
const {
  normalizeIgnoredAcknowledgementOutput,
  validatePlannerOutput
} = require("../lib/conversation-engine-v2/planner-schema");

const CANDIDATE_ID = "30000000-0000-4000-8000-000000000001";
const SCOPE_ID = "40000000-0000-4000-8000-000000000001";
const event = {
  eventId: "punctuation-event",
  messageRef: "punctuation-message",
  messageText: "???"
};
const evidenceRefs = [{
  eventId: event.eventId,
  messageRef: event.messageRef,
  startOffset: 0,
  endOffset: event.messageText.length,
  quote: event.messageText
}];
const original = {
  schemaVersion: 2,
  discourse: { relation: "new_request", confidence: 0.91 },
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
    taskId: "punctuation-task",
    type: "unknown",
    sourceText: event.messageText,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    entity: {
      category: "other",
      rawText: event.messageText,
      canonicalCandidate: null,
      confidence: 0.91
    },
    stayCandidate: null,
    semanticCandidateIds: [CANDIDATE_ID],
    lodgingScopeId: SCOPE_ID,
    confidence: 0.91
  }],
  semanticCandidates: [{
    candidateId: CANDIDATE_ID,
    semanticKind: "lodging_scope",
    capability: "unknown",
    canonicalIdentityCandidate: null,
    evidenceRefs,
    lodgingScopeCandidate: {
      scopeId: SCOPE_ID,
      bundleCanonicalCandidate: null,
      roomCanonicalCandidates: [],
      guestCountCandidate: null
    },
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: null
  }],
  contextRelationCandidates: [{
    candidateIndex: 0,
    kind: "new_request",
    candidateRequestCycleRefs: [],
    evidenceRefs
  }],
  ambiguities: [],
  missingInformation: [],
  needsHuman: false,
  shouldIgnore: false,
  reason: "punctuation normalization fixture"
};

const before = JSON.parse(JSON.stringify(original));
const normalized = normalizeIgnoredAcknowledgementOutput(original, {
  sourceEvents: [event]
});

assert.equal(validatePlannerOutput(before).ok, true, "the regression fixture must start as a valid new-schema Planner output");
assert.equal(validatePlannerOutput(normalized).ok, true, "punctuation normalization must not regress to a legacy schema shape");
assert.equal(normalized.tasks.length, 1, "normalization must not add or delete semantic tasks");
assert.equal(normalized.tasks[0].taskId, before.tasks[0].taskId, "task identity must remain stable");
assert.equal(normalized.tasks[0].candidateIndex, before.tasks[0].candidateIndex, "candidate identity must remain stable");
assert.deepEqual(normalized.tasks[0].semanticCandidateIds, before.tasks[0].semanticCandidateIds, "candidate ownership must remain stable");
assert.equal(normalized.tasks[0].lodgingScopeId, before.tasks[0].lodgingScopeId, "lodging ownership must remain stable");
assert.deepEqual(normalized.semanticCandidates, before.semanticCandidates, "semantic ledger and provenance must remain byte-for-byte stable");
assert.deepEqual(normalized.contextRelationCandidates, before.contextRelationCandidates, "context relation and evidence ownership must remain stable");
assert.equal(normalized.tasks[0].type, "unknown", "pure punctuation must not become a substantive task");
assert.equal(normalized.shouldIgnore, true, "pure punctuation must remain fail-closed");
assert.equal(normalized.needsHuman, false, "pure punctuation must not enter handoff");

for (const symbol of ["?", "???"]) {
  const symbolEvent = { ...event, messageText: symbol };
  const symbolOutput = JSON.parse(JSON.stringify(before));
  symbolOutput.tasks[0].sourceText = symbol;
  symbolOutput.tasks[0].entity.rawText = symbol;
  symbolOutput.semanticCandidates[0].evidenceRefs[0].quote = symbol;
  symbolOutput.semanticCandidates[0].evidenceRefs[0].endOffset = symbol.length;
  symbolOutput.contextRelationCandidates[0].evidenceRefs[0].quote = symbol;
  symbolOutput.contextRelationCandidates[0].evidenceRefs[0].endOffset = symbol.length;
  const result = normalizeIgnoredAcknowledgementOutput(symbolOutput, { sourceEvents: [symbolEvent] });
  assert.equal(result.tasks.some((item) => item.type !== "unknown"), false, "Unicode symbols must not produce a substantive task");
  assert.equal(result.shouldIgnore, true);
  assert.equal(result.needsHuman, false);
}

console.log("planner normalizer semantic preservation: PASS");
