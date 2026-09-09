"use strict";
// Optional projection of validated request semantics; never inferred from inventory or guests.
function resolverQuantityFields(value) {
  if (!Object.hasOwn(value, "requestedQuantity") && !Object.hasOwn(value, "distinctRequirement")) return {};
  if (!Number.isSafeInteger(value.requestedQuantity) || value.requestedQuantity < 1
    || !["none", "distinct_entities"].includes(value.distinctRequirement)) throw new TypeError("invalid_resolver_quantity");
  return {requestedQuantity:value.requestedQuantity, distinctRequirement:value.distinctRequirement};
}
module.exports={resolverQuantityFields};
