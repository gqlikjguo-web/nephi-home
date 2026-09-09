"use strict";

const { assertTaskCoverage } = require("./task-coverage");
const { meaningfulCharacterCount, validateComposedSection, composeControlledReply } = require("./controlled-composer");
const { canonicalExecutionProvenanceFor, isCanonicalExecutionProvenance } = require("./capability-executor");

function claimTypeForSection(section) {
  return section.claimType || (section.status === "answered" ? "FACTUAL_ANSWER"
    : section.status === "needs_clarification" ? "CLARIFY" : "HANDOFF");
}

function unknownProvenanceFor(outcome) {
  const provenance = canonicalExecutionProvenanceFor(outcome);
  return provenance && provenance.sourceOutcomeStatus === "unknown" && outcome.outcome === "unknown"
    && provenance.sourceReasonCode === outcome.reason ? provenance : null;
}

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
  const expected = (plan.sections || []).flatMap((section) => Array.isArray(section.coveredTaskIds) && section.coveredTaskIds.length
    ? section.coveredTaskIds
    : [section.taskId]);
  const claimed = claimedTaskIds === null || claimedTaskIds === undefined ? expected : claimedTaskIds;
  const claimCoverage = assertTaskCoverage(expected, { answeredTaskIds: Array.isArray(claimed) ? claimed : [], clarificationTaskIds: [], humanTaskIds: [], failedTaskIds: [] });
  if (!Array.isArray(claimed) || claimCoverage.unexpectedTaskIds.length) errors.push("unknown_fact_reference");
  if (claimCoverage.missingTaskIds.length) errors.push("incomplete_task_coverage");
  const missingFactSource = (plan.sections || []).some((section) => (
    claimTypeForSection(section) === "FACTUAL_ANSWER"
    && !String(section.facts && section.facts.source || "").trim()
  ));
  if (missingFactSource) errors.push("missing_fact_source");
  for (const section of plan.sections || []) {
    const type = claimTypeForSection(section);
    const expected = section.status === "answered" ? ["FACTUAL_ANSWER", "EPISTEMIC_UNKNOWN"]
      : section.status === "needs_clarification" ? ["CLARIFY"] : ["HANDOFF"];
    if (!expected.includes(type)) errors.push("invalid_claim_type");
    if (type !== "EPISTEMIC_UNKNOWN") continue;
    const provenance = section.unknownProvenance;
    if (!isCanonicalExecutionProvenance(provenance) || provenance.sourceOutcomeStatus !== "unknown"
      || provenance.taskId !== section.taskId || !provenance.sourceReasonCode
      || (section.coveredTaskIds || [section.taskId]).some(id => id !== provenance.taskId)) errors.push("invalid_unknown_provenance");
    if (Object.keys(section.facts || {}).some(key => key !== "subject")) errors.push("invalid_unknown_payload");
    if (!Array.isArray(composedSections) && text !== composeControlledReply(plan)) errors.push("ungrounded_section_text");
  }
  if (Array.isArray(composedSections)) {
    const sectionsByTaskId = new Map((plan.sections || []).flatMap((section) => (
      Array.isArray(section.coveredTaskIds) && section.coveredTaskIds.length
        ? section.coveredTaskIds.map((taskId) => [taskId, section])
        : [[section.taskId, section]]
    )));
    for (const item of composedSections) {
      const section = sectionsByTaskId.get(item && item.taskId);
      if (!section) { errors.push("unknown_fact_reference"); continue; }
      errors.push(...validateComposedSection(section, item.text).errors);
    }
  }
  const executionTypes = new Set(["availability", "available_dates", "room_options", "bundle_availability", "capacity", "lodging_product_capacity", "price", "total_price"]);
  const incompleteExecution = (plan.sections || []).some((section) => executionTypes.has(section.type) && section.responseMode === "clarification" && !(section.missingInputs || []).length);
  if (incompleteExecution) errors.push("incomplete_task_execution");
  return { ok: errors.length === 0, errors: [...new Set(errors)], coveredTaskIds: claimCoverage.coveredTaskIds, missingTaskIds: claimCoverage.missingTaskIds, unexpectedTaskIds: claimCoverage.unexpectedTaskIds };
}

module.exports = { validateClaims, claimTypeForSection, unknownProvenanceFor };
