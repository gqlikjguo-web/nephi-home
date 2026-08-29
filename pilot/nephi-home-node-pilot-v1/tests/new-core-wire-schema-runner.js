"use strict";

const assert = require("node:assert/strict");
const {
  validateUnderstandingOutputV1,
  MAX_UNITS
} = require("../lib/new-core/contracts/understanding-output-v1");
const {
  validateSemanticUnitCandidate
} = require("../lib/new-core/contracts/semantic-unit-candidate");
const { validateSourceEvidence } = require("../lib/new-core/contracts/source-evidence");
const {
  validateContextLinkCandidate,
  validateContextLinkCandidates
} = require("../lib/new-core/contracts/context-link-candidate");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function evidence(overrides = {}) {
  return {
    eventId: "event-1",
    messageRef: "message-1",
    startOffset: 0,
    endOffset: 4,
    quote: "10/9住一晚",
    ...overrides
  };
}

function temporal(overrides = {}) {
  return {
    rawText: "10/9住一晚",
    kind: "partial",
    checkInCandidate: "10/9",
    checkOutCandidate: null,
    nightsCandidate: 1,
    ...overrides
  };
}

function slot(overrides = {}) {
  return {
    slotCandidateId: "slot-1",
    slot: "guest_count",
    operation: "SET",
    value: 4,
    evidenceRefs: [evidence({ quote: "我們4位" })],
    ...overrides
  };
}

function unit(overrides = {}) {
  return {
    unitId: "unit-1",
    evidenceRefs: [evidence()],
    purpose: "lodging_question",
    capability: "availability",
    subject: { kind: "bundle", catalogIdentity: "bundle-1" },
    stayDependent: true,
    temporalCandidate: null,
    contextLinkCandidateId: "link-1",
    safetyCandidate: null,
    slotCandidates: [],
    confidenceBand: "high",
    ...overrides
  };
}

function output(overrides = {}) {
  return {
    schemaVersion: 1,
    turnId: "turn-1",
    units: [unit()],
    ...overrides
  };
}

function contextLink(overrides = {}) {
  return {
    contextLinkCandidateId: "link-1",
    unitId: "unit-1",
    actionCandidate: "START",
    targetRequestCycleId: null,
    evidenceRefs: [evidence()],
    ...overrides
  };
}

function assertFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
}

// AC-WIR-001..002: output preserves zero, one, or many stable units, but
// duplicate unit ownership is rejected without renumbering.
assert.equal(validateUnderstandingOutputV1(output({ units: [] })).ok, true);
assert.equal(validateUnderstandingOutputV1(output()).ok, true);
assert.equal(validateUnderstandingOutputV1(output({
  units: [unit(), unit({ unitId: "unit-2", contextLinkCandidateId: "link-2" })]
})).ok, true);
assertFailure(validateUnderstandingOutputV1(output({
  units: [unit(), unit({ contextLinkCandidateId: "link-2" })]
})), "UNIT_ID_DUPLICATE");

// AC-WIR-003..006: every declared object is closed, provider-only output is
// bounded, and legacy reply/fact/canonical/state authority cannot enter C02.
assertFailure(validateUnderstandingOutputV1(output({ shouldIgnore: true })), "UNKNOWN_WIRE_FIELD");
assertFailure(validateUnderstandingOutputV1(output({ units: [unit({ candidateIndex: 0 })] })), "UNKNOWN_WIRE_FIELD");
assertFailure(validateUnderstandingOutputV1(output({ units: [unit({ purpose: "invented" })] })), "UNDERSTANDING_SCHEMA_INVALID");
assertFailure(validateUnderstandingOutputV1(output({
  units: Array.from({ length: MAX_UNITS + 1 }, (_, index) => unit({
    unitId: `unit-${index}`,
    contextLinkCandidateId: `link-${index}`
  }))
})), "UNDERSTANDING_CARDINALITY_INVALID");
for (const forbiddenField of ["facts", "canonicalDates", "resolverId", "queryPlan", "finalText", "stateMutation"]) {
  assertFailure(validateUnderstandingOutputV1(output({ [forbiddenField]: {} })), "UNKNOWN_WIRE_FIELD");
}

