"use strict";

const assert = require("node:assert/strict");
const { buildFormalRequest, buildQueryPlan } = require("../lib/conversation-engine-v2/formal-request");

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

const missing = formal({ temporalResult: { resolutionStatus: "absent", checkIn: null, checkOut: null, nights: null, searchRange: null, fields: {} }, confirmedInputs: { ...conditions, stay: { ...conditions.stay, checkIn: null, checkOut: null } } });
assert.equal(missing.readiness.status, "missing_information");
assert.equal(buildQueryPlan(missing), null);

const invalid = formal({ temporalResult: { resolutionStatus: "invalid", checkIn: "2026-02-30", checkOut: null, nights: null, searchRange: null, fields: {} }, confirmedInputs: { ...conditions, stay: { ...conditions.stay, checkIn: null, checkOut: null } } });
assert.equal(invalid.readiness.status, "invalid");
assert.equal(buildQueryPlan(invalid), null);

const conflicting = formal({ temporalResult: { resolutionStatus: "conflicting", checkIn: "2026-08-07", checkOut: "2026-08-06", nights: null, searchRange: null, fields: {} } });
assert.equal(conflicting.readiness.status, "conflicting");
assert.equal(buildQueryPlan(conflicting), null);

const unresolvedEntity = formal({ resolvedEntity: { status: "ambiguous", candidates: [] } });
assert.equal(unresolvedEntity.readiness.status, "entity_unresolved");
assert.equal(buildQueryPlan(unresolvedEntity), null);

const generic = formal({ task: { entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 } }, resolvedEntity: null, confirmedInputs: { ...conditions, inventory: { ...conditions.inventory, mode: "any", entityId: null } } });
assert.equal(generic.readiness.status, "ready");
assert.equal(buildQueryPlan(generic).conditions.inventory.mode, "any");

console.log("phase5 formal request: PASS");
