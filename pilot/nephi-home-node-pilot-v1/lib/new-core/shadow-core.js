"use strict";

const crypto = require("node:crypto");
const { types: utilTypes } = require("node:util");
const {
  callOpenAIUnderstandingV1,
  isTrustedUnderstandingResult
} = require("../providers/openai-understanding-v1");
const { validateUnderstandingTurnInput } = require("./contracts/understanding-turn-input");
const { buildPublicCatalogIdentityProjection } = require("./turn-input-adapter");
const { projectCapabilityRegistry } = require("./semantic-unit-validator");
const { createLifecycleDecision } = require("./lifecycle-manager");
const {
  createUnitReplyRoutingRegistry,
  createUnitReadiness,
  createTrustedOperatorSafetyPolicy,
  createUnitRoutingDecision
} = require("./unit-reply-router");
const { createCanonicalizerInputItem } = require("./canonical-execution-adapter");
const { aggregateUnitOutcomes, isTrustedUnitAggregationResult } = require("./unit-aggregator");
const {
  ZERO_SIDE_EFFECT_COUNTERS,
  createShadowComparisonRecord,
  projectCoreSummary
} = require("./shadow-comparator");

const HANDOFF_CAPABILITIES = new Set(["booking_operator_request", "high_risk"]);
const EMPTY_CORE_SUMMARY = deepFreeze({
  semanticUnits: [], routes: [], lifecycles: [], canonicalItems: []
});
const PRODUCTION_INPUT_FIELDS = Object.freeze([
  "understandingTurnInput", "oldCoreOutcomeSummary", "coreSha", "providerConfig"
]);
const PROVIDER_CONFIG_FIELDS = Object.freeze(["apiKey", "model"]);
const MAX_DATA_ONLY_DEPTH = 8;
const MAX_DATA_ONLY_NODES = 5000;
const MAX_DATA_ONLY_ARRAY_ITEMS = 100;
const MAX_DATA_ONLY_OBJECT_FIELDS = 20;
const MAX_DATA_ONLY_STRING_LENGTH = 500;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function ownDataDescriptors(value, fields, requirePlainObject = false) {
  if (!value || typeof value !== "object" || utilTypes.isProxy(value)
    || requirePlainObject && Object.getPrototypeOf(value) !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || !keys.every((field) => fields.includes(field))) return null;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
  }
  return descriptors;
}

function primitiveDataOnlyValue(value) {
  if (value === null || typeof value === "boolean") return { ok: true, value };
  if (typeof value === "string" && value.length <= MAX_DATA_ONLY_STRING_LENGTH) {
    return { ok: true, value };
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= 1000) {
    return { ok: true, value };
  }
  return { ok: false, value: null };
}

function cloneDataOnly(root) {
  const ancestors = new WeakSet();
  let nodes = 0;
  function cloneArray(value, depth) {
    if (value.length > MAX_DATA_ONLY_ARRAY_ITEMS) return { ok: false, value: null };
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, "length")) {
      return { ok: false, value: null };
    }
    const detached = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return { ok: false, value: null };
      const item = clone(descriptor.value, depth + 1);
      if (!item.ok) return item;
      detached.push(item.value);
    }
    return { ok: true, value: Object.freeze(detached) };
  }
  function cloneObject(value, depth) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > MAX_DATA_ONLY_OBJECT_FIELDS
      || keys.some((key) => typeof key !== "string")) return { ok: false, value: null };
    const entries = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return { ok: false, value: null };
      const item = clone(descriptor.value, depth + 1);
      if (!item.ok) return item;
      entries.push([key, item.value]);
    }
    return { ok: true, value: Object.freeze(Object.fromEntries(entries)) };
  }
  function clone(value, depth) {
    if (!value || typeof value !== "object") return primitiveDataOnlyValue(value);
    if (depth > MAX_DATA_ONLY_DEPTH || nodes >= MAX_DATA_ONLY_NODES
      || utilTypes.isProxy(value) || ancestors.has(value)) return { ok: false, value: null };
    const isArray = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (isArray ? Array.prototype : Object.prototype)) {
      return { ok: false, value: null };
    }
    nodes += 1;
    ancestors.add(value);
    const result = isArray ? cloneArray(value, depth) : cloneObject(value, depth);
    ancestors.delete(value);
    return result;
  }
  return clone(root, 0);
}

