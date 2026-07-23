"use strict";

const crypto = require("node:crypto");

const { validatePlannerOutput, applyPlannerSemanticContract, normalizeEligibilityEvidence } = require("./planner-schema");
const { normalizeDetailIntent } = require("./detail-intent");
const { buildPropertyCatalog } = require("./property-catalog");
const { resolveTemporalExpression } = require("./temporal-resolver");
const { migrateStateV2, reduceConversationState, decideContextExecution } = require("./state-reducer");
const { executeTasks, isGenericAvailabilityEntity } = require("./capability-executor");
const { buildResponsePlan } = require("./response-planner");
const { composeControlledReply, mergeComposedSections } = require("./controlled-composer");
const { validateClaims } = require("./claim-validator");
const { coverageByStatus, assertTaskCoverage } = require("./task-coverage");
const { resolveEntity } = require("./entity-resolver");
const { availabilityTraceSummary } = require("./resolver-adapter");
const { pendingFromResults } = require("./pending-request");
const { buildContextSnapshot } = require("./contracts");
const { validateUnderstandingContext } = require("./understanding-validator");

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
function normalizePlannerOutput(plannerOutput, { eventTimestamp, timezone } = {}) {
  if (!plannerOutput || typeof plannerOutput !== "object" || Array.isArray(plannerOutput) || !Array.isArray(plannerOutput.tasks)) return null;
  const stay = { ...(plannerOutput.stay || {}), dateExpression: { ...plannerOutput.stay && plannerOutput.stay.dateExpression } };
  const inventory = { mode: null, entityId: null, features: null };
  const inventoryClears = new Set();
  for (const item of plannerOutput.stateOperations || []) {
    if (!item) continue;
    if (item.operation === "clear" && ["inventory.mode", "inventory.entityId", "inventory.features"].includes(item.field)) {
      inventoryClears.add(item.field);
      continue;
    }
    if (!["set", "replace"].includes(item.operation)) continue;
    if (item.field === "stay.checkInCandidate" && !stay.checkInCandidate) stay.checkInCandidate = item.value;
    if (item.field === "stay.checkOutCandidate" && !stay.checkOutCandidate) stay.checkOutCandidate = item.value;
    if (item.field === "stay.nightsCandidate" && !stay.nightsCandidate) stay.nightsCandidate = item.value;
    if (item.field === "stay.guestCountCandidate" && !stay.guestCountCandidate) stay.guestCountCandidate = item.value;
    if (item.field === "stay.dateExpression.rawText" && !stay.dateExpression.rawText) stay.dateExpression.rawText = item.value;
    if (item.field === "stay.dateExpression.kind" && stay.dateExpression.kind === "none") stay.dateExpression.kind = item.value;
    if (item.field === "stay.dateExpression.anchor" && stay.dateExpression.anchor === "none") stay.dateExpression.anchor = item.value;
    if (item.field === "inventory.mode") inventory.mode = item.value;
    if (item.field === "inventory.entityId") inventory.entityId = item.value;
    if (item.field === "inventory.features") inventory.features = item.value;
  }
  const legacyReset = (plannerOutput.stateOperations || []).some((item) => item && item.field === "*" && item.operation === "clear");
  const output = { ...plannerOutput, stateOperations: [], legacyReset, stay, inventoryCandidates: inventory, inventoryClears: [...inventoryClears], tasks: (plannerOutput.tasks || []).map((task) => ({ ...task, detailIntent: normalizeDetailIntent(task.detailIntent), eligibilityEvidence: normalizeEligibilityEvidence(task.eligibilityEvidence), entity: task.entity ? { ...task.entity } : task.entity })) };
  const availableDatesRequested = output.tasks.some((task) => task.type === "available_dates");
  const genericAvailability = output.tasks.some((task) => isGenericAvailabilityEntity(task));
  const genericAvailableDates = output.tasks.some((task) => task.type === "available_dates" && isGenericAvailabilityEntity(task));
  if (availableDatesRequested) {
    // An available_dates task is a search for the next matching stay, so it
    // starts at the immutable message date rather than an earlier stay range.
    const dateFrom = dateKeyAt(eventTimestamp, timezone || "Asia/Taipei");
    output.tasks = output.tasks.map((task) => {
      if (task.type !== "available_dates" || !isGenericAvailabilityEntity(task)) return task;
      return { ...task, entity: { ...task.entity, rawText: "", canonicalCandidate: null } };
    });
    output.searchRange = { from: dateFrom, to: addUtcDays(dateFrom, DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS) };
  }
  if (genericAvailableDates || genericAvailability) output.inventoryCandidates = { ...output.inventoryCandidates, mode: "any", entityId: null };
  return output;
}

