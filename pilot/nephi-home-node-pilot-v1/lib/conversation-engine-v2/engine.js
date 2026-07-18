"use strict";

const crypto = require("node:crypto");

const { validatePlannerOutput } = require("./planner-schema");
const { buildPropertyCatalog } = require("./property-catalog");
const { resolveTemporalExpression } = require("./temporal-resolver");
const { migrateStateV2, reduceConversationState } = require("./state-reducer");
const { executeTasks } = require("./capability-executor");
const { buildResponsePlan } = require("./response-planner");
const { composeControlledReply, mergeComposedSections } = require("./controlled-composer");
const { validateClaims } = require("./claim-validator");
const { coverageByStatus, assertTaskCoverage } = require("./task-coverage");
const { resolveEntity } = require("./entity-resolver");
const { availabilityTraceSummary } = require("./resolver-adapter");

const DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS = 31;
function dateKeyAt(timestamp, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addUtcDays(dateKey, days) { const value = new Date(`${dateKey}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function traceState(state) { const copy = JSON.parse(JSON.stringify(state || {})); if (copy.scope) delete copy.scope.lineUserId; return copy; }
function isRecentAvailabilityQuestion(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/gu, "");
  return /(?:最近|近期|下一(?:個|天)|最早).{0,12}(?:有房|空房|可住|可訂)|(?:有房|空房|可住|可訂).{0,12}(?:最近|近期|下一|最早)/u.test(text);
}
function normalizePlannerOutput(plannerOutput, { messageText, eventTimestamp, timezone, previousConditions } = {}) {
  const output = { ...plannerOutput, tasks: (plannerOutput.tasks || []).map((task) => ({ ...task, entity: task.entity ? { ...task.entity } : task.entity })) };
  if (!isRecentAvailabilityQuestion(messageText)) return output;
  const dateFrom = previousConditions && previousConditions.stay && previousConditions.stay.searchRange && previousConditions.stay.searchRange.from || dateKeyAt(eventTimestamp, timezone || "Asia/Taipei");
  output.tasks = output.tasks.map((task) => {
    if (!['availability', 'room_options'].includes(task.type)) return task;
    const genericEntity = /^(?:空房|有房|房間|房)$/u.test(String(task.entity && task.entity.rawText || "").trim());
    return { ...task, type: "available_dates", entity: genericEntity ? { ...task.entity, rawText: "", canonicalCandidate: null } : task.entity };
  });
  output.searchRange = { from: dateFrom, to: addUtcDays(dateFrom, DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS) };
  return output;
}

function normalizedPlannerStay(plannerOutput) {
  const stay = {
    ...plannerOutput.stay,
    dateExpression: { ...plannerOutput.stay.dateExpression }
  };
  const scalarCandidates = {
    "stay.checkInCandidate": "checkInCandidate",
    "stay.checkOutCandidate": "checkOutCandidate",
    "stay.nightsCandidate": "nightsCandidate",
    "stay.guestCountCandidate": "guestCountCandidate"
  };
  const expressionFields = {
    "stay.dateExpression.rawText": "rawText",
    "stay.dateExpression.kind": "kind",
    "stay.dateExpression.anchor": "anchor"
  };

  for (const item of plannerOutput.stateOperations || []) {
    if (!item || !["set", "replace"].includes(item.operation)) continue;
    const scalarCandidate = scalarCandidates[item.field];
    if (scalarCandidate && ["set", "replace"].includes(item.operation)) stay[scalarCandidate] = item.value;
    const expressionField = expressionFields[item.field];
    if (expressionField && ["set", "replace"].includes(item.operation)) stay.dateExpression[expressionField] = item.value;
  }

  return stay;
}

const SAFE_FALLBACK = "這次有部分內容無法安全確認，我會請業者協助；您剛才的問題已經記錄。";

class ConversationEngineV2 {
  constructor({ planner, composer, persistence, getProperty, availabilityResolver, availableDatesResolver, listPriceOverrides, now = () => new Date(), onDiagnostic, diagnosticDetail = false }) {
    this.planner = planner; this.composer = composer; this.persistence = persistence; this.getProperty = getProperty; this.availabilityResolver = availabilityResolver; this.availableDatesResolver = availableDatesResolver; this.listPriceOverrides = listPriceOverrides || (() => []); this.now = now; this.onDiagnostic = typeof onDiagnostic === "function" ? onDiagnostic : null; this.diagnosticDetail = Boolean(diagnosticDetail); this.traceContexts = new Map();
  }

  trace(traceId, stage, details) { if (this.onDiagnostic) this.onDiagnostic({ ...(this.diagnosticDetail ? this.traceContexts.get(traceId) : {}), traceId, stage, ...details }); }

  async process(input) {
    const traceId = crypto.randomUUID();
    const property = this.getProperty(input.customerId);
    if (!property || property.propertyId !== input.customerId) throw new Error("property_not_found");
    const catalog = buildPropertyCatalog(property);
    const scope = { propertyId: input.customerId, channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, now: this.now().toISOString() };
    const previous = migrateStateV2(this.persistence.getConversationState(input.customerId, input.channelId, input.lineUserId), scope);
    if (this.diagnosticDetail) this.traceContexts.set(traceId, { timestamp: new Date().toISOString(), correlationId: traceId, eventId: input.eventId, propertyId: input.customerId, userKeyHash: crypto.createHash("sha256").update(String(input.lineUserId || "")).digest("hex").slice(0, 16), messageText: input.messageText });
    if (this.diagnosticDetail) this.trace(traceId, "state_before", { state: traceState(previous) });
    let plannerOutput;
    try { plannerOutput = await this.planner.classify({ currentMessage: input.messageText, currentMessages: input.currentMessages || [input.messageText], eventTimestamp: input.eventTimestamp, catalog, conversationState: previous }); }
    catch { plannerOutput = null; }
    this.trace(traceId, "planner", { taskCount: plannerOutput && Array.isArray(plannerOutput.tasks) ? plannerOutput.tasks.length : 0, tasks: plannerOutput && Array.isArray(plannerOutput.tasks) ? (this.diagnosticDetail ? plannerOutput.tasks : plannerOutput.tasks.map((task) => ({ taskId: task.taskId, type: task.type, sourceText: String(task.sourceText || "").slice(0, 120), canonicalCandidate: task.entity && task.entity.canonicalCandidate || null, confidence: task.confidence }))) : [] });
    const validation = validatePlannerOutput(plannerOutput);
    this.trace(traceId, "validation", { acceptedTaskIds: validation.ok ? plannerOutput.tasks.map((task) => task.taskId) : [], rejected: validation.ok ? [] : validation.errors });
    if (!validation.ok) {
      const item = this.persistReview(input, "planner_invalid", "整體訊息無法安全理解，請協助確認。", "");
      return { shouldReply: true, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean) };
    }
    plannerOutput = normalizePlannerOutput(plannerOutput, { messageText: input.messageText, eventTimestamp: input.eventTimestamp, timezone: catalog.timezone, previousConditions: previous.conditions });
    const plannerStay = normalizedPlannerStay(plannerOutput);
    const temporal = resolveTemporalExpression(plannerStay.dateExpression, {
      eventTimestamp: input.eventTimestamp, timezone: catalog.timezone,
      checkInCandidate: plannerStay.checkInCandidate, checkOutCandidate: plannerStay.checkOutCandidate,
      nightsCandidate: plannerStay.nightsCandidate,
      defaultNights: plannerOutput.tasks.some((task) => ["availability", "bundle_availability", "room_options", "capacity", "price", "total_price"].includes(task.type)) ? 1 : null,
      previousCheckIn: previous.conditions.stay.checkIn, previousCheckOut: previous.conditions.stay.checkOut
    });
    this.trace(traceId, "temporal", {
      operationPaths: plannerOutput.stateOperations.map((item) => item.field),
      dateExpressionPresent: Boolean(plannerStay.dateExpression.rawText && plannerStay.dateExpression.kind !== "none"),
      resolutionStatus: temporal.resolutionStatus,
      produced: { checkIn: Boolean(temporal.checkIn), checkOut: Boolean(temporal.checkOut), nights: Boolean(temporal.nights) }
    });
    const operations = plannerOutput.stateOperations.flatMap((item) => {
      if (item.field === "*" || item.field.startsWith("inventory.")) return [item];
      if (item.field === "stay.guestCountCandidate") return [{ ...item, field: "stay.guests" }];
      if (item.operation === "clear" || item.operation === "keep") {
        const canonicalPath = { "stay.checkInCandidate": "stay.checkIn", "stay.checkOutCandidate": "stay.checkOut", "stay.nightsCandidate": "stay.nights" }[item.field];
        return canonicalPath ? [{ ...item, field: canonicalPath }] : [];
      }
      return [];
    });
    if (temporal.resolutionStatus === "resolved") {
      if (temporal.checkIn) operations.push({ field: "stay.checkIn", operation: previous.conditions.stay.checkIn ? "replace" : "set", value: temporal.checkIn, sourceText: temporal.originalExpression });
      if (temporal.checkOut) operations.push({ field: "stay.checkOut", operation: previous.conditions.stay.checkOut ? "replace" : "set", value: temporal.checkOut, sourceText: temporal.originalExpression });
      if (temporal.nights) operations.push({ field: "stay.nights", operation: previous.conditions.stay.nights ? "replace" : "set", value: temporal.nights, sourceText: temporal.originalExpression });
      if (temporal.searchRange) operations.push({ field: "stay.searchRange", operation: previous.conditions.stay.searchRange ? "replace" : "set", value: temporal.searchRange, sourceText: temporal.originalExpression });
    }
    if (plannerOutput.searchRange) operations.push({ field: "stay.searchRange", operation: previous.conditions.stay.searchRange ? "replace" : "set", value: plannerOutput.searchRange, sourceText: input.messageText });
    const state = reduceConversationState(previous, { ...plannerOutput, stateOperations: operations }, scope);
    this.trace(traceId, "state", { discourse: plannerOutput.discourse, operations: operations.map((item) => ({ field: item.field, operation: item.operation })), conditions: state.conditions, ...(this.diagnosticDetail ? { stateAfter: traceState(state) } : {}) });
    this.persistence.setConversationState(input.customerId, input.channelId, input.lineUserId, state);
    this.trace(traceId, "entity_resolution", { tasks: plannerOutput.tasks.map((task) => { const resolved = task.entity && task.entity.rawText ? resolveEntity(catalog, task.entity) : { status: "not_requested" }; return this.diagnosticDetail ? { taskId: task.taskId, resolved } : { taskId: task.taskId, status: resolved.status, canonicalId: resolved.entity && resolved.entity.canonicalId || null, candidateCount: resolved.candidates && resolved.candidates.length || 0 }; }) });
    const resolverCalls = [];
    const tracedAvailabilityResolver = (request) => { const result = this.availabilityResolver(request); resolverCalls.push(availabilityTraceSummary(request, result)); return result; };
    const tracedAvailableDatesResolver = (request) => { const result = this.availableDatesResolver(request); resolverCalls.push(availabilityTraceSummary(request, result)); return result; };
    let taskResults = executeTasks({ property, catalog, tasks: plannerOutput.tasks, request: state.conditions, availabilityResolver: tracedAvailabilityResolver, availableDatesResolver: tracedAvailableDatesResolver, priceOverrides: this.listPriceOverrides(input.customerId) });
    const inputTaskIds = plannerOutput.tasks.map((task) => task.taskId);
    let executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    if (!executorCoverage.ok) {
      taskResults = [...taskResults, ...executorCoverage.missingTaskIds.map((taskId) => ({ taskId, type: "unknown", status: "failed", reason: "executor_missing_task", facts: { subject: "這個問題" }, review: true }))];
      executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    }
    this.trace(traceId, "executor", { results: this.diagnosticDetail ? taskResults : taskResults.map((item) => ({ taskId: item.taskId, status: item.status, reason: item.reason || "" })), resolverCalls: this.diagnosticDetail ? resolverCalls : undefined, coverage: executorCoverage });
    const reviewIds = [];
    for (const result of taskResults.filter((item) => item.review)) {
      const sourceTask = plannerOutput.tasks.find((task) => task.taskId === result.taskId);
      const item = this.persistReview(input, result.reason || result.status, `「${sourceTask && sourceTask.sourceText || "該問題"}」需要業者確認。`, result.taskId);
      if (item.reviewId) reviewIds.push(item.reviewId);
    }
    const responsePlan = buildResponsePlan({ propertyId: input.customerId, taskResults, inputTaskIds, reviewActions: reviewIds.map((reviewId) => ({ reviewId, created: true })) });
    this.trace(traceId, "response_plan", { sectionCount: responsePlan.sections.length, sections: this.diagnosticDetail ? responsePlan.sections : responsePlan.sections.map((section) => ({ taskId: section.taskId, status: section.status, factKeys: Object.keys(section.facts || {}) })), reviewCount: responsePlan.reviewActions.length, coverage: responsePlan.coverageValidation });
    const deterministicReply = composeControlledReply(responsePlan);
    let replyText = deterministicReply, claimedTaskIds = null, composedSections = null;
    let composerSource = "deterministic", fallbackOccurred = false, rejectionReasonCodes = [];
    if (this.composer && typeof this.composer.compose === "function") {
      try {
        const composed = mergeComposedSections(responsePlan, await this.composer.compose(responsePlan));
        if (composed.ok) {
          const adoptionValidation = validateClaims(composed.replyText, responsePlan, composed.factTaskIds, composed.sections);
          if (adoptionValidation.ok) {
            replyText = composed.replyText; claimedTaskIds = composed.factTaskIds; composedSections = composed.sections; composerSource = "openai";
          } else rejectionReasonCodes = adoptionValidation.errors;
        } else rejectionReasonCodes = composed.errors;
      } catch { rejectionReasonCodes = ["composer_exception"]; }
      fallbackOccurred = composerSource !== "openai";
    }
    let claimValidation = validateClaims(replyText, responsePlan, claimedTaskIds, composedSections);
    this.trace(traceId, "composer", { outputLength: replyText.length, coveredTaskIds: claimedTaskIds || inputTaskIds, missingTaskIds: claimValidation.missingTaskIds, composerSource, validationResult: rejectionReasonCodes.length ? "rejected" : "accepted", rejectionReasonCodes, fallbackOccurred, ...(this.diagnosticDetail ? { composerInput: responsePlan, finalOutput: replyText } : {}), sections: responsePlan.sections.map((section) => ({ taskId: section.taskId, responseMode: section.responseMode, type: section.type })) });
    if (!claimValidation.ok) {
      const reason = claimValidation.errors.includes("incomplete_task_coverage") ? "composer_incomplete_coverage" : "claim_validation_failed";
      const item = this.persistReview(input, reason, "回覆未完整涵蓋所有問題，已改用安全完整回覆。", "");
      if (item.reviewId) reviewIds.push(item.reviewId);
      replyText = composeControlledReply(responsePlan);
      claimValidation = validateClaims(replyText, responsePlan, inputTaskIds);
    }
    this.trace(traceId, "claim_validator", { errors: claimValidation.errors, coveredTaskIds: claimValidation.coveredTaskIds, missingTaskIds: claimValidation.missingTaskIds });
    const messageRecord = { channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: "multi_task_v2", replyType: "controlled_reply_v2", replyText, route: "planner_v2", shouldReply: true, noReply: false, needsReview: false, status: "resolved", processingStatus: "decided" };
    if (typeof this.persistence.updateMessageEvent === "function") this.persistence.updateMessageEvent(input.customerId, input.channelId, input.eventId, messageRecord);
    else this.persistence.appendMessageLog(input.customerId, messageRecord);
    this.trace(traceId, "line_ready", { coveredTaskIds: claimValidation.coveredTaskIds, missingTaskIds: claimValidation.missingTaskIds, replyLength: replyText.length });
    this.traceContexts.delete(traceId); return { shouldReply: true, noReply: false, replyText, taskResults, reviewCount: reviewIds.length, reviewIds, claimValidation, state, traceId };
  }

  persistReview(input, reason, note, taskId) {
    return this.persistence.appendMessageLog(input.customerId, { channelId: input.channelId, lineUserId: input.lineUserId, eventId: `${input.eventId}:review:${taskId || reason}`, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: taskId || "unknown", replyType: "scoped_handoff_v2", replyText: "", route: "human_handoff_required", decisionReason: reason, shouldReply: false, noReply: true, humanHandoff: true, needsReview: true, reviewNote: note, status: "pending", processingStatus: "decided" });
  }
}

module.exports = { ConversationEngineV2, SAFE_FALLBACK, normalizePlannerOutput, isRecentAvailabilityQuestion, DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS };
