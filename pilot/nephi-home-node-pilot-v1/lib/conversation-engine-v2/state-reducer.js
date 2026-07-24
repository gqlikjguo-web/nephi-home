"use strict";

const crypto = require("node:crypto");
const { migratePendingRequest } = require("./pending-request");
const { legacyCycleId } = require("./contracts");

const PATHS = new Set(["stay.checkIn", "stay.checkOut", "stay.nights", "stay.guests", "stay.searchRange", "inventory.mode", "inventory.entityId", "inventory.features"]);
const TOPIC_TASK_TYPES = new Set(["amenity", "policy", "property_fact"]);
function blankTopic() { return { capabilityType: null, canonicalId: null, category: null, detailIntent: "general", detailFields: [] }; }
function blankConditions() { return { stay: { checkIn: null, checkOut: null, nights: null, guests: null, searchRange: null }, inventory: { mode: "any", entityId: null, features: [] }, topic: blankTopic() }; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizeEvidenceRefs(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).map((value) => {
    const legacyEventId = typeof value === "string" ? value : "";
    const eventId = String(value && typeof value === "object" ? value.eventId : legacyEventId || "").trim();
    const messageRef = String(value && typeof value === "object" ? value.messageRef || "" : "").trim();
    if (!eventId && !messageRef) return null;
    const ref = {
      eventId,
      messageRef,
      startOffset: Number.isInteger(value && value.startOffset) ? value.startOffset : 0,
      endOffset: Number.isInteger(value && value.endOffset) ? value.endOffset : 0,
      quote: String(value && value.quote || "")
    };
    const key = JSON.stringify(ref);
    if (seen.has(key)) return null;
    seen.add(key);
    return ref;
  }).filter(Boolean);
}
function scopeOf(scope = {}) { return { propertyId: scope.propertyId || "", channelId: scope.channelId || "", lineUserId: scope.lineUserId || "" }; }
function sameScope(left = {}, right = {}) { return left.propertyId === right.propertyId && left.channelId === right.channelId && left.lineUserId === right.lineUserId; }
function emptyStateV2(scope = {}) { return { schemaVersion: 2, scope: scopeOf(scope), requestCycles: [], pendingRequests: [], transition: { set: [], replaced: [], cleared: [], kept: [], sourceEventId: "" }, updatedAt: scope.now || new Date().toISOString() }; }
function setPath(root, path, value) { const [group, field] = path.split("."); root[group][field] = value; }
function validCycle(cycle) { return Boolean(cycle && typeof cycle === "object" && cycle.requestCycleId); }
function normalizedCycle(cycle, now) {
  if (!validCycle(cycle)) return null;
  return {
    requestCycleId: String(cycle.requestCycleId),
    requestKind: String(cycle.requestKind || ""),
    status: ["active", "answered", "handoff", "ended", "expired"].includes(cycle.status) ? cycle.status : "active",
    confirmedInputs: cycle.confirmedInputs && typeof cycle.confirmedInputs === "object" ? clone(cycle.confirmedInputs) : blankConditions(),
    temporalResult: cycle.temporalResult && typeof cycle.temporalResult === "object" ? clone(cycle.temporalResult) : null,
    sourceEvidenceRefs: normalizeEvidenceRefs(cycle.sourceEvidenceRefs || cycle.sourceTurnRequestIds),
    contextReuseExpiresAt: cycle.contextReuseExpiresAt || null,
    createdAt: cycle.createdAt || now,
    updatedAt: cycle.updatedAt || now
  };
}
function distinctCycles(cycles) {
  const seen = new Set();
  return cycles.filter((cycle) => cycle && !seen.has(cycle.requestCycleId) && seen.add(cycle.requestCycleId));
}
function migrateStateV2(state, scope = {}) {
  if (!state || state.schemaVersion !== 2 || !sameScope(state.scope, scope)) return emptyStateV2(scope);
  const now = scope.now || new Date().toISOString();
  const migrated = clone(state);
  const legacyCycle = normalizedCycle(migrated.contextCycle, now);
  const cycles = Array.isArray(migrated.requestCycles) && migrated.requestCycles.length
    ? migrated.requestCycles.map((cycle) => normalizedCycle(cycle, now)).filter(Boolean)
    : legacyCycle ? [legacyCycle] : [];
  const legacyPending = migratePendingRequest(migrated.pendingRequest);
  const pendingRequests = (Array.isArray(migrated.pendingRequests) && migrated.pendingRequests.length
    ? migrated.pendingRequests
    : legacyPending ? [legacyPending] : []).map(migratePendingRequest).filter(Boolean);
  for (const pending of pendingRequests) {
    const requestCycleId = legacyCycleId(pending);
    if (requestCycleId && !cycles.some((cycle) => cycle.requestCycleId === requestCycleId)) cycles.push(normalizedCycle({ requestCycleId, requestKind: pending.capability, status: "active", confirmedInputs: pending.conditions, contextReuseExpiresAt: pending.metadata && pending.metadata.expiresAt }, now));
  }
  migrated.requestCycles = distinctCycles(cycles);
  migrated.pendingRequests = pendingRequests.filter((pending, index, all) => pending.requestCycleId && all.findIndex((item) => item.pendingRequestId === pending.pendingRequestId) === index);
  migrated.transition = migrated.transition && typeof migrated.transition === "object" ? migrated.transition : { set: [], replaced: [], cleared: [], kept: [], sourceEventId: "" };
  delete migrated.contextCycle;
  delete migrated.pendingRequest;
  delete migrated.conditions;
  return migrated;
}
function topicFromTasks(tasks) {
  const task = [...(tasks || [])].reverse().find((item) => TOPIC_TASK_TYPES.has(item && item.type) && item.entity && item.entity.canonicalCandidate);
  if (!task) return null;
  return { capabilityType: task.type, canonicalId: String(task.entity.canonicalCandidate), category: String(task.entity.category || "other"), detailIntent: String(task.detailIntent || "general"), detailFields: [...new Set((task.requestedOutputs || []).map(String).filter(Boolean))].slice(0, 12) };
}
function conditionsForCycle(state, requestCycleId) {
  const cycle = (state && state.requestCycles || []).find((item) => item.requestCycleId === requestCycleId);
  return cycle && cycle.confirmedInputs ? clone(cycle.confirmedInputs) : blankConditions();
}
function decisionForRelation(previous, relation) {
  const action = relation && relation.stateAction || "none";
  if (action === "start") return { candidateIndex: relation.candidateIndex, action, requestCycleId: crypto.randomUUID(), referencedRequestCycleId: null };
  if (action === "replace") return { candidateIndex: relation.candidateIndex, action, requestCycleId: crypto.randomUUID(), referencedRequestCycleId: relation.requestCycleId || null };
  return { candidateIndex: relation && relation.candidateIndex, action, requestCycleId: relation && relation.requestCycleId || null, referencedRequestCycleId: relation && relation.requestCycleId || null };
}
function decideContextExecution(previous, relations, plannerTasks) {
  const state = previous || emptyStateV2();
  const cycles = new Map((state.requestCycles || []).map((cycle) => [cycle.requestCycleId, cycle]));
  const pendings = new Map((state.pendingRequests || []).map((pending) => [pending.requestCycleId, pending]));
  const relationsByCandidate = new Map((relations || []).filter((item) => item && item.stateAction !== "none").map((item) => [item.candidateIndex, item]));
  const contextDecisions = [...relationsByCandidate.values()].map((relation) => decisionForRelation(state, relation));
  let resumedPending = false;
  const executionItems = (plannerTasks || []).flatMap((task) => {
    const relation = relationsByCandidate.get(task.candidateIndex);
    const decision = contextDecisions.find((item) => item.candidateIndex === task.candidateIndex) || null;
    if (!relation || relation.stateAction !== "continue") return [{ candidateIndex: task.candidateIndex, requestCycleId: decision && decision.requestCycleId || null, task }];
    const pending = pendings.get(relation.requestCycleId);
    if (pending && Array.isArray(pending.tasks)) { resumedPending = true; return pending.tasks.map((pendingTask) => ({ candidateIndex: task.candidateIndex, requestCycleId: decision && decision.requestCycleId || null, task: { ...pendingTask, candidateIndex: task.candidateIndex, stayCandidate: task.stayCandidate } })); }
    const cycle = cycles.get(relation.requestCycleId);
    const topic = cycle && cycle.confirmedInputs && cycle.confirmedInputs.topic;
    if (!topic || !topic.canonicalId || task.entity && task.entity.canonicalCandidate !== null && task.entity.canonicalCandidate !== undefined || task.type !== topic.capabilityType) return [{ candidateIndex: task.candidateIndex, requestCycleId: decision && decision.requestCycleId || null, task }];
    return [{ candidateIndex: task.candidateIndex, requestCycleId: decision && decision.requestCycleId || null, task: { ...task, entity: { ...task.entity, category: topic.category, canonicalCandidate: topic.canonicalId } } }];
  });
  const executionTasks = executionItems.map((item) => item.task);
  const primaryDecision = contextDecisions.find((item) => item.action !== "none") || { action: "none", requestCycleId: null, candidateIndex: null };
  return { contextDecision: primaryDecision, contextDecisions, primaryCycleId: primaryDecision.requestCycleId, executionItems, executionTasks, resumedPending };
}
function addContextOperation(conditions, transition, field, value) {
  if (!PATHS.has(field) || value === null || value === undefined) return;
  const [group, key] = field.split(".");
  const operation = conditions[group] && conditions[group][key] === null ? "set" : "replaced";
  setPath(conditions, field, clone(value)); transition[operation].push(field);
}
function contextOperationsFromInputs(conditions, contextInput, transition) {
  const confirmed = contextInput && contextInput.confirmedFields || {};
  if (Number.isInteger(confirmed.guests)) addContextOperation(conditions, transition, "stay.guests", confirmed.guests);
  if (Number.isInteger(confirmed.nights)) addContextOperation(conditions, transition, "stay.nights", confirmed.nights);
  if (confirmed.inventory && typeof confirmed.inventory === "object") { addContextOperation(conditions, transition, "inventory.mode", confirmed.inventory.mode); addContextOperation(conditions, transition, "inventory.entityId", confirmed.inventory.entityId); }
  const temporal = contextInput && contextInput.temporalResult || {};
  if (temporal.resolutionStatus === "resolved") { addContextOperation(conditions, transition, "stay.checkIn", temporal.checkIn); addContextOperation(conditions, transition, "stay.checkOut", temporal.checkOut); addContextOperation(conditions, transition, "stay.nights", temporal.nights); addContextOperation(conditions, transition, "stay.searchRange", temporal.searchRange); }
  if (contextInput && contextInput.searchRange) addContextOperation(conditions, transition, "stay.searchRange", contextInput.searchRange);
}
function applyReducerPatch(conditions, patch, transition) {
  for (const item of Array.isArray(patch) ? patch : []) {
    if (!item || !PATHS.has(item.field)) continue;
    if (item.operation === "clear") { setPath(conditions, item.field, item.field === "inventory.features" ? [] : null); transition.cleared.push(item.field); }
    else if (item.operation === "keep") transition.kept.push(item.field);
    else if (item.operation === "set" || item.operation === "replace") { setPath(conditions, item.field, clone(item.value)); transition[item.operation === "replace" ? "replaced" : "set"].push(item.field); }
  }
}
function conditionsForDecision(state, contextInput, decision, isPrimary, transition) {
  const byCandidate = contextInput && contextInput.cycleInputsByCandidateIndex || {};
  if (Object.hasOwn(byCandidate, decision.candidateIndex)) return clone(byCandidate[decision.candidateIndex]);
  const sourceId = decision.action === "replace" ? decision.referencedRequestCycleId : decision.requestCycleId;
  const conditions = conditionsForCycle(state, sourceId);
  const proposedInputs = contextInput && contextInput.candidateInputsByCandidateIndex || {};
  if (Object.hasOwn(proposedInputs, decision.candidateIndex)) contextOperationsFromInputs(conditions, proposedInputs[decision.candidateIndex], transition);
  else if (isPrimary) { contextOperationsFromInputs(conditions, contextInput, transition); applyReducerPatch(conditions, contextInput && contextInput.contextPatch, transition); }
  return conditions;
}
function reduceConversationState(previous, contextInput, scope = {}) {
  const state = migrateStateV2(previous, scope);
  const transition = { set: [], replaced: [], cleared: [], kept: [], sourceEventId: scope.eventId || "" };
  const rawDecisions = Array.isArray(contextInput && contextInput.contextDecisions)
    ? contextInput.contextDecisions
    : contextInput && contextInput.contextDecision ? [contextInput.contextDecision] : [];
  const decisions = rawDecisions.filter((item) => item && item.action && item.action !== "none");
  const cycleIndex = new Map(state.requestCycles.map((cycle, index) => [cycle.requestCycleId, index]));
  for (const [index, decision] of decisions.entries()) {
    if (decision.action === "end") {
      const cycleAt = cycleIndex.get(decision.requestCycleId);
      if (cycleAt !== undefined) { state.requestCycles[cycleAt] = { ...state.requestCycles[cycleAt], status: "ended", updatedAt: scope.now || new Date().toISOString() }; state.pendingRequests = state.pendingRequests.filter((pending) => pending.requestCycleId !== decision.requestCycleId); transition.cleared.push(`cycle:${decision.requestCycleId}`); }
      continue;
    }
    if (decision.action === "replace" && decision.referencedRequestCycleId) {
      const replacedAt = cycleIndex.get(decision.referencedRequestCycleId);
      if (replacedAt !== undefined) state.requestCycles[replacedAt] = { ...state.requestCycles[replacedAt], status: "ended", updatedAt: scope.now || new Date().toISOString() };
      state.pendingRequests = state.pendingRequests.filter((pending) => pending.requestCycleId !== decision.referencedRequestCycleId);
      transition.replaced.push(`cycle:${decision.referencedRequestCycleId}`);
    }
    const task = (contextInput && contextInput.tasks || []).find((item) => item.candidateIndex === decision.candidateIndex);
    const topic = topicFromTasks(task ? [task] : []);
    const conditions = conditionsForDecision(state, contextInput, decision, index === 0, transition);
    if (topic) conditions.topic = topic;
    const requestCycleId = decision.requestCycleId || crypto.randomUUID();
    const existingAt = cycleIndex.get(requestCycleId);
    const existing = existingAt === undefined ? null : state.requestCycles[existingAt];
    const candidateInput = contextInput && contextInput.candidateInputsByCandidateIndex && contextInput.candidateInputsByCandidateIndex[decision.candidateIndex];
    const temporalResult = candidateInput && candidateInput.temporalResult || existing && existing.temporalResult || null;
    const sourceEvidenceRefs = normalizeEvidenceRefs(existing && (!candidateInput || !candidateInput.hasNewDateExpression)
      ? existing.sourceEvidenceRefs
      : [
        ...(existing && existing.sourceEvidenceRefs || []),
        ...(candidateInput && candidateInput.sourceEvidenceRefs || [])
      ]);
    const canRefreshContextReuse = !existing || Boolean(
      candidateInput
      && candidateInput.hasNewDateExpression
      && temporalResult
      && temporalResult.resolutionStatus === "resolved"
    );
    const contextReuseExpiresAt = canRefreshContextReuse
      ? new Date(new Date(scope.now || Date.now()).getTime() + 24 * 60 * 60 * 1000).toISOString()
      : existing.contextReuseExpiresAt || null;
    const cycle = { requestCycleId, requestKind: conditions.topic && conditions.topic.capabilityType || existing && existing.requestKind || "", status: "active", confirmedInputs: conditions, temporalResult, sourceEvidenceRefs, contextReuseExpiresAt, createdAt: existing && existing.createdAt || scope.now || new Date().toISOString(), updatedAt: scope.now || new Date().toISOString() };
    if (existingAt === undefined) { state.requestCycles.push(cycle); cycleIndex.set(requestCycleId, state.requestCycles.length - 1); transition.set.push(`cycle:${requestCycleId}`); }
    else { state.requestCycles[existingAt] = { ...existing, ...cycle, createdAt: existing.createdAt || cycle.createdAt }; transition.replaced.push(`cycle:${requestCycleId}`); }
  }
  state.transition = transition; state.updatedAt = scope.now || new Date().toISOString();
  return state;
}
function reducePendingRequests(previous, { requestCycleId, pendingRequest } = {}, scope = {}) {
  const state = migrateStateV2(previous, scope);
  if (!requestCycleId) return state;
  state.pendingRequests = state.pendingRequests.filter((pending) => pending.requestCycleId !== requestCycleId);
  if (pendingRequest) state.pendingRequests.push(migratePendingRequest(pendingRequest));
  state.updatedAt = scope.now || new Date().toISOString();
  return state;
}

module.exports = { emptyStateV2, migrateStateV2, reduceConversationState, reducePendingRequests, blankTopic, blankConditions, topicFromTasks, conditionsForCycle, decideContextExecution };