function normalizedPlannerStay(plannerOutput) {
  const stay = {
    ...plannerOutput.stay,
    dateExpression: { ...plannerOutput.stay.dateExpression }
  };
  return stay;
}

const SAFE_FALLBACK = "這次有部分內容無法安全確認，我會請業者協助；您剛才的問題已經記錄。";

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
    const contextSnapshot = buildContextSnapshot(previous, scope);
    this.traceContexts.set(traceId, { timestamp: new Date().toISOString(), correlationId: traceId, eventId: input.eventId, propertyId: input.customerId, ...(this.diagnosticDetail ? { userKeyHash: crypto.createHash("sha256").update(String(input.lineUserId || "")).digest("hex").slice(0, 16), messageText: input.messageText } : {}) });
    const catalog = buildPropertyCatalog(property);
    this.trace(traceId, "property_catalog", { providerType: this.diagnosticMetadata.providerType || "unknown", location: catalog.locationDiagnostics || { source: "none", profileValuePresent: false, transportValuePresent: false, urlValidation: "fail" } });
    if (this.diagnosticDetail) this.trace(traceId, "state_before", { state: traceState(previous) });
    let plannerOutput, parserSucceeded = false;
    try {
      plannerOutput = await this.planner.classify({ currentMessage: input.messageText, currentMessages: input.currentMessages || [input.messageText], eventTimestamp: input.eventTimestamp, catalog, contextSnapshot });
      parserSucceeded = true;
    } catch { plannerOutput = null; }
    this.trace(traceId, "planner", {
      parserSucceeded,
      taskCount: plannerOutput && Array.isArray(plannerOutput.tasks) ? plannerOutput.tasks.length : 0,
      discourse: plannerOutput && plannerOutput.discourse || null,
      shouldIgnore: Boolean(plannerOutput && plannerOutput.shouldIgnore),
      missingInformation: plannerOutput && Array.isArray(plannerOutput.missingInformation) ? plannerOutput.missingInformation.map(String).slice(0, 20) : [],
      tasks: plannerOutput && Array.isArray(plannerOutput.tasks)
        ? (this.diagnosticDetail ? plannerOutput.tasks : plannerOutput.tasks.map(plannerTaskTrace))
        : []
    });
    if (!plannerOutput || typeof plannerOutput !== "object" || Array.isArray(plannerOutput) || !Array.isArray(plannerOutput.tasks)) {
      this.trace(traceId, "validation", { acceptedTasks: [], rejectedTasks: [], rejectionReasons: [parserSucceeded ? "planner_output_unusable" : "planner_parse_failed"], finalTasks: [] });
      this.trace(traceId, "fallback", { reasonCode: parserSucceeded ? "planner_output_unusable" : "planner_parse_failed", branch: "planner_input_guard" });
      this.trace(traceId, "final_decision", { decision: "reply", reasonCode: "planner_empty_output" });
      const item = this.persistReview(input, "planner_empty_output", "Planner did not produce a usable task result.", "");
      this.traceContexts.delete(traceId);
      return { shouldReply: true, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean), traceId };
    }
    plannerOutput = normalizePlannerOutput(plannerOutput, { eventTimestamp: input.eventTimestamp, timezone: catalog.timezone });
    if (!plannerOutput) {
      this.trace(traceId, "validation", { acceptedTasks: [], rejectedTasks: [], rejectionReasons: ["planner_normalization_failed"], finalTasks: [] });
      this.trace(traceId, "fallback", { reasonCode: "planner_normalization_failed", branch: "planner_normalization_guard" });
      this.trace(traceId, "final_decision", { decision: "reply", reasonCode: "planner_normalization_failed" });
      const item = this.persistReview(input, "planner_normalization_failed", "Planner output could not be normalized safely.", "");
      this.traceContexts.delete(traceId);
      return { shouldReply: true, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean), traceId };
    }
    const structuralValidation = validatePlannerOutput(plannerOutput);
    if (!structuralValidation.ok) {
      this.trace(traceId, "validation", plannerValidationTrace(plannerOutput, structuralValidation));
      this.trace(traceId, "fallback", { reasonCode: "planner_schema_invalid", branch: "structural_validation" });
      this.trace(traceId, "final_decision", { decision: "reply", reasonCode: "planner_invalid" });
      const item = this.persistReview(input, "planner_invalid", "整體訊息無法安全理解，請協助確認。", "");
      this.traceContexts.delete(traceId);
      return { shouldReply: true, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean), traceId };
    }
    const semanticInputTasks = plannerOutput.tasks.map(plannerTaskTrace);
    plannerOutput = applyPlannerSemanticContract(plannerOutput, { catalog });
    const validation = validatePlannerOutput(plannerOutput);
    this.trace(traceId, "validation", { ...plannerValidationTrace(plannerOutput, validation), semanticValidation: plannerOutput.semanticValidation });
    this.trace(traceId, "semantic_contract", { inputTasks: semanticInputTasks, outputTasks: plannerOutput.tasks.map(plannerTaskTrace), shouldIgnore: plannerOutput.shouldIgnore, validationPassed: validation.ok, semanticValidation: plannerOutput.semanticValidation });
    if (!validation.ok) {
      this.trace(traceId, "fallback", { reasonCode: "planner_semantic_validation_failed", branch: "semantic_validation" });
      this.trace(traceId, "final_decision", { decision: "reply", reasonCode: "planner_semantic_repair_invalid" });
      const item = this.persistReview(input, "planner_semantic_repair_invalid", "Planner task could not be repaired safely.", "");
      this.traceContexts.delete(traceId);
      return { shouldReply: true, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean), traceId };
    }
    const contextValidation = validateUnderstandingContext(plannerOutput, contextSnapshot);
    this.trace(traceId, "context_validation", { snapshotCycleIds: contextSnapshot.cycles.map((item) => item.requestCycleId), acceptedRelations: contextValidation.relations, rejectionReasons: contextValidation.errors });
    if (!contextValidation.ok) {
      this.trace(traceId, "fallback", { reasonCode: "context_relation_invalid", branch: "context_validation" });
      this.trace(traceId, "final_decision", { decision: "reply", reasonCode: "context_relation_invalid" });
      const item = this.persistReview(input, "context_relation_invalid", "Planner supplied an invalid context reference.", "");
      this.traceContexts.delete(traceId);
      return { shouldReply: true, replyText: SAFE_FALLBACK, taskResults: [], reviewCount: 1, claimValidation: { ok: true, errors: [] }, reviewIds: [item.reviewId].filter(Boolean), traceId };
    }
    const contextExecution = decideContextExecution(previous, contextValidation.relations, plannerOutput.tasks, { resetConditions: plannerOutput.legacyReset });
    this.trace(traceId, "pending_request", { action: contextExecution.resumedPending ? "resumed" : "unchanged", reasonCode: contextExecution.contextDecision.action, capability: previous.pendingRequest && previous.pendingRequest.capability || "", missingFields: previous.pendingRequest && previous.pendingRequest.missingFields || [] });
    const hasActionableTask = plannerOutput.tasks.some((task) => !NON_ACTIONABLE_TASK_TYPES.has(task.type));
    const unknownTaskCount = plannerOutput.tasks.filter((task) => NON_ACTIONABLE_TASK_TYPES.has(task.type)).length;
    const noReplyGateHit = Boolean(plannerOutput.shouldIgnore && !hasActionableTask);
    this.trace(traceId, "no_reply_gate", { shouldIgnore: plannerOutput.shouldIgnore, actionableTaskCount: plannerOutput.tasks.length - unknownTaskCount, unknownTaskCount, gateHit: noReplyGateHit, reasonCode: noReplyGateHit ? "no_reply_gate_hit" : plannerOutput.shouldIgnore ? "actionable_task_present" : "should_ignore_false" });
    if (plannerOutput.shouldIgnore && !hasActionableTask) {
      const messageRecord = { channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: "acknowledgement", replyType: "no_reply_v2", replyText: "", route: "no_reply_silent_ignore", decisionReason: plannerOutput.reason || "planner_should_ignore", shouldReply: false, noReply: true, needsReview: false, status: "resolved", processingStatus: "decided" };
      if (typeof this.persistence.updateMessageEvent === "function") this.persistence.updateMessageEvent(input.customerId, input.channelId, input.eventId, messageRecord);
      else this.persistence.appendMessageLog(input.customerId, messageRecord);
      this.trace(traceId, "controlled_decision", { decision: "no_reply", reason: messageRecord.decisionReason, actionableTaskCount: 0 });
      this.trace(traceId, "final_decision", { decision: "no_reply", reasonCode: "no_reply_gate_hit" });
      this.traceContexts.delete(traceId);
      return { shouldReply: false, noReply: true, replyText: "", taskResults: [], reviewCount: 0, reviewIds: [], claimValidation: { ok: true, errors: [], coveredTaskIds: [], missingTaskIds: [] }, traceId };
    }
    const executionTasks = contextExecution.executionTasks;
    const executionPlannerOutput = { ...plannerOutput, tasks: executionTasks };
    const plannerStay = normalizedPlannerStay(plannerOutput);
    const temporal = resolveTemporalExpression(plannerStay.dateExpression, {
      eventTimestamp: input.eventTimestamp, timezone: catalog.timezone,
      checkInCandidate: plannerStay.checkInCandidate, checkOutCandidate: plannerStay.checkOutCandidate,
      nightsCandidate: plannerStay.nightsCandidate,
      defaultNights: executionTasks.some((task) => ["availability", "bundle_availability", "room_options", "capacity", "price", "total_price"].includes(task.type)) ? 1 : null,
      previousCheckIn: previous.conditions.stay.checkIn, previousCheckOut: previous.conditions.stay.checkOut
    });
    this.trace(traceId, "temporal", {
      contextAction: contextExecution.contextDecision.action,
      dateExpressionPresent: Boolean(plannerStay.dateExpression.rawText && plannerStay.dateExpression.kind !== "none"),
      resolutionStatus: temporal.resolutionStatus,
      produced: { checkIn: Boolean(temporal.checkIn), checkOut: Boolean(temporal.checkOut), nights: Boolean(temporal.nights) }
    });
    const contextPatch = [];
    const patchOperation = (field, value) => contextPatch.push({ field, operation: previous.conditions.stay && previous.conditions.stay[field.split(".")[1]] ? "replace" : "set", value });
    if (Number.isInteger(plannerStay.guestCountCandidate)) patchOperation("stay.guests", plannerStay.guestCountCandidate);
    if (Number.isInteger(plannerStay.nightsCandidate)) patchOperation("stay.nights", plannerStay.nightsCandidate);
    if (plannerOutput.inventoryCandidates && plannerOutput.inventoryCandidates.mode !== null) contextPatch.push({ field: "inventory.mode", operation: "replace", value: plannerOutput.inventoryCandidates.mode });
    if (plannerOutput.inventoryCandidates && plannerOutput.inventoryCandidates.entityId !== null) contextPatch.push({ field: "inventory.entityId", operation: "replace", value: plannerOutput.inventoryCandidates.entityId });
    if (plannerOutput.inventoryCandidates && Array.isArray(plannerOutput.inventoryCandidates.features)) contextPatch.push({ field: "inventory.features", operation: "replace", value: plannerOutput.inventoryCandidates.features });
    for (const field of plannerOutput.inventoryClears || []) contextPatch.push({ field, operation: "clear", value: null });
    if (temporal.resolutionStatus === "resolved") {
      if (temporal.checkIn) patchOperation("stay.checkIn", temporal.checkIn);
      if (temporal.checkOut) patchOperation("stay.checkOut", temporal.checkOut);
      if (temporal.nights) patchOperation("stay.nights", temporal.nights);
      if (temporal.searchRange) patchOperation("stay.searchRange", temporal.searchRange);
    }
    if (temporal.resolutionStatus === "invalid" && plannerStay.dateExpression.rawText && plannerStay.dateExpression.kind !== "none") {
      // An explicit invalid date (notably a date already past) is a new
      // constraint, never permission to reuse an older stay from state.
      for (const field of ["stay.checkIn", "stay.checkOut", "stay.searchRange"]) {
        contextPatch.push({ field, operation: "clear", value: null });
      }
    }
    if (plannerOutput.searchRange) patchOperation("stay.searchRange", plannerOutput.searchRange);
    const state = reduceConversationState(previous, { tasks: executionTasks, contextDecision: contextExecution.contextDecision, contextPatch }, scope);
    this.trace(traceId, "state", { contextAction: contextExecution.contextDecision.action, operations: contextPatch.map((item) => ({ field: item.field, operation: item.operation })), conditions: state.conditions, ...(this.diagnosticDetail ? { stateAfter: traceState(state) } : {}) });
    this.trace(traceId, "entity_resolution", { tasks: executionTasks.map((task) => { const resolved = task.entity && task.entity.rawText ? resolveEntity(catalog, task.entity) : { status: "not_requested" }; return this.diagnosticDetail ? { taskId: task.taskId, resolved } : { taskId: task.taskId, status: resolved.status, canonicalId: resolved.entity && resolved.entity.canonicalId || null, candidateCount: resolved.candidates && resolved.candidates.length || 0 }; }) });
    const resolverCalls = [];
    const tracedAvailabilityResolver = (request) => { const result = this.availabilityResolver(request); resolverCalls.push(availabilityTraceSummary(request, result)); return result; };
    const tracedAvailableDatesResolver = (request) => { const result = this.availableDatesResolver(request); resolverCalls.push(availabilityTraceSummary(request, result)); return result; };
    let taskResults = executeTasks({ property, catalog, tasks: executionTasks, request: state.conditions, availabilityResolver: tracedAvailabilityResolver, availableDatesResolver: tracedAvailableDatesResolver, priceOverrides: this.listPriceOverrides(input.customerId) });
    const inputTaskIds = executionTasks.map((task) => task.taskId);
    let executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    if (!executorCoverage.ok) {
      taskResults = [...taskResults, ...executorCoverage.missingTaskIds.map((taskId) => ({ taskId, type: "unknown", status: "failed", reason: "executor_missing_task", facts: { subject: "這個問題" }, review: true }))];
      executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    }
    state.pendingRequest = pendingFromResults({
      plannerOutput: executionPlannerOutput,
      taskResults,
      conditions: state.conditions,
      scope: {
        eventId: input.eventId,
        now: scope.now,
        createdAt: previous.pendingRequest && previous.pendingRequest.metadata && previous.pendingRequest.metadata.createdAt,
        pendingRequestId: previous.pendingRequest && previous.pendingRequest.pendingRequestId || crypto.randomUUID(),
        requestCycleId: contextExecution.contextDecision.requestCycleId || state.contextCycle && state.contextCycle.requestCycleId || previous.pendingRequest && previous.pendingRequest.requestCycleId || crypto.randomUUID(),
        expiresAt: new Date(new Date(scope.now).getTime() + 24 * 60 * 60 * 1000).toISOString()
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
    this.trace(traceId, "final_decision", { decision: "reply", reasonCode: "controlled_reply_ready" });
    this.traceContexts.delete(traceId); return { shouldReply: true, noReply: false, replyText, taskResults, reviewCount: reviewIds.length, reviewIds, claimValidation, state, traceId };
  }

  persistReview(input, reason, note, taskId) {
    return this.persistence.appendMessageLog(input.customerId, { channelId: input.channelId, lineUserId: input.lineUserId, eventId: `${input.eventId}:review:${taskId || reason}`, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: taskId || "unknown", replyType: "scoped_handoff_v2", replyText: "", route: "human_handoff_required", decisionReason: reason, shouldReply: false, noReply: true, humanHandoff: true, needsReview: true, reviewNote: note, status: "pending", processingStatus: "decided" });
  }
}

module.exports = { ConversationEngineV2, SAFE_FALLBACK, normalizePlannerOutput, DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS };
