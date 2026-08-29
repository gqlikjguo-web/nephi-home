"use strict";

const crypto = require("node:crypto");
const {
  OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC,
  callOpenAIUnderstandingV1
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
  createShadowComparisonRecord
} = require("./shadow-comparator");

const HANDOFF_CAPABILITIES = new Set(["booking_operator_request", "high_risk"]);
const EMPTY_CORE_SUMMARY = deepFreeze({
  semanticUnits: [], routes: [], lifecycles: [], canonicalItems: []
});
const PRODUCTION_INPUT_FIELDS = Object.freeze([
  "understandingTurnInput", "oldCoreOutcomeSummary", "coreSha", "providerConfig"
]);
const PROVIDER_CONFIG_FIELDS = Object.freeze(["apiKey", "model"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function exactKeys(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((field) => fields.includes(field));
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
}

function validUnderstandingResult(value) {
  return Boolean(value) && typeof value === "object"
    && Array.isArray(value.validatedUnits)
    && Array.isArray(value.validatedContextLinks)
    && Array.isArray(value.failedUnits)
    && Object.hasOwn(value, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC);
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
  if (!exactKeys(options, PRODUCTION_INPUT_FIELDS)
    || !exactKeys(options.providerConfig, PROVIDER_CONFIG_FIELDS)
    || typeof options.providerConfig.apiKey !== "string"
    || options.providerConfig.apiKey.length < 1
    || options.providerConfig.apiKey.length > 1000
    || typeof options.providerConfig.model !== "string"
    || options.providerConfig.model.length < 1
    || options.providerConfig.model.length > 160) {
    return Object.freeze({ ok: false, code: "SHADOW_COMPARISON_INCOMPLETE" });
  }
  const {
    understandingTurnInput,
    oldCoreOutcomeSummary,
    coreSha,
    providerConfig
  } = options;
  const inputValidation = validateUnderstandingTurnInput(understandingTurnInput);
  if (!inputValidation.ok) {
    return failedRecord({
      input: understandingTurnInput,
      oldCoreOutcomeSummary,
      coreSha,
      failureCodes: [inputValidation.code]
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
