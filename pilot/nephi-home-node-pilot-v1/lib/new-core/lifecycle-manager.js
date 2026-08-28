"use strict";

const { validateSourceEvidence } = require("./contracts/source-evidence");
const {
  isValidatedContextLinkFor,
  understandingInputForValidatedContextLink
} = require("./context-link-validator");

const LIFECYCLE_FIELDS = Object.freeze([
  "lifecycleDecisionId",
  "unitId",
  "action",
  "targetRequestCycleId",
  "verifiedSlotOperations",
  "status"
]);
const VERIFIED_SLOT_OPERATION_FIELDS = Object.freeze([
  "slotCandidateId",
  "slot",
  "operation",
  "value",
  "evidenceRefs",
  "persistedField",
  "persistedProductType"
]);
const ACTIONS = new Set(["START", "CONTINUE", "MODIFY", "END", "NONE"]);
const STATUSES = new Set(["VALIDATED"]);
const PERSISTED_FIELDS = new Set(["guestCount", "lodgingProduct", null]);
const PERSISTED_PRODUCT_TYPES = new Set(["room_type", "bundle", null]);
const VALIDATED_LIFECYCLE_DECISIONS = new WeakSet();
const INPUT_BY_VALIDATED_LIFECYCLE_DECISION = new WeakMap();

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

function exactKeys(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((key) => fields.includes(key));
}

function boundedText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function failure(code, errors = []) {
  return { ok: false, code, errors };
}

function productKind(input, catalogIdentity) {
  const subject = input && Array.isArray(input.publicSubjectCatalog)
    ? input.publicSubjectCatalog.find((item) => item.catalogIdentity === catalogIdentity)
    : null;
  if (!subject) return null;
  if (subject.kind === "room") return "room_type";
  if (subject.kind === "bundle") return "bundle";
  return null;
}

function verifiedOperation(slot, input) {
  let persistedField = null;
  let persistedProductType = null;
  if (slot.slot === "guest_count") persistedField = "guestCount";
  if (slot.slot === "product") {
    if (slot.operation === "CLEAR") {
      persistedField = "lodgingProduct";
    } else {
      persistedProductType = productKind(input, slot.value);
      if (persistedProductType) persistedField = "lodgingProduct";
    }
  }
  return {
    slotCandidateId: slot.slotCandidateId,
    slot: slot.slot,
    operation: slot.operation,
    value: detach(slot.value),
    evidenceRefs: detach(slot.evidenceRefs),
    persistedField,
    persistedProductType
  };
}

function validateVerifiedSlotOperation(value, errors, prefix) {
  if (!exactKeys(value, VERIFIED_SLOT_OPERATION_FIELDS)) errors.push(`${prefix}.keys`);
  if (!boundedText(value && value.slotCandidateId)) errors.push(`${prefix}.slotCandidateId`);
  if (!new Set(["guest_count", "product", "transport", "other_supported"]).has(value && value.slot)) {
    errors.push(`${prefix}.slot`);
  }
  if (!new Set(["SET", "CLEAR"]).has(value && value.operation)) errors.push(`${prefix}.operation`);
  const primitiveValue = value && (typeof value.value === "string"
    || typeof value.value === "boolean"
    || Number.isInteger(value.value)
    || value.value === null);
  if (!primitiveValue) errors.push(`${prefix}.value`);
  if (value && value.operation === "CLEAR" && value.value !== null) errors.push(`${prefix}.clearValue`);
  if (!PERSISTED_FIELDS.has(value && value.persistedField)) errors.push(`${prefix}.persistedField`);
  if (!PERSISTED_PRODUCT_TYPES.has(value && value.persistedProductType)) errors.push(`${prefix}.persistedProductType`);
  if (value && value.slot === "guest_count" && value.persistedField !== "guestCount") {
    errors.push(`${prefix}.guestCountMapping`);
  }
  if (value && value.slot === "product"
    && !(
      value.persistedField === "lodgingProduct"
      || (value.operation === "SET"
        && value.persistedField === null
        && value.persistedProductType === null
        && boundedText(value.value))
    )) {
    errors.push(`${prefix}.productMapping`);
  }
  if (value && ["transport", "other_supported"].includes(value.slot)
    && (value.persistedField !== null || value.persistedProductType !== null)) {
    errors.push(`${prefix}.turnContextMapping`);
  }
  if (value && value.persistedField === "guestCount") {
    if (value.persistedProductType !== null || value.slot !== "guest_count") errors.push(`${prefix}.guestCountMapping`);
    if (value.operation === "SET" && (!Number.isInteger(value.value) || value.value < 1)) errors.push(`${prefix}.guestCountValue`);
    if (value.operation === "CLEAR" && value.value !== null) errors.push(`${prefix}.guestCountClear`);
  }
  if (value && value.persistedField === "lodgingProduct") {
    if (value.slot !== "product") errors.push(`${prefix}.productMapping`);
    if (value.operation === "SET" && !boundedText(value.value)) errors.push(`${prefix}.productIdentity`);
    if ((value.operation === "SET" && !PERSISTED_PRODUCT_TYPES.has(value.persistedProductType))
      || (value.operation === "SET" && value.persistedProductType === null)
      || (value.operation === "CLEAR" && (value.value !== null || value.persistedProductType !== null))) {
      errors.push(`${prefix}.productValue`);
    }
  }
  if (value && value.persistedField === null && value.persistedProductType !== null) {
    errors.push(`${prefix}.nonPersistedMapping`);
  }
  const evidence = validateSourceEvidence(value && value.evidenceRefs);
  if (!evidence.ok) errors.push(...evidence.errors.map((error) => `${prefix}.${error}`));
}

