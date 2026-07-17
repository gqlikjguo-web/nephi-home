"use strict";

const { validatePlannerOutput } = require("./planner-schema");
const { buildPropertyCatalog } = require("./property-catalog");
const { resolveTemporalExpression } = require("./temporal-resolver");
const { migrateStateV2, reduceConversationState } = require("./state-reducer");
const { executeTasks } = require("./capability-executor");
const { buildResponsePlan } = require("./response-planner");
const { composeControlledReply } = require("./controlled-composer");
const { validateClaims } = require("./claim-validator");

const SAFE_FALLBACK = "這次有部分內容無法安全確認，我會請業者協助；您剛才的問題已經記錄。";

class ConversationEngineV2 {
  constructor({ planner, composer, persistence, getProperty, availability, listPriceOverrides, now = () => new Date() }) {
    this.planner = planner; this.composer = composer; this.persistence = persistence; this.getProperty = getProperty; this.availability = availability; this.listPriceOverrides = listPriceOverrides || (() => []); this.now = now;
  }

  async process(input) {
    const property = this.getProperty(input.customerId);
    if (!property || property.propertyId !== input.customerId) throw new Error("property_not_found");
    const catalog = buildPropertyCatalog(property);
    const scope = { propertyId: input.customerId, channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, now: this.now().toISOString() };
    const previous = migrateStateV2(this.persistence.getConversationState(input.customerId, input.channelId, input.lineUserId), scope);
    let plannerOutput;
    try { plannerOutput = await this.planner.classify({ currentMessage: input.messageText, currentMessages: input.currentMessages || [input.messageText], eventTimestamp: input.eventTimestamp, catalog, conversationState: previous }); }
    catch { plannerOutput = null; }
    const validation = validatePlannerOutput(plannerOutput);
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
    this.persistence.setConversationState(input.customerId, input.channelId, input.lineUserId, state);
    const taskResults = executeTasks({ property, catalog, tasks: plannerOutput.tasks, request: state.conditions, availability: this.availability, priceOverrides: this.listPriceOverrides(input.customerId) });
    const reviewIds = [];
    for (const result of taskResults.filter((item) => item.review)) {
      const sourceTask = plannerOutput.tasks.find((task) => task.taskId === result.taskId);
      const item = this.persistReview(input, result.reason || result.status, `「${sourceTask && sourceTask.sourceText || "該問題"}」需要業者確認。`, result.taskId);
      if (item.reviewId) reviewIds.push(item.reviewId);
    }
    const responsePlan = buildResponsePlan({ propertyId: input.customerId, taskResults, reviewActions: reviewIds.map((reviewId) => ({ reviewId, created: true })) });
    let replyText = composeControlledReply(responsePlan), claimedTaskIds = null;
    if (this.composer && typeof this.composer.compose === "function") {
      try { const composed = await this.composer.compose(responsePlan); replyText = String(composed.replyText || ""); claimedTaskIds = composed.factTaskIds; } catch { /* deterministic composer remains the safe fallback */ }
    }
    let claimValidation = validateClaims(replyText, responsePlan, claimedTaskIds);
    if (!claimValidation.ok) {
      const item = this.persistReview(input, "claim_validation_failed", "回覆安全驗證失敗。", "");
      if (item.reviewId) reviewIds.push(item.reviewId);
      replyText = SAFE_FALLBACK;
      claimValidation = validateClaims(replyText, responsePlan);
    }
    const messageRecord = { channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: "multi_task_v2", replyType: "controlled_reply_v2", replyText, route: "planner_v2", shouldReply: true, noReply: false, needsReview: false, status: "resolved", processingStatus: "decided" };
    if (typeof this.persistence.updateMessageEvent === "function") this.persistence.updateMessageEvent(input.customerId, input.channelId, input.eventId, messageRecord);
    else this.persistence.appendMessageLog(input.customerId, messageRecord);
    return { shouldReply: true, noReply: false, replyText, taskResults, reviewCount: reviewIds.length, reviewIds, claimValidation, state };
  }

  persistReview(input, reason, note, taskId) {
    return this.persistence.appendMessageLog(input.customerId, { channelId: input.channelId, lineUserId: input.lineUserId, eventId: `${input.eventId}:review:${taskId || reason}`, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: taskId || "unknown", replyType: "scoped_handoff_v2", replyText: "", route: "human_handoff_required", decisionReason: reason, shouldReply: false, noReply: true, humanHandoff: true, needsReview: true, reviewNote: note, status: "pending", processingStatus: "decided" });
  }
}

module.exports = { ConversationEngineV2, SAFE_FALLBACK };
