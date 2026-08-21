"use strict";

const { coverageByStatus, assertTaskCoverage } = require("./task-coverage");

const TASK_PRIORITY = Object.freeze({
  availability: 10, available_dates: 10, room_options: 10, bundle_availability: 10, booking_request: 10,
  capacity: 20, lodging_product_capacity: 20,
  price: 30, total_price: 30,
  amenity: 40, amenity_list: 40,
  policy: 50,
  property_fact: 60,
  human_help: 70, high_risk: 70,
  unknown: 80
});

function taskPriority(type) { return TASK_PRIORITY[type] || TASK_PRIORITY.unknown; }
function responseMode(status) { return status === "answered" ? "answer" : status === "needs_clarification" ? "clarification" : "handoff"; }
const NON_PUBLIC_FACT_KEYS = new Set(["source", "propertyId", "canonicalId", "id", "customReplyRuleId", "customReplySource"]);
function collectAllowedFacts(value, key = "") {
  if (NON_PUBLIC_FACT_KEYS.has(key) || value === null || value === undefined) return [];
  if (["string", "number"].includes(typeof value)) return [String(value)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((item) => collectAllowedFacts(item, key));
  if (typeof value === "object") return Object.entries(value).flatMap(([childKey, childValue]) => collectAllowedFacts(childValue, childKey));
  return [];
}

function buildResponsePlan({ propertyId, taskResults, inputTaskIds, canonicalRequests = [], reviewActions = [] }) {
  const canonicalByTaskId = new Map((canonicalRequests || []).map((request) => [request.taskId, request]));
  const rawSections = (taskResults || []).map((result, inputOrder) => {
    const canonicalRequest = canonicalByTaskId.get(result.taskId) || null;
    const type = canonicalRequest ? canonicalRequest.capability : result.type;
    return {
      taskId: result.taskId,
      coveredTaskIds: [result.taskId],
      type,
      status: result.status,
      responseMode: responseMode(result.status),
      canonicalResponseMode: canonicalRequest && canonicalRequest.responseMode || "",
      resolverId: canonicalRequest && canonicalRequest.resolverId || "",
      riskLevel: canonicalRequest && canonicalRequest.riskLevel || "",
      priority: taskPriority(type),
      inputOrder,
      facts: result.facts || {},
      question: result.question || "",
      missingInputs: result.missingInputs || [],
      needsReview: Boolean(result.review)
    };
  });
  const sections = [];
  for (const section of rawSections) {
    const canonicalRequest = canonicalByTaskId.get(section.taskId);
    const existing = canonicalRequest
      && canonicalRequest.resolverId === "property_catalog"
      && canonicalRequest.riskLevel === "low"
      && canonicalRequest.responseMode === "answer"
      && canonicalRequest.canonicalEntity.status === "resolved"
      && canonicalRequest.canonicalEntity.canonicalId
      && !["room", "bundle"].includes(canonicalRequest.canonicalEntity.category)
      && section.status === "answered"
      ? sections.find((candidate) => {
        const request = canonicalByTaskId.get(candidate.taskId);
        return request
          && request.resolverId === "property_catalog"
          && request.riskLevel === "low"
          && request.responseMode === "answer"
          && request.canonicalEntity.status === "resolved"
          && request.canonicalEntity.canonicalId === canonicalRequest.canonicalEntity.canonicalId
          && candidate.status === "answered"
          && candidate.facts === section.facts;
      })
      : null;
    if (existing) existing.coveredTaskIds.push(section.taskId);
    else sections.push(section);
  }
  const expected = inputTaskIds || sections.flatMap((section) => section.coveredTaskIds);
  const coverage = coverageByStatus(sections);
  const coverageValidation = assertTaskCoverage(expected, coverage);
  for (const taskId of coverageValidation.missingTaskIds) sections.push({ taskId, type: "unknown", status: "failed", facts: { subject: "這個問題" }, question: "", needsReview: true });
  for (const section of sections) {
    if (!section.responseMode) section.responseMode = responseMode(section.status);
    if (!Number.isFinite(section.priority)) section.priority = taskPriority(section.type);
    section.allowedFacts = [...new Set(collectAllowedFacts(section.facts))];
  }
  sections.sort((a, b) => (a.inputOrder ?? Number.MAX_SAFE_INTEGER) - (b.inputOrder ?? Number.MAX_SAFE_INTEGER));
  const finalCoverage = coverageByStatus(sections);
  return { schemaVersion: 1, propertyId, sections, coverage: finalCoverage, coverageValidation: assertTaskCoverage(expected, finalCoverage), reviewActions, allowedFacts: [...new Set(sections.flatMap((section) => section.allowedFacts || []))], forbiddenClaims: ["已替你保留", "已完成訂房", "一定有房", "免費加人", "可以折扣", "一定退款", "業者已同意", "真人已看過", "已通知業者"], maxLength: 1200 };
}

module.exports = { TASK_PRIORITY, taskPriority, buildResponsePlan };
