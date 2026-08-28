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
const TRUSTED_OPERATOR_SAFETY_POLICIES = new WeakMap();
const C07_AUTHORITY_MARKER = new WeakSet();

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
const FORMAL_HANDOFF_ADMISSIONS = Object.freeze([
  Object.freeze({
    purpose: "operator_request",
    capability: "booking_operator_request",
    disposition: "HANDOFF",
    operatorActionClasses: Object.freeze([
      "booking_mutation",
      "reservation_cancellation",
      "refund_approval",
      "date_change",
      "special_arrangement"
    ]),
    riskClasses: Object.freeze([])
  }),
  Object.freeze({
    purpose: "sensitive_request",
    capability: "high_risk",
    disposition: "HANDOFF",
    operatorActionClasses: Object.freeze([]),
    riskClasses: Object.freeze([
      "access_credential",
      "payment_claim",
      "sensitive_request"
    ])
  })
]);

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

function formalHandoffAdmission(unit) {
  return FORMAL_HANDOFF_ADMISSIONS.find((admission) => (
    admission.purpose === unit.purpose
    && admission.capability === unit.capability
    && admission.disposition === unit.replyCandidate.disposition
  )) || null;
}

function createTrustedOperatorSafetyPolicy({ unit, lifecycleDecision, routingRegistry } = {}) {
  if (!validatedUnitAndLifecycle(unit, lifecycleDecision)) return failure("ROUTING_INPUT_INVALID", ["unitOrLifecycle"]);
  const policy = routePolicyFor(routingRegistry, unit);
  if (!policy || policy.kind !== "HANDOFF" || !["START", "CONTINUE", "MODIFY"].includes(lifecycleDecision.action)) {
    return failure("ROUTE_PURPOSE_CONFLICT", ["routeOrLifecycle"]);
  }
  const admission = formalHandoffAdmission(unit);
  if (!admission) return failure("HANDOFF_WITHOUT_OPERATOR_OR_RISK", ["formalAdmission"]);
  const operatorActionClass = admission.operatorActionClasses.includes(unit.replyCandidate.reasonClass)
    ? unit.replyCandidate.reasonClass
    : null;
  const riskClass = admission.riskClasses.includes(unit.replyCandidate.reasonClass)
    ? unit.replyCandidate.reasonClass
    : null;
  if ((operatorActionClass === null) === (riskClass === null)
    || (operatorActionClass !== null && !OPERATOR_ACTION_CLASSES.has(operatorActionClass))
    || (riskClass !== null && !RISK_CLASSES.has(riskClass))) {
    return failure("HANDOFF_WITHOUT_OPERATOR_OR_RISK", ["formalAdmission.class"]);
  }
  const input = understandingInputForValidatedLifecycleDecision(lifecycleDecision);
  const value = deepFreeze({ unitId: unit.unitId, operatorActionClass, riskClass });
  TRUSTED_OPERATOR_SAFETY_POLICIES.set(value, { unit, input });
  return { ok: true, code: null, errors: [], value };
}

function trustedOperatorSafetyPolicyFor(operatorSafetyPolicy, unit, lifecycleDecision) {
  const trusted = TRUSTED_OPERATOR_SAFETY_POLICIES.get(operatorSafetyPolicy);
  if (!trusted || trusted.unit !== unit
    || trusted.input !== understandingInputForValidatedLifecycleDecision(lifecycleDecision)
    || !exactKeys(operatorSafetyPolicy, ["unitId", "operatorActionClass", "riskClass"])
    || operatorSafetyPolicy.unitId !== unit.unitId
    || (operatorSafetyPolicy.operatorActionClass === null) === (operatorSafetyPolicy.riskClass === null)) return null;
  return operatorSafetyPolicy;
}

function routeFromValidatedInputs({ unit, lifecycleDecision, routingRegistry, readiness, operatorSafetyPolicy }) {
  const policy = routePolicyFor(routingRegistry, unit);
  const validReadiness = readinessFor(readiness, unit);
  if (!policy || !validReadiness) return failure("ROUTING_READINESS_INVALID", ["readiness"]);
  if (unit.purpose === "cancellation") {
    if (lifecycleDecision.action !== "END" || unit.replyCandidate.disposition !== "NO_REPLY"
      || unit.capability !== null || unit.subject.kind !== null || unit.subject.catalogIdentity !== null) {
      return failure("ROUTE_PURPOSE_CONFLICT", ["cancellation.lifecycleOrDisposition"]);
    }
    return { disposition: "NO_REPLY", reasonClass: "no_executable_need", requiresCanonicalExecution: false, missingGuestFields: [], operatorActionClass: null, riskClass: null };
  }
  if (policy.kind === "NO_REPLY") {
    if (unit.replyCandidate.disposition !== "NO_REPLY") return failure("ROUTE_PURPOSE_CONFLICT", ["replyCandidate"]);
    return { disposition: "NO_REPLY", reasonClass: "no_executable_need", requiresCanonicalExecution: false, missingGuestFields: [], operatorActionClass: null, riskClass: null };
  }
  if (policy.kind === "HANDOFF") {
    if (!["START", "CONTINUE", "MODIFY"].includes(lifecycleDecision.action)) {
      return failure("ROUTE_PURPOSE_CONFLICT", ["handoff.lifecycle"]);
    }
    if (unit.replyCandidate.disposition !== "HANDOFF") return failure("ROUTE_PURPOSE_CONFLICT", ["replyCandidate"]);
    const policyProjection = trustedOperatorSafetyPolicyFor(operatorSafetyPolicy, unit, lifecycleDecision);
    if (!policyProjection) return failure("HANDOFF_WITHOUT_OPERATOR_OR_RISK", ["operatorSafetyPolicy"]);
    return {
      disposition: "HANDOFF",
      reasonClass: policyProjection.operatorActionClass !== null ? "operator_action_required" : "risk_policy_required",
      requiresCanonicalExecution: false,
      missingGuestFields: [],
      operatorActionClass: policyProjection.operatorActionClass,
      riskClass: policyProjection.riskClass
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

function createUnitRoutingDecision({ unit, lifecycleDecision, routingRegistry, readiness, operatorSafetyPolicy = null } = {}) {
  if (!validatedUnitAndLifecycle(unit, lifecycleDecision)) return failure("ROUTING_INPUT_INVALID", ["unitOrLifecycle"]);
  const routed = routeFromValidatedInputs({ unit, lifecycleDecision, routingRegistry, readiness, operatorSafetyPolicy });
  if (routed.ok === false) return routed;
  const decision = { unitId: unit.unitId, ...routed };
  const validation = validateUnitRoutingDecision(decision);
  if (!validation.ok) return validation;
  const value = deepFreeze(detach(decision));
  C07_AUTHORITY_MARKER.add(value);
  return { ok: true, code: null, errors: [], value };
}

function isTrustedUnitRoutingDecision(value) {
  return Boolean(value) && typeof value === "object"
    && C07_AUTHORITY_MARKER.has(value)
    && validateUnitRoutingDecision(value).ok;
}

module.exports = {
  createUnitReplyRoutingRegistry,
  createUnitReadiness,
  createTrustedOperatorSafetyPolicy,
  createUnitRoutingDecision,
  isTrustedUnitRoutingDecision
};
