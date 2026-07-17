"use strict";

const { coverageByStatus, assertTaskCoverage } = require("./task-coverage");

function buildResponsePlan({ propertyId, taskResults, inputTaskIds, reviewActions = [] }) {
  const sections = (taskResults || []).map((result) => ({ taskId: result.taskId, type: result.type, status: result.status, facts: result.facts || {}, question: result.question || "", needsReview: Boolean(result.review) }));
  const expected = inputTaskIds || sections.map((section) => section.taskId);
  const coverage = coverageByStatus(sections);
  const coverageValidation = assertTaskCoverage(expected, coverage);
  for (const taskId of coverageValidation.missingTaskIds) sections.push({ taskId, type: "unknown", status: "failed", facts: { subject: "這個問題" }, question: "", needsReview: true });
  const finalCoverage = coverageByStatus(sections);
  return { schemaVersion: 1, propertyId, sections, coverage: finalCoverage, coverageValidation: assertTaskCoverage(expected, finalCoverage), reviewActions, allowedFacts: sections.flatMap((section) => Object.values(section.facts || {}).filter((value) => typeof value === "string")), forbiddenClaims: ["已替你保留", "已完成訂房", "一定有房", "免費加人", "可以折扣", "一定退款", "業者已同意", "真人已看過", "已通知業者"], maxLength: 1200 };
}

module.exports = { buildResponsePlan };
