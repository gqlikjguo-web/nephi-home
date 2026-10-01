"use strict";
// RECORDED_REPRODUCTION / FAKE_INTEGRATION: fixed model candidates, actual
// admission, serialized State, canonicalization and inventory Resolver code.
// No real OpenAI, PostgreSQL or LINE calls. The production safe trace retained
// the nights-only NEW_REQUEST shape, not its raw independence proof.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { turn, refs, dateRange, scope, NOW } = require("./helpers/new-core-context-scenarios");
const { turnStateSnapshot } = require("../lib/new-core/application-service");
const { OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC: DIAGNOSTIC } = require("../lib/providers/openai-understanding-v1");

const duration = { kind: "nights_only", rawText: "兩晚", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 2 };
const date = { kind: "month_day", rawText: "10/14", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null };
const previousStay = () => turn([{ capability: "availability", kind: "property", identity: null,
  text: "10/14有房嗎", temporal: date }]);

function setSubject(output, input, kind = "matched_room_set", identity) {
  const unit = output.understandingOutput.units[0];
  const catalog = input.publicSubjectCatalog.find(subject => subject.kind === kind
    && (identity === undefined || subject.catalogIdentity === identity));
  assert.ok(catalog, "fixture uses only the actual same-property catalog");
  unit.subject = { kind, catalogIdentity: catalog.catalogIdentity };
  // Authored product requirement, declared before later negative mutations.
  output.sourceObligations.requirements[0].requiredFields = [...new Set([...output.sourceObligations.requirements[0].requiredFields, "subject", "slot:product"])];
  unit.slotCandidates = [{ slotCandidateId: "product-change", slot: "product", operation: "SET",
    value: catalog.catalogIdentity, evidenceRefs: structuredClone(unit.evidenceRefs) }];
  return output;
}

function modification(output, previousRefs) {
  Object.assign(output.sourceObligations.requirements[0], {relationKind:"MODIFICATION", referencedHistoryEventRefs:structuredClone(previousRefs), referencedCurrentUnitId:null});
  Object.assign(output.contextLinkCandidates[0], { relationKind: "MODIFICATION",
    referencedHistoryEventRefs: previousRefs, referencedCurrentUnitId: null, independentRequestEvidence: null });
  return output;
}

function independence(output, input) {
  output.contextLinkCandidates[0].independentRequestEvidence = {
    currentSourceEvidenceRefs: structuredClone(output.understandingOutput.units[0].evidenceRefs),
    assessedHistoryEventRefs: input.recentConversation.map(({ eventId, messageRef }) => ({ eventId, messageRef }))
  };
  return output;
}

function followup(previous, transformOutput, options = {}) {
  return turn([{ capability: "availability", kind: "property", identity: null,
    text: "如果雙人房住兩晚可以嗎", temporal: duration }],
  { previous: previous.state, history: previous.history, transformOutput, ...options });
}

function assertActualSetResult(next, start = "2026-10-14", end = "2026-10-16") {
  assert.equal(next.result.earliestFailure, null);
  const canonical = next.result.artifacts.canonicalItems[0].canonicalRequest;
  assert.equal(canonical.canonicalEntity.status, "matched_set");
  assert.equal(canonical.canonicalEntity.canonicalId, null);
  assert.deepEqual([...canonical.canonicalEntity.canonicalSet].sort(), ["room-a", "room-b"]);
  assert.equal(canonical.temporalState.checkIn, start);
  assert.equal(canonical.temporalState.checkOut, end);
  assert.equal(canonical.temporalState.nights, 2);
  assert.ok(next.queries.length > 0, "the result must actually pass the formal Resolver");
  for (const request of next.result.artifacts.formalRequests) {
    assert.equal(request.stay.checkIn, start);
    assert.equal(request.stay.checkOut, end);
  }
  assert.equal(next.result.finalDecision.action, "reply");
  assert.equal(next.result.finalResponse.shouldReply, true);
  assert.ok(next.result.finalResponse.replyText.length > 0);
}

test("nights-only NEW_REQUEST without independence cannot silently lose existing dates", async () => {
  const previous = await previousStay();
  const next = await followup(previous, setSubject);
  assert.equal(next.calls, 2, "formal relation failure must enter the one controlled correction");
  assert.equal(next.queries.length, 0);
  const attempts = next.result.understandingAttempts;
  assert.equal(attempts.length, 2);
  for (const attempt of attempts) {
    assert.equal(attempt.validationResult.ok, false);
    assert.ok(attempt.schemaError.fieldPath.endsWith("independentRequestEvidence"));
  }
});

test("correction supplies a unique grounded set MODIFICATION and the actual two-night Resolver result", async () => {
  const previous = await previousStay(); let count = 0;
  const next = await followup(previous, (output, input) => {
    setSubject(output, input);
    return ++count === 1 ? output : modification(output, refs(previous));
  });
  assert.equal(next.calls, 2);
  assertActualSetResult(next);
  const attempts = next.result.artifacts.understanding[DIAGNOSTIC].attemptEvidence;
  assert.equal(attempts[0].validationResult.ok, false);
  assert.equal(attempts[1].accepted, true);
  assert.equal(next.state.tasks.length, 1, "modify the cited need, do not allocate a guessed new cycle");
  assert.equal(next.state.tasks[0].taskId, previous.state.tasks[0].taskId);
});

