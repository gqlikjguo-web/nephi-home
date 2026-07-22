"use strict";

const PENDING_VERSION = 1;
const PENDING_FIELDS = new Set([
  "stay.checkIn", "stay.checkOut", "stay.nights", "stay.guests", "stay.searchRange",
  "inventory.mode", "inventory.entityId", "inventory.features"
]);
const CONTINUATION_PLACEHOLDER_TYPES = new Set(["available_dates", "unknown"]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
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
    capability: safeTasks[0].type,
    tasks: safeTasks,
    conditions: pendingConditions(conditions),
    missingFields: missing,
    clarificationTarget: PENDING_FIELDS.has(clarificationTarget) ? clarificationTarget : missing[0],
    metadata: {
      sourceEventId: safeText(scope.eventId, 120),
      createdAt: safeText(scope.createdAt || scope.now, 40),
      updatedAt: safeText(scope.now, 40)
    }
  };
}

function isPendingRequest(value) {
  return Boolean(value && value.version === PENDING_VERSION && typeof value.capability === "string"
    && Array.isArray(value.tasks) && value.tasks.length && Array.isArray(value.missingFields) && value.missingFields.length);
}

function migratePendingRequest(value) {
  if (!isPendingRequest(value)) return null;
  return createPendingRequest({ tasks: value.tasks, conditions: value.conditions, missingFields: value.missingFields, clarificationTarget: value.clarificationTarget, scope: value.metadata || {} });
}

function hasTemporalSupplement(plannerOutput) {
  const stay = plannerOutput && plannerOutput.stay || {};
  const expression = stay.dateExpression || {};
  if (expression.rawText && expression.kind && expression.kind !== "none") return true;
  if (stay.checkInCandidate || stay.checkOutCandidate || Number.isInteger(stay.nightsCandidate) || Number.isInteger(stay.guestCountCandidate)) return true;
  return (plannerOutput && plannerOutput.stateOperations || []).some((item) => item && typeof item.field === "string" && item.field.startsWith("stay.") && ["set", "replace"].includes(item.operation));
}

function resumePendingRequest(plannerOutput, pending) {
  if (!isPendingRequest(pending) || !plannerOutput || !Array.isArray(plannerOutput.tasks)) return { plannerOutput, resumed: false, reason: "pending_unavailable" };
  const relation = plannerOutput.discourse && plannerOutput.discourse.relation;
  if (relation === "new_topic") return { plannerOutput, resumed: false, reason: "explicit_new_topic" };
  if (relation === "new_request") return { plannerOutput, resumed: false, reason: "explicit_new_request" };
  const temporalSupplement = hasTemporalSupplement(plannerOutput);
  const sameCapability = plannerOutput.tasks.some((task) => task.type === pending.capability);
  if (!["continue", "answer_clarification"].includes(relation) && !temporalSupplement && !sameCapability) return { plannerOutput, resumed: false, reason: "not_a_continuation" };

  const currentSameCapability = plannerOutput.tasks.filter((task) => task.type === pending.capability);
  const restored = pending.tasks.map((task, index) => ({ ...clone(currentSameCapability[index] || task), taskId: task.taskId, sourceText: "pending_request" }));
  const additional = plannerOutput.tasks.filter((task) => !CONTINUATION_PLACEHOLDER_TYPES.has(task.type) && task.type !== pending.capability);
  const stateOperations = (plannerOutput.stateOperations || []).filter((item) => item.field !== "stay.searchRange");
  stateOperations.push({ field: "stay.searchRange", operation: "clear", value: null, sourceText: "pending_request" });
  const merged = { ...plannerOutput, discourse: { ...(plannerOutput.discourse || {}), relation: "answer_clarification" }, tasks: [...restored, ...additional], stateOperations, missingInformation: pending.missingFields, shouldIgnore: false };
  delete merged.searchRange;
  return { plannerOutput: merged, resumed: true, reason: "pending_request_resumed" };
}

function pendingFromResults({ plannerOutput, taskResults, conditions, scope }) {
  const clarifications = (taskResults || []).filter((result) => result && result.status === "needs_clarification");
  if (!clarifications.length) return null;
  const taskIds = new Set(clarifications.map((result) => result.taskId));
  const tasks = (plannerOutput.tasks || []).filter((task) => taskIds.has(task.taskId));
  const missingFields = normalizeMissingFields([...clarifications.flatMap((result) => result.missingInputs || []), ...(plannerOutput.missingInformation || [])]);
  return createPendingRequest({ tasks, conditions, missingFields, clarificationTarget: missingFields[0], scope });
}

module.exports = { PENDING_VERSION, PENDING_FIELDS, createPendingRequest, isPendingRequest, migratePendingRequest, normalizeMissingFields, pendingConditions, pendingFromResults, resumePendingRequest };
