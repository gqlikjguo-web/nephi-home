"use strict";

const crypto = require("node:crypto");

const { validatePlannerOutput, applyPlannerSemanticContract, normalizeEligibilityEvidence, discardLegacyPlannerStateControls } = require("./planner-schema");
const { normalizeDetailIntent } = require("./detail-intent");
const { buildPropertyCatalog } = require("./property-catalog");
const {
  canonicalizeExecutionItem,
  normalizedTaskStay,
  DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS,
  SINGLE_DATE_DEFAULT_NIGHT_RULE_REF,
  AVAILABLE_DATES_LOOKAHEAD_RULE_REF
} = require("./canonicalizer");
const {
  readConversationStateV3
} = require("../conversation-contracts/conversation-state-v3");
const {
  buildContextSnapshotV3,
  decideContextExecutionV3,
  executionConditionsV3,
  reduceConversationStateV3
} = require("./conversation-state-v3-reducer");
const { executeCanonicalQueryPlans, isGenericAvailabilityEntity } = require("./capability-executor");
const { buildResponsePlan } = require("./response-planner");
const { composeControlledReply, mergeComposedSections } = require("./controlled-composer");
const { validateClaims } = require("./claim-validator");
const { coverageByStatus, assertTaskCoverage } = require("./task-coverage");
const { availabilityTraceSummary } = require("./resolver-adapter");
const { validateUnderstandingContext, evidenceMatchesSource } = require("./understanding-validator");
const { normalizePlannerEvidenceCoordinates } = require("./evidence-normalizer");
const { buildCanonicalFormalRequest, buildCanonicalQueryPlan, resultForNotReady } = require("./formal-request");
const { buildFinalDecision } = require("./final-decision");
const { SAFE_HANDOFF_TEXT, buildFinalResponse } = require("./final-response-renderer");
const { applyControlledReplyRules } = require("../custom-reply-rules");

const NON_ACTIONABLE_TASK_TYPES = new Set(["unknown"]);
const TEMPORAL_FAILURE_STATUSES = new Set(["unresolved"]);
const PENDING_STATUSES = new Set(["pending", "needs_clarification"]);
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
function traceState(state) {
  const copy = JSON.parse(JSON.stringify(state || {}));
  if (copy.scope) {
    delete copy.scope.lineUserId;
    delete copy.scope.userId;
  }
  return copy;
}
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

const SAFE_FALLBACK = SAFE_HANDOFF_TEXT;
const PLANNER_ERROR_CATEGORIES = new Set(["timeout", "rate_limit", "provider_5xx", "invalid_request", "empty_response", "json_parse", "structured_output", "network", "unknown"]);
const PLANNER_ATTEMPT_ERROR_CATEGORIES = new Set(["", "timeout", "network", "rate_limit", "provider_5xx", "provider_4xx", "empty_response", "parse_failure", "structured_output_failure", "local_contract_failure", "unknown"]);
const PLANNER_ERROR_NAMES = new Set(["Error", "AbortError", "SyntaxError", "TypeError"]);
const PLANNER_PROVIDER_DIAGNOSTIC = Symbol.for("junzan.plannerProviderDiagnostic");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safePlannerProviderErrorField(value, maxLength) {
  const text = String(value || "");
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text.slice(0, maxLength) : "";
}

function safePlannerErrorCategory(value, fallback = "unknown") {
  return PLANNER_ERROR_CATEGORIES.has(value) ? value : fallback;
}

function safePlannerAttemptDiagnostic(attempt = {}) {
  const attemptNumber = Number(attempt.attemptNumber);
  const durationMs = Number(attempt.durationMs);
  const timeoutMs = Number(attempt.timeoutMs);
  const httpStatus = Number(attempt.httpStatus);
  const startedAt = new Date(String(attempt.startedAt || ""));
  const completedAt = new Date(String(attempt.completedAt || ""));
  const errorCategory = String(attempt.errorCategory || "");
  const clientRequestId = String(attempt.clientRequestId || "");
  return {
    attemptNumber: Number.isInteger(attemptNumber) && attemptNumber >= 1 ? Math.min(attemptNumber, 2) : 1,
    startedAt: Number.isFinite(startedAt.getTime()) ? startedAt.toISOString() : "",
    completedAt: Number.isFinite(completedAt.getTime()) ? completedAt.toISOString() : "",
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : 0,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 0 ? Math.min(Math.round(timeoutMs), 120000) : 0,
    clientRequestId: UUID_PATTERN.test(clientRequestId) ? clientRequestId : "",
    providerRequestId: safePlannerProviderErrorField(attempt.providerRequestId, 200),
    timeout: Boolean(attempt.timeout),
    retryable: Boolean(attempt.retryable),
    errorCategory: PLANNER_ATTEMPT_ERROR_CATEGORIES.has(errorCategory) ? errorCategory : "unknown",
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : 0,
    responseBodyPresent: Boolean(attempt.responseBodyPresent),
    parsedOutputPresent: Boolean(attempt.parsedOutputPresent)
  };
}