function projectProductionInput(options) {
  const projected = ownDataDescriptors(options, PRODUCTION_INPUT_FIELDS, true);
  if (!projected) return null;
  const provider = ownDataDescriptors(projected.providerConfig.value, PROVIDER_CONFIG_FIELDS, true);
  if (!provider || typeof provider.apiKey.value !== "string"
    || provider.apiKey.value.length < 1 || provider.apiKey.value.length > 1000
    || typeof provider.model.value !== "string"
    || provider.model.value.length < 1 || provider.model.value.length > 160) return null;
  const detachedOldSummary = cloneDataOnly(projected.oldCoreOutcomeSummary.value);
  const oldCoreOutcomeSummary = detachedOldSummary.ok
    ? projectCoreSummary(detachedOldSummary.value) : null;
  return Object.freeze({
    understandingTurnInput: projected.understandingTurnInput.value,
    oldCoreOutcomeSummary,
    coreSha: projected.coreSha.value,
    providerConfig: Object.freeze({
      apiKey: provider.apiKey.value,
      model: provider.model.value
    })
  });
}

function lifecycleDecisionId(unitId, index) {
  const digest = crypto.createHash("sha256").update(String(unitId)).digest("hex").slice(0, 24);
  return `shadow-lifecycle-${index}-${digest}`;
}

function publicCanonicalizerCatalog(input) {
  const subjects = Array.isArray(input.publicSubjectCatalog) ? input.publicSubjectCatalog : [];
  const project = (subject) => deepFreeze({
    canonicalId: subject.catalogIdentity,
    category: subject.kind,
    publicName: subject.publicName
  });
  return deepFreeze({
    propertyId: input.propertyScope.propertyId,
    timezone: input.propertyTimezone,
    rooms: subjects.filter((subject) => ["room", "bundle"].includes(subject.kind)).map(project),
    amenities: subjects.filter((subject) => subject.kind === "amenity").map(project),
    policies: subjects.filter((subject) => subject.kind === "policy").map(project)
  });
}

function failureCode(error, fallback = "SHADOW_COMPARISON_INCOMPLETE") {
  if (error && typeof error.failureCode === "string") return error.failureCode;
  return error && typeof error.code === "string" ? error.code : fallback;
}

