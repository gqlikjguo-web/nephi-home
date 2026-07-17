"use strict";

const crypto = require("node:crypto");

const { validatePlannerOutput } = require("./planner-schema");
const { buildPropertyCatalog } = require("./property-catalog");
const { resolveTemporalExpression } = require("./temporal-resolver");
const { migrateStateV2, reduceConversationState } = require("./state-reducer");
const { executeTasks } = require("./capability-executor");
const { buildResponsePlan } = require("./response-planner");
const { composeControlledReply } = require("./controlled-composer");
const { validateClaims } = require("./claim-validator");
const { coverageByStatus, assertTaskCoverage } = require("./task-coverage");
const { resolveEntity } = require("./entity-resolver");

const SAFE_FALLBACK = "這次有部分內容無法安全確認，我會請業者協助；您剛才的問題已經記錄。";

class ConversationEngineV2 {
  constructor({ planner, composer, persistence, getProperty, availability, listPriceOverrides, now = () => new Date(), onDiagnostic }) {
    this.planner = planner; this.composer = composer; this.persistence = persistence; this.getProperty = getProperty; this.availability = availability; this.listPriceOverrides = listPriceOverrides || (() => []); this.now = now; this.onDiagnostic = typeof onDiagnostic === "function" ? onDiagnostic : null;
  }

  trace(traceId, stage, details) { if (this.onDiagnostic) this.onDiagnostic({ traceId, stage, ...details }); }

