"use strict";

const assert = require("node:assert/strict");
const { compileSemanticCandidates, validateSemanticCandidates } = require("../lib/conversation-engine-v2/semantic-candidate-contract");
const { evidenceMatchesSource, sourceEventMaps } = require("../lib/conversation-engine-v2/understanding-validator");

const sourceEvents = [
  { eventId: "zh", messageRef: "zh-message", messageText: "想問價格" },
  { eventId: "policy", messageRef: "policy-message", messageText: "最晚幾點入住" }
];
const refs = [
  [{ eventId: "zh", messageRef: "zh-message", startOffset: 0, endOffset: "想問價格".length, quote: "想問價格" }],
  [{ eventId: "policy", messageRef: "policy-message", startOffset: 0, endOffset: "最晚幾點入住".length, quote: "最晚幾點入住" }]
];
const input = { sourceEvents, catalog: { propertyId: "p", rooms: [], amenities: [], policies: [], faqs: [], propertyFacts: [], transportFacts: [] }, contextSnapshot: { scope: {}, cycles: [] } };
const task = (candidateIndex, type) => ({ candidateIndex, taskId: `${type}-${candidateIndex}`, type, sourceText: sourceEvents[candidateIndex].messageText, detailIntent: "general", requestedOutputs: [type === "price" ? "price" : "answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: false, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, stayCandidate: null, confidence: 1 });
const relation = (candidateIndex) => ({ candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: refs[candidateIndex].map((ref) => ({ ...ref })) });
const candidate = (capability, provenance) => ({ semanticKind: "capability", capability, canonicalIdentityCandidate: capability, provenanceRelationCandidateIndexes: provenance, evidenceRefs: [{ eventId: "bad", messageRef: "", startOffset: 0, endOffset: 999, quote: "bad" }], lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: null });
const output = (provenance = [[0], [1]]) => ({ schemaVersion: 2, discourse: { relation: "new_request", confidence: 1 }, stateOperations: [], stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, tasks: [task(0, "price"), task(1, "policy")], contextRelationCandidates: [relation(0), relation(1)], semanticCandidates: [candidate("price", provenance[0]), candidate("policy", provenance[1])], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "test" });

const compiled = compileSemanticCandidates(output(), input);
assert.equal(validateSemanticCandidates(compiled, input).invalidCandidateIds.length, 0);
assert.deepEqual(compiled.semanticCandidates.map((item) => item.evidenceRefs), refs);
assert.deepEqual(compiled.tasks.map((item) => item.semanticCandidateIds.length), [1, 1]);
assert.equal(compiled.semanticCandidates.every((item) => item.evidenceRefs.every((ref) => evidenceMatchesSource(ref, sourceEventMaps(sourceEvents)))), true);
const sharedEvidence = output([[0], [1]]);
sharedEvidence.tasks[1] = task(1, "price");
sharedEvidence.contextRelationCandidates[1] = { ...relation(1), evidenceRefs: refs[0].map((ref) => ({ ...ref })) };
sharedEvidence.semanticCandidates[1] = candidate("price", [1]);
const sharedCompiled = compileSemanticCandidates(sharedEvidence, input);
assert.notEqual(sharedCompiled.semanticCandidates[0].candidateId, sharedCompiled.semanticCandidates[1].candidateId, "same semantic payload and evidence must remain distinct when verified provenance differs");
assert.deepEqual(sharedCompiled.tasks.map((item) => item.semanticCandidateIds.length), [1, 1]);
const crossBound = compileSemanticCandidates(output([[0], [0]]), input);
assert.deepEqual(crossBound.tasks.map((item) => item.semanticCandidateIds.length), [1, 0], "a verified source span for task 0 must not bind a policy candidate to task 1");
for (const provenance of [[[0, 0], [1]], [undefined, [1]], [[], [1]], [[2], [1]]]) {
  const rejected = compileSemanticCandidates(output(provenance), input);
  assert.equal(validateSemanticCandidates(rejected, input).invalidCandidateIds.length > 0, true, "ambiguous, missing, or unknown provenance must fail closed");
}
console.log(JSON.stringify({ suite: "semantic-candidate-provenance", caseCount: 13, passCount: 13, failCount: 0 }));
