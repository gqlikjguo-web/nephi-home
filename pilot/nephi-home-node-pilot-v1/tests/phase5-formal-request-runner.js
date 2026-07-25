"use strict";

const assert = require("node:assert/strict");
const { buildFormalRequest, buildQueryPlan, resultForNotReady } = require("../lib/conversation-engine-v2/formal-request");

const property = { propertyId: "phase5-property" };
const roomTask = {
  taskId: "room-a", candidateIndex: 0, type: "availability", requestedOutputs: ["answer"],
  dependsOnStayContext: true,
  entity: { category: "room", rawText: "Room A", canonicalCandidate: "room-a", confidence: 1 }
};
const resolvedRoom = { status: "resolved", entity: { category: "room", canonicalId: "room-a", canonicalSet: ["room-a"] } };
const resolvedTemporal = { resolutionStatus: "resolved", checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, searchRange: null, fields: {} };
const conditions = { stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, guests: 2, searchRange: null }, inventory: { mode: "room_only", entityId: "room-a", entityIds: [], features: [] }, topic: {} };

function formal(overrides = {}) {
  return buildFormalRequest({ property, task: { ...roomTask, ...(overrides.task || {}) }, requestCycleId: "cycle-a", temporalResult: overrides.temporalResult || resolvedTemporal, confirmedInputs: overrides.confirmedInputs || conditions, resolvedEntity: overrides.resolvedEntity === undefined ? resolvedRoom : overrides.resolvedEntity, sourceEvidenceRefs: [{ eventId: "event-a", startOffset: 0, endOffset: 1, quote: "A" }] });
}

const ready = formal();
assert.equal(ready.readiness.status, "ready");
assert.equal(ready.propertyId, property.propertyId);
assert.equal(ready.candidateIndex, 0);
assert.equal(ready.requestCycleId, "cycle-a");
const plan = buildQueryPlan(ready);
assert.ok(plan, "a ready FormalRequest must produce one QueryPlan");
assert.equal(plan.formalRequestId, ready.formalRequestId);
assert.equal(plan.operation, "availability");
assert.equal(plan.conditions.stay.checkIn, ready.stay.checkIn);

const propertyTask = {
  taskId: "policy-detail", candidateIndex: 1, type: "policy", detailIntent: "early_arrival_policy",
  requestedOutputs: ["early_arrival_policy"], dependsOnStayContext: false,
  entity: { category: "policy", rawText: "arrival", canonicalCandidate: "check_in", confidence: 1 }
};
const propertyFormal = buildFormalRequest({
  property, task: propertyTask, requestCycleId: "cycle-policy",
  temporalResult: { resolutionStatus: "not_applicable", fields: {} },
  confirmedInputs: { ...conditions, topic: { capabilityType: "policy", canonicalId: "check_in", category: "policy", detailIntent: "general" } },
  resolvedEntity: { status: "resolved", entity: { category: "policy", canonicalId: "check_in", publicName: "Check-in", status: "confirmed_yes", answer: "15:00" } }
});
assert.equal(propertyFormal.detailIntent, "early_arrival_policy");
assert.deepEqual(propertyFormal.requestedOutputs, ["early_arrival_policy"]);
const propertyPlan = buildQueryPlan(propertyFormal);
assert.equal(propertyPlan.detailIntent, "early_arrival_policy");
assert.deepEqual(propertyPlan.expectedOutputs, ["early_arrival_policy"]);

const missing = formal({ temporalResult: { resolutionStatus: "absent", checkIn: null, checkOut: null, nights: null, searchRange: null, fields: {} }, confirmedInputs: { ...conditions, stay: { ...conditions.stay, checkIn: null, checkOut: null } } });
assert.equal(missing.readiness.status, "missing_information");
assert.equal(buildQueryPlan(missing), null);
assert.deepEqual(resultForNotReady(missing), {
  taskId: "room-a", type: "availability", formalRequestId: missing.formalRequestId, requestCycleId: "cycle-a",
  outcome: "not_ready", readinessStatus: "missing_information", missingFields: ["stay.checkIn"], invalidFields: [], conflictingFields: [], facts: {}, resolverAttempted: false
});

const invalid = formal({ temporalResult: { resolutionStatus: "invalid", checkIn: "2026-02-30", checkOut: null, nights: null, searchRange: null, fields: {} }, confirmedInputs: { ...conditions, stay: { ...conditions.stay, checkIn: null, checkOut: null } } });
assert.equal(invalid.readiness.status, "invalid");
assert.equal(buildQueryPlan(invalid), null);
assert.equal(resultForNotReady(invalid).outcome, "not_ready");
assert.equal(resultForNotReady(invalid).readinessStatus, "invalid");

const conflicting = formal({ temporalResult: { resolutionStatus: "conflicting", checkIn: "2026-08-07", checkOut: "2026-08-06", nights: null, searchRange: null, fields: {} } });
assert.equal(conflicting.readiness.status, "conflicting");
assert.equal(buildQueryPlan(conflicting), null);
assert.equal(resultForNotReady(conflicting).readinessStatus, "conflicting");

const unresolvedEntity = formal({ resolvedEntity: { status: "ambiguous", candidates: [] } });
assert.equal(unresolvedEntity.readiness.status, "entity_unresolved");
assert.equal(buildQueryPlan(unresolvedEntity), null);
assert.equal(resultForNotReady(unresolvedEntity).readinessStatus, "entity_unresolved");

const generic = formal({ task: { entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 } }, resolvedEntity: null, confirmedInputs: { ...conditions, inventory: { ...conditions.inventory, mode: "any", entityId: null } } });
assert.equal(generic.readiness.status, "ready");
assert.equal(buildQueryPlan(generic).conditions.inventory.mode, "any");

console.log("phase5 formal request: PASS");
