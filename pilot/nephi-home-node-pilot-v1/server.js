"use strict";

const http = require("http");
const { messagingApi, validateSignature } = require("@line/bot-sdk");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createProviders } = require("./lib/providers/provider-factory");
const { createV2CompositionRoot } = require("./lib/v2-composition-root");
const { createMvpService, AppError } = require("./lib/mvp-service");
const { runtimeConfig } = require("./config/runtime");
const { verifyPassword, sessionTokenHash } = require("./lib/admin-auth");
const { createOnboardingService } = require("./lib/onboarding-service");
const { resolvePublicProperty, normalizePublicSlug } = require("./lib/public-property-routing");
const { createOnboardingEmailNotifier } = require("./lib/onboarding-email");
const { createPublicBrand } = require("./config/public-brand");
const { renderPublicHtml } = require("./lib/public-brand-html");
const { normalizeRoomRecord, normalizeRoomHighlights, characterCount } = require("./lib/room-data");
const { providedAmenities } = require("./lib/bundle-entertainment");
const { createLineBindingService } = require("./lib/line-binding-service");
const { createLineSetupService } = require("./lib/line-setup-service");
const { CustomReplyError, createCustomReplyService } = require("./lib/custom-reply-rules");
const { createTestOnlyLineMessageTrace } = require("./lib/test-only-line-message-trace");
const { createGithubActionsOidcVerifier } = require("./lib/test-only-acceptance-oidc");
const { syncTestOnlyAcceptanceData } = require("./lib/providers/test-only-acceptance-data");

const APP_ROOT = __dirname;
const PUBLIC_ROOT = path.join(APP_ROOT, "public");
const SAFE_PLANNER_ERROR_NAMES = new Set(["Error", "AbortError", "SyntaxError", "TypeError"]);
const SAFE_PLANNER_ERROR_CODES = new Set(["planner_authentication_error", "planner_model_not_found", "planner_rate_limit", "planner_provider_error", "planner_http_error", "planner_timeout", "planner_parse_error", "planner_empty_response", "planner_structured_output_error", "planner_network_error", "planner_configuration_error", "planner_unknown_error"]);
const SAFE_SEMANTIC_LEDGER_BOUNDARY_STAGES = new Set(["raw_parsed_output", "compile_before", "compile_after", "validate"]);
const SAFE_SEMANTIC_LEDGER_FAILURE_CODES = new Set(["candidate_object", "candidate_id", "candidate_count_limit", "semantic_kind", "capability", "canonical_identity", "property_catalog_identity", "identity_alignment", "evidence_refs", "lodging_scope", "lodging_scope_conflict", "temporal_candidate"]);
const SAFE_EVIDENCE_FAILURE_CODES = new Set(["missing_refs", "too_many_refs", "invalid_evidence_ref", "missing_source_identity", "unknown_event_id", "unknown_message_ref", "identity_conflict", "invalid_offset", "invalid_quote", "out_of_bounds", "quote_slice_mismatch"]);
const SAFE_SEMANTIC_LIFECYCLES = new Set(["bound", "pending_task", "unknown"]);
const SAFE_SEMANTIC_MISSING_REFS_REASONS = new Set(["", "pending_invalid_raw_evidence", "bound_missing_provenance", "bound_unknown_provenance_relation", "bound_relation_context_invalid", "bound_relation_evidence_invalid", "compiled_evidence_lost", "other"]);
const SAFE_PLANNER_ERROR_CATEGORIES = new Set(["timeout", "rate_limit", "provider_5xx", "invalid_request", "empty_response", "json_parse", "structured_output", "network", "unknown"]);
const SAFE_PLANNER_ATTEMPT_ERROR_CATEGORIES = new Set(["", "timeout", "network", "rate_limit", "provider_5xx", "provider_4xx", "empty_response", "parse_failure", "structured_output_failure", "local_contract_failure", "unknown"]);
const SAFE_CONTEXT_RELATION_KINDS = new Set(["new_request", "supplement_existing", "modify_existing", "end_existing", "relation_uncertain"]);
const SAFE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_REPAIR_KINDS = new Set(["coverage_repair", "task_collection_repair", "semantic_repair"]);
const TEST_ONLY_NATIVE_LINE_MESSAGE_TYPES = new Set(["sticker", "image", "video", "file"]);

function lineMessageEventDisposition(event) {
  if (!event || event.type !== "message" || !event.message || !event.replyToken) return { accepted: false, engineInvoked: false, reasonCode: "line_message_event_invalid" };
  if (event.message.type === "text") return { accepted: true, engineInvoked: true, reasonCode: "line_text_event" };
  if (TEST_ONLY_NATIVE_LINE_MESSAGE_TYPES.has(event.message.type)) return { accepted: true, engineInvoked: false, reasonCode: "line_non_text_event_ignored" };
  return { accepted: false, engineInvoked: false, reasonCode: "line_message_type_unsupported" };
}

function safeAcceptanceText(value, maxLength = 2000) {
  return String(value === undefined || value === null ? "" : value).slice(0, maxLength);
}

function safeAcceptanceInteger(value) {
  return value !== null && value !== undefined && value !== "" && Number.isInteger(Number(value)) ? Number(value) : null;
}

function safeAcceptanceInventory(item) {
  return {
    publicName: safeAcceptanceText(item && item.publicName, 120),
    capacity: safeAcceptanceInteger(item && item.capacity),
    category: ["room", "bundle"].includes(item && item.category) ? item.category : ""
  };
}

function safeAcceptanceFacts(facts = {}) {
  const safe = {};
  for (const key of ["subject", "status", "answer", "locationMapUrl", "detailIntent", "availability", "checkIn", "checkOut"]) {
    if (facts[key] !== undefined && facts[key] !== null) safe[key] = safeAcceptanceText(facts[key]);
  }
  for (const key of ["detailProvided", "detailNeedsConfirmation"]) {
    if (typeof facts[key] === "boolean") safe[key] = facts[key];
  }
  if (Array.isArray(facts.amenities)) safe.amenities = facts.amenities.slice(0, 100).map((item) => safeAcceptanceText(item, 120));
  if (Array.isArray(facts.availableDates)) safe.availableDates = facts.availableDates.slice(0, 366).map((item) => safeAcceptanceText(item, 20));
  if (facts.range && typeof facts.range === "object") safe.range = { from: safeAcceptanceText(facts.range.from, 20), to: safeAcceptanceText(facts.range.to, 20) };
  if (Array.isArray(facts.availableInventory)) safe.availableInventory = facts.availableInventory.slice(0, 100).map(safeAcceptanceInventory);
  if (Array.isArray(facts.applicableBundles)) safe.applicableBundles = facts.applicableBundles.slice(0, 100).map((item) => ({ name: safeAcceptanceText(item && item.name, 120), note: safeAcceptanceText(item && item.note, 500) }));
  if (Array.isArray(facts.prices)) safe.prices = facts.prices.slice(0, 100).map((item) => ({
    inventory: safeAcceptanceInventory(item && item.inventory),
    daily: Array.isArray(item && item.daily) ? item.daily.slice(0, 60).map((daily) => ({ date: safeAcceptanceText(daily && daily.date, 20), price: safeAcceptanceInteger(daily && daily.price), source: safeAcceptanceText(daily && daily.source, 80) })) : [],
    total: safeAcceptanceInteger(item && item.total),
    currency: safeAcceptanceText(item && item.currency, 10)
  }));
  return safe;
}

function safeAcceptanceTaskResult(item = {}) {
  const facts = item.facts || {};
  return {
    taskId: safeAcceptanceText(item.taskId, 80),
    capability: safeAcceptanceText(item.type, 80),
    type: safeAcceptanceText(item.type, 80),
    status: safeAcceptanceText(item.status, 80),
    reason: safeAcceptanceText(item.reason, 160),
    dataSource: safeAcceptanceText(facts.customReplySource || facts.source, 80),
    facts: safeAcceptanceFacts(facts)
  };
}

function safeAcceptanceList(values, maxLength = 80) {
  return Array.isArray(values) ? values.slice(0, 200).map((value) => safeAcceptanceText(value, maxLength)) : [];
}

function safeAcceptanceFinalDecision(decision = {}) {
  const summary = decision.executionSummary || {};
  const executionSummary = {};
  for (const key of ["answeredTaskIds", "noAvailabilityTaskIds", "notReadyTaskIds", "unknownTaskIds", "propertyDataMissingTaskIds", "technicalErrorTaskIds", "invalidQueryPlanTaskIds"]) executionSummary[key] = safeAcceptanceList(summary[key]);
  return {
    action: safeAcceptanceText(decision.action, 40),
    reasonCode: safeAcceptanceText(decision.reasonCode, 160),
    taskIds: safeAcceptanceList(decision.taskIds),
    missingFields: safeAcceptanceList(decision.missingFields, 120),
    clarificationCandidates: safeAcceptanceList(decision.clarificationCandidates, 160),
    reviewRequired: decision.reviewRequired === true,
    executionSummary
  };
}

function safeAcceptanceClaimValidation(validation = {}) {
  return {
    ok: validation.ok === true,
    errors: safeAcceptanceList(validation.errors, 120),
    coveredTaskIds: safeAcceptanceList(validation.coveredTaskIds),
    missingTaskIds: safeAcceptanceList(validation.missingTaskIds),
    unexpectedTaskIds: safeAcceptanceList(validation.unexpectedTaskIds)
  };
}

function safeDiagnosticLabel(value, fallback, maxLength) {
  const text = String(value || "");
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text.slice(0, maxLength) : fallback;
}

function safePlannerTraceTask(task) {
  return {
    taskId: String(task && task.taskId || "").slice(0, 80),
    type: String(task && task.type || "").slice(0, 80),
    category: String(task && task.category || "").slice(0, 80),
    canonicalCandidate: task && task.canonicalCandidate !== undefined && task.canonicalCandidate !== null
      ? String(task.canonicalCandidate).slice(0, 120)
      : null,
    detailIntent: String(task && task.detailIntent || "").slice(0, 80)
  };
}

function safeContextValidationReason(value) {
  const text = String(value || "");
  return /^(?:contextRelationCandidates(?:\.\d+(?:\.(?:candidateIndex|candidateRequestCycleRefs))?)?|tasks\.\d+\.(?:candidateIndex|contextRelationCandidate))$/.test(text) ? text : "";
}

function safeDiagnosticCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

function safePlannerMissingInformation(value) {
  return (Array.isArray(value) ? value : []).slice(0, 20).map((item) => {
    const text = String(item || "").slice(0, 200);
    return /^formal_subject:/i.test(text) ? "formal_subject_coverage_required" : text;
  });
}

function safeRepairProvenance(value) {
  return (Array.isArray(value) ? value : []).slice(0, 24).flatMap((item) => {
    const kind = String(item && item.kind || "");
    const correlationId = String(item && item.correlationId || "");
    return SAFE_REPAIR_KINDS.has(kind) && SAFE_UUID_PATTERN.test(correlationId)
      ? [{ kind, correlationId }]
      : [];
  });
}

