"use strict";

const crypto = require("node:crypto");
const OWNERSHIP_MANIFEST = require("../../docs/new-core-contract-ownership.json");

const CORE_VERSION = "new-core-v1";
const MAX_SUMMARY_ITEMS = 100;
const MAX_CODES = 100;
const HASH_PATTERN = /^h:[a-f0-9]{64}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const PURPOSES = new Set([
  "lodging_question", "operator_request", "sensitive_request", "acknowledgement", "conversational_statement",
  "correction", "supplement", "cancellation", "context_update", "social",
  "off_topic", "unknown"
]);
const CAPABILITIES = new Set([
  "availability", "available_dates", "price", "total_price", "capacity",
  "property_fact", "amenity", "policy", "location", "booking_operator_request",
  "high_risk", "unsupported", null
]);
const SUBJECT_KINDS = new Set([
  "property", "room", "bundle", "matched_room_set", "amenity", "policy",
  "external_place", "other_verified", null
]);
const DISPOSITIONS = new Set(["ANSWER", "CLARIFY", "HANDOFF", "NO_REPLY"]);
const LIFECYCLE_ACTIONS = new Set(["START", "CONTINUE", "MODIFY", "END", "NONE"]);
const TEMPORAL_KINDS = new Set([
  "absolute_date", "date_range", "relative_date", "relative_range", "weekday",
  "month_weekday", "nights_only", "partial", "unknown", null
]);
const SUMMARY_STATUSES = new Set(["VALIDATED", "REJECTED"]);
const CANONICAL_STATUSES = new Set(["ACCEPTED", "REJECTED"]);
const RECORD_STATUSES = new Set(["SUCCESS", "PARTIAL", "FAILED"]);
const FAILURE_CODES = new Set(Object.keys(OWNERSHIP_MANIFEST.failureCodeOwners || {}));
const VALIDATION_CODES = new Set((OWNERSHIP_MANIFEST.contracts || []).flatMap((contract) => (
  Array.isArray(contract.diagnosticMarkers) ? contract.diagnosticMarkers : []
)));
const SIDE_EFFECT_FIELDS = Object.freeze([
  "stateWrites", "messageWrites", "reviewWrites", "resolverCalls",
  "postgresMutations", "lineCalls"
]);
const SUMMARY_FIELDS = Object.freeze([
  "semanticUnits", "routes", "lifecycles", "canonicalItems"
]);
const RECORD_FIELDS = Object.freeze([
  "schemaVersion", "coreVersion", "coreSha", "traceHash", "status",
  "oldCoreSummary", "newCoreSummary", "diffSummary", "validationCodes",
  "failureCodes", "sideEffectCounters"
]);
const DIFF_FIELDS = Object.freeze([
  "match", "oldCount", "newCount", "addedSignatureHashes", "removedSignatureHashes"
]);
const ENTRY_FIELDS = Object.freeze({
  semanticUnits: ["keyHash", "purpose", "capability", "subjectKind", "stayDependent", "status", "failureCode"],
  routes: ["keyHash", "disposition", "requiresCanonicalExecution", "status", "failureCode"],
  lifecycles: ["keyHash", "action", "slotOperationCount", "status", "failureCode"],
  canonicalItems: ["keyHash", "capability", "subjectKind", "stayDependent", "temporalKind", "slotOperationCount", "status", "failureCode"]
});

const ZERO_SIDE_EFFECT_COUNTERS = deepFreeze(Object.fromEntries(
  SIDE_EFFECT_FIELDS.map((field) => [field, 0])
));

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function detach(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(detach);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, detach(item)]));
}

function fixedFailure(code) {
  return Object.freeze({ ok: false, code });
}

function exactKeys(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((field) => fields.includes(field));
}

