"use strict";

const crypto = require("node:crypto");

const { validatePlannerOutput, applyPlannerSemanticContract, normalizeEligibilityEvidence, discardLegacyPlannerStateControls } = require("./planner-schema");
const { normalizeDetailIntent } = require("./detail-intent");
const { buildPropertyCatalog } = require("./property-catalog");
const { resolveTemporalExpression } = require("./temporal-resolver");
const { migrateStateV2, reduceConversationState, reducePendingRequests, decideContextExecution, conditionsForCycle } = require("./state-reducer");
const { executeQueryPlans, isGenericAvailabilityEntity } = require("./capability-executor");
const { buildResponsePlan } = require("./response-planner");
const { composeControlledReply, mergeComposedSections } = require("./controlled-composer");
const { validateClaims } = require("./claim-validator");
const { coverageByStatus, assertTaskCoverage } = require("./task-coverage");
const { resolveEntity } = require("./entity-resolver");
const { availabilityTraceSummary } = require("./resolver-adapter");
const { pendingFromResults } = require("./pending-request");
const { buildContextSnapshot } = require("./contracts");
const { validateUnderstandingContext, evidenceMatchesSource } = require("./understanding-validator");
const { normalizePlannerEvidenceCoordinates } = require("./evidence-normalizer");
const { buildFormalRequest, buildQueryPlan, resultForNotReady } = require("./formal-request");
const { buildFinalDecision } = require("./final-decision");
const { SAFE_HANDOFF_TEXT, buildFinalResponse } = require("./final-response-renderer");

const DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS = 31;
const NON_ACTIONABLE_TASK_TYPES = new Set(["unknown"]);
const INVENTORY_TASK_TYPES = new Set(["availability", "bundle_availability", "room_options", "capacity", "price", "total_price"]);
const TEMPORAL_FAILURE_STATUSES = new Set(["unresolved", "invalid", "conflicting"]);
const SINGLE_DATE_DEFAULT_NIGHT_RULE_REF = "PRODUCT_BASELINE:single_date_availability_default_one_night";
const AVAILABLE_DATES_LOOKAHEAD_RULE_REF = "temporal:available_dates_default_lookahead";
function decideFinal(input) { return buildFinalDecision(input); }
function renderFinal(input) { return buildFinalResponse(input); }
function sourceEventsForInput(input = {}) {
  const events = Array.isArray(input.sourceEvents) ? input.sourceEvents : [];
  const normalized = events.map((event) => ({
    eventId: String(event && event.eventId || "").trim(),
    messageRef: String(event && event.messageRef || "").trim(),
    messageText: String(event && event.messageText || "")
  })).filter((event) => event.eventId || event.messageRef);
  if (normalized.length) return normalized;
  return [{ eventId: String(input.eventId || "").trim(), messageRef: String(input.messageRef || "").trim(), messageText: String(input.messageText || "") }];
}
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
function diagnosticSourceEventMaps(sourceEvents) {
  const byEventId = new Map();
  const byMessageRef = new Map();
  for (const sourceEvent of Array.isArray(sourceEvents) ? sourceEvents : []) {
    if (!sourceEvent || typeof sourceEvent !== "object") continue;
    const normalized = {
      eventId: String(sourceEvent.eventId || "").trim(),
      messageRef: String(sourceEvent.messageRef || "").trim(),
      messageText: String(sourceEvent.messageText || "")
    };
    if (normalized.eventId) byEventId.set(normalized.eventId, byEventId.has(normalized.eventId) ? null : normalized);
    if (normalized.messageRef) byMessageRef.set(normalized.messageRef, byMessageRef.has(normalized.messageRef) ? null : normalized);
  }
  return { byEventId, byMessageRef };
}
function contextValidationCandidateDiagnostics(plannerOutput, sourceEvents) {
  const sourceMaps = diagnosticSourceEventMaps(sourceEvents);
  return (Array.isArray(plannerOutput && plannerOutput.contextRelationCandidates) ? plannerOutput.contextRelationCandidates : []).map((candidate) => {
    const cycleRefs = Array.isArray(candidate && candidate.candidateRequestCycleRefs) ? candidate.candidateRequestCycleRefs : [];
    const evidenceRefs = Array.isArray(candidate && candidate.evidenceRefs) ? candidate.evidenceRefs : [];
    return {
      candidateIndex: Number.isInteger(candidate && candidate.candidateIndex) ? candidate.candidateIndex : -1,
      relationKind: String(candidate && candidate.kind || ""),
      candidateRequestCycleRefCount: cycleRefs.length,
      evidenceRefCount: evidenceRefs.length,
      evidenceSourceMatches: evidenceRefs.map((evidenceRef) => evidenceMatchesSource(evidenceRef, sourceMaps))
    };
  });
}
function normalizePlannerOutput(plannerOutput, { eventTimestamp, timezone } = {}) {
  if (!plannerOutput || typeof plannerOutput !== "object" || Array.isArray(plannerOutput) || !Array.isArray(plannerOutput.tasks)) return null;
  const stay = { ...(plannerOutput.stay || {}), dateExpression: { ...plannerOutput.stay && plannerOutput.stay.dateExpression } };
  const output = { ...plannerOutput, stay, tasks: (plannerOutput.tasks || []).map((task) => {
    const normalized = { ...task, detailIntent: normalizeDetailIntent(task.detailIntent), eligibilityEvidence: normalizeEligibilityEvidence(task.eligibilityEvidence), entity: task.entity ? { ...task.entity } : task.entity };
    if (Object.hasOwn(task, "stayCandidate")) normalized.stayCandidate = task.stayCandidate === null ? null : { ...task.stayCandidate, dateExpression: { ...task.stayCandidate.dateExpression } };
    return normalized;
  }) };
  const topLevelStayPresent = Boolean(stay.dateExpression && stay.dateExpression.rawText || stay.checkInCandidate || stay.checkOutCandidate || stay.nightsCandidate || stay.guestCountCandidate);
  const singleTask = output.tasks.length === 1 && output.tasks[0];
  const taskDateExpressionPresent = Boolean(singleTask && singleTask.stayCandidate
    && singleTask.stayCandidate.dateExpression
    && singleTask.stayCandidate.dateExpression.rawText);
  const topLevelDateExpressionPresent = Boolean(stay.dateExpression && stay.dateExpression.rawText);
  if (singleTask && (
    !Object.hasOwn(singleTask, "stayCandidate")
    || topLevelDateExpressionPresent && !taskDateExpressionPresent
  )) {
    output.tasks[0] = { ...output.tasks[0], stayCandidate: stay };
  }
  output.ambiguousTopLevelStay = output.tasks.length > 1 && topLevelStayPresent && output.tasks.some((task) => task.dependsOnStayContext && (!Object.hasOwn(task, "stayCandidate") || task.stayCandidate === null));
  const availableDatesRequested = output.tasks.some((task) => task.type === "available_dates");
  const genericAvailability = output.tasks.some((task) => isGenericAvailabilityEntity(task));
  const genericAvailableDates = output.tasks.some((task) => task.type === "available_dates" && isGenericAvailabilityEntity(task));
  if (availableDatesRequested) {
    output.tasks = output.tasks.map((task) => {
      if (task.type !== "available_dates" || !isGenericAvailabilityEntity(task)) return task;
      return { ...task, entity: { ...task.entity, rawText: "", canonicalCandidate: null } };
    });
  }
  if (genericAvailableDates || genericAvailability) output.inventoryCandidates = { mode: "any", entityId: null, features: null };
  return output;
}