function safeSemanticLedgerBoundaries(value) {
  return (Array.isArray(value) ? value : []).slice(0, 4).flatMap((item) => {
    const stage = String(item && item.stage || "");
    if (!SAFE_SEMANTIC_LEDGER_BOUNDARY_STAGES.has(stage)) return [];
    const count = (field) => Math.min(safeDiagnosticCount(item && item[field]), 24);
    const failureCodes = [...new Set((Array.isArray(item && item.failureCodes) ? item.failureCodes : [])
      .map(String)
      .filter((code) => SAFE_SEMANTIC_LEDGER_FAILURE_CODES.has(code)))].sort();
    const evidenceFailureCodes = [...new Set((Array.isArray(item && item.evidenceFailureCodes) ? item.evidenceFailureCodes : [])
      .map(String)
      .filter((code) => SAFE_EVIDENCE_FAILURE_CODES.has(code)))].sort();
    const candidates = (Array.isArray(item && item.candidates) ? item.candidates : []).slice(0, 24).map((candidate, candidateOrdinal) => {
      const provenanceRelationCandidateIndexes = (Array.isArray(candidate && candidate.provenanceRelationCandidateIndexes) ? candidate.provenanceRelationCandidateIndexes : [])
        .slice(0, 12).filter((index) => Number.isInteger(index) && index >= 0 && index <= 1000000);
      const candidateFailureCodes = [...new Set((Array.isArray(candidate && candidate.failureCodes) ? candidate.failureCodes : [])
        .map(String).filter((code) => SAFE_SEMANTIC_LEDGER_FAILURE_CODES.has(code)))].sort();
      const provenanceRelations = (Array.isArray(candidate && candidate.provenanceRelations) ? candidate.provenanceRelations : []).slice(0, 12).flatMap((relation) => {
        const candidateIndex = Number(relation && relation.candidateIndex);
        if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex > 1000000) return [];
        const relationEvidenceFailureCodes = [...new Set((Array.isArray(relation && relation.evidenceFailureCodes) ? relation.evidenceFailureCodes : [])
          .map(String).filter((code) => SAFE_EVIDENCE_FAILURE_CODES.has(code)))].sort();
        return [{ candidateIndex, relationExists: Boolean(relation.relationExists), relationContextValid: Boolean(relation.relationContextValid), relationEvidenceValid: Boolean(relation.relationEvidenceValid), evidenceFailureCodes: relationEvidenceFailureCodes }];
      });
      const coverageStatus = String(candidate && candidate.coverageStatus || "unknown");
      const lifecycle = String(candidate && candidate.lifecycle || "unknown");
      const missingRefsReason = String(candidate && candidate.missingRefsReason || "");
      return {
        candidateOrdinal: Number.isInteger(candidate && candidate.candidateOrdinal) ? Math.max(0, Math.min(candidate.candidateOrdinal, 23)) : candidateOrdinal,
        coverageStatus: SAFE_SEMANTIC_LIFECYCLES.has(coverageStatus) ? coverageStatus : "unknown",
        lifecycle: SAFE_SEMANTIC_LIFECYCLES.has(lifecycle) ? lifecycle : "unknown",
        provenancePresent: Boolean(candidate && candidate.provenancePresent),
        provenanceCount: Number.isInteger(candidate && candidate.provenanceCount) ? Math.max(0, Math.min(candidate.provenanceCount, 12)) : 0,
        provenanceRelationCandidateIndexes,
        verifiedRelationCount: Number.isInteger(candidate && candidate.verifiedRelationCount) ? Math.max(0, Math.min(candidate.verifiedRelationCount, 12)) : 0,
        evidenceRefCount: Number.isInteger(candidate && candidate.evidenceRefCount) ? Math.max(0, Math.min(candidate.evidenceRefCount, 12)) : 0,
        valid: Boolean(candidate && candidate.valid),
        failureCodes: candidateFailureCodes,
        missingRefsReason: SAFE_SEMANTIC_MISSING_REFS_REASONS.has(missingRefsReason) ? missingRefsReason : "other",
        provenanceRelations
      };
    });
    return [{ stage, candidateCount: count("candidateCount"), validCandidateCount: count("validCandidateCount"), invalidCandidateCount: count("invalidCandidateCount"), ownershipCount: count("ownershipCount"), failureCodes, evidenceFailureCodes, candidates }];
  });
}

function safePlannerErrorCategory(value, fallback = "unknown") {
  return SAFE_PLANNER_ERROR_CATEGORIES.has(value) ? value : fallback;
}

function safePlannerAttemptTrace(attempt = {}) {
  const attemptNumber = Number(attempt.attemptNumber);
  const durationMs = Number(attempt.durationMs);
  const timeoutMs = Number(attempt.timeoutMs);
  const httpStatus = Number(attempt.httpStatus);
  const startedAt = new Date(String(attempt.startedAt || ""));
  const completedAt = new Date(String(attempt.completedAt || ""));
  const clientRequestId = String(attempt.clientRequestId || "");
  const errorCategory = String(attempt.errorCategory || "");
  return {
    attemptNumber: Number.isInteger(attemptNumber) && attemptNumber >= 1 ? Math.min(attemptNumber, 2) : 1,
    startedAt: Number.isFinite(startedAt.getTime()) ? startedAt.toISOString() : "",
    completedAt: Number.isFinite(completedAt.getTime()) ? completedAt.toISOString() : "",
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : 0,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 0 ? Math.min(Math.round(timeoutMs), 120000) : 0,
    clientRequestId: SAFE_UUID_PATTERN.test(clientRequestId) ? clientRequestId : "",
    providerRequestId: safeDiagnosticLabel(attempt.providerRequestId, "", 200),
    timeout: Boolean(attempt.timeout),
    retryable: Boolean(attempt.retryable),
    errorCategory: SAFE_PLANNER_ATTEMPT_ERROR_CATEGORIES.has(errorCategory) ? errorCategory : "unknown",
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : 0,
    responseBodyPresent: Boolean(attempt.responseBodyPresent),
    parsedOutputPresent: Boolean(attempt.parsedOutputPresent)
  };
}

function safePlannerAttempts(value) {
  return (Array.isArray(value) ? value : []).slice(0, 2).map(safePlannerAttemptTrace);
}

function formatSafeTestOnlyConversationTrace(details = {}) {
  const base = { scope: "conversation-engine-v2", traceId: String(details.traceId || ""), propertyId: String(details.propertyId || ""), stage: String(details.stage || "") };
  if (details.stage === "property_catalog") {
    const location = details.location || {};
    return { ...base, providerType: String(details.providerType || "unknown"), location: {
      source: String(location.source || "none"),
      profileValuePresent: Boolean(location.profileValuePresent),
      transportValuePresent: Boolean(location.transportValuePresent),
      urlValidation: String(location.urlValidation || "fail")
    } };
  }
  if (details.stage === "planner") {
    const providerAttempts = safePlannerAttempts(details.providerAttempts);
    return {
      ...base,
      parserSucceeded: Boolean(details.parserSucceeded),
      taskCount: Number(details.taskCount || 0),
      discourse: details.discourse || null,
      shouldIgnore: Boolean(details.shouldIgnore),
      missingInformation: safePlannerMissingInformation(details.missingInformation),
      tasks: (details.tasks || []).map(safePlannerTraceTask),
      ...(providerAttempts.length ? {
        providerAttemptCount: providerAttempts.length,
        firstAttemptErrorCategory: details.retryPerformed === true ? safePlannerErrorCategory(details.firstAttemptErrorCategory) : "",
        finalErrorCategory: details.retrySucceeded === true || details.retryPerformed !== true ? "" : safePlannerErrorCategory(details.finalErrorCategory),
        retryPerformed: Boolean(details.retryPerformed),
        retrySucceeded: Boolean(details.retrySucceeded),
        ...(details.taskCollectionRepairPerformed === true ? {
          taskCollectionRepairPerformed: true,
          preservedTaskCount: Math.min(safeDiagnosticCount(details.preservedTaskCount), 24),
          fallbackTaskCount: Math.min(safeDiagnosticCount(details.fallbackTaskCount), 24)
        } : {}),
        ...(details.coverageRepairPerformed === true || details.coverageRepairFallback === true ? {
          coverageRepairPerformed: details.coverageRepairPerformed === true,
          coverageRepairSucceeded: details.coverageRepairSucceeded === true,
          coverageRepairFallback: details.coverageRepairFallback === true
        } : {}),
        ...(safeRepairProvenance(details.repairProvenance).length ? {
          repairProvenance: safeRepairProvenance(details.repairProvenance)
        } : {}),
        ...(safeSemanticLedgerBoundaries(details.semanticLedgerBoundaries).length ? {
          semanticLedgerBoundaries: safeSemanticLedgerBoundaries(details.semanticLedgerBoundaries)
        } : {}),
        providerAttempts
      } : {})
    };
  }
  if (details.stage === "planner_error") {
    const status = Number(details.httpStatus);
    return {
      ...base,
      errorName: SAFE_PLANNER_ERROR_NAMES.has(details.errorName) ? details.errorName : "Error",
      errorCode: SAFE_PLANNER_ERROR_CODES.has(details.errorCode) ? details.errorCode : "planner_unknown_error",
      httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0,
      timeout: Boolean(details.timeout),
      errorCategory: SAFE_PLANNER_ERROR_CATEGORIES.has(details.errorCategory) ? details.errorCategory : "unknown",
      model: safeDiagnosticLabel(details.model, "", 120),
      provider: safeDiagnosticLabel(details.provider, "unknown", 40),
      providerErrorType: safeDiagnosticLabel(details.providerErrorType, "", 120),
      providerErrorCode: safeDiagnosticLabel(details.providerErrorCode, "", 120),
      providerErrorParam: safeDiagnosticLabel(details.providerErrorParam, "", 200),
      providerAttemptCount: Math.min(safeDiagnosticCount(details.providerAttemptCount), 2),
      firstAttemptErrorCategory: safePlannerErrorCategory(details.firstAttemptErrorCategory, safePlannerErrorCategory(details.errorCategory)),
      finalErrorCategory: safePlannerErrorCategory(details.finalErrorCategory, safePlannerErrorCategory(details.errorCategory)),
      retryPerformed: Boolean(details.retryPerformed),
      retrySucceeded: Boolean(details.retrySucceeded),
      retryable: Boolean(details.retryable),
      responseBodyPresent: Boolean(details.responseBodyPresent),
      parsedOutputPresent: Boolean(details.parsedOutputPresent),
      providerAttempts: safePlannerAttempts(details.providerAttempts)
    };
  }
  if (details.stage === "validation") return {
    ...base,
    acceptedTasks: (details.acceptedTasks || []).map(safePlannerTraceTask),
    rejectedTasks: (details.rejectedTasks || []).map((task) => ({ ...safePlannerTraceTask(task), reasons: (task.reasons || []).map(String) })),
    rejectionReasons: (details.rejectionReasons || []).map(String),
    finalTasks: (details.finalTasks || []).map(safePlannerTraceTask),
    ...(safeRepairProvenance(details.repairProvenance).length ? {
      repairProvenance: safeRepairProvenance(details.repairProvenance)
    } : {}),
    ...(details.errorCategory === "local_contract_failure" ? { errorCategory: "local_contract_failure" } : {})
  };
  if (details.stage === "context_validation") return {
    ...base,
    rejectionReasons: (details.rejectionReasons || []).map(safeContextValidationReason).filter(Boolean),
    candidates: (details.candidates || []).map((candidate) => ({
      candidateIndex: Number.isInteger(candidate && candidate.candidateIndex) && candidate.candidateIndex >= 0 ? candidate.candidateIndex : -1,
      relationKind: SAFE_CONTEXT_RELATION_KINDS.has(candidate && candidate.relationKind) ? candidate.relationKind : "",
      candidateRequestCycleRefCount: safeDiagnosticCount(candidate && candidate.candidateRequestCycleRefCount),
      evidenceRefCount: safeDiagnosticCount(candidate && candidate.evidenceRefCount),
      evidenceSourceMatches: (candidate && Array.isArray(candidate.evidenceSourceMatches) ? candidate.evidenceSourceMatches : []).map(Boolean)
    }))
  };
  if (details.stage === "canonical_request") return {
    ...base,
    items: (details.items || []).map((item) => ({
      taskId: String(item && item.taskId || ""),
      ...(SAFE_UUID_PATTERN.test(String(item && item.repairCorrelationId || "")) ? {
        repairCorrelationId: String(item.repairCorrelationId)
      } : {}),
      capability: String(item && item.capability || ""),
      canonicalEntity: {
        category: String(item && item.canonicalEntity && item.canonicalEntity.category || ""),
        canonicalId: String(item && item.canonicalEntity && item.canonicalEntity.canonicalId || ""),
        status: String(item && item.canonicalEntity && item.canonicalEntity.status || "")
      },
      detailIntent: String(item && item.detailIntent || ""),
      temporalState: {
        resolutionStatus: String(item && item.temporalState && item.temporalState.resolutionStatus || ""),
        expressionType: String(item && item.temporalState && item.temporalState.expressionType || "").slice(0, 80),
        repairReasonCode: String(item && item.temporalState && item.temporalState.repairReasonCode || "").slice(0, 80),
        checkIn: String(item && item.temporalState && item.temporalState.checkIn || ""),
        checkOut: String(item && item.temporalState && item.temporalState.checkOut || ""),
        nights: Number.isInteger(item && item.temporalState && item.temporalState.nights)
          ? item.temporalState.nights
          : null,
        timezone: String(item && item.temporalState && item.temporalState.timezone || "")
      },
      stayDependency: item && item.stayDependency === false
        ? false
        : String(item && item.stayDependency || ""),
      requiredFields: (item && Array.isArray(item.requiredFields) ? item.requiredFields : []).map(String),
      resolverId: String(item && item.resolverId || ""),
      riskLevel: String(item && item.riskLevel || ""),
      responseMode: String(item && item.responseMode || ""),
      evidenceRefCount: safeDiagnosticCount(item && item.evidenceRefs && item.evidenceRefs.length)
    }))
  };
  if (details.stage === "context_execution") return { ...base, items: (details.items || []).map((item) => ({ taskId: String(item.taskId || ""), reasonCode: String(item.reasonCode || ""), contextTaskId: String(item.contextTaskId || ""), slotSources: { checkIn: String(item.slotSources && item.slotSources.checkIn || ""), checkOut: String(item.slotSources && item.slotSources.checkOut || ""), product: String(item.slotSources && item.slotSources.product || "") } })) };
  if (details.stage === "formal_request") return { ...base, items: (details.items || []).map((item) => ({ taskId: String(item.taskId || ""), readiness: String(item.readiness || "") })) };
  if (details.stage === "query_plan") return { ...base, count: safeDiagnosticCount(details.count), items: (details.items || []).map((item) => ({ taskId: String(item.taskId || ""), capability: String(item.capability || ""), operation: String(item.operation || "") })) };
  if (details.stage === "state") return { ...base, contextAction: String(details.contextAction || ""), revision: safeDiagnosticCount(details.revision), tasks: (details.tasks || []).map((item) => ({ taskId: String(item.taskId || ""), taskType: String(item.taskType || ""), status: String(item.status || ""), missingFields: (item.missingFields || []).map(String) })) };
  if (details.stage === "executor") return { ...base, results: (details.results || []).map((item) => ({ taskId: item.taskId || "", status: item.status || "", reason: item.reason || "", locationFactProvided: Boolean(item.locationFactProvided), factSource: item.factSource || "" })) };
  if (details.stage === "semantic_contract") return {
    ...base,
    inputTasks: (details.inputTasks || []).map(safePlannerTraceTask),
    outputTasks: (details.outputTasks || []).map(safePlannerTraceTask),
    shouldIgnore: Boolean(details.shouldIgnore),
    validationPassed: Boolean(details.validationPassed)
  };
  if (details.stage === "no_reply_gate") return { ...base, shouldIgnore: Boolean(details.shouldIgnore), actionableTaskCount: Number(details.actionableTaskCount || 0), unknownTaskCount: Number(details.unknownTaskCount || 0), gateHit: Boolean(details.gateHit), reasonCode: String(details.reasonCode || "") };
  if (details.stage === "pending_request") return { ...base, action: String(details.action || ""), reasonCode: String(details.reasonCode || ""), capability: String(details.capability || ""), missingFields: (details.missingFields || []).map(String) };
  if (details.stage === "fallback") return { ...base, reasonCode: String(details.reasonCode || ""), branch: String(details.branch || "") };
  if (details.stage === "final_decision" || details.stage === "line_transport") return { ...base, decision: String(details.decision || ""), reasonCode: String(details.reasonCode || ""), attempted: Boolean(details.attempted), delivered: Boolean(details.delivered) };
  if (["response_plan", "composer", "claim_validator", "line_ready"].includes(details.stage)) return { ...base, sectionCount: details.sectionCount, coveredTaskIds: details.coveredTaskIds || [], missingTaskIds: details.missingTaskIds || [], replyLength: details.replyLength, composerSource: details.composerSource || "", validationResult: details.validationResult || "" };
  return null;
}

