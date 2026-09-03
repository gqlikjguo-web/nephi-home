"use strict";

const {
  isValidatedLifecycleDecision,
  understandingInputForValidatedLifecycleDecision
} = require("./lifecycle-manager");
const { isTrustedUnitAggregationResult } = require("./unit-aggregator");

const BINDING_BY_TRUSTED_OPERATION_ARRAY = new WeakMap();
const BINDING_BY_TRUSTED_TASK_CREATION_ARRAY = new WeakMap();
const BINDING_BY_TRUSTED_CANONICAL_TASK_BINDING_ARRAY = new WeakMap();

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

function taskProduct(unit, decision) {
  const operations = decision.verifiedSlotOperations.filter((item) => (
    item.persistedField === "lodgingProduct"
  ));
  if (operations.length > 1) return null;
  const operation = operations[0];
  if (operation && operation.operation === "SET"
    && ["bundle", "room"].includes(unit.subject.kind)
    && unit.subject.catalogIdentity !== operation.value) return null;
  if (operation) return productValue(operation);
  if (unit.subject.kind === "bundle") {
    return productValue({ operation: "SET", persistedProductType: "bundle", value: unit.subject.catalogIdentity });
  }
  if (unit.subject.kind === "room") {
    return productValue({ operation: "SET", persistedProductType: "room_type", value: unit.subject.catalogIdentity });
  }
  return productValue({ operation: "CLEAR" });
}

function taskCreationFor(outcome) {
  const unit = outcome.unit;
  const decision = outcome.lifecycleDecision;
  const route = outcome.routingDecision;
  const product = taskProduct(unit, decision);
  if (!product) return null;
  const temporal = unit.temporalCandidate || {};
  const availableDates = unit.capability === "available_dates";
  const guestOperations = decision.verifiedSlotOperations.filter((item) => (
    item.persistedField === "guestCount"
  ));
  if (guestOperations.length > 1) return null;
  const guestOperation = guestOperations[0];
  const missingFields = route.missingGuestFields.map((field) => {
    if (availableDates && field === "stay.checkIn") return "searchFrom";
    if (availableDates && field === "stay.checkOut") return "searchTo";
    if (field === "stay.checkIn") return "checkIn";
    if (field === "stay.checkOut") return "checkOut";
    if (field === "stay.guests") return "guestCount";
    return field;
  });
  return {
    lifecycleDecisionId: decision.lifecycleDecisionId,
    unitId: unit.unitId,
    taskIdCandidate: unit.unitId,
    capability: unit.capability,
    productType: product.productType,
    productId: product.productId,
    roomTypeId: product.roomTypeId,
    bundleId: product.bundleId,
    checkIn: availableDates ? null : temporal.checkInCandidate || null,
    checkOut: availableDates ? null : temporal.checkOutCandidate || null,
    guestCount: guestOperation && guestOperation.operation === "SET" ? guestOperation.value : null,
    searchFrom: availableDates ? temporal.checkInCandidate || null : null,
    searchTo: availableDates ? temporal.checkOutCandidate || null : null,
    entityId: product.productId,
    entityCategory: product.productType === "bundle" ? "bundle"
      : product.productType === "room_type" ? "room" : null,
    detailIntent: "general",
    missingFields
  };
}

function adaptLifecycleDecisionsToStateV3({ decisions, aggregationResult = null, previous } = {}) {
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
  const taskCreations = aggregationResult === null
    ? []
    : isTrustedUnitAggregationResult(aggregationResult)
      ? aggregationResult.unitOutcomes
        .filter((outcome) => (
          decisions.includes(outcome.lifecycleDecision)
          && outcome.lifecycleDecision.action === "START"
          && outcome.routingDecision.disposition === "CLARIFY"
          && outcome.routingDecision.requiresCanonicalExecution === false
          && outcome.canonicalItem === null
        ))
        .map(taskCreationFor)
      : null;
  if (taskCreations === null || taskCreations.some((creation) => creation === null)) {
    return failure("LIFECYCLE_TRANSITION_INVALID", ["aggregationResult"]);
  }
  const canonicalTaskBindings = aggregationResult === null
    ? []
    : aggregationResult.unitOutcomes
      .filter((outcome) => (
        outcome.canonicalItem !== null
        && ["CONTINUE", "MODIFY"].includes(outcome.lifecycleDecision.action)
        && outcome.lifecycleDecision.targetRequestCycleId !== null
      ))
      .map((outcome) => ({
        unitId: outcome.unitId,
        action: outcome.lifecycleDecision.action,
        requestCycleId: outcome.lifecycleDecision.targetRequestCycleId
      }));
  deepFreeze(lifecycleOperations);
  deepFreeze(taskCreations);
  deepFreeze(canonicalTaskBindings);
  BINDING_BY_TRUSTED_OPERATION_ARRAY.set(lifecycleOperations, {
    previous,
    scope: previousScope
  });
  BINDING_BY_TRUSTED_TASK_CREATION_ARRAY.set(taskCreations, {
    previous,
    scope: previousScope,
    aggregationResult
  });
  BINDING_BY_TRUSTED_CANONICAL_TASK_BINDING_ARRAY.set(canonicalTaskBindings, {
    previous,
    scope: previousScope,
    aggregationResult
  });
  return {
    ok: true,
    code: null,
    errors: [],
    value: deepFreeze({
      lifecycleOperations,
      turnContextOperations,
      taskCreations,
      canonicalTaskBindings
    })
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

function isStateV3TaskCreationsFor(value, { previous, scope } = {}) {
  if (!Array.isArray(value)) return false;
  const binding = BINDING_BY_TRUSTED_TASK_CREATION_ARRAY.get(value);
  if (value.length === 0 && !binding) return true;
  return Boolean(binding)
    && binding.previous === previous
    && sameScope(binding.scope, scopeProjection(scope))
    && (binding.aggregationResult === null
      || isTrustedUnitAggregationResult(binding.aggregationResult));
}

function isStateV3CanonicalTaskBindingsFor(value, { previous, scope, canonicalItems = [] } = {}) {
  if (!Array.isArray(value)) return false;
  const binding = BINDING_BY_TRUSTED_CANONICAL_TASK_BINDING_ARRAY.get(value);
  if (value.length === 0 && !binding) return true;
  const boundOutcomes = binding && binding.aggregationResult
    ? binding.aggregationResult.unitOutcomes.filter((outcome) => (
      outcome.canonicalItem !== null
      && ["CONTINUE", "MODIFY"].includes(outcome.lifecycleDecision.action)
      && outcome.lifecycleDecision.targetRequestCycleId !== null
    ))
    : [];
  return Boolean(binding)
    && binding.previous === previous
    && sameScope(binding.scope, scopeProjection(scope))
    && (binding.aggregationResult === null
      || isTrustedUnitAggregationResult(binding.aggregationResult))
    && Array.isArray(canonicalItems)
    && boundOutcomes.length === value.length
    && boundOutcomes.every((outcome) => {
      const matchingItems = canonicalItems.filter((item) => item && item.unitId === outcome.unitId);
      return matchingItems.length === 1 && matchingItems[0] === outcome.canonicalItem;
    });
}

module.exports = {
  adaptLifecycleDecisionsToStateV3,
  isStateV3LifecycleOperationsFor,
  isStateV3TaskCreationsFor,
  isStateV3CanonicalTaskBindingsFor
};