function normalizedTaskStay(task) {
  const stay = task && task.stayCandidate || {};
  return {
    dateExpression: { rawText: stay.dateExpression && stay.dateExpression.rawText || "", kind: stay.dateExpression && stay.dateExpression.kind || "none", anchor: stay.dateExpression && stay.dateExpression.anchor || "none" },
    checkInCandidate: stay.checkInCandidate || null,
    checkOutCandidate: stay.checkOutCandidate || null,
    nightsCandidate: Number.isInteger(stay.nightsCandidate) ? stay.nightsCandidate : null,
    guestCountCandidate: Number.isInteger(stay.guestCountCandidate) ? stay.guestCountCandidate : null
  };
}

function approvedTemporalContext(snapshot, relation, plannerStay) {
  if (!relation || relation.stateAction !== "continue" || !relation.requestCycleId) return null;
  if (plannerStay.dateExpression.rawText && plannerStay.dateExpression.kind !== "none") return null;
  const cycle = (snapshot && snapshot.cycles || []).find((item) => item.requestCycleId === relation.requestCycleId);
  const stay = cycle && cycle.confirmedInputs && cycle.confirmedInputs.stay;
  if (!stay) return null;
  const temporalFields = cycle && cycle.temporalResult && cycle.temporalResult.fields || {};
  const sourceEvidenceRefs = [
    ...(temporalFields.checkIn && temporalFields.checkIn.sourceEvidenceRefs || []),
    ...(temporalFields.checkOut && temporalFields.checkOut.sourceEvidenceRefs || []),
    ...(temporalFields.nights && temporalFields.nights.sourceEvidenceRefs || []),
    ...(cycle && cycle.sourceEvidenceRefs || [])
  ];
  return {
    checkIn: stay.checkIn || null,
    checkOut: stay.checkOut || null,
    nights: Number.isInteger(stay.nights) ? stay.nights : null,
    sourceEvidenceRefs
  };
}

function sourceEvidenceRefsForRelation(relation) {
  return (relation && relation.evidenceRefs || []).map((evidenceRef) => ({
    eventId: String(evidenceRef && evidenceRef.eventId || "").trim(),
    messageRef: String(evidenceRef && evidenceRef.messageRef || "").trim(),
    startOffset: Number.isInteger(evidenceRef && evidenceRef.startOffset) ? evidenceRef.startOffset : 0,
    endOffset: Number.isInteger(evidenceRef && evidenceRef.endOffset) ? evidenceRef.endOffset : 0,
    quote: String(evidenceRef && evidenceRef.quote || "")
  }));
}