function safePlannerRetrySuccessDiagnostic(plannerOutput) {
  const diagnostic = plannerOutput && plannerOutput[PLANNER_PROVIDER_DIAGNOSTIC];
  if (!diagnostic) return {};
  const providerAttempts = (Array.isArray(diagnostic.providerAttempts) ? diagnostic.providerAttempts : [])
    .slice(0, 2)
    .map(safePlannerAttemptDiagnostic);
  if (!providerAttempts.length) return {};
  const retried = diagnostic.retryPerformed === true;
  return {
    providerAttemptCount: providerAttempts.length,
    firstAttemptErrorCategory: retried ? safePlannerErrorCategory(diagnostic.firstAttemptErrorCategory) : "",
    finalErrorCategory: "",
    retryPerformed: retried,
    retrySucceeded: retried && diagnostic.retrySucceeded === true,
    providerAttempts
  };
}

function safePlannerErrorDiagnostic(error, planner) {
  const configured = Boolean(planner && typeof planner.classify === "function");
  const status = Number(error && (error.status || error.statusCode));
  const httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  const timeout = Boolean(error && (error.timeout === true || error.name === "AbortError"));
  const suppliedCategory = configured && PLANNER_ERROR_CATEGORIES.has(error && error.errorCategory)
    ? error.errorCategory
    : "unknown";
  let errorCategory = suppliedCategory;
  let errorCode = "planner_unknown_error";
  if (!configured) {
    errorCategory = "unknown";
    errorCode = "planner_configuration_error";
  } else if (timeout) {
    errorCategory = "timeout";
    errorCode = "planner_timeout";
  } else if (httpStatus === 401 || httpStatus === 403) {
    errorCategory = "invalid_request";
    errorCode = "planner_authentication_error";
  } else if (httpStatus === 404) {
    errorCategory = "invalid_request";
    errorCode = "planner_model_not_found";
  } else if (httpStatus === 429) {
    errorCategory = "rate_limit";
    errorCode = "planner_rate_limit";
  } else if (httpStatus >= 500 && httpStatus <= 599) {
    errorCategory = "provider_5xx";
    errorCode = "planner_provider_error";
  } else if (httpStatus >= 400 && httpStatus <= 499) {
    errorCategory = "invalid_request";
    errorCode = "planner_http_error";
  } else if (errorCategory === "structured_output") {
    errorCode = "planner_structured_output_error";
  } else if (errorCategory === "json_parse" || error && error.name === "SyntaxError") {
    errorCategory = "json_parse";
    errorCode = "planner_parse_error";
  } else if (errorCategory === "empty_response") {
    errorCode = "planner_empty_response";
  } else if (errorCategory === "network") {
    errorCode = "planner_network_error";
  }
  const attemptCount = Number(error && error.providerAttemptCount);
  const providerAttempts = (Array.isArray(error && error.providerAttempts) ? error.providerAttempts : [])
    .slice(0, 2)
    .map(safePlannerAttemptDiagnostic);
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
    providerErrorParam: safePlannerProviderErrorField(error && error.providerErrorParam, 200),
    providerAttemptCount: configured && Number.isInteger(attemptCount) && attemptCount >= 0 ? Math.min(attemptCount, 2) : 0,
    firstAttemptErrorCategory: safePlannerErrorCategory(error && error.firstAttemptErrorCategory, errorCategory),
    finalErrorCategory: safePlannerErrorCategory(error && error.finalErrorCategory, errorCategory),
    retryPerformed: Boolean(error && error.retryPerformed),
    retrySucceeded: Boolean(error && error.retrySucceeded),
    retryable: Boolean(error && error.retryable),
    responseBodyPresent: Boolean(error && error.responseBodyPresent),
    parsedOutputPresent: Boolean(error && error.parsedOutputPresent),
    providerAttempts
  };
}