function uniqueCodes(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

function consumeUnitAggregationResult(aggregationResult) {
  if (!isTrustedUnitAggregationResult(aggregationResult)) {
    return Object.freeze({ ok: false, code: "SHADOW_COMPARISON_INCOMPLETE" });
  }
  const semanticUnits = [];
  const routes = [];
  const lifecycles = [];
  const canonicalItems = [];
  for (const outcome of aggregationResult.unitOutcomes) {
    semanticUnits.push({
      unitId: outcome.unitId,
      purpose: outcome.unit.purpose,
      capability: outcome.unit.capability,
      subjectKind: outcome.unit.subject.kind,
      stayDependent: outcome.unit.stayDependent,
      status: "VALIDATED",
      failureCode: outcome.failure ? outcome.failure.failureCode : null
    });
    routes.push({
      unitId: outcome.unitId,
      disposition: outcome.routingDecision.disposition,
      requiresCanonicalExecution: outcome.routingDecision.requiresCanonicalExecution,
      status: "VALIDATED",
      failureCode: outcome.failure ? outcome.failure.failureCode : null
    });
    lifecycles.push({
      unitId: outcome.unitId,
      action: outcome.lifecycleDecision.action,
      slotOperationCount: outcome.lifecycleDecision.verifiedSlotOperations.length,
      status: "VALIDATED",
      failureCode: outcome.failure ? outcome.failure.failureCode : null
    });
    if (outcome.canonicalItem) {
      canonicalItems.push({
        unitId: outcome.unitId,
        capability: outcome.canonicalItem.capabilityCandidate,
        subjectKind: outcome.canonicalItem.subjectCandidate.kind,
        stayDependent: outcome.canonicalItem.stayDependent,
        temporalKind: outcome.canonicalItem.temporalCandidate
          ? outcome.canonicalItem.temporalCandidate.kind : null,
        slotOperationCount: outcome.canonicalItem.verifiedSlotInputs.length,
        status: "ACCEPTED",
        failureCode: null
      });
    }
  }
  return Object.freeze({
    ok: true,
    code: null,
    value: deepFreeze({ semanticUnits, routes, lifecycles, canonicalItems })
  });
}

function failedRecord({ input, oldCoreOutcomeSummary, coreSha, failureCodes }) {
  try {
    const result = createShadowComparisonRecord({
      coreVersion: input && input.coreVersion,
      coreSha,
      traceId: input && input.traceId,
      oldCoreOutcomeSummary,
      newCoreOutcomeSummary: EMPTY_CORE_SUMMARY,
      validationCodes: [],
      failureCodes: uniqueCodes(failureCodes),
      sideEffectCounters: ZERO_SIDE_EFFECT_COUNTERS
    });
    if (result.ok) return result.value;
    return deepFreeze({ ok: false, code: result.code });
  } catch (_) {
    return Object.freeze({ ok: false, code: "SHADOW_COMPARISON_INCOMPLETE" });
  }
}

function validUnderstandingResult(value) {
  return isTrustedUnderstandingResult(value);
}

function processUnit({
  unit,
  index,
  contextLink,
  understandingTurnInput,
  routingRegistry,
  canonicalizerCatalog,
  catalogProjection
}) {
  if (!contextLink) return { ok: false, unitId: unit.unitId, code: "CONTEXT_TARGET_UNAVAILABLE" };
  const lifecycle = createLifecycleDecision({
    lifecycleDecisionId: lifecycleDecisionId(unit.unitId, index),
    unit,
    validatedContextLink: contextLink
  });
  if (!lifecycle.ok) return { ok: false, unitId: unit.unitId, code: lifecycle.code };
  const readiness = createUnitReadiness({
    unit,
    lifecycleDecision: lifecycle.value,
    routingRegistry
  });
  if (!readiness.ok) return { ok: false, unitId: unit.unitId, code: readiness.code };
  let operatorSafetyPolicy = null;
  if (HANDOFF_CAPABILITIES.has(unit.capability)) {
    const safety = createTrustedOperatorSafetyPolicy({
      unit,
      lifecycleDecision: lifecycle.value,
      routingRegistry
    });
    if (!safety.ok) return { ok: false, unitId: unit.unitId, code: safety.code };
    operatorSafetyPolicy = safety.value;
  }
  const route = createUnitRoutingDecision({
    unit,
    lifecycleDecision: lifecycle.value,
    routingRegistry,
    readiness: readiness.value,
    operatorSafetyPolicy
  });
  if (!route.ok) return { ok: false, unitId: unit.unitId, code: route.code };
  let canonicalItem = null;
  let canonicalFailureCode = null;
  if (route.value.disposition === "ANSWER") {
    const canonical = createCanonicalizerInputItem({
      unit,
      lifecycleDecision: lifecycle.value,
      routingDecision: route.value,
      understandingTurnInput,
      canonicalizerCatalog,
      publicCatalogIdentityProjection: catalogProjection
    });
    if (!canonical.ok) canonicalFailureCode = canonical.code;
    else {
      canonicalItem = canonical.value;
    }
  }
  return {
    ok: true,
    unit,
    lifecycleDecision: lifecycle.value,
    routingDecision: route.value,
    canonicalItem,
    failureCode: canonicalFailureCode
  };
}

function uniqueFailureRefs(values) {
  return values.filter((item, index) => (
    item && typeof item.unitId === "string" && item.unitId
    && typeof item.failureCode === "string" && item.failureCode
    && values.findIndex((candidate) => candidate && candidate.unitId === item.unitId) === index
  ));
}

function assembleShadowAggregation(understandingTurnInput, understanding) {
  const routingRegistry = createUnitReplyRoutingRegistry(projectCapabilityRegistry());
  const catalogProjection = buildPublicCatalogIdentityProjection(understandingTurnInput);
  const canonicalizerCatalog = publicCanonicalizerCatalog(understandingTurnInput);
  const results = understanding.validatedUnits.map((unit, index) => processUnit({
    unit,
    index,
    contextLink: understanding.validatedContextLinks.find((link) => link.unitId === unit.unitId),
    understandingTurnInput,
    routingRegistry,
    canonicalizerCatalog,
    catalogProjection
  }));
  const successful = results.filter((result) => result.ok);
  const providerFailures = understanding.failedUnits.map((item) => ({
    unitId: item && item.unitId,
    failureCode: failureCode(item)
  }));
  const unitFailures = results.filter((result) => !result.ok || result.failureCode).map((result) => ({
    unitId: result.unitId || result.unit.unitId,
    failureCode: result.code || result.failureCode
  }));
  const failedUnits = deepFreeze(uniqueFailureRefs([...providerFailures, ...unitFailures]));
  const aggregation = aggregateUnitOutcomes({
    turnId: understandingTurnInput.turnId,
    validatedUnits: successful.map((result) => result.unit),
    lifecycleDecisions: successful.map((result) => result.lifecycleDecision),
    routingDecisions: successful.map((result) => result.routingDecision),
    canonicalItems: successful.map((result) => result.canonicalItem).filter(Boolean),
    failedUnits
  });
  if (!aggregation.ok) {
    return Object.freeze({
      ok: false,
      failureCodes: [...failedUnits.map((item) => item.failureCode), aggregation.code]
    });
  }
  const consumed = consumeUnitAggregationResult(aggregation.value);
  if (!consumed.ok) {
    return Object.freeze({
      ok: false,
      failureCodes: [...failedUnits.map((item) => item.failureCode), consumed.code]
    });
  }
  const validationCodes = [
    "C02_UNDERSTANDING_RECEIVED",
    ...(understanding.validatedUnits.length ? [
      "C04_SOURCE_EVIDENCE_VALIDATED",
      "C03_SEMANTIC_UNIT_VALIDATED",
      "C05_CONTEXT_LINK_VALIDATED"
    ] : []),
    ...(successful.length ? ["C06_LIFECYCLE_VALIDATED", "C07_UNIT_ROUTE_VALIDATED"] : []),
    ...(successful.some((result) => result.canonicalItem)
      ? ["C08_CANONICAL_ADAPTER_ACCEPTED"] : []),
    "C09_AGGREGATION_VALIDATED"
  ];
  return Object.freeze({
    ok: true,
    summary: consumed.value,
    validationCodes: uniqueCodes(validationCodes),
    failureCodes: uniqueCodes(failedUnits.map((item) => item.failureCode))
  });
}

function assembleReadOnlyShadowComparison({
  understandingTurnInput,
  oldCoreOutcomeSummary,
  coreSha,
  understandingResult
} = {}) {
  const inputValidation = validateUnderstandingTurnInput(understandingTurnInput);
  if (!inputValidation.ok) {
    return failedRecord({
      input: understandingTurnInput,
      oldCoreOutcomeSummary,
      coreSha,
      failureCodes: [inputValidation.code]
    });
  }
  if (!oldCoreOutcomeSummary) {
    return failedRecord({
      input: understandingTurnInput,
      oldCoreOutcomeSummary: EMPTY_CORE_SUMMARY,
      coreSha,
      failureCodes: ["SHADOW_COMPARISON_INCOMPLETE"]
    });
  }
  if (!validUnderstandingResult(understandingResult)) {
    return failedRecord({
      input: understandingTurnInput,
      oldCoreOutcomeSummary,
      coreSha,
      failureCodes: ["SHADOW_COMPARISON_INCOMPLETE"]
    });
  }
  let assembled;
  try {
    assembled = assembleShadowAggregation(understandingTurnInput, understandingResult);
  } catch (_) {
    return failedRecord({
      input: understandingTurnInput,
      oldCoreOutcomeSummary,
      coreSha,
      failureCodes: ["SHADOW_COMPARISON_INCOMPLETE"]
    });
  }
  if (!assembled.ok) {
    return failedRecord({
      input: understandingTurnInput,
      oldCoreOutcomeSummary,
      coreSha,
      failureCodes: assembled.failureCodes
    });
  }
  const comparison = createShadowComparisonRecord({
    coreVersion: understandingTurnInput.coreVersion,
    coreSha,
    traceId: understandingTurnInput.traceId,
    oldCoreOutcomeSummary,
    newCoreOutcomeSummary: assembled.summary,
    validationCodes: assembled.validationCodes,
    failureCodes: assembled.failureCodes,
    sideEffectCounters: ZERO_SIDE_EFFECT_COUNTERS
  });
  if (comparison.ok) return comparison.value;
  return failedRecord({
    input: understandingTurnInput,
    oldCoreOutcomeSummary,
    coreSha,
    failureCodes: [comparison.code]
  });
}

async function runReadOnlyShadowCore(options = {}) {
  let productionInput;
  try {
    productionInput = projectProductionInput(options);
  } catch (_) {
    return Object.freeze({ ok: false, code: "SHADOW_COMPARISON_INCOMPLETE" });
  }
  if (!productionInput) {
    return Object.freeze({ ok: false, code: "SHADOW_COMPARISON_INCOMPLETE" });
  }
  const {
    understandingTurnInput,
    oldCoreOutcomeSummary,
    coreSha,
    providerConfig
  } = productionInput;
  let inputValidation;
  try {
    inputValidation = validateUnderstandingTurnInput(understandingTurnInput);
  } catch (_) {
    return Object.freeze({ ok: false, code: "SHADOW_COMPARISON_INCOMPLETE" });
  }
  if (!inputValidation.ok) {
    return failedRecord({
      input: understandingTurnInput,
      oldCoreOutcomeSummary,
      coreSha,
      failureCodes: [inputValidation.code]
    });
  }
  if (!oldCoreOutcomeSummary) {
    return failedRecord({
      input: understandingTurnInput,
      oldCoreOutcomeSummary: EMPTY_CORE_SUMMARY,
      coreSha,
      failureCodes: ["SHADOW_COMPARISON_INCOMPLETE"]
    });
  }
  let understandingResult;
  try {
    understandingResult = await callOpenAIUnderstandingV1(understandingTurnInput, {
      apiKey: providerConfig.apiKey,
      model: providerConfig.model
    });
  } catch (error) {
    return failedRecord({
      input: understandingTurnInput,
      oldCoreOutcomeSummary,
      coreSha,
      failureCodes: [failureCode(error)]
    });
  }
  return assembleReadOnlyShadowComparison({
    understandingTurnInput,
    oldCoreOutcomeSummary,
    coreSha,
    understandingResult
  });
}

module.exports = {
  assembleReadOnlyShadowComparison,
  consumeUnitAggregationResult,
  runShadowCore: runReadOnlyShadowCore,
  runReadOnlyShadowCore
};
