"use strict";

const crypto = require("node:crypto");
const { migratePendingRequest } = require("./pending-request");
const { legacyCycleId } = require("./contracts");

const PATHS = new Set(["stay.checkIn", "stay.checkOut", "stay.nights", "stay.guests", "stay.searchRange", "inventory.mode", "inventory.entityId", "inventory.features"]);
const TOPIC_TASK_TYPES = new Set(["amenity", "policy", "property_fact"]);
function blankTopic() { return { capabilityType: null, canonicalId: null, category: null, detailIntent: "general", detailFields: [] }; }
function blankConditions() { return { stay: { checkIn: null, checkOut: null, nights: null, guests: null, searchRange: null }, inventory: { mode: "any", entityId: null, features: [] }, topic: blankTopic() }; }
function emptyStateV2(scope = {}) { return { schemaVersion: 2, scope: { propertyId: scope.propertyId || "", channelId: scope.channelId || "", lineUserId: scope.lineUserId || "" }, conditions: blankConditions(), pendingRequest: null, contextCycle: null, transition: { set: [], replaced: [], cleared: [], kept: [], sourceEventId: "" }, updatedAt: scope.now || new Date().toISOString() }; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function setPath(root, path, value) { const [group, field] = path.split("."); root[group][field] = value; }
function migrateStateV2(state, scope) {
  if (!state || state.schemaVersion !== 2 || !state.scope || state.scope.propertyId !== scope.propertyId || state.scope.channelId !== scope.channelId || state.scope.lineUserId !== scope.lineUserId) return emptyStateV2(scope);
  const migrated = clone(state);
  migrated.conditions = migrated.conditions || blankConditions();
  migrated.conditions.topic = migrated.conditions.topic && typeof migrated.conditions.topic === "object" ? { ...blankTopic(), ...migrated.conditions.topic } : blankTopic();
  migrated.pendingRequest = migratePendingRequest(migrated.pendingRequest);
  migrated.contextCycle = migrated.contextCycle && typeof migrated.contextCycle === "object" ? migrated.contextCycle : null;
  delete migrated.conditions.tasks;
  return migrated;
}
function topicFromTasks(tasks) {
  const task = [...(tasks || [])].reverse().find((item) => TOPIC_TASK_TYPES.has(item && item.type) && item.entity && item.entity.canonicalCandidate);
  if (!task) return null;
  return { capabilityType: task.type, canonicalId: String(task.entity.canonicalCandidate), category: String(task.entity.category || "other"), detailIntent: String(task.detailIntent || "general"), detailFields: [...new Set((task.requestedOutputs || []).map(String).filter(Boolean))].slice(0, 12) };
}

function decideContextExecution(previous, relations, plannerTasks, options = {}) {
  const relation = (relations || []).find((item) => item && item.stateAction !== "none") || null;
  const pending = previous && previous.pendingRequest;
  const pendingCycleId = legacyCycleId(pending);
  const currentCycleId = previous && previous.contextCycle && previous.contextCycle.requestCycleId || pendingCycleId;
  const mayContinue = relation && relation.stateAction === "continue" && relation.requestCycleId === currentCycleId && Array.isArray(pending && pending.tasks);
  const mayReuseTopic = relation && relation.stateAction === "continue" && relation.requestCycleId === currentCycleId
    && previous && previous.conditions && previous.conditions.topic && previous.conditions.topic.canonicalId;
  const taskCandidates = plannerTasks || [];
  const executionTasks = mayContinue ? pending.tasks : mayReuseTopic ? taskCandidates.map((task) => {
    const entity = task && task.entity || {};
    if (entity.canonicalCandidate !== null && entity.canonicalCandidate !== undefined) return task;
    if (task.type !== previous.conditions.topic.capabilityType) return task;
    return { ...task, entity: { ...entity, category: previous.conditions.topic.category, canonicalCandidate: previous.conditions.topic.canonicalId } };
  }) : taskCandidates;
  return {
    contextDecision: {
      action: relation && relation.stateAction || "none",
      requestCycleId: relation && relation.requestCycleId || null,
      resetConditions: Boolean(relation && relation.stateAction === "start" && options.resetConditions === true)
    },
    executionTasks,
    resumedPending: mayContinue
  };
}

function reduceConversationState(previous, contextInput, scope) {
  let state = migrateStateV2(previous, scope);
  const transition = { set: [], replaced: [], cleared: [], kept: [], sourceEventId: scope.eventId || "" };
  const decision = contextInput && contextInput.contextDecision || {};
  const patch = contextInput && contextInput.contextPatch || [];
  if (decision.resetConditions === true) state.conditions = blankConditions();
  for (const item of patch) {
    if (!PATHS.has(item.field)) continue;
    if (item.operation === "clear") { setPath(state.conditions, item.field, item.field === "inventory.features" ? [] : null); transition.cleared.push(item.field); }
    else if (item.operation === "keep") transition.kept.push(item.field);
    else { setPath(state.conditions, item.field, clone(item.value)); transition[item.operation === "replace" ? "replaced" : "set"].push(item.field); }
  }
  const topic = topicFromTasks(contextInput && contextInput.tasks);
  if (topic) state.conditions.topic = topic;
  if (decision.action !== "none" && state.conditions.topic && state.conditions.topic.canonicalId) {
    const existingId = state.contextCycle && state.contextCycle.requestCycleId;
    state.contextCycle = {
      requestCycleId: decision.action === "start" ? decision.requestCycleId || crypto.randomUUID() : decision.requestCycleId || existingId || crypto.randomUUID(),
      requestKind: state.conditions.topic.capabilityType || "",
      status: "active",
      confirmedInputs: clone(state.conditions),
      contextReuseExpiresAt: new Date(new Date(scope.now || Date.now()).getTime() + 24 * 60 * 60 * 1000).toISOString()
    };
  }
  state.transition = transition; state.updatedAt = scope.now || new Date().toISOString();
  return state;
}

module.exports = { emptyStateV2, migrateStateV2, reduceConversationState, blankTopic, topicFromTasks, decideContextExecution };
