"use strict";

const { isValidatedSemanticUnitFor } = require("./semantic-unit-validator");
const {
  isValidatedLifecycleDecision,
  understandingInputForValidatedLifecycleDecision
} = require("./lifecycle-manager");
const {
  isTrustedUnitRoutingDecision,
  isTrustedUnitRoutingDecisionFor
} = require("./unit-reply-router");
const {
  FAILURE_REF_FIELDS,
  DOWNSTREAM_OUTCOME_REF_FIELDS,
  validateUnitAggregationResult
} = require("./contracts/unit-aggregation-result");

const C09_AUTHORITY_MARKER = new WeakSet();

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function failure(code, errors = []) {
  return { ok: false, code, errors };
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, fields) {
  return isPlainObject(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((key) => fields.includes(key));
}

function boundedText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function isDeepFrozen(value, seen = new Set()) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (typeof value !== "object" || !Object.isFrozen(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length) return false;
  const names = Object.getOwnPropertyNames(value);
  if (Array.isArray(value)) {
    return names.every((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (name === "length") return descriptor && !descriptor.enumerable && "value" in descriptor;
      if (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= 4294967295
        || !descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
      return isDeepFrozen(descriptor.value, seen);
    });
  }
  if (!isPlainObject(value)) return false;
  return names.every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor && descriptor.enumerable && "value" in descriptor
      && isDeepFrozen(descriptor.value, seen);
  });
}

function indexByUnitId(values, { duplicateCode, invalidCode, validate }) {
  if (!Array.isArray(values)) return failure(invalidCode, ["array"]);
  const indexed = new Map();
  for (const value of values) {
    if (!validate(value)) return failure(invalidCode, ["item"]);
    if (indexed.has(value.unitId)) return failure(duplicateCode, ["unitId"]);
    indexed.set(value.unitId, value);
  }
  return { ok: true, value: indexed };
}

function isCanonicalItem(value) {
  return isPlainObject(value) && isDeepFrozen(value) && boundedText(value.unitId);
}

function isDownstreamOutcomeRef(value) {
  return exactKeys(value, DOWNSTREAM_OUTCOME_REF_FIELDS)
    && isDeepFrozen(value)
    && boundedText(value.unitId)
    && isPlainObject(value.outcomeRef)
    && isDeepFrozen(value.outcomeRef);
}

function isFailureRef(value) {
  return exactKeys(value, FAILURE_REF_FIELDS)
    && isDeepFrozen(value)
    && boundedText(value.unitId)
    && boundedText(value.failureCode);
}

