"use strict";

const {
  isValidatedLifecycleDecision,
  understandingInputForValidatedLifecycleDecision
} = require("./lifecycle-manager");

const BINDING_BY_TRUSTED_OPERATION_ARRAY = new WeakMap();

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function failure(code, errors = []) {
  return { ok: false, code, errors };
}

function scopeProjection(value) {
  const scope = value && value.scope || value;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const projected = {
    propertyId: String(scope.propertyId || ""),
    channel: String(scope.channel || scope.channelId || ""),
    userId: String(scope.userId || scope.lineUserId || "")
  };
  return Object.values(projected).every(Boolean) ? projected : null;
}

function sameScope(left, right) {
  return Boolean(left) && Boolean(right)
    && left.propertyId === right.propertyId
    && left.channel === right.channel
    && left.userId === right.userId;
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

function adaptLifecycleDecisionsToStateV3({ decisions, previous } = {}) {
  if (!Array.isArray(decisions) || decisions.some((decision) => !isValidatedLifecycleDecision(decision))) {
    return failure("LIFECYCLE_TRANSITION_INVALID", ["validatedLifecycleDecisions"]);
  }
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
    return failure("LIFECYCLE_TRANSITION_INVALID", ["previous"]);
  }
  const previousScope = scopeProjection(previous);
  const inputs = decisions.map(understandingInputForValidatedLifecycleDecision);
  const inputScopes = inputs.map((input) => scopeProjection(input && input.propertyScope));
  if (!previousScope || inputs.some((input) => !input)
    || inputScopes.some((inputScope) => !sameScope(inputScope, previousScope))) {
    return failure("LIFECYCLE_TRANSITION_INVALID", ["scope"]);
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
  BINDING_BY_TRUSTED_OPERATION_ARRAY.set(lifecycleOperations, {
    previous,
    scope: previousScope
  });
  return {
    ok: true,
    code: null,
    errors: [],
    value: deepFreeze({ lifecycleOperations, turnContextOperations })
  };
}

function isStateV3LifecycleOperationsFor(value, { previous, scope } = {}) {
  if (!Array.isArray(value)) return false;
  const binding = BINDING_BY_TRUSTED_OPERATION_ARRAY.get(value);
  if (value.length === 0 && !binding) return true;
  return Boolean(binding)
    && binding.previous === previous
    && sameScope(binding.scope, scopeProjection(scope));
}

module.exports = {
  adaptLifecycleDecisionsToStateV3,
  isStateV3LifecycleOperationsFor
};
