"use strict";
// STRUCTURED_CONTRACT_TEST: real safe projection and temporal resolver only.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { formatNewCoreProductionTrace: format } = require("../lib/new-core/production-safe-trace");
const { resolveTemporalExpression } = require("../lib/conversation-engine-v2/temporal-resolver");

function rawTrace(temporalCandidate) {
  return { stage: "new_core_understanding", traceId: "diagnostic-trace", rawUnits: [{ unitId: "unit", temporalCandidate }],
    rawResponse: "PRIVATE_RESPONSE", instructions: "PRIVATE_INSTRUCTIONS" };
}
for (const dayOffset of [-1, 0, 5, 366]) test(`bounded raw relative meaning survives persistence projection: ${dayOffset}`, () => {
  const original = rawTrace({ kind: "relative_date", relativeSemantics: { dayOffset, dayPeriod: "night" }, rawText: "PRIVATE_TEMPORAL_TEXT" });
  const before = structuredClone(original), projected = format(original);
  assert.deepEqual(projected.rawUnits[0].temporalCandidate.relativeSemantics, { dayOffset, dayPeriod: "night" });
  assert.deepEqual(format(projected).rawUnits[0].temporalCandidate, projected.rawUnits[0].temporalCandidate);
  assert.equal(JSON.stringify(projected).includes("PRIVATE"), false);
  assert.deepEqual(original, before, "diagnostics must not change Understanding");
});
test("missing relative meaning stays missing, never becomes offset zero", () => {
  const projected = format(rawTrace({ kind: "relative_date" }));
  assert.equal(Object.hasOwn(projected.rawUnits[0].temporalCandidate, "relativeSemantics"), false);
});
test("invalid relative metadata cannot leak arbitrary strings or payload fields", () => {
  const projected = format(rawTrace({ kind: "relative_date", relativeSemantics: { dayOffset: "PRIVATE_OFFSET", dayPeriod: "PRIVATE_PERIOD", response: "PRIVATE_RESPONSE" } }));
  assert.deepEqual(projected.rawUnits[0].temporalCandidate.relativeSemantics, { dayOffset: null, dayPeriod: null });
  assert.equal(JSON.stringify(projected).includes("PRIVATE"), false);
});
for (const offset of [5, 6]) test(`C08 retains actual temporal rejection or success reason: offset ${offset}`, () => {
  const temporalState = resolveTemporalExpression({ rawText: "下週二", kind: "relative", anchor: "message_time", relativeSemantics: { dayOffset: offset, dayPeriod: "unspecified" } },
    { eventTimestamp: "2026-09-17T02:00:00.000Z", timezone: "Asia/Taipei", defaultNights: 1 });
  assert.equal(temporalState.resolutionStatus, offset === 5 ? "resolved" : "unresolved");
  const original = { stage: "new_core_c08", traceId: "diagnostic-trace", items: [{ unitId: "unit", result: { ok: true, value: { canonicalRequest: { temporalState } } } }] };
  const before = structuredClone(original);
  const projected = format(original).items[0].output.temporal;
  assert.equal(projected.repairReasonCode, temporalState.repairReasonCode);
  assert.equal(projected.ambiguity, temporalState.ambiguity);
  if (offset === 6) assert.equal(projected.repairReasonCode, "relative_semantics_conflict");
  assert.deepEqual(original, before, "diagnostics must not change canonical temporal result");
});
test("unrecognized reason values cannot leak arbitrary diagnostic content", () => {
  const projected = format(rawTrace({ repairReasonCode: "PRIVATE_REASON", ambiguity: "PRIVATE_AMBIGUITY" })).rawUnits[0].temporalCandidate;
  assert.equal(projected.repairReasonCode, null);
  assert.equal(projected.ambiguity, null);
});
test("existing message_logs persistence retains temporal evidence without changing the reply", async () => {
  // FAKE_INTEGRATION: isolated PGlite and signed local webhook; fake OpenAI/LINE.
  const { setup } = require("./helpers/burst-production-fixture");
  const x = await setup("temporal-diagnostic", { debounce: 0, pg: true, providerResponse(payload) {
    const output = JSON.parse(payload.output[0].content[0].text), unit = output.understandingOutput.units[0];
    Object.assign(unit, { capability: "availability", subject: { kind: "property", catalogIdentity: null }, stayDependent: true,
      temporalCandidate: { kind: "relative_date", rawText: "下週二", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null,
        relativeSemantics: { dayOffset: 5, dayPeriod: "unspecified" } } });
    payload.output[0].content[0].text = JSON.stringify(output);
    return payload;
  } });
  try {
    const event = x.event("temporal-diagnostic-turn");
    event.message.text = "下週二有房嗎";
    await x.post([event]);
    await x.done(event.webhookEventId);
    const record = x.record(event.webhookEventId);
    assert.equal(x.calls[0].mockCalls, 2);
    assert.equal(x.core[0].decision.action, "clarification");
    assert.equal(record.processingStatus, "reply_succeeded");
    assert.equal(record.replyText, x.core[0].response.replyText);
    assert.equal(x.sent.length, 1);
    const raw = record.safeTrace.find(entry => entry.stage === "new_core_understanding");
    assert.deepEqual(raw.rawUnits[0].temporalCandidate.relativeSemantics, { dayOffset: 5, dayPeriod: "unspecified" });
    const temporal = record.safeTrace.find(entry => entry.stage === "new_core_c08").items[0].output.temporal;
    assert.equal(temporal.repairReasonCode, "relative_semantics_conflict");
    assert.equal(temporal.ambiguity, "relative_semantics_conflict");
    assert.equal(temporal.resolutionStatus, "unresolved");
  } finally { await x.app.stop(); }
});
