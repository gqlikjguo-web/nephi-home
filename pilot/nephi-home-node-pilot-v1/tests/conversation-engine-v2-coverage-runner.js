"use strict";
const assert = require("node:assert/strict");
const { assertTaskCoverage, coverageByStatus } = require("../lib/conversation-engine-v2/task-coverage");
const { validateClaims } = require("../lib/conversation-engine-v2/claim-validator");

const inputIds = ["T1", "T2", "T3", "T4"];
const results = [
  { taskId: "T1", status: "answered" },
  { taskId: "T2", status: "property_data_missing" },
  { taskId: "T3", status: "needs_human" },
  { taskId: "T4", status: "failed" }
];
const coverage = coverageByStatus(results);
assert.deepEqual(coverage.answeredTaskIds, ["T1"]);
assert.deepEqual(coverage.humanTaskIds, ["T2", "T3"]);
assert.deepEqual(coverage.failedTaskIds, ["T4"]);
assert.equal(assertTaskCoverage(inputIds, coverage).ok, true);
assert.deepEqual(assertTaskCoverage(inputIds, { ...coverage, failedTaskIds: [] }).missingTaskIds, ["T4"]);

const responsePlan = {
  maxLength: 1200,
  forbiddenClaims: [],
  sections: inputIds.map((taskId) => ({ taskId }))
};
const incomplete = validateClaims("只回答第一題", responsePlan, ["T1"]);
assert.equal(incomplete.ok, false);
assert.deepEqual(incomplete.missingTaskIds, ["T2", "T3", "T4"]);

const unresolvedAvailabilityPlan = {
  maxLength: 1200, forbiddenClaims: [],
  sections: [{ taskId: "A1", type: "availability", status: "needs_clarification", responseMode: "clarification", facts: {}, question: "請指定房型" }]
};
const unresolvedAvailability = validateClaims("請指定房型", unresolvedAvailabilityPlan, ["A1"]);
assert.equal(unresolvedAvailability.ok, false);
assert.ok(unresolvedAvailability.errors.includes("incomplete_task_execution"));

const genuinelyMissingDatePlan = {
  maxLength: 1200, forbiddenClaims: [],
  sections: [{ taskId: "A2", type: "availability", status: "needs_clarification", responseMode: "clarification", facts: {}, question: "想查哪一天？", missingInputs: ["stay.checkIn"] }]
};
assert.equal(validateClaims("想查哪一天？", genuinelyMissingDatePlan, ["A2"]).ok, true);

const punctuationOnly = validateClaims(".\"", {
  maxLength: 1200,
  forbiddenClaims: [],
  allowedFacts: [],
  sections: [{ taskId: "H1", type: "unknown", status: "needs_human", responseMode: "handoff", facts: {}, allowedFacts: [] }]
}, ["H1"], [{ taskId: "H1", responseMode: "handoff", text: ".\"" }]);
assert.equal(punctuationOnly.ok, false);
assert.ok(punctuationOnly.errors.includes("meaningless_reply"));
assert.ok(punctuationOnly.errors.includes("handoff_deterministic_boundary"));

const groundedPlan = {
  maxLength: 1200,
  forbiddenClaims: [],
  allowedFacts: ["民宿旁空地可停車。"],
  sections: [{ taskId: "F1", type: "amenity", status: "answered", responseMode: "answer", facts: { answer: "民宿旁空地可停車。" }, allowedFacts: ["民宿旁空地可停車。"] }]
};
assert.equal(validateClaims("民宿旁空地可停車。", groundedPlan, ["F1"], [{ taskId: "F1", responseMode: "answer", text: "民宿旁空地可停車。" }]).ok, true);
const ungrounded = validateClaims("民宿旁空地可停車，並由外部工程師管理。", groundedPlan, ["F1"], [{ taskId: "F1", responseMode: "answer", text: "民宿旁空地可停車，並由外部工程師管理。" }]);
assert.equal(ungrounded.ok, false);
assert.ok(ungrounded.errors.includes("ungrounded_section_text"));

console.log("conversation engine v2 task coverage: PASS");
