"use strict";

const HANDOFF_OUTCOMES = new Set(["unknown", "property_data_missing", "technical_error", "invalid_query_plan"]);
const PARTIAL_REPLY_OUTCOMES = new Set(["unknown", "property_data_missing"]);
const REPLY_OUTCOMES = new Set(["answered", "no_availability"]);
const MANDATORY_HANDOFF_TYPES = new Set(["booking_request", "human_help", "high_risk"]);
const PUBLIC_REPLY_SCOPES = new WeakMap();

function publicReplyAction(decision, { propertyId, turnId, taskId }) {
  if (!decision?.publicReplies) return null;
  const scope = PUBLIC_REPLY_SCOPES.get(decision);
  if (!scope || scope.propertyId !== propertyId || scope.turnId !== turnId) return undefined;
  return decision.publicReplies.find(item => item.taskId === taskId)?.action;
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }

function executionReplyDisposition(outcome, evidence) {
  if (!evidence || evidence.replyPermission === "SUPPRESSED" || evidence.replyPermission === "UNDETERMINED"
    || evidence.requestPresence === "ABSENT" || evidence.activeRequest !== true) return "no_reply";
  if (REPLY_OUTCOMES.has(outcome.outcome)) return "reply";
  if (outcome.outcome === "not_ready") return "clarification";
  if (evidence.humanActionRequired === true || evidence.humanJudgmentRequired === true
    || evidence.resolverUnresolvedRequiresHuman === true || evidence.existingOperatorResponsibility === true) return "handoff";
  return outcome.outcome === "unknown" ? "reply_unknown" : "processing_status";
}

function executionSummary(outcomes = []) {
  const result = {
    answeredTaskIds: [], noAvailabilityTaskIds: [], notReadyTaskIds: [], unknownTaskIds: [],
    propertyDataMissingTaskIds: [], technicalErrorTaskIds: [], invalidQueryPlanTaskIds: []
  };
  for (const outcome of outcomes) {
    if (!outcome || !outcome.taskId) continue;
    if (outcome.outcome === "answered") result.answeredTaskIds.push(outcome.taskId);
    else if (outcome.outcome === "no_availability") result.noAvailabilityTaskIds.push(outcome.taskId);
    else if (outcome.outcome === "not_ready") result.notReadyTaskIds.push(outcome.taskId);
    else if (outcome.outcome === "unknown") result.unknownTaskIds.push(outcome.taskId);
    else if (outcome.outcome === "property_data_missing") result.propertyDataMissingTaskIds.push(outcome.taskId);
    else if (outcome.outcome === "technical_error") result.technicalErrorTaskIds.push(outcome.taskId);
    else if (outcome.outcome === "invalid_query_plan") result.invalidQueryPlanTaskIds.push(outcome.taskId);
  }
  for (const key of Object.keys(result)) result[key] = unique(result[key]);
  return result;
}