// AC-WIR-007..008: punctuation/non-actionable output may be empty and no
// validator may repair or mutate provider-supplied candidates.
const unchangedOutput = output({ units: [] });
const outputBefore = clone(unchangedOutput);
assert.equal(validateUnderstandingOutputV1(unchangedOutput).ok, true);
assert.deepEqual(unchangedOutput, outputBefore);

// AC-SEM-001..003 / addendum A-D,J: the closed temporal candidate preserves
// raw meaning only. A partial source date never receives an implicit year or
// becomes executable before Canonical Temporal.
const caseATemporal = temporal();
assert.equal(caseATemporal.checkInCandidate, "10/9");
assert.equal(caseATemporal.checkOutCandidate, null);
assert.doesNotMatch(JSON.stringify(caseATemporal), /2026/);
for (const candidate of [
  unit({ temporalCandidate: caseATemporal }),
  unit({ temporalCandidate: temporal({ rawText: "2026/09/20", kind: "absolute_date", checkInCandidate: "2026-09-20", checkOutCandidate: null, nightsCandidate: null }) }),
  unit({ temporalCandidate: temporal({ rawText: "今天", kind: "relative_date", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null }) }),
  unit({ temporalCandidate: temporal({ rawText: "明天", kind: "relative_date", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null }) }),
  unit({ temporalCandidate: temporal({ rawText: "10/9到10/10", kind: "date_range", checkInCandidate: "10/9", checkOutCandidate: "10/10", nightsCandidate: null }) }),
  unit({ temporalCandidate: temporal({ rawText: "明年2/4到2/7", kind: "relative_range", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null }) }),
  unit({ temporalCandidate: temporal({ rawText: "下週六", kind: "weekday", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null }) }),
  unit({ temporalCandidate: null })
]) {
  assert.equal(validateSemanticUnitCandidate(candidate).ok, true);
}

// AC-SEM-004..010 / addendum I: closed C03 fields, enum/type bounds, and an
// explicit structured temporal contradiction fail without a replacement.
for (const invalidCandidate of [
  unit({ unitId: "" }),
  unit({ capability: "made_up" }),
  unit({ subject: { kind: "room" } }),
  unit({ stayDependent: "true" }),
  unit({ evidenceRefs: [] }),
  unit({ safetyCandidate: { operatorActionClass: "unknown", riskClass: null } }),
  unit({ temporalCandidate: temporal({ kind: "executed_date" }) }),
  unit({ temporalCandidate: temporal({ rawText: "9/20", kind: "absolute_date", checkInCandidate: "9/20", checkOutCandidate: null, nightsCandidate: null }) }),
  unit({ temporalCandidate: temporal({ rawText: "2026/02/30", kind: "absolute_date", checkInCandidate: "2026-02-30", checkOutCandidate: null, nightsCandidate: null }) }),
  unit({ temporalCandidate: temporal({ rawText: "2026/09/20", kind: "absolute_date", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null }) }),
  unit({ temporalCandidate: temporal({ rawText: "2026/09/20", kind: "absolute_date", checkInCandidate: "2026-09-20", checkOutCandidate: "9/21", nightsCandidate: null }) }),
  unit({ temporalCandidate: temporal({ rawText: "2026/09/20", kind: "partial", checkInCandidate: "2026-09-20", checkOutCandidate: null, nightsCandidate: null }) }),
  unit({ temporalCandidate: temporal({ resolverResult: "forbidden" }) }),
  unit({ temporalCandidate: temporal({ checkInCandidate: "2026-10-09", checkOutCandidate: "2026-10-10", nightsCandidate: 2 }) }),
  unit({ lifecycleAction: "END" })
]) {
  assertFailure(validateSemanticUnitCandidate(invalidCandidate), "SEMANTIC_UNIT_INVALID");
}

