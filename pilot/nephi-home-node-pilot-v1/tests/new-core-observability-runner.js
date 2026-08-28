"use strict";

const assert = require("node:assert/strict");

const {
  CORE_VERSION,
  createDiagnosticBoundaryEvent,
  createDiagnosticTraceEmitter,
  failureCodeOwner,
  validateDiagnosticBoundaryEvent
} = require("../lib/new-core/diagnostic-boundary");

const FIXED_TIME = "2026-08-29T00:00:00.000Z";

function base(overrides = {}) {
  return {
    coreVersion: "new-core-v1",
    traceId: "trace-observability-a",
    boundary: "C04",
    inputUnitIds: ["unit-a"],
    outputUnitIds: ["unit-a"],
    status: "SUCCESS",
    failureCode: null,
    failureClass: "NONE",
    contextResult: "NOT_APPLICABLE",
    lifecycleResult: "NOT_APPLICABLE",
    routeResult: "NOT_APPLICABLE",
    canonicalResult: "NOT_APPLICABLE",
    targetMarker: "C04_SOURCE_EVIDENCE_VALIDATED",
    timestamp: FIXED_TIME,
    ...overrides
  };
}

function assertFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.deepEqual(Object.keys(result).sort(), ["code", "ok"]);
  assert.equal(Object.isFrozen(result), true);
}

// AC-OBS-001: a successful boundary event has the exact closed C11 shape.
const success = createDiagnosticBoundaryEvent(base());
assert.equal(success.ok, true);
assert.equal(validateDiagnosticBoundaryEvent(success.value).ok, true);
assert.deepEqual(Object.keys(success.value).sort(), [
  "boundary",
  "canonicalResult",
  "contextResult",
  "coreVersion",
  "failureClass",
  "failureCode",
  "inputUnitIds",
  "isEarliestFailure",
  "lifecycleResult",
  "outputUnitIds",
  "routeResult",
  "status",
  "targetMarker",
  "timestamp",
  "traceId"
].sort());
assert.equal(success.value.isEarliestFailure, false);

// AC-OBS-002: an owned failure remains attributable to its exact boundary.
const evidenceFailure = createDiagnosticBoundaryEvent(base({
  status: "FAILURE",
  failureCode: "EVIDENCE_QUOTE_MISMATCH",
  failureClass: "CONTRACT",
  outputUnitIds: [],
  targetMarker: "C04_SOURCE_EVIDENCE_REJECTED"
}), { isEarliestFailure: true });
assert.equal(evidenceFailure.ok, true);
assert.equal(evidenceFailure.value.isEarliestFailure, true);
assert.equal(failureCodeOwner("EVIDENCE_QUOTE_MISMATCH"), "C04");
assertFailure(createDiagnosticBoundaryEvent(base({
  status: "FAILURE",
  failureCode: "EVIDENCE_QUOTE_MISMATCH",
  failureClass: "DIAGNOSTIC",
  outputUnitIds: [],
  targetMarker: "C04_SOURCE_EVIDENCE_REJECTED"
})), "DIAGNOSTIC_FIELD_FORBIDDEN");
assertFailure(createDiagnosticBoundaryEvent(base({
  status: "FAILURE",
  failureCode: "EVIDENCE_QUOTE_MISMATCH",
  failureClass: "CONTRACT",
  outputUnitIds: [],
  targetMarker: "C04_SOURCE_EVIDENCE_VALIDATED"
})), "DIAGNOSTIC_FIELD_FORBIDDEN");

// AC-OBS-003: the trace emitter marks only the first observed failure.
const emitted = [];
const traceEmitter = createDiagnosticTraceEmitter({ traceId: base().traceId, sink: (event) => emitted.push(event) });
assert.equal(traceEmitter.emit(base()).ok, true);
assert.equal(traceEmitter.emit(base({
  boundary: "C03",
  status: "FAILURE",
  failureCode: "CAPABILITY_SUBJECT_CONFLICT",
  failureClass: "CONTRACT",
  outputUnitIds: [],
  targetMarker: "C03_SEMANTIC_UNIT_REJECTED"
})).event.isEarliestFailure, true);
assert.equal(traceEmitter.emit(base({
  boundary: "C05",
  status: "FAILURE",
  failureCode: "CONTEXT_TARGET_UNAVAILABLE",
  failureClass: "CONTRACT",
  outputUnitIds: [],
  contextResult: "REJECTED",
  targetMarker: "C05_CONTEXT_LINK_REJECTED"
})).event.isEarliestFailure, false);
assert.equal(emitted.length, 3);
assert.equal(Object.isFrozen(emitted[1]), true);
assertFailure(traceEmitter.emit(base({ traceId: "trace-other" })), "DIAGNOSTIC_FIELD_FORBIDDEN");

// AC-OBS-004: unit ownership and bounded layer outcome enums survive exactly.
const routed = createDiagnosticBoundaryEvent(base({
  boundary: "C07",
  inputUnitIds: ["unit-a", "unit-b"],
  outputUnitIds: ["unit-a", "unit-b"],
  lifecycleResult: "MODIFY",
  routeResult: "CLARIFY",
  canonicalResult: "NOT_REQUIRED",
  targetMarker: "C07_UNIT_ROUTE_VALIDATED"
}));
assert.equal(routed.ok, true);
assert.deepEqual(routed.value.inputUnitIds, ["unit-a", "unit-b"]);
assert.equal(routed.value.lifecycleResult, "MODIFY");
assert.equal(routed.value.routeResult, "CLARIFY");
assert.equal(routed.value.canonicalResult, "NOT_REQUIRED");
assertFailure(createDiagnosticBoundaryEvent(base({ routeResult: "MAYBE" })), "DIAGNOSTIC_FIELD_FORBIDDEN");

