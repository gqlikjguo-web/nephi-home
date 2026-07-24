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

function decideContextExecution(previous, relations, plannerTasks) {
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
      requestCycleId: relation && relation.requestCycleId || null
    },
    executionTasks,
    resumedPending: mayContinue
  };
}

function addContextOperation(state, transition, field, value) {
  if (!PATHS.has(field) || value === null || value === undefined) return;
  const [group, key] = field.split(".");
  const operation = state.conditions[group] && state.conditions[group][key] === null ? "set" : "replaced";
  setPath(state.conditions, field, clone(value));
  transition[operation].push(field);
}

function contextOperationsFromInputs(state, contextInput, transition) {
  const confirmed = contextInput && contextInput.confirmedFields || {};
  if (Number.isInteger(confirmed.guests)) addContextOperation(state, transition, "stay.guests", confirmed.guests);
  if (Number.isInteger(confirmed.nights)) addContextOperation(state, transition, "stay.nights", confirmed.nights);
  if (confirmed.inventory && typeof confirmed.inventory === "object") {
    addContextOperation(state, transition, "inventory.mode", confirmed.inventory.mode);
    addContextOperation(state, transition, "inventory.entityId", confirmed.inventory.entityId);
  }
  const temporal = contextInput && contextInput.temporalResult || {};
  if (temporal.resolutionStatus === "resolved") {
    addContextOperation(state, transition, "stay.checkIn", temporal.checkIn);
    addContextOperation(state, transition, "stay.checkOut", temporal.checkOut);
    addContextOperation(state, transition, "stay.nights", temporal.nights);
    addContextOperation(state, transition, "stay.searchRange", temporal.searchRange);
  }
  if (temporal.resolutionStatus === "invalid" && contextInput && contextInput.hasNewDateExpression) {
    for (const field of ["stay.checkIn", "stay.checkOut", "stay.searchRange"]) {
      setPath(state.conditions, field, null);
      transition.cleared.push(field);
    }
  }
  if (contextInput && contextInput.searchRange) addContextOperation(state, transition, "stay.searchRange", contextInput.searchRange);
}

function applyReducerPatch(state, patch, transition) {
  for (const item of Array.isArray(patch) ? patch : []) {
    if (!item || !PATHS.has(item.field)) continue;
    if (item.operation === "clear") {
      setPath(state.conditions, item.field, item.field === "inventory.features" ? [] : null);
      transition.cleared.push(item.field);
    } else if (item.operation === "keep") {
      transition.kept.push(item.field);
    } else if (item.operation === "set" || item.operation === "replace") {
      setPath(state.conditions, item.field, clone(item.value));
      transition[item.operation === "replace" ? "replaced" : "set"].push(item.field);
    }
  }
}

function reduceConversationState(previous, contextInput, scope) {
  let state = migrateStateV2(previous, scope);
  const transition = { set: [], replaced: [], cleared: [], kept: [], sourceEventId: scope.eventId || "" };
  const decision = contextInput && contextInput.contextDecision || {};
  contextOperationsFromInputs(state, contextInput, transition);
  applyReducerPatch(state, contextInput && contextInput.contextPatch, transition);
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