// Addendum E-H: closed source-bound slots permit only candidate data. They do
// not mutate lifecycle/reply/capability or validate catalog identity here.
assert.equal(validateSemanticUnitCandidate(unit({ slotCandidates: [slot()] })).ok, true);
assert.equal(validateSemanticUnitCandidate(unit({
  purpose: "context_update",
  capability: null,
  subject: { kind: null, catalogIdentity: null },
  stayDependent: false,
  safetyCandidate: null,
  slotCandidates: [
    slot(),
    slot({ slotCandidateId: "slot-2", slot: "transport", value: "driving", evidenceRefs: [evidence({ quote: "有開車" })] })
  ]
})).ok, true);
assert.equal(validateSemanticUnitCandidate(unit({
  slotCandidates: [slot({ slotCandidateId: "slot-product", slot: "product", value: "bundle-1" })]
})).ok, true);
for (const invalidSlot of [
  slot({ slotCandidateId: "" }),
  slot({ slot: "arbitrary" }),
  slot({ operation: "WRITE" }),
  slot({ value: { forged: true } }),
  slot({ value: 0 }),
  slot({ operation: "CLEAR", value: 4 }),
  slot({ extra: "stateMutation" })
]) {
  assertFailure(validateSemanticUnitCandidate(unit({ slotCandidates: [invalidSlot] })), "SEMANTIC_UNIT_INVALID");
}

// Wire validation may not infer that equal raw temporal and evidence strings
// represent the same meaning. Evidence ownership is deferred to Tasks 4/5.
assert.equal(validateSemanticUnitCandidate(unit({
  temporalCandidate: temporal(),
  slotCandidates: [slot({ evidenceRefs: [evidence({ quote: "10/9住一晚" })] })]
})).ok, true);

// The output validator owns turn-wide stable ID uniqueness; it never repairs
// duplicate slot IDs or silently changes a candidate identity.
assertFailure(validateUnderstandingOutputV1(output({
  units: [
    unit({ slotCandidates: [slot()] }),
    unit({ unitId: "unit-2", contextLinkCandidateId: "link-2", slotCandidates: [slot()] })
  ]
})), "UNDERSTANDING_SCHEMA_INVALID");

// C04 shape validates only the declared evidence tuple. Event existence,
// quote matching, and coordinate normalization remain Task 4 authority.
assert.equal(validateSourceEvidence([evidence()]).ok, true);
for (const invalidEvidence of [[], [evidence({ eventId: "" })], [evidence({ endOffset: -1 })], [evidence({ extra: true })]]) {
  assertFailure(validateSourceEvidence(invalidEvidence), "UNDERSTANDING_SCHEMA_INVALID");
}

// C05 permits only a closed language-derived proposal. Target lookup and
// action/target consistency are deferred to the Context validator.
assert.equal(validateContextLinkCandidate(contextLink()).ok, true);
for (const invalidLink of [
  contextLink({ contextLinkCandidateId: "" }),
  contextLink({ unitId: "" }),
  contextLink({ actionCandidate: "GUESS" }),
  contextLink({ targetRequestCycleId: "" }),
  contextLink({ evidenceRefs: [] }),
  contextLink({ candidateIndex: 0 })
]) {
  assertFailure(validateContextLinkCandidate(invalidLink), "UNDERSTANDING_SCHEMA_INVALID");
}
assertFailure(validateContextLinkCandidates([contextLink(), contextLink({ unitId: "unit-2" })]), "CONTEXT_LINK_DUPLICATE");

console.log(JSON.stringify({
  suite: "new-core-wire-schema",
  classification: "STRUCTURED_CONTRACT_TEST",
  caseCount: 40,
  status: "PASS"
}));
