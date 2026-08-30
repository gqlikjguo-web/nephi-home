"use strict";

const { validateSemanticUnitCandidate } = require("./contracts/semantic-unit-candidate");
const {
  capabilityPolicyFor,
  catalogIdentityRuleFor,
  projectCapabilityRegistry,
  safetyCandidateMatchesPolicy
} = require("./capability-subject-policy");
const {
  buildPublicCatalogIdentityProjection,
  isPublicCatalogIdentityProjectionFor
} = require("./turn-input-adapter");

const INPUT_BY_VALIDATED_SEMANTIC_UNIT = new WeakMap();

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function detach(value, seen = new Map()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : Object.fromEntries([]);
  seen.set(value, copy);
  if (Array.isArray(value)) {
    value.forEach((item) => copy.push(detach(item, seen)));
    return copy;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, detach(item, seen)]));
}

function failure(code) {
  return { ok: false, code, errors: [] };
}

function buildPublicCatalogIdentitySet(understandingTurnInput) {
  return buildPublicCatalogIdentityProjection(understandingTurnInput);
}

function catalogKindFor(identitySet, understandingTurnInput, catalogIdentity) {
  if (!isPublicCatalogIdentityProjectionFor(understandingTurnInput, identitySet)
    || typeof catalogIdentity !== "string") {
    return null;
  }
  const match = identitySet.find(([identity]) => identity === catalogIdentity);
  return match && typeof match[1] === "string" ? match[1] : null;
}

function evidenceKey(reference) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return null;
  const { eventId, messageRef, startOffset, endOffset, quote } = reference;
  if (typeof eventId !== "string" || typeof messageRef !== "string"
    || !Number.isInteger(startOffset) || !Number.isInteger(endOffset) || typeof quote !== "string") return null;
  return JSON.stringify([eventId, messageRef, startOffset, endOffset, quote]);
}

function evidenceOwned(refs, validatedEvidenceRefs) {
  if (!Array.isArray(refs) || !Array.isArray(validatedEvidenceRefs)) return false;
  const validatedKeys = new Set(validatedEvidenceRefs.map(evidenceKey).filter(Boolean));
  return refs.length > 0 && refs.every((reference) => {
    const key = evidenceKey(reference);
    return key !== null && validatedKeys.has(key);
  });
}

function catalogIdentityValid(unit, identitySet, understandingTurnInput, capabilityRegistryProjection) {
  const subject = unit.subject;
  const rule = catalogIdentityRuleFor(capabilityRegistryProjection, unit.capability, subject.kind);
  if (rule === "NULL") return subject.catalogIdentity === null;
  if (rule !== "PUBLIC_CATALOG") return false;
  return catalogKindFor(identitySet, understandingTurnInput, subject.catalogIdentity) === subject.kind;
}

function slotsHaveValidatedEvidence(slotCandidates, validatedEvidenceRefs) {
  return slotCandidates.every((slot) => evidenceOwned(slot.evidenceRefs, validatedEvidenceRefs));
}

function productSlotAdmission(slot, identitySet, understandingTurnInput) {
  if (slot.slot !== "product" || slot.operation === "CLEAR") return true;
  return ["room", "bundle", "matched_room_set"].includes(catalogKindFor(identitySet, understandingTurnInput, slot.value));
}

function otherSupportedSlotAdmission(slot, identitySet, understandingTurnInput, policy) {
  if (slot.slot !== "other_supported" || slot.operation === "CLEAR") return true;
  return policy.allowsOtherSupported && catalogKindFor(identitySet, understandingTurnInput, slot.value) === "other_verified";
}

function validateSemanticUnit({ unit, validatedEvidenceRefs, understandingTurnInput, publicCatalogIdentitySet, capabilityRegistryProjection } = {}) {
  const wire = validateSemanticUnitCandidate(unit);
  if (!wire.ok) return failure("SEMANTIC_UNIT_INVALID");
  if (!evidenceOwned(unit.evidenceRefs, validatedEvidenceRefs)
    || !slotsHaveValidatedEvidence(unit.slotCandidates, validatedEvidenceRefs)) {
    return failure("UNIT_EVIDENCE_MISSING");
  }
  const policy = capabilityPolicyFor(capabilityRegistryProjection, unit.capability);
  if (!policy) return failure("UNIT_MEANING_UNSUPPORTED");
  if (!catalogIdentityValid(unit, publicCatalogIdentitySet, understandingTurnInput, capabilityRegistryProjection)) {
    return failure("CATALOG_IDENTITY_INVALID");
  }
  if (!policy.purposes.includes(unit.purpose)) return failure("UNIT_MEANING_UNSUPPORTED");
  if (!policy.subjectKinds.includes(unit.subject.kind)) return failure("CAPABILITY_SUBJECT_CONFLICT");
  if (unit.stayDependent !== policy.stayDependent) return failure("STAY_DEPENDENCY_CONFLICT");
  if (!safetyCandidateMatchesPolicy(capabilityRegistryProjection, unit.capability, unit.purpose, unit.safetyCandidate)) {
    return failure("UNIT_MEANING_UNSUPPORTED");
  }
  if (!unit.slotCandidates.every((slot) => productSlotAdmission(slot, publicCatalogIdentitySet, understandingTurnInput))
    || !unit.slotCandidates.every((slot) => otherSupportedSlotAdmission(slot, publicCatalogIdentitySet, understandingTurnInput, policy))) {
    return failure("UNIT_MEANING_UNSUPPORTED");
  }
  const value = deepFreeze(detach(unit));
  INPUT_BY_VALIDATED_SEMANTIC_UNIT.set(value, understandingTurnInput);
  return { ok: true, code: null, errors: [], value };
}

function isValidatedSemanticUnitFor(understandingTurnInput, unit) {
  return Boolean(unit) && typeof unit === "object"
    && INPUT_BY_VALIDATED_SEMANTIC_UNIT.get(unit) === understandingTurnInput;
}

module.exports = {
  buildPublicCatalogIdentitySet,
  projectCapabilityRegistry,
  isValidatedSemanticUnitFor,
  validateSemanticUnit
};
