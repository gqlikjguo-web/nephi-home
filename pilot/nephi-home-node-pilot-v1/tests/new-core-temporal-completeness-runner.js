"use strict";

// FAKE_INTEGRATION: fixed provider outputs; real admission, correction, core and
// Resolver execution. The recorded omission must never become defaulted facts.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { turn } = require("./helpers/new-core-context-scenarios");

const date = (rawText = "10/7", nightsCandidate = null) => ({
  rawText, kind: "month_day", checkInCandidate: null, checkOutCandidate: null, nightsCandidate
});
const stay = (text, temporal = date()) => ({
  text, capability: "availability", kind: "property", identity: null,
  temporal, slots: [["guest_count", 2]]
});
const attempts = value => value.diagnostics.find(item => item.stage === "new_core_understanding_attempts");

test("recorded explicit duration omission is rejected before defaulting or querying", async () => {
  const value = await turn([stay("10/7兩個人住兩晚")]);
  assert.equal(value.queries.length, 0, "an omitted source condition cannot reach Resolver");
  assert.equal(value.calls, 2, "one initial attempt plus at most one controlled correction");
  assert.equal(attempts(value).attempts[0].validationResult.ok, false);
  assert.equal(attempts(value).finalAcceptedAttempt, null);
  assert.equal(value.result.artifacts.understanding.failedUnits[0].boundary, "C03");
});

for (const [text, nights, end] of [
  ["10/7兩個人住兩晚", 2, "2026-10-09"],
  ["10/7入住，住宿三晚，兩位", 3, "2026-10-10"],
  ["10/7，2人，住4晚", 4, "2026-10-11"]
]) test(`a model correction carries the owned duration: ${text}`, async () => {
  let responseNumber = 0;
  const value = await turn([stay(text)], { transformOutput: output => {
    if (++responseNumber === 2) output.understandingOutput.units[0].temporalCandidate.nightsCandidate = nights;
    return output;
  } });
  assert.equal(value.calls, 2);
  const ledger = attempts(value);
  assert.equal(ledger.finalAcceptedAttempt, 2);
  assert.equal(ledger.attempts[0].validationResult.ok, false);
  assert.equal(ledger.attempts[1].triggerFailure[0].boundary, "C03");
  assert.equal(ledger.attempts[1].triggerFailure[0].origin, "model_output");
  assert.equal(value.result.earliestFailure, null);
  assert.equal(value.result.artifacts.understanding.validatedUnits[0].temporalCandidate.nightsCandidate, nights);
  assert.equal(value.result.artifacts.formalRequests[0].resolverTask.checkOut, end);
  assert.equal(value.state.tasks[0].checkOut, end);
  assert.equal(value.state.tasks[0].guestCount, 2);
  assert.ok(value.queries.length > 0);
});

// Exact source ownership of one full expression must survive the canonical
// grammar boundary; its component dates are not independent requirements.
for (const [text, rawText, checkIn, checkOut] of [
  ["11/25 ~ 11/27 還有房嗎？", "11/25 ~ 11/27", "2026-11-25", "2026-11-27"],
  ["11/25 ~ 11/27 401房，還有嗎？", "11/25 ~ 11/27", "2026-11-25", "2026-11-27"],
  ["12/8\t-\t12/10\t205房，還有嗎？", "12/8\t-\t12/10", "2026-12-08", "2026-12-10"],
  ["10/20　至\n10/22 308房，還有嗎？", "10/20　至\n10/22", "2026-10-20", "2026-10-22"]
]) test(`one source-owned range stays complete: ${JSON.stringify(text)}`, async () => {
  const value = await turn([stay(text, {
    rawText, kind: "date_range", checkInCandidate: checkIn,
    checkOutCandidate: checkOut, nightsCandidate: 2
  })]);
  assert.equal(value.calls, 1, "a valid first Understanding must not trigger correction");
  assert.equal(attempts(value).attempts[0].validationResult.ok, true);
  assert.equal(attempts(value).finalAcceptedAttempt, 1);
  assert.equal(value.result.earliestFailure, null);
  const task = value.result.artifacts.formalRequests[0].resolverTask;
  assert.equal(task.checkIn, checkIn);
  assert.equal(task.checkOut, checkOut);
  assert.equal(value.result.artifacts.formalRequests[0].canonicalRequest.temporalState.nights, 2);
  assert.ok(value.queries.length > 0);
});

