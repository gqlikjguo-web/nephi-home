"use strict";

const { CAPABILITY_REGISTRY, validateCapabilityRegistry } = require("../conversation-engine-v2/capability-registry");

const POLICY_FIELDS = Object.freeze([
  "registryCapabilities",
  "subjectKinds",
  "stayDependent",
  "allowsOtherSupported",
  "purposes",
  "routeKind",
  "requiredGuestFields",
  "temporalRequirementClass",
  "safetyShape",
  "safetyPurposes"
]);

const EXECUTION_POLICY = Object.freeze({
  availability: { routeKind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut"], temporalRequirementClass: "stay", safetyShape: "none" },
  available_dates: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "search_range", safetyShape: "none" },
  price: { routeKind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut"], temporalRequirementClass: "stay", safetyShape: "none" },
  total_price: { routeKind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut"], temporalRequirementClass: "stay", safetyShape: "none" },
  capacity: { routeKind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut", "stay.guests"], temporalRequirementClass: "stay", safetyShape: "none" },
  property_fact: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  amenity: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  policy: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  location: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  booking_operator_request: { routeKind: "HANDOFF", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "operator_action" },
  high_risk: { routeKind: "HANDOFF", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "risk" },
  null: { routeKind: "NO_REPLY", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" }
});

const POLICY_BLUEPRINT = Object.freeze({
  availability: { registryCapabilities: ["availability", "bundle_availability"], subjectKinds: ["property", "room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false, purposes: ["lodging_question"] },
  available_dates: { registryCapabilities: ["available_dates"], subjectKinds: ["property", "room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false, purposes: ["lodging_question"] },
  price: { registryCapabilities: ["price"], subjectKinds: ["room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false, purposes: ["lodging_question"] },
  total_price: { registryCapabilities: ["total_price"], subjectKinds: ["room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false, purposes: ["lodging_question"] },
  capacity: { registryCapabilities: ["capacity"], subjectKinds: ["room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false, purposes: ["lodging_question"] },
  property_fact: { registryCapabilities: ["property_fact"], subjectKinds: ["property", "room", "amenity", "policy", "other_verified"], stayDependent: false, allowsOtherSupported: true, purposes: ["lodging_question"] },
  amenity: { registryCapabilities: ["amenity"], subjectKinds: ["amenity"], stayDependent: false, allowsOtherSupported: false, purposes: ["lodging_question"] },
  policy: { registryCapabilities: ["policy"], subjectKinds: ["policy", "amenity"], stayDependent: false, allowsOtherSupported: false, purposes: ["lodging_question"] },
  location: { registryCapabilities: ["location"], subjectKinds: ["property", "external_place"], stayDependent: false, allowsOtherSupported: false, purposes: ["lodging_question"] },
  booking_operator_request: { registryCapabilities: ["booking_request"], subjectKinds: ["room", "bundle", "other_verified"], stayDependent: false, allowsOtherSupported: true, purposes: ["operator_request", "cancellation"] },
  high_risk: { registryCapabilities: ["high_risk"], subjectKinds: ["other_verified"], stayDependent: false, allowsOtherSupported: true, purposes: ["sensitive_request", "cancellation"] },
  null: { registryCapabilities: [], subjectKinds: [null], stayDependent: false, allowsOtherSupported: false, purposes: ["acknowledgement", "correction", "supplement", "cancellation", "context_update", "social", "off_topic"] }
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function exactKeys(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((key) => fields.includes(key));
}

function buildCapabilityRegistryProjection(registry) {
  if (!validateCapabilityRegistry(registry).ok) return null;
  const entries = [];
  for (const [capability, policy] of Object.entries(POLICY_BLUEPRINT)) {
    if (!policy.registryCapabilities.every((registryCapability) => registry[registryCapability])) return null;
    const executionPolicy = EXECUTION_POLICY[capability];
    entries.push([capability, {
      registryCapabilities: [...policy.registryCapabilities],
      subjectKinds: [...policy.subjectKinds],
      stayDependent: policy.stayDependent,
      allowsOtherSupported: policy.allowsOtherSupported,
      purposes: [...policy.purposes],
      routeKind: executionPolicy.routeKind,
      requiredGuestFields: [...executionPolicy.requiredGuestFields],
      temporalRequirementClass: executionPolicy.temporalRequirementClass,
      safetyShape: executionPolicy.safetyShape,
      safetyPurposes: executionPolicy.safetyShape === "operator_action" ? ["operator_request"]
        : executionPolicy.safetyShape === "risk" ? ["sensitive_request"] : [...policy.purposes]
    }]);
  }
  return deepFreeze(Object.fromEntries(entries));
}

const CAPABILITY_REGISTRY_PROJECTION = buildCapabilityRegistryProjection(CAPABILITY_REGISTRY);

function projectCapabilityRegistry(registry = CAPABILITY_REGISTRY) {
  return registry === CAPABILITY_REGISTRY ? CAPABILITY_REGISTRY_PROJECTION : null;
}

function capabilityPolicyFor(projection, capability) {
  if (projection !== CAPABILITY_REGISTRY_PROJECTION) return null;
  const policy = projection[capability];
  if (!exactKeys(policy, POLICY_FIELDS)
    || !Array.isArray(policy.registryCapabilities)
    || !Array.isArray(policy.subjectKinds) || policy.subjectKinds.length === 0
    || typeof policy.stayDependent !== "boolean"
    || typeof policy.allowsOtherSupported !== "boolean"
    || !Array.isArray(policy.purposes) || policy.purposes.length === 0
    || !["ANSWER", "HANDOFF", "NO_REPLY"].includes(policy.routeKind)
    || !Array.isArray(policy.requiredGuestFields)
    || !["stay", "search_range", "none"].includes(policy.temporalRequirementClass)
    || !["none", "operator_action", "risk"].includes(policy.safetyShape)) {
    return null;
  }
  if (!Array.isArray(policy.safetyPurposes) || policy.safetyPurposes.length === 0
    || policy.safetyPurposes.some((purpose) => !policy.purposes.includes(purpose))) {
    return null;
  }
  return policy;
}

function catalogIdentityRuleFor(projection, capability, subjectKind) {
  const policy = capabilityPolicyFor(projection, capability);
  if (!policy) return null;
  if (capability === "booking_operator_request" && subjectKind === "other_verified") {
    return "NULL_OR_PUBLIC_CATALOG";
  }
  return subjectKind === null || subjectKind === "external_place"
    || ["availability", "available_dates"].includes(capability) && subjectKind === "property"
    ? "NULL"
    : "PUBLIC_CATALOG";
}

function safetyCandidateMatchesPolicy(projection, capability, purpose, safetyCandidate) {
  const policy = capabilityPolicyFor(projection, capability);
  if (!policy || !policy.safetyPurposes.includes(purpose)) return false;
  if (policy.safetyShape === "none") return safetyCandidate === null;
  if (!safetyCandidate || typeof safetyCandidate !== "object") return false;
  if (policy.safetyShape === "operator_action") {
    return safetyCandidate.operatorActionClass !== null && safetyCandidate.riskClass === null;
  }
  return safetyCandidate.operatorActionClass === null && safetyCandidate.riskClass !== null;
}

module.exports = {
  POLICY_BLUEPRINT,
  CAPABILITY_REGISTRY_PROJECTION,
  projectCapabilityRegistry,
  capabilityPolicyFor,
  catalogIdentityRuleFor,
  safetyCandidateMatchesPolicy
};
