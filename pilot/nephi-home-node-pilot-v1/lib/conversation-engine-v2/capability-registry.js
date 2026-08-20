"use strict";

const ENTRY_FIELDS = Object.freeze([
  "capability",
  "acceptedCandidateTypes",
  "acceptedEntityCategories",
  "stayDependency",
  "requiredFields",
  "resolverId",
  "riskLevel",
  "responseMode"
]);

const RESOLVER_IDS = new Set([
  "availability_resolver",
  "property_catalog",
  "human_handoff"
]);
const RISK_LEVELS = new Set(["low", "high"]);
const RESPONSE_MODES = new Set(["answer", "handoff"]);
const STAY_DEPENDENCIES = new Set(["required", false]);

const REGISTRY_BLUEPRINT = {
  availability: {
    capability: "availability",
    acceptedCandidateTypes: ["availability", "available_dates"],
    acceptedEntityCategories: ["room", "other"],
    stayDependency: "required",
    requiredFields: ["stay.checkIn", "stay.checkOut"],
    resolverId: "availability_resolver",
    riskLevel: "low",
    responseMode: "answer"
  },
  available_dates: {
    capability: "available_dates",
    acceptedCandidateTypes: ["available_dates"],
    acceptedEntityCategories: ["room", "other"],
    stayDependency: "required",
    requiredFields: ["stay.searchRange"],
    resolverId: "availability_resolver",
    riskLevel: "low",
    responseMode: "answer"
  },
  amenity: {
    capability: "amenity",
    acceptedCandidateTypes: ["amenity"],
    acceptedEntityCategories: ["amenity", "activity", "room_feature"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer"
  },
  policy: {
    capability: "policy",
    acceptedCandidateTypes: ["policy"],
    acceptedEntityCategories: ["policy", "payment", "cancellation", "check_in", "check_out", "amenity", "activity", "room_feature"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer"
  },
  property_fact: {
    capability: "property_fact",
    acceptedCandidateTypes: ["property_fact"],
    acceptedEntityCategories: ["transport", "check_in", "check_out", "other", "amenity", "activity", "room_feature", "policy", "payment", "cancellation"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer"
  },
  location: {
    capability: "location",
    acceptedCandidateTypes: ["property_fact"],
    acceptedEntityCategories: ["transport"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer"
  },
  parking: {
    capability: "parking",
    acceptedCandidateTypes: ["amenity", "property_fact"],
    acceptedEntityCategories: ["amenity", "transport"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer"
  },
  bbq: {
    capability: "bbq",
    acceptedCandidateTypes: ["amenity", "policy", "property_fact"],
    acceptedEntityCategories: ["amenity", "activity", "policy"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer"
  },
  pool: {
    capability: "pool",
    acceptedCandidateTypes: ["amenity", "property_fact"],
    acceptedEntityCategories: ["amenity", "activity", "policy"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer"
  },
  booking_request: {
    capability: "booking_request",
    acceptedCandidateTypes: ["booking_request"],
    acceptedEntityCategories: ["room", "bundle", "other"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "human_handoff",
    riskLevel: "high",
    responseMode: "handoff"
  },
  human_help: {
    capability: "human_help",
    acceptedCandidateTypes: ["human_help"],
    acceptedEntityCategories: ["other"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "human_handoff",
    riskLevel: "high",
    responseMode: "handoff"
  },
  high_risk: {
    capability: "high_risk",
    acceptedCandidateTypes: ["high_risk"],
    acceptedEntityCategories: ["other"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "human_handoff",
    riskLevel: "high",
    responseMode: "handoff"
  },
  room_options: {
    capability: "room_options",
    acceptedCandidateTypes: ["room_options"],
    acceptedEntityCategories: ["room", "room_feature", "other"],
    stayDependency: "required",
    requiredFields: ["stay.checkIn", "stay.checkOut"],
    resolverId: "availability_resolver",
    riskLevel: "low",
    responseMode: "answer"
  },
  bundle_availability: {
    capability: "bundle_availability",
    acceptedCandidateTypes: ["bundle_availability", "availability"],
    acceptedEntityCategories: ["bundle", "other"],
    stayDependency: "required",
    requiredFields: ["stay.checkIn", "stay.checkOut"],
    resolverId: "availability_resolver",
    riskLevel: "low",
    responseMode: "answer"
  },
  capacity: {
    capability: "capacity",
    acceptedCandidateTypes: ["capacity"],
    acceptedEntityCategories: ["room", "bundle", "other"],
    stayDependency: "required",
    requiredFields: ["stay.checkIn", "stay.checkOut", "stay.guests"],
    resolverId: "availability_resolver",
    riskLevel: "low",
    responseMode: "answer"
  },
  lodging_product_capacity: {
    capability: "lodging_product_capacity",
    acceptedCandidateTypes: ["lodging_product_capacity"],
    acceptedEntityCategories: ["room", "bundle"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer"
  },
  price: {
    capability: "price",
    acceptedCandidateTypes: ["price"],
    acceptedEntityCategories: ["room", "bundle", "other"],
    stayDependency: "required",
    requiredFields: ["stay.checkIn", "stay.checkOut"],
    resolverId: "availability_resolver",
    riskLevel: "low",
    responseMode: "answer"
  },
  total_price: {
    capability: "total_price",
    acceptedCandidateTypes: ["total_price"],
    acceptedEntityCategories: ["room", "bundle", "other"],
    stayDependency: "required",
    requiredFields: ["stay.checkIn", "stay.checkOut"],
    resolverId: "availability_resolver",
    riskLevel: "low",
    responseMode: "answer"
  },
  amenity_list: {
    capability: "amenity_list",
    acceptedCandidateTypes: ["amenity_list"],
    acceptedEntityCategories: ["amenity", "other"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer"
  },
  unknown: {
    capability: "unknown",
    acceptedCandidateTypes: ["unknown"],
    acceptedEntityCategories: ["other"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "human_handoff",
    riskLevel: "high",
    responseMode: "handoff"
  }
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const CAPABILITY_REGISTRY = deepFreeze(deepClone(REGISTRY_BLUEPRINT));

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function validateCapabilityRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    return { ok: false, errors: ["registry"] };
  }
  const expectedCapabilities = Object.keys(REGISTRY_BLUEPRINT);
  const actualCapabilities = Object.keys(registry);
  if (!sameArray(actualCapabilities, expectedCapabilities)) errors.push("registry.capabilities");
  expectedCapabilities.forEach((capability) => {
    const entry = registry[capability];
    const expected = REGISTRY_BLUEPRINT[capability];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${capability}.entry`);
      return;
    }
    if (!sameArray(Object.keys(entry), ENTRY_FIELDS)) errors.push(`${capability}.keys`);
    if (entry.capability !== capability) errors.push(`${capability}.capability`);
    if (!sameArray(entry.acceptedCandidateTypes, expected.acceptedCandidateTypes)
      || entry.acceptedCandidateTypes.length === 0) errors.push(`${capability}.acceptedCandidateTypes`);
    if (!sameArray(entry.acceptedEntityCategories, expected.acceptedEntityCategories)
      || entry.acceptedEntityCategories.length === 0) errors.push(`${capability}.acceptedEntityCategories`);
    if (entry.stayDependency !== expected.stayDependency
      || !STAY_DEPENDENCIES.has(entry.stayDependency)) errors.push(`${capability}.stayDependency`);
    if (!sameArray(entry.requiredFields, expected.requiredFields)) errors.push(`${capability}.requiredFields`);
    if (entry.resolverId !== expected.resolverId
      || !RESOLVER_IDS.has(entry.resolverId)) errors.push(`${capability}.resolverId`);
    if (entry.riskLevel !== expected.riskLevel
      || !RISK_LEVELS.has(entry.riskLevel)) errors.push(`${capability}.riskLevel`);
    if (entry.responseMode !== expected.responseMode
      || !RESPONSE_MODES.has(entry.responseMode)) errors.push(`${capability}.responseMode`);
  });
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function getCapabilityDefinition(capability) {
  return CAPABILITY_REGISTRY[String(capability || "")] || null;
}

module.exports = {
  CAPABILITY_REGISTRY,
  CAPABILITY_REGISTRY_FIELDS: ENTRY_FIELDS,
  getCapabilityDefinition,
  validateCapabilityRegistry
};
