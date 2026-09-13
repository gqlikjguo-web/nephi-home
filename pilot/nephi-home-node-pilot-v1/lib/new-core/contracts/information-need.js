"use strict";

const { QUALIFIED_DETAIL_INTENTS: DETAIL_INTENTS } = require("../../conversation-engine-v2/detail-intent");

// These existing property-catalog request types consume one detailIntent.
// This position describes a requested fact, never an operator's answer.
const INFORMATION_NEED_SLOT = "information_need";
const DETAIL_QUERY_CAPABILITIES = new Set(["amenity", "policy", "property_fact"]);
function supportsInformationNeed(policy) {
  return Boolean(policy?.registryCapabilities?.length)
    && policy.registryCapabilities.every(capability => DETAIL_QUERY_CAPABILITIES.has(capability));
}
function validInformationNeedOperation(slot) {
  return slot.operation === "CLEAR" ? slot.value === null
    : slot.operation === "SET" && DETAIL_INTENTS.has(slot.value);
}
function informationNeedAdmission(slot, policy) {
  if (slot.slot !== INFORMATION_NEED_SLOT) return { allowed: true };
  return { allowed: supportsInformationNeed(policy) && validInformationNeedOperation(slot),
    rule: "informationNeedAdmission", actualKind: typeof slot.value,
    allowedKinds: supportsInformationNeed(policy) ? [...DETAIL_INTENTS] : [] };
}

module.exports = { INFORMATION_NEED_SLOT, supportsInformationNeed,
  validInformationNeedOperation, informationNeedAdmission, DETAIL_INTENTS };
