"use strict";

const { QUALIFIED_DETAIL_INTENTS } = require("../../conversation-engine-v2/detail-intent");

// One requested-fact position; accepted values are owned by the capability.
const INFORMATION_NEED_SLOT = "information_need";
const INFORMATION_NEEDS = Object.freeze({
  amenity: QUALIFIED_DETAIL_INTENTS,
  policy: QUALIFIED_DETAIL_INTENTS,
  property_fact: QUALIFIED_DETAIL_INTENTS,
  lodging_room_composition: new Set(["room_types"])
});
const DETAIL_INTENTS = new Set(Object.values(INFORMATION_NEEDS).flatMap(values => [...values]));
function informationNeedsFor(policy) {
  const capabilities = policy?.registryCapabilities || [];
  return capabilities.length ? new Set([...DETAIL_INTENTS].filter(value =>
    capabilities.every(capability => INFORMATION_NEEDS[capability]?.has(value)))) : new Set();
}
function supportsInformationNeed(policy) { return informationNeedsFor(policy).size > 0; }
function validInformationNeedOperation(slot) {
  return slot.operation === "CLEAR" ? slot.value === null
    : slot.operation === "SET" && DETAIL_INTENTS.has(slot.value);
}
function informationNeedAdmission(slot, policy) {
  if (slot.slot !== INFORMATION_NEED_SLOT) return { allowed: true };
  const values = informationNeedsFor(policy);
  return { allowed: values.size > 0 && validInformationNeedOperation(slot)
      && (slot.operation === "CLEAR" || values.has(slot.value)),
    rule: "informationNeedAdmission", actualKind: typeof slot.value, allowedKinds: [...values] };
}

module.exports = { INFORMATION_NEED_SLOT, supportsInformationNeed, informationNeedsFor,
  validInformationNeedOperation, informationNeedAdmission, DETAIL_INTENTS };