function hash(value) {
  return `h:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function safeHash(value, fallback) {
  if (typeof value === "string" && HASH_PATTERN.test(value)) return value;
  if (typeof value === "string" && value.length > 0 && value.length <= 160) return hash(value);
  return hash(fallback);
}

function safeFailureCode(value) {
  return value === null || value === undefined ? null : FAILURE_CODES.has(value) ? value : null;
}

function boundedCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1000 ? value : 0;
}

function safeArray(value) {
  return Array.isArray(value) ? value.slice(0, MAX_SUMMARY_ITEMS) : [];
}

function projectSemanticUnit(item, index) {
  return {
    keyHash: safeHash(item.keyHash || item.unitId, `semantic-${index}`),
    purpose: item.purpose,
    capability: item.capability,
    subjectKind: item.subjectKind,
    stayDependent: item.stayDependent,
    status: item.status,
    failureCode: item.failureCode
  };
}

function projectRoute(item, index) {
  return {
    keyHash: safeHash(item.keyHash || item.unitId, `route-${index}`),
    disposition: item.disposition,
    requiresCanonicalExecution: item.requiresCanonicalExecution,
    status: item.status,
    failureCode: item.failureCode
  };
}

function projectLifecycle(item, index) {
  return {
    keyHash: safeHash(item.keyHash || item.unitId, `lifecycle-${index}`),
    action: item.action,
    slotOperationCount: item.slotOperationCount,
    status: item.status,
    failureCode: item.failureCode
  };
}

function projectCanonicalItem(item, index) {
  return {
    keyHash: safeHash(item.keyHash || item.unitId, `canonical-${index}`),
    capability: item.capability,
    subjectKind: item.subjectKind,
    stayDependent: item.stayDependent,
    temporalKind: item.temporalKind,
    slotOperationCount: item.slotOperationCount,
    status: item.status,
    failureCode: item.failureCode
  };
}

function sourceEntryKeys(field, identityField) {
  let fields;
  if (field === "semanticUnits") fields = ENTRY_FIELDS.semanticUnits;
  else if (field === "routes") fields = ENTRY_FIELDS.routes;
  else if (field === "lifecycles") fields = ENTRY_FIELDS.lifecycles;
  else fields = ENTRY_FIELDS.canonicalItems;
  return fields.map((key) => key === "keyHash" ? identityField : key);
}

function validSourceIdentity(item) {
  if (Object.hasOwn(item, "keyHash")) return HASH_PATTERN.test(item.keyHash);
  return typeof item.unitId === "string" && item.unitId.length > 0 && item.unitId.length <= 160;
}

function validateSourceEntry(field, item) {
  if (!item || typeof item !== "object" || Array.isArray(item)
    || !(exactKeys(item, sourceEntryKeys(field, "keyHash"))
      || exactKeys(item, sourceEntryKeys(field, "unitId")))
    || !validSourceIdentity(item) || !validFailureCode(item.failureCode)) return false;
  if (field === "semanticUnits") {
    return PURPOSES.has(item.purpose) && CAPABILITIES.has(item.capability)
      && SUBJECT_KINDS.has(item.subjectKind) && typeof item.stayDependent === "boolean"
      && SUMMARY_STATUSES.has(item.status);
  }
  if (field === "routes") {
    return DISPOSITIONS.has(item.disposition) && typeof item.requiresCanonicalExecution === "boolean"
      && SUMMARY_STATUSES.has(item.status);
  }
  if (field === "lifecycles") {
    return LIFECYCLE_ACTIONS.has(item.action)
      && boundedCount(item.slotOperationCount) === item.slotOperationCount
      && SUMMARY_STATUSES.has(item.status);
  }
  return CAPABILITIES.has(item.capability) && item.capability !== null
    && SUBJECT_KINDS.has(item.subjectKind) && item.subjectKind !== null
    && typeof item.stayDependent === "boolean" && TEMPORAL_KINDS.has(item.temporalKind)
    && boundedCount(item.slotOperationCount) === item.slotOperationCount
    && CANONICAL_STATUSES.has(item.status);
}

function validateSourceCoreSummary(value) {
  if (!exactKeys(value, SUMMARY_FIELDS)) return false;
  const validateField = (items, field) => {
    if (!Array.isArray(items) || items.length > MAX_SUMMARY_ITEMS
      || !items.every((item) => validateSourceEntry(field, item))) return false;
    const keys = items.map((item) => item.keyHash || item.unitId);
    return new Set(keys).size === keys.length;
  };
  return validateField(value.semanticUnits, "semanticUnits")
    && validateField(value.routes, "routes")
    && validateField(value.lifecycles, "lifecycles")
    && validateField(value.canonicalItems, "canonicalItems");
}

function projectCoreSummary(value) {
  if (!validateSourceCoreSummary(value)) return null;
  return deepFreeze({
    semanticUnits: value.semanticUnits.map(projectSemanticUnit),
    routes: value.routes.map(projectRoute),
    lifecycles: value.lifecycles.map(projectLifecycle),
    canonicalItems: value.canonicalItems.map(projectCanonicalItem)
  });
}

function signatureHash(entry) {
  return hash(JSON.stringify(entry));
}

function occurrenceCount(values, target, end = values.length) {
  let count = 0;
  for (let index = 0; index < end; index += 1) {
    if (values[index] === target) count += 1;
  }
  return count;
}

function compareEntries(oldEntries, newEntries) {
  const oldSignatures = oldEntries.map(signatureHash);
  const newSignatures = newEntries.map(signatureHash);
  const addedSignatureHashes = newSignatures.filter((signature, index) => (
    occurrenceCount(newSignatures, signature, index + 1) > occurrenceCount(oldSignatures, signature)
  ));
  const removedSignatureHashes = oldSignatures.filter((signature, index) => (
    occurrenceCount(oldSignatures, signature, index + 1) > occurrenceCount(newSignatures, signature)
  ));
  return deepFreeze({
    match: addedSignatureHashes.length === 0 && removedSignatureHashes.length === 0,
    oldCount: oldEntries.length,
    newCount: newEntries.length,
    addedSignatureHashes,
    removedSignatureHashes
  });
}

function createDiffSummary(oldSummary, newSummary) {
  return deepFreeze(Object.fromEntries(SUMMARY_FIELDS.map((field) => [
    field,
    compareEntries(oldSummary[field], newSummary[field])
  ])));
}

function validFailureCode(value) {
  return value === null || FAILURE_CODES.has(value);
}

function validateEntry(field, value) {
  if (!exactKeys(value, ENTRY_FIELDS[field]) || !HASH_PATTERN.test(value.keyHash)
    || !validFailureCode(value.failureCode)) return false;
  if (field === "semanticUnits") {
    return PURPOSES.has(value.purpose) && CAPABILITIES.has(value.capability)
      && SUBJECT_KINDS.has(value.subjectKind) && typeof value.stayDependent === "boolean"
      && SUMMARY_STATUSES.has(value.status);
  }
  if (field === "routes") {
    return DISPOSITIONS.has(value.disposition) && typeof value.requiresCanonicalExecution === "boolean"
      && SUMMARY_STATUSES.has(value.status);
  }
  if (field === "lifecycles") {
    return LIFECYCLE_ACTIONS.has(value.action) && boundedCount(value.slotOperationCount) === value.slotOperationCount
      && SUMMARY_STATUSES.has(value.status);
  }
  return CAPABILITIES.has(value.capability) && value.capability !== null
    && SUBJECT_KINDS.has(value.subjectKind) && value.subjectKind !== null
    && typeof value.stayDependent === "boolean" && TEMPORAL_KINDS.has(value.temporalKind)
    && boundedCount(value.slotOperationCount) === value.slotOperationCount
    && CANONICAL_STATUSES.has(value.status);
}

function validateCoreSummary(value) {
  if (!exactKeys(value, SUMMARY_FIELDS)) return false;
  for (const field of SUMMARY_FIELDS) {
    const items = value[field];
    if (!Array.isArray(items) || items.length > MAX_SUMMARY_ITEMS) return false;
    for (const item of items) {
      if (!validateEntry(field, item)) return false;
    }
  }
  return true;
}

function validateDiffSummary(value, oldSummary, newSummary) {
  if (!exactKeys(value, SUMMARY_FIELDS)) return false;
  return SUMMARY_FIELDS.every((field) => {
    const diff = value[field];
    if (!exactKeys(diff, DIFF_FIELDS) || typeof diff.match !== "boolean"
      || diff.oldCount !== oldSummary[field].length || diff.newCount !== newSummary[field].length
      || !Array.isArray(diff.addedSignatureHashes) || !Array.isArray(diff.removedSignatureHashes)
      || !diff.addedSignatureHashes.every((item) => HASH_PATTERN.test(item))
      || !diff.removedSignatureHashes.every((item) => HASH_PATTERN.test(item))) return false;
    const expected = compareEntries(oldSummary[field], newSummary[field]);
    return JSON.stringify(diff) === JSON.stringify(expected);
  });
}

function validateSideEffectCounters(value) {
  if (!exactKeys(value, SIDE_EFFECT_FIELDS)) return "SHADOW_RECORD_UNSAFE";
  if (SIDE_EFFECT_FIELDS.some((field) => !Number.isInteger(value[field]) || value[field] < 0)) {
    return "SHADOW_RECORD_UNSAFE";
  }
  if (SIDE_EFFECT_FIELDS.some((field) => value[field] !== 0)) return "SHADOW_SIDE_EFFECT_ATTEMPT";
  return null;
}

function validateShadowComparisonRecord(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return fixedFailure("SHADOW_COMPARISON_INCOMPLETE");
    }
    if (Object.keys(value).some((field) => !RECORD_FIELDS.includes(field))) {
      return fixedFailure("SHADOW_RECORD_UNSAFE");
    }
    if (!RECORD_FIELDS.every((field) => Object.hasOwn(value, field))) {
      return fixedFailure("SHADOW_COMPARISON_INCOMPLETE");
    }
    const sideEffectFailure = validateSideEffectCounters(value.sideEffectCounters);
    if (sideEffectFailure) return fixedFailure(sideEffectFailure);
    if (!validateCoreSummary(value.oldCoreSummary)
      || !validateCoreSummary(value.newCoreSummary)
      || !validateDiffSummary(value.diffSummary, value.oldCoreSummary, value.newCoreSummary)) {
      return fixedFailure("SHADOW_COMPARISON_INCOMPLETE");
    }
    if (value.schemaVersion !== 1 || value.coreVersion !== CORE_VERSION
      || !SHA_PATTERN.test(value.coreSha) || !HASH_PATTERN.test(value.traceHash)
      || !RECORD_STATUSES.has(value.status)
      || !Array.isArray(value.validationCodes) || value.validationCodes.length > MAX_CODES
      || !value.validationCodes.every((code) => VALIDATION_CODES.has(code))
      || !Array.isArray(value.failureCodes) || value.failureCodes.length > MAX_CODES
      || !value.failureCodes.every((code) => FAILURE_CODES.has(code))) {
      return fixedFailure("SHADOW_RECORD_UNSAFE");
    }
    const expectedStatus = value.failureCodes.length === 0
      ? "SUCCESS"
      : SUMMARY_FIELDS.some((field) => value.newCoreSummary[field].length > 0) ? "PARTIAL" : "FAILED";
    if (value.status !== expectedStatus) return fixedFailure("SHADOW_COMPARISON_INCOMPLETE");
    return Object.freeze({ ok: true, code: null, value: deepFreeze(detach(value)) });
  } catch (_) {
    return fixedFailure("SHADOW_RECORD_UNSAFE");
  }
}

function createShadowComparisonRecord({
  coreVersion,
  coreSha,
  traceId,
  oldCoreOutcomeSummary,
  newCoreOutcomeSummary,
  validationCodes = [],
  failureCodes = [],
  sideEffectCounters = ZERO_SIDE_EFFECT_COUNTERS
} = {}) {
  try {
    if (coreVersion !== CORE_VERSION || typeof traceId !== "string" || traceId.length < 1
      || traceId.length > 160 || !SHA_PATTERN.test(coreSha)) {
      return fixedFailure("SHADOW_COMPARISON_INCOMPLETE");
    }
    if (!validateSourceCoreSummary(oldCoreOutcomeSummary)
      || !validateSourceCoreSummary(newCoreOutcomeSummary)) {
      return fixedFailure("SHADOW_COMPARISON_INCOMPLETE");
    }
    const oldCoreSummary = projectCoreSummary(oldCoreOutcomeSummary);
    const newCoreSummary = projectCoreSummary(newCoreOutcomeSummary);
    if (!Array.isArray(validationCodes) || validationCodes.length > MAX_CODES
      || validationCodes.some((code) => !VALIDATION_CODES.has(code))) {
      return fixedFailure("SHADOW_RECORD_UNSAFE");
    }
    const safeValidationCodes = [...new Set(validationCodes)];
    const safeFailureCodes = [...new Set(safeArray(failureCodes).filter((code) => FAILURE_CODES.has(code)))];
    if (safeFailureCodes.length !== safeArray(failureCodes).length) {
      return fixedFailure("SHADOW_COMPARISON_INCOMPLETE");
    }
    const counters = Object.fromEntries(SIDE_EFFECT_FIELDS.map((field) => [
      field,
      sideEffectCounters && sideEffectCounters[field]
    ]));
    const sideEffectFailure = validateSideEffectCounters(counters);
    if (sideEffectFailure) return fixedFailure(sideEffectFailure);
    const record = {
      schemaVersion: 1,
      coreVersion,
      coreSha,
      traceHash: hash(traceId),
      status: safeFailureCodes.length === 0
        ? "SUCCESS"
        : SUMMARY_FIELDS.some((field) => newCoreSummary[field].length > 0) ? "PARTIAL" : "FAILED",
      oldCoreSummary,
      newCoreSummary,
      diffSummary: createDiffSummary(oldCoreSummary, newCoreSummary),
      validationCodes: safeValidationCodes,
      failureCodes: safeFailureCodes,
      sideEffectCounters: counters
    };
    return validateShadowComparisonRecord(record);
  } catch (_) {
    return fixedFailure("SHADOW_RECORD_UNSAFE");
  }
}

module.exports = {
  ZERO_SIDE_EFFECT_COUNTERS,
  createShadowComparisonRecord,
  projectCoreSummary,
  validateShadowComparisonRecord
};
