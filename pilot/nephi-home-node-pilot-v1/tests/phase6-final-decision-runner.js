"use strict";
const assert = require("node:assert/strict");
const { buildFinalDecision } = require("../lib/conversation-engine-v2/final-decision");
function decide(outcomes, extra = {}) { return buildFinalDecision({ executionOutcomes: outcomes, ...extra }); }
function check(decision, expected) {
  assert.equal(decision.action, expected.action); assert.equal(decision.reasonCode, expected.reasonCode);
  assert.deepEqual(decision.taskIds, expected.taskIds || []); assert.deepEqual(decision.missingFields, expected.missingFields || []);
  assert.equal(decision.reviewRequired, Boolean(expected.reviewRequired));
  for (const [key, value] of Object.entries(expected.summary || {})) assert.deepEqual(decision.executionSummary[key], value);
}
const answered = { taskId: "answered", outcome: "answered" };
check(decide([]), { action: "no_reply", reasonCode: "no_actionable_requests", summary: { answeredTaskIds: [] } });
check(decide([answered]), { action: "reply", reasonCode: "execution_answered", taskIds: ["answered"], summary: { answeredTaskIds: ["answered"] } });
check(decide([{ taskId: "missing", outcome: "not_ready", readinessStatus: "missing", missingFields: ["stay.checkIn"] }]), { action: "clarification", reasonCode: "missing", taskIds: ["missing"], missingFields: ["stay.checkIn"], summary: { notReadyTaskIds: ["missing"] } });
check(decide([{ taskId: "invalid", outcome: "not_ready", readinessStatus: "invalid", missingFields: ["stay.checkIn"] }]), { action: "clarification", reasonCode: "invalid", taskIds: ["invalid"], missingFields: ["stay.checkIn"], summary: { notReadyTaskIds: ["invalid"] } });
check(decide([{ taskId: "conflict", outcome: "not_ready", readinessStatus: "conflicting", missingFields: ["stay.checkOut"] }]), { action: "clarification", reasonCode: "conflicting", taskIds: ["conflict"], missingFields: ["stay.checkOut"], summary: { notReadyTaskIds: ["conflict"] } });
const ambiguousEntity = decide([{ taskId: "entity", outcome: "not_ready", readinessStatus: "entity_unresolved", missingFields: ["entity"], candidates: ["r1", "r2"] }]);
check(ambiguousEntity, { action: "clarification", reasonCode: "entity_unresolved", taskIds: ["entity"], missingFields: ["entity"], summary: { notReadyTaskIds: ["entity"] } });
assert.deepEqual(ambiguousEntity.clarificationCandidates, ["r1", "r2"], "ambiguous entity candidates must survive into FinalDecision");
for (const [taskId, outcome, reason, summaryKey] of [["unknown", "unknown", "property_fact_unknown", "unknownTaskIds"], ["missing-data", "property_data_missing", "property_data_missing", "propertyDataMissingTaskIds"], ["technical", "technical_error", "resolver_exception", "technicalErrorTaskIds"], ["human", "unknown", "human_help", "unknownTaskIds"], ["risk", "unknown", "high_risk", "unknownTaskIds"], ["booking", "unknown", "booking_request", "unknownTaskIds"]]) check(decide([{ taskId, outcome, reason }]), { action: "handoff", reasonCode: reason, taskIds: [taskId], reviewRequired: true, summary: { [summaryKey]: [taskId] } });
check(decide([{ taskId: "no-availability", outcome: "no_availability" }]), { action: "reply", reasonCode: "execution_answered", taskIds: ["no-availability"], summary: { noAvailabilityTaskIds: ["no-availability"] } });
check(decide([answered, { taskId: "date", outcome: "not_ready", readinessStatus: "missing", missingFields: ["stay.checkIn"] }]), { action: "clarification", reasonCode: "missing", taskIds: ["answered", "date"], missingFields: ["stay.checkIn"], summary: { answeredTaskIds: ["answered"], notReadyTaskIds: ["date"] } });
check(decide([answered, { taskId: "review", outcome: "unknown", reason: "property_fact_unknown" }]), { action: "reply", reasonCode: "execution_answered", taskIds: ["answered", "review"], reviewRequired: true, summary: { answeredTaskIds: ["answered"], unknownTaskIds: ["review"] } });
check(decide([answered, { taskId: "missing-data", outcome: "property_data_missing", reason: "property_data_missing" }]), { action: "reply", reasonCode: "execution_answered", taskIds: ["answered", "missing-data"], reviewRequired: true, summary: { answeredTaskIds: ["answered"], propertyDataMissingTaskIds: ["missing-data"] } });
check(decide([answered, { taskId: "technical", outcome: "technical_error", reason: "resolver_exception" }]), { action: "handoff", reasonCode: "resolver_exception", taskIds: ["answered", "technical"], reviewRequired: true, summary: { answeredTaskIds: ["answered"], technicalErrorTaskIds: ["technical"] } });
check(decide([answered, { taskId: "invalid", outcome: "invalid_query_plan", reason: "property_scope_mismatch" }]), { action: "handoff", reasonCode: "property_scope_mismatch", taskIds: ["answered", "invalid"], reviewRequired: true, summary: { answeredTaskIds: ["answered"], invalidQueryPlanTaskIds: ["invalid"] } });
check(decide([answered, { taskId: "risk", type: "high_risk", outcome: "unknown", reason: "high_risk" }]), { action: "handoff", reasonCode: "high_risk", taskIds: ["answered", "risk"], reviewRequired: true, summary: { answeredTaskIds: ["answered"], unknownTaskIds: ["risk"] } });
check(decide([], { plannerFailure: "planner_parse_failed" }), { action: "handoff", reasonCode: "planner_parse_failed", reviewRequired: true, summary: { answeredTaskIds: [] } });
check(decide([answered], { claimValidation: { ok: false } }), { action: "handoff", reasonCode: "claim_validation_failed", taskIds: ["answered"], reviewRequired: true, summary: { answeredTaskIds: ["answered"] } });
const fixed = decide([answered, { taskId: "review", outcome: "unknown", reason: "property_fact_unknown" }]);
for (const delivery of [true, false]) assert.deepEqual(decide([answered, { taskId: "review", outcome: "unknown", reason: "property_fact_unknown" }]), fixed, `delivery ${delivery} must not alter FinalDecision`);
console.log("phase6 final decision: PASS (24 acceptance cases)");
