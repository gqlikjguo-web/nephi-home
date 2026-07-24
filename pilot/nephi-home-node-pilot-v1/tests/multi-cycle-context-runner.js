"use strict";

const assert = require("node:assert/strict");

const { createPendingRequest } = require("../lib/conversation-engine-v2/pending-request");
const { buildContextSnapshot } = require("../lib/conversation-engine-v2/contracts");
const { emptyStateV2, migrateStateV2, reduceConversationState, decideContextExecution } = require("../lib/conversation-engine-v2/state-reducer");

const scope = { propertyId: "multi-property", channelId: "multi-channel", lineUserId: "multi-user", now: "2026-07-24T00:00:00.000Z", eventId: "multi-event" };
const task = (candidateIndex, taskId, canonicalCandidate) => ({ candidateIndex, taskId, type: "policy", sourceText: taskId, detailIntent: "general", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "policy", rawText: taskId, canonicalCandidate, confidence: 1 }, confidence: 1 });
const relation = (candidateIndex, stateAction, requestCycleId = null) => ({ candidateIndex, stateAction, requestCycleId });
const decision = (candidateIndex, action, requestCycleId = null) => ({ candidateIndex, action, requestCycleId });
const inputs = (checkIn, roomType, guests) => ({ stay: { checkIn, checkOut: null, nights: 1, guests, searchRange: null }, inventory: { mode: "room_only", entityId: roomType, features: [] }, topic: { capabilityType: "policy", canonicalId: roomType, category: "policy", detailIntent: "general", detailFields: ["answer"] } });

function legacyState() {
  const state = emptyStateV2(scope);
  state.conditions = inputs("2026-08-06", "room-a", 2);
  state.contextCycle = { requestCycleId: "legacy-cycle", requestKind: "availability", status: "answered", confirmedInputs: state.conditions, contextReuseExpiresAt: "2026-07-25T00:00:00.000Z" };
  state.pendingRequest = createPendingRequest({ tasks: [task(0, "legacy-task", "room-a")], conditions: state.conditions, missingFields: ["stay.guests"], clarificationTarget: "stay.guests", scope: { pendingRequestId: "legacy-pending", requestCycleId: "legacy-cycle", eventId: "legacy-event", now: scope.now, expiresAt: "2026-07-25T00:00:00.000Z" } });
  return state;
}

function main() {
  const migrated = migrateStateV2(legacyState(), scope);
  assert.deepEqual(migrated.requestCycles.map((cycle) => cycle.requestCycleId), ["legacy-cycle"], "legacy single contextCycle must migrate mechanically into requestCycles");
  assert.deepEqual(migrated.pendingRequests.map((pending) => pending.pendingRequestId), ["legacy-pending"], "legacy single pendingRequest must migrate mechanically into pendingRequests");
  assert.equal(Object.hasOwn(migrated, "contextCycle"), false, "migrated state must not retain a second context authority");
  assert.equal(Object.hasOwn(migrated, "pendingRequest"), false, "migrated state must not retain a second pending authority");

  const started = reduceConversationState(emptyStateV2(scope), {
    contextDecisions: [decision(0, "start", "cycle-a"), decision(1, "start", "cycle-b")],
    tasks: [task(0, "task-a", "room-a"), task(1, "task-b", "room-b")],
    cycleInputsByCandidateIndex: { 0: inputs("2026-08-06", "room-a", 2), 1: inputs("2026-08-10", "room-b", 4) }
  }, scope);
  assert.deepEqual(started.requestCycles.map((cycle) => cycle.requestCycleId), ["cycle-a", "cycle-b"], "one turn may create two independent request cycles");
  assert.equal(started.requestCycles[0].confirmedInputs.stay.checkIn, "2026-08-06");
  assert.equal(started.requestCycles[1].confirmedInputs.stay.checkIn, "2026-08-10");
  assert.equal(started.requestCycles[0].confirmedInputs.inventory.entityId, "room-a");
  assert.equal(started.requestCycles[1].confirmedInputs.inventory.entityId, "room-b");

  const pendingA = createPendingRequest({ tasks: [task(0, "pending-a", "room-a")], conditions: started.requestCycles[0].confirmedInputs, missingFields: ["stay.guests"], clarificationTarget: "stay.guests", scope: { pendingRequestId: "pending-a", requestCycleId: "cycle-a", eventId: "a", now: scope.now, expiresAt: "2026-07-25T00:00:00.000Z" } });
  const multi = { ...started, pendingRequests: [pendingA] };
  const execution = decideContextExecution(multi, [relation(0, "start", "cycle-c")], [task(0, "task-c", "room-c")]);
  assert.equal(execution.resumedPending, false, "an unrelated new request must not resume dormant pending work");
  assert.deepEqual(execution.executionTasks.map((item) => item.taskId), ["task-c"], "dormant pending must not enter an unrelated response");
  const afterNew = reduceConversationState(multi, { contextDecisions: execution.contextDecisions, tasks: [task(0, "task-c", "room-c")], cycleInputsByCandidateIndex: { 0: inputs("2026-08-12", "room-c", 3) } }, { ...scope, eventId: "new-event" });
  assert.deepEqual(afterNew.pendingRequests.map((pending) => pending.pendingRequestId), ["pending-a"], "new work must not clear an unrelated pending request");

  const continued = reduceConversationState(afterNew, { contextDecisions: [decision(0, "continue", "cycle-b")], tasks: [task(0, "task-b-followup", "room-b")], cycleInputsByCandidateIndex: { 0: inputs("2026-08-10", "room-b", 5) } }, { ...scope, eventId: "continue-b" });
  const cycleA = continued.requestCycles.find((cycle) => cycle.requestCycleId === "cycle-a");
  const cycleB = continued.requestCycles.find((cycle) => cycle.requestCycleId === "cycle-b");
  assert.equal(cycleA.confirmedInputs.stay.guests, 2, "updating B must not overwrite A inputs");
  assert.equal(cycleB.confirmedInputs.stay.guests, 5, "explicitly referenced B alone may update");

  const snapshot = buildContextSnapshot(continued, scope);
  assert.equal(snapshot.cycles.length, 3, "answered and pending-backed active cycles must persist and reload as one scoped collection");
  assert.deepEqual(snapshot.cycles.filter((cycle) => ["cycle-a", "cycle-b"].includes(cycle.requestCycleId)).map((cycle) => cycle.requestCycleId).sort(), ["cycle-a", "cycle-b"]);
  const reloaded = migrateStateV2(JSON.parse(JSON.stringify(continued)), scope);
  assert.deepEqual(reloaded.requestCycles, continued.requestCycles, "collection state must survive serialization and reload exactly");
  assert.deepEqual(buildContextSnapshot(reloaded, { ...scope, propertyId: "other-property" }).cycles, [], "property/channel/user scope must isolate all cycles");

  const uncertain = reduceConversationState(continued, { contextDecisions: [decision(0, "none", null)], tasks: [task(0, "uncertain", "room-x")] }, { ...scope, eventId: "uncertain-event" });
  assert.deepEqual(uncertain.requestCycles, continued.requestCycles, "relation uncertainty must leave every existing cycle unchanged");
  assert.deepEqual(uncertain.pendingRequests, continued.pendingRequests, "relation uncertainty must leave dormant pending unchanged");

  console.log("multi-cycle context: PASS");
}

main();
