"use strict";

const crypto = require("node:crypto");

const { validatePlannerOutput, applyPlannerSemanticContract, normalizeEligibilityEvidence } = require("./planner-schema");
const { normalizeDetailIntent } = require("./detail-intent");
const { buildPropertyCatalog } = require("./property-catalog");
const { resolveTemporalExpression, inferExplicitTemporalExpression, canonicalizeTemporalInput } = require("./temporal-resolver");
const { migrateStateV2, reduceConversationState } = require("./state-reducer");
const { executeTasks, isGenericAvailabilityEntity } = require("./capability-executor");
const { buildResponsePlan } = require("./response-planner");
const { composeControlledReply, mergeComposedSections } = require("./controlled-composer");
const { validateClaims } = require("./claim-validator");
const { coverageByStatus, assertTaskCoverage } = require("./task-coverage");
const { resolveEntity } = require("./entity-resolver");
const { availabilityTraceSummary } = require("./resolver-adapter");
const { createPendingRequest, pendingFromResults, resumePendingRequest } = require("./pending-request");

const DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS = 31;
const NON_ACTIONABLE_TASK_TYPES = new Set(["unknown"]);
function dateKeyAt(timestamp, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addUtcDays(dateKey, days) { const value = new Date(`${dateKey}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function traceState(state) { const copy = JSON.parse(JSON.stringify(state || {})); if (copy.scope) delete copy.scope.lineUserId; return copy; }
function plannerTaskTrace(task) {
  const entity = task && task.entity || {};
  return {
    taskId: String(task && task.taskId || "").slice(0, 80),
    type: String(task && task.type || "").slice(0, 80),
    category: String(entity.category || "").slice(0, 80),
    canonicalCandidate: entity.canonicalCandidate === null || entity.canonicalCandidate === undefined
      ? null
      : String(entity.canonicalCandidate).slice(0, 120),
    detailIntent: String(task && task.detailIntent || "").slice(0, 80)
  };
}
function plannerValidationTrace(plannerOutput, validation) {
  const tasks = Array.isArray(plannerOutput && plannerOutput.tasks) ? plannerOutput.tasks : [];
  const summaries = tasks.map(plannerTaskTrace);
  const reasons = Array.isArray(validation && validation.errors) ? validation.errors.map(String) : [];
  if (validation && validation.ok) {
    return { acceptedTasks: summaries, rejectedTasks: [], rejectionReasons: [], finalTasks: summaries };
  }
  return {
    acceptedTasks: [],
    rejectedTasks: summaries.map((task, index) => {
      const taskReasons = reasons.filter((reason) => reason === `tasks.${index}` || reason.startsWith(`tasks.${index}.`));
      return { ...task, reasons: taskReasons.length ? taskReasons : reasons };
    }),
    rejectionReasons: reasons,
    finalTasks: []
  };
}
function applyAvailableDatesDefaults(plannerOutput, { messageText, eventTimestamp, timezone, allowDefaultSearchRange = true } = {}) {
  const output = { ...plannerOutput, tasks: (plannerOutput.tasks || []).map((task) => ({ ...task, entity: task.entity ? { ...task.entity } : task.entity })) };
  const availableDatesRequested = output.tasks.some((task) => task.type === "available_dates");
  const genericAvailability = output.tasks.some((task) => isGenericAvailabilityEntity(task));
  const genericAvailableDates = output.tasks.some((task) => task.type === "available_dates" && isGenericAvailabilityEntity(task));
  const freshAvailabilityRequest = availableDatesRequested || (genericAvailability && ["new_request", "new_topic"].includes(output.discourse && output.discourse.relation));
  if (availableDatesRequested && !output.searchRange && allowDefaultSearchRange) {
    const dateFrom = dateKeyAt(eventTimestamp, timezone || "Asia/Taipei");
    output.tasks = output.tasks.map((task) => {
      if (task.type !== "available_dates" || !isGenericAvailabilityEntity(task)) return task;
      return { ...task, entity: { ...task.entity, rawText: "", canonicalCandidate: null } };
    });
    output.searchRange = { from: dateFrom, to: addUtcDays(dateFrom, DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS) };
  }
  if (freshAvailabilityRequest && (genericAvailableDates || genericAvailability)) {
    output.stateOperations = [...(output.stateOperations || []).filter((item) => !["inventory.mode", "inventory.entityId"].includes(item.field)),
      { field: "inventory.mode", operation: "replace", value: "any", sourceText: String(messageText || "") },
      { field: "inventory.entityId", operation: "clear", value: null, sourceText: String(messageText || "") }];
  }
  return output;
}

function normalizePlannerOutput(plannerOutput, { messageText, eventTimestamp, timezone, deferAvailableDatesDefaults = false } = {}) {
  if (!plannerOutput || typeof plannerOutput !== "object" || Array.isArray(plannerOutput) || !Array.isArray(plannerOutput.tasks)) return null;
  const output = { ...plannerOutput, tasks: (plannerOutput.tasks || []).map((task) => ({ ...task, detailIntent: normalizeDetailIntent(task.detailIntent), eligibilityEvidence: normalizeEligibilityEvidence(task.eligibilityEvidence), entity: task.entity ? { ...task.entity } : task.entity })) };
  return deferAvailableDatesDefaults
    ? output
    : applyAvailableDatesDefaults(output, { messageText, eventTimestamp, timezone });
}

function normalizedPlannerStay(plannerOutput, messageText) {
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

  if ((!stay.dateExpression.rawText || stay.dateExpression.kind === "none") && (plannerOutput.tasks || []).some((task) => task.dependsOnStayContext)) {
    const inferred = inferExplicitTemporalExpression(messageText);
    if (inferred) stay.dateExpression = inferred;
  }

  stay.canonicalTemporal = canonicalizeTemporalInput(stay);
  return stay;
}

function canonicalTurnOperations(plannerOutput, temporal, previousConditions) {
  const operations = (plannerOutput.stateOperations || []).flatMap((item) => {
    if (item.field === "*" || item.field.startsWith("inventory.")) return [item];
    if (item.field === "stay.guestCountCandidate") return [{ ...item, field: "stay.guests" }];
    if (item.field === "stay.nightsCandidate" && ["set", "replace"].includes(item.operation)) return [{ ...item, field: "stay.nights" }];
    if (item.operation === "clear" || item.operation === "keep") {
      const canonicalPath = { "stay.checkInCandidate": "stay.checkIn", "stay.checkOutCandidate": "stay.checkOut", "stay.nightsCandidate": "stay.nights" }[item.field];
      return canonicalPath ? [{ ...item, field: canonicalPath }] : [];
    }
    return [];
  });
  if (temporal.resolutionStatus === "resolved") {
    if (temporal.checkIn) operations.push({ field: "stay.checkIn", operation: previousConditions.stay.checkIn ? "replace" : "set", value: temporal.checkIn, sourceText: temporal.originalExpression });
    if (temporal.checkOut) operations.push({ field: "stay.checkOut", operation: previousConditions.stay.checkOut ? "replace" : "set", value: temporal.checkOut, sourceText: temporal.originalExpression });
    if (temporal.nights) operations.push({ field: "stay.nights", operation: previousConditions.stay.nights ? "replace" : "set", value: temporal.nights, sourceText: temporal.originalExpression });
    if (temporal.searchRange) operations.push({ field: "stay.searchRange", operation: previousConditions.stay.searchRange ? "replace" : "set", value: temporal.searchRange, sourceText: temporal.originalExpression });
  }
  if (temporal.resolutionStatus === "invalid" && temporal.originalExpression) {
    for (const field of ["stay.checkIn", "stay.checkOut", "stay.searchRange"]) {
      operations.push({ field, operation: "clear", value: null, sourceText: temporal.originalExpression });
    }
  }
  return operations;
}

function pendingClarificationQuestion(fields) {
  const labels = {
    "stay.checkIn": "\u5165\u4f4f\u65e5\u671f",
    "stay.checkOut": "\u9000\u623f\u65e5\u671f",
    "stay.nights": "\u4f4f\u5bbf\u665a\u6578",
    "stay.guests": "\u5165\u4f4f\u4eba\u6578",
    "stay.searchRange": "\u65e5\u671f\u7bc4\u570d",
    "inventory.mode": "\u4f4f\u5bbf\u985e\u578b",
    "inventory.entityId": "\u623f\u578b",
    "inventory.features": "\u623f\u9593\u9700\u6c42"
  };
  const names = (fields || []).map((field) => labels[field]).filter(Boolean);
  return names.length ? `\u9084\u9700\u8981\u88dc\u5145${names.join("\u3001")}\u3002` : "";
}

function derivedStayOperations(previousConditions, operations) {
  const stay = { ...(previousConditions.stay || {}) };
  for (const item of operations) {
    if (!item || !item.field.startsWith("stay.")) continue;
    const field = item.field.split(".")[1];
    if (item.operation === "clear") stay[field] = null;
    else if (["set", "replace"].includes(item.operation)) stay[field] = item.value;
  }
  if (stay.checkIn && Number.isInteger(stay.nights) && stay.nights > 0 && !stay.checkOut) {
    return [{ field: "stay.checkOut", operation: "set", value: addUtcDays(stay.checkIn, stay.nights), sourceText: "" }];
  }
  return [];
}

function plannerDateTrace(stay = {}) {
  stay = stay || {};
  const expression = stay.dateExpression || {};
  return {
    dateExpression: {
      rawTextPresent: Boolean(expression.rawText),
      kind: String(expression.kind || "none").slice(0, 40),
      anchor: String(expression.anchor || "none").slice(0, 40)
    },
    candidates: {
      checkIn: stay.checkInCandidate ? String(stay.checkInCandidate).slice(0, 10) : null,
      checkOut: stay.checkOutCandidate ? String(stay.checkOutCandidate).slice(0, 10) : null,
      nights: Number.isInteger(stay.nightsCandidate) ? stay.nightsCandidate : null,
      guests: Number.isInteger(stay.guestCountCandidate) ? stay.guestCountCandidate : null
    }
  };
}

const SAFE_FALLBACK = "這次有部分內容無法安全確認，我會請業者協助；您剛才的問題已經記錄。";
const FINAL_DECISION_TYPES = new Set(["reply", "clarification", "human_handoff", "no_reply"]);

function createFinalDecision({ type, reasonCode, approvedTaskResults = [], clarificationFields = [], handoffReason = "", handoffReasons = {}, sectionModes = {} }) {
  if (!FINAL_DECISION_TYPES.has(type)) throw new Error("invalid_final_decision_type");
  return {
    type,
    reasonCode: String(reasonCode || "engine_decision"),
    shouldReply: type !== "no_reply",
    approvedTaskResults: Array.isArray(approvedTaskResults) ? approvedTaskResults : [],
    clarificationFields: [...new Set((clarificationFields || []).map(String))],
    handoffReason: String(handoffReason || ""),
    handoffReasons: { ...handoffReasons },
    sectionModes: { ...sectionModes }
  };
}

function decideTaskResults(taskResults) {
  const approvedTaskResults = Array.isArray(taskResults) ? taskResults : [];
  const sectionModes = {};
  const clarificationFields = [];
  const handoffReasons = {};
  let hasAnswer = false;
  let hasClarification = false;
  let hasHandoff = false;
  for (const result of approvedTaskResults) {
    if (result.status === "answered") {
      sectionModes[result.taskId] = "answer";
      hasAnswer = true;
    } else if (result.status === "needs_clarification") {
      sectionModes[result.taskId] = "clarification";
      clarificationFields.push(...(result.missingInputs || []));
      hasClarification = true;
    } else {
      sectionModes[result.taskId] = "handoff";
      handoffReasons[result.taskId] = String(result.reason || result.status || "property_confirmation_required");
      hasHandoff = true;
    }
  }
  const type = hasAnswer ? "reply" : hasClarification ? "clarification" : "human_handoff";
  const handoffReason = Object.values(handoffReasons)[0] || (hasHandoff ? "property_confirmation_required" : "");
  return createFinalDecision({
    type,
    reasonCode: `${type}_task_results`,
    approvedTaskResults,
    clarificationFields,
    handoffReason,
    handoffReasons,
    sectionModes
  });
}

function exceptionDecision(reasonCode, approvedTaskResults = []) {
  return createFinalDecision({
    type: "human_handoff",
    reasonCode,
    approvedTaskResults,
    handoffReason: reasonCode
  });
}

class ConversationEngineV2 {
  constructor({ planner, composer, persistence, getProperty, availabilityResolver, availableDatesResolver, listPriceOverrides, now = () => new Date(), onDiagnostic, diagnosticDetail = false, diagnosticMetadata = {} }) {
    this.planner = planner; this.composer = composer; this.persistence = persistence; this.getProperty = getProperty; this.availabilityResolver = availabilityResolver; this.availableDatesResolver = availableDatesResolver; this.listPriceOverrides = listPriceOverrides || (() => []); this.now = now; this.onDiagnostic = typeof onDiagnostic === "function" ? onDiagnostic : null; this.diagnosticDetail = Boolean(diagnosticDetail); this.diagnosticMetadata = diagnosticMetadata || {}; this.traceContexts = new Map();
  }

  trace(traceId, stage, details) { if (this.onDiagnostic) this.onDiagnostic({ ...(this.traceContexts.get(traceId) || {}), traceId, stage, ...details }); }

  async process(input) {
    const traceId = crypto.randomUUID();
    const property = this.getProperty(input.customerId);
    if (!property || property.propertyId !== input.customerId) throw new Error("property_not_found");
    const scope = { propertyId: input.customerId, channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, now: this.now().toISOString() };
    const previous = migrateStateV2(this.persistence.getConversationState(input.customerId, input.channelId, input.lineUserId), scope);
    this.traceContexts.set(traceId, { timestamp: new Date().toISOString(), correlationId: traceId, eventId: input.eventId, propertyId: input.customerId, ...(this.diagnosticDetail ? { userKeyHash: crypto.createHash("sha256").update(String(input.lineUserId || "")).digest("hex").slice(0, 16), messageText: input.messageText } : {}) });
    const catalog = buildPropertyCatalog(property);
    this.trace(traceId, "property_catalog", { providerType: this.diagnosticMetadata.providerType || "unknown", location: catalog.locationDiagnostics || { source: "none", profileValuePresent: false, transportValuePresent: false, urlValidation: "fail" } });
    if (this.diagnosticDetail) this.trace(traceId, "state_before", { state: traceState(previous) });
    let plannerOutput, parserSucceeded = false;
    try {
      plannerOutput = await this.planner.classify({ currentMessage: input.messageText, currentMessages: input.currentMessages || [input.messageText], eventTimestamp: input.eventTimestamp, catalog, conversationState: previous });
      parserSucceeded = true;
    } catch { plannerOutput = null; }
    this.trace(traceId, "planner", {
      parserSucceeded,
      taskCount: plannerOutput && Array.isArray(plannerOutput.tasks) ? plannerOutput.tasks.length : 0,
      discourse: plannerOutput && plannerOutput.discourse || null,
      shouldIgnore: Boolean(plannerOutput && plannerOutput.shouldIgnore),
      missingInformation: plannerOutput && Array.isArray(plannerOutput.missingInformation) ? plannerOutput.missingInformation.map(String).slice(0, 20) : [],
      ...plannerDateTrace(plannerOutput && plannerOutput.stay),
      tasks: plannerOutput && Array.isArray(plannerOutput.tasks)
        ? (this.diagnosticDetail ? plannerOutput.tasks : plannerOutput.tasks.map(plannerTaskTrace))
        : []
    });
    if (!plannerOutput || typeof plannerOutput !== "object" || Array.isArray(plannerOutput) || !Array.isArray(plannerOutput.tasks)) {
      this.trace(traceId, "validation", { acceptedTasks: [], rejectedTasks: [], rejectionReasons: [parserSucceeded ? "planner_output_unusable" : "planner_parse_failed"], finalTasks: [] });
      this.trace(traceId, "fallback", { reasonCode: parserSucceeded ? "planner_output_unusable" : "planner_parse_failed", branch: "planner_input_guard" });
      const finalDecision = exceptionDecision("planner_empty_output");
      this.trace(traceId, "final_decision", { decision: finalDecision.type, reasonCode: finalDecision.reasonCode });
      const item = this.persistReview(input, "planner_empty_output", "Planner did not produce a usable task result.", "");
      this.traceContexts.delete(traceId);
      return { finalDecision, shouldReply: finalDecision.shouldReply, noReply: false, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean), traceId };
    }
    plannerOutput = normalizePlannerOutput(plannerOutput, {
      messageText: input.messageText,
      eventTimestamp: input.eventTimestamp,
      timezone: catalog.timezone,
      deferAvailableDatesDefaults: true
    });
    if (!plannerOutput) {
      this.trace(traceId, "validation", { acceptedTasks: [], rejectedTasks: [], rejectionReasons: ["planner_normalization_failed"], finalTasks: [] });
      this.trace(traceId, "fallback", { reasonCode: "planner_normalization_failed", branch: "planner_normalization_guard" });
      const finalDecision = exceptionDecision("planner_normalization_failed");
      this.trace(traceId, "final_decision", { decision: finalDecision.type, reasonCode: finalDecision.reasonCode });
      const item = this.persistReview(input, "planner_normalization_failed", "Planner output could not be normalized safely.", "");
      this.traceContexts.delete(traceId);
      return { finalDecision, shouldReply: finalDecision.shouldReply, noReply: false, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean), traceId };
    }
    const structuralValidation = validatePlannerOutput(plannerOutput);
    if (!structuralValidation.ok) {
      this.trace(traceId, "validation", plannerValidationTrace(plannerOutput, structuralValidation));
      this.trace(traceId, "fallback", { reasonCode: "planner_schema_invalid", branch: "structural_validation" });
      const finalDecision = exceptionDecision("planner_invalid");
      this.trace(traceId, "final_decision", { decision: finalDecision.type, reasonCode: finalDecision.reasonCode });
      const item = this.persistReview(input, "planner_invalid", "整體訊息無法安全理解，請協助確認。", "");
      this.traceContexts.delete(traceId);
      return { finalDecision, shouldReply: finalDecision.shouldReply, noReply: false, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean), traceId };
    }
    const semanticInputTasks = plannerOutput.tasks.map(plannerTaskTrace);
    plannerOutput = applyPlannerSemanticContract(plannerOutput, { catalog });
    const validation = validatePlannerOutput(plannerOutput);
    this.trace(traceId, "validation", { ...plannerValidationTrace(plannerOutput, validation), semanticValidation: plannerOutput.semanticValidation });
    this.trace(traceId, "semantic_contract", { inputTasks: semanticInputTasks, outputTasks: plannerOutput.tasks.map(plannerTaskTrace), shouldIgnore: plannerOutput.shouldIgnore, validationPassed: validation.ok, semanticValidation: plannerOutput.semanticValidation });
    if (!validation.ok) {
      this.trace(traceId, "fallback", { reasonCode: "planner_semantic_validation_failed", branch: "semantic_validation" });
      const finalDecision = exceptionDecision("planner_semantic_repair_invalid");
      this.trace(traceId, "final_decision", { decision: finalDecision.type, reasonCode: finalDecision.reasonCode });
      const item = this.persistReview(input, "planner_semantic_repair_invalid", "Planner task could not be repaired safely.", "");
      this.traceContexts.delete(traceId);
      return { finalDecision, shouldReply: finalDecision.shouldReply, noReply: false, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean), traceId };
    }
    const hasActionableTask = plannerOutput.tasks.some((task) => !NON_ACTIONABLE_TASK_TYPES.has(task.type));
    const unknownTaskCount = plannerOutput.tasks.filter((task) => NON_ACTIONABLE_TASK_TYPES.has(task.type)).length;
    const noReplyGateHit = Boolean(plannerOutput.shouldIgnore && !hasActionableTask);
    const plannerStay = normalizedPlannerStay(plannerOutput, input.messageText);
    const pendingRequiresNights = Boolean(previous.pendingRequest && previous.pendingRequest.missingFields.includes("stay.nights"));
    const temporal = resolveTemporalExpression(plannerStay.dateExpression, {
      eventTimestamp: input.eventTimestamp,
      timezone: catalog.timezone,
      canonicalTemporal: plannerStay.canonicalTemporal,
      checkInCandidate: plannerStay.checkInCandidate,
      checkOutCandidate: plannerStay.checkOutCandidate,
      nightsCandidate: plannerStay.nightsCandidate,
      defaultNights: !pendingRequiresNights && [
        ...(plannerOutput.tasks || []),
        ...(previous.pendingRequest && previous.pendingRequest.tasks || [])
      ].some((task) => ["availability", "bundle_availability", "room_options", "capacity", "price", "total_price"].includes(task.type)) ? 1 : null,
      previousCheckIn: previous.conditions.stay.checkIn,
      previousCheckOut: previous.conditions.stay.checkOut
    });
    const explicitSearchRange = plannerStay.dateExpression.kind === "range" && temporal.checkIn && temporal.checkOut
      ? { from: temporal.checkIn, to: temporal.checkOut }
      : temporal.searchRange;
    let operations = canonicalTurnOperations(plannerOutput, temporal, previous.conditions);
    if (explicitSearchRange && !operations.some((item) => item.field === "stay.searchRange")) {
      operations.push({ field: "stay.searchRange", operation: previous.conditions.stay.searchRange ? "replace" : "set", value: explicitSearchRange, sourceText: temporal.originalExpression });
    }
    this.trace(traceId, "temporal", {
      operationPaths: plannerOutput.stateOperations.map((item) => item.field),
      input: {
        ...plannerDateTrace(plannerStay),
        previousCheckInPresent: Boolean(previous.conditions.stay.checkIn),
        previousCheckOutPresent: Boolean(previous.conditions.stay.checkOut)
      },
      output: {
        resolutionStatus: temporal.resolutionStatus,
        ambiguity: temporal.ambiguity || null,
        dateIntentStatus: temporal.dateIntentStatus,
        checkIn: temporal.checkIn || null,
        checkOut: temporal.checkOut || null,
        nights: temporal.nights || null,
        searchRange: explicitSearchRange || null
      },
      dateExpressionPresent: Boolean(plannerStay.dateExpression.rawText && plannerStay.dateExpression.kind !== "none"),
      resolutionStatus: temporal.resolutionStatus,
      produced: { checkIn: Boolean(temporal.checkIn), checkOut: Boolean(temporal.checkOut), nights: Boolean(temporal.nights), searchRange: Boolean(explicitSearchRange) }
    });
    const pendingMerge = resumePendingRequest(plannerOutput, previous.pendingRequest, {
      canonicalOperations: operations,
      explicitRangeSearch: Boolean(explicitSearchRange),
      noReply: noReplyGateHit
    });
    this.trace(traceId, "pending_request", {
      action: pendingMerge.action,
      reasonCode: pendingMerge.reason,
      capability: previous.pendingRequest && previous.pendingRequest.capability || "",
      missingFields: previous.pendingRequest && previous.pendingRequest.missingFields || [],
      acceptedFields: pendingMerge.matchedFields || [],
      rejectedFields: (previous.pendingRequest && previous.pendingRequest.missingFields || []).filter((field) => !(pendingMerge.matchedFields || []).includes(field)),
      remainingMissingFields: pendingMerge.remainingMissingFields || [],
      candidateTaskTypes: plannerOutput.tasks.map((task) => task.type)
    });
    this.trace(traceId, "no_reply_gate", { shouldIgnore: plannerOutput.shouldIgnore, actionableTaskCount: plannerOutput.tasks.length - unknownTaskCount, unknownTaskCount, gateHit: noReplyGateHit, reasonCode: noReplyGateHit ? "no_reply_gate_hit" : plannerOutput.shouldIgnore ? "actionable_task_present" : "should_ignore_false" });
    if (pendingMerge.action === "no_reply") {
      const finalDecision = createFinalDecision({ type: "no_reply", reasonCode: "no_reply_gate_hit" });
      const messageRecord = { channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: "acknowledgement", replyType: "no_reply_v2", replyText: "", route: "no_reply_silent_ignore", decisionReason: finalDecision.reasonCode, shouldReply: finalDecision.shouldReply, noReply: true, needsReview: false, status: "resolved", processingStatus: "decided" };
      if (typeof this.persistence.updateMessageEvent === "function") this.persistence.updateMessageEvent(input.customerId, input.channelId, input.eventId, messageRecord);
      else this.persistence.appendMessageLog(input.customerId, messageRecord);
      this.trace(traceId, "controlled_decision", { decision: "no_reply", reason: messageRecord.decisionReason, actionableTaskCount: 0 });
      this.trace(traceId, "final_decision", { decision: finalDecision.type, reasonCode: finalDecision.reasonCode });
      this.traceContexts.delete(traceId);
      return { finalDecision, shouldReply: finalDecision.shouldReply, noReply: true, replyText: "", taskResults: [], reviewCount: 0, reviewIds: [], claimValidation: { ok: true, errors: [], coveredTaskIds: [], missingTaskIds: [] }, state: previous, traceId };
    }

    if (pendingMerge.action === "keep_pending") {
      const finalDecision = createFinalDecision({ type: "no_reply", reasonCode: "pending_unchanged_no_actionable_request" });
      const messageRecord = { channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: "pending_unchanged", replyType: "no_reply_v2", replyText: "", route: "pending_unchanged", decisionReason: finalDecision.reasonCode, shouldReply: false, noReply: true, needsReview: false, status: "resolved", processingStatus: "decided" };
      if (typeof this.persistence.updateMessageEvent === "function") this.persistence.updateMessageEvent(input.customerId, input.channelId, input.eventId, messageRecord);
      else this.persistence.appendMessageLog(input.customerId, messageRecord);
      this.trace(traceId, "final_decision", { decision: finalDecision.type, reasonCode: finalDecision.reasonCode });
      this.traceContexts.delete(traceId);
      return { finalDecision, shouldReply: false, noReply: true, replyText: "", taskResults: [], reviewCount: 0, reviewIds: [], claimValidation: { ok: true, errors: [], coveredTaskIds: [], missingTaskIds: [] }, state: previous, traceId };
    }

    const executionTasks = pendingMerge.executionTasks;
    let executionPlannerOutput = {
      ...plannerOutput,
      tasks: executionTasks,
      discourse: pendingMerge.resumed ? { ...plannerOutput.discourse, relation: "continue" } : plannerOutput.discourse,
      ...(explicitSearchRange ? { searchRange: explicitSearchRange } : {})
    };
    executionPlannerOutput = applyAvailableDatesDefaults(executionPlannerOutput, {
      messageText: input.messageText,
      eventTimestamp: input.eventTimestamp,
      timezone: catalog.timezone,
      allowDefaultSearchRange: temporal.dateIntentStatus !== "unresolved"
    });

    if (pendingMerge.resumed) {
      const allowedFields = new Set(pendingMerge.matchedFields);
      if (allowedFields.has("stay.checkIn")) {
        allowedFields.add("stay.checkOut");
        allowedFields.add("stay.nights");
      }
      if (allowedFields.has("inventory.entityId")) allowedFields.add("inventory.mode");
      operations = operations.filter((item) => item.field !== "*" && allowedFields.has(item.field));
    } else {
      const normalizedInventoryOperations = (executionPlannerOutput.stateOperations || []).filter((item) => item.field.startsWith("inventory."));
      operations = [...operations.filter((item) => !item.field.startsWith("inventory.")), ...normalizedInventoryOperations];
    }
    if (executionPlannerOutput.searchRange && !operations.some((item) => item.field === "stay.searchRange")) {
      operations.push({ field: "stay.searchRange", operation: previous.conditions.stay.searchRange ? "replace" : "set", value: executionPlannerOutput.searchRange, sourceText: "" });
    }
    operations.push(...derivedStayOperations(previous.conditions, operations));
    const state = reduceConversationState(previous, {
      ...executionPlannerOutput,
      stateOperations: operations,
      currentTurnDateIntent: temporal.dateIntentStatus
    }, scope);
    this.trace(traceId, "state", { discourse: plannerOutput.discourse, operations: operations.map((item) => ({ field: item.field, operation: item.operation })), conditions: state.conditions, ...(this.diagnosticDetail ? { stateAfter: traceState(state) } : {}) });
    this.trace(traceId, "entity_resolution", { tasks: executionTasks.map((task) => { const resolved = task.entity && task.entity.rawText ? resolveEntity(catalog, task.entity) : { status: "not_requested" }; return this.diagnosticDetail ? { taskId: task.taskId, resolved } : { taskId: task.taskId, status: resolved.status, canonicalId: resolved.entity && resolved.entity.canonicalId || null, candidateCount: resolved.candidates && resolved.candidates.length || 0 }; }) });
    const resolverCalls = [];
    const tracedAvailabilityResolver = (request) => { const result = this.availabilityResolver(request); resolverCalls.push(availabilityTraceSummary(request, result)); return result; };
    const tracedAvailableDatesResolver = (request) => { const result = this.availableDatesResolver(request); resolverCalls.push(availabilityTraceSummary(request, result)); return result; };
    const continuedPendingNeedsMore = Boolean(pendingMerge.resumed && pendingMerge.remainingMissingFields.length);
    let taskResults;
    if (continuedPendingNeedsMore) {
      const pendingTaskIds = new Set(previous.pendingRequest.tasks.map((task) => task.taskId));
      const independentTasks = executionTasks.filter((task) => !pendingTaskIds.has(task.taskId));
      const independentResults = executeTasks({ property, catalog, tasks: independentTasks, request: state.conditions, availabilityResolver: tracedAvailabilityResolver, availableDatesResolver: tracedAvailableDatesResolver, priceOverrides: this.listPriceOverrides(input.customerId) });
      const question = pendingClarificationQuestion(pendingMerge.remainingMissingFields);
      const clarificationByTaskId = new Map(previous.pendingRequest.tasks.map((task) => [task.taskId, {
        taskId: task.taskId,
        type: task.type,
        status: "needs_clarification",
        question,
        facts: {},
        missingInputs: pendingMerge.remainingMissingFields
      }]));
      const independentByTaskId = new Map(independentResults.map((result) => [result.taskId, result]));
      taskResults = executionTasks.map((task) => clarificationByTaskId.get(task.taskId) || independentByTaskId.get(task.taskId)).filter(Boolean);
    } else {
      taskResults = executeTasks({ property, catalog, tasks: executionTasks, request: state.conditions, availabilityResolver: tracedAvailabilityResolver, availableDatesResolver: tracedAvailableDatesResolver, priceOverrides: this.listPriceOverrides(input.customerId) });
    }
    const inputTaskIds = executionTasks.map((task) => task.taskId);
    let executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    if (!executorCoverage.ok) {
      taskResults = [...taskResults, ...executorCoverage.missingTaskIds.map((taskId) => ({ taskId, type: "unknown", status: "failed", reason: "executor_missing_task", facts: { subject: "這個問題" }, review: true }))];
      executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    }
    state.pendingRequest = continuedPendingNeedsMore
      ? createPendingRequest({
        tasks: previous.pendingRequest.tasks,
        conditions: state.conditions,
        missingFields: pendingMerge.remainingMissingFields,
        clarificationTarget: pendingMerge.remainingMissingFields[0],
        scope: {
          eventId: input.eventId,
          now: scope.now,
          createdAt: previous.pendingRequest.metadata && previous.pendingRequest.metadata.createdAt
        }
      })
      : pendingFromResults({
        plannerOutput: executionPlannerOutput,
        taskResults,
        conditions: state.conditions,
        scope: {
          eventId: input.eventId,
          now: scope.now,
          createdAt: previous.pendingRequest && previous.pendingRequest.metadata && previous.pendingRequest.metadata.createdAt
        }
      });
    this.persistence.setConversationState(input.customerId, input.channelId, input.lineUserId, state);
    this.trace(traceId, "pending_request", {
      action: state.pendingRequest ? "stored" : previous.pendingRequest ? "cleared" : "none",
      capability: state.pendingRequest && state.pendingRequest.capability || "",
      missingFields: state.pendingRequest && state.pendingRequest.missingFields || []
    });
    this.trace(traceId, "executor", { results: this.diagnosticDetail ? taskResults : taskResults.map((item) => ({ taskId: item.taskId, status: item.status, reason: item.reason || "", locationFactProvided: Boolean(item.facts && item.facts.locationMapUrl), factSource: item.facts && item.facts.source || "" })), resolverCalls: this.diagnosticDetail ? resolverCalls : undefined, coverage: executorCoverage });
    const reviewIds = [];
    for (const result of taskResults.filter((item) => item.review)) {
      const sourceTask = executionTasks.find((task) => task.taskId === result.taskId);
      const item = this.persistReview(input, result.reason || result.status, `「${sourceTask && sourceTask.sourceText || "該問題"}」需要業者確認。`, result.taskId);
      if (item.reviewId) reviewIds.push(item.reviewId);
    }
    let finalDecision = decideTaskResults(taskResults);
    const responsePlan = buildResponsePlan({
      propertyId: input.customerId,
      inputTaskIds,
      reviewActions: reviewIds.map((reviewId) => ({ reviewId, created: true })),
      finalDecision
    });
    let replyText = "";
    let claimedTaskIds = null;
    let composedSections = null;
    let composerSource = "not_called";
    let fallbackOccurred = false;
    let rejectionReasonCodes = [];
    let claimValidation = { ok: true, errors: [], coveredTaskIds: [], missingTaskIds: [], unexpectedTaskIds: [] };

    if (!responsePlan.ok) {
      finalDecision = exceptionDecision(`response_plan_${responsePlan.error.code}`, taskResults);
      replyText = SAFE_FALLBACK;
      rejectionReasonCodes = [responsePlan.error.code];
      this.trace(traceId, "response_plan", { sectionCount: 0, sections: [], reviewCount: responsePlan.reviewActions.length, coverage: responsePlan.coverageValidation, errorCode: responsePlan.error.code });
    } else {
      this.trace(traceId, "response_plan", { sectionCount: responsePlan.sections.length, sections: this.diagnosticDetail ? responsePlan.sections : responsePlan.sections.map((section) => ({ taskId: section.taskId, status: section.status, responseMode: section.responseMode, factKeys: Object.keys(section.facts || {}) })), reviewCount: responsePlan.reviewActions.length, coverage: responsePlan.coverageValidation });
      const deterministicReply = composeControlledReply(responsePlan);
      if (!deterministicReply) {
        finalDecision = exceptionDecision("approved_reply_empty", taskResults);
        replyText = SAFE_FALLBACK;
        rejectionReasonCodes = ["approved_reply_empty"];
        composerSource = "engine_exception";
      } else {
        replyText = deterministicReply;
        composerSource = "deterministic";
        if (this.composer && typeof this.composer.compose === "function") {
          try {
            const composed = mergeComposedSections(responsePlan, await this.composer.compose(responsePlan));
            if (composed.ok) {
              const adoptionValidation = validateClaims(composed.replyText, responsePlan, composed.factTaskIds, composed.sections);
              if (adoptionValidation.ok) {
                replyText = composed.replyText;
                claimedTaskIds = composed.factTaskIds;
                composedSections = composed.sections;
                composerSource = "openai";
              } else {
                rejectionReasonCodes = adoptionValidation.errors;
              }
            } else {
              rejectionReasonCodes = composed.errors;
            }
          } catch {
            rejectionReasonCodes = ["composer_exception"];
          }
          fallbackOccurred = composerSource !== "openai";
          if (rejectionReasonCodes.length) {
            finalDecision = {
              ...finalDecision,
              reasonCode: rejectionReasonCodes.includes("composer_exception") ? "composer_exception" : "composer_rejected"
            };
          }
        }
      }
      claimValidation = validateClaims(replyText, responsePlan, claimedTaskIds, composedSections);
      this.trace(traceId, "composer", { outputLength: replyText.length, coveredTaskIds: claimedTaskIds || inputTaskIds, missingTaskIds: claimValidation.missingTaskIds, composerSource, validationResult: rejectionReasonCodes.length ? "rejected" : "accepted", rejectionReasonCodes, fallbackOccurred, ...(this.diagnosticDetail ? { composerInput: responsePlan, finalOutput: replyText } : {}), sections: responsePlan.sections.map((section) => ({ taskId: section.taskId, responseMode: section.responseMode, type: section.type })) });
      if (!claimValidation.ok) {
        const reason = claimValidation.errors.includes("incomplete_task_coverage") ? "composer_incomplete_coverage" : "claim_validation_failed";
        const item = this.persistReview(input, reason, "回覆未完整涵蓋所有問題，已由核心改用安全處理。", "");
        if (item.reviewId) reviewIds.push(item.reviewId);
        finalDecision = exceptionDecision(reason, taskResults);
        replyText = SAFE_FALLBACK;
        claimValidation = validateClaims(replyText, responsePlan, inputTaskIds);
      }
    }
    this.trace(traceId, "claim_validator", { errors: claimValidation.errors, coveredTaskIds: claimValidation.coveredTaskIds, missingTaskIds: claimValidation.missingTaskIds });
    const messageRecord = { channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: "multi_task_v2", replyType: `${finalDecision.type}_v2`, replyText, route: "planner_v2", decisionReason: finalDecision.reasonCode, shouldReply: finalDecision.shouldReply, noReply: false, humanHandoff: finalDecision.type === "human_handoff", needsReview: finalDecision.type === "human_handoff", status: finalDecision.type === "human_handoff" ? "pending" : "resolved", processingStatus: "decided" };
    if (typeof this.persistence.updateMessageEvent === "function") this.persistence.updateMessageEvent(input.customerId, input.channelId, input.eventId, messageRecord);
    else this.persistence.appendMessageLog(input.customerId, messageRecord);
    this.trace(traceId, "line_ready", { coveredTaskIds: claimValidation.coveredTaskIds, missingTaskIds: claimValidation.missingTaskIds, replyLength: replyText.length });
    this.trace(traceId, "final_decision", { decision: finalDecision.type, reasonCode: finalDecision.reasonCode });
    this.traceContexts.delete(traceId); return { finalDecision, shouldReply: finalDecision.shouldReply, noReply: !finalDecision.shouldReply, replyText, taskResults, reviewCount: reviewIds.length, reviewIds, claimValidation, state, traceId };
  }

  persistReview(input, reason, note, taskId) {
    return this.persistence.appendMessageLog(input.customerId, { channelId: input.channelId, lineUserId: input.lineUserId, eventId: `${input.eventId}:review:${taskId || reason}`, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: taskId || "unknown", replyType: "scoped_handoff_v2", replyText: "", route: "human_handoff_required", decisionReason: reason, shouldReply: false, noReply: true, humanHandoff: true, needsReview: true, reviewNote: note, status: "pending", processingStatus: "decided" });
  }
}

module.exports = { ConversationEngineV2, SAFE_FALLBACK, normalizePlannerOutput, createFinalDecision, decideTaskResults, DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS };
