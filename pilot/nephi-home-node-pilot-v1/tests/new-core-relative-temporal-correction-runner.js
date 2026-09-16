"use strict";
// FAKE_INTEGRATION: real provider admission, lifecycle, canonical temporal,
// FinalDecision/FinalResponse; injected HTTP and availability facts only.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const { callOpenAIUnderstandingV1, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC: D } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");

async function run({ rawText = "下禮拜二", firstOffset = 6, nextOffset = 5, mutate = () => {}, secondError = false,
  timestamp = "2026-09-16T19:28:11.411Z", sibling = false } = {}) {
  const scope = { propertyId: "temporal-correction-fixture", channel: "isolated", userId: "guest" };
  const property = { propertyId: scope.propertyId, displayName: "Fixture", timezone: "Asia/Taipei", rooms: [],
    commonAnswers: {}, businessProfile: {}, propertyFacts: [], availabilityAutoReplyEnabled: true };
  const message = `${rawText}有房嗎`, bodies = [], queries = [];
  let calls = 0, accepted;
  const result = await executeNewCoreTurn({ scope, property, now: "2026-09-17T03:00:00Z",
    state: createConversationStateV3({ ...scope, tasks: [], createdAt: timestamp, updatedAt: timestamp, expiresAt: "2026-09-18T03:00:00Z" }),
    input: { turnId: "turn", traceId: "trace", message, recentConversation: [], sourceEvents: [
      { eventId: "event", messageRef: "message", role: "guest", timestamp, messageKind: "text", messageText: message }
    ] }, providerConfig: { apiKey: "fixture-only" },
    resolver: { availability: query => { queries.push(query); return { customerId: scope.propertyId, availabilityReliable: true,
      rooms: [], checkIn: query.checkIn, checkOut: query.checkOut }; }, availableDates: () => { throw Error("UNEXPECTED_RANGE_QUERY"); },
      priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: async (input, options) => {
      accepted = await callOpenAIUnderstandingV1(input, { ...options, fetchImpl: async (_, request) => {
        bodies.push(JSON.parse(request.body)); calls++;
        if (calls > 2) throw Error("THIRD_CALL_FORBIDDEN");
        if (secondError && calls === 2) throw Error("fixture network failure");
        const ref = { eventId: "event", messageRef: "message", startOffset: 0, endOffset: message.length, quote: message };
        const unit = { unitId: "unit", evidenceRefs: [ref], purpose: "lodging_question", capability: "availability",
          subject: { kind: "property", catalogIdentity: null }, stayDependent: true,
          temporalCandidate: { kind: "relative_date", rawText, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null,
            relativeSemantics: { dayOffset: calls === 1 ? firstOffset : nextOffset, dayPeriod: "unspecified" } },
          contextLinkCandidateId: "link", safetyCandidate: null, slotCandidates: [], confidenceBand: "high" };
        const link = { contextLinkCandidateId: "link", unitId: "unit", relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: [ref], referencedHistoryEventRefs: [] };
        const output = { understandingOutput: { schemaVersion: 1, turnId: input.turnId, units: [unit] }, contextLinkCandidates: [link] };
        if (sibling) {
          output.understandingOutput.units.push({ ...structuredClone(unit), unitId: "sibling", contextLinkCandidateId: "sibling-link",
            temporalCandidate: { ...structuredClone(unit.temporalCandidate), relativeSemantics: { dayOffset: 5, dayPeriod: "unspecified" } } });
          output.contextLinkCandidates.push({ ...structuredClone(link), unitId: "sibling", contextLinkCandidateId: "sibling-link" });
        }
        if (calls === 2) mutate(unit, link, output);
        return { ok: true, status: 200, headers: { get: () => "fixture" }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed",
          usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, total_tokens: 120 },
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
      } });
      return accepted;
    } });
  return { result, calls, bodies, queries, meta: accepted?.[D] };
}

for (const [rawText, nextOffset, date] of [["下禮拜二", 5, "2026-09-22"], ["下禮拜三", 6, "2026-09-23"], ["這禮拜五", 1, "2026-09-18"]]) {
  test(`source-anchored conflict invokes exactly one correction: ${rawText}`, async () => {
    const x = await run({ rawText, firstOffset: nextOffset + 1, nextOffset });
    assert.equal(x.calls, 2);
    assert.equal(x.meta.finalAcceptedAttempt, 2);
    assert.equal(x.queries.length, 1);
    assert.equal(x.queries[0].checkIn, date);
    assert.equal(x.result.earliestFailure, null);
    assert.equal(x.result.finalResponse.shouldReply, true);
    assert.deepEqual(x.bodies[0].text, x.bodies[1].text, "schema unchanged across correction");
    assert.equal(x.bodies[0].instructions, x.bodies[1].instructions, "instructions unchanged");
    assert.deepEqual(x.meta.attempts.map(a => a.usageAccounting.usage.input_tokens), [100, 100]);
    assert.equal(x.meta.attempts[0].validationResult.ok, false);
    assert.equal(x.meta.attempts[1].validationResult.ok, true);
  });
}
test("valid relative meaning remains one call and source event owns the clock", async () => {
  const x = await run({ firstOffset: 5 });
  assert.equal(x.calls, 1); assert.equal(x.queries[0].checkIn, "2026-09-22");
});
for (const options of [{ nextOffset: 6 }, { secondError: true },
  { mutate: unit => { unit.temporalCandidate = null; } },
  { mutate: unit => { unit.temporalCandidate.rawText = "禮拜二"; } },
  { mutate: unit => { unit.temporalCandidate.nightsCandidate = 2; } },
  { mutate: unit => { unit.temporalCandidate.relativeSemantics.dayPeriod = "night"; } },
  { mutate: (_, link) => { link.relationKind = "NONE"; } }]) {
  test(`unsafe or failed correction retains safe unresolved first result: ${JSON.stringify(options, (_, v) => typeof v === "function" ? String(v) : v)}`, async () => {
    const x = await run(options);
    assert.equal(x.calls, 2); assert.equal(x.meta.finalAcceptedAttempt, 1);
    assert.equal(x.queries.length, 0);
    assert.equal(x.result.finalDecision.action, "clarification");
    assert.equal(x.result.artifacts.canonicalItems[0].canonicalRequest.temporalState.repairReasonCode, "relative_semantics_conflict");
  });
}
test("correction cannot change a validated sibling's temporal meaning", async () => {
  const x = await run({ sibling: true, mutate: (_, __, output) => {
    output.understandingOutput.units[1].temporalCandidate.relativeSemantics.dayOffset = 6;
  } });
  assert.equal(x.calls, 2); assert.equal(x.meta.finalAcceptedAttempt, 1);
  assert.equal(x.queries.length, 1); assert.equal(x.queries[0].checkIn, "2026-09-22");
});
