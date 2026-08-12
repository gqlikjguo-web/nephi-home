"use strict";

const {
  createLodgingProduct,
  validateLodgingProduct
} = require("./lodging-product");
const {
  evaluateTaskReadiness
} = require("./task-readiness");

const CONVERSATION_STATE_SCHEMA_VERSION = 3;
const CONVERSATION_STATE_FIELDS = Object.freeze([
  "schemaVersion",
  "revision",
  "scope",
  "tasks",
  "createdAt",
  "updatedAt",
  "expiresAt"
]);
const CONVERSATION_SCOPE_FIELDS = Object.freeze([
  "propertyId",
  "channel",
  "userId"
]);
const CONVERSATION_TASK_FIELDS = Object.freeze([
  "taskId",
  "taskType",
  "productType",
  "productId",
  "roomTypeId",
  "bundleId",
  "checkIn",
  "checkOut",
  "guestCount",
  "searchFrom",
  "searchTo",
  "entityId",
  "entityCategory",
  "detailIntent",
  "knownFields",
  "missingFields",
  "status",
  "createdAt",
  "updatedAt",
  "expiresAt"
]);
const CONVERSATION_TASK_REQUIRED_INPUT_FIELDS = Object.freeze(
  CONVERSATION_TASK_FIELDS.filter(
    (field) => ![
      "searchFrom",
      "searchTo",
      "entityId",
      "entityCategory",
      "detailIntent"
    ].includes(field)
  )
);
const TASK_STATUSES = new Set([
  "pending",
  "ready",
  "in_progress",
  "answered",
  "needs_clarification",
  "unknown",
  "needs_human",
  "expired",
  "cancelled"
]);
const LEGACY_TASK_TYPES = Object.freeze({
  price: "pricing",
  total_price: "pricing",
  bundle_availability: "availability"
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function validTimestamp(value) {
  return typeof value === "string"
    && value.length > 0
    && Number.isFinite(Date.parse(value));
}

function exactKeys(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === fields.length
    && keys.every((key) => fields.includes(key));
}

function taskInputKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.every((key) => CONVERSATION_TASK_FIELDS.includes(key))
    && CONVERSATION_TASK_REQUIRED_INPUT_FIELDS.every(
      (field) => Object.hasOwn(value, field)
    );
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function normalizedScope(value = {}) {
  return {
    propertyId: String(value.propertyId || "").trim(),
    channel: String(value.channel || "").trim(),
    userId: String(value.userId || "").trim()
  };
}

function sameScope(left, right) {
  return left.propertyId === right.propertyId
    && left.channel === right.channel
    && left.userId === right.userId;
}

function normalizedTask(value = {}) {
  const product = {
    productType: String(value.productType || "").trim(),
    productId: textOrNull(value.productId),
    roomTypeId: textOrNull(value.roomTypeId),
    bundleId: textOrNull(value.bundleId)
  };
  return {
    taskId: String(value.taskId || "").trim(),
    taskType: String(value.taskType || "").trim(),
    ...product,
    checkIn: textOrNull(value.checkIn),
    checkOut: textOrNull(value.checkOut),
    guestCount: value.guestCount === null || value.guestCount === undefined
      ? null
      : Number(value.guestCount),
    searchFrom: textOrNull(value.searchFrom),
    searchTo: textOrNull(value.searchTo),
    entityId: textOrNull(value.entityId),
    entityCategory: textOrNull(value.entityCategory),
    detailIntent: String(value.detailIntent || "general").trim(),
    knownFields: uniqueStrings(value.knownFields),
    missingFields: uniqueStrings(value.missingFields),
    status: String(value.status || "").trim(),
    createdAt: String(value.createdAt || "").trim(),
    updatedAt: String(value.updatedAt || "").trim(),
    expiresAt: String(value.expiresAt || "").trim()
  };
}

function validateConversationTaskV3(value) {
  const task = normalizedTask(value);
  const errors = [];
  if (!taskInputKeys(value)) errors.push("keys");
  if (!task.taskId) errors.push("taskId");
  if (!task.taskType) errors.push("taskType");
  if (!task.detailIntent) errors.push("detailIntent");
  if (Boolean(task.entityId) !== Boolean(task.entityCategory)) {
    errors.push("entity");
  }
  if (!validateLodgingProduct(task).ok) errors.push("product");
  if (task.guestCount !== null
    && (!Number.isInteger(task.guestCount) || task.guestCount < 1)) {
    errors.push("guestCount");
  }
  if (!TASK_STATUSES.has(task.status)) errors.push("status");
  if (task.status === "ready" && task.missingFields.length) {
    errors.push("ready.missingFields");
  }
  if (task.knownFields.some((field) => task.missingFields.includes(field))) {
    errors.push("knownFields.missingFields");
  }
  const readiness = evaluateTaskReadiness(task);
  const explicitGuestCountUncertainty = task.taskType === "availability"
    && task.guestCount === null
    && task.missingFields.length === readiness.missingFields.length + 1
    && task.missingFields.every((field) => field === "guestCount" || readiness.missingFields.includes(field))
    && task.missingFields.includes("guestCount");
  const effectiveReadiness = explicitGuestCountUncertainty
    ? { ...readiness, status: "missing", missingFields: [...readiness.missingFields, "guestCount"] }
    : readiness;
  const allowedStatuses = {
    ready: new Set([
      "ready",
      "in_progress",
      "answered",
      "unknown",
      "needs_human"
    ]),
    missing: new Set(["pending", "needs_clarification"]),
    invalid: new Set(["needs_human"]),
    unsupported: new Set(["needs_human"])
  };
  const readinessMatches = sameArray(
    task.knownFields,
    effectiveReadiness.knownFields
  ) && sameArray(task.missingFields, effectiveReadiness.missingFields)
    && (
      ["expired", "cancelled"].includes(task.status)
      || allowedStatuses[effectiveReadiness.status]
        && allowedStatuses[effectiveReadiness.status].has(task.status)
    );
  if (!readinessMatches) errors.push("task_readiness_mismatch");
  if (!validTimestamp(task.createdAt)) errors.push("createdAt");
  if (!validTimestamp(task.updatedAt)) errors.push("updatedAt");
  if (!validTimestamp(task.expiresAt)) errors.push("expiresAt");
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    value: task
  };
}

function createConversationTaskV3(value) {
  const validation = validateConversationTaskV3(value);
  if (!validation.ok) {
    const error = new TypeError(
      `invalid_conversation_task_v3:${validation.errors.join(",")}`
    );
    error.code = "invalid_conversation_task_v3";
    error.validationErrors = validation.errors;
    throw error;
  }
  return deepFreeze(validation.value);
}

function normalizedState(value = {}) {
  return {
    schemaVersion: Number(value.schemaVersion),
    revision: Number.isInteger(value.revision) ? value.revision : 0,
    scope: normalizedScope(value.scope || value),
    tasks: Object.hasOwn(value, "tasks") ? value.tasks : [],
    createdAt: String(value.createdAt || "").trim(),
    updatedAt: String(value.updatedAt || "").trim(),
    expiresAt: String(value.expiresAt || "").trim()
  };
}

function validateConversationStateV3(value) {
  const state = normalizedState(value);
  const errors = [];
  if (!exactKeys(value, CONVERSATION_STATE_FIELDS)) errors.push("keys");
  if (!exactKeys(value && value.scope, CONVERSATION_SCOPE_FIELDS)) {
    errors.push("scope.keys");
  }
  if (state.schemaVersion !== CONVERSATION_STATE_SCHEMA_VERSION) {
    errors.push("schemaVersion");
  }
  if (!Number.isInteger(state.revision) || state.revision < 0) {
    errors.push("revision");
  }
  for (const field of ["propertyId", "channel", "userId"]) {
    if (!state.scope[field]) errors.push(`scope.${field}`);
  }
  if (!Array.isArray(state.tasks)) {
    errors.push("tasks");
  } else {
    const ids = new Set();
    state.tasks.forEach((task, index) => {
      if (!exactKeys(task, CONVERSATION_TASK_FIELDS)) {
        errors.push(`tasks.${index}.keys`);
      }
      const validation = validateConversationTaskV3(task);
      validation.errors.forEach((error) => errors.push(`tasks.${index}.${error}`));
      const taskId = String(task && task.taskId || "");
      if (ids.has(taskId)) errors.push("tasks.taskId.duplicate");
      ids.add(taskId);
    });
  }
  if (!validTimestamp(state.createdAt)) errors.push("createdAt");
  if (!validTimestamp(state.updatedAt)) errors.push("updatedAt");
  if (!validTimestamp(state.expiresAt)) errors.push("expiresAt");
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)]
  };
}

