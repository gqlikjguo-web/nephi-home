"use strict";

const HANDOFF_OUTCOMES = new Set(["unknown", "property_data_missing", "technical_error", "invalid_query_plan"]);
const REPLY_OUTCOMES = new Set(["answered", "no_availability"]);

function unique(values) { return [...new Set(values.filter(Boolean))]; }

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

function buildFinalDecision({ executionOutcomes = [], plannerFailure = "", claimValidation = null, noReplyReason = "" } = {}) {
  const outcomes = Array.isArray(executionOutcomes) ? executionOutcomes : [];
  const summary = executionSummary(outcomes);
  const taskIds = unique(outcomes.map((item) => item && item.taskId));
  const missingFields = unique(outcomes.flatMap((item) => item && item.outcome === "not_ready" ? item.missingFields || [] : []));
  if (plannerFailure) return { action: "handoff", reasonCode: String(plannerFailure), taskIds, missingFields, reviewRequired: true, executionSummary: summary };
  if (claimValidation && claimValidation.ok === false) return { action: "handoff", reasonCode: "claim_validation_failed", taskIds, missingFields, reviewRequired: true, executionSummary: summary };
  if (!outcomes.length) return { action: "no_reply", reasonCode: noReplyReason || "no_actionable_requests", taskIds, missingFields, reviewRequired: false, executionSummary: summary };
  const handoff = outcomes.find((item) => item && HANDOFF_OUTCOMES.has(item.outcome));
  if (handoff) return { action: "handoff", reasonCode: handoff.reason || handoff.outcome, taskIds, missingFields, reviewRequired: true, executionSummary: summary };
  const clarification = outcomes.find((item) => item && item.outcome === "not_ready");
  if (clarification) return { action: "clarification", reasonCode: clarification.readinessStatus || "not_ready", taskIds, missingFields, reviewRequired: false, executionSummary: summary };
  if (outcomes.some((item) => item && REPLY_OUTCOMES.has(item.outcome))) return { action: "reply", reasonCode: "execution_answered", taskIds, missingFields, reviewRequired: false, executionSummary: summary };
  return { action: "handoff", reasonCode: "unsupported_execution_outcome", taskIds, missingFields, reviewRequired: true, executionSummary: summary };
}

module.exports = { buildFinalDecision, executionSummary };