test("valid set modification is one call and keeps the set through State serialization and another turn", async () => {
  const previous = await previousStay();
  const next = await followup(previous, (output, input) => modification(setSubject(output, input), refs(previous)));
  assert.equal(next.calls, 1);
  assertActualSetResult(next);
  const subject = next.result.artifacts.understanding.validatedUnits[0].subject;
  const snapshot = turnStateSnapshot(next.state, scope, NOW);
  assert.deepEqual(snapshot.referenceableCycles[0].subject, subject);
  assert.equal(next.state.tasks[0].entityId, subject.catalogIdentity);
  assert.equal(next.state.tasks[0].entityCategory, "matched_room_set");
  assert.equal(next.state.tasks[0].productId, null, "a set cannot be silently narrowed to one product");
  const again = await turn([{ capability: "availability", kind: "matched_room_set", identity: subject.catalogIdentity,
    text: "10/20入住", temporal: { ...date, rawText: "10/20" }, relation: "MODIFICATION", refs: refs(next) }],
  { previous: next.state, history: [...previous.history, ...next.history] });
  assert.equal(again.calls, 1);
  assertActualSetResult(again, "2026-10-20", "2026-10-22");
});

for (const [kind, identity] of [["room", "room-a"], ["bundle", "bundle-a"], ["matched_room_set", undefined]]) {
  test(`valid ${kind} product replacement keeps the cited dates and one call`, async () => {
    const previous = await previousStay();
    const next = await followup(previous, (output, input) => modification(setSubject(output, input, kind, identity), refs(previous)));
    assert.equal(next.calls, 1);
    assert.equal(next.result.earliestFailure, null);
    assert.equal(next.result.finalDecision.action, "reply");
    assert.equal(next.state.tasks[0].checkIn, "2026-10-14");
    assert.equal(next.state.tasks[0].checkOut, "2026-10-16");
  });
}

test("a genuinely independent duration-only stay supplies evidence and cannot inherit dates", async () => {
  const previous = await previousStay();
  const next = await turn([{ capability: "availability", kind: "property", identity: null,
    text: "另一趟旅程住兩晚，日期未定", temporal: duration }], { previous: previous.state, history: previous.history,
    transformOutput: independence });
  assert.equal(next.calls, 1);
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.queries.length, 0);
  assert.equal(next.result.finalDecision.action, "clarification");
  assert.equal(next.state.tasks.length, 2);
  assert.equal(next.state.tasks[1].checkIn, null);
});

test("a complete independent stay date keeps one call without an independence proof", async () => {
  const previous = await previousStay();
  const next = await turn([{ capability: "availability", kind: "room", identity: "room-b",
    text: "2026-11-01入住，2026-11-03退房", temporal: dateRange("2026-11-01", "2026-11-03") }],
  { previous: previous.state, history: previous.history });
  assert.equal(next.calls, 1);
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.state.tasks.length, 2);
  assert.equal(next.state.tasks[1].checkIn, "2026-11-01");
  assert.equal(next.state.tasks[1].checkOut, "2026-11-03");
});

test("without eligible stay history, a duration-only NEW_REQUEST is admitted once and clarifies dates", async () => {
  const next = await turn([{ capability: "availability", kind: "property", identity: null,
    text: "住兩晚可以嗎", temporal: duration }]);
  assert.equal(next.calls, 1);
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.result.finalDecision.action, "clarification");
  assert.equal(next.queries.length, 0);
});

for (const [label, change] of [
  ["unknown catalog identity", output => { output.understandingOutput.units[0].subject.catalogIdentity = "foreign-set"; }],
  ["missing product source", output => { output.understandingOutput.units[0].slotCandidates[0].evidenceRefs = []; }],
  ["foreign history", output => { output.contextLinkCandidates[0].referencedHistoryEventRefs = [{ eventId: "foreign", messageRef: "foreign" }]; }]
]) test(`set modification rejects ${label} and never queries inventory`, async () => {
  const previous = await previousStay();
  const next = await followup(previous, (output, input) => {
    modification(setSubject(output, input), refs(previous)); change(output); return output;
  });
  assert.equal(next.calls, 2);
  assert.equal(next.queries.length, 0);
  assert.ok(next.result.earliestFailure);
});

for (const key of ["propertyId", "channel", "userId"]) test(`no matched-set relation crosses ${key}`, async () => {
  const previous = await previousStay();
  const next = await followup(previous, (output, input) => modification(setSubject(output, input), refs(previous)),
    { turnScope: { ...scope, [key]: `different-${key}` } });
  assert.equal(next.queries.length, 0);
  assert.ok(next.result.earliestFailure);
  assert.ok(next.calls <= 2);
});

test("two referenced stays remain ambiguous; no nearest cycle is chosen", async () => {
  const first = await previousStay();
  const second = await turn([{ capability: "availability", kind: "property", identity: null,
    text: "2026-11-01入住，2026-11-03退房", temporal: dateRange("2026-11-01", "2026-11-03") }],
  { previous: first.state, history: first.history });
  const next = await followup({ ...second, history: [...first.history, ...second.history] }, (output, input) =>
    modification(setSubject(output, input), [...refs(first), ...refs(second)]));
  assert.equal(next.queries.length, 0);
  assert.ok(next.result.earliestFailure);
  assert.ok(next.calls <= 2);
});