// AC-OBS-005: only allowlisted fields enter C11; sensitive or arbitrary data cannot survive.
for (const forbidden of [
  { prompt: "system prompt" },
  { guestText: "guest text" },
  { quote: "evidence quote" },
  { facts: [{ price: 100 }] },
  { credential: "secret" },
  { headers: { authorization: "Bearer secret" } },
  { stack: "stack" },
  { error: new Error("arbitrary provider body") }
]) {
  assertFailure(createDiagnosticBoundaryEvent(base(forbidden)), "DIAGNOSTIC_FIELD_FORBIDDEN");
}
assertFailure(createDiagnosticBoundaryEvent(base({ traceId: "sk-proj-secret123" })), "DIAGNOSTIC_FIELD_FORBIDDEN");
assertFailure(createDiagnosticBoundaryEvent(base({ inputUnitIds: ["ghp_secret123"] })), "DIAGNOSTIC_FIELD_FORBIDDEN");

// AC-OBS-006: unknown boundaries and unowned codes fail closed without reflection.
assertFailure(createDiagnosticBoundaryEvent(base({ boundary: "C99" })), "DIAGNOSTIC_BOUNDARY_UNKNOWN");
assertFailure(createDiagnosticBoundaryEvent(base({
  status: "FAILURE",
  failureCode: "SOME_CALLER_ERROR",
  failureClass: "CONTRACT",
  outputUnitIds: [],
  targetMarker: "C04_SOURCE_EVIDENCE_REJECTED"
})), "DIAGNOSTIC_CODE_UNOWNED");

// AC-OBS-007: invalid projections and sink exceptions are behavior-neutral.
const throwingEmitter = createDiagnosticTraceEmitter({ traceId: base().traceId, sink() { throw new Error("raw sink failure"); } });
assert.doesNotThrow(() => throwingEmitter.emit(base()));
const isolated = throwingEmitter.emit(base());
assert.equal(isolated.ok, true);
assert.equal(isolated.delivered, false);
assert.equal(Object.hasOwn(isolated, "error"), false);
assert.doesNotThrow(() => throwingEmitter.emit(base({ prompt: "must-not-pass" })));
assertFailure(throwingEmitter.emit(base({ prompt: "must-not-pass" })), "DIAGNOSTIC_FIELD_FORBIDDEN");

// AC-OBS-008: provider timeout and local schema rejection remain distinct bounded classes.
const providerTimeout = createDiagnosticBoundaryEvent(base({
  boundary: "C02",
  status: "FAILURE",
  failureCode: "UNDERSTANDING_PROVIDER_TIMEOUT",
  failureClass: "PROVIDER_TIMEOUT",
  outputUnitIds: [],
  targetMarker: "C02_PROVIDER_TIMEOUT"
}));
const schemaFailure = createDiagnosticBoundaryEvent(base({
  boundary: "C02",
  status: "FAILURE",
  failureCode: "UNDERSTANDING_SCHEMA_INVALID",
  failureClass: "CONTRACT",
  outputUnitIds: [],
  targetMarker: "C02_WIRE_SCHEMA_REJECTED"
}));
assert.equal(providerTimeout.ok, true);
assert.equal(schemaFailure.ok, true);
assert.notEqual(providerTimeout.value.failureCode, schemaFailure.value.failureCode);
assert.notEqual(providerTimeout.value.failureClass, schemaFailure.value.failureClass);

// AC-OBS-009: target execution attribution uses only boundary-owned marker enums.
assertFailure(createDiagnosticBoundaryEvent(base({ targetMarker: "TARGET_PASSED_BY_LUCK" })), "DIAGNOSTIC_FIELD_FORBIDDEN");
assert.equal(createDiagnosticBoundaryEvent(base({ targetMarker: "C04_SOURCE_EVIDENCE_VALIDATED" })).ok, true);

// AC-OBS-010: unit lists and IDs are bounded and unique.
assertFailure(createDiagnosticBoundaryEvent(base({ inputUnitIds: Array.from({ length: 101 }, (_, i) => `unit-${i}`) })), "DIAGNOSTIC_FIELD_FORBIDDEN");
assertFailure(createDiagnosticBoundaryEvent(base({ outputUnitIds: ["unit-a", "unit-a"] })), "DIAGNOSTIC_FIELD_FORBIDDEN");
assertFailure(createDiagnosticBoundaryEvent(base({ inputUnitIds: ["guest text is not an opaque id"] })), "DIAGNOSTIC_FIELD_FORBIDDEN");

// AC-OBS-011: every emitted object is recursively immutable and detached.
const mutableInputIds = ["unit-a"];
const immutable = createDiagnosticBoundaryEvent(base({ inputUnitIds: mutableInputIds }));
mutableInputIds[0] = "unit-mutated";
assert.deepEqual(immutable.value.inputUnitIds, ["unit-a"]);
assert.equal(Object.isFrozen(immutable.value), true);
assert.equal(Object.isFrozen(immutable.value.inputUnitIds), true);
assert.throws(() => { immutable.value.routeResult = "HANDOFF"; }, TypeError);

// AC-OBS-012: C11 accepts only the exact frozen core version.
assert.equal(CORE_VERSION, "new-core-v1");
assertFailure(createDiagnosticBoundaryEvent(base({ coreVersion: "new-core-v2" })), "DIAGNOSTIC_FIELD_FORBIDDEN");

console.log("new core observability runner: PASS (12 STRUCTURED_CONTRACT_TEST cases)");
