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

console.log("conversation engine v2 task coverage: PASS");
