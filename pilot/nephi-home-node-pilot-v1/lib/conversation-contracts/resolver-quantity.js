"use strict";
// Shared typed quantity rule. Optional absence is unknown, never a default.
function validateQuantityFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {ok:false,errors:["quantity.shape"]};
  const present = Object.hasOwn(value, "requestedQuantity") || Object.hasOwn(value, "distinctRequirement");
  const errors = [];
  if (present && (!Number.isSafeInteger(value.requestedQuantity) || value.requestedQuantity < 1)) errors.push("requestedQuantity");
  if (present && !["none", "distinct_entities"].includes(value.distinctRequirement)) errors.push("distinctRequirement");
  return {ok:errors.length === 0, errors};
}
function projectQuantityFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(["requestedQuantity", "distinctRequirement"].filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
}
// Runtime projector consumes validated request semantics; failure here is an invariant.
function resolverQuantityFields(value) {
  const validation = validateQuantityFields(value);
  if (!validation.ok) throw new TypeError("invalid_resolver_quantity");
  if (!Object.hasOwn(value, "requestedQuantity")) return {};
  return {requestedQuantity:value.requestedQuantity, distinctRequirement:value.distinctRequirement};
}
module.exports={validateQuantityFields,projectQuantityFields,resolverQuantityFields};