function aggregateUnitOutcomes({
  turnId,
  validatedUnits,
  lifecycleDecisions,
  routingDecisions,
  canonicalItems = [],
  downstreamOutcomes = [],
  failedUnits = []
} = {}) {
  if (!boundedText(turnId)) return failure("UNIT_OUTCOME_ORPHAN", ["turnId"]);
  const units = indexByUnitId(validatedUnits, {
    duplicateCode: "UNIT_OUTCOME_DUPLICATE",
    invalidCode: "UNIT_OUTCOME_ORPHAN",
    validate: (unit) => isPlainObject(unit) && boundedText(unit.unitId)
  });
  if (!units.ok) return units;
  const lifecycles = indexByUnitId(lifecycleDecisions, {
    duplicateCode: "UNIT_OUTCOME_DUPLICATE",
    invalidCode: "UNIT_OUTCOME_ORPHAN",
    validate: isValidatedLifecycleDecision
  });
  if (!lifecycles.ok) return lifecycles;
  const routes = indexByUnitId(routingDecisions, {
    duplicateCode: "UNIT_OUTCOME_DUPLICATE",
    invalidCode: "AGGREGATION_ROUTE_CONFLICT",
    validate: isTrustedUnitRoutingDecision
  });
  if (!routes.ok) return routes;

  for (const [unitId, unit] of units.value) {
    const lifecycle = lifecycles.value.get(unitId);
    const route = routes.value.get(unitId);
    if (!lifecycle || !route) return failure("UNIT_COVERAGE_INCOMPLETE", [unitId]);
    const input = understandingInputForValidatedLifecycleDecision(lifecycle);
    if (!input || input.turnId !== turnId || lifecycle.unitId !== unitId
      || !isValidatedSemanticUnitFor(input, unit)) {
      return failure("UNIT_OUTCOME_ORPHAN", [unitId]);
    }
    if (!isTrustedUnitRoutingDecisionFor(route, {
      unit,
      lifecycleDecision: lifecycle,
      understandingTurnInput: input
    })) return failure("AGGREGATION_ROUTE_CONFLICT", [unitId]);
  }
  for (const unitId of lifecycles.value.keys()) {
    if (!units.value.has(unitId)) return failure("UNIT_OUTCOME_ORPHAN", [unitId]);
  }
  for (const unitId of routes.value.keys()) {
    if (!units.value.has(unitId)) return failure("UNIT_OUTCOME_ORPHAN", [unitId]);
  }

  const canonical = indexByUnitId(canonicalItems, {
    duplicateCode: "CANONICAL_ITEM_ORPHAN",
    invalidCode: "CANONICAL_ITEM_ORPHAN",
    validate: isCanonicalItem
  });
  if (!canonical.ok) return canonical;
  for (const [unitId] of canonical.value) {
    const route = routes.value.get(unitId);
    if (!route || route.disposition !== "ANSWER" || !route.requiresCanonicalExecution) {
      return failure("CANONICAL_ITEM_ORPHAN", [unitId]);
    }
  }

  const downstream = indexByUnitId(downstreamOutcomes, {
    duplicateCode: "UNIT_OUTCOME_ORPHAN",
    invalidCode: "UNIT_OUTCOME_ORPHAN",
    validate: isDownstreamOutcomeRef
  });
  if (!downstream.ok) return downstream;
  const failures = indexByUnitId(failedUnits, {
    duplicateCode: "UNIT_OUTCOME_ORPHAN",
    invalidCode: "UNIT_OUTCOME_ORPHAN",
    validate: isFailureRef
  });
  if (!failures.ok) return failures;
  for (const unitId of downstream.value.keys()) {
    if (!units.value.has(unitId)) return failure("UNIT_OUTCOME_ORPHAN", [unitId]);
  }

  for (const [unitId, route] of routes.value) {
    if (route.disposition === "ANSWER" && !canonical.value.has(unitId) && !failures.value.has(unitId)) {
      return failure("CANONICAL_ITEM_ORPHAN", [unitId]);
    }
    if (route.disposition !== "ANSWER" && canonical.value.has(unitId)) {
      return failure("CANONICAL_ITEM_ORPHAN", [unitId]);
    }
  }

  const unitOutcomes = validatedUnits.map((unit) => {
    const route = routes.value.get(unit.unitId);
    const downstreamRef = downstream.value.get(unit.unitId);
    return {
      unitId: unit.unitId,
      unit,
      lifecycleDecision: lifecycles.value.get(unit.unitId),
      routingDecision: route,
      canonicalItem: canonical.value.get(unit.unitId) || null,
      downstreamOutcomeRef: downstreamRef ? downstreamRef.outcomeRef : null,
      failure: failures.value.get(unit.unitId) || null
    };
  });
  const value = {
    turnId,
    unitOutcomes,
    canonicalItems: validatedUnits
      .map((unit) => canonical.value.get(unit.unitId))
      .filter(Boolean),
    hasReplyWork: unitOutcomes.some((outcome) => outcome.routingDecision.disposition !== "NO_REPLY"),
    hasClarification: unitOutcomes.some((outcome) => outcome.routingDecision.disposition === "CLARIFY"),
    hasHandoff: unitOutcomes.some((outcome) => outcome.routingDecision.disposition === "HANDOFF"),
    allNoReply: unitOutcomes.every((outcome) => outcome.routingDecision.disposition === "NO_REPLY"),
    failedUnits: [...failedUnits]
  };
  const contract = validateUnitAggregationResult(value);
  if (!contract.ok) return failure("UNIT_OUTCOME_ORPHAN", contract.errors);
  deepFreeze(value);
  C09_AUTHORITY_MARKER.add(value);
  return { ok: true, code: null, errors: [], value };
}

function isTrustedUnitAggregationResult(value) {
  return Boolean(value) && typeof value === "object"
    && C09_AUTHORITY_MARKER.has(value)
    && validateUnitAggregationResult(value).ok;
}

module.exports = {
  aggregateUnitOutcomes,
  isTrustedUnitAggregationResult
};
