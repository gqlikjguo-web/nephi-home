"use strict";

const crypto = require("node:crypto");

const RETENTION_MS = 72 * 60 * 60 * 1000;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 1000;
const TARGET_HASH_PATTERN = /^[a-f0-9]{64}$/;
const TRACE_STAGES = new Set([
  "state_before",
  "planner",
  "validation",
  "context_validation",
  "canonical_request",
  "temporal",
  "context_execution",
  "executor",
  "final_decision",
  "final_response",
  "line_transport"
]);
const SAFE_KEYS = new Set([
  "schemaVersion", "revision", "createdAt", "updatedAt", "expiresAt",
  "taskId", "taskIds", "taskType", "type", "capability", "category", "productType", "productId",
  "roomType", "roomTypeId", "roomTypeSet", "bundleId", "entityId", "entityCategory",
  "canonicalCandidate", "canonicalEntity", "canonicalId", "canonicalSet", "entity", "status", "detailIntent", "confidence",
  "checkIn", "checkOut", "nights", "timezone", "resolutionStatus", "resolutionSource", "temporalState", "stayCandidate", "dateExpression", "dateKey", "kind", "anchor",
  "checkInCandidate", "checkOutCandidate", "nightsCandidate", "guestCountCandidate", "requestedOutputs", "dependsOnStayContext",
  "searchFrom", "searchTo", "guestCount", "guests", "knownFields", "missingFields", "requiredFields",
  "parserSucceeded", "taskCount", "shouldIgnore", "missingInformation", "discourse", "relation", "confidence",
  "acceptedTasks", "rejectedTasks", "rejectionReasons", "finalTasks", "semanticValidation", "repairedTasks", "index", "reason", "errorCategory", "candidates", "candidateIndex",
  "relationKind", "candidateRequestCycleRefCount", "evidenceRefCount", "evidenceSourceMatches",
  "items", "contextAction", "requestCycleId", "action", "reasonCode", "reviewRequired", "needsReview", "failure",
  "failureCode", "stale", "staleReason", "resolved", "resolverId", "resolverCalls", "query", "result",
  "results", "facts", "request", "response", "customerId", "propertyId", "source", "available", "availability", "availabilityReliable", "rooms", "roomTypes", "roomTypeName", "bundles", "dates", "id", "name", "roomId",
  "roomIds", "memberRoomIds", "availableRoomIds", "availableBundleIds", "capacity", "quantity", "enabled",
  "blocked", "blockedDates", "availableDates", "dateFrom", "dateTo", "price", "totalPrice", "queryMode", "operation",
  "dateExpressionPresent", "expressionType", "repairReasonCode", "provenance", "ruleRefs", "fields", "produced",
  "responseMode", "riskLevel", "stayDependency", "shouldReply", "attempted", "delivered", "deliveryErrorCode"
]);
const BLOCKED_KEY_PATTERN = /(secret|token|password|credential|authorization|cookie|database.?url|line.?user|source.?text|evidence|prompt|email|phone|contact|address)/i;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function boundedString(value) {
  return String(value == null ? "" : value).slice(0, MAX_STRING_LENGTH);
}

function safeValue(value, key = "", depth = 0) {
  if (depth > 8 || BLOCKED_KEY_PATTERN.test(key)) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return boundedString(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => safeValue(item, key, depth + 1)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (!SAFE_KEYS.has(childKey) || BLOCKED_KEY_PATTERN.test(childKey)) continue;
    const projected = safeValue(childValue, childKey, depth + 1);
    if (projected !== undefined) output[childKey] = projected;
  }
  return output;
}

