"use strict";

function buildResponsePlan({ propertyId, taskResults, reviewActions = [] }) {
  const sections = (taskResults || []).map((result) => ({ taskId: result.taskId, type: result.type, status: result.status, facts: result.facts || {}, question: result.question || "", needsReview: Boolean(result.review) }));
  return { schemaVersion: 1, propertyId, sections, reviewActions, allowedFacts: sections.flatMap((section) => Object.values(section.facts || {}).filter((value) => typeof value === "string")), forbiddenClaims: ["已替你保留", "已完成訂房", "一定有房", "免費加人", "可以折扣", "一定退款", "業者已同意", "真人已看過", "已通知業者"], maxLength: 1200 };
}

module.exports = { buildResponsePlan };
