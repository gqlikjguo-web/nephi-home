"use strict";

const { validateUnderstandingTurnInput } = require("./contracts/understanding-turn-input");
const { validateContextLinkCandidate } = require("./contracts/context-link-candidate");
const { isValidatedSemanticUnitFor } = require("./semantic-unit-validator");
const { buildPublicCatalogIdentityProjection } = require("./turn-input-adapter");

const VALIDATED_CONTEXT_LINKS = new WeakSet();
const INPUT_BY_VALIDATED_CONTEXT_LINK = new WeakMap();
const UNIT_BY_VALIDATED_CONTEXT_LINK = new WeakMap();

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function detach(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(detach);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, detach(item)]));
}

function failure(code, errors = []) {
  return { ok: false, code, errors };
}

function evidenceKey(reference) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return null;
  return JSON.stringify([
    reference.eventId,
    reference.messageRef,
    reference.startOffset,
    reference.endOffset,
    reference.quote
  ]);
}

function evidenceOwned(refs, validatedEvidenceRefs) {
  if (!Array.isArray(refs) || refs.length === 0 || !Array.isArray(validatedEvidenceRefs)) return false;
  const owned = new Set(validatedEvidenceRefs.map(evidenceKey).filter(Boolean));
  return refs.every((reference) => {
    const key = evidenceKey(reference);
    return key !== null && owned.has(key);
  });
}

function validNow(now) {
  return typeof now === "string" && Number.isFinite(Date.parse(now));
}

function validateContextLink({
  unit,
  linkCandidate,
  understandingTurnInput,
  validatedEvidenceRefs,
  now
} = {}) {
  const wire = validateContextLinkCandidate(linkCandidate);
  if (!wire.ok) return failure(wire.code, wire.errors);
  if (!understandingTurnInput || typeof understandingTurnInput !== "object"
    || !Array.isArray(understandingTurnInput.referenceableCycles)
    || !validNow(now)) {
    return failure("CONTEXT_TARGET_SCOPE_CONFLICT", ["referenceableSnapshot"]);
  }
  if (!buildPublicCatalogIdentityProjection(understandingTurnInput)) {
    return failure("CONTEXT_TARGET_SCOPE_CONFLICT", ["referenceableSnapshot.provenance"]);
  }
  const inputValidation = validateUnderstandingTurnInput(understandingTurnInput);
  if (!inputValidation.ok) {
    return failure(
      inputValidation.code === "PROPERTY_SCOPE_INVALID"
        ? "CONTEXT_TARGET_SCOPE_CONFLICT"
        : "CONTEXT_TARGET_UNAVAILABLE",
      inputValidation.errors
    );
  }
  if (!unit || typeof unit !== "object"
    || !isValidatedSemanticUnitFor(understandingTurnInput, unit)
    || unit.unitId !== linkCandidate.unitId
    || unit.contextLinkCandidateId !== linkCandidate.contextLinkCandidateId) {
    return failure(
      unit && typeof unit === "object" && !isValidatedSemanticUnitFor(understandingTurnInput, unit)
        ? "CONTEXT_TARGET_SCOPE_CONFLICT"
        : "UNDERSTANDING_SCHEMA_INVALID",
      ["contextLink.unitOwnership"]
    );
  }
  if (!evidenceOwned(linkCandidate.evidenceRefs, validatedEvidenceRefs)) {
    return failure("CONTEXT_LINK_EVIDENCE_INVALID", ["contextLink.evidenceRefs"]);
  }

  const targetId = linkCandidate.targetRequestCycleId;
  if (targetId !== null) {
    const matching = understandingTurnInput.referenceableCycles.filter(
      (cycle) => cycle && cycle.requestCycleId === targetId
    );
    if (matching.length > 1) {
      return failure("CONTEXT_TARGET_AMBIGUOUS", ["targetRequestCycleId"]);
    }
    if (matching.length === 0) {
      return failure("CONTEXT_TARGET_UNAVAILABLE", ["targetRequestCycleId"]);
    }
    const target = matching[0];
    if (!["active", "pending", "answered"].includes(target.status)
      || !Number.isFinite(Date.parse(target.expiresAt))
      || Date.parse(target.expiresAt) <= Date.parse(now)) {
      return failure("CONTEXT_TARGET_UNAVAILABLE", ["targetRequestCycleId"]);
    }
  }

  const value = deepFreeze(detach(linkCandidate));
  VALIDATED_CONTEXT_LINKS.add(value);
  INPUT_BY_VALIDATED_CONTEXT_LINK.set(value, understandingTurnInput);
  UNIT_BY_VALIDATED_CONTEXT_LINK.set(value, unit);
  return { ok: true, code: null, errors: [], value };
}

function isValidatedContextLink(value) {
  return Boolean(value) && typeof value === "object" && VALIDATED_CONTEXT_LINKS.has(value);
}

function understandingInputForValidatedContextLink(value) {
  return isValidatedContextLink(value) ? INPUT_BY_VALIDATED_CONTEXT_LINK.get(value) || null : null;
}

function isValidatedContextLinkFor(value, unit) {
  return isValidatedContextLink(value)
    && Boolean(unit)
    && UNIT_BY_VALIDATED_CONTEXT_LINK.get(value) === unit;
}

module.exports = {
  validateContextLink,
  isValidatedContextLink,
  isValidatedContextLinkFor,
  understandingInputForValidatedContextLink
};
