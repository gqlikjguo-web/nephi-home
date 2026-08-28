"use strict";

const {
  CAPABILITY_REGISTRY_PROJECTION,
  capabilityPolicyFor
} = require("./capability-subject-policy");
const { isValidatedSemanticUnitFor } = require("./semantic-unit-validator");
const {
  isValidatedLifecycleDecision,
  understandingInputForValidatedLifecycleDecision
} = require("./lifecycle-manager");
const {
  OPERATOR_ACTION_CLASSES,
  RISK_CLASSES,
  validateUnitRoutingDecision
} = require("./contracts/unit-routing-decision");

const ROUTING_REGISTRIES = new WeakSet();
const READINESS_BY_UNIT = new WeakMap();
const HANDOFF_BASIS_BY_UNIT = new WeakMap();
const ROUTING_DECISIONS = new WeakSet();

const ROUTING_BLUEPRINT = Object.freeze({
  availability: { kind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut"] },
  available_dates: { kind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut"] },
  price: { kind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut"] },
  total_price: { kind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut"] },
  capacity: { kind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut", "stay.guests"] },
  property_fact: { kind: "ANSWER", requiredGuestFields: [] },
  amenity: { kind: "ANSWER", requiredGuestFields: [] },
  policy: { kind: "ANSWER", requiredGuestFields: [] },
  location: { kind: "ANSWER", requiredGuestFields: [] },
  booking_operator_request: { kind: "HANDOFF", requiredGuestFields: [] },
  high_risk: { kind: "HANDOFF", requiredGuestFields: [] },
  null: { kind: "NO_REPLY", requiredGuestFields: [] }
});

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

function exactKeys(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((key) => fields.includes(key));
}

function validatedUnitAndLifecycle(unit, lifecycleDecision) {
  const input = understandingInputForValidatedLifecycleDecision(lifecycleDecision);
  return Boolean(input)
    && isValidatedLifecycleDecision(lifecycleDecision)
    && isValidatedSemanticUnitFor(input, unit)
    && lifecycleDecision.unitId === unit.unitId;
}

function routePolicyFor(routingRegistry, unit) {
  if (!ROUTING_REGISTRIES.has(routingRegistry)) return null;
  const policy = routingRegistry[unit.capability];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return null;
  return policy;
}

function createUnitReplyRoutingRegistry(capabilityRegistryProjection) {
  if (capabilityRegistryProjection !== CAPABILITY_REGISTRY_PROJECTION) return null;
  const entries = [];
  for (const [capability, policy] of Object.entries(ROUTING_BLUEPRINT)) {
    if (!capabilityPolicyFor(capabilityRegistryProjection, capability === "null" ? null : capability)) return null;
    entries.push([capability === "null" ? null : capability, {
      kind: policy.kind,
      requiredGuestFields: [...policy.requiredGuestFields]
    }]);
  }
  const value = deepFreeze(Object.fromEntries(entries));
  ROUTING_REGISTRIES.add(value);
  return value;
}

function guestFieldPresent(unit, field) {
  if (field === "stay.checkIn") return Boolean(unit.temporalCandidate && unit.temporalCandidate.checkInCandidate);
  if (field === "stay.checkOut") return Boolean(unit.temporalCandidate && unit.temporalCandidate.checkOutCandidate);
  if (field === "stay.guests") return unit.slotCandidates.some((slot) => (
    slot.slot === "guest_count" && slot.operation === "SET" && Number.isInteger(slot.value) && slot.value > 0
  ));
  return false;
}

function createUnitReadiness({ unit, lifecycleDecision, routingRegistry } = {}) {
  if (!validatedUnitAndLifecycle(unit, lifecycleDecision)) return failure("ROUTING_INPUT_INVALID", ["unitOrLifecycle"]);
  const policy = routePolicyFor(routingRegistry, unit);
  if (!policy) return failure("ROUTE_PURPOSE_CONFLICT", ["registry"]);
  const missingGuestFields = policy.requiredGuestFields.filter((field) => !guestFieldPresent(unit, field));
  const value = deepFreeze({
    unitId: unit.unitId,
    status: missingGuestFields.length ? "MISSING_GUEST_FIELDS" : "READY",
    missingGuestFields
  });
  READINESS_BY_UNIT.set(value, unit);
  return { ok: true, code: null, errors: [], value };
}

function readinessFor(readiness, unit) {
  if (!READINESS_BY_UNIT.has(readiness) || READINESS_BY_UNIT.get(readiness) !== unit
    || !exactKeys(readiness, ["unitId", "status", "missingGuestFields"])
    || readiness.unitId !== unit.unitId
    || !["READY", "MISSING_GUEST_FIELDS"].includes(readiness.status)
    || !Array.isArray(readiness.missingGuestFields)
    || readiness.missingGuestFields.some((field) => typeof field !== "string" || !field)
    || (readiness.status === "READY") !== (readiness.missingGuestFields.length === 0)) {
    return null;
  }
  return readiness;
}

function createHandoffBasis({ unit, operatorActionClass = null, riskClass = null } = {}) {
  if (!unit || typeof unit !== "object" || !OPERATOR_ACTION_CLASSES.has(operatorActionClass) && operatorActionClass !== null
    || !RISK_CLASSES.has(riskClass) && riskClass !== null) {
    return failure("HANDOFF_WITHOUT_OPERATOR_OR_RISK", ["basis"]);
  }
  if ((operatorActionClass === null) === (riskClass === null)) {
    return failure("HANDOFF_WITHOUT_OPERATOR_OR_RISK", ["basis.exclusive"]);
  }
  if (operatorActionClass !== null && !(
    ["operator_request", "cancellation"].includes(unit.purpose)
    && unit.capability === "booking_operator_request"
  )) {
    return failure("HANDOFF_WITHOUT_OPERATOR_OR_RISK", ["operatorActionClass"]);
  }
  if (riskClass !== null && !(
    ["sensitive_request", "cancellation"].includes(unit.purpose)
    && unit.capability === "high_risk"
  )) {
    return failure("HANDOFF_WITHOUT_OPERATOR_OR_RISK", ["riskClass"]);
  }
  const value = deepFreeze({ unitId: unit.unitId, operatorActionClass, riskClass });
  HANDOFF_BASIS_BY_UNIT.set(value, unit);
  return { ok: true, code: null, errors: [], value };
}

function handoffBasisFor(handoffBasis, unit) {
  if (!HANDOFF_BASIS_BY_UNIT.has(handoffBasis) || HANDOFF_BASIS_BY_UNIT.get(handoffBasis) !== unit
    || !exactKeys(handoffBasis, ["unitId", "operatorActionClass", "riskClass"])
    || handoffBasis.unitId !== unit.unitId
    || (handoffBasis.operatorActionClass === null) === (handoffBasis.riskClass === null)) return null;
  return handoffBasis;
}

function routeFromValidatedInputs({ unit, routingRegistry, readiness, handoffBasis }) {
  const policy = routePolicyFor(routingRegistry, unit);
  const validReadiness = readinessFor(readiness, unit);
  if (!policy || !validReadiness) return failure("ROUTING_READINESS_INVALID", ["readiness"]);
  if (policy.kind === "NO_REPLY") {
    if (unit.replyCandidate.disposition !== "NO_REPLY") return failure("ROUTE_PURPOSE_CONFLICT", ["replyCandidate"]);
    return { disposition: "NO_REPLY", reasonClass: "no_executable_need", requiresCanonicalExecution: false, missingGuestFields: [], operatorActionClass: null, riskClass: null };
  }
  if (policy.kind === "HANDOFF") {
    if (unit.replyCandidate.disposition !== "HANDOFF") return failure("ROUTE_PURPOSE_CONFLICT", ["replyCandidate"]);
    const basis = handoffBasisFor(handoffBasis, unit);
    if (!basis) return failure("HANDOFF_WITHOUT_OPERATOR_OR_RISK", ["handoffBasis"]);
    return {
      disposition: "HANDOFF",
      reasonClass: basis.operatorActionClass !== null ? "operator_action_required" : "risk_policy_required",
      requiresCanonicalExecution: false,
      missingGuestFields: [],
      operatorActionClass: basis.operatorActionClass,
      riskClass: basis.riskClass
    };
  }
  if (unit.purpose !== "lodging_question") return failure("ROUTE_PURPOSE_CONFLICT", ["purpose"]);
  if (validReadiness.status === "MISSING_GUEST_FIELDS") {
    if (unit.replyCandidate.disposition !== "CLARIFY") return failure("ROUTE_PURPOSE_CONFLICT", ["replyCandidate"]);
    return { disposition: "CLARIFY", reasonClass: "missing_guest_fields", requiresCanonicalExecution: false, missingGuestFields: [...validReadiness.missingGuestFields], operatorActionClass: null, riskClass: null };
  }
  if (unit.replyCandidate.disposition !== "ANSWER") return failure("ROUTE_PURPOSE_CONFLICT", ["replyCandidate"]);
  return { disposition: "ANSWER", reasonClass: "executable_lodging_need", requiresCanonicalExecution: true, missingGuestFields: [], operatorActionClass: null, riskClass: null };
}

function createUnitRoutingDecision({ unit, lifecycleDecision, routingRegistry, readiness, handoffBasis = null } = {}) {
  if (!validatedUnitAndLifecycle(unit, lifecycleDecision)) return failure("ROUTING_INPUT_INVALID", ["unitOrLifecycle"]);
  const routed = routeFromValidatedInputs({ unit, routingRegistry, readiness, handoffBasis });
  if (routed.ok === false) return routed;
  const decision = { unitId: unit.unitId, ...routed };
  const validation = validateUnitRoutingDecision(decision);
  if (!validation.ok) return validation;
  const value = deepFreeze(detach(decision));
  ROUTING_DECISIONS.add(value);
  return { ok: true, code: null, errors: [], value };
}

function isUnitRoutingDecision(value) {
  return Boolean(value) && typeof value === "object" && ROUTING_DECISIONS.has(value);
}

module.exports = {
  createUnitReplyRoutingRegistry,
  createUnitReadiness,
  createHandoffBasis,
  createUnitRoutingDecision,
  isUnitRoutingDecision
};
