"use strict";

const { getCapabilityDefinition } = require("./capability-registry");

const CANONICAL_REQUEST_FIELDS = Object.freeze([
  "taskId",
  "capability",
  "canonicalEntity",
  "detailIntent",
  "temporalState",
  "stayDependency",
  "requiredFields",
  "resolverId",
  "riskLevel",
  "responseMode",
  "evidenceRefs"
]);

const TEMPORAL_STATUSES = new Set(["absent", "resolved", "unresolved"]);
const ENTITY_FIELDS = new Set(["category", "canonicalId", "canonicalSet", "status", "rawText"]);
const TEMPORAL_FIELDS = new Set([
  "rawText",
  "expressionType",
  "checkIn",
  "checkOut",
  "nights",
  "searchRange",
  "timezone",
  "resolutionStatus",
  "resolutionSource",
  "repairReasonCode",
  "applicableTaskIds",
  "ambiguity",
  "originalExpression",
  "provenance",
  "ruleRefs",
  "derivedFromFieldRefs",
  "fields"
]);
const EVIDENCE_FIELDS = new Set([
  "eventId",
  "messageRef",
  "startOffset",
  "endOffset",
  "quote"
]);
const CANONICAL_REQUEST_INSTANCES = new WeakSet();

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function exactKeys(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key));
}

function validIsoDate(value) {
  if (value === null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateCanonicalEntity(entity) {
  if (!exactKeys(entity, ENTITY_FIELDS)
    || typeof entity.category !== "string"
    || !entity.category
    || !(entity.canonicalId === null || typeof entity.canonicalId === "string")
    || (entity.rawText !== undefined && typeof entity.rawText !== "string")
    || (entity.canonicalSet !== undefined && (!Array.isArray(entity.canonicalSet)
      || entity.canonicalSet.some((item) => typeof item !== "string" || !item)))
    || (entity.status !== undefined && typeof entity.status !== "string")) return false;
  return true;
}

function validateTemporalState(state, taskId) {
  if (!exactKeys(state, TEMPORAL_FIELDS)
    || !TEMPORAL_STATUSES.has(state.resolutionStatus)
    || !validIsoDate(state.checkIn === undefined ? null : state.checkIn)
    || !validIsoDate(state.checkOut === undefined ? null : state.checkOut)
    || !(state.nights === null || state.nights === undefined
      || Number.isInteger(state.nights) && state.nights > 0)
    || !(state.searchRange === null || state.searchRange === undefined
      || state.searchRange && validIsoDate(state.searchRange.from)
      && validIsoDate(state.searchRange.to) && state.searchRange.to >= state.searchRange.from)
    || typeof state.timezone !== "string" || !state.timezone
    || !Array.isArray(state.applicableTaskIds)
    || state.applicableTaskIds.some((item) => typeof item !== "string" || !item)) return false;
  if (state.resolutionStatus === "resolved"
    && !state.checkIn && !state.searchRange) return false;
  if (state.resolutionStatus !== "resolved"
    && (state.checkIn || state.checkOut || state.searchRange)) return false;
  if (state.resolutionStatus === "resolved"
    && !state.applicableTaskIds.includes(taskId)) return false;
  return true;
}

function validateEvidenceRefs(evidenceRefs) {
  return Array.isArray(evidenceRefs) && evidenceRefs.every((reference) => (
    exactKeys(reference, EVIDENCE_FIELDS)
    && typeof reference.eventId === "string"
    && typeof reference.messageRef === "string"
    && Boolean(reference.eventId || reference.messageRef)
    && Number.isInteger(reference.startOffset)
    && Number.isInteger(reference.endOffset)
    && reference.startOffset >= 0
    && reference.endOffset >= reference.startOffset
    && typeof reference.quote === "string"
    && reference.quote.length > 0
  ));
}

function validateCanonicalRequest(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["request"] };
  }
  if (!sameArray(Object.keys(value), CANONICAL_REQUEST_FIELDS)) errors.push("keys");
  if (typeof value.taskId !== "string" || !value.taskId) errors.push("taskId");
  const definition = getCapabilityDefinition(value.capability);
  if (!definition) errors.push("capability");
  if (!validateCanonicalEntity(value.canonicalEntity)) errors.push("canonicalEntity");
  if (typeof value.detailIntent !== "string" || !value.detailIntent) errors.push("detailIntent");
  if (!validateTemporalState(value.temporalState, value.taskId)) errors.push("temporalState");
  if (!Array.isArray(value.requiredFields)
    || value.requiredFields.some((field) => typeof field !== "string" || !field)) errors.push("requiredFields");
  if (!validateEvidenceRefs(value.evidenceRefs)) errors.push("evidenceRefs");
  if (definition) {
    if (value.stayDependency !== definition.stayDependency) errors.push("stayDependency_registry_mismatch");
    if (!sameArray(value.requiredFields, definition.requiredFields)) errors.push("requiredFields_registry_mismatch");
    if (value.resolverId !== definition.resolverId) errors.push("resolverId_registry_mismatch");
    if (value.riskLevel !== definition.riskLevel) errors.push("riskLevel_registry_mismatch");
    if (value.responseMode !== definition.responseMode) errors.push("responseMode_registry_mismatch");
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function createCanonicalRequest(value) {
  const copy = deepClone(value);
  const validation = validateCanonicalRequest(copy);
  if (!validation.ok) {
    const error = new TypeError(`invalid_canonical_request:${validation.errors.join(",")}`);
    error.code = "invalid_canonical_request";
    error.validationErrors = validation.errors;
    throw error;
  }
  const request = deepFreeze(copy);
  CANONICAL_REQUEST_INSTANCES.add(request);
  return request;
}

function isCanonicalRequest(value) {
  return Boolean(value && typeof value === "object"
    && CANONICAL_REQUEST_INSTANCES.has(value)
    && validateCanonicalRequest(value).ok
    && Object.isFrozen(value));
}

function assertCanonicalRequest(value) {
  if (!isCanonicalRequest(value)) {
    const error = new TypeError("canonical_request_required");
    error.code = "canonical_request_required";
    throw error;
  }
  return value;
}

module.exports = {
  CANONICAL_REQUEST_FIELDS,
  assertCanonicalRequest,
  createCanonicalRequest,
  isCanonicalRequest,
  validateCanonicalRequest
};