function createConversationStateV3(value = {}) {
  const scope = normalizedScope(value.scope || value);
  const tasks = Object.hasOwn(value, "tasks") ? value.tasks : [];
  const state = {
    schemaVersion: CONVERSATION_STATE_SCHEMA_VERSION,
    revision: Number.isInteger(value.revision) ? value.revision : 0,
    scope,
    tasks: Array.isArray(tasks)
      ? tasks.map(createConversationTaskV3)
      : tasks,
    createdAt: String(value.createdAt || "").trim(),
    updatedAt: String(value.updatedAt || "").trim(),
    expiresAt: String(value.expiresAt || "").trim()
  };
  const validation = validateConversationStateV3(state);
  if (!validation.ok) {
    const error = new TypeError(
      `invalid_conversation_state_v3:${validation.errors.join(",")}`
    );
    error.code = "invalid_conversation_state_v3";
    error.validationErrors = validation.errors;
    throw error;
  }
  return deepFreeze(state);
}

function emptyConversationStateV3(scope, now) {
  return createConversationStateV3({
    ...scope,
    tasks: [],
    createdAt: now,
    updatedAt: now,
    expiresAt: now
  });
}

function legacyScope(value = {}) {
  const scope = value.scope || {};
  return normalizedScope({
    propertyId: scope.propertyId,
    channel: scope.channelId,
    userId: scope.lineUserId
  });
}