class ConversationEngineV2 {
  constructor({ planner, composer, persistence, getProperty, availabilityResolver, availableDatesResolver, listPriceOverrides, listCustomReplies, now = () => new Date(), onDiagnostic, diagnosticDetail = false, diagnosticMetadata = {} }) {
    this.planner = planner; this.composer = composer; this.persistence = persistence; this.getProperty = getProperty; this.availabilityResolver = availabilityResolver; this.availableDatesResolver = availableDatesResolver; this.listPriceOverrides = listPriceOverrides || (() => []); this.listCustomReplies = listCustomReplies || (() => []); this.now = now; this.onDiagnostic = typeof onDiagnostic === "function" ? onDiagnostic : null; this.diagnosticDetail = Boolean(diagnosticDetail); this.diagnosticMetadata = diagnosticMetadata || {}; this.traceContexts = new Map();
  }

  trace(traceId, stage, details) {
    if (!this.onDiagnostic) return;
    try { this.onDiagnostic({ ...(this.traceContexts.get(traceId) || {}), traceId, stage, ...details }); }
    catch { /* diagnostics must never affect conversation fallback or delivery */ }
  }

  persistConversationStateV3(input, reduction) {
    const state = reduceConversationStateV3(reduction);
    this.persistence.setConversationState(
      input.customerId,
      input.channelId,
      input.lineUserId,
      state
    );
    return state;
  }

