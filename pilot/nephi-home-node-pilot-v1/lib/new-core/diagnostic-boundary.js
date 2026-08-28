"use strict";

const crypto = require("node:crypto");
const OWNERSHIP_MANIFEST = require("../../docs/new-core-contract-ownership.json");

const CORE_VERSION = "new-core-v1";
const MAX_UNIT_IDS = 100;
const EVENT_INPUT_FIELDS = new Set([
  "coreVersion", "traceId", "boundary", "inputUnitIds", "outputUnitIds", "status",
  "failureCode", "failureClass", "contextResult", "lifecycleResult", "routeResult",
  "canonicalResult", "targetMarker", "timestamp"
]);
const EVENT_FIELDS = new Set([...EVENT_INPUT_FIELDS, "isEarliestFailure"]);
const STATUSES = new Set(["SUCCESS", "FAILURE"]);
const FAILURE_CLASSES = new Set(["NONE", "CONTRACT", "PROVIDER_TIMEOUT", "DIAGNOSTIC"]);
const CONTEXT_RESULTS = new Set(["NOT_APPLICABLE", "VALIDATED", "REJECTED"]);
const LIFECYCLE_RESULTS = new Set(["NOT_APPLICABLE", "START", "CONTINUE", "MODIFY", "END", "NONE", "REJECTED"]);
const ROUTE_RESULTS = new Set(["NOT_APPLICABLE", "ANSWER", "CLARIFY", "HANDOFF", "NO_REPLY", "REJECTED"]);
const CANONICAL_RESULTS = new Set(["NOT_APPLICABLE", "NOT_REQUIRED", "ACCEPTED", "REJECTED"]);
const CONTRACT_IDS = Object.freeze(Array.from({ length: 11 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`));
const CONTRACT_ID_SET = new Set(CONTRACT_IDS);

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

function fixedFailure(code) { return Object.freeze({ ok: false, code }); }

function exactKeys(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.size && Object.keys(value).every((key) => fields.has(key));
}

function rawIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function sanitizedIdentifier(value) { return typeof value === "string" && /^h:[a-f0-9]{64}$/.test(value); }

function projectIdentifier(kind, value) {
  return `h:${crypto.createHash("sha256").update(`new-core-c11:${kind}:`, "utf8").update(value, "utf8").digest("hex")}`;
}

function boundedRawUnitIds(value) {
  return Array.isArray(value) && value.length <= MAX_UNIT_IDS
    && value.every(rawIdentifier) && new Set(value).size === value.length;
}

function boundedSanitizedUnitIds(value) {
  return Array.isArray(value) && value.length <= MAX_UNIT_IDS
    && value.every(sanitizedIdentifier) && new Set(value).size === value.length;
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 80 && Number.isFinite(Date.parse(value));
}

function contractRecords(manifest = OWNERSHIP_MANIFEST) {
  return Array.isArray(manifest && manifest.contracts) ? manifest.contracts : [];
}

function markerOwnership(manifest = OWNERSHIP_MANIFEST) {
  const ownership = new Map();
  for (const contract of contractRecords(manifest)) {
    for (const marker of Array.isArray(contract.diagnosticMarkers) ? contract.diagnosticMarkers : []) {
      if (!ownership.has(marker)) ownership.set(marker, contract.contractId);
      else ownership.set(marker, null);
    }
  }
  return ownership;
}

const FAILURE_OWNERS = new Map(Object.entries(OWNERSHIP_MANIFEST.failureCodeOwners || {}));
const MARKER_OWNERS = markerOwnership();

function failureCodeOwner(code) { return FAILURE_OWNERS.get(code) || null; }

function detachedEvent(value) {
  return deepFreeze({
    coreVersion: value.coreVersion, traceId: value.traceId, boundary: value.boundary,
    inputUnitIds: [...value.inputUnitIds], outputUnitIds: [...value.outputUnitIds], status: value.status,
    failureCode: value.failureCode, failureClass: value.failureClass, contextResult: value.contextResult,
    lifecycleResult: value.lifecycleResult, routeResult: value.routeResult, canonicalResult: value.canonicalResult,
    targetMarker: value.targetMarker, timestamp: value.timestamp, isEarliestFailure: value.isEarliestFailure
  });
}

function validateDiagnosticBoundaryEvent(value) {
  try {
    if (!exactKeys(value, EVENT_FIELDS)) return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    if (value.coreVersion !== CORE_VERSION || !sanitizedIdentifier(value.traceId)
      || !boundedSanitizedUnitIds(value.inputUnitIds) || !boundedSanitizedUnitIds(value.outputUnitIds)
      || !STATUSES.has(value.status) || !FAILURE_CLASSES.has(value.failureClass)
      || !CONTEXT_RESULTS.has(value.contextResult) || !LIFECYCLE_RESULTS.has(value.lifecycleResult)
      || !ROUTE_RESULTS.has(value.routeResult) || !CANONICAL_RESULTS.has(value.canonicalResult)
      || typeof value.isEarliestFailure !== "boolean" || !validTimestamp(value.timestamp)) {
      return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    }
    if (!CONTRACT_ID_SET.has(value.boundary)) return fixedFailure("DIAGNOSTIC_BOUNDARY_UNKNOWN");
    if (MARKER_OWNERS.get(value.targetMarker) !== value.boundary) return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    if (value.status === "SUCCESS") {
      if (value.failureCode !== null || value.failureClass !== "NONE" || value.isEarliestFailure) {
        return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
      }
    } else {
      if (typeof value.failureCode !== "string" || failureCodeOwner(value.failureCode) !== value.boundary) {
        return fixedFailure("DIAGNOSTIC_CODE_UNOWNED");
      }
      const expected = value.failureCode === "UNDERSTANDING_PROVIDER_TIMEOUT"
        ? "PROVIDER_TIMEOUT" : value.boundary === "C11" ? "DIAGNOSTIC" : "CONTRACT";
      if (value.failureClass !== expected) return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    }
    if ((value.status === "FAILURE") !== /_(REJECTED|TIMEOUT)$/.test(value.targetMarker)) {
      return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    }
    return Object.freeze({ ok: true, code: null, value: detachedEvent(value) });
  } catch (_) { return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN"); }
}

function createDiagnosticBoundaryEvent(input, { isEarliestFailure = false } = {}) {
  try {
    if (!exactKeys(input, EVENT_INPUT_FIELDS) || typeof isEarliestFailure !== "boolean"
      || !rawIdentifier(input.traceId) || !boundedRawUnitIds(input.inputUnitIds)
      || !boundedRawUnitIds(input.outputUnitIds)) return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    const validation = validateDiagnosticBoundaryEvent({
      coreVersion: input.coreVersion, traceId: projectIdentifier("trace", input.traceId), boundary: input.boundary,
      inputUnitIds: input.inputUnitIds.map((id) => projectIdentifier("unit", id)),
      outputUnitIds: input.outputUnitIds.map((id) => projectIdentifier("unit", id)),
      status: input.status, failureCode: input.failureCode, failureClass: input.failureClass,
      contextResult: input.contextResult, lifecycleResult: input.lifecycleResult, routeResult: input.routeResult,
      canonicalResult: input.canonicalResult, targetMarker: input.targetMarker, timestamp: input.timestamp,
      isEarliestFailure
    });
    return validation.ok ? Object.freeze({ ok: true, code: null, value: validation.value }) : validation;
  } catch (_) { return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN"); }
}

function createDiagnosticTraceEmitter({ traceId, sink = null } = {}) {
  let failureObserved = false;
  return Object.freeze({
    emit(input) {
      try {
        if (!rawIdentifier(traceId) || !input || input.traceId !== traceId) return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
        const failure = input.status === "FAILURE";
        const projected = createDiagnosticBoundaryEvent(input, { isEarliestFailure: failure && !failureObserved });
        if (!projected.ok) return projected;
        if (failure) failureObserved = true;
        let delivered = false;
        if (typeof sink === "function") {
          try {
            const result = sink(projected.value);
            if (result && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") {
              Promise.resolve(result).catch(() => undefined);
            } else delivered = true;
          } catch (_) { delivered = false; }
        }
        return Object.freeze({ ok: true, event: projected.value, delivered });
      } catch (_) { return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN"); }
    }
  });
}

function verifyNewCoreMaintainability(options) {
  return require("./maintainability-inspector").verifyNewCoreMaintainability(options);
}

module.exports = {
  CORE_VERSION, createDiagnosticBoundaryEvent, createDiagnosticTraceEmitter, failureCodeOwner,
  validateDiagnosticBoundaryEvent, verifyNewCoreMaintainability
};