function blockedTemporalConditions(conditions) {
  return { ...conditions, stay: { ...(conditions && conditions.stay || {}), checkIn: null, checkOut: null, searchRange: null } };
}

function legacyTaskResult(execution) {
  if (!execution || !execution.outcome) return execution;
  const base = { taskId: execution.taskId, type: execution.type, facts: execution.facts || {} };
  if (execution.outcome === "answered" || execution.outcome === "no_availability") return { ...base, status: "answered" };
  if (execution.outcome === "not_ready") return { ...base, status: "needs_clarification", missingInputs: (execution.missingFields || []).length ? execution.missingFields : ["stay.checkIn"] };
  if (execution.outcome === "unknown") return { ...base, status: "needs_human", reason: execution.reason || "unknown", review: true };
  return { ...base, status: "needs_human", reason: execution.reason || execution.outcome, review: true };
}

function confirmedInventoryFromTask(catalog, candidate) {
  if (!candidate || !INVENTORY_TASK_TYPES.has(candidate.type)
    || !candidate.entity || !(candidate.entity.rawText || candidate.entity.canonicalCandidate)) return null;
  const resolved = resolveEntity(catalog, candidate.entity);
  if (!resolved || resolved.status !== "resolved" || !resolved.entity || !["room", "bundle"].includes(resolved.entity.category)) return null;
  return {
    mode: resolved.entity.category === "bundle" ? "bundle_only" : "room_only",
    entityId: String(resolved.entity.canonicalId)
  };
}

const SAFE_FALLBACK = SAFE_HANDOFF_TEXT;
const PLANNER_ERROR_CATEGORIES = new Set(["authentication", "rate_limit", "provider", "timeout", "parse", "empty_response", "configuration", "unknown"]);
const PLANNER_ERROR_NAMES = new Set(["Error", "AbortError", "SyntaxError", "TypeError"]);

function safePlannerProviderErrorField(value, maxLength) {
  const text = String(value || "");
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text.slice(0, maxLength) : "";
}

function safePlannerErrorDiagnostic(error, planner) {
  const configured = Boolean(planner && typeof planner.classify === "function");
  const status = Number(error && (error.status || error.statusCode));
  const httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  const timeout = Boolean(error && (error.timeout === true || error.name === "AbortError"));
  let errorCategory = configured && PLANNER_ERROR_CATEGORIES.has(error && error.errorCategory)
    ? error.errorCategory
    : configured ? "unknown" : "configuration";
  let errorCode = "planner_unknown_error";
  if (!configured) {
    errorCode = "planner_configuration_error";
  } else if (timeout) {
    errorCategory = "timeout";
    errorCode = "planner_timeout";
  } else if (httpStatus === 401 || httpStatus === 403) {
    errorCategory = "authentication";
    errorCode = "planner_authentication_error";
  } else if (httpStatus === 404) {
    errorCategory = "provider";
    errorCode = "planner_model_not_found";
  } else if (httpStatus === 429) {
    errorCategory = "rate_limit";
    errorCode = "planner_rate_limit";
  } else if (httpStatus >= 500 && httpStatus <= 599) {
    errorCategory = "provider";
    errorCode = "planner_provider_error";
  } else if (errorCategory === "parse" || error && error.name === "SyntaxError") {
    errorCategory = "parse";
    errorCode = "planner_parse_error";
  } else if (errorCategory === "empty_response") {
    errorCode = "planner_empty_response";
  } else if (errorCategory === "configuration") {
    errorCode = "planner_configuration_error";
  } else if (errorCategory === "provider") {
    errorCode = "planner_http_error";
  }
  return {
    errorName: PLANNER_ERROR_NAMES.has(error && error.name) ? error.name : "Error",
    errorCode,
    httpStatus,
    timeout,
    errorCategory,
    model: configured ? String(error && error.plannerModel || planner.model || "").slice(0, 120) : "",
    provider: configured ? String(error && error.plannerProvider || planner.provider || "unknown").slice(0, 40) : "unknown",
    providerErrorType: safePlannerProviderErrorField(error && error.providerErrorType, 120),
    providerErrorCode: safePlannerProviderErrorField(error && error.providerErrorCode, 120),
    providerErrorParam: safePlannerProviderErrorField(error && error.providerErrorParam, 200)
  };
}

