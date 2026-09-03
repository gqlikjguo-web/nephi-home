"use strict";

const { validateSemanticUnitCandidate } = require("./semantic-unit-candidate");
const { validateLifecycleDecision } = require("../lifecycle-manager");

const CANONICALIZER_INPUT_ITEM_FIELDS = Object.freeze([
  "unitId",
  "capabilityCandidate",
  "subjectCandidate",
  "stayDependent",
  "temporalCandidate",
  "verifiedSlotInputs",
  "evidenceRefs",
  "propertyScope"
]);
const PROPERTY_SCOPE_FIELDS = Object.freeze(["propertyId", "channel", "userId"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, fields) {
  return isPlainObject(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((key) => fields.includes(key));
}

function boundedText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function validateCanonicalizerInputItem(value) {
  const errors = [];
  if (!exactKeys(value, CANONICALIZER_INPUT_ITEM_FIELDS)) errors.push("keys");
  if (!boundedText(value && value.unitId)) errors.push("unitId");
  if (!exactKeys(value && value.propertyScope, PROPERTY_SCOPE_FIELDS)) {
    errors.push("propertyScope.keys");
  } else {
    PROPERTY_SCOPE_FIELDS.forEach((field) => {
      if (!boundedText(value.propertyScope[field])) errors.push(`propertyScope.${field}`);
    });
  }

  const semanticShape = validateSemanticUnitCandidate({
    unitId: value && value.unitId,
    evidenceRefs: value && value.evidenceRefs,
    purpose: "lodging_question",
    capability: value && value.capabilityCandidate,
    subject: value && value.subjectCandidate,
    stayDependent: value && value.stayDependent,
    temporalCandidate: value && value.temporalCandidate,
    contextLinkCandidateId: "canonical-adapter-contract",
    safetyCandidate: null,
    slotCandidates: [],
    confidenceBand: "high"
  });
  if (!semanticShape.ok
    || value && [null, "unsupported", "booking_operator_request", "high_risk"].includes(value.capabilityCandidate)
    || value && value.subjectCandidate && value.subjectCandidate.kind === null) {
    errors.push("semanticFields");
  }

  const slotShape = validateLifecycleDecision({
    lifecycleDecisionId: "canonical-adapter-contract",
    unitId: value && value.unitId,
    action: "START",
    targetRequestCycleId: null,
    verifiedSlotOperations: value && value.verifiedSlotInputs,
    status: "VALIDATED"
  }, { unitIds: [value && value.unitId] });
  if (!slotShape.ok) errors.push("verifiedSlotInputs");

  return errors.length
    ? { ok: false, code: "CANONICAL_INPUT_INCOMPLETE", errors: [...new Set(errors)] }
    : { ok: true, code: null, errors: [], value };
}

module.exports = {
  CANONICALIZER_INPUT_ITEM_FIELDS,
  PROPERTY_SCOPE_FIELDS,
  validateCanonicalizerInputItem
};