function logSafeTestOnlyConversationTrace(details) {
  const record = formatSafeTestOnlyConversationTrace(details);
  if (record) console.log(JSON.stringify(record));
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function cookieValue(request, name) {
  const item = String(request.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

function isAdminDataRoute(pathname) {
  return pathname === "/api/test-only/line-message-traces" || pathname === "/api/homestays" || pathname === "/api/bootstrap" || pathname === "/api/settings" || pathname === "/api/property-profile" || pathname === "/api/property-facts" || pathname.startsWith("/api/custom-replies") || pathname.startsWith("/api/availability/month") || pathname === "/api/availability/day" || pathname === "/api/availability/day-note" || pathname === "/api/availability/batch" || pathname.startsWith("/api/bundles") || pathname.startsWith("/api/room-pricing") || pathname === "/api/room-price-overrides" || pathname.startsWith("/api/guests") || pathname === "/api/messages" || pathname === "/api/dashboard" || pathname.startsWith("/api/reviews");
}

function sendData(response, data, status = 200) {
  sendJson(response, status, { ok: true, data });
}

function adminSessionData(session) {
  const safe = { ...session, properties: (session.properties || []).map(({ username, ...property }) => property) };
  if (String(safe.username || "").startsWith("onboarding_")) delete safe.username;
  return safe;
}

function sendError(response, error) {
  const isGuardError = Boolean(error && error.fatal && Number.isInteger(error.status) && error.code);
  const isProviderAppError = Boolean(error && Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && error.code);
  const status = error instanceof AppError || isGuardError || isProviderAppError ? error.status : 500;
  const code = error instanceof AppError || isGuardError || isProviderAppError ? error.code : "INTERNAL_ERROR";
  sendJson(response, status, {
    ok: false,
    error: { code, message: status === 500 ? "伺服器暫時無法完成操作，請稍後再試" : error.message }
  });
}

function logTestLineDiagnostic(step, details = {}) {
  console.log(JSON.stringify({ scope: "test-only-line-webhook", step, ...details }));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new AppError(400, "INVALID_JSON", "Request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > 1024 * 1024) {
        reject(new AppError(413, "REQUEST_TOO_LARGE", "Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[extension] || "application/octet-stream";
}

function sendStatic(response, relativePath, publicBrand) {
  const filePath = path.resolve(PUBLIC_ROOT, relativePath);
  if (!filePath.startsWith(PUBLIC_ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  response.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer"
  });
  if (path.extname(filePath).toLowerCase() === ".html") {
    response.end(renderPublicHtml(fs.readFileSync(filePath, "utf8"), publicBrand));
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}

function secretsMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
function nextDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) {
    throw new AppError(400, "INVALID_DATE", "checkIn must use YYYY-MM-DD");
  }
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) {
    throw new AppError(400, "INVALID_DATE", "checkIn is invalid");
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function publicPriceForDate(room, date, overrides = []) {
  const override = overrides.find((item) => item.roomId === room.id && item.date === date);
  if (override && Number.isInteger(Number(override.price)) && Number(override.price) > 0) return Number(override.price);
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const key = weekday === 0 ? "sundayPrice" : weekday === 5 ? "fridayPrice" : weekday === 6 ? "saturdayHolidayPrice" : "mondayThursdayPrice";
  const value = Number(room[key] ?? room.basePrice);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function publicPriceForStay(room, checkIn, checkOut, overrides = []) {
  let date = checkIn, total = 0;
  while (date < checkOut) {
    const nightly = publicPriceForDate(room, date, overrides);
    if (nightly === null) return null;
    total += nightly;
    date = nextDateKey(date);
  }
  return total > 0 ? total : null;
}

function publicNightlyPrices(room, checkIn, checkOut, overrides = []) {
  const nights = [];
  for (let date = checkIn; date < checkOut; date = nextDateKey(date)) {
    const price = publicPriceForDate(room, date, overrides);
    if (price === null) return [];
    nights.push({ date, price });
  }
  return nights;
}

function publicAvailabilityResult(result, property, overrides = []) {
  let lineUrl = "";
  try {
    const parsed = new URL(String(result.lineUrl || ""));
    const allowedLineHosts = new Set(["lin.ee", "line.me"]);
    if (parsed.protocol === "https:" && allowedLineHosts.has(parsed.hostname.toLowerCase())) lineUrl = parsed.toString();
  } catch {}
  const item = (input) => {
    const room = normalizeRoomRecord(input);
    return ({
    id: room.id,
    displayName: room.displayName,
    name: room.displayName,
    roomCode: room.roomCode,
    capacity: Number(room.capacity || 0),
    highlights: room.highlights,
    ...(input.inventoryType === "bundle" ? { entertainmentAmenities: providedAmenities(input.entertainmentAmenities).slice(0, 5).map(({ key, displayName, source, position }) => ({ key, displayName, source, position })) } : {}),
    price: publicPriceForStay(room, result.checkIn, result.checkOut, overrides),
    nightlyPrices: publicNightlyPrices(room, result.checkIn, result.checkOut, overrides),
    currency: String(property.currency || "TWD")
  });};
  const rooms = result.rooms.filter((room) => room.inventoryType !== "bundle").map(item);
  const bundles = result.rooms.filter((room) => room.inventoryType === "bundle").map(item);
  return {
    propertyName: result.homestayName,
    checkInDate: result.checkIn,
    checkOutDate: result.checkOut,
    guestCount: result.guests,
    queryMode: result.queryMode,
    roomFilter: result.roomType,
    rooms,
    bundles,
    empty: rooms.length === 0 && bundles.length === 0,
    lineUrl
  };
}

function publicPropertyMetadata(property) {
  const rooms = (property.rooms || []).filter((room) => room && room.enabled !== false).map(normalizeRoomRecord);
  const hasBundles = rooms.some((room) => room.inventoryType === "bundle");
  let lineUrl = "";
  try {
    const parsed = new URL(String(property.contactLink || ""));
    if (parsed.protocol === "https:" && new Set(["lin.ee", "line.me"]).has(parsed.hostname.toLowerCase())) lineUrl = parsed.toString();
  } catch {}
  return {
    propertyName: String(property.displayName || ""),
    inventoryOptions: [{ id: "all", name: hasBundles ? "全部房型與包棟" : "全部房型", inventoryType: "all" }, ...rooms.map((room) => ({ id: room.id, name: room.displayName, inventoryType: room.inventoryType || "room", capacity: room.capacity, basePrice: room.mondayThursdayPrice ?? room.basePrice ?? null }))],
    lineUrl
  };
}

function createRequestHandler(service, options = {}) {
  const sharedLineWebhookHandler = options.sharedLineWebhookHandler;
  const lineBindingService = options.lineBindingService;
  const lineSetupService = options.lineSetupService;
  const persistence = options.persistence;
  const customerSettings = options.customerSettings;
  const onboarding = options.onboarding;
  const customReplyService = options.customReplyService;
  const customReplyTestHandler = options.customReplyTestHandler;
  const testOnlyAcceptanceHandler = options.testOnlyAcceptanceHandler;
  const testOnlyAcceptanceDataInitializer = options.testOnlyAcceptanceDataInitializer;
  const testOnlyAcceptanceOidcVerifier = options.testOnlyAcceptanceOidcVerifier;
  const testOnlyLineMessageTrace = options.testOnlyLineMessageTrace;
  const adminAuthRequired = Boolean(options.adminAuthRequired);
  const publicBrand = options.publicBrand || createPublicBrand();
  const deploymentCommit = String(options.deploymentCommit || process.env.RENDER_GIT_COMMIT || "");
  async function authorizeTestOnlyAcceptance(request) {
    const sessionToken = cookieValue(request, "nephi_admin_session");
    const session = sessionToken && adminAuthRequired ? await persistence.getAdminSession(sessionTokenHash(sessionToken)) : null;
    if (session && onboarding && onboarding.isPlatformAdmin(session)) return { kind: "platform_admin", session };
    const authorization = String(request.headers.authorization || "");
    const bearer = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
    if (!bearer || typeof testOnlyAcceptanceOidcVerifier !== "function") throw new AppError(401, "ACCEPTANCE_AUTH_REQUIRED", "Authorized test-only acceptance identity is required");
    let verified = false;
    try { verified = await testOnlyAcceptanceOidcVerifier(bearer[1]); } catch { verified = false; }
    if (!verified) throw new AppError(403, "ACCEPTANCE_OIDC_REJECTED", "GitHub Actions acceptance identity was rejected");
    return { kind: "github_actions_oidc" };
  }
  return async function handleRequest(request, response) {
    const url = new URL(request.url, "http://127.0.0.1");
    const pathname = url.pathname;

    try {
      if (request.method === "GET" && pathname === "/api/health") {
        return sendData(response, { status: "ready", testOnly: true, commit: deploymentCommit });
      }
      if (request.method === "GET" && pathname === "/api/public/brand") return sendData(response, publicBrand);
      if (request.method === "POST" && pathname === "/api/admin/test-only/conversation-acceptance") {
        if (typeof testOnlyAcceptanceHandler !== "function") return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
        const identity = await authorizeTestOnlyAcceptance(request);
        return sendData(response, await testOnlyAcceptanceHandler(await readJsonBody(request), identity));
      }
      if (request.method === "POST" && pathname === "/api/admin/test-only/acceptance-data-integrity") {
        if (typeof testOnlyAcceptanceDataInitializer !== "function") return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
        const identity = await authorizeTestOnlyAcceptance(request);
        return sendData(response, await testOnlyAcceptanceDataInitializer(await readJsonBody(request), identity));
      }
      if (request.method === "DELETE" && pathname === "/api/admin/test-only/conversation-acceptance") {
        if (typeof testOnlyAcceptanceHandler !== "function") return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
        const identity = await authorizeTestOnlyAcceptance(request);
        return sendData(response, await testOnlyAcceptanceHandler({ ...(await readJsonBody(request)), clear: true }, identity));
      }
      const sharedLineWebhookMatch = /^\/api\/line\/webhooks\/([A-Za-z0-9_-]{32,128})$/.exec(pathname);
      if (request.method === "POST" && sharedLineWebhookMatch) {
        if (!sharedLineWebhookHandler) throw new AppError(503, "LINE_BINDING_WEBHOOK_NOT_CONFIGURED", "LINE webhook is not configured");
        const result = await sharedLineWebhookHandler({
          rawBody: await readRawBody(request),
          signature: request.headers["x-line-signature"],
          webhookKey: sharedLineWebhookMatch[1]
        });
        return sendData(response, result);
      }
      if (request.method === "GET" && pathname === "/") return sendStatic(response, "home.html", publicBrand);
      if (request.method === "GET" && pathname === "/guest") return sendStatic(response, "guest.html", publicBrand);
      if (request.method === "GET" && pathname === "/onboarding") return sendStatic(response, "onboarding.html", publicBrand);
      if (request.method === "GET" && pathname === "/line/setup") return sendStatic(response, "line-setup.html", publicBrand);
      if (request.method === "GET" && pathname === "/admin/setup") return sendStatic(response, "admin-setup.html", publicBrand);
      if (request.method === "GET" && pathname === "/admin/onboarding") {const token=cookieValue(request,"nephi_admin_session"),session=token&&adminAuthRequired?await persistence.getAdminSession(sessionTokenHash(token)):null;if(!session||!onboarding||!onboarding.isPlatformAdmin(session))throw new AppError(401,"PLATFORM_ADMIN_REQUIRED","需要平台管理者權限");return sendStatic(response,"admin-onboarding.html",publicBrand);}
      if (request.method === "GET" && pathname === "/admin/line-connections") {
        const token = cookieValue(request, "nephi_admin_session");
        const session = token && adminAuthRequired ? await persistence.getAdminSession(sessionTokenHash(token)) : null;
        if (!session || !onboarding || !onboarding.isPlatformAdmin(session)) throw new AppError(401, "PLATFORM_ADMIN_REQUIRED", "Platform administrator access is required");
        return sendStatic(response, "admin-line-connections.html", publicBrand);
      }
      if (request.method === "GET" && pathname === "/admin") return sendStatic(response, "admin.html", publicBrand);
      if (request.method === "GET" && pathname.startsWith("/assets/")) return sendStatic(response, pathname.slice(1), publicBrand);

      const slugRoute = /^\/([a-z0-9-]+)(?:\/(admin))?$/i.exec(pathname);
      if (request.method === "GET" && slugRoute) {
        return sendStatic(response, slugRoute[2] ? "admin.html" : "guest.html", publicBrand);
      }

      if(pathname==="/api/public/onboarding/drafts"&&request.method==="POST"){if(!onboarding)throw new AppError(503,"ONBOARDING_NOT_CONFIGURED","業者導入只支援 PostgreSQL");throw new AppError(401,"ONBOARDING_INVITE_REQUIRED","請使用平台提供的有效邀請連結");}
      if(pathname==="/api/public/onboarding/invite"&&request.method==="GET"){if(!onboarding)throw new AppError(503,"ONBOARDING_NOT_CONFIGURED","業者導入只支援 PostgreSQL");return sendData(response,onboarding.resolveInvitation(url.searchParams.get("token")));}
      if(pathname==="/api/public/onboarding/resume"&&request.method==="GET"){if(!onboarding)throw new AppError(503,"ONBOARDING_NOT_CONFIGURED","業者導入只支援 PostgreSQL");return sendData(response,onboarding.resolveResume(url.searchParams.get("token")));}
      const draftMatch=/^\/api\/public\/onboarding\/drafts\/([^/]+)$/.exec(pathname),previewMatch=/^\/api\/public\/onboarding\/drafts\/([^/]+)\/preview$/.exec(pathname),submitMatch=/^\/api\/public\/onboarding\/drafts\/([^/]+)\/submit$/.exec(pathname);const draftToken=request.headers["x-onboarding-draft-token"];
      if(draftMatch&&request.method==="GET")return sendData(response,await onboarding.getDraft(draftMatch[1],draftToken));
      if(draftMatch&&request.method==="PATCH")return sendData(response,await onboarding.saveDraft(draftMatch[1],draftToken,await readJsonBody(request)));
      if(previewMatch&&request.method==="GET")return sendData(response,await onboarding.preview(previewMatch[1],draftToken));
      if(submitMatch&&request.method==="POST")return sendData(response,await onboarding.submit(submitMatch[1],draftToken));
      if (pathname === "/api/public/line-setup/resolve" && request.method === "POST") {
        if (!lineSetupService) throw new AppError(503, "LINE_SETUP_NOT_CONFIGURED", "LINE setup is not configured");
        return sendData(response, lineSetupService.resolve((await readJsonBody(request)).token));
      }
      if (pathname === "/api/public/line-setup/redeem" && request.method === "POST") {
        if (!lineSetupService) throw new AppError(503, "LINE_SETUP_NOT_CONFIGURED", "LINE setup is not configured");
        return sendData(response, lineSetupService.redeem(await readJsonBody(request)));
      }

      if (pathname === "/api/admin/line-connections" || pathname === "/api/admin/line-setup-links" || pathname.startsWith("/api/admin/line-setup-links/")) {
        const token = cookieValue(request, "nephi_admin_session");
        const session = token && adminAuthRequired ? await persistence.getAdminSession(sessionTokenHash(token)) : null;
        if (!session || !onboarding || !onboarding.isPlatformAdmin(session)) throw new AppError(401, "PLATFORM_ADMIN_REQUIRED", "Platform administrator access is required");
        if (!lineSetupService) throw new AppError(503, "LINE_SETUP_NOT_CONFIGURED", "LINE setup is not configured");
        if (pathname === "/api/admin/line-connections" && request.method === "GET") {
          return sendData(response, { items: lineSetupService.propertyStatuses() });
        }
        if (pathname === "/api/admin/line-setup-links" && request.method === "GET") {
          return sendData(response, { items: lineSetupService.list(url.searchParams.get("propertyId")) });
        }
        if (pathname === "/api/admin/line-setup-links" && request.method === "POST") {
          return sendData(response, lineSetupService.create(await readJsonBody(request), session), 201);
        }
        const revokeMatch = /^\/api\/admin\/line-setup-links\/([^/]+)\/revoke$/.exec(pathname);
        if (revokeMatch && request.method === "POST") {
          return sendData(response, lineSetupService.revoke(decodeURIComponent(revokeMatch[1])));
        }
      }

      if(pathname==="/api/admin/setup-invitation"&&request.method==="GET")return sendData(response,onboarding.getInvitation(url.searchParams.get("token")));
      if(pathname==="/api/admin/setup"&&request.method==="POST"){const body=await readJsonBody(request);return sendData(response,await onboarding.redeemInvitation(body.token,body.password));}

      if(pathname.startsWith("/api/admin/onboarding/")){
        const token=cookieValue(request,"nephi_admin_session"),session=token&&adminAuthRequired?await persistence.getAdminSession(sessionTokenHash(token)):null;if(!session||!onboarding||!onboarding.isPlatformAdmin(session))throw new AppError(401,"PLATFORM_ADMIN_REQUIRED","需要平台管理者權限");
        if(pathname==="/api/admin/onboarding/invitations"&&request.method==="POST"){const body=await readJsonBody(request),created=onboarding.createInvitation(body,session),{inviteToken,...safeCreated}=created;return sendData(response,{...safeCreated,inviteUrl:`${publicBrand.publicBaseUrl}/onboarding?invite=${encodeURIComponent(inviteToken)}`},201);}
        if(pathname==="/api/admin/onboarding/applications"&&request.method==="GET")return sendData(response,{items:onboarding.list().map(x=>({...x,completeness:require("./lib/onboarding-service").completeness(x)}))});
        if(pathname==="/api/admin/onboarding/properties"&&request.method==="GET")return sendData(response,{items:onboarding.listProperties(session)});
        const review=/^\/api\/admin\/onboarding\/applications\/([^/]+)(?:\/(request-changes|reopen-for-changes|reject|approve|resume-link|revoke-invite))?$/.exec(pathname);
        if(review&&request.method==="GET"&&!review[2])return sendData(response,onboarding.get(review[1]));
        if(review&&request.method==="POST"){
          if(review[2]==="revoke-invite")return sendData(response,onboarding.revokeInvitation(review[1]));
          if(review[2]==="resume-link"){const issued=onboarding.issueResumeLink(review[1]);return sendData(response,{resumeUrl:`${publicBrand.publicBaseUrl}/onboarding?resume=${encodeURIComponent(issued.resumeToken)}`,expiresAt:issued.expiresAt});}
          const body=await readJsonBody(request);
          if(review[2]==="approve"){const approved=onboarding.approve(review[1],body,session);if(approved.approvalMode==="existing")return sendData(response,approved);return sendData(response,{...approved,adminSetupUrl:`${publicBrand.publicBaseUrl}/admin/setup?token=${encodeURIComponent(approved.adminSetupToken)}`});}
          if(review[2]==="reopen-for-changes"){
            const reopened=await onboarding.reopenRejected(review[1],body.reason,session),{resumeToken,...safeReopen}=reopened;
            return sendData(response,{...reopened.application,...safeReopen,resumeUrl:`${publicBrand.publicBaseUrl}/onboarding?resume=${encodeURIComponent(resumeToken)}`});
          }
          const reviewed=await onboarding.review(review[1],review[2]==="reject"?"rejected":"changes_requested",body.reason,session);
          if(review[2]==="request-changes"){
            const{resumeToken,...safeReview}=reviewed;
            return sendData(response,{...reviewed.application,...safeReview,resumeUrl:`${publicBrand.publicBaseUrl}/onboarding?resume=${encodeURIComponent(resumeToken)}`});
          }
          return sendData(response,reviewed);
        }
      }

      const lineBindingMatch = /^\/api\/admin\/line-bindings\/([^/]+)(?:\/(enabled))?$/.exec(pathname);
      if (lineBindingMatch) {
        const token = cookieValue(request, "nephi_admin_session");
        const session = token && adminAuthRequired ? await persistence.getAdminSession(sessionTokenHash(token)) : null;
        if (!session || !onboarding || !onboarding.isPlatformAdmin(session)) throw new AppError(401, "PLATFORM_ADMIN_REQUIRED", "Platform administrator access is required");
        if (!lineBindingService) throw new AppError(503, "LINE_BINDING_NOT_CONFIGURED", "LINE binding storage is not configured");
        const propertyId = decodeURIComponent(lineBindingMatch[1]);
        if (request.method === "GET" && !lineBindingMatch[2]) {
          const status = lineBindingService.status(propertyId);
          if (!status) throw new AppError(404, "LINE_BINDING_NOT_FOUND", "LINE binding was not found");
          return sendData(response, status);
        }
        if (request.method === "PUT" && !lineBindingMatch[2]) {
          if (!customerSettings.getProperty(propertyId)) throw new AppError(404, "PROPERTY_NOT_FOUND", "Property was not found");
          return sendData(response, lineBindingService.upsert(propertyId, await readJsonBody(request)));
        }
        if (request.method === "PATCH" && lineBindingMatch[2] === "enabled") {
          const body = await readJsonBody(request);
          if (typeof body.enabled !== "boolean") throw new AppError(400, "LINE_BINDING_ENABLED_REQUIRED", "enabled must be boolean");
          const status = lineBindingService.setEnabled(propertyId, body.enabled);
          if (!status) throw new AppError(404, "LINE_BINDING_NOT_FOUND", "LINE binding was not found");
          return sendData(response, status);
        }
      }

      if (request.method === "GET" && pathname === "/api/public/property") {
        const property = resolvePublicProperty(customerSettings.listProperties(), url.searchParams.get("slug"));
        if (!property) throw new AppError(404, "PUBLIC_PROPERTY_NOT_FOUND", "此查房連結無效，請重新由民宿官方連結進入。");
        return sendData(response, publicPropertyMetadata(property));
      }
      if (request.method === "GET" && pathname === "/api/public/availability") {
        const slug = normalizePublicSlug(url.searchParams.get("slug"));
        const property = slug ? resolvePublicProperty(customerSettings.listProperties(), slug) : null;
        if (!property) throw new AppError(404, "PUBLIC_PROPERTY_NOT_FOUND", "此查房連結無效，請重新由民宿官方連結進入。");
        const propertyId = property.propertyId;
        const checkIn = String(url.searchParams.get("checkIn") || "").trim();
        const checkOut = String(url.searchParams.get("checkOut") || "").trim() || nextDateKey(checkIn);
        const queryMode = String(url.searchParams.get("queryMode") || "any").trim();
        if (!["any", "room_only", "bundle_only"].includes(queryMode)) {
          throw new AppError(400, "INVALID_QUERY_MODE", "Invalid query mode");
        }
        const bootstrap = service.getBootstrap(propertyId);
        if (bootstrap.publicEnabled === false) throw new AppError(404, "PROPERTY_NOT_AVAILABLE", "Property is not available");
        const result = service.searchAvailability({
          customerId: propertyId,
          checkIn,
          checkOut,
          guests: url.searchParams.get("guests"),
          roomType: String(url.searchParams.get("roomType") || "all").trim() || "all",
          queryMode
        });
        return sendData(response, publicAvailabilityResult(result, property, customerSettings.listRoomPriceOverrides(propertyId)));
      }

      if (request.method === "POST" && pathname === "/api/admin/login") {
        if (!adminAuthRequired) throw new AppError(503, "ADMIN_AUTH_NOT_CONFIGURED", "Admin login requires PostgreSQL");
        const body = await readJsonBody(request);
        const token = crypto.randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
        const cookie = { "set-cookie": `nephi_admin_session=${encodeURIComponent(token)}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict` };
        if (Object.hasOwn(body, "email")) {
          const identity = await persistence.getAdminIdentityByEmail(String(body.email || "").trim());
          if (!identity || !await verifyPassword(body.password, identity.passwordHash) || !identity.properties.length) throw new AppError(401, "INVALID_LOGIN", "Email 或密碼錯誤");
          const selected = identity.properties.length === 1 ? identity.properties[0] : null;
          await persistence.createAdminSession(sessionTokenHash(token), identity.userId, selected && selected.propertyId || null, selected && selected.username || null, expiresAt);
          return sendJson(response, 200, { ok: true, data: { email: identity.email, propertyId: selected && selected.propertyId || "", properties: identity.properties.map(item => ({ propertyId: item.propertyId, propertyName: item.propertyName })), requiresPropertySelection: !selected, platformAdmin: identity.platformAdmin } }, cookie);
        }
        const propertyId = String(body.propertyId || "").trim(), username = String(body.username || "").trim();
        const user = await persistence.getAdminUser(propertyId, username);
        if (!user || String(user.passwordHash).startsWith("disabled$") || !await verifyPassword(body.password, user.passwordHash)) throw new AppError(401, "INVALID_LOGIN", "帳號或密碼錯誤");
        await persistence.createAdminSession(sessionTokenHash(token), propertyId, username, expiresAt);
        return sendJson(response, 200, { ok: true, data: { propertyId, username, requiresPropertySelection: false } }, cookie);
      }
      if (request.method === "POST" && pathname === "/api/admin/select-property") {
        const token = cookieValue(request, "nephi_admin_session"), body = await readJsonBody(request);
        const session = token && adminAuthRequired ? await persistence.selectAdminProperty(sessionTokenHash(token), String(body.propertyId || "").trim()) : null;
        if (!session) throw new AppError(403, "PROPERTY_ACCESS_DENIED", "無權管理此旅宿");
        return sendData(response, adminSessionData(session));
      }
      if (request.method === "POST" && pathname === "/api/admin/logout") {
        const token = cookieValue(request, "nephi_admin_session");
        if (token && adminAuthRequired) await persistence.deleteAdminSession(sessionTokenHash(token));
        return sendJson(response, 200, { ok: true, data: { loggedOut: true } }, { "set-cookie": "nephi_admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict" });
      }
      if (request.method === "GET" && pathname === "/api/admin/session") {
        const token = cookieValue(request, "nephi_admin_session");
        const session = token && adminAuthRequired ? await persistence.getAdminSession(sessionTokenHash(token)) : null;
        if (!session) throw new AppError(401, "LOGIN_REQUIRED", "請先登入");
        const expected = normalizePublicSlug(url.searchParams.get("slug"));
        if (expected) {
          const property = resolvePublicProperty(customerSettings.listProperties(), expected);
          if (!property || session.propertyId !== property.propertyId) throw new AppError(403, "PROPERTY_ACCESS_DENIED", "無權管理此旅宿");
        }
        return sendData(response, adminSessionData(session));
      }

      let adminSession = null;
      if (adminAuthRequired && isAdminDataRoute(pathname)) {
        const token = cookieValue(request, "nephi_admin_session");
        adminSession = token ? await persistence.getAdminSession(sessionTokenHash(token)) : null;
        if (!adminSession) throw new AppError(401, "LOGIN_REQUIRED", "請先登入");
        if (!adminSession.propertyId) throw new AppError(409, "PROPERTY_SELECTION_REQUIRED", "請先選擇要管理的旅宿");
        if (request.method !== "GET") request.adminBody = await readJsonBody(request);
        const requestedPropertyId = String(request.method === "GET" ? url.searchParams.get("propertyId") || url.searchParams.get("customerId") || "" : request.adminBody.propertyId || request.adminBody.customerId || "").trim();
        if (requestedPropertyId && requestedPropertyId !== adminSession.propertyId) throw new AppError(403, "PROPERTY_ACCESS_DENIED", "無權存取其他業者資料");
      }

      if (request.method === "GET" && pathname === "/api/test-only/line-message-traces") {
        if (!testOnlyLineMessageTrace || !testOnlyLineMessageTrace.active) return sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
        const propertyId = String(url.searchParams.get("propertyId") || "").trim();
        return sendData(response, { items: testOnlyLineMessageTrace.list({
          propertyId,
          eventId: url.searchParams.get("eventId"),
          traceId: url.searchParams.get("traceId"),
          messageTextHash: url.searchParams.get("messageTextHash"),
          limit: url.searchParams.get("limit")
        }) });
      }

      if (request.method === "GET" && pathname === "/api/homestays") {
        const homestays = service.listHomestays();
        return sendData(response, { homestays: adminSession ? homestays.filter((item) => item.customerId === adminSession.propertyId) : homestays });
      }
      if (request.method === "GET" && pathname === "/api/bootstrap") {
        return sendData(response, service.getBootstrap(url.searchParams.get("customerId")));
      }
      if (request.method === "GET" && pathname === "/api/property-profile") return sendData(response, service.getPropertyProfile(url.searchParams.get("propertyId") || url.searchParams.get("customerId")));
      if (request.method === "PUT" && pathname === "/api/property-profile") { const body = request.adminBody || await readJsonBody(request); return sendData(response, service.updatePropertyProfile({ ...body, customerId: body.propertyId || body.customerId })); }
      if (request.method === "GET" && pathname === "/api/property-facts") return sendData(response, service.getPropertyFacts(url.searchParams.get("propertyId") || url.searchParams.get("customerId")));
      if (request.method === "PUT" && pathname === "/api/property-facts") { const body = request.adminBody || await readJsonBody(request); return sendData(response, service.updatePropertyFacts({ ...body, customerId: body.propertyId || body.customerId })); }
      if (request.method === "GET" && pathname === "/api/custom-replies") {
        return sendData(response, customReplyService.list(url.searchParams.get("propertyId") || url.searchParams.get("customerId")));
      }
      if (request.method === "POST" && pathname === "/api/custom-replies") {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, { rule: customReplyService.create(body.propertyId || body.customerId, body) }, 201);
      }
      if (request.method === "POST" && pathname === "/api/custom-replies/test") {
        const body = request.adminBody || await readJsonBody(request);
        if (typeof customReplyTestHandler !== "function") throw new AppError(503, "CUSTOM_REPLY_TEST_UNAVAILABLE", "Custom reply testing is unavailable");
        return sendData(response, await customReplyTestHandler(body));
      }
      const customReplyMatch = /^\/api\/custom-replies\/([^/]+)(?:\/(enabled))?$/.exec(pathname);
      if (customReplyMatch && request.method === "PUT" && !customReplyMatch[2]) {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, { rule: customReplyService.update(body.propertyId || body.customerId, decodeURIComponent(customReplyMatch[1]), body) });
      }
      if (customReplyMatch && request.method === "PATCH" && customReplyMatch[2] === "enabled") {
        const body = request.adminBody || await readJsonBody(request);
        if (typeof body.enabled !== "boolean") throw new AppError(400, "CUSTOM_REPLY_ENABLED_REQUIRED", "enabled must be boolean");
        return sendData(response, { rule: customReplyService.setEnabled(body.propertyId || body.customerId, decodeURIComponent(customReplyMatch[1]), body.enabled) });
      }
      if (customReplyMatch && request.method === "DELETE" && !customReplyMatch[2]) {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, { deleted: customReplyService.remove(body.propertyId || body.customerId, decodeURIComponent(customReplyMatch[1])) });
      }
      if (request.method === "PUT" && pathname === "/api/settings") {
        return sendData(response, { settings: service.updateSettings(request.adminBody || await readJsonBody(request)) });
      }
      if (request.method === "GET" && pathname === "/api/availability/search") {
        return sendData(response, service.searchAvailability({
          customerId: url.searchParams.get("customerId"),
          checkIn: url.searchParams.get("checkIn"),
          checkOut: url.searchParams.get("checkOut"),
          guests: url.searchParams.get("guests"),
          roomType: url.searchParams.get("roomType")
        }));
      }
      if (request.method === "GET" && pathname === "/api/availability/month") {
        return sendData(response, service.getMonth(
          url.searchParams.get("propertyId") || url.searchParams.get("customerId"),
          url.searchParams.get("year"),
          url.searchParams.get("month")
        ));
      }
      if (request.method === "POST" && pathname === "/api/availability/day") {
        const body=request.adminBody||await readJsonBody(request);
        return sendData(response, { row: service.setDay({ ...body, customerId:body.propertyId||body.customerId, roomId:body.roomTypeId||body.roomId }) });
      }
      if (request.method === "PUT" && pathname === "/api/availability/day-note") {
        const body=request.adminBody||await readJsonBody(request);
        return sendData(response, { note: service.setDayNote({ ...body, propertyId:body.propertyId||body.customerId, inventoryType:body.inventoryType||"room", inventoryId:body.inventoryId||body.roomTypeId||body.roomId }) });
      }
      if (request.method === "POST" && pathname === "/api/availability/month") {
        return sendData(response, service.setMonth(request.adminBody || await readJsonBody(request)));
      }
      if (request.method === "POST" && pathname === "/api/availability/batch") {
        return sendData(response, service.applyBatch(request.adminBody || await readJsonBody(request)));
      }
      if(request.method==="GET"&&pathname==="/api/room-pricing"){const property=customerSettings.getProperty(url.searchParams.get("customerId")),rooms=typeof customerSettings.listRoomRecords==="function"?customerSettings.listRoomRecords(property.propertyId):property.rooms.filter(x=>x.inventoryType!=="bundle");return sendData(response,{currency:property.currency||"TWD",rooms,overrides:customerSettings.listRoomPriceOverrides(property.propertyId)});}
      if(request.method==="PUT"&&pathname==="/api/room-pricing"){
        const body=request.adminBody||await readJsonBody(request),propertyId=String(body.propertyId||body.customerId||"").trim();
        if(!Array.isArray(body.rooms)||!body.rooms.length)throw new AppError(400,"INVALID_PRICING_MATRIX","請提供至少一個房型價格");
        const property=customerSettings.getProperty(propertyId);if(!property)throw new AppError(400,"UNKNOWN_PROPERTY","找不到旅宿");const editableRooms=typeof customerSettings.listRoomRecords==="function"?customerSettings.listRoomRecords(propertyId):(property.rooms||[]).filter((room)=>room.inventoryType!=="bundle"),validIds=new Set(editableRooms.map((room)=>room.id)),seen=new Set(),items=[];
        for(const row of body.rooms){
          const roomTypeId=String(row&&row.roomTypeId||"").trim();
          if(!roomTypeId||seen.has(roomTypeId)||!validIds.has(roomTypeId))throw new AppError(400,"UNKNOWN_ROOM","房型不存在或重複");
          seen.add(roomTypeId);const item={roomTypeId};
          for(const key of ["mondayThursdayPrice","fridayPrice","saturdayHolidayPrice","sundayPrice"]){item[key]=Number(row[key]);if(!Number.isInteger(item[key])||item[key]<0)throw new AppError(400,"INVALID_PRICE","價格必須是零或正整數");}
          const editsRoomData=["roomCode","displayName","capacity","highlights","enabled"].some((key)=>Object.hasOwn(row,key));
          if(editsRoomData){item.roomCode=String(row.roomCode||"").trim();item.displayName=String(row.displayName||"").trim();item.capacity=Number(row.capacity);item.highlights=normalizeRoomHighlights(row.highlights);item.enabled=Boolean(row.enabled);if(!item.displayName)throw new AppError(400,"MISSING_ROOM_DISPLAY_NAME","房型顯示名稱不得空白");if(characterCount(item.roomCode)>40||characterCount(item.displayName)>80)throw new AppError(400,"ROOM_TEXT_TOO_LONG","房型代號或顯示名稱過長");if(!Number.isInteger(item.capacity)||item.capacity<1)throw new AppError(400,"INVALID_ROOM_CAPACITY","最多入住人數必須是正整數");if(item.highlights.length>3||item.highlights.some((value)=>characterCount(value)>15))throw new AppError(400,"INVALID_ROOM_HIGHLIGHTS","房型亮點最多 3 項，每項最多 15 字");}
          items.push(item);
        }
        const updated=customerSettings.updateRoomPricingBatch(propertyId,items),rooms=typeof customerSettings.listRoomRecords==="function"?customerSettings.listRoomRecords(propertyId):updated.rooms.filter((room)=>room.inventoryType!=="bundle");
        return sendData(response,{currency:updated.currency||"TWD",rooms,overrides:customerSettings.listRoomPriceOverrides(propertyId)});
      }
      const pricingMatch=/^\/api\/room-pricing\/([^/]+)$/.exec(pathname);
      if(pricingMatch&&request.method==="PUT"){const b=request.adminBody||await readJsonBody(request),price={};for(const key of ["mondayThursdayPrice","fridayPrice","saturdayHolidayPrice","sundayPrice"]){price[key]=Number(b[key]);if(!Number.isInteger(price[key])||price[key]<0)throw new AppError(400,"INVALID_PRICE","價格必須是零或正整數");}return sendData(response,{property:customerSettings.updateRoomPricing(b.customerId,decodeURIComponent(pricingMatch[1]),price)});}
      if(request.method==="POST"&&pathname==="/api/room-price-overrides"){const b=request.adminBody||await readJsonBody(request),price=Number(b.price);if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isInteger(price)||price<0)throw new AppError(400,"INVALID_PRICE_OVERRIDE","請輸入有效日期與價格");return sendData(response,{override:customerSettings.setRoomPriceOverride(b.customerId,b.roomId,b.date,price,customerSettings.getProperty(b.customerId).currency||"TWD")});}
      if (request.method === "GET" && pathname === "/api/bundles") return sendData(response, { bundles: customerSettings.listBundles(url.searchParams.get("customerId")) });
      if (request.method === "POST" && pathname === "/api/bundles") { const body=request.adminBody||await readJsonBody(request);return sendData(response,{bundle:customerSettings.createBundle(body.customerId,body)},201); }
      const bundleMatch=/^\/api\/bundles\/([^/]+)$/.exec(pathname);
      if(bundleMatch&&request.method==="PUT"){const body=request.adminBody||await readJsonBody(request);return sendData(response,{bundle:customerSettings.updateBundle(body.customerId,bundleMatch[1],body)});}
      if(bundleMatch&&request.method==="DELETE"){const body=request.adminBody||await readJsonBody(request);return sendData(response,{deleted:customerSettings.deleteBundle(body.customerId,bundleMatch[1])});}

      if (request.method === "GET" && pathname === "/api/guests") {
        return sendData(response, { guests: service.listGuests(url.searchParams.get("customerId"), url.searchParams.get("q")) });
      }
      if (request.method === "POST" && pathname === "/api/guests") {
        return sendData(response, { guest: service.createGuest(request.adminBody || await readJsonBody(request)) }, 201);
      }

      const guestMatch = /^\/api\/guests\/([^/]+)$/.exec(pathname);
      if (guestMatch && request.method === "PUT") {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, { guest: service.updateGuest(body.customerId, guestMatch[1], body) });
      }

      const notesMatch = /^\/api\/guests\/([^/]+)\/notes$/.exec(pathname);
      if (notesMatch && request.method === "GET") {
        return sendData(response, { notes: service.listNotes(url.searchParams.get("customerId"), notesMatch[1]) });
      }
      if (notesMatch && request.method === "POST") {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, { note: service.addNote(body.customerId, notesMatch[1], body.text) }, 201);
      }
      const noteEditMatch = /^\/api\/guests\/([^/]+)\/notes\/([^/]+)$/.exec(pathname);
      if (noteEditMatch && request.method === "PUT") {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, {
          note: service.updateNote(body.customerId, noteEditMatch[1], noteEditMatch[2], body.text)
        });
      }

      const guestMessagesMatch = /^\/api\/guests\/([^/]+)\/messages$/.exec(pathname);
      if (guestMessagesMatch && request.method === "GET") {
        return sendData(response, {
          items: service.listGuestMessages(url.searchParams.get("customerId"), guestMessagesMatch[1])
        });
      }

      if (request.method === "POST" && pathname === "/api/messages") {
        return sendData(response, { item: service.writeMessage(request.adminBody || await readJsonBody(request)) }, 201);
      }

      if (request.method === "GET" && pathname === "/api/dashboard") {
        return sendData(response, { summary: service.getDashboard(url.searchParams.get("customerId")) });
      }
      if (request.method === "GET" && pathname === "/api/reviews") {
        return sendData(response, {
          items: service.listReviews(url.searchParams.get("customerId"), url.searchParams.get("status") || "pending")
        });
      }
      const reviewMatch = /^\/api\/reviews\/([^/]+)\/resolve$/.exec(pathname);
      if (reviewMatch && request.method === "POST") {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, {
          item: service.resolveReview(body.customerId, reviewMatch[1], body.ownerAction, body.reviewNote)
        });
      }

      sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    } catch (error) {
      sendError(response, error);
    }
  };
}