function legacyProduct(conditions = {}) {
  const inventory = conditions.inventory || {};
  const entityId = textOrNull(inventory.entityId);
  if (inventory.mode === "bundle_only") {
    return createLodgingProduct({
      productType: "bundle",
      productId: entityId,
      bundleId: entityId
    });
  }
  if (inventory.mode === "room_only" && entityId) {
    return createLodgingProduct({
      productType: "room_type",
      productId: entityId,
      roomTypeId: entityId
    });
  }
  return createLodgingProduct({ productType: "any" });
}

function legacyTaskType(pending, task) {
  const raw = String(
    task && task.type
      || pending && pending.capability
      || "property_fact"
  );
  return LEGACY_TASK_TYPES[raw] || raw;
}

function legacyPendingTasks(state, now) {
  const cycles = new Map(
    (Array.isArray(state.requestCycles) ? state.requestCycles : [])
      .filter((cycle) => cycle && cycle.requestCycleId)
      .map((cycle) => [String(cycle.requestCycleId), cycle])
  );
  const pendings = Array.isArray(state.pendingRequests)
    ? state.pendingRequests
    : state.pendingRequest ? [state.pendingRequest] : [];
  return pendings.flatMap((pending, pendingIndex) => {
    if (!pending || pending.status === "expired" || pending.status === "ended") {
      return [];
    }
    const cycle = cycles.get(String(pending.requestCycleId || ""));
    const conditions = pending.conditions
      || cycle && cycle.confirmedInputs
      || {};
    const product = legacyProduct(conditions);
    const stay = conditions.stay || {};
    const expiresAt = String(
      pending.metadata && pending.metadata.expiresAt
        || cycle && cycle.contextReuseExpiresAt
        || now
    );
    const tasks = Array.isArray(pending.tasks) && pending.tasks.length
      ? pending.tasks
      : [{}];
    return tasks.map((task, taskIndex) => {
      const taskType = legacyTaskType(pending, task);
      const searchRange = stay.searchRange || {};
      const readinessInput = {
        taskType,
        ...product,
        checkIn: stay.checkIn || null,
        checkOut: stay.checkOut || null,
        guestCount: Number.isInteger(stay.guests) ? stay.guests : null,
        searchFrom: searchRange.from || null,
        searchTo: searchRange.to || null
      };
      const readiness = evaluateTaskReadiness(readinessInput);
      const legacyEntity = task && task.entity || {};
      const status = readiness.status === "ready"
        ? "ready"
        : readiness.status === "missing"
          ? "pending"
          : "needs_human";
      return createConversationTaskV3({
        taskId: String(
          pending.requestCycleId && tasks.length === 1
            ? pending.requestCycleId
            : task.taskId
            || pending.pendingRequestId
            || `legacy-${pendingIndex}-${taskIndex}`
        ),
        ...readinessInput,
        entityId: legacyEntity.canonicalCandidate || null,
        entityCategory: legacyEntity.canonicalCandidate
          ? legacyEntity.category || "other"
          : null,
        detailIntent: task && task.detailIntent || "general",
        knownFields: readiness.knownFields,
        missingFields: readiness.missingFields,
        status,
        createdAt: pending.metadata && pending.metadata.createdAt
          || cycle && cycle.createdAt
          || now,
        updatedAt: pending.metadata && pending.metadata.updatedAt
          || cycle && cycle.updatedAt
          || now,
        expiresAt
      });
    });
  });
}

