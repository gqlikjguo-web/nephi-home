"use strict";

const { validateSemanticUnitCandidate } = require("./contracts/semantic-unit-candidate");
const { capabilityPolicyFor, projectCapabilityRegistry } = require("./capability-subject-policy");

const CATALOG_ITEM_FIELDS = Object.freeze(["catalogIdentity", "kind", "publicName"]);

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

function exactKeys(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((key) => fields.includes(key));
}

function failure(code) {
  return { ok: false, code, errors: [] };
}

function buildPublicCatalogIdentitySet(publicSubjectCatalog) {
  if (!Array.isArray(publicSubjectCatalog)) return null;
  const identities = [];
  for (const item of publicSubjectCatalog) {
    if (!exactKeys(item, CATALOG_ITEM_FIELDS)
      || typeof item.catalogIdentity !== "string" || item.catalogIdentity.length === 0
      || typeof item.kind !== "string" || item.kind.length === 0
      || typeof item.publicName !== "string" || item.publicName.length === 0
      || identities.some(([catalogIdentity]) => catalogIdentity === item.catalogIdentity)) {
      return null;
    }
    identities.push([item.catalogIdentity, item.kind]);
  }
  return deepFreeze(identities);
}

function catalogKindFor(identitySet, catalogIdentity) {
  if (!Array.isArray(identitySet) || typeof catalogIdentity !== "string") {
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

function catalogIdentityValid(subject, identitySet) {
  if (subject.kind === null) return subject.catalogIdentity === null;
  if (subject.kind === "external_place") return subject.catalogIdentity === null;
  return catalogKindFor(identitySet, subject.catalogIdentity) === subject.kind;
}

function slotsHaveValidatedEvidence(slotCandidates, validatedEvidenceRefs) {
  return slotCandidates.every((slot) => evidenceOwned(slot.evidenceRefs, validatedEvidenceRefs));
}

function productSlotAdmission(slot, identitySet) {
  if (slot.slot !== "product" || slot.operation === "CLEAR") return true;
  return ["room", "bundle", "matched_room_set"].includes(catalogKindFor(identitySet, slot.value));
}

function otherSupportedSlotAdmission(slot, identitySet, policy) {
  if (slot.slot !== "other_supported" || slot.operation === "CLEAR") return true;
  return policy.allowsOtherSupported && catalogKindFor(identitySet, slot.value) === "other_verified";
}

function validateSemanticUnit({ unit, validatedEvidenceRefs, publicCatalogIdentitySet, capabilityRegistryProjection } = {}) {
  const wire = validateSemanticUnitCandidate(unit);
  if (!wire.ok) return failure("SEMANTIC_UNIT_INVALID");
  if (!evidenceOwned(unit.evidenceRefs, validatedEvidenceRefs)
    || !slotsHaveValidatedEvidence(unit.slotCandidates, validatedEvidenceRefs)) {
    return failure("UNIT_EVIDENCE_MISSING");
  }
  if (!catalogIdentityValid(unit.subject, publicCatalogIdentitySet)) {
    return failure("CATALOG_IDENTITY_INVALID");
  }
  const policy = capabilityPolicyFor(capabilityRegistryProjection, unit.capability);
  if (!policy) return failure("UNIT_MEANING_UNSUPPORTED");
  if (!policy.subjectKinds.includes(unit.subject.kind)) return failure("CAPABILITY_SUBJECT_CONFLICT");
  if (unit.stayDependent !== policy.stayDependent) return failure("STAY_DEPENDENCY_CONFLICT");
  if (!unit.slotCandidates.every((slot) => productSlotAdmission(slot, publicCatalogIdentitySet))
    || !unit.slotCandidates.every((slot) => otherSupportedSlotAdmission(slot, publicCatalogIdentitySet, policy))) {
    return failure("UNIT_MEANING_UNSUPPORTED");
  }
  return { ok: true, code: null, errors: [], value: deepFreeze(detach(unit)) };
}

module.exports = {
  buildPublicCatalogIdentitySet,
  projectCapabilityRegistry,
  validateSemanticUnit
};
