"use strict";

const { coverageByStatus, assertTaskCoverage } = require("./task-coverage");

const TASK_PRIORITY = Object.freeze({
  availability: 10, available_dates: 10, room_options: 10, bundle_availability: 10, booking_request: 10,
  capacity: 20,
  price: 30, total_price: 30,
  amenity: 40, amenity_list: 40,
  policy: 50,
  property_fact: 60,
  human_help: 70, high_risk: 70,
  unknown: 80
});
const FINAL_DECISION_TYPES = new Set(["reply", "clarification", "human_handoff", "no_reply"]);
const SECTION_MODES = new Set(["answer", "clarification", "handoff"]);
const NON_PUBLIC_FACT_KEYS = new Set(["source", "propertyId", "canonicalId", "id"]);

function taskPriority(type) { return TASK_PRIORITY[type] || TASK_PRIORITY.unknown; }
function collectAllowedFacts(value, key = "") {
  if (NON_PUBLIC_FACT_KEYS.has(key) || value === null || value === undefined) return [];
  if (["string", "number"].includes(typeof value)) return [String(value)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((item) => collectAllowedFacts(item, key));
  if (typeof value === "object") return Object.entries(value).flatMap(([childKey, childValue]) => collectAllowedFacts(childValue, childKey));
  return [];
}
function contractError(code, details = {}) {
  return {
    ok: false,
    schemaVersion: 2,
    sections: [],
    coverage: coverageByStatus([]),
    coverageValidation: assertTaskCoverage([], coverageByStatus([])),
    reviewActions: [],
    allowedFacts: [],
    error: { code, ...details }
  };
}

function buildResponsePlan({ propertyId, inputTaskIds, reviewActions = [], finalDecision = null }) {
  if (!finalDecision || !FINAL_DECISION_TYPES.has(finalDecision.type)) return contractError("engine_final_decision_required");
  if (finalDecision.type === "no_reply") return contractError("response_plan_for_no_reply");
  if (finalDecision.shouldReply !== true) return contractError("invalid_should_reply_contract");
  if (!Array.isArray(finalDecision.approvedTaskResults)) return contractError("approved_task_results_required");

  const clarificationFields = new Set((finalDecision.clarificationFields || []).map(String));
  const sectionModes = finalDecision.sectionModes && typeof finalDecision.sectionModes === "object" ? finalDecision.sectionModes : {};
  const handoffReasons = finalDecision.handoffReasons && typeof finalDecision.handoffReasons === "object" ? finalDecision.handoffReasons : {};
  const expected = inputTaskIds || finalDecision.approvedTaskResults.map((result) => result.taskId);
  const order = new Map(expected.map((taskId, index) => [taskId, index]));
  const sections = [];

  for (const result of finalDecision.approvedTaskResults) {
    const responseMode = sectionModes[result.taskId];
    if (!SECTION_MODES.has(responseMode)) return contractError("section_decision_required", { taskId: result.taskId });
    const missingInputs = (result.missingInputs || []).map(String);
    if (responseMode === "clarification" && missingInputs.some((field) => !clarificationFields.has(field))) {
      return contractError("clarification_fields_not_approved", { taskId: result.taskId });
    }
    const handoffReason = responseMode === "handoff"
      ? String(handoffReasons[result.taskId] || finalDecision.handoffReason || "")
      : "";
    if (responseMode === "handoff" && !handoffReason) return contractError("handoff_reason_required", { taskId: result.taskId });
    const facts = result.facts || {};
    sections.push({
      taskId: result.taskId,
      type: result.type,
      status: result.status,
      responseMode,
      priority: taskPriority(result.type),
      inputOrder: order.has(result.taskId) ? order.get(result.taskId) : Number.MAX_SAFE_INTEGER,
      facts,
      question: responseMode === "clarification" ? String(result.question || "") : "",
      missingInputs: responseMode === "clarification" ? missingInputs : [],
      handoffReason,
      needsReview: responseMode === "handoff",
      allowedFacts: [...new Set(collectAllowedFacts(facts))]
    });
  }

  sections.sort((a, b) => a.inputOrder - b.inputOrder);
  const coverage = coverageByStatus(sections);
  return {
    ok: true,
    schemaVersion: 2,
    propertyId,
    finalDecision: {
      type: finalDecision.type,
      reasonCode: finalDecision.reasonCode,
      shouldReply: finalDecision.shouldReply,
      clarificationFields: [...clarificationFields],
      handoffReason: String(finalDecision.handoffReason || "")
    },
    sections,
    coverage,
    coverageValidation: assertTaskCoverage(expected, coverage),
    reviewActions,
    allowedFacts: [...new Set(sections.flatMap((section) => section.allowedFacts))],
    forbiddenClaims: ["已替你保留", "已完成訂房", "一定有房", "免費加人", "可以折扣", "一定退款", "業者已同意", "真人已看過", "已通知業者"],
    maxLength: 1200
  };
}

module.exports = { TASK_PRIORITY, taskPriority, buildResponsePlan };
