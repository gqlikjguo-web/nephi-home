"use strict";

const { validateUnderstandingTurnInput } = require("./contracts/understanding-turn-input");
const { validateContextLinkCandidate } = require("./contracts/context-link-candidate");
const { isValidatedSemanticUnitFor } = require("./semantic-unit-validator");
const { buildPublicCatalogIdentityProjection } = require("./turn-input-adapter");

const VALIDATED_CONTEXT_LINKS = new WeakSet();
const INPUT_BY_VALIDATED_CONTEXT_LINK = new WeakMap();
const UNIT_BY_VALIDATED_CONTEXT_LINK = new WeakMap();
const RELATION_EVIDENCE_BY_VALIDATED_CONTEXT_LINK = new WeakMap();

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

function cycleIdentityCompatible(unit, cycle) {
  if (!unit || !cycle) return false;
  if (unit.capability === null) return true;
  return cycle.capability === unit.capability
    && cycle.subject && cycle.subject.kind === unit.subject.kind
    && cycle.subject.catalogIdentity === unit.subject.catalogIdentity;
}

function historyRefKey(reference) {
  return reference && typeof reference === "object"
    ? JSON.stringify([reference.eventId, reference.messageRef])
    : null;
}

function allowedStatuses(relationKind) {
  return relationKind === "SUPPLEMENT" ? new Set(["pending"]) : new Set(["active", "pending", "answered"]);
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
  if (!evidenceOwned(linkCandidate.currentSourceEvidenceRefs, validatedEvidenceRefs)) {
    return failure("CONTEXT_LINK_EVIDENCE_INVALID", ["contextLink.currentSourceEvidenceRefs"]);
  }

  const relationTargets = ["SUPPLEMENT", "MODIFICATION", "TERMINATION"].includes(linkCandidate.relationKind);
  const recentCountsByRef = understandingTurnInput.recentConversation.reduce((counts, event) => {
    const key = historyRefKey(event);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
  if (linkCandidate.referencedHistoryEventRefs.some((reference) => recentCountsByRef.get(historyRefKey(reference)) > 1)) {
    return failure("CONTEXT_TARGET_AMBIGUOUS", ["referencedHistoryEventRefs.duplicate"]);
  }
  const recentByRef = new Map(understandingTurnInput.recentConversation.map((event) => [
    historyRefKey(event), event
  ]));
  const historyEvents = linkCandidate.referencedHistoryEventRefs.map((reference) => recentByRef.get(historyRefKey(reference)));
  if (historyEvents.some((event) => !event)) {
    return failure("CONTEXT_TARGET_UNAVAILABLE", ["referencedHistoryEventRefs"]);
  }
  const boundCycleIds = new Set(historyEvents.flatMap((event) => event.referenceableCycleIds));
  const statuses = allowedStatuses(linkCandidate.relationKind);
  const resolvedTargets = understandingTurnInput.referenceableCycles.filter((cycle) => (
    boundCycleIds.has(cycle.requestCycleId)
    && statuses.has(cycle.status)
    && Number.isFinite(Date.parse(cycle.expiresAt))
    && Date.parse(cycle.expiresAt) > Date.parse(now)
    && cycleIdentityCompatible(unit, cycle)
  ));
  if (relationTargets && resolvedTargets.length === 0) {
    return failure("CONTEXT_TARGET_UNAVAILABLE", ["referencedHistoryEventRefs.target"]);
  }
  if (relationTargets && resolvedTargets.length > 1) {
    return failure("CONTEXT_TARGET_AMBIGUOUS", ["referencedHistoryEventRefs.target"]);
  }
  const resolvedTargetRequestCycleId = relationTargets ? resolvedTargets[0].requestCycleId : null;

  const value = deepFreeze(detach(linkCandidate));
  const compatibleExistingTargetIds = understandingTurnInput.referenceableCycles
    .filter((cycle) => ["active", "pending", "answered"].includes(cycle.status)
      && Date.parse(cycle.expiresAt) > Date.parse(now)
      && cycleIdentityCompatible(unit, cycle))
    .map((cycle) => cycle.requestCycleId);
  const compatiblePendingTargetIds = understandingTurnInput.referenceableCycles
    .filter((cycle) => cycle.status === "pending"
      && Date.parse(cycle.expiresAt) > Date.parse(now)
      && cycleIdentityCompatible(unit, cycle))
    .map((cycle) => cycle.requestCycleId);
  VALIDATED_CONTEXT_LINKS.add(value);
  INPUT_BY_VALIDATED_CONTEXT_LINK.set(value, understandingTurnInput);
  UNIT_BY_VALIDATED_CONTEXT_LINK.set(value, unit);
  RELATION_EVIDENCE_BY_VALIDATED_CONTEXT_LINK.set(value, deepFreeze({
    relationKind: value.relationKind,
    resolvedTargetRequestCycleId,
    compatibleExistingTargetIds,
    compatiblePendingTargetIds
  }));
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

function contextRelationEvidenceForValidatedLink(value, unit) {
  return isValidatedContextLinkFor(value, unit)
    ? RELATION_EVIDENCE_BY_VALIDATED_CONTEXT_LINK.get(value) || null
    : null;
}

module.exports = {
  validateContextLink,
  isValidatedContextLink,
  isValidatedContextLinkFor,
  contextRelationEvidenceForValidatedLink,
  understandingInputForValidatedContextLink
};
