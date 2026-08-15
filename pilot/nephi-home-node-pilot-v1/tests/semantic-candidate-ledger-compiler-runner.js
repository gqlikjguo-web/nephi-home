"use strict";

const assert = require("node:assert/strict");
const { compileSemanticCandidates, validateSemanticCandidates, missingSemanticCandidates, verifiedRepairTask } = require("../lib/conversation-engine-v2/semantic-candidate-contract");
const { applyPlannerSemanticContract, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");

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
    semanticCandidates: [{ semanticKind: "lodging_scope", capability: "availability", canonicalIdentityCandidate: "garden-suite-a", provenanceRelationCandidateIndexes: [0], evidenceRefs: refs.map((ref) => ({ ...ref })), lodgingScopeCandidate: { bundleCanonicalCandidate: null, roomCanonicalCandidates: ["garden-suite-a"], guestCountCandidate: 2 }, temporalSemanticCandidate: { rawText: "2026-08-20", kind: "absolute", anchor: "message_time" }, propertyCatalogIdentity: "garden-suite-a" }],
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
  const provenanceCompiled = compileSemanticCandidates(invalidEvidence, input);
  assert.deepEqual(provenanceCompiled.semanticCandidates[0].evidenceRefs, evidenceRefs, "compiler must replace model coordinates only with the explicitly referenced verified relation evidence");
  assert.equal(validateSemanticCandidates(provenanceCompiled, input).invalidCandidateIds.length, 0, "verified provenance must preserve strict source validation");

  const misclassifiedPending = baseOutput();
  misclassifiedPending.semanticCandidates[0].coverageStatus = "pending_task";
  misclassifiedPending.semanticCandidates[0].provenanceRelationCandidateIndexes = [];
  misclassifiedPending.semanticCandidates[0].evidenceRefs = [{
    ...evidenceRefs[0],
    endOffset: message.length + 5,
    quote: "model coordinate drift"
  }];
  const controlledOwnership = compileSemanticCandidates(misclassifiedPending, input);
  assert.deepEqual(controlledOwnership.semanticCandidates[0].evidenceRefs, evidenceRefs, "one compatible task with one verified relation must supply bound evidence even when the model mislabels lifecycle and coordinates");
  assert.deepEqual(controlledOwnership.tasks[0].semanticCandidateIds, [controlledOwnership.semanticCandidates[0].candidateId], "controlled lifecycle must bind the uniquely proven candidate to its existing task");
  assert.equal(validateSemanticCandidates(controlledOwnership, input).invalidCandidateIds.length, 0, "controlled bound ownership must remain structurally valid");

  const ambiguousPendingOwnership = structuredClone(misclassifiedPending);
  ambiguousPendingOwnership.tasks.push({ ...ambiguousPendingOwnership.tasks[0], candidateIndex: 1, taskId: "availability-ambiguous" });
  ambiguousPendingOwnership.contextRelationCandidates.push({ ...ambiguousPendingOwnership.contextRelationCandidates[0], candidateIndex: 1 });
  const ambiguousPendingCompiled = compileSemanticCandidates(ambiguousPendingOwnership, input);
  assert.equal(validateSemanticCandidates(ambiguousPendingCompiled, input).invalidCandidateIds.length, 1, "multiple compatible verified relations must remain fail-closed instead of guessing ownership");
  assert.equal(ambiguousPendingCompiled.tasks.every((task) => task.semanticCandidateIds.length === 0), true, "ambiguous lifecycle ownership must not bind either task");

  const invalidRelationPending = structuredClone(misclassifiedPending);
  invalidRelationPending.contextRelationCandidates[0].evidenceRefs[0].quote = "invalid relation evidence";
  const invalidRelationPendingCompiled = compileSemanticCandidates(invalidRelationPending, input);
  assert.equal(validateSemanticCandidates(invalidRelationPendingCompiled, input).invalidCandidateIds.length, 1, "an invalid relation must not authorize lifecycle ownership");
  assert.deepEqual(invalidRelationPendingCompiled.tasks[0].semanticCandidateIds, [], "invalid relation evidence must remain unowned");

  const missingProvenance = baseOutput();
  delete missingProvenance.semanticCandidates[0].provenanceRelationCandidateIndexes;
  assert.equal(validateSemanticCandidates(compileSemanticCandidates(missingProvenance, input), input).invalidCandidateIds.length, 1, "missing provenance must remain fail-closed");
  const unknownProvenance = baseOutput();
  unknownProvenance.semanticCandidates[0].provenanceRelationCandidateIndexes = [99];
  assert.equal(validateSemanticCandidates(compileSemanticCandidates(unknownProvenance, input), input).invalidCandidateIds.length, 1, "unknown provenance must remain fail-closed");

  const multiTask = baseOutput();
  multiTask.tasks.push({ ...multiTask.tasks[0], candidateIndex: 1, taskId: "policy-followup", type: "policy", sourceText: message });
  multiTask.contextRelationCandidates.push({ candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: multiTask.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })) });
  multiTask.semanticCandidates.push({ semanticKind: "capability", capability: "policy", canonicalIdentityCandidate: "policy", provenanceRelationCandidateIndexes: [1], evidenceRefs: [], lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: null });
  const multiCompiled = compileSemanticCandidates(multiTask, input);
  assert.equal(multiCompiled.tasks.length, 2, "compiler preserves multi-turn task decomposition");
  assert.equal(multiCompiled.contextRelationCandidates[1].kind, "new_request", "compiler does not alter context relations");
  assert.equal(multiCompiled.tasks.every((task) => task.semanticCandidateIds.length === 1), true, "compiler establishes task ownership for every compatible task");

  const pendingSource = baseOutput();
  pendingSource.semanticCandidates[0].coverageStatus = "pending_task";
  delete pendingSource.semanticCandidates[0].provenanceRelationCandidateIndexes;
  pendingSource.tasks.push({ ...pendingSource.tasks[0], candidateIndex: 1, taskId: "availability-alternative" });
  pendingSource.contextRelationCandidates.push({ ...pendingSource.contextRelationCandidates[0], candidateIndex: 1 });
  const compiledPending = compileSemanticCandidates(pendingSource, input);
  const repairWithoutCanonicalization = compileSemanticCandidates(baseOutput(), input);
  assert.equal(verifiedRepairTask(repairWithoutCanonicalization, input, compiledPending.semanticCandidates[0]), null, "semantic repair must fail closed when canonicalization handoff is missing");
  Object.defineProperty(repairWithoutCanonicalization, "repairCanonicalizationResult", { value: Object.freeze([Object.freeze({
    taskId: repairWithoutCanonicalization.tasks[0].taskId,
    candidateId: repairWithoutCanonicalization.semanticCandidates[0].candidateId,
    unique: false,
    canonicalIdentity: null
  })]) });
  assert.equal(verifiedRepairTask(repairWithoutCanonicalization, input, compiledPending.semanticCandidates[0]), null, "ambiguous canonicalization must not authorize pending-to-bound repair");
  const uniquelyCanonicalized = compileSemanticCandidates(baseOutput(), input);
  Object.defineProperty(uniquelyCanonicalized, "repairCanonicalizationResult", { value: Object.freeze([Object.freeze({
    taskId: uniquelyCanonicalized.tasks[0].taskId,
    candidateId: uniquelyCanonicalized.semanticCandidates[0].candidateId,
    unique: true,
    canonicalIdentity: "garden-suite-a"
  })]) });
  assert.equal(Boolean(verifiedRepairTask(uniquelyCanonicalized, input, compiledPending.semanticCandidates[0])), true, "one immutable unique task/candidate canonicalization may authorize repair");
  assert.equal(Object.isFrozen(uniquelyCanonicalized.repairCanonicalizationResult) && Object.isFrozen(uniquelyCanonicalized.repairCanonicalizationResult[0]), true, "canonicalization handoff must be immutable");

  const groupedPendingSource = baseOutput();
  groupedPendingSource.semanticCandidates = [{
    ...groupedPendingSource.semanticCandidates[0],
    semanticKind: "catalog_subject",
    coverageStatus: "pending_task",
    lodgingScopeCandidate: null
  }, {
    semanticKind: "temporal_pattern",
    capability: "availability",
    canonicalIdentityCandidate: "temporal_pattern",
    coverageStatus: "pending_task",
    evidenceRefs: evidenceRefs.map((ref) => ({ ...ref })),
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: { rawText: "2026-08-20", kind: "absolute", anchor: "message_time" },
    propertyCatalogIdentity: null
  }];
  groupedPendingSource.semanticCandidates.forEach((candidate) => { delete candidate.provenanceRelationCandidateIndexes; });
  groupedPendingSource.tasks.push({ ...groupedPendingSource.tasks[0], candidateIndex: 1, taskId: "availability-group-alternative" });
  groupedPendingSource.contextRelationCandidates.push({ ...groupedPendingSource.contextRelationCandidates[0], candidateIndex: 1 });
  const groupedPending = compileSemanticCandidates(groupedPendingSource, input);
  const groupedRepairSource = baseOutput();
  groupedRepairSource.semanticCandidates = groupedPendingSource.semanticCandidates.map((candidate) => ({
    ...candidate,
    coverageStatus: "bound",
    provenanceRelationCandidateIndexes: [0]
  }));
  const groupedRepair = compileSemanticCandidates(groupedRepairSource, input);
  assert.equal(groupedRepair.tasks[0].semanticCandidateIds.length, 2, "one verified repair task may own multiple compatible semantic candidates");
  Object.defineProperty(groupedRepair, "repairCanonicalizationResult", { value: Object.freeze(groupedRepair.semanticCandidates.map((candidate) => Object.freeze({
    taskId: groupedRepair.tasks[0].taskId,
    candidateId: candidate.candidateId,
    unique: true,
    canonicalIdentity: candidate.semanticKind === "temporal_pattern" ? "temporal_pattern" : "garden-suite-a"
  }))) });
  assert.equal(groupedPending.semanticCandidates.every((candidate) => Boolean(verifiedRepairTask(groupedRepair, input, candidate))), true, "each uniquely canonicalized candidate in one repair task must retain lifecycle continuity");
  const inconsistentTemporalRepair = compileSemanticCandidates(groupedRepairSource, input);
  Object.defineProperty(inconsistentTemporalRepair, "repairCanonicalizationResult", { value: Object.freeze(inconsistentTemporalRepair.semanticCandidates.map((candidate) => Object.freeze({
    taskId: inconsistentTemporalRepair.tasks[0].taskId,
    candidateId: candidate.candidateId,
    unique: true,
    canonicalIdentity: "garden-suite-a"
  }))) });
  assert.equal(verifiedRepairTask(inconsistentTemporalRepair, input, groupedPending.semanticCandidates.find((candidate) => candidate.semanticKind === "temporal_pattern")), null, "a temporal candidate must reject a room identity even when the mapping is marked unique");

  const bundleMessage = "Whole House with Room A and Room B for five guests";
  const bundleInput = {
    catalog: {
      propertyId: "bundle-property",
      rooms: [
        { canonicalId: "whole-house", inventoryType: "bundle", capacity: 8, memberRoomIds: ["room-a", "room-b", "room-c"] },
        { canonicalId: "room-a", inventoryType: "room", capacity: 2 },
        { canonicalId: "room-b", inventoryType: "room", capacity: 2 },
        { canonicalId: "room-c", inventoryType: "room", capacity: 2 },
        { canonicalId: "unrelated-room", inventoryType: "room", capacity: 2 }
      ], amenities: [], policies: [], faqs: []
    },
    sourceEvents: [{ eventId: "bundle-event", messageRef: "bundle-message", messageText: bundleMessage }]
  };
  const bundleEvidence = [{ eventId: "bundle-event", messageRef: "bundle-message", startOffset: 0, endOffset: bundleMessage.length, quote: bundleMessage }];
  const bundleStay = { dateExpression: { rawText: "2026-08-27", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-27", checkOutCandidate: "2026-08-28", nightsCandidate: 1, guestCountCandidate: 5 };
  const bundleScopeOutput = {
    ...baseOutput(),
    stay: bundleStay,
    tasks: [
      { ...baseOutput().tasks[0], candidateIndex: 0, taskId: "bundle", type: "bundle_availability", entity: { category: "bundle", rawText: "Whole House", canonicalCandidate: "whole-house", confidence: 1 }, stayCandidate: bundleStay },
      { ...baseOutput().tasks[0], candidateIndex: 1, taskId: "room-a", entity: { category: "room", rawText: "Room A", canonicalCandidate: "room-a", confidence: 1 }, stayCandidate: bundleStay },
      { ...baseOutput().tasks[0], candidateIndex: 2, taskId: "room-b", entity: { category: "room", rawText: "Room B", canonicalCandidate: "room-b", confidence: 1 }, stayCandidate: bundleStay }
    ],
    contextRelationCandidates: [0, 1, 2].map((candidateIndex) => ({ candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: bundleEvidence })),
    semanticCandidates: [
      { semanticKind: "lodging_scope", capability: "bundle_availability", canonicalIdentityCandidate: "whole-house", provenanceRelationCandidateIndexes: [0], lodgingScopeCandidate: { bundleCanonicalCandidate: "whole-house", roomCanonicalCandidates: [], guestCountCandidate: 5 }, temporalSemanticCandidate: bundleStay.dateExpression, propertyCatalogIdentity: "whole-house" },
      { semanticKind: "lodging_scope", capability: "availability", canonicalIdentityCandidate: "room-a", provenanceRelationCandidateIndexes: [1], lodgingScopeCandidate: { bundleCanonicalCandidate: null, roomCanonicalCandidates: ["room-a"], guestCountCandidate: 5 }, temporalSemanticCandidate: bundleStay.dateExpression, propertyCatalogIdentity: "room-a" },
      { semanticKind: "lodging_scope", capability: "availability", canonicalIdentityCandidate: "room-b", provenanceRelationCandidateIndexes: [2], lodgingScopeCandidate: { bundleCanonicalCandidate: null, roomCanonicalCandidates: ["room-b"], guestCountCandidate: 5 }, temporalSemanticCandidate: bundleStay.dateExpression, propertyCatalogIdentity: "room-b" }
    ]
  };
  const unifiedBundleScope = compileSemanticCandidates(bundleScopeOutput, bundleInput);
  assert.equal(new Set(unifiedBundleScope.tasks.map((item) => item.lodgingScopeId)).size, 1, "one source-bound bundle request and its catalog-proven member rooms must compile to one logical lodging scope");
  assert.deepEqual(unifiedBundleScope.semanticCandidates[0].lodgingScopeCandidate.roomCanonicalCandidates, ["room-a", "room-b"], "the unified scope must retain explicitly requested member-room constraints");
  assert.equal(validateSemanticCandidates(unifiedBundleScope, bundleInput).invalidCandidateIds.length, 0, "a bundle scope fully proven by one catalog product remains executable");

  const conflictingBundleScope = structuredClone(unifiedBundleScope);
  conflictingBundleScope.semanticCandidates[0].lodgingScopeCandidate.roomCanonicalCandidates = ["room-a", "unrelated-room"];
  const conflictingBundleValidation = validateSemanticCandidates(conflictingBundleScope, bundleInput);
  assert.equal(conflictingBundleValidation.invalidCandidateIds.includes(conflictingBundleScope.semanticCandidates[0].candidateId), true, "a bundle scope containing a non-member room must fail closed");
  assert.ok(conflictingBundleValidation.invalidFailureCodes.includes("lodging_scope_catalog_conflict"), "catalog-incompatible lodging constraints must expose the structural failure code");

  const overCapacityBundleScope = structuredClone(unifiedBundleScope);
  overCapacityBundleScope.semanticCandidates[0].lodgingScopeCandidate.guestCountCandidate = 9;
  assert.equal(validateSemanticCandidates(overCapacityBundleScope, bundleInput).invalidCandidateIds.includes(overCapacityBundleScope.semanticCandidates[0].candidateId), true, "a guest constraint beyond the formal bundle capacity must fail closed");

  const unrelatedScopeOutput = structuredClone(bundleScopeOutput);
  unrelatedScopeOutput.tasks[2].entity = { category: "room", rawText: "Unrelated Room", canonicalCandidate: "unrelated-room", confidence: 1 };
  unrelatedScopeOutput.semanticCandidates[2].canonicalIdentityCandidate = "unrelated-room";
  unrelatedScopeOutput.semanticCandidates[2].propertyCatalogIdentity = "unrelated-room";
  unrelatedScopeOutput.semanticCandidates[2].lodgingScopeCandidate.roomCanonicalCandidates = ["unrelated-room"];
  const isolatedUnrelatedScope = compileSemanticCandidates(unrelatedScopeOutput, bundleInput);
  assert.ok(new Set(isolatedUnrelatedScope.tasks.map((item) => item.lodgingScopeId)).size > 1, "a non-member room must remain isolated from a bundle scope");

  const distinctGuestScopeOutput = structuredClone(bundleScopeOutput);
  distinctGuestScopeOutput.tasks[2].stayCandidate.guestCountCandidate = 6;
  distinctGuestScopeOutput.semanticCandidates[2].lodgingScopeCandidate.guestCountCandidate = 6;
  const isolatedDistinctGuestScope = compileSemanticCandidates(distinctGuestScopeOutput, bundleInput);
  assert.ok(new Set(isolatedDistinctGuestScope.tasks.map((item) => item.lodgingScopeId)).size > 1, "catalog membership must not merge lodging requests with distinct guest constraints");

  const inventedCapabilityPendingSource = baseOutput();
  inventedCapabilityPendingSource.semanticCandidates = [{
    semanticKind: "capability",
    capability: "availability",
    canonicalIdentityCandidate: "invented-capability-identity",
    coverageStatus: "pending_task",
    evidenceRefs: evidenceRefs.map((ref) => ({ ...ref })),
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: null
  }];
  const inventedCapabilityPending = compileSemanticCandidates(inventedCapabilityPendingSource, input);
  const inventedCapabilityRepairSource = baseOutput();
  inventedCapabilityRepairSource.semanticCandidates = [{
    ...inventedCapabilityPendingSource.semanticCandidates[0],
    coverageStatus: "bound",
    provenanceRelationCandidateIndexes: [0]
  }];
  const inventedCapabilityRepair = compileSemanticCandidates(inventedCapabilityRepairSource, input);
  const authoritativeCapabilityRepair = applyPlannerSemanticContract(inventedCapabilityRepair, { catalog: input.catalog, sourceEvents: input.sourceEvents });
  assert.equal(verifiedRepairTask(authoritativeCapabilityRepair, input, inventedCapabilityPending.semanticCandidates[0]), null, "canonicalization authority must reject a Planner-invented capability identity");

  console.log(JSON.stringify({ suite: "semantic-candidate-ledger-compiler", caseCount: 22, passCount: 22, failCount: 0 }));
}

main();