class ConversationEngineV2 {
  constructor({ planner, composer, persistence, getProperty, availabilityResolver, availableDatesResolver, listPriceOverrides, now = () => new Date(), onDiagnostic, diagnosticDetail = false, diagnosticMetadata = {} }) {
    this.planner = planner; this.composer = composer; this.persistence = persistence; this.getProperty = getProperty; this.availabilityResolver = availabilityResolver; this.availableDatesResolver = availableDatesResolver; this.listPriceOverrides = listPriceOverrides || (() => []); this.now = now; this.onDiagnostic = typeof onDiagnostic === "function" ? onDiagnostic : null; this.diagnosticDetail = Boolean(diagnosticDetail); this.diagnosticMetadata = diagnosticMetadata || {}; this.traceContexts = new Map();
  }

  trace(traceId, stage, details) {
    if (!this.onDiagnostic) return;
    try { this.onDiagnostic({ ...(this.traceContexts.get(traceId) || {}), traceId, stage, ...details }); }
    catch { /* diagnostics must never affect conversation fallback or delivery */ }
  }

  async process(input) {
    const traceId = crypto.randomUUID();
    const sourceEvents = sourceEventsForInput(input);
    const property = this.getProperty(input.customerId);
    if (!property || property.propertyId !== input.customerId) throw new Error("property_not_found");
    const scope = { propertyId: input.customerId, channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, now: this.now().toISOString() };
    const previous = migrateStateV2(this.persistence.getConversationState(input.customerId, input.channelId, input.lineUserId), scope);
    const contextSnapshot = buildContextSnapshot(previous, scope);
    this.traceContexts.set(traceId, { timestamp: new Date().toISOString(), correlationId: traceId, eventId: input.eventId, sourceEventIds: sourceEvents.map((event) => event.eventId).filter(Boolean), propertyId: input.customerId, ...(this.diagnosticDetail ? { userKeyHash: crypto.createHash("sha256").update(String(input.lineUserId || "")).digest("hex").slice(0, 16), messageText: input.messageText, sourceEvents } : {}) });
    const catalog = buildPropertyCatalog(property);
    this.trace(traceId, "property_catalog", { providerType: this.diagnosticMetadata.providerType || "unknown", location: catalog.locationDiagnostics || { source: "none", profileValuePresent: false, transportValuePresent: false, urlValidation: "fail" } });
    if (this.diagnosticDetail) this.trace(traceId, "state_before", { state: traceState(previous) });
    let plannerOutput, parserSucceeded = false;
    try {
      plannerOutput = await this.planner.classify({ currentMessage: input.messageText, currentMessages: input.currentMessages || [input.messageText], sourceEvents, eventTimestamp: input.eventTimestamp, catalog, contextSnapshot });
      parserSucceeded = true;
    } catch (error) {
      plannerOutput = null;
      this.trace(traceId, "planner_error", safePlannerErrorDiagnostic(error, this.planner));
    }
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
      const finalDecision = decideFinal({ plannerFailure: parserSucceeded ? "planner_output_unusable" : "planner_parse_failed" });
      this.trace(traceId, "final_decision", { decision: finalDecision.action, reasonCode: finalDecision.reasonCode });
      const item = this.persistReview(input, "planner_empty_output", "Planner did not produce a usable task result.", "");
      const claimValidation = { ok: true, errors: [] };
      const finalResponse = renderFinal({ finalDecision, responsePlan: null, validatedReplyText: SAFE_FALLBACK, claimValidation });
      this.traceContexts.delete(traceId);
      return { ...finalResponse, noReply: !finalResponse.shouldReply, taskResults: [], reviewCount: 1, claimValidation, reviewIds: [item.reviewId].filter(Boolean), finalDecision, finalResponse, traceId };
    }
    plannerOutput = discardLegacyPlannerStateControls(plannerOutput);
    plannerOutput = normalizePlannerOutput(plannerOutput, { eventTimestamp: input.eventTimestamp, timezone: catalog.timezone });
    if (!plannerOutput) {
      this.trace(traceId, "validation", { acceptedTasks: [], rejectedTasks: [], rejectionReasons: ["planner_normalization_failed"], finalTasks: [] });
      this.trace(traceId, "fallback", { reasonCode: "planner_normalization_failed", branch: "planner_normalization_guard" });
      const finalDecision = decideFinal({ plannerFailure: "planner_normalization_failed" });
      this.trace(traceId, "final_decision", { decision: finalDecision.action, reasonCode: finalDecision.reasonCode });
      const item = this.persistReview(input, "planner_normalization_failed", "Planner output could not be normalized safely.", "");
      const claimValidation = { ok: true, errors: [] };
      const finalResponse = renderFinal({ finalDecision, responsePlan: null, validatedReplyText: SAFE_FALLBACK, claimValidation });
      this.traceContexts.delete(traceId);
      return { ...finalResponse, noReply: !finalResponse.shouldReply, taskResults: [], reviewCount: 1, claimValidation, reviewIds: [item.reviewId].filter(Boolean), finalDecision, finalResponse, traceId };
    }
    const structuralValidation = validatePlannerOutput(plannerOutput);
    if (!structuralValidation.ok) {
      this.trace(traceId, "validation", plannerValidationTrace(plannerOutput, structuralValidation));
      this.trace(traceId, "fallback", { reasonCode: "planner_schema_invalid", branch: "structural_validation" });
      const finalDecision = decideFinal({ plannerFailure: "planner_schema_invalid" });
      this.trace(traceId, "final_decision", { decision: finalDecision.action, reasonCode: finalDecision.reasonCode });
      const item = this.persistReview(input, "planner_invalid", "整體訊息無法安全理解，請協助確認。", "");
      const claimValidation = { ok: true, errors: [] };
      const finalResponse = renderFinal({ finalDecision, responsePlan: null, validatedReplyText: SAFE_FALLBACK, claimValidation });
      this.traceContexts.delete(traceId);
      return { ...finalResponse, noReply: !finalResponse.shouldReply, taskResults: [], reviewCount: 1, claimValidation, reviewIds: [item.reviewId].filter(Boolean), finalDecision, finalResponse, traceId };
    }
    const semanticInputTasks = plannerOutput.tasks.map(plannerTaskTrace);
    plannerOutput = applyPlannerSemanticContract(plannerOutput, { catalog });
    const validation = validatePlannerOutput(plannerOutput);
    this.trace(traceId, "validation", { ...plannerValidationTrace(plannerOutput, validation), semanticValidation: plannerOutput.semanticValidation });
    this.trace(traceId, "semantic_contract", { inputTasks: semanticInputTasks, outputTasks: plannerOutput.tasks.map(plannerTaskTrace), shouldIgnore: plannerOutput.shouldIgnore, validationPassed: validation.ok, semanticValidation: plannerOutput.semanticValidation });
    if (!validation.ok) {
      this.trace(traceId, "fallback", { reasonCode: "planner_semantic_validation_failed", branch: "semantic_validation" });
      const finalDecision = decideFinal({ plannerFailure: "planner_semantic_validation_failed" });
      this.trace(traceId, "final_decision", { decision: finalDecision.action, reasonCode: finalDecision.reasonCode });
      const item = this.persistReview(input, "planner_semantic_repair_invalid", "Planner task could not be repaired safely.", "");
      const claimValidation = { ok: true, errors: [] };
      const finalResponse = renderFinal({ finalDecision, responsePlan: null, validatedReplyText: SAFE_FALLBACK, claimValidation });
      this.traceContexts.delete(traceId);
      return { ...finalResponse, noReply: !finalResponse.shouldReply, taskResults: [], reviewCount: 1, claimValidation, reviewIds: [item.reviewId].filter(Boolean), finalDecision, finalResponse, traceId };
    }
    if (plannerOutput.ambiguousTopLevelStay) {
      this.trace(traceId, "fallback", { reasonCode: "multi_candidate_top_level_stay_ambiguous", branch: "candidate_stay_alignment" });
      const finalDecision = decideFinal({ plannerFailure: "multi_candidate_top_level_stay_ambiguous" });
      this.trace(traceId, "final_decision", { decision: finalDecision.action, reasonCode: finalDecision.reasonCode });
      const item = this.persistReview(input, "multi_candidate_top_level_stay_ambiguous", "Planner did not bind stay candidates to individual requests.", "");
      const claimValidation = { ok: true, errors: [] };
      const finalResponse = renderFinal({ finalDecision, responsePlan: null, validatedReplyText: SAFE_FALLBACK, claimValidation });
      this.traceContexts.delete(traceId);
      return { ...finalResponse, noReply: !finalResponse.shouldReply, taskResults: [], reviewCount: 1, claimValidation, reviewIds: [item.reviewId].filter(Boolean), finalDecision, finalResponse, traceId };
    }
    plannerOutput = normalizePlannerEvidenceCoordinates(plannerOutput, sourceEvents);
    const contextValidation = validateUnderstandingContext(plannerOutput, contextSnapshot, { sourceEvents, scope });
    this.trace(traceId, "context_validation", {
      snapshotCycleIds: contextSnapshot.cycles.map((item) => item.requestCycleId),
      acceptedRelations: contextValidation.relations,
      rejectionReasons: contextValidation.errors,
      candidates: contextValidationCandidateDiagnostics(plannerOutput, sourceEvents)
    });
    if (!contextValidation.ok) {
      this.trace(traceId, "fallback", { reasonCode: "context_relation_invalid", branch: "context_validation" });
      const finalDecision = decideFinal({ plannerFailure: "context_relation_invalid" });
      this.trace(traceId, "final_decision", { decision: finalDecision.action, reasonCode: finalDecision.reasonCode });
      const item = this.persistReview(input, "context_relation_invalid", "Planner supplied an invalid context reference.", "");
      const claimValidation = { ok: true, errors: [] };
      const finalResponse = renderFinal({ finalDecision, responsePlan: null, validatedReplyText: SAFE_FALLBACK, claimValidation });
      this.traceContexts.delete(traceId);
      return { ...finalResponse, noReply: !finalResponse.shouldReply, taskResults: [], reviewCount: 1, claimValidation, reviewIds: [item.reviewId].filter(Boolean), finalDecision, finalResponse, traceId };
    }
    const contextExecution = decideContextExecution(previous, contextValidation.relations, plannerOutput.tasks);
    this.trace(traceId, "pending_request", { action: contextExecution.resumedPending ? "resumed" : "unchanged", reasonCode: contextExecution.contextDecision.action, capability: "", missingFields: [] });
    const hasActionableTask = plannerOutput.tasks.some((task) => !NON_ACTIONABLE_TASK_TYPES.has(task.type));
    const unknownTaskCount = plannerOutput.tasks.filter((task) => NON_ACTIONABLE_TASK_TYPES.has(task.type)).length;
    const noReplyGateHit = Boolean(plannerOutput.shouldIgnore && !hasActionableTask);
    this.trace(traceId, "no_reply_gate", { shouldIgnore: plannerOutput.shouldIgnore, actionableTaskCount: plannerOutput.tasks.length - unknownTaskCount, unknownTaskCount, gateHit: noReplyGateHit, reasonCode: noReplyGateHit ? "no_reply_gate_hit" : plannerOutput.shouldIgnore ? "actionable_task_present" : "should_ignore_false" });
    if (plannerOutput.shouldIgnore && !hasActionableTask) {
      const finalDecision = decideFinal({ noReplyReason: "no_reply_gate_hit" });
      const claimValidation = { ok: true, errors: [], coveredTaskIds: [], missingTaskIds: [] };
      const finalResponse = renderFinal({ finalDecision, responsePlan: null, validatedReplyText: "", claimValidation });
      const messageRecord = { channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: "acknowledgement", replyType: "no_reply_v2", replyText: finalResponse.replyText, route: "no_reply_silent_ignore", decisionReason: finalDecision.reasonCode, shouldReply: finalResponse.shouldReply, noReply: !finalResponse.shouldReply, needsReview: false, humanHandoff: false, status: "resolved", processingStatus: "decided" };
      if (typeof this.persistence.updateMessageEvent === "function") this.persistence.updateMessageEvent(input.customerId, input.channelId, input.eventId, messageRecord);
      else this.persistence.appendMessageLog(input.customerId, messageRecord);
      this.trace(traceId, "controlled_decision", { decision: finalDecision.action, reason: messageRecord.decisionReason, actionableTaskCount: 0 });
      this.trace(traceId, "final_decision", { decision: finalDecision.action, reasonCode: finalDecision.reasonCode });
      this.traceContexts.delete(traceId);
      return { ...finalResponse, noReply: !finalResponse.shouldReply, taskResults: [], reviewCount: 0, reviewIds: [], claimValidation, finalDecision, finalResponse, traceId };
    }
    const executionTasks = contextExecution.executionTasks;
    const executionItems = contextExecution.executionItems;
    const relationsByCandidateIndex = new Map(contextValidation.relations.map((relation) => [relation.candidateIndex, relation]));
    const candidateInputsByCandidateIndex = {};
    for (const item of executionItems) {
      const plannerStay = normalizedTaskStay(item.task);
      const relation = relationsByCandidateIndex.get(item.candidateIndex);
      const approvedContext = approvedTemporalContext(contextSnapshot, relation, plannerStay);
      const temporal = resolveTemporalExpression(plannerStay.dateExpression, {
        eventTimestamp: input.eventTimestamp, timezone: catalog.timezone,
        checkInCandidate: plannerStay.checkInCandidate, checkOutCandidate: plannerStay.checkOutCandidate,
        nightsCandidate: plannerStay.nightsCandidate,
        defaultNights: ["availability", "bundle_availability", "room_options", "capacity", "price", "total_price"].includes(item.task.type) ? 1 : null,
        defaultNightsRuleRef: SINGLE_DATE_DEFAULT_NIGHT_RULE_REF,
        defaultSearchRangeDays: item.task.type === "available_dates" ? DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS : null,
        defaultSearchRangeRuleRef: item.task.type === "available_dates" ? AVAILABLE_DATES_LOOKAHEAD_RULE_REF : null,
        sourceEvidenceRefs: sourceEvidenceRefsForRelation(relation),
        approvedContext,
        allowContextReuse: Boolean(approvedContext)
      });
      candidateInputsByCandidateIndex[item.candidateIndex] = {
        confirmedFields: { guests: plannerStay.guestCountCandidate, nights: plannerStay.nightsCandidate, inventory: confirmedInventoryFromTask(catalog, item.task) },
        temporalResult: temporal,
        hasNewDateExpression: Boolean(plannerStay.dateExpression.rawText && plannerStay.dateExpression.kind !== "none"),
        sourceEvidenceRefs: sourceEvidenceRefsForRelation(relation)
      };
      item.temporal = temporal;
    }
    this.trace(traceId, "temporal", { contextAction: contextExecution.contextDecision.action, items: executionItems.map((item) => ({ candidateIndex: item.candidateIndex, requestCycleId: item.requestCycleId, dateExpressionPresent: Boolean(normalizedTaskStay(item.task).dateExpression.rawText && normalizedTaskStay(item.task).dateExpression.kind !== "none"), resolutionStatus: item.temporal.resolutionStatus, provenance: item.temporal.provenance, ruleRefs: item.temporal.ruleRefs, fields: item.temporal.fields, produced: { checkIn: Boolean(item.temporal.checkIn), checkOut: Boolean(item.temporal.checkOut), nights: Boolean(item.temporal.nights) } })) });
    let state = reduceConversationState(previous, {
      tasks: executionTasks,
      contextDecisions: contextExecution.contextDecisions,
      candidateInputsByCandidateIndex
    }, scope);
    const executableItems = executionItems.map((item) => {
      const conditions = conditionsForCycle(state, item.requestCycleId);
      return { ...item, executionConditions: TEMPORAL_FAILURE_STATUSES.has(item.temporal.resolutionStatus) ? blockedTemporalConditions(conditions) : conditions };
    });
    this.trace(traceId, "state", { contextAction: contextExecution.contextDecision.action, operations: state.transition, requestCycles: state.requestCycles.map((cycle) => ({ requestCycleId: cycle.requestCycleId, status: cycle.status })), ...(this.diagnosticDetail ? { stateAfter: traceState(state) } : {}) });
    const formalRequests = executableItems.map((item) => {
      const resolvedEntity = item.task.entity && item.task.entity.rawText && !isGenericAvailabilityEntity(item.task) ? resolveEntity(catalog, item.task.entity) : null;
      return buildFormalRequest({ property, task: item.task, requestCycleId: item.requestCycleId, temporalResult: item.temporal, confirmedInputs: item.executionConditions, resolvedEntity, sourceEvidenceRefs: sourceEvidenceRefsForRelation(relationsByCandidateIndex.get(item.candidateIndex)) });
    });
    const queryPlans = formalRequests.map(buildQueryPlan).filter(Boolean);
    this.trace(traceId, "entity_resolution", { tasks: formalRequests.map((request) => this.diagnosticDetail ? { taskId: request.taskId, resolved: request.entity } : { taskId: request.taskId, status: request.entity.status, canonicalId: request.entity.canonicalId, candidateCount: request.entity.canonicalSet.length }) });
    this.trace(traceId, "formal_request", { items: formalRequests.map((request) => ({ formalRequestId: request.formalRequestId, taskId: request.taskId, candidateIndex: request.candidateIndex, requestCycleId: request.requestCycleId, readiness: request.readiness.status })) });
    this.trace(traceId, "query_plan", { count: queryPlans.length, items: queryPlans.map((plan) => ({ formalRequestId: plan.formalRequestId, capability: plan.capability, operation: plan.operation, propertyId: plan.propertyId })) });
    const resolverCalls = [];
    const tracedAvailabilityResolver = (request) => { const result = this.availabilityResolver(request); resolverCalls.push(availabilityTraceSummary(request, result)); return result; };
    const tracedAvailableDatesResolver = (request) => { const result = this.availableDatesResolver(request); resolverCalls.push(availabilityTraceSummary(request, result)); return result; };
    const executionOutcomes = [
      ...formalRequests.filter((request) => request.readiness.status !== "ready").map(resultForNotReady),
      ...executeQueryPlans({ property, catalog, queryPlans, availabilityResolver: tracedAvailabilityResolver, availableDatesResolver: tracedAvailableDatesResolver, priceOverrides: this.listPriceOverrides(input.customerId) })
    ];
    let taskResults = executionOutcomes.map(legacyTaskResult);
    const inputTaskIds = executionTasks.map((task) => task.taskId);
    let executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    if (!executorCoverage.ok) {
      taskResults = [...taskResults, ...executorCoverage.missingTaskIds.map((taskId) => ({ taskId, type: "unknown", status: "failed", reason: "executor_missing_task", facts: { subject: "這個問題" }, review: true }))];
      executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    }
    const pendingRequests = [];
    for (const item of executableItems) {
      if (!item.requestCycleId) continue;
      const previousPending = (previous.pendingRequests || []).find((pending) => pending.requestCycleId === item.requestCycleId) || null;
      const itemResults = taskResults.filter((result) => result.taskId === item.task.taskId);
      const pendingRequest = pendingFromResults({
        plannerOutput: { ...plannerOutput, tasks: [item.task], missingInformation: executableItems.length === 1 ? plannerOutput.missingInformation : [] },
        taskResults: itemResults,
        conditions: item.executionConditions,
        scope: {
          eventId: input.eventId,
          now: scope.now,
          createdAt: previousPending && previousPending.metadata && previousPending.metadata.createdAt,
          pendingRequestId: previousPending && previousPending.pendingRequestId || crypto.randomUUID(),
          requestCycleId: item.requestCycleId,
          expiresAt: new Date(new Date(scope.now).getTime() + 24 * 60 * 60 * 1000).toISOString()
        }
      });
      state = reducePendingRequests(state, { requestCycleId: item.requestCycleId, pendingRequest }, scope);
      pendingRequests.push({ requestCycleId: item.requestCycleId, pendingRequest });
    }
    this.persistence.setConversationState(input.customerId, input.channelId, input.lineUserId, state);
    this.trace(traceId, "pending_request", {
      items: pendingRequests.map((item) => ({ requestCycleId: item.requestCycleId, action: item.pendingRequest ? "stored" : "cleared", capability: item.pendingRequest && item.pendingRequest.capability || "", missingFields: item.pendingRequest && item.pendingRequest.missingFields || [] }))
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
    const hasAnswerSection = responsePlan.sections.some((section) => section.responseMode === "answer");
    const hasIncompleteSection = responsePlan.sections.some((section) => section.responseMode !== "answer");
    const composerEligible = !(hasAnswerSection && hasIncompleteSection);
    if (composerEligible && this.composer && typeof this.composer.compose === "function") {
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
    const claimValidationRejected = !claimValidation.ok || rejectionReasonCodes.length > 0;
    this.trace(traceId, "composer", { outputLength: replyText.length, coveredTaskIds: claimedTaskIds || inputTaskIds, missingTaskIds: claimValidation.missingTaskIds, composerSource, validationResult: rejectionReasonCodes.length ? "rejected" : "accepted", rejectionReasonCodes, fallbackOccurred, ...(this.diagnosticDetail ? { composerInput: responsePlan, finalOutput: replyText } : {}), sections: responsePlan.sections.map((section) => ({ taskId: section.taskId, responseMode: section.responseMode, type: section.type })) });
    if (!claimValidation.ok) {
      const reason = claimValidation.errors.includes("incomplete_task_coverage") ? "composer_incomplete_coverage" : "claim_validation_failed";
      const item = this.persistReview(input, reason, "回覆未完整涵蓋所有問題，已改用安全完整回覆。", "");
      if (item.reviewId) reviewIds.push(item.reviewId);
      replyText = composeControlledReply(responsePlan);
      claimValidation = validateClaims(replyText, responsePlan, inputTaskIds);
    }
    this.trace(traceId, "claim_validator", { errors: claimValidation.errors, coveredTaskIds: claimValidation.coveredTaskIds, missingTaskIds: claimValidation.missingTaskIds });
    const finalDecision = decideFinal({ executionOutcomes, claimValidation: claimValidationRejected ? { ok: false } : claimValidation });
    const finalResponse = renderFinal({ finalDecision, responsePlan, validatedReplyText: replyText, claimValidation });
    const messageRecord = { channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: "multi_task_v2", replyType: `${finalResponse.action}_v2`, replyText: finalResponse.replyText, route: `final_decision_${finalResponse.action}`, shouldReply: finalResponse.shouldReply, noReply: !finalResponse.shouldReply, needsReview: finalDecision.reviewRequired, humanHandoff: finalDecision.action === "handoff", status: finalDecision.reviewRequired ? "pending" : "resolved", processingStatus: "decided", decisionReason: finalDecision.reasonCode };
    if (typeof this.persistence.updateMessageEvent === "function") this.persistence.updateMessageEvent(input.customerId, input.channelId, input.eventId, messageRecord);
    else this.persistence.appendMessageLog(input.customerId, messageRecord);
    this.trace(traceId, "line_ready", { coveredTaskIds: claimValidation.coveredTaskIds, missingTaskIds: claimValidation.missingTaskIds, replyLength: finalResponse.replyText.length });
    this.trace(traceId, "final_decision", { decision: finalDecision.action, reasonCode: finalDecision.reasonCode });
    this.traceContexts.delete(traceId); return { ...finalResponse, noReply: !finalResponse.shouldReply, taskResults, reviewCount: reviewIds.length, reviewIds, claimValidation, finalDecision, finalResponse, state, traceId };
  }

  persistReview(input, reason, note, taskId) {
    return this.persistence.appendMessageLog(input.customerId, { channelId: input.channelId, lineUserId: input.lineUserId, eventId: `${input.eventId}:review:${taskId || reason}`, eventTimestamp: input.eventTimestamp, guestMessage: input.messageText, detectedIntent: taskId || "unknown", replyType: "scoped_handoff_v2", replyText: "", route: "human_handoff_required", decisionReason: reason, shouldReply: false, noReply: true, humanHandoff: true, needsReview: true, reviewNote: note, status: "pending", processingStatus: "decided" });
  }
}

module.exports = { ConversationEngineV2, SAFE_FALLBACK, normalizePlannerOutput, DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS, SINGLE_DATE_DEFAULT_NIGHT_RULE_REF, AVAILABLE_DATES_LOOKAHEAD_RULE_REF, sourceEventsForInput };
