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
  "safetyPurposes",
  "understandingDescription"
]);

const UNDERSTANDING_DESCRIPTIONS = Object.freeze({
  lodging_room_composition: "Use lodging_room_composition for the physical rooms making up a property, room type, bundle/package or identified room set, including the actual number of physical rooms. This is independent of stay dates, people capacity and requested booking quantity. Select the formal subject; property-wide scope has null catalog identity. Never infer members or counts and never provide facts.",
  availability: "Use availability for a specific supplied stay date or date range when the guest asks whether lodging, a room, a room set, or a bundle is available then. Also use availability with lodging_question for preliminary intent to arrange lodging before the necessary stay conditions have been supplied. Preserve missing conditions as missing; this does not execute or promise a reservation. A search for which dates are available uses available_dates instead. This is a language-derived capability candidate only; never answer facts.",
  available_dates: "Use available_dates only to search for which stay dates are available when the guest asks which, nearest, or upcoming dates can be booked rather than asking about a specific supplied stay date. This is a language-derived capability candidate only; never answer facts.",
  price: "Use price for a lodging price or rate question. Use the property subject with no catalog identity when no specific room, room set, or bundle is requested. This is a language-derived capability candidate only; never answer price facts.",
  total_price: "Use total_price for a lodging total-cost question. Use the property subject with no catalog identity when no specific room, room set, or bundle is requested. This is a language-derived capability candidate only; never answer price facts.",
  capacity: "Use capacity only for date-and-guest-dependent lodging feasibility: whether the requested lodging arrangement can accommodate the supplied party for a stay. Do not use it for the fixed maximum occupancy of one explicitly identified room or bundle. This is a language-derived capability candidate only; never answer capacity or availability facts.",
  lodging_product_capacity: "Use lodging_product_capacity only for the fixed maximum occupancy of one explicitly identified room or bundle, independent of stay dates or the guest's proposed party. Do not use it for lodging selection, suitability, or date-and-guest-dependent feasibility. This is a language-derived capability candidate only; never answer the capacity number or any other fact.",
  amenity_list: "Use amenity_list for a request for the collection of amenities or facilities applicable to a property, room, or bundle. Use amenity for one specific catalog amenity. This is a language-derived capability candidate only; never answer facts.",
  policy: "Use policy for an operator policy or permission question. Select the matching policy identity when it is in the formal catalog. If the requested policy has no matching registered catalog subject, use subject kind property with null catalogIdentity so the formal Resolver can report unconfirmed policy; never invent an identity or infer permission. A question about whether a service is permitted is not itself a request for an operator to perform it. Use the public catalog identity self_check_in_out_instructions for self-check-in or self-check-out procedures, unmanned reception, access handoff, or how guests arrive and leave. Keep check-in time, check-out time, and early-arrival policy on their distinct public catalog identities. A request for an operator to change a reservation or its stay dates is not a policy question.",
  booking_operator_request: "Use booking_operator_request when the guest asks an operator to execute a reservation transaction: explicitly commit a reservation, or change, cancel, refund, or otherwise act on a reservation. Preliminary interest in arranging lodging without a transaction execution request is an availability lodging_question even when necessary stay conditions are missing. A requested reservation date change is operator action, not a question about the property's check-in or check-out time policy."
});

