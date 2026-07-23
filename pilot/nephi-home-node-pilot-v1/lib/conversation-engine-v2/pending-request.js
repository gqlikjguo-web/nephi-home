"use strict";

const PENDING_VERSION = 1;
const PENDING_FIELDS = new Set([
  "stay.checkIn", "stay.checkOut", "stay.nights", "stay.guests", "stay.searchRange",
  "inventory.mode", "inventory.entityId", "inventory.features"
]);
const STAY_CAPABILITIES = new Set([
  "availability", "available_dates", "bundle_availability", "room_options",
  "capacity", "price", "total_price"
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

function canonicalField(field) {
  return {
    "stay.checkInCandidate": "stay.checkIn",
    "stay.checkOutCandidate": "stay.checkOut",
    "stay.nightsCandidate": "stay.nights",
    "stay.guestCountCandidate": "stay.guests"
  }[field] || field;
}

function canonicalOperationsFromPlanner(plannerOutput) {
  const operations = (plannerOutput && plannerOutput.stateOperations || [])
    .filter((item) => item && ["set", "replace"].includes(item.operation))
    .map((item) => ({ ...item, field: canonicalField(item.field) }))
    .filter((item) => PENDING_FIELDS.has(item.field));
  const stay = plannerOutput && plannerOutput.stay || {};
  if (stay.checkInCandidate) operations.push({ field: "stay.checkIn", operation: "set", value: stay.checkInCandidate });
  if (stay.checkOutCandidate) operations.push({ field: "stay.checkOut", operation: "set", value: stay.checkOutCandidate });
  if (Number.isInteger(stay.nightsCandidate)) operations.push({ field: "stay.nights", operation: "set", value: stay.nightsCandidate });
  if (Number.isInteger(stay.guestCountCandidate)) operations.push({ field: "stay.guests", operation: "set", value: stay.guestCountCandidate });
  return operations;
}

function explicitSuppliedFields(plannerOutput, canonicalOperations) {
  const fields = new Set((canonicalOperations || []).filter((item) => item && ["set", "replace"].includes(item.operation)).map((item) => canonicalField(item.field)).filter((field) => PENDING_FIELDS.has(field)));
  const stay = plannerOutput && plannerOutput.stay || {};
  if (stay.checkInCandidate) fields.add("stay.checkIn");
  if (stay.checkOutCandidate) fields.add("stay.checkOut");
  if (Number.isInteger(stay.nightsCandidate)) fields.add("stay.nights");
  if (Number.isInteger(stay.guestCountCandidate)) fields.add("stay.guests");
  return fields;
}

function uniqueTasks(tasks) {
  const seen = new Set();
  return (tasks || []).filter((task) => {
    const key = `${task && task.taskId || ""}:${task && task.type || ""}`;
    if (!task || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resumePendingRequest(plannerOutput, pending, context = {}) {
  if (context.noReply) {
    return {
      plannerOutput,
      resumed: false,
      action: "no_reply",
      reason: "no_reply_gate_hit",
      matchedFields: [],
      remainingMissingFields: isPendingRequest(pending) ? pending.missingFields : [],
      executionTasks: []
    };
  }
  if (!isPendingRequest(pending) || !plannerOutput || !Array.isArray(plannerOutput.tasks)) {
    return {
      plannerOutput,
      resumed: false,
      action: context.noReply ? "no_reply" : "replace_pending",
      reason: "pending_unavailable",
      matchedFields: [],
      remainingMissingFields: [],
      executionTasks: plannerOutput && Array.isArray(plannerOutput.tasks) ? plannerOutput.tasks : []
    };
  }
  const relation = plannerOutput.discourse && plannerOutput.discourse.relation;
  const canonicalOperations = context.canonicalOperations || canonicalOperationsFromPlanner(plannerOutput);
  const suppliedFields = explicitSuppliedFields(plannerOutput, canonicalOperations);
  const matchedFields = pending.missingFields.filter((field) => suppliedFields.has(field));
  const remainingMissingFields = pending.missingFields.filter((field) => !matchedFields.includes(field));
  const currentTasks = plannerOutput.tasks.filter((task) => task && task.type !== "unknown");
  const explicitRangeSearch = Boolean(context.explicitRangeSearch && currentTasks.some((task) => task.type === "available_dates"));
  const sameCapability = currentTasks.some((task) => task.type === pending.capability);
  const explicitCompleteSameCapability = Boolean(
    relation === "new_request"
    && sameCapability
    && suppliedFields.has("stay.checkIn")
    && (suppliedFields.has("stay.checkOut") || suppliedFields.has("stay.nights"))
    && [...suppliedFields].some((field) => !pending.missingFields.includes(field))
  );
  const independentTasks = currentTasks.filter((task) => {
    if (task.type === pending.capability) return false;
    if (STAY_CAPABILITIES.has(task.type) && STAY_CAPABILITIES.has(pending.capability)) {
      return explicitRangeSearch && task.type === "available_dates";
    }
    return true;
  });

  if (explicitRangeSearch || explicitCompleteSameCapability) {
    return {
      plannerOutput,
      resumed: false,
      action: "replace_pending",
      reason: "explicit_new_request",
      matchedFields,
      remainingMissingFields,
      executionTasks: currentTasks
    };
  }

  if (matchedFields.length) {
    return {
      plannerOutput,
      resumed: true,
      action: independentTasks.length ? "continue_pending_with_new_tasks" : "continue_pending",
      reason: "pending_missing_fields_matched",
      matchedFields,
      remainingMissingFields,
      executionTasks: uniqueTasks([...pending.tasks, ...independentTasks])
    };
  }

  if (independentTasks.length || (currentTasks.length && ["new_request", "new_topic"].includes(relation))) {
    return {
      plannerOutput,
      resumed: false,
      action: "replace_pending",
      reason: relation === "new_topic" ? "explicit_new_topic" : "explicit_new_request",
      matchedFields: [],
      remainingMissingFields: pending.missingFields,
      executionTasks: currentTasks
    };
  }

  return {
    plannerOutput,
    resumed: false,
    action: "keep_pending",
    reason: "no_valid_pending_supplement",
    matchedFields: [],
    remainingMissingFields: pending.missingFields,
    executionTasks: []
  };
}

function pendingFromResults({ plannerOutput, taskResults, conditions, scope }) {
  const clarifications = (taskResults || []).filter((result) => result && result.status === "needs_clarification");
  if (!clarifications.length) return null;
  const taskIds = new Set(clarifications.map((result) => result.taskId));
  const tasks = (plannerOutput.tasks || []).filter((task) => taskIds.has(task.taskId));
  const missingFields = normalizeMissingFields([...clarifications.flatMap((result) => result.missingInputs || []), ...(plannerOutput.missingInformation || [])]);
  return createPendingRequest({ tasks, conditions, missingFields, clarificationTarget: missingFields[0], scope });
}

module.exports = {
  PENDING_VERSION,
  PENDING_FIELDS,
  STAY_CAPABILITIES,
  createPendingRequest,
  isPendingRequest,
  migratePendingRequest,
  normalizeMissingFields,
  pendingConditions,
  pendingFromResults,
  resumePendingRequest
};