test("one owned temporal expression cannot hide a different source date", async () => {
  const value = await turn([stay("11/25~11/27，還有12/8", {
    rawText: "11/25~11/27", kind: "date_range", checkInCandidate: "2026-11-25",
    checkOutCandidate: "2026-11-27", nightsCandidate: 2
  })]);
  assert.equal(value.calls, 2);
  assert.equal(attempts(value).attempts[0].validationResult.ok, false);
  assert.equal(attempts(value).finalAcceptedAttempt, null);
  assert.equal(value.queries.length, 0);
});

test("complete duration stays a single Understanding call", async () => {
  const value = await turn([stay("10/7兩個人住兩晚", date("10/7", 2))]);
  assert.equal(value.calls, 1);
  assert.equal(value.result.artifacts.formalRequests[0].resolverTask.checkOut, "2026-10-09");
});

test("source duration carried inside the exact temporal expression is complete", async () => {
  const value = await turn([stay("10/7住兩晚，2人", date("10/7住兩晚"))]);
  assert.equal(value.calls, 1);
  assert.equal(value.result.artifacts.formalRequests[0].resolverTask.checkOut, "2026-10-09");
});

test("no explicit duration retains the existing single-date default", async () => {
  const value = await turn([stay("10/7兩個人")]);
  assert.equal(value.calls, 1);
  assert.equal(value.result.artifacts.formalRequests[0].resolverTask.checkOut, "2026-10-08");
});

test("unowned source events cannot supply a duration", async () => {
  const value = await turn([stay("10/7兩個人")], { extraMessages: ["另一個需求住三晚"] });
  assert.equal(value.calls, 1);
  assert.equal(value.result.artifacts.formalRequests[0].resolverTask.checkOut, "2026-10-08");
});

test("correction cannot replace the already validated guest count", async () => {
  let responseNumber = 0;
  const value = await turn([stay("10/7兩個人住兩晚")], { transformOutput: output => {
    if (++responseNumber === 2) {
      output.understandingOutput.units[0].temporalCandidate.nightsCandidate = 2;
      output.understandingOutput.units[0].slotCandidates[0].value = 8;
    }
    return output;
  } });
  assert.equal(value.calls, 2);
  assert.equal(value.queries.length, 0);
  assert.equal(attempts(value).attempts[1].validationResult.adoptionFailure, "CORRECTION_FIELD_NOT_PRESERVED");
});

// Removing source separators must not join a date endpoint to another number
// and turn a complete first Understanding into an unnecessary correction.
for (const [text, rawText, checkIn, checkOut] of [
  ["11/25~11/27 401房，還有嗎？", "11/25~11/27", "2026-11-25", "2026-11-27"],
  ["12/8到12/10\t205房，還有嗎？", "12/8到12/10", "2026-12-08", "2026-12-10"],
  ["10/20至10/22\n308房，還有嗎？", "10/20至10/22", "2026-10-20", "2026-10-22"],
  ["11/25~11/27　401房，還有嗎？", "11/25~11/27", "2026-11-25", "2026-11-27"]
]) test(`complete source range retains its boundary before adjacent numeric text: ${JSON.stringify(text)}`, async () => {
  const value = await turn([stay(text, {
    rawText, kind: "date_range", checkInCandidate: checkIn,
    checkOutCandidate: checkOut, nightsCandidate: 2
  })]);
  assert.equal(value.calls, 1, "trusted attempt 1 must not resample");
  assert.equal(attempts(value).attempts[0].validationResult.ok, true);
  assert.equal(attempts(value).finalAcceptedAttempt, 1);
  assert.equal(value.result.earliestFailure, null);
  const task = value.result.artifacts.formalRequests[0].resolverTask;
  assert.equal(task.checkIn, checkIn);
  assert.equal(task.checkOut, checkOut);
  assert.equal(value.state.tasks[0].checkOut, checkOut);
  assert.ok(value.queries.length > 0);
});