const EXECUTION_POLICY = Object.freeze({
  lodging_room_composition: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  availability: { routeKind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut"], temporalRequirementClass: "stay", safetyShape: "none" },
  available_dates: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "search_range", safetyShape: "none" },
  price: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  total_price: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  capacity: { routeKind: "ANSWER", requiredGuestFields: ["stay.checkIn", "stay.checkOut", "stay.guests"], temporalRequirementClass: "stay", safetyShape: "none" },
  lodging_product_capacity: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  property_fact: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  amenity: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  amenity_list: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  policy: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  location: { routeKind: "ANSWER", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" },
  booking_operator_request: { routeKind: "HANDOFF", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "operator_action" },
  high_risk: { routeKind: "HANDOFF", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "risk" },
  null: { routeKind: "NO_REPLY", requiredGuestFields: [], temporalRequirementClass: "none", safetyShape: "none" }
});

const POLICY_BLUEPRINT = Object.freeze({
  lodging_room_composition: { registryCapabilities: ["lodging_room_composition"], subjectKinds: ["property", "room", "bundle", "matched_room_set"], stayDependent: false, allowsOtherSupported: false, purposes: ["lodging_question"] },
  availability: { registryCapabilities: ["availability", "bundle_availability"], subjectKinds: ["property", "room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false, purposes: ["lodging_question"] },
  available_dates: { registryCapabilities: ["available_dates"], subjectKinds: ["property", "room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false, purposes: ["lodging_question"] },
  price: { registryCapabilities: ["price"], subjectKinds: ["property", "room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false, purposes: ["lodging_question"] },
  total_price: { registryCapabilities: ["total_price"], subjectKinds: ["property", "room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false, purposes: ["lodging_question"] },
  capacity: { registryCapabilities: ["capacity"], subjectKinds: ["room", "bundle", "matched_room_set"], stayDependent: true, allowsOtherSupported: false, purposes: ["lodging_question"] },
  lodging_product_capacity: { registryCapabilities: ["lodging_product_capacity"], subjectKinds: ["room", "bundle"], stayDependent: false, allowsOtherSupported: false, purposes: ["lodging_question"] },
  property_fact: { registryCapabilities: ["property_fact"], subjectKinds: ["property", "room", "amenity", "policy", "other_verified"], stayDependent: false, allowsOtherSupported: true, purposes: ["lodging_question"] },
  amenity: { registryCapabilities: ["amenity"], subjectKinds: ["amenity"], stayDependent: false, allowsOtherSupported: false, purposes: ["lodging_question"] },
  amenity_list: { registryCapabilities: ["amenity_list"], subjectKinds: ["property", "room", "bundle"], stayDependent: false, allowsOtherSupported: false, purposes: ["lodging_question"] },
  policy: { registryCapabilities: ["policy"], subjectKinds: ["policy", "amenity", "property"], stayDependent: false, allowsOtherSupported: false, purposes: ["lodging_question"] },
  location: { registryCapabilities: ["location"], subjectKinds: ["property", "external_place"], stayDependent: false, allowsOtherSupported: false, purposes: ["lodging_question"] },
  booking_operator_request: { registryCapabilities: ["booking_request"], subjectKinds: ["room", "bundle", "other_verified"], stayDependent: false, allowsOtherSupported: true, purposes: ["operator_request", "cancellation"] },
  high_risk: { registryCapabilities: ["high_risk"], subjectKinds: ["other_verified"], stayDependent: false, allowsOtherSupported: true, purposes: ["sensitive_request", "cancellation"] },
  null: { registryCapabilities: [], subjectKinds: [null], stayDependent: false, allowsOtherSupported: false, purposes: ["acknowledgement", "conversational_statement", "correction", "supplement", "cancellation", "context_update", "social", "off_topic"] }
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
        : executionPolicy.safetyShape === "risk" ? ["sensitive_request"] : [...policy.purposes],
      understandingDescription: UNDERSTANDING_DESCRIPTIONS[capability]
        || "Language-derived capability candidate only; never answer facts."
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
    || !["none", "operator_action", "risk"].includes(policy.safetyShape)
    || typeof policy.understandingDescription !== "string" || policy.understandingDescription.length === 0) {
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
  if (policy.routeKind === "HANDOFF" && subjectKind === "other_verified"
    || capability === "amenity_list" && subjectKind === "property") {
    return "NULL_OR_PUBLIC_CATALOG";
  }
  return subjectKind === null || subjectKind === "external_place"
    || ["availability", "available_dates", "price", "total_price", "lodging_room_composition", "policy"].includes(capability) && subjectKind === "property"
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