function legacyCycleTasks(state, now) {
  return (Array.isArray(state.requestCycles) ? state.requestCycles : [])
    .filter((cycle) => cycle && cycle.requestCycleId)
    .map((cycle) => {
      const conditions = cycle.confirmedInputs || {};
      const product = legacyProduct(conditions);
      const stay = conditions.stay || {};
      const searchRange = stay.searchRange || {};
      const taskType = LEGACY_TASK_TYPES[
        String(cycle.requestKind || "property_fact")
      ] || String(cycle.requestKind || "property_fact");
      const readinessInput = {
        taskType,
        ...product,
        checkIn: stay.checkIn || null,
        checkOut: stay.checkOut || null,
        guestCount: Number.isInteger(stay.guests) ? stay.guests : null,
        searchFrom: searchRange.from || null,
        searchTo: searchRange.to || null
      };
      const readiness = evaluateTaskReadiness(readinessInput);
      const topic = conditions.topic || {};
      const legacyStatus = String(cycle.status || "");
      let status = readiness.status === "missing"
        ? "pending"
        : readiness.status === "ready"
          ? "ready"
          : "needs_human";
      if (["answered", "resolved"].includes(legacyStatus)
        && readiness.status === "ready") status = "answered";
      if (["ended", "cancelled"].includes(legacyStatus)) status = "cancelled";
      if (legacyStatus === "expired") status = "expired";
      if (["failed", "needs_human"].includes(legacyStatus)) {
        status = "needs_human";
      }
      return createConversationTaskV3({
        taskId: String(cycle.requestCycleId),
        ...readinessInput,
        entityId: topic.canonicalId || product.productId || null,
        entityCategory: topic.category || (
          product.productType === "bundle"
            ? "bundle"
            : product.productType === "room_type"
              ? "room"
              : null
        ),
        detailIntent: topic.detailIntent || "general",
        knownFields: readiness.knownFields,
        missingFields: readiness.missingFields,
        status,
        createdAt: cycle.createdAt || now,
        updatedAt: cycle.updatedAt || now,
        expiresAt: cycle.contextReuseExpiresAt || now
      });
    });
}

function readConversationStateV3(value, scopeValue, now) {
  const scope = normalizedScope(scopeValue);
  if (!validTimestamp(now)) {
    throw new TypeError("conversation_state_v3_now_required");
  }
  if (!value || typeof value !== "object") {
    return emptyConversationStateV3(scope, now);
  }
  if (value.schemaVersion === CONVERSATION_STATE_SCHEMA_VERSION) {
    const validation = validateConversationStateV3(value);
    if (!validation.ok) {
      const error = new TypeError(
        `invalid_conversation_state_v3:${validation.errors.join(",")}`
      );
      error.code = "invalid_conversation_state_v3";
      error.validationErrors = validation.errors;
      throw error;
    }
    const state = normalizedState(value);
    if (!sameScope(state.scope, scope)) {
      return emptyConversationStateV3(scope, now);
    }
    return createConversationStateV3(state);
  }
  if (value.schemaVersion !== 2 || !sameScope(legacyScope(value), scope)) {
    return emptyConversationStateV3(scope, now);
  }
  const tasksById = new Map(
    legacyCycleTasks(value, now).map((task) => [task.taskId, task])
  );
  legacyPendingTasks(value, now).forEach((task) => {
    tasksById.set(task.taskId, task);
  });
  const tasks = [...tasksById.values()];
  const timestamps = tasks.map((task) => task.createdAt);
  const expiries = tasks.map((task) => task.expiresAt);
  return createConversationStateV3({
    ...scope,
    tasks,
    createdAt: timestamps.sort()[0] || now,
    updatedAt: now,
    expiresAt: expiries.sort().at(-1) || now
  });
}

function selectActiveConversationTasks(state, now) {
  if (!state || state.schemaVersion !== CONVERSATION_STATE_SCHEMA_VERSION) {
    return [];
  }
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError("conversation_state_v3_now_required");
  }
  return state.tasks.filter((task) => (
    !["answered", "expired", "cancelled"].includes(task.status)
    && Date.parse(task.expiresAt) > timestamp
  ));
}

module.exports = {
  CONVERSATION_STATE_SCHEMA_VERSION,
  createConversationStateV3,
  createConversationTaskV3,
  readConversationStateV3,
  selectActiveConversationTasks,
  validateConversationStateV3,
  validateConversationTaskV3
};
