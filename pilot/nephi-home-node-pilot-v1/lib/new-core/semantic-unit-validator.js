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

const { validateSemanticPositions, bindSemanticObligations, semanticObligationsPreserved } = require("./contracts/semantic-position");

const INPUT_BY_VALIDATED_SEMANTIC_UNIT = new WeakMap();

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function detach(value, seen = new Map()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? []
    : Object.fromEntries(Object.keys(value).map(key => [key, undefined]));
  seen.set(value, copy);
  if (Array.isArray(value)) {
    value.forEach((item) => copy.push(detach(item, seen)));
    return copy;
  }
  // Seed own keys before assigning values, retaining ordinary data keys even
  // when they shadow inherited setters. The memo and return share this clone.
  Object.assign(copy, Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, detach(item, seen)])
  ));
  return copy;
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
  if (rule === "NULL_OR_PUBLIC_CATALOG") {
    return subject.catalogIdentity === null
      || catalogKindFor(identitySet, understandingTurnInput, subject.catalogIdentity) === subject.kind;
  }
  if (rule !== "PUBLIC_CATALOG") return false;
  return catalogKindFor(identitySet, understandingTurnInput, subject.catalogIdentity) === subject.kind;
}

function slotsHaveValidatedEvidence(slotCandidates, validatedEvidenceRefs) {
  return slotCandidates.every((slot) => evidenceOwned(slot.evidenceRefs, validatedEvidenceRefs));
}

function quantitySubjectAdmission(kind) {
  const allowedKinds = ["room", "bundle", "matched_room_set"];
  return { allowed: allowedKinds.includes(kind), rule: "quantitySubjectAdmission", actualKind: kind, allowedKinds };
}

function productSlotAdmission(slot, identitySet, understandingTurnInput) {
  if (slot.slot !== "product" || slot.operation === "CLEAR") return { allowed: true };
  const allowedKinds = ["room", "bundle", "matched_room_set"];
  const actualKind = catalogKindFor(identitySet, understandingTurnInput, slot.value);
  return { allowed: allowedKinds.includes(actualKind), rule: "productSlotAdmission", actualKind, allowedKinds };
}

function otherSupportedSlotAdmission(slot, identitySet, understandingTurnInput, policy) {
  if (slot.slot !== "other_supported" || slot.operation === "CLEAR") return { allowed: true };
  const allowedKinds = policy.allowsOtherSupported ? ["other_verified"] : [];
  const actualKind = catalogKindFor(identitySet, understandingTurnInput, slot.value);
  return { allowed: allowedKinds.includes(actualKind), rule: "otherSupportedSlotAdmission", actualKind, allowedKinds };
}

function firstSlotAdmissionFailure(slots, admit) {
  for (let index = 0; index < slots.length; index += 1) {
    const result = admit(slots[index]);
    if (!result.allowed) return deepFreeze({ field: `slotCandidates[${index}].value`,
      rule: result.rule, actualKind: result.actualKind, allowedKinds: result.allowedKinds });
  }
  return null;
}