function validateLifecycleDecision(value, { unitIds = null } = {}) {
  const errors = [];
  if (!exactKeys(value, LIFECYCLE_FIELDS)) errors.push("keys");
  if (!boundedText(value && value.lifecycleDecisionId)) errors.push("lifecycleDecisionId");
  if (!boundedText(value && value.unitId)) errors.push("unitId");
  if (!ACTIONS.has(value && value.action)) errors.push("action");
  if (value && value.targetRequestCycleId !== null && !boundedText(value.targetRequestCycleId)) {
    errors.push("targetRequestCycleId");
  }
  if (!STATUSES.has(value && value.status)) errors.push("status");
  if (!Array.isArray(value && value.verifiedSlotOperations)) {
    errors.push("verifiedSlotOperations");
  } else {
    const slotIds = new Set();
    value.verifiedSlotOperations.forEach((operation, index) => {
      validateVerifiedSlotOperation(operation, errors, `verifiedSlotOperations.${index}`);
      if (slotIds.has(operation && operation.slotCandidateId)) errors.push("verifiedSlotOperations.duplicate");
      slotIds.add(operation && operation.slotCandidateId);
    });
  }
  if (value && ["CONTINUE", "MODIFY", "END"].includes(value.action)
    && value.targetRequestCycleId === null) errors.push("target.required");
  if (value && ["START", "NONE"].includes(value.action)
    && value.targetRequestCycleId !== null) errors.push("target.forbidden");
  if (value && ["END", "NONE"].includes(value.action)
    && Array.isArray(value.verifiedSlotOperations) && value.verifiedSlotOperations.length) {
    errors.push("slots.forbidden");
  }
  if (Array.isArray(unitIds) && !unitIds.includes(value && value.unitId)) errors.push("unit.unknown");
  return errors.length
    ? failure("LIFECYCLE_TRANSITION_INVALID", [...new Set(errors)])
    : { ok: true, code: null, errors: [], value };
}

function validateLifecycleDecisions(values, { unitIds = null } = {}) {
  if (!Array.isArray(values)) return failure("LIFECYCLE_TRANSITION_INVALID", ["lifecycleDecisions"]);
  const errors = [];
  const lifecycleIds = new Set();
  const ownedUnits = new Set();
  values.forEach((value, index) => {
    const validation = validateLifecycleDecision(value, { unitIds });
    if (!validation.ok) errors.push(...validation.errors.map((error) => `${index}.${error}`));
    if (lifecycleIds.has(value && value.lifecycleDecisionId)) errors.push("lifecycleDecisionId.duplicate");
    if (ownedUnits.has(value && value.unitId)) errors.push("unitId.duplicate");
    lifecycleIds.add(value && value.lifecycleDecisionId);
    ownedUnits.add(value && value.unitId);
  });
  return errors.length
    ? failure("LIFECYCLE_TRANSITION_INVALID", [...new Set(errors)])
    : { ok: true, code: null, errors: [], value: values };
}

function createLifecycleDecision({ lifecycleDecisionId, unit, validatedContextLink } = {}) {
  if (!isValidatedContextLinkFor(validatedContextLink, unit)) {
    return failure("LIFECYCLE_TRANSITION_INVALID", ["validatedContextLink"]);
  }
  const action = validatedContextLink.actionCandidate;
  const target = validatedContextLink.targetRequestCycleId;
  if (["CONTINUE", "MODIFY", "END"].includes(action) && target === null) {
    return failure("LIFECYCLE_TARGET_REQUIRED", ["targetRequestCycleId"]);
  }
  if (["START", "NONE"].includes(action) && target !== null) {
    return failure("LIFECYCLE_START_TARGET_FORBIDDEN", ["targetRequestCycleId"]);
  }
  if (["END", "NONE"].includes(action) && unit.slotCandidates.length) {
    return failure("LIFECYCLE_TRANSITION_INVALID", ["verifiedSlotOperations"]);
  }
  const input = understandingInputForValidatedContextLink(validatedContextLink);
  const operations = unit.slotCandidates.map((item) => verifiedOperation(item, input));
  const decision = {
    lifecycleDecisionId,
    unitId: unit.unitId,
    action,
    targetRequestCycleId: target,
    verifiedSlotOperations: operations,
    status: "VALIDATED"
  };
  const validation = validateLifecycleDecision(decision, { unitIds: [unit.unitId] });
  if (!validation.ok) return validation;
  const value = deepFreeze(detach(decision));
  VALIDATED_LIFECYCLE_DECISIONS.add(value);
  INPUT_BY_VALIDATED_LIFECYCLE_DECISION.set(value, input);
  return { ok: true, code: null, errors: [], value };
}

function isValidatedLifecycleDecision(value) {
  return Boolean(value) && typeof value === "object" && VALIDATED_LIFECYCLE_DECISIONS.has(value);
}

function understandingInputForValidatedLifecycleDecision(value) {
  return isValidatedLifecycleDecision(value)
    ? INPUT_BY_VALIDATED_LIFECYCLE_DECISION.get(value) || null
    : null;
}

module.exports = {
  LIFECYCLE_FIELDS,
  VERIFIED_SLOT_OPERATION_FIELDS,
  ACTIONS,
  STATUSES,
  createLifecycleDecision,
  validateLifecycleDecision,
  validateLifecycleDecisions,
  isValidatedLifecycleDecision,
  understandingInputForValidatedLifecycleDecision
};