function createApp(options = {}) {
  const config = runtimeConfig();
  const publicBrand = options.publicBrand || createPublicBrand(options.publicBrandEnv || process.env);
  const dataFile = options.dataFile || config.dataFile;
  const seedFile = options.seedFile || config.seedFile;
  const now = options.now || (() => new Date());
  const timeZone = options.timeZone || config.timeZone;
  const providers = options.providers || createProviders({ databaseUrl: config.databaseUrl, dataFile, seedFile, now });
  const adminAuthRequired = Object.hasOwn(options, "adminAuthRequired") ? Boolean(options.adminAuthRequired) : providers.kind === "postgres";
  const service = createMvpService(providers, { now });
  const onboardingEmailNotifier=createOnboardingEmailNotifier({env:options.onboardingEmailEnv||process.env,fetchImpl:options.onboardingEmailFetch||globalThis.fetch,publicBaseUrl:publicBrand.publicBaseUrl});
  const onboarding = createOnboardingService(providers.onboarding,{emailNotifier:onboardingEmailNotifier});
  const lineBindingService = createLineBindingService({ provider: providers.lineBindings, env: options.lineBindingEnv || process.env });
  const lineSetupService = createLineSetupService({
    provider: providers.lineBindings,
    lineBindingService,
    customerSettings: providers.customerSettings,
    publicBaseUrl: publicBrand.publicBaseUrl,
    now
  });
  const unsupportedCustomReplyMutation = () => {
    throw new CustomReplyError(503, "CUSTOM_REPLY_PROVIDER_UNAVAILABLE", "Custom reply storage is unavailable");
  };
  const customReplyService = createCustomReplyService({
    provider: providers.customReplies || {
      list: () => [],
      create: unsupportedCustomReplyMutation,
      update: unsupportedCustomReplyMutation,
      remove: unsupportedCustomReplyMutation
    },
    customerSettings: providers.customerSettings,
    now
  });
  const testOnlyEnvironment = Object.hasOwn(options, "testOnlyEnvironment") ? options.testOnlyEnvironment === true : config.testOnlyEnvironment === true;
  const testOnlyAcceptanceEnabled = Object.hasOwn(options, "testOnlyAcceptanceEnabled") ? options.testOnlyAcceptanceEnabled === true : config.testOnlyAcceptanceEnabled === true;
  const testOnlyAcceptancePropertyId = String(options.testOnlyAcceptancePropertyId || config.testOnlyAcceptancePropertyId || "").trim();
  const deploymentCommit = String(options.deploymentCommit || process.env.RENDER_GIT_COMMIT || "").trim().toLowerCase();
  const testOnlyAcceptanceOidcVerifier = typeof options.testOnlyAcceptanceOidcVerifier === "function"
    ? options.testOnlyAcceptanceOidcVerifier
    : testOnlyEnvironment && testOnlyAcceptanceEnabled && deploymentCommit
      ? createGithubActionsOidcVerifier({ deploymentCommit, fetchImpl: options.testOnlyAcceptanceOidcFetch || globalThis.fetch, now })
      : null;
  const acceptanceDataConnection = options.testOnlyAcceptanceDataConnection
    || (config.databaseUrl ? { kind: "pg", databaseUrl: config.databaseUrl } : null);
  const acceptanceDataManifestPath = String(options.testOnlyAcceptanceManifestPath || path.join(APP_ROOT, "fixtures", "postgres-seed.json"));
  const injectedAcceptanceDataInitializer = typeof options.testOnlyAcceptanceDataInitializer === "function"
    ? options.testOnlyAcceptanceDataInitializer
    : null;
  const testOnlyAcceptanceDataInitializer = testOnlyEnvironment && testOnlyAcceptanceEnabled && testOnlyAcceptancePropertyId && providers.kind === "postgres"
    ? async (body = {}, identity = null) => {
      const propertyId = String(body.propertyId || body.customerId || "").trim();
      const expectedSnapshotHash = String(body.expectedSnapshotHash || "").trim().toLowerCase();
      if (propertyId !== testOnlyAcceptancePropertyId) throw new AppError(403, "TEST_ONLY_ACCEPTANCE_PROPERTY_MISMATCH", "Acceptance property scope was rejected");
      if (!/^[0-9a-f]{64}$/.test(expectedSnapshotHash)) throw new AppError(400, "ACCEPTANCE_DATA_SNAPSHOT_HASH_REQUIRED", "Expected repository snapshot hash is required");
      if (!injectedAcceptanceDataInitializer && !acceptanceDataConnection) throw new AppError(503, "ACCEPTANCE_DATA_POSTGRES_REQUIRED", "Test-only PostgreSQL acceptance data is unavailable");
      let result;
      try {
        result = injectedAcceptanceDataInitializer
          ? await injectedAcceptanceDataInitializer({ propertyId, expectedSnapshotHash, identity })
          : await syncTestOnlyAcceptanceData({
            connection: acceptanceDataConnection,
            manifestPath: acceptanceDataManifestPath,
            acceptancePropertyId: propertyId,
            expectedSnapshotHash,
            testOnly: true
          });
      } catch (error) {
        const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(String(error && error.code || "")) ? error.code : "ACCEPTANCE_DATA_INTEGRITY_FAILURE";
        throw new AppError(409, code, "Test-only acceptance data initialization failed");
      }
      if (!result || result.status !== "verified" || result.propertyId !== propertyId || result.snapshotHash !== expectedSnapshotHash) {
        throw new AppError(409, "ACCEPTANCE_DATA_INTEGRITY_FAILURE", "Test-only PostgreSQL snapshot verification failed");
      }
      return result;
    }
    : null;
  const testOnlyLineMessageTrace = createTestOnlyLineMessageTrace({
    enabled: adminAuthRequired && (Object.hasOwn(options, "testOnlyLineMessageTraceEnabled") ? options.testOnlyLineMessageTraceEnabled === true : config.testOnlyLineMessageTraceEnabled === true),
    testOnly: testOnlyEnvironment,
    targetPropertyId: options.testOnlyLineMessageTracePropertyId || config.testOnlyLineMessageTracePropertyId,
    targetMessageSha256: options.testOnlyLineMessageTraceTargetSha256 || config.testOnlyLineMessageTraceTargetSha256,
    persistence: providers.persistence,
    now,
    onError: (error) => console.error(JSON.stringify({ scope: "test-only-line-message-trace", ...error }))
  });
  const replyClient = options.lineReplyClientFactory || (options.lineReplyFetch && (({ channelAccessToken }) => ({ replyMessageWithHttpInfo: async (body) => { const response = await options.lineReplyFetch("https://api.line.me/v2/bot/message/reply", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${channelAccessToken}` }, body: JSON.stringify(body) }); if (!response.ok) { const error = new Error("line_reply_failed"); error.status = response.status; throw error; } return { httpResponse: { status: response.status } }; } })));
  const testOnlyTransportDiagnostic = typeof options.testOnlyTransportDiagnostic === "function" ? options.testOnlyTransportDiagnostic : null;
  const emitTransportDiagnostic = (entry) => {
    logSafeTestOnlyConversationTrace(entry);
    if (testOnlyTransportDiagnostic) {
      try { testOnlyTransportDiagnostic(entry); } catch { /* test-only diagnostics must not affect transport */ }
    }
  };
  const acceptanceTraces = new Map();
  const captureSafeTrace = (entry) => { testOnlyLineMessageTrace.diagnostic(entry); const safe = formatSafeTestOnlyConversationTrace(entry); logSafeTestOnlyConversationTrace(entry); if (safe && safe.traceId) { const list = acceptanceTraces.get(safe.traceId) || []; list.push(safe); acceptanceTraces.set(safe.traceId, list.slice(-40)); } };
  const root = createV2CompositionRoot({ providers, service, env: options.openAiTestEnv || process.env, now, debounceMs: options.conversationDebounceMs || config.conversationDebounceMs, planner: options.conversationPlannerV2, composer: options.controlledComposerV2, diagnosticDetail: testOnlyLineMessageTrace.active, onDiagnostic: captureSafeTrace, testOnlyOverrides: options.testOnlyOverrides || null });
  const customReplyTestHandler = async (body = {}) => {
    const propertyId = String(body.propertyId || body.customerId || "").trim();
    const ruleId = String(body.ruleId || "").trim();
    const messageText = String(body.messageText || "").trim();
    if (!propertyId || !ruleId || !messageText) throw new AppError(400, "CUSTOM_REPLY_TEST_INPUT_REQUIRED", "propertyId, ruleId and messageText are required");
    const rule = customReplyService.list(propertyId).items.find((item) => item.ruleId === ruleId);
    if (!rule) throw new CustomReplyError(404, "CUSTOM_REPLY_NOT_FOUND", "找不到這則自訂回覆");
    const nonce = crypto.randomUUID();
    const channelId = `custom-reply-test:${nonce}`;
    const lineUserId = `custom-reply-test:${nonce}`;
    const eventId = `custom-reply-test:${nonce}`;
    let result;
    try {
      result = await root.engine.process({
        customerId: propertyId,
        channelId,
        lineUserId,
        eventId,
        eventTimestamp: now().toISOString(),
        messageText
      });
    } finally {
      if (typeof providers.persistence.deleteConversationState === "function") {
        providers.persistence.deleteConversationState(propertyId, channelId, lineUserId);
      }
    }
    const matched = result.taskResults.some((item) => item.facts && item.facts.customReplyRuleId === ruleId);
    return {
      matched,
      rule: matched ? rule : null,
      reply: matched ? rule.approvedReply : "",
      reason: matched ? null : { code: "RULE_NOT_MATCHED", message: "客人詢問經正式語意流程後未命中這則規則" }
    };
  };
  const testOnlyAcceptanceHandler = testOnlyAcceptanceEnabled && testOnlyEnvironment
    ? async (body = {}) => {
      const customerId = String(body.customerId || body.propertyId || "").trim();
      const conversationId = String(body.conversationId || "").trim();
      const messageText = String(body.messageText || "").trim();
      const lineEvent = body.lineEvent && typeof body.lineEvent === "object" ? body.lineEvent : null;
      if (["conversationState", "state", "operatorText", "assistantText"].some((key) => Object.hasOwn(body, key))) throw new AppError(400, "ACCEPTANCE_STATE_INJECTION_FORBIDDEN", "Direct conversation state or operator text injection is forbidden");
      if (!customerId || !conversationId || (!body.clear && !messageText && !lineEvent)) throw new AppError(400, "ACCEPTANCE_INPUT_REQUIRED", "customerId, conversationId and a text or native LINE event are required");
      if (messageText && lineEvent) throw new AppError(400, "ACCEPTANCE_INPUT_AMBIGUOUS", "Use either messageText or lineEvent");
      if (!providers.customerSettings.getProperty(customerId)) throw new AppError(404, "UNKNOWN_CUSTOMER_ID", "Unknown test-only customerId");
      const conversationHash = crypto.createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
      const channelId = `test-acceptance:${customerId}`;
      const lineUserId = `test-only-conversation:${conversationHash}`;
      if (body.clear) return { cleared: Boolean(providers.persistence.deleteConversationState(customerId, channelId, lineUserId)) };
      const eventId = String(body.eventId || `acceptance-${crypto.randomUUID()}`);
      if (lineEvent) {
        if (body.establishOperatorContext === true || Object.hasOwn(lineEvent, "source") || Object.hasOwn(lineEvent, "replyToken") || Object.hasOwn(lineEvent, "webhookEventId") || Object.hasOwn(lineEvent, "destination")) throw new AppError(400, "ACCEPTANCE_NATIVE_EVENT_INVALID", "Native event identity and context are server controlled");
        const nativeType = String(lineEvent.message && lineEvent.message.type || "");
        if (lineEvent.type !== "message" || !TEST_ONLY_NATIVE_LINE_MESSAGE_TYPES.has(nativeType)) throw new AppError(400, "ACCEPTANCE_NATIVE_EVENT_INVALID", "Only native sticker, image, video, or file events are accepted");
        const controlledEvent = { type: "message", replyToken: "test-only-acceptance", source: { type: "user", userId: lineUserId }, webhookEventId: eventId, timestamp: now().getTime(), message: { type: nativeType } };
        const disposition = lineMessageEventDisposition(controlledEvent);
        if (!disposition.accepted || disposition.engineInvoked) throw new AppError(400, "ACCEPTANCE_NATIVE_EVENT_INVALID", "Native event must terminate at the LINE transport gate");
        const claimed = await providers.persistence.claimMessageEvent(customerId, channelId, eventId, { lineUserId, eventTimestamp: now().toISOString(), guestMessage: "", replyType: "no_reply_v2", replyText: "", route: "line_non_text_event", decisionReason: disposition.reasonCode, humanHandoff: false, silentIgnore: true });
        if (!claimed.claimed) return { duplicate: true, eventId };
        const traceId = crypto.randomUUID();
        const transportTrace = formatSafeTestOnlyConversationTrace({ traceId, propertyId: customerId, stage: "line_transport", decision: "no_reply", reasonCode: disposition.reasonCode, attempted: false, delivered: false });
        await providers.persistence.updateMessageEvent(customerId, channelId, eventId, { processingStatus: "no_reply", shouldReply: false, noReply: true });
        return {
          traceId,
          eventId,
          nativeEvent: { type: nativeType, transport: "shared_line_message_gate", engineInvoked: false },
          finalDecision: { action: "no_reply", reasonCode: disposition.reasonCode, taskIds: [], missingFields: [], clarificationCandidates: [], reviewRequired: false, executionSummary: {} },
          claimValidation: { ok: true, notApplicable: true, errors: [], coveredTaskIds: [], missingTaskIds: [], unexpectedTaskIds: [] },
          finalResponse: { action: "no_reply", shouldReply: false, replyText: "" },
          taskResults: [],
          trace: [transportTrace]
        };
      }
      const claimed = await providers.persistence.claimMessageEvent(customerId, channelId, eventId, { lineUserId, eventTimestamp: now().toISOString(), guestMessage: messageText, replyType: "processing", replyText: "", route: "", decisionReason: "", humanHandoff: false, silentIgnore: false });
      if (!claimed.claimed) return { duplicate: true, eventId };
      const result = await root.engine.process({ customerId, channelId, lineUserId, eventId, eventTimestamp: now().toISOString(), messageText });
      const trace = acceptanceTraces.get(result.traceId) || [];
      acceptanceTraces.delete(result.traceId);
      const response = {
        traceId: result.traceId,
        eventId,
        finalDecision: safeAcceptanceFinalDecision(result.finalDecision),
        claimValidation: safeAcceptanceClaimValidation(result.claimValidation),
        finalResponse: {
          action: result.finalResponse.action,
          shouldReply: result.finalResponse.shouldReply,
          replyText: result.finalResponse.replyText
        },
        taskResults: result.taskResults.map(safeAcceptanceTaskResult),
        trace
      };
      if (body.establishOperatorContext === true) response.operatorContext = { established: true, source: "engine_final_response", eventId, finalResponse: { action: result.finalResponse.action, shouldReply: result.finalResponse.shouldReply, replyText: result.finalResponse.replyText } };
      return response;
    }
    : null;
  const claimEvent = (input) => providers.persistence.claimMessageEvent(input.customerId, input.channelId, input.eventId, { lineUserId: String(input.lineUserId || ""), eventTimestamp: input.eventTimestamp || "", guestMessage: String(input.messageText || ""), replyType: "processing", replyText: "", route: "", decisionReason: "", humanHandoff: false, silentIgnore: false });
  const updateEventStatus = (customerId, channelId, eventId, patch) => providers.persistence.updateMessageEvent(customerId, channelId, eventId, patch);
  const sharedLineWebhookHandler = async ({ rawBody, signature, webhookKey }) => {
    if (!lineBindingService) throw new AppError(503, "LINE_BINDING_WEBHOOK_NOT_CONFIGURED", "LINE webhook is not configured");
    const binding = lineBindingService.resolve(webhookKey);
    if (!binding) throw new AppError(404, "LINE_BINDING_NOT_FOUND", "LINE webhook is unavailable");
    if (!validateSignature(rawBody, binding.channelSecret, String(signature || ""))) throw new AppError(401, "INVALID_LINE_SIGNATURE", "Invalid LINE signature");
    let payload; try { payload = JSON.parse(rawBody.toString("utf8")); } catch { throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON"); }
    const observedAt = now().toISOString();
    try {
      lineBindingService.markWebhookObserved(webhookKey, observedAt);
    } catch (error) {
      console.error("LINE webhook observation update failed", {
        code: String(error && error.code || "LINE_WEBHOOK_OBSERVATION_FAILED"),
        webhookKeyHash: crypto.createHash("sha256").update(webhookKey).digest("hex").slice(0, 16)
      });
    }
    const id = binding.propertyId;
    if (!providers.customerSettings.getProperty(id)) throw new AppError(404, "LINE_BINDING_NOT_FOUND", "LINE webhook is unavailable");
    try {
      lineBindingService.recordValidWebhook(id, observedAt);
    } catch (error) {
      console.error("Valid LINE webhook update failed", {
        code: String(error && error.code || "VALID_LINE_WEBHOOK_UPDATE_FAILED"),
        propertyId: id
      });
    }
    const channelId = `line-binding:${crypto.createHash("sha256").update(binding.webhookKey).digest("hex").slice(0, 24)}`;
    for (const event of (payload.events || []).filter((item) => item && item.type === "message" && item.message && item.message.type === "text" && item.replyToken)) {
      const input = { customerId: id, channelId, lineUserId: String(event.source && event.source.userId || ""), eventId: String(event.webhookEventId || event.message.id || ""), eventTimestamp: event.timestamp || "", messageText: event.message.text || "" };
      if (!(await claimEvent(input)).claimed) continue;
      testOnlyLineMessageTrace.begin({ propertyId: id, ...input });
      void root.coordinator.enqueue(input).then(async (result) => {
        const finalResponseShouldReply = result.finalResponse && result.finalResponse.shouldReply;
        const finalResponseReplyText = String(result.finalResponse && result.finalResponse.replyText || "");
        const decision = String(result.finalDecision && result.finalDecision.action || result.finalResponse && result.finalResponse.action || "no_reply");
        testOnlyLineMessageTrace.finalResponse({ traceId: result.traceId, eventId: input.eventId, propertyId: id, finalDecision: result.finalDecision, finalResponse: result.finalResponse });
        const traceTransport = (details) => { const { replyText: _replyText, ...diagnostic } = details; emitTransportDiagnostic(diagnostic); testOnlyLineMessageTrace.transport({ traceId: result.traceId, eventId: input.eventId, propertyId: id, ...details }); };
        await updateEventStatus(id, input.channelId, input.eventId, { replyType: `${decision}_v2`, route: `final_decision_${decision}`, decisionReason: String(result.finalDecision && result.finalDecision.reasonCode || ""), humanHandoff: decision === "handoff", needsReview: Boolean(result.finalDecision && result.finalDecision.reviewRequired) });
        if (finalResponseShouldReply === false) { traceTransport({ traceId: result.traceId, propertyId: id, stage: "line_transport", decision, reasonCode: result.finalDecision && result.finalDecision.reasonCode || "final_response_should_reply_false", attempted: false, delivered: false, replyText: "" }); return updateEventStatus(id, input.channelId, input.eventId, { processingStatus: "no_reply", shouldReply: false, noReply: true }); }
        if (!finalResponseReplyText.trim()) { traceTransport({ traceId: result.traceId, propertyId: id, stage: "line_transport", decision, reasonCode: "final_response_empty_reply", attempted: false, delivered: false, replyText: "" }); return updateEventStatus(id, input.channelId, input.eventId, { processingStatus: "final_response_contract_failed", shouldReply: true, needsReview: true, replyDelivered: false, noReply: false, deliveryErrorCode: "final_response_empty_reply" }); }
        try {
          traceTransport({ traceId: result.traceId, propertyId: id, stage: "line_transport", decision, reasonCode: "reply_attempt", attempted: true, delivered: false, replyText: finalResponseReplyText });
          await (replyClient ? replyClient({ channelAccessToken: binding.channelAccessToken }) : new messagingApi.MessagingApiClient({ channelAccessToken: binding.channelAccessToken })).replyMessageWithHttpInfo({ replyToken: event.replyToken, messages: [{ type: "text", text: finalResponseReplyText }] });
          traceTransport({ traceId: result.traceId, propertyId: id, stage: "line_transport", decision, reasonCode: "reply_succeeded", attempted: true, delivered: true, replyText: finalResponseReplyText });
          await updateEventStatus(id, input.channelId, input.eventId, { processingStatus: "reply_succeeded", replyDelivered: true, deliveryErrorCode: "" });
        } catch (error) {
          const status = Number(error && (error.status || error.statusCode));
          traceTransport({ traceId: result.traceId, propertyId: id, stage: "line_transport", decision, reasonCode: "reply_failed", attempted: true, delivered: false, replyText: finalResponseReplyText, deliveryErrorCode: Number.isFinite(status) && status > 0 ? `line_reply_http_error_${status}` : "line_reply_exception" });
          await updateEventStatus(id, input.channelId, input.eventId, { processingStatus: "reply_failed", replyDelivered: false, deliveryErrorCode: Number.isFinite(status) && status > 0 ? `line_reply_http_error_${status}` : "line_reply_exception" });
        }
      }).catch(async () => updateEventStatus(id, input.channelId, input.eventId, { processingStatus: "processing_failed", replyDelivered: false, needsReview: true, deliveryErrorCode: "message_processing_exception" }));
    }
    return { accepted: true };
  };
  const server = http.createServer(createRequestHandler(service, { sharedLineWebhookHandler, lineBindingService, lineSetupService, customReplyService, customReplyTestHandler, testOnlyAcceptanceHandler, testOnlyAcceptanceDataInitializer, testOnlyAcceptanceOidcVerifier, testOnlyLineMessageTrace, persistence: providers.persistence, customerSettings: providers.customerSettings, onboarding, adminAuthRequired, publicBrand, deploymentCommit }));
  return { providers, service, conversationEngineV2: root.engine, lineWebhookCoordinator: root.coordinator, start(port = config.port, host = config.host) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { resolve({ url: `http://${host}:${server.address().port}`, port: server.address().port, host }); }); }); }, async stop() { await new Promise((resolve, reject) => { if (!server.listening) return resolve(); server.close((error) => error ? reject(error) : resolve()); }); if (typeof providers.close === "function") await providers.close(); } };
}

if (require.main === module) {
  const app = createApp();
  app.start().then(({ url }) => {
    console.log(`Nephi Home Node Pilot v1: ${url}`);
  }).catch((error) => {
    console.error(error.stack || error);
    process.exit(1);
  });
}

module.exports = { createApp, formatSafeTestOnlyConversationTrace, lineMessageEventDisposition };
