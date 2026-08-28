"use strict";

const { isValidatedLifecycleDecision } = require("./lifecycle-manager");

const TRUSTED_OPERATION_ARRAYS = new WeakSet();

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function failure(code, errors = []) {
  return { ok: false, code, errors };
}

function productValue(operation) {
  if (operation.operation === "CLEAR") {
    return {
      productType: "any",
      productId: null,
      roomTypeId: null,
      bundleId: null,
      entityId: null,
      entityCategory: null
    };
  }
  if (operation.persistedProductType === "bundle") {
    return {
      productType: "bundle",
      productId: operation.value,
      roomTypeId: null,
      bundleId: operation.value,
      entityId: operation.value,
      entityCategory: "bundle"
    };
  }
  return {
    productType: "room_type",
    productId: operation.value,
    roomTypeId: operation.value,
    bundleId: null,
    entityId: operation.value,
    entityCategory: "room"
  };
}

function adaptLifecycleDecisionsToStateV3(decisions) {
  if (!Array.isArray(decisions) || decisions.some((decision) => !isValidatedLifecycleDecision(decision))) {
    return failure("LIFECYCLE_TRANSITION_INVALID", ["validatedLifecycleDecisions"]);
  }
  const lifecycleOperations = [];
  const turnContextOperations = [];
  const persistedTargets = new Set();
  for (const decision of decisions) {
    if (decision.action === "END") {
      lifecycleOperations.push({
        lifecycleDecisionId: decision.lifecycleDecisionId,
        unitId: decision.unitId,
        action: "END",
        targetTaskId: decision.targetRequestCycleId,
        field: null,
        operation: "CANCEL",
        value: null
      });
      continue;
    }
    for (const slotOperation of decision.verifiedSlotOperations) {
      if (slotOperation.persistedField === null) {
        turnContextOperations.push(slotOperation);
        continue;
      }
      if (!["CONTINUE", "MODIFY"].includes(decision.action)) {
        turnContextOperations.push(slotOperation);
        continue;
      }
      const targetKey = `${decision.targetRequestCycleId}:${slotOperation.persistedField}`;
      if (persistedTargets.has(targetKey)) {
        return failure("LIFECYCLE_TRANSITION_INVALID", ["persistedSlotConflict"]);
      }
      persistedTargets.add(targetKey);
      lifecycleOperations.push({
        lifecycleDecisionId: decision.lifecycleDecisionId,
        unitId: decision.unitId,
        action: decision.action,
        targetTaskId: decision.targetRequestCycleId,
        field: slotOperation.persistedField,
        operation: slotOperation.operation,
        value: slotOperation.persistedField === "lodgingProduct"
          ? productValue(slotOperation)
          : slotOperation.value
      });
    }
  }
  deepFreeze(lifecycleOperations);
  TRUSTED_OPERATION_ARRAYS.add(lifecycleOperations);
  return {
    ok: true,
    code: null,
    errors: [],
    value: deepFreeze({ lifecycleOperations, turnContextOperations })
  };
}

function isStateV3LifecycleOperations(value) {
  return Array.isArray(value) && (value.length === 0 || TRUSTED_OPERATION_ARRAYS.has(value));
}

module.exports = {
  adaptLifecycleDecisionsToStateV3,
  isStateV3LifecycleOperations
};
