"use strict";

const { validateSemanticUnitCandidate } = require("./semantic-unit-candidate");
const { validateLifecycleDecision } = require("../lifecycle-manager");
const { validateUnitRoutingDecision } = require("./unit-routing-decision");

const UNIT_AGGREGATION_RESULT_FIELDS = Object.freeze([
  "turnId",
  "unitOutcomes",
  "canonicalItems",
  "hasReplyWork",
  "hasClarification",
  "hasHandoff",
  "allNoReply",
  "failedUnits"
]);
const UNIT_OUTCOME_FIELDS = Object.freeze([
  "unitId",
  "unit",
  "lifecycleDecision",
  "routingDecision",
  "canonicalItem",
  "downstreamOutcomeRef",
  "failure"
]);
const FAILURE_REF_FIELDS = Object.freeze(["unitId", "failureCode"]);
const DOWNSTREAM_OUTCOME_REF_FIELDS = Object.freeze(["unitId", "outcomeRef"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, fields) {
  return isPlainObject(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((key) => fields.includes(key));
}

function boundedText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function validFailureRef(value) {
  return exactKeys(value, FAILURE_REF_FIELDS)
    && boundedText(value.unitId)
    && boundedText(value.failureCode);
}

function validateUnitAggregationResult(value) {
  const errors = [];
  if (!exactKeys(value, UNIT_AGGREGATION_RESULT_FIELDS)) errors.push("keys");
  if (!boundedText(value && value.turnId)) errors.push("turnId");
  if (!Array.isArray(value && value.unitOutcomes)) errors.push("unitOutcomes");
  if (!Array.isArray(value && value.canonicalItems)) errors.push("canonicalItems");
  if (!Array.isArray(value && value.failedUnits)) errors.push("failedUnits");
  for (const field of ["hasReplyWork", "hasClarification", "hasHandoff", "allNoReply"]) {
    if (typeof (value && value[field]) !== "boolean") errors.push(field);
  }
  if (Array.isArray(value && value.unitOutcomes)) {
    const unitIds = new Set();
    const canonicalByUnitId = new Map();
    const failureByUnitId = new Map();
    value.unitOutcomes.forEach((outcome, index) => {
      const prefix = `unitOutcomes.${index}`;
      if (!exactKeys(outcome, UNIT_OUTCOME_FIELDS)) errors.push(`${prefix}.keys`);
      if (!boundedText(outcome && outcome.unitId)) errors.push(`${prefix}.unitId`);
      if (unitIds.has(outcome && outcome.unitId)) errors.push("unitOutcomes.duplicate");
      unitIds.add(outcome && outcome.unitId);
      if (!validateSemanticUnitCandidate(outcome && outcome.unit).ok || outcome.unit.unitId !== outcome.unitId) {
        errors.push(`${prefix}.unit`);
      }
      if (!validateLifecycleDecision(outcome && outcome.lifecycleDecision, { unitIds: [outcome && outcome.unitId] }).ok) {
        errors.push(`${prefix}.lifecycleDecision`);
      }
      const route = validateUnitRoutingDecision(outcome && outcome.routingDecision);
      if (!route.ok || outcome.routingDecision.unitId !== outcome.unitId) errors.push(`${prefix}.routingDecision`);
      if (outcome && outcome.canonicalItem !== null
        && (!isPlainObject(outcome.canonicalItem) || outcome.canonicalItem.unitId !== outcome.unitId)) {
        errors.push(`${prefix}.canonicalItem`);
      }
      if (outcome && outcome.downstreamOutcomeRef !== null && !isPlainObject(outcome.downstreamOutcomeRef)) {
        errors.push(`${prefix}.downstreamOutcomeRef`);
      }
      if (outcome && outcome.failure !== null
        && (!validFailureRef(outcome.failure) || outcome.failure.unitId !== outcome.unitId)) {
        errors.push(`${prefix}.failure`);
      }
      if (outcome && outcome.canonicalItem !== null) canonicalByUnitId.set(outcome.unitId, outcome.canonicalItem);
      if (outcome && outcome.failure !== null) failureByUnitId.set(outcome.unitId, outcome.failure);
      if (route.ok && outcome) {
        if (route.value.disposition === "ANSWER" && outcome.canonicalItem === null && outcome.failure === null) {
          errors.push(`${prefix}.answerCanonical`);
        }
        if (route.value.disposition !== "ANSWER" && outcome.canonicalItem !== null) errors.push(`${prefix}.nonAnswerCanonical`);
      }
    });
    const expectedFlags = {
      hasReplyWork: value.unitOutcomes.some((outcome) => outcome.routingDecision && outcome.routingDecision.disposition !== "NO_REPLY"),
      hasClarification: value.unitOutcomes.some((outcome) => outcome.routingDecision && outcome.routingDecision.disposition === "CLARIFY"),
      hasHandoff: value.unitOutcomes.some((outcome) => outcome.routingDecision && outcome.routingDecision.disposition === "HANDOFF"),
      allNoReply: value.unitOutcomes.every((outcome) => outcome.routingDecision && outcome.routingDecision.disposition === "NO_REPLY")
    };
    for (const [field, expected] of Object.entries(expectedFlags)) {
      if (value && value[field] !== expected) errors.push(field);
    }
    if (Array.isArray(value && value.canonicalItems)) {
      const canonicalItemIds = new Set();
      value.canonicalItems.forEach((item) => {
        if (!isPlainObject(item) || !boundedText(item.unitId) || canonicalItemIds.has(item.unitId)
          || canonicalByUnitId.get(item.unitId) !== item) {
          errors.push("canonicalItems.ownership");
        }
        canonicalItemIds.add(item && item.unitId);
      });
      if (canonicalItemIds.size !== canonicalByUnitId.size) errors.push("canonicalItems.coverage");
    }
    if (Array.isArray(value && value.failedUnits)) {
      const failedUnitIds = new Set();
      value.failedUnits.forEach((item) => {
        if (!validFailureRef(item) || failedUnitIds.has(item.unitId)) errors.push("failedUnits.item");
        failedUnitIds.add(item && item.unitId);
      });
      for (const [unitId, failure] of failureByUnitId) {
        if (!value.failedUnits.includes(failure) || !failedUnitIds.has(unitId)) errors.push("failedUnits.coverage");
      }
    }
  }
  if (Array.isArray(value && value.canonicalItems)
    && value.canonicalItems.some((item) => !isPlainObject(item) || !boundedText(item.unitId))) {
    errors.push("canonicalItems.item");
  }
  if (Array.isArray(value && value.failedUnits)
    && value.failedUnits.some((item) => !validFailureRef(item))) {
    errors.push("failedUnits.item");
  }
  if (!errors.length) return { ok: true, code: null, errors: [], value };
  return { ok: false, code: "UNIT_AGGREGATION_INVALID", errors: [...new Set(errors)] };
}

module.exports = {
  UNIT_AGGREGATION_RESULT_FIELDS,
  UNIT_OUTCOME_FIELDS,
  FAILURE_REF_FIELDS,
  DOWNSTREAM_OUTCOME_REF_FIELDS,
  validateUnitAggregationResult
};