function select(source, keys) {
  const output = {};
  for (const key of keys) {
    if (!Object.hasOwn(source || {}, key)) continue;
    const value = safeValue(source[key], key);
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function safePlannerMissingInformation(value) {
  return (Array.isArray(value) ? value : []).slice(0, 20).map((item) => {
    const text = boundedString(item).slice(0, 200);
    return /^formal_subject:/i.test(text) ? "formal_subject_coverage_required" : text;
  });
}

function taskSummary(task) {
  return select(task || {}, [
    "taskId", "taskType", "type", "capability", "category", "productType", "productId", "roomType",
    "roomTypeId", "roomTypeSet", "bundleId", "entityId", "entityCategory", "canonicalCandidate",
    "canonicalEntity", "detailIntent", "checkIn", "checkOut", "nights", "timezone", "resolutionStatus",
    "dateExpression", "searchFrom", "searchTo", "guestCount", "guests", "knownFields", "missingFields",
    "requiredFields", "status", "reasonCode", "responseMode", "riskLevel", "stayDependency", "resolverId",
    "requestedOutputs", "dependsOnStayContext", "entity", "stayCandidate", "confidence"
  ]);
}

function stateBeforeProjection(entry) {
  const state = entry && entry.state && typeof entry.state === "object" ? entry.state : {};
  const tasks = Array.isArray(state.tasks) ? state.tasks.map(taskSummary) : [];
  const explicitPending = Array.isArray(state.pendingRequests) ? state.pendingRequests.map(taskSummary) : [];
  const pending = explicitPending.length ? explicitPending : tasks.filter((task) => task.status === "pending" || task.status === "needs_clarification");
  return {
    ...select(state, ["schemaVersion", "revision", "createdAt", "updatedAt", "expiresAt", "needsReview", "failure", "failureCode", "stale", "staleReason"]),
    tasks,
    pending
  };
}

function diagnosticProjection(stage, entry) {
  if (stage === "state_before") return stateBeforeProjection(entry);
  if (stage === "planner") {
    return {
      ...select(entry, ["parserSucceeded", "taskCount", "discourse", "shouldIgnore", "failure", "failureCode", "providerAttemptCount", "firstAttemptErrorCategory", "finalErrorCategory", "retryPerformed", "retrySucceeded", "taskCollectionRepairPerformed", "preservedTaskCount", "fallbackTaskCount", "coverageRepairPerformed", "coverageRepairSucceeded", "coverageRepairFallback"]),
      missingInformation: safePlannerMissingInformation(entry && entry.missingInformation),
      tasks: Array.isArray(entry.tasks) ? entry.tasks.map(taskSummary) : []
    };
  }
  if (stage === "validation") {
    return {
      acceptedTasks: Array.isArray(entry.acceptedTasks) ? entry.acceptedTasks.map(taskSummary) : [],
      rejectedTasks: Array.isArray(entry.rejectedTasks) ? entry.rejectedTasks.map(taskSummary) : [],
      rejectionReasons: safeValue(entry.rejectionReasons || [], "rejectionReasons"),
      finalTasks: Array.isArray(entry.finalTasks) ? entry.finalTasks.map(taskSummary) : [],
      ...select(entry, ["semanticValidation", "errorCategory"])
    };
  }
  if (stage === "context_validation") return select(entry, ["rejectionReasons", "candidates"]);
  if (stage === "canonical_request") return { items: safeValue(entry.items || [], "items") };
  if (stage === "temporal") return select(entry, ["contextAction", "items"]);
  if (stage === "context_execution") return { items: safeValue(entry.items || [], "items") };
  if (stage === "executor") return select(entry, ["results", "resolverCalls"]);
  return {};
}

function createTestOnlyLineMessageTrace({ enabled = false, testOnly = false, targetPropertyId = "", targetMessageSha256 = "", persistence, now = () => new Date(), onError } = {}) {
  const propertyScope = String(targetPropertyId || "").trim();
  const targetHash = String(targetMessageSha256 || "").trim().toLowerCase();
  const active = enabled === true && testOnly === true && Boolean(propertyScope) && TARGET_HASH_PATTERN.test(targetHash)
    && persistence && typeof persistence.upsertTestOnlyLineTrace === "function"
    && typeof persistence.listTestOnlyLineTraces === "function";
  const byEventId = new Map();
  const byTraceId = new Map();

  function report(error) {
    if (typeof onError === "function") {
      try { onError({ code: "TEST_ONLY_LINE_TRACE_WRITE_FAILED", message: boundedString(error && error.message || "trace_write_failed") }); } catch { /* diagnostics are isolated */ }
    }
  }

  function persist(context, stage, value) {
    if (!context) return false;
    if (stage) context.record.stages[stage] = value;
    context.record.updatedAt = now().toISOString();
    try {
      persistence.upsertTestOnlyLineTrace(structuredClone(context.record));
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }

  function resolve(input = {}) {
    const traceId = boundedString(input.traceId || "");
    const eventId = boundedString(input.eventId || "");
    const context = (traceId && byTraceId.get(traceId)) || (eventId && byEventId.get(eventId));
    if (context && traceId && !context.record.traceId) {
      context.record.traceId = traceId;
      byTraceId.set(traceId, context);
    }
    return context;
  }

  function begin(input = {}) {
    if (!active || sha256(input.messageText) !== targetHash) return false;
    const propertyId = boundedString(input.propertyId || input.customerId || "");
    const eventId = boundedString(input.eventId || "");
    if (propertyId !== propertyScope || !eventId) return false;
    const timestamp = now();
    const context = {
      record: {
        propertyId,
        channelIdHash: sha256(input.channelId),
        eventId,
        eventTimestamp: boundedString(input.eventTimestamp || ""),
        lineUserHash: sha256(input.lineUserId),
        messageTextHash: targetHash,
        traceId: "",
        stages: {},
        expiresAt: new Date(timestamp.getTime() + RETENTION_MS).toISOString(),
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString()
      }
    };
    byEventId.set(eventId, context);
    return persist(context);
  }

  function diagnostic(entry = {}) {
    const stage = String(entry.stage || "");
    if (!active || !TRACE_STAGES.has(stage) || stage === "final_decision" || stage === "final_response" || stage === "line_transport") return false;
    const context = resolve(entry);
    if (!context) return false;
    return persist(context, stage, diagnosticProjection(stage, entry));
  }

  function finalResponse(input = {}) {
    if (!active) return false;
    const context = resolve(input);
    if (!context) return false;
    const decision = select(input.finalDecision || {}, ["action", "reasonCode", "reviewRequired", "needsReview", "failure", "failureCode", "stale", "staleReason"]);
    const response = select(input.finalResponse || {}, ["action", "reasonCode", "shouldReply", "reviewRequired", "needsReview", "failure", "failureCode"]);
    if (input.finalResponse && Object.hasOwn(input.finalResponse, "replyText")) response.replyText = boundedString(input.finalResponse.replyText);
    persist(context, "final_decision", decision);
    return persist(context, "final_response", response);
  }

  function transport(input = {}) {
    if (!active) return false;
    const context = resolve(input);
    if (!context) return false;
    const projected = select(input, ["attempted", "delivered", "reasonCode", "deliveryErrorCode"]);
    if (Object.hasOwn(input, "replyText")) projected.replyText = boundedString(input.replyText);
    return persist(context, "line_transport", projected);
  }

  function list(filters = {}) {
    if (!active) return [];
    const propertyId = boundedString(filters.propertyId || "");
    if (propertyId !== propertyScope) return [];
    return persistence.listTestOnlyLineTraces({
      propertyId,
      eventId: boundedString(filters.eventId || ""),
      traceId: boundedString(filters.traceId || ""),
      messageTextHash: TARGET_HASH_PATTERN.test(String(filters.messageTextHash || "").toLowerCase()) ? String(filters.messageTextHash).toLowerCase() : "",
      now: now().toISOString(),
      limit: Math.min(Math.max(Number(filters.limit) || 20, 1), 20)
    });
  }

  return { active, begin, diagnostic, finalResponse, transport, list };
}

module.exports = { createTestOnlyLineMessageTrace, sha256 };
