"use strict";

const { assertTaskCoverage } = require("./task-coverage");
const { meaningfulCharacterCount, validateComposedSection } = require("./controlled-composer");

const INTERNAL = /(?:review queue|resolver|conversation state|內部備註|Bearer\s+|sk-[A-Za-z0-9_-]+)/i;
const UNAUTHORIZED_PROMISE = /(?:已(?:經)?(?:替|幫)你保留|已完成訂房|一定(?:有房|可以提早入住|可以延後退房|退款)|免費加人|可以折扣|業者已同意|真人已看過|已通知業者)/u;
function validateClaims(reply, plan, claimedTaskIds, composedSections = null) {
  const text = String(reply || "");
  const errors = [];
  if (!text.trim()) errors.push("empty_reply");
  if (meaningfulCharacterCount(text) < 3) errors.push("meaningless_reply");
  if (text.length > (plan.maxLength || 1200)) errors.push("length");
  if (INTERNAL.test(text)) errors.push("internal_content");
  if (UNAUTHORIZED_PROMISE.test(text)) errors.push("forbidden_claim");
  for (const claim of plan.forbiddenClaims || []) if (text.includes(claim)) errors.push("forbidden_claim");
  const expected = (plan.sections || []).map((section) => section.taskId);
  const claimed = claimedTaskIds === null || claimedTaskIds === undefined ? expected : claimedTaskIds;
  const claimCoverage = assertTaskCoverage(expected, { answeredTaskIds: Array.isArray(claimed) ? claimed : [], clarificationTaskIds: [], humanTaskIds: [], failedTaskIds: [] });
  if (!Array.isArray(claimed) || claimCoverage.unexpectedTaskIds.length) errors.push("unknown_fact_reference");
  if (claimCoverage.missingTaskIds.length) errors.push("incomplete_task_coverage");
  const missingFactSource = (plan.sections || []).some((section) => (
    section.status === "answered"
    && !String(section.facts && section.facts.source || "").trim()
  ));
  if (missingFactSource) errors.push("missing_fact_source");
  if (Array.isArray(composedSections)) {
    const sectionsByTaskId = new Map((plan.sections || []).map((section) => [section.taskId, section]));
    for (const item of composedSections) {
      const section = sectionsByTaskId.get(item && item.taskId);
      if (!section) { errors.push("unknown_fact_reference"); continue; }
      errors.push(...validateComposedSection(section, item.text).errors);
    }
  }
  const executionTypes = new Set(["availability", "available_dates", "room_options", "bundle_availability", "capacity", "price", "total_price"]);
  const incompleteExecution = (plan.sections || []).some((section) => executionTypes.has(section.type) && section.responseMode === "clarification" && !(section.missingInputs || []).length);
  if (incompleteExecution) errors.push("incomplete_task_execution");
  return { ok: errors.length === 0, errors: [...new Set(errors)], coveredTaskIds: claimCoverage.coveredTaskIds, missingTaskIds: claimCoverage.missingTaskIds, unexpectedTaskIds: claimCoverage.unexpectedTaskIds };
}

module.exports = { validateClaims };