function validateSemanticUnit({ unit, validatedEvidenceRefs, understandingTurnInput, publicCatalogIdentitySet, capabilityRegistryProjection } = {}) {
  const fieldValidationState = [];
  const complete = (field, gate) => {
    const state = fieldValidationState.find(item => item.field === field);
    if (state) { state.validationCompleted.push(gate); state.validationPending = state.validationPending.filter(item => item !== gate); }
  };
  const reject = (code, target) => ({...failure(code), fieldValidationState: deepFreeze(detach(bindSemanticObligations(fieldValidationState.map(state => ({
    ...state, preservation: state.field === target ? "MUTABLE" : !state.validationPending.length && !state.dependsOn.length ? "PRESERVE" : "REVALIDATE"
  })), unit, understandingTurnInput)))});
  const wire = validateSemanticUnitCandidate(unit);
  if (!wire.ok) return reject("SEMANTIC_UNIT_INVALID");
  if (!evidenceOwned(unit.evidenceRefs, validatedEvidenceRefs)
    || !slotsHaveValidatedEvidence(unit.slotCandidates, validatedEvidenceRefs)) {
    return reject("UNIT_EVIDENCE_MISSING");
  }
  if (unit.quantityCandidate && !evidenceOwned(unit.quantityCandidate.evidenceRefs, validatedEvidenceRefs)) return reject('UNIT_EVIDENCE_MISSING');
  const add = (field, pending, dependsOn, extra = {}) => fieldValidationState.push({field,
    validationCompleted:["structure", "evidenceOwnership"], validationPending:pending, dependsOn, ...extra});
  for (const slot of unit.slotCandidates) {
    const pending = slot.slot === "product" ? ["productSlotAdmission"] : slot.slot === "other_supported" ? ["otherSupportedSlotAdmission"] : [];
    add(`slotCandidates.${slot.slotCandidateId}`, pending, slot.slot === "other_supported" ? ["capability"] : [], {slotCandidateId:slot.slotCandidateId});
  }
  if (unit.quantityCandidate) add("quantityCandidate", ["quantitySubjectAdmission"], ["subject.kind"]);
  if (unit.temporalCandidate) add("temporalCandidate", ["temporalAdmission"], ["capability"]);
  add("subject", ["catalogIdentity", "subjectPolicy"], ["capability"]);
  add("capability", ["capabilityPolicy"], ["purpose"]);
  const policy = capabilityPolicyFor(capabilityRegistryProjection, unit.capability);
  if (!policy) return reject("UNIT_MEANING_UNSUPPORTED", "capability");
  complete("capability", "capabilityPolicy");
  if (!catalogIdentityValid(unit, publicCatalogIdentitySet, understandingTurnInput, capabilityRegistryProjection)) {
    return reject("CATALOG_IDENTITY_INVALID", "subject");
  }
  complete("subject", "catalogIdentity");
  if (!policy.purposes.includes(unit.purpose)) return reject("UNIT_MEANING_UNSUPPORTED");
  if (!policy.subjectKinds.includes(unit.subject.kind)) return reject("CAPABILITY_SUBJECT_CONFLICT");
  complete("subject", "subjectPolicy");
  if (unit.stayDependent !== policy.stayDependent) return reject("STAY_DEPENDENCY_CONFLICT");
  if (!safetyCandidateMatchesPolicy(capabilityRegistryProjection, unit.capability, unit.purpose, unit.safetyCandidate)) {
    return reject("UNIT_MEANING_UNSUPPORTED");
  }
  if (unit.quantityCandidate) {
    const admission = quantitySubjectAdmission(unit.subject.kind);
    if (!admission.allowed) return { ...reject("CAPABILITY_SUBJECT_CONFLICT", "quantityCandidate"), diagnostics: {
      field: "subject.kind", rule: admission.rule, actualKind: admission.actualKind, allowedKinds: admission.allowedKinds
    } };
  }
  if (unit.quantityCandidate) complete("quantityCandidate", "quantitySubjectAdmission");
  const observeAdmission = (slot, result) => {
    if (result.allowed && result.rule) complete(`slotCandidates.${slot.slotCandidateId}`, result.rule);
    return result;
  };
  const diagnostics = firstSlotAdmissionFailure(unit.slotCandidates, slot => observeAdmission(slot, productSlotAdmission(slot, publicCatalogIdentitySet, understandingTurnInput)))
    || firstSlotAdmissionFailure(unit.slotCandidates, slot => observeAdmission(slot, otherSupportedSlotAdmission(slot, publicCatalogIdentitySet, understandingTurnInput, policy)));
  if (diagnostics) {
    return { ...reject("UNIT_MEANING_UNSUPPORTED", unit.slotCandidates.map((slot, index) => ({field:`slotCandidates[${index}].value`,target:`slotCandidates.${slot.slotCandidateId}`})).find(item => item.field === diagnostics.field)?.target), diagnostics };
  }
  // Successful admission exposes the same item ledger as partial admission.
  // A collection is never one immutable value; each source-owned operation
  // carries its own obligation at its declared semantic position.
  for (const field of ["purpose", "stayDependent", "safetyCandidate"]) {
    add(field, [], []);
  }
  add("evidenceRefs", [], [], { obligationKind: "sourceEvidence" });
  const subjectState = fieldValidationState.find(state => state.field === "subject");
  const subjectProduct = { slot: "product", operation: "SET", value: unit.subject.catalogIdentity };
  if (unit.subject.catalogIdentity !== null
    && productSlotAdmission(subjectProduct, publicCatalogIdentitySet, understandingTurnInput).allowed) {
    subjectState.slotConstraint = subjectProduct;
  }
  const positions = validateSemanticPositions(unit.slotCandidates);
  if (!positions.ok) {
    const failed = new Set(positions.failures.map(item => item.slot));
    const states = fieldValidationState.filter(state => !state.slotCandidateId
      || !failed.has(unit.slotCandidates.find(item => item.slotCandidateId === state.slotCandidateId).slot))
      .map(state => ({ ...state, preservation: "PRESERVE" }));
    for (const failure of positions.failures) {
      states.push({ field: "slotCandidates", semanticPosition: failure.slot, obligationKind: "positionRepair",
        preservation: "REVALIDATE", validationCompleted: ["structure", "evidenceOwnership"],
        validationPending: [failure.rule], dependsOn: [],
        evidenceRefs: unit.slotCandidates.filter(item => item.slot === failure.slot).flatMap(item => item.evidenceRefs) });
    }
    return { ...failure("UNIT_MEANING_UNSUPPORTED"), diagnostics: positions.failures,
      fieldValidationState: deepFreeze(detach(bindSemanticObligations(states, unit, understandingTurnInput))) };
  }
  const obligations = deepFreeze(detach(bindSemanticObligations(fieldValidationState.map(state => ({
    ...state, preservation: "PRESERVE"
  })), unit, understandingTurnInput)));
  const value = deepFreeze(detach(unit));
  INPUT_BY_VALIDATED_SEMANTIC_UNIT.set(value, understandingTurnInput);
  return { ok: true, code: null, errors: [], value, fieldValidationState: obligations };
}

function isValidatedSemanticUnitFor(understandingTurnInput, unit) {
  return Boolean(unit) && typeof unit === "object"
    && INPUT_BY_VALIDATED_SEMANTIC_UNIT.get(unit) === understandingTurnInput;
}

module.exports = {
  quantitySubjectAdmission,
  productSlotAdmission,
  buildPublicCatalogIdentitySet,
  projectCapabilityRegistry,
  isValidatedSemanticUnitFor,
  semanticObligationsPreserved,
  validateSemanticUnit
};
