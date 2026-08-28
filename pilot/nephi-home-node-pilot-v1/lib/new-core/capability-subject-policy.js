"use strict";

const { CAPABILITY_REGISTRY, validateCapabilityRegistry } = require("../conversation-engine-v2/capability-registry");

const POLICY_FIELDS = Object.freeze([
  "registryCapabilities",
  "subjectKinds",
  "stayDependent",
  "allowsOtherSupported"
]);

const POLICY_BLUEPRINT = Object.freeze({
  availability: { registryCapabilities: ["availability", "bundle_availability"], subjectKinds: ["room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false },
  available_dates: { registryCapabilities: ["available_dates"], subjectKinds: ["room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false },
  price: { registryCapabilities: ["price"], subjectKinds: ["room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false },
  total_price: { registryCapabilities: ["total_price"], subjectKinds: ["room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false },
  capacity: { registryCapabilities: ["capacity"], subjectKinds: ["room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false },
  property_fact: { registryCapabilities: ["property_fact"], subjectKinds: ["property", "room", "amenity", "policy", "other_verified"], stayDependent: false, allowsOtherSupported: true },
  amenity: { registryCapabilities: ["amenity"], subjectKinds: ["amenity"], stayDependent: false, allowsOtherSupported: false },
  policy: { registryCapabilities: ["policy"], subjectKinds: ["policy", "amenity"], stayDependent: false, allowsOtherSupported: false },
  location: { registryCapabilities: ["location"], subjectKinds: ["property", "external_place"], stayDependent: false, allowsOtherSupported: false },
  booking_operator_request: { registryCapabilities: ["booking_request"], subjectKinds: ["room", "bundle", "other_verified"], stayDependent: false, allowsOtherSupported: true },
  high_risk: { registryCapabilities: ["high_risk"], subjectKinds: ["other_verified"], stayDependent: false, allowsOtherSupported: true }
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

function projectCapabilityRegistry(registry = CAPABILITY_REGISTRY) {
  if (!validateCapabilityRegistry(registry).ok) return null;
  const entries = [];
  for (const [capability, policy] of Object.entries(POLICY_BLUEPRINT)) {
    if (!policy.registryCapabilities.every((registryCapability) => registry[registryCapability])) return null;
    entries.push([capability, {
      registryCapabilities: [...policy.registryCapabilities],
      subjectKinds: [...policy.subjectKinds],
      stayDependent: policy.stayDependent,
      allowsOtherSupported: policy.allowsOtherSupported
    }]);
  }
  return deepFreeze(Object.fromEntries(entries));
}

function capabilityPolicyFor(projection, capability) {
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) return null;
  const policy = projection[capability];
  if (!exactKeys(policy, POLICY_FIELDS)
    || !Array.isArray(policy.registryCapabilities) || policy.registryCapabilities.length === 0
    || !Array.isArray(policy.subjectKinds) || policy.subjectKinds.length === 0
    || typeof policy.stayDependent !== "boolean"
    || typeof policy.allowsOtherSupported !== "boolean") {
    return null;
  }
  return policy;
}

module.exports = {
  POLICY_BLUEPRINT,
  projectCapabilityRegistry,
  capabilityPolicyFor
};
