"use strict";

const { assertTaskCoverage } = require("./task-coverage");

const INTERNAL = /(?:review queue|resolver|conversation state|內部備註|Bearer\s+|sk-[A-Za-z0-9_-]+)/i;
const UNAUTHORIZED_PROMISE = /(?:已(?:經)?(?:替|幫)你保留|已完成訂房|一定(?:有房|可以提早入住|可以延後退房|退款)|免費加人|可以折扣|業者已同意|真人已看過|已通知業者)/u;
function validateClaims(reply, plan, claimedTaskIds) {
  const text = String(reply || "");
  const errors = [];
  if (!text.trim()) errors.push("empty_reply");
  if (text.length > (plan.maxLength || 1200)) errors.push("length");
  if (INTERNAL.test(text)) errors.push("internal_content");
  if (UNAUTHORIZED_PROMISE.test(text)) errors.push("forbidden_claim");
  for (const claim of plan.forbiddenClaims || []) if (text.includes(claim)) errors.push("forbidden_claim");
  const expected = (plan.sections || []).map((section) => section.taskId);
  const claimed = claimedTaskIds === null || claimedTaskIds === undefined ? expected : claimedTaskIds;
  const claimCoverage = assertTaskCoverage(expected, { answeredTaskIds: Array.isArray(claimed) ? claimed : [], clarificationTaskIds: [], humanTaskIds: [], failedTaskIds: [] });
  if (!Array.isArray(claimed) || claimCoverage.unexpectedTaskIds.length) errors.push("unknown_fact_reference");
  if (claimCoverage.missingTaskIds.length) errors.push("incomplete_task_coverage");
  return { ok: errors.length === 0, errors: [...new Set(errors)], coveredTaskIds: claimCoverage.coveredTaskIds, missingTaskIds: claimCoverage.missingTaskIds, unexpectedTaskIds: claimCoverage.unexpectedTaskIds };
}

module.exports = { validateClaims };