function buildFinalDecision({ executionOutcomes = [], plannerFailure = "", claimValidation = null, noReplyReason = "", requestEvidence = null, terminalResults = [], safetyBlocked = false,
  responseValidation = null, responseSections = [], propertyId = null, turnId = null } = {}) {
  const scoped = Array.isArray(requestEvidence);
  const finish = result => {
    // Public visibility must never bypass internal validation or its rebuild.
    // The same authority retains the operational reason and execution summary.
    const validator = require("./claim-validator");
    if (safetyBlocked || !scoped || !propertyId || !turnId || !responseValidation?.ok
      || !validator.isClaimValidationResult(responseValidation)
      || responseValidation.propertyId !== propertyId || responseValidation.turnId !== turnId) return result;
    const publicReplies = responseSections.flatMap(section => (section.coveredTaskIds || [section.taskId]).map(taskId => {
      const evidence = requestEvidence.find(item => item.taskId === taskId);
      const permitted = evidence?.replyPermission === "ALLOWED" && evidence.activeRequest === true && evidence.requestPresence !== "ABSENT";
      const human = permitted && (evidence.humanActionRequired === true || evidence.humanJudgmentRequired === true
        || evidence.resolverUnresolvedRequiresHuman === true || evidence.existingOperatorResponsibility === true);
      const claimType = validator.claimTypeForSection(section);
      let action = "no_reply";
      if (permitted) {
        if (claimType === "FACTUAL_ANSWER" && (!section.facts?.detailNeedsConfirmation || section.facts.answer)) action = "reply";
        else if (claimType === "EPISTEMIC_UNKNOWN"
          && ["availability", "bundle_availability", "available_dates"].includes(section.type)
          && section.unknownProvenance?.sourceReasonCode === "missing_inventory_records") action = "reply";
        else if (claimType === "CLARIFY") action = "clarification";
        else if (human) action = "handoff";
      }
      return Object.freeze({ taskId, action });
    }));
    // Silent meanings have formal responsibility but no presentation section.
    // Issue their scoped decision from request evidence, never from text or
    // missing presentation. A permitted missing outcome remains invalid.
    for (const evidence of requestEvidence) {
      if ((evidence.requestPresence === "ABSENT" || ["SUPPRESSED", "UNDETERMINED"].includes(evidence.replyPermission))
        && !publicReplies.some(item => item.taskId === evidence.taskId)) {
        publicReplies.push(Object.freeze({ taskId: evidence.taskId, action: "no_reply" }));
      }
    }
    const has = action => publicReplies.some(item => item.action === action);
    const action = has("clarification") ? "clarification" : has("reply") ? "reply" : has("handoff") ? "handoff" : "no_reply";
    const decision = Object.freeze({ ...result, action, internalAction: result.action,
      reviewRequired: has("handoff"), publicReplies: Object.freeze(publicReplies) });
    PUBLIC_REPLY_SCOPES.set(decision, Object.freeze({ propertyId, turnId }));
    return decision;
  };
  const disposition = outcome => executionReplyDisposition(outcome, requestEvidence?.find(item => item.taskId === outcome.taskId));
  const outcomes = (Array.isArray(executionOutcomes) ? executionOutcomes : []).filter(item => !scoped || disposition(item) !== "no_reply");
  const summary = executionSummary(outcomes);
  const taskIds = unique(outcomes.map((item) => item && item.taskId));
  const missingFields = unique(outcomes.flatMap((item) => item && item.outcome === "not_ready" ? item.missingFields || [] : []));
  const clarificationCandidates = unique(outcomes.flatMap((item) => item && item.outcome === "not_ready" ? item.candidates || [] : []));
  const processing = terminalResults.filter(item => item.claimType === "PROCESSING_STATUS");
  if (safetyBlocked) return { action: "no_reply", reasonCode: "terminal_safety_blocked", taskIds, missingFields,
    reviewRequired: outcomes.some(item => disposition(item) === "handoff"), executionSummary: summary };
  if (plannerFailure && !scoped) return { action: "handoff", reasonCode: String(plannerFailure), taskIds, missingFields, reviewRequired: true, executionSummary: summary };
  if (claimValidation && claimValidation.ok === false) {
    const humanResponsibility = !scoped || outcomes.some(item => disposition(item) === "handoff");
    return { action: humanResponsibility ? "handoff" : "no_reply", reasonCode: "claim_validation_failed",
      taskIds, missingFields, reviewRequired: humanResponsibility, executionSummary: summary };
  }
  if (!outcomes.length && !processing.length) return finish({ action: "no_reply", reasonCode: noReplyReason || "no_actionable_requests", taskIds, missingFields, reviewRequired: false, executionSummary: summary });
  const answered = processing.length > 0 || outcomes.some((item) => item && (REPLY_OUTCOMES.has(item.outcome) || scoped && disposition(item) === "reply_unknown"));
  const detailNeedsConfirmation = outcomes.some((item) => item && item.outcome === "answered"
    && item.facts && item.facts.detailNeedsConfirmation === true);
  const mandatoryHandoff = outcomes.find((item) => item && (!scoped || disposition(item) === "handoff") && HANDOFF_OUTCOMES.has(item.outcome)
    && (MANDATORY_HANDOFF_TYPES.has(item.type) || MANDATORY_HANDOFF_TYPES.has(item.reason)));
  if (mandatoryHandoff) return finish({ action: "handoff", reasonCode: mandatoryHandoff.reason || mandatoryHandoff.outcome, taskIds, missingFields, reviewRequired: true, executionSummary: summary });
  const partialReply = outcomes.some((item) => item && (!scoped || disposition(item) === "handoff") && PARTIAL_REPLY_OUTCOMES.has(item.outcome));
  if (answered && partialReply) return finish({ action: "reply", reasonCode: "execution_answered", taskIds, missingFields, reviewRequired: true, executionSummary: summary });
  const handoff = outcomes.find((item) => item && (!scoped || disposition(item) === "handoff") && HANDOFF_OUTCOMES.has(item.outcome));
  if (handoff) return finish({ action: "handoff", reasonCode: handoff.reason || handoff.outcome, taskIds, missingFields, reviewRequired: true, executionSummary: summary });
  const clarification = outcomes.find((item) => item && item.outcome === "not_ready");
  if (clarification) return finish({ action: "clarification", reasonCode: clarification.readinessStatus || "not_ready", taskIds, missingFields, clarificationCandidates, reviewRequired: false, executionSummary: summary });
  if (answered) return finish({ action: "reply", reasonCode: processing.length && !outcomes.some(item => REPLY_OUTCOMES.has(item.outcome)) ? "terminal_processing_status" : "execution_answered", taskIds, missingFields, reviewRequired: detailNeedsConfirmation, executionSummary: summary });
  return finish({ action: "handoff", reasonCode: "unsupported_execution_outcome", taskIds, missingFields, reviewRequired: true, executionSummary: summary });
}

module.exports = { buildFinalDecision, executionSummary, executionReplyDisposition, publicReplyAction };