  async process(input) {
    const traceId = crypto.randomUUID();
    const property = this.getProperty(input.customerId);
    if (!property || property.propertyId !== input.customerId) throw new Error("property_not_found");
    const catalog = buildPropertyCatalog(property);
    const scope = { propertyId: input.customerId, channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, now: this.now().toISOString() };
    const previous = migrateStateV2(this.persistence.getConversationState(input.customerId, input.channelId, input.lineUserId), scope);
    let plannerOutput;
    try { plannerOutput = await this.planner.classify({ currentMessage: input.messageText, currentMessages: input.currentMessages || [input.messageText], eventTimestamp: input.eventTimestamp, catalog, conversationState: previous }); }
    catch { plannerOutput = null; }
    this.trace(traceId, "planner", { taskCount: plannerOutput && Array.isArray(plannerOutput.tasks) ? plannerOutput.tasks.length : 0, tasks: plannerOutput && Array.isArray(plannerOutput.tasks) ? plannerOutput.tasks.map((task) => ({ taskId: task.taskId, type: task.type, sourceText: String(task.sourceText || "").slice(0, 120), canonicalCandidate: task.entity && task.entity.canonicalCandidate || null, confidence: task.confidence })) : [] });
    const validation = validatePlannerOutput(plannerOutput);
    this.trace(traceId, "validation", { acceptedTaskIds: validation.ok ? plannerOutput.tasks.map((task) => task.taskId) : [], rejected: validation.ok ? [] : validation.errors });
    if (!validation.ok) {
      const item = this.persistReview(input, "planner_invalid", "整體訊息無法安全理解，請協助確認。", "");
      return { shouldReply: true, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean) };
    }
    const temporal = resolveTemporalExpression(plannerOutput.stay.dateExpression, {
      eventTimestamp: input.eventTimestamp, timezone: catalog.timezone,
      checkInCandidate: plannerOutput.stay.checkInCandidate, checkOutCandidate: plannerOutput.stay.checkOutCandidate,
      nightsCandidate: plannerOutput.stay.nightsCandidate, previousCheckIn: previous.conditions.stay.checkIn, previousCheckOut: previous.conditions.stay.checkOut
    });
    const operations = [...plannerOutput.stateOperations];
    if (temporal.resolutionStatus === "resolved") {
      if (temporal.checkIn) operations.push({ field: "stay.checkIn", operation: previous.conditions.stay.checkIn ? "replace" : "set", value: temporal.checkIn, sourceText: temporal.originalExpression });
      if (temporal.checkOut) operations.push({ field: "stay.checkOut", operation: previous.conditions.stay.checkOut ? "replace" : "set", value: temporal.checkOut, sourceText: temporal.originalExpression });
      if (temporal.nights) operations.push({ field: "stay.nights", operation: previous.conditions.stay.nights ? "replace" : "set", value: temporal.nights, sourceText: temporal.originalExpression });
      if (temporal.searchRange) operations.push({ field: "stay.searchRange", operation: previous.conditions.stay.searchRange ? "replace" : "set", value: temporal.searchRange, sourceText: temporal.originalExpression });
    }
    const state = reduceConversationState(previous, { ...plannerOutput, stateOperations: operations }, scope);
    this.trace(traceId, "state", { discourse: plannerOutput.discourse, operations: operations.map((item) => ({ field: item.field, operation: item.operation })), conditions: state.conditions });
    this.persistence.setConversationState(input.customerId, input.channelId, input.lineUserId, state);
    this.trace(traceId, "entity_resolution", { tasks: plannerOutput.tasks.map((task) => { const resolved = task.entity && task.entity.rawText ? resolveEntity(catalog, task.entity) : { status: "not_requested" }; return { taskId: task.taskId, status: resolved.status, canonicalId: resolved.entity && resolved.entity.canonicalId || null, candidateCount: resolved.candidates && resolved.candidates.length || 0 }; }) });
    let taskResults = executeTasks({ property, catalog, tasks: plannerOutput.tasks, request: state.conditions, availability: this.availability, priceOverrides: this.listPriceOverrides(input.customerId) });
    const inputTaskIds = plannerOutput.tasks.map((task) => task.taskId);
    let executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    if (!executorCoverage.ok) {
      taskResults = [...taskResults, ...executorCoverage.missingTaskIds.map((taskId) => ({ taskId, type: "unknown", status: "failed", reason: "executor_missing_task", facts: { subject: "這個問題" }, review: true }))];
      executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    }
    this.trace(traceId, "executor", { results: taskResults.map((item) => ({ taskId: item.taskId, status: item.status, reason: item.reason || "" })), coverage: executorCoverage });
    const reviewIds = [];
    for (const result of taskResults.filter((item) => item.review)) {
      const sourceTask = plannerOutput.tasks.find((task) => task.taskId === result.taskId);
      const item = this.persistReview(input, result.reason || result.status, `「${sourceTask && sourceTask.sourceText || "該問題"}」需要業者確認。`, result.taskId);
      if (item.reviewId) reviewIds.push(item.reviewId);
    }
    const responsePlan = buildResponsePlan({ propertyId: input.customerId, taskResults, inputTaskIds, reviewActions: reviewIds.map((reviewId) => ({ reviewId, created: true })) });
    this.trace(traceId, "response_plan", { sectionCount: responsePlan.sections.length, sections: responsePlan.sections.map((section) => ({ taskId: section.taskId, status: section.status, factKeys: Object.keys(section.facts || {}) })), reviewCount: responsePlan.reviewActions.length, coverage: responsePlan.coverageValidation });
    let replyText = composeControlledReply(responsePlan), claimedTaskIds = null;
    if (this.composer && typeof this.composer.compose === "function") {
      try { const composed = await this.composer.compose(responsePlan); replyText = String(composed.replyText || ""); claimedTaskIds = composed.factTaskIds; } catch { /* deterministic composer remains the safe fallback */ }
    }
    let claimValidation = validateClaims(replyText, responsePlan, claimedTaskIds);
    this.trace(traceId, "composer", { outputLength: replyText.length, coveredTaskIds: claimedTaskIds || inputTaskIds, missingTaskIds: claimValidation.missingTaskIds });
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
    return { shouldReply: true, noReply: false, replyText, taskResults, reviewCount: reviewIds.length, reviewIds, claimValidation, state, traceId };
  }

  persistReview(input, reason, note, taskId) {
    return this.persistence.appendMessageLog(input.customerId, { channelId: input.channelId, lineUserId: input.lineUserId, eventId: `${input.eventId}:review:${taskId || reason}`, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: taskId || "unknown", replyType: "scoped_handoff_v2", replyText: "", route: "human_handoff_required", decisionReason: reason, shouldReply: false, noReply: true, humanHandoff: true, needsReview: true, reviewNote: note, status: "pending", processingStatus: "decided" });
  }
}

module.exports = { ConversationEngineV2, SAFE_FALLBACK };
