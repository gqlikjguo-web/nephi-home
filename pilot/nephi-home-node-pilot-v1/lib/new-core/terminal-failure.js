"use strict";

// Internal operational provenance, never a business task, fact, or persisted state.
const FAILURES = new WeakSet();
const SOURCE_SCOPES = new WeakMap();
const TEXT = Object.freeze({
  UNDERSTANDING: "目前未能確認這則訊息需要處理的內容。",
  CORRECTION_REJECTED: "目前未能完成這則訊息的理解。",
  EXECUTION_TECHNICAL: "這部分目前未能完成處理。",
  CLAIM_VALIDATION: "這部分目前無法提供經確認的回覆。"
});
function isTerminalFailure(value, { propertyId, turnId, scopeRef } = {}) {
  return Boolean(value && FAILURES.has(value) && value.propertyId === propertyId
    && value.turnId === turnId && value.scopeRef === scopeRef && TEXT[value.kind]);
}
function processingStatusText(failure) { return failure && TEXT[failure.kind] || ""; }
function createTerminalContext({ propertyId, turnId }) {
  if (!propertyId || !turnId) throw new TypeError("terminal_scope_required");
  const failures = [];
  function record(scopeRef, kind, boundary, origin, code, source) {
    if (!scopeRef || !TEXT[kind] || !source) throw new TypeError("terminal_evidence_required");
    const binding = JSON.stringify([propertyId, turnId]);
    if (SOURCE_SCOPES.has(source) && SOURCE_SCOPES.get(source) !== binding) throw new TypeError("terminal_source_scope_mismatch");
    SOURCE_SCOPES.set(source, binding);
    const value = Object.freeze({ propertyId, turnId, scopeRef, kind, boundary, origin, code });
    FAILURES.add(value); failures.push(value); return value;
  }
  return Object.freeze({
    propertyId, turnId,
    get failures() { return failures.slice(); },
    fromUnderstanding(result) {
      const provider = require("../providers/openai-understanding-v1");
      if (!provider.isTrustedUnderstandingResult(result) || result.understandingOutput.turnId !== turnId) throw new TypeError("trusted_understanding_required");
      const diagnostic = result[provider.OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC];
      if (diagnostic?.understandingEvidence?.providerVisibleInput?.propertyScope?.propertyId !== propertyId) throw new TypeError("understanding_property_mismatch");
      const second = diagnostic?.attempts?.find(item => item.attemptNumber === 2 && !item.accepted);
      return result.failedUnits.map(failure => record(failure.unitId, second ? "CORRECTION_REJECTED" : "UNDERSTANDING",
        second?.validationResult?.adoptionFailure ? "CORRECTION_ADOPTION" : failure.boundary,
        diagnostic?.attempts?.[0]?.validationResult?.failures?.find(item => item.unitId === failure.unitId)?.origin || "validation",
        second?.validationResult?.adoptionFailure || failure.failureCode, result));
    },
    fromException(error, scopeRef, boundary = "APPLICATION_SERVICE") {
      if (!(error instanceof Error)) throw new TypeError("caught_exception_required");
      const transport = ["timeout", "network", "rate_limit", "provider_5xx", "authentication", "configuration"].includes(error.errorCategory);
      return record(scopeRef, boundary === "UNDERSTANDING" && !transport ? "UNDERSTANDING" : "EXECUTION_TECHNICAL", transport ? "PROVIDER_TRANSPORT" : boundary,
        transport ? error.errorCategory : "runtime", String(error.code || "NEW_CORE_RUNTIME_FAILURE"), error);
    },
    fromExecution(outcome) {
      const evidence = require("../conversation-engine-v2/capability-executor").canonicalExecutionProvenanceFor(outcome);
      if (!evidence || evidence.propertyId !== propertyId || evidence.taskId !== outcome.taskId
        || evidence.sourceOutcomeStatus !== outcome.outcome || !["technical_error", "invalid_query_plan", "property_data_missing"].includes(outcome.outcome)) throw new TypeError("execution_failure_provenance_required");
      return record(outcome.taskId, "EXECUTION_TECHNICAL", "EXECUTION", "execution", outcome.reason || outcome.outcome, evidence);
    },
    fromValidationFailure(outcome, input) {
      // Only application-owned outcomes following the formal unit and Context gates.
      const { isValidatedSemanticUnitFor } = require("./semantic-unit-validator");
      if (!outcome?.failure || !isValidatedSemanticUnitFor(input, outcome.unit) || input?.propertyScope?.propertyId !== propertyId || input?.turnId !== turnId) throw new TypeError("validated_failure_required");
      return record(outcome.unit.unitId, "EXECUTION_TECHNICAL", outcome.failure.layer, "validation", outcome.failure.failureCode, outcome.unit);
    },
    fromClaimValidation(validation, scopeRef) {
      const { isClaimValidationResult } = require("../conversation-engine-v2/claim-validator");
      if (!isClaimValidationResult(validation) || validation.ok || validation.propertyId !== propertyId || validation.turnId !== turnId
        || !validation.globalErrors.length && !validation.sectionResults.some(item => !item.ok && item.scopeRefs.includes(scopeRef))) throw new TypeError("claim_failure_provenance_required");
      return record(scopeRef, "CLAIM_VALIDATION", "CLAIM_VALIDATION", "claim_validation", "CLAIM_VALIDATION_FAILED", validation);
    }
  });
}
module.exports = { createTerminalContext, isTerminalFailure, processingStatusText };
