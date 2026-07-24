"use strict";

const PENDING_VERSION = 1;
const PENDING_FIELDS = new Set([
  "stay.checkIn", "stay.checkOut", "stay.nights", "stay.guests", "stay.searchRange",
  "inventory.mode", "inventory.entityId", "inventory.features"
]);
function safeText(value, limit) { return String(value || "").slice(0, limit); }
function unique(values) { return [...new Set(values)]; }

function pendingConditions(conditions = {}) {
  const stay = conditions.stay || {};
  const inventory = conditions.inventory || {};
  return {
    stay: {
      checkIn: stay.checkIn || null,
      checkOut: stay.checkOut || null,
      nights: Number.isInteger(stay.nights) ? stay.nights : null,
      guests: Number.isInteger(stay.guests) ? stay.guests : null,
      searchRange: stay.searchRange && stay.searchRange.from && stay.searchRange.to
        ? { from: safeText(stay.searchRange.from, 10), to: safeText(stay.searchRange.to, 10) }
        : null
    },
    inventory: {
      mode: safeText(inventory.mode || "any", 40),
      entityId: inventory.entityId ? safeText(inventory.entityId, 120) : null,
      features: Array.isArray(inventory.features) ? inventory.features.map((item) => safeText(item, 120)).filter(Boolean).slice(0, 20) : []
    }
  };
}

function pendingTask(task) {
  if (!task || typeof task !== "object" || !task.taskId || !task.type || !task.entity) return null;
  return {
    candidateIndex: Number.isInteger(task.candidateIndex) ? task.candidateIndex : null,
    taskId: safeText(task.taskId, 80),
    type: safeText(task.type, 80),
    detailIntent: safeText(task.detailIntent || "general", 80),
    requestedOutputs: Array.isArray(task.requestedOutputs) ? task.requestedOutputs.map((item) => safeText(item, 80)).filter(Boolean).slice(0, 20) : [],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: Boolean(task.dependsOnStayContext),
    entity: {
      category: safeText(task.entity.category || "other", 80),
      rawText: safeText(task.entity.rawText, 200),
      canonicalCandidate: task.entity.canonicalCandidate === null || task.entity.canonicalCandidate === undefined ? null : safeText(task.entity.canonicalCandidate, 120),
      confidence: Number.isFinite(task.entity.confidence) ? task.entity.confidence : 1
    },
    confidence: Number.isFinite(task.confidence) ? task.confidence : 1
  };
}

function normalizeMissingFields(values) { return unique((values || []).map(String).filter((field) => PENDING_FIELDS.has(field))); }

function createPendingRequest({ tasks, conditions, missingFields, clarificationTarget, scope = {} }) {
  const safeTasks = (tasks || []).map(pendingTask).filter(Boolean);
  const missing = normalizeMissingFields(missingFields);
  if (!safeTasks.length || !missing.length) return null;
  return {
    version: PENDING_VERSION,
    pendingRequestId: scope.pendingRequestId || null,
    requestCycleId: scope.requestCycleId || null,
    capability: safeTasks[0].type,
    tasks: safeTasks,
    conditions: pendingConditions(conditions),
    missingFields: missing,
    clarificationTarget: PENDING_FIELDS.has(clarificationTarget) ? clarificationTarget : missing[0],
    metadata: {
      sourceEventId: safeText(scope.eventId, 120),
      createdAt: safeText(scope.createdAt || scope.now, 40),
      updatedAt: safeText(scope.now, 40),
      expiresAt: safeText(scope.expiresAt, 40)
    }
  };
}

function isPendingRequest(value) {
  return Boolean(value && value.version === PENDING_VERSION && typeof value.capability === "string"
    && Array.isArray(value.tasks) && value.tasks.length && Array.isArray(value.missingFields) && value.missingFields.length);
}

function migratePendingRequest(value) {
  if (!isPendingRequest(value)) return null;
  return createPendingRequest({ tasks: value.tasks, conditions: value.conditions, missingFields: value.missingFields, clarificationTarget: value.clarificationTarget, scope: { ...(value.metadata || {}), pendingRequestId: value.pendingRequestId, requestCycleId: value.requestCycleId } });
}

function pendingFromResults({ plannerOutput, taskResults, conditions, scope }) {
  const clarifications = (taskResults || []).filter((result) => result && result.status === "needs_clarification");
  if (!clarifications.length) return null;
  const taskIds = new Set(clarifications.map((result) => result.taskId));
  const tasks = (plannerOutput.tasks || []).filter((task) => taskIds.has(task.taskId));
  const missingFields = normalizeMissingFields([...clarifications.flatMap((result) => result.missingInputs || []), ...(plannerOutput.missingInformation || [])]);
  return createPendingRequest({ tasks, conditions, missingFields, clarificationTarget: missingFields[0], scope });
}

module.exports = { PENDING_VERSION, PENDING_FIELDS, createPendingRequest, isPendingRequest, migratePendingRequest, normalizeMissingFields, pendingConditions, pendingFromResults };
