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
function validateClaimSet(reply, plan, claimedTaskIds, composedSections = null) {
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
    // Even deterministic rendering must satisfy the independent availability
    // contract; changing its renderer cannot redefine a valid guest answer.
    const availabilityErrors = require("./availability-reply-validation").validateAvailabilityReply(section,
      Array.isArray(composedSections)
        ? composedSections.find(item => item.taskId === section.taskId)?.text || ""
        : (plan.sections || []).length === 1 ? text : composeControlledReply({ ...plan, sections: [section] }));
    if (availabilityErrors) errors.push(...availabilityErrors);
    const expected = section.status === "answered" ? ["FACTUAL_ANSWER", "EPISTEMIC_UNKNOWN", "PROCESSING_STATUS"]
      : section.status === "needs_clarification" ? ["CLARIFY"] : ["HANDOFF"];
    if (!expected.includes(type)) errors.push("invalid_claim_type");
    for (const origin of section.factOrigins || []) {
      if (!(section.coveredTaskIds || [section.taskId]).includes(origin.taskId)
        || !origin.facts?.source || origin.facts.propertyId !== plan.propertyId) errors.push("fact_origin_scope_mismatch");
    }
    if (type === "FACTUAL_ANSWER" && section.facts?.propertyId
      && plan.propertyId && section.facts.propertyId !== plan.propertyId) errors.push("fact_property_scope_mismatch");
    if (type === "FACTUAL_ANSWER" && section.outcomeStatus === "unknown") {
      if (!(section.coveredTaskIds || [section.taskId]).includes(section.taskId)) errors.push("invalid_partial_fact_provenance");
      for (const taskId of section.coveredTaskIds || [section.taskId]) {
        const origin = taskId === section.taskId ? section : plan.renderObligations?.find(item => item.taskId === taskId)?.payload;
        const provenance = origin?.executionProvenance;
        if (!isCanonicalExecutionProvenance(provenance) || provenance.sourceOutcomeStatus !== "unknown"
          || provenance.taskId !== taskId || provenance.propertyId !== plan.propertyId || !provenance.turnId || provenance.turnId !== plan.turnId
          || !provenance.knownFacts || !require("node:util").isDeepStrictEqual(provenance.knownFacts, origin.facts)
          || provenance.knownFacts.answerScope !== "general_policy") errors.push("invalid_partial_fact_provenance");
      }
    }
    if (type === "EPISTEMIC_UNKNOWN" && section.unknownProvenance?.propertyId
      && plan.propertyId && section.unknownProvenance.propertyId !== plan.propertyId) errors.push("unknown_property_scope_mismatch");
    if (type === "PROCESSING_STATUS") {
      const { isTerminalFailure } = require("../new-core/terminal-failure");
      if (!isTerminalFailure(section.terminalFailure, { propertyId: plan.propertyId, turnId: plan.turnId, scopeRef: section.taskId })
        || (section.coveredTaskIds || [section.taskId]).some(id => id !== section.taskId)) errors.push("invalid_terminal_provenance");
      if (Object.keys(section.facts || {}).length || section.unknownProvenance) errors.push("invalid_terminal_payload");
      if (text !== composeControlledReply(plan)) errors.push("ungrounded_section_text");
    }
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

const VALIDATIONS = new WeakSet();
const FINAL_RESPONSES = new WeakMap();
const IMAGE_SOURCES = new WeakMap();
function isClaimValidationResult(value) { return Boolean(value && VALIDATIONS.has(value)); }
function validateClaims(reply, plan, claimedTaskIds, composedSections = null, finalAssembly = null) {
  // One validator owns section and whole-message applicability, including delivery text.
  const sectionResults = (plan.sections || []).map(section => {
    const scopeRefs = section.coveredTaskIds || [section.taskId];
    const single = { ...plan, sections: [section] };
    const result = validateClaimSet(composeControlledReply(single), single, scopeRefs);
    return { scopeRefs, ok: result.ok, errors: result.errors };
  });
  let dependencyChanged = true;
  while (dependencyChanged) {
    dependencyChanged = false;
    const failed = new Set(sectionResults.filter(item => !item.ok).flatMap(item => item.scopeRefs));
    for (const [index, section] of (plan.sections || []).entries()) {
      if (sectionResults[index].ok && [...(section.dependsOnScopeRefs || []), ...(section.coveredTaskIds || [section.taskId])].some(id => failed.has(id))) {
        sectionResults[index].ok = false; sectionResults[index].errors.push("claim_dependency_failed"); dependencyChanged = true;
      }
    }
  }
  const base = validateClaimSet(finalAssembly ? composeControlledReply(plan) : reply, plan, claimedTaskIds, composedSections);
  const localErrors = new Set(sectionResults.flatMap(item => item.errors));
  const globalErrors = base.errors.filter(error => !localErrors.has(error));
  if (finalAssembly) {
    const text = String(reply || "");
    const coverage = require("./render-obligation").validateVisibleCoverage(text, plan, finalAssembly);
    globalErrors.push(...coverage.errors);
    if (text.length > (plan.maxLength || 1200)) globalErrors.push("length");
    if (INTERNAL.test(text)) globalErrors.push("internal_content");
    if (UNAUTHORIZED_PROMISE.test(text)) globalErrors.push("forbidden_claim");
    if (!text.trim()) globalErrors.push("empty_reply");

  }
  const errors = [...new Set([...base.errors, ...sectionResults.flatMap(item => item.errors), ...globalErrors])];
  for (const item of sectionResults) { Object.freeze(item.scopeRefs); Object.freeze(item.errors); Object.freeze(item); }
  const result = Object.freeze({ ...base, ok: !errors.length, errors: Object.freeze(errors), sectionResults: Object.freeze(sectionResults),
    globalErrors: Object.freeze([...new Set(globalErrors)]), propertyId: plan.propertyId, turnId: plan.turnId,
    ...(finalAssembly ? { validatedText: String(reply || ""), validatedAction: finalAssembly.finalDecision.action } : {}) });
  if (result.ok && finalAssembly) IMAGE_SOURCES.set(result, Object.freeze([
    ...require("../property-image-attachments").imageSourcesForPlan(plan)
  ]));
  VALIDATIONS.add(result); return result;
}
function sealFinalResponse(response, validation) {
  if (!isClaimValidationResult(validation) || !validation.ok || validation.validatedText !== response.replyText
    || validation.validatedAction !== response.action) throw new TypeError("final_response_not_validated");
  if (response.attachments !== undefined) {
    const sources = IMAGE_SOURCES.get(validation) || [];
    if (!Array.isArray(response.attachments) || response.attachments.length > 4 || response.action !== "reply"
      || response.attachments.some(item => !require("../property-image-attachments").isImageReceipt(item)
        || item.propertyId !== validation.propertyId || !sources.includes(item.sourceId))) throw new TypeError("image_attachment_not_validated");
    Object.freeze(response.attachments);
  }
  const frozen = Object.freeze(response); FINAL_RESPONSES.set(frozen, validation); return frozen;
}
function isValidatedFinalResponse(response, deliveryScope = null) {
  const validation = response && FINAL_RESPONSES.get(response);
  if (deliveryScope && (!deliveryScope.propertyId || !deliveryScope.turnId || !deliveryScope.eventId
    || deliveryScope.turnId !== deliveryScope.eventId
    || !validation || validation.propertyId !== deliveryScope.propertyId || validation.turnId !== deliveryScope.turnId)) return false;
  return Boolean(validation && validation.ok && validation.validatedText === response.replyText && validation.validatedAction === response.action && response.shouldReply === true);
}
function finalResponseImageSources(response) {
  if (!isValidatedFinalResponse(response) || response.action !== "reply") return [];
  return [...(IMAGE_SOURCES.get(FINAL_RESPONSES.get(response)) || [])];
}
function attachFinalResponseImages(response, images) {
  if (!isValidatedFinalResponse(response)) throw new TypeError("image_final_response_not_validated");
  return sealFinalResponse({...response, attachments: [...images]}, FINAL_RESPONSES.get(response));
}
module.exports = { finalResponseImageSources, attachFinalResponseImages, validateClaims, claimTypeForSection, unknownProvenanceFor, isClaimValidationResult, sealFinalResponse, isValidatedFinalResponse };