  async process(input) {
    const traceId = crypto.randomUUID();
    const sourceEvents = sourceEventsForInput(input);
    const property = this.getProperty(input.customerId);
    if (!property || property.propertyId !== input.customerId) throw new Error("property_not_found");
    const scope = { propertyId: input.customerId, channelId: input.channelId, lineUserId: input.lineUserId, eventId: input.eventId, now: this.now().toISOString() };
    const stateScope = {
      propertyId: scope.propertyId,
      channel: scope.channelId,
      userId: scope.lineUserId
    };
    const previous = readConversationStateV3(
      this.persistence.getConversationState(
        input.customerId,
        input.channelId,
        input.lineUserId
      ),
      stateScope,
      scope.now
    );
    const contextSnapshot = buildContextSnapshotV3(previous, scope);
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
        : [],
      ...safePlannerRetrySuccessDiagnostic(plannerOutput)
    });
    if (!plannerOutput || typeof plannerOutput !== "object" || Array.isArray(plannerOutput) || !Array.isArray(plannerOutput.tasks)) {
      this.trace(traceId, "validation", { acceptedTasks: [], rejectedTasks: [], rejectionReasons: [parserSucceeded ? "planner_output_unusable" : "planner_parse_failed"], finalTasks: [], ...(parserSucceeded ? { errorCategory: "local_contract_failure" } : {}) });
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
      this.trace(traceId, "validation", { acceptedTasks: [], rejectedTasks: [], rejectionReasons: ["planner_normalization_failed"], finalTasks: [], errorCategory: "local_contract_failure" });
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
      this.trace(traceId, "validation", { ...plannerValidationTrace(plannerOutput, structuralValidation), errorCategory: "local_contract_failure" });
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
    plannerOutput = applyPlannerSemanticContract(plannerOutput, { catalog, sourceEvents });
    const validation = validatePlannerOutput(plannerOutput);
    this.trace(traceId, "validation", { ...plannerValidationTrace(plannerOutput, validation), semanticValidation: plannerOutput.semanticValidation, ...(!validation.ok ? { errorCategory: "local_contract_failure" } : {}) });
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
    const contextExecution = decideContextExecutionV3({
      state: previous,
      relations: contextValidation.relations,
      plannerTasks: plannerOutput.tasks,
      catalog,
      now: scope.now
    });
    this.trace(traceId, "pending_request", { action: contextExecution.resumedPending ? "resumed" : "unchanged", reasonCode: contextExecution.contextDecision.reasonCode, capability: "", missingFields: [] });
    const hasActionableTask = plannerOutput.tasks.some((task) => !NON_ACTIONABLE_TASK_TYPES.has(task.type));
    const unknownTaskCount = plannerOutput.tasks.filter((task) => NON_ACTIONABLE_TASK_TYPES.has(task.type)).length;
    const noReplyGateHit = Boolean(plannerOutput.shouldIgnore && !hasActionableTask);
    this.trace(traceId, "no_reply_gate", { shouldIgnore: plannerOutput.shouldIgnore, actionableTaskCount: plannerOutput.tasks.length - unknownTaskCount, unknownTaskCount, gateHit: noReplyGateHit, reasonCode: noReplyGateHit ? "no_reply_gate_hit" : plannerOutput.shouldIgnore ? "actionable_task_present" : "should_ignore_false" });
    if (plannerOutput.shouldIgnore && !hasActionableTask) {
      if (contextExecution.endedTaskIds.length) {
        const state = this.persistConversationStateV3(input, {
          previous,
          endedTaskIds: contextExecution.endedTaskIds,
          scope
        });
        this.trace(traceId, "state", {
          contextAction: contextExecution.contextDecision.action,
          revision: state.revision,
          tasks: state.tasks.map((task) => ({
            taskId: task.taskId,
            taskType: task.taskType,
            status: task.status,
            missingFields: task.missingFields
          }))
        });
      }
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
    this.trace(traceId, "context_execution", { items: executionItems.map((item) => ({ taskId: item.task.taskId, reasonCode: item.transition && item.transition.reasonCode || "", contextTaskId: item.transition && item.transition.contextTask && item.transition.contextTask.taskId || "", slotSources: item.transition && item.transition.slotSources || {} })) });
    const relationsByCandidateIndex = new Map(contextExecution.relations.map((relation) => [relation.candidateIndex, relation]));
    const candidateInputsByCandidateIndex = {};
    const canonicalItems = executionItems.map((item) => canonicalizeExecutionItem({
      item,
      relation: relationsByCandidateIndex.get(item.candidateIndex),
      contextSnapshot,
      catalog,
      guestMessage: input.messageText,
      eventTimestamp: input.eventTimestamp
    }));
    for (const item of canonicalItems) {
      candidateInputsByCandidateIndex[item.candidateIndex] = item.stateInput;
    }
    this.trace(traceId, "canonical_request", {
      items: canonicalItems.map((item) => item.canonicalRequest)
    });
    this.trace(traceId, "temporal", {
      contextAction: contextExecution.contextDecision.action,
      items: canonicalItems.map((item) => {
        const temporal = item.canonicalRequest.temporalState;
        const plannerStay = normalizedTaskStay(item.task);
        return {
          candidateIndex: item.candidateIndex,
          requestCycleId: item.requestCycleId,
          taskIds: temporal.applicableTaskIds,
          dateExpressionPresent: Boolean(
            plannerStay.dateExpression.rawText
            && plannerStay.dateExpression.kind !== "none"
          ),
          expressionType: temporal.expressionType,
          resolutionStatus: temporal.resolutionStatus,
          resolutionSource: temporal.resolutionSource,
          repairReasonCode: temporal.repairReasonCode,
          timezone: temporal.timezone,
          provenance: temporal.provenance,
          ruleRefs: temporal.ruleRefs,
          fields: temporal.fields,
          produced: {
            checkIn: Boolean(temporal.checkIn),
            checkOut: Boolean(temporal.checkOut),
            nights: Boolean(temporal.nights)
          }
        };
      })
    });
    const executableItems = canonicalItems.map((item) => {
      const conditions = executionConditionsV3(previous, item);
      return {
        ...item,
        executionConditions: TEMPORAL_FAILURE_STATUSES.has(
          item.canonicalRequest.temporalState.resolutionStatus
        )
          ? blockedTemporalConditions(conditions)
          : conditions
      };
    });
    const formalRequests = executableItems.map((item) => buildCanonicalFormalRequest({
      property,
      canonicalRequest: item.canonicalRequest,
      candidateIndex: item.candidateIndex,
      requestCycleId: item.requestCycleId,
      confirmedInputs: item.executionConditions
    }));
    const queryPlans = formalRequests.map(buildCanonicalQueryPlan).filter(Boolean);
    this.trace(traceId, "entity_resolution", { tasks: formalRequests.map((request) => this.diagnosticDetail ? { taskId: request.taskId, resolved: request.entity } : { taskId: request.taskId, status: request.entity.status, canonicalId: request.entity.canonicalId, candidateCount: request.entity.canonicalSet.length }) });
    this.trace(traceId, "formal_request", { items: formalRequests.map((request) => ({ formalRequestId: request.formalRequestId, taskId: request.taskId, candidateIndex: request.candidateIndex, requestCycleId: request.requestCycleId, readiness: request.readiness.status })) });
    this.trace(traceId, "query_plan", { count: queryPlans.length, items: queryPlans.map((plan) => ({ formalRequestId: plan.formalRequestId, capability: plan.capability, operation: plan.operation, propertyId: plan.propertyId })) });
    const resolverCalls = [];
    const tracedAvailabilityResolver = (request) => { const result = this.availabilityResolver(request); resolverCalls.push(availabilityTraceSummary(request, result)); return result; };
    const tracedAvailableDatesResolver = (request) => { const result = this.availableDatesResolver(request); resolverCalls.push(availabilityTraceSummary(request, result)); return result; };
    let executionOutcomes = [
      ...formalRequests.filter((request) => request.readiness.status !== "ready").map(resultForNotReady),
      ...executeCanonicalQueryPlans({ property, catalog, queryPlans, availabilityResolver: tracedAvailabilityResolver, availableDatesResolver: tracedAvailableDatesResolver, priceOverrides: this.listPriceOverrides(input.customerId) })
    ];
    executionOutcomes = applyControlledReplyRules({
      rules: this.listCustomReplies(input.customerId),
      property,
      canonicalItems,
      executionOutcomes,
      now: this.now()
    });
    let taskResults = executionOutcomes.map(legacyTaskResult);
    const inputTaskIds = canonicalItems.map((item) => item.canonicalRequest.taskId);
    let executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    if (!executorCoverage.ok) {
      taskResults = [...taskResults, ...executorCoverage.missingTaskIds.map((taskId) => ({ taskId, type: "unknown", status: "failed", reason: "executor_missing_task", facts: { subject: "這個問題" }, review: true }))];
      executorCoverage = assertTaskCoverage(inputTaskIds, coverageByStatus(taskResults));
    }
    const state = this.persistConversationStateV3(input, {
      previous,
      canonicalItems,
      formalRequests,
      executionOutcomes,
      endedTaskIds: contextExecution.endedTaskIds,
      scope
    });
    this.trace(traceId, "state", {
      contextAction: contextExecution.contextDecision.action,
      revision: state.revision,
      tasks: state.tasks.map((task) => ({
        taskId: task.taskId,
        taskType: task.taskType,
        status: task.status,
        missingFields: task.missingFields
      })),
      ...(this.diagnosticDetail ? { stateAfter: traceState(state) } : {})
    });
    this.trace(traceId, "pending_request", {
      items: state.tasks.filter((task) => PENDING_STATUSES.has(task.status)).map(
        (task) => ({
          requestCycleId: task.taskId,
          action: "stored",
          capability: task.taskType,
          missingFields: task.missingFields
        })
      )
    });
    this.trace(traceId, "executor", { results: this.diagnosticDetail ? taskResults : taskResults.map((item) => ({ taskId: item.taskId, status: item.status, reason: item.reason || "", locationFactProvided: Boolean(item.facts && item.facts.locationMapUrl), factSource: item.facts && item.facts.source || "" })), resolverCalls: this.diagnosticDetail ? resolverCalls : undefined, coverage: executorCoverage });
    const reviewIds = [];
    for (const result of taskResults.filter((item) => item.review)) {
      const sourceTask = executionTasks.find((task) => task.taskId === result.taskId);
      const item = this.persistReview(input, result.reason || result.status, `「${sourceTask && sourceTask.sourceText || "該問題"}」需要業者確認。`, result.taskId);
      if (item.reviewId) reviewIds.push(item.reviewId);
    }
    const responsePlan = buildResponsePlan({
      propertyId: input.customerId,
      taskResults,
      inputTaskIds,
      canonicalRequests: canonicalItems.map((item) => item.canonicalRequest),
      reviewActions: reviewIds.map((reviewId) => ({ reviewId, created: true }))
    });
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
    this.trace(traceId, "composer", { outputLength: replyText.length, coveredTaskIds: claimedTaskIds || inputTaskIds, missingTaskIds: claimValidation.missingTaskIds, composerSource, validationResult: rejectionReasonCodes.length ? "rejected" : "accepted", rejectionReasonCodes, fallbackOccurred, ...(this.diagnosticDetail ? { composerInput: responsePlan, finalOutput: replyText } : {}), sections: responsePlan.sections.map((section) => ({ taskId: section.taskId, responseMode: section.responseMode, type: section.type })) });
    if (!claimValidation.ok) {
      const reason = claimValidation.errors.includes("incomplete_task_coverage") ? "composer_incomplete_coverage" : "claim_validation_failed";
      const item = this.persistReview(input, reason, "回覆未完整涵蓋所有問題，已改用安全完整回覆。", "");
      if (item.reviewId) reviewIds.push(item.reviewId);
      replyText = composeControlledReply(responsePlan);
      claimValidation = validateClaims(replyText, responsePlan, inputTaskIds);
    }
    this.trace(traceId, "claim_validator", { errors: claimValidation.errors, coveredTaskIds: claimValidation.coveredTaskIds, missingTaskIds: claimValidation.missingTaskIds });
    const finalDecision = decideFinal({ executionOutcomes, claimValidation });
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
