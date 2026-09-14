"use strict";
// FAKE_INTEGRATION: source-bound typed Understanding, official admission,
// readiness, lifecycle, State and FinalResponse. No REAL provider claim.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeNewCoreTurn, turnStateSnapshot } = require("../lib/new-core/application-service");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { isValidatedFinalResponse } = require("../lib/conversation-engine-v2/claim-validator");
const { formalProperty } = require("./new-core-room-composition-query-runner");
const { createMvpService } = require("../lib/mvp-service");
const NOW = "2026-09-13T08:00:00.000Z";

async function run(propertyId, spec, previous = null) {
  const scope = { propertyId, channel: "isolated", userId: "guest" };
  const property = formalProperty(propertyId);
  const state = previous?.state || createConversationStateV3({ ...scope, createdAt: NOW, updatedAt: NOW, expiresAt: "2026-09-14T08:00:00.000Z" });
  const id = previous ? "next-turn" : "first-turn";
  const text = spec.text;
  const refs = [{ eventId: id, messageRef: id, startOffset: 0, endOffset: text.length, quote: text }];
  const unit = { unitId: id, contextLinkCandidateId: id, evidenceRefs: refs,
    purpose: spec.purpose, capability: spec.capability, subject: spec.subject,
    stayDependent: spec.capability === "availability", temporalCandidate: spec.temporal || null,
    safetyCandidate: spec.safety || null,
    slotCandidates: spec.guests ? [{ slotCandidateId: id, slot: "guest_count", operation: "SET", value: spec.guests, evidenceRefs: refs }] : [],
    quantityCandidate: null, confidenceBand: "high" };
  const snapshot = turnStateSnapshot(state, scope, NOW);
  const history = previous ? [{ eventId: "first-turn", messageRef: "first-turn", role: "guest", timestamp: NOW,
    messageKind: "text", messageText: previous.text,
    referenceableCycleIds: snapshot.referenceableCycles.map(c => c.requestCycleId) }] : [];
  const service = createMvpService({ customerSettings: { getProperty: () => property }, persistence: {},
    availability: { getRows: () => [{ date: "2026-10-25", ...Object.fromEntries(property.rooms.map(room => [room.id, "closed"])) }] } });
  let calls = 0;
  const diagnostics = [];
  const result = await executeNewCoreTurn({ scope, state, property, now: NOW,
    publicBaseUrl: "https://example.invalid", providerConfig: { apiKey: "isolated-provider-double" }, onDiagnostic: value => diagnostics.push(value),
    input: { turnId: id, traceId: id, message: text, recentConversation: history,
      sourceEvents: [{ eventId: id, messageRef: id, role: "guest", timestamp: NOW, messageKind: "text", messageText: text }] },
    resolver: { availability: query => { assert.ok(spec.temporal, "execution requires supplied dates"); return service.searchAvailability(query); },
      availableDates: () => { throw Error("unexpected date search"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, nowMs: () => Date.parse(NOW), fetchImpl: async () => {
      calls++;
      const payload = { understandingOutput: { schemaVersion: 1, turnId: id, units: [unit] }, contextLinkCandidates: [{
        unitId: id, contextLinkCandidateId: id, relationKind: spec.capability === null ? "NONE" : previous ? (spec.relation || "MODIFICATION") : "NEW_REQUEST",
        currentSourceEvidenceRefs: refs, referencedHistoryEventRefs: previous ? [{ eventId: "first-turn", messageRef: "first-turn" }] : [] }] };
      return { ok: true, status: 200, headers: { get: () => "isolated-request" }, text: async () => JSON.stringify({ model: "gpt-5.6-luna",
        status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }] }) };
    } }) });
  return { result, calls, scope, state: result.state, text, diagnostics };
}

for (const propertyId of ["intent-alpha", "intent-beta"]) {
  for (const subject of [{ kind: "property", catalogIdentity: null }, { kind: "bundle", catalogIdentity: "package" }]) {
    test(`booking intent has a pending cycle and accepts a follow-up: ${propertyId}/${subject.kind}`, async () => {
      const spec = { text: "I would like to arrange a stay.", purpose: "lodging_question", capability: "availability", subject };
      const first = await run(propertyId, spec);
      assert.equal(first.result.earliestFailure, null);
      assert.equal(first.calls, 1);
      assert.equal(first.result.finalDecision.action, "clarification");
      assert.equal(first.result.finalResponse.shouldReply, true);
      assert.ok(first.result.finalDecision.missingFields.includes("stay.checkIn"));
      assert.equal(first.state.tasks.length, 1);
      assert.equal(turnStateSnapshot(first.state, first.scope, NOW).referenceableCycles[0].status, "pending");
      assert.equal(isValidatedFinalResponse(first.result.finalResponse, { propertyId, turnId: "first-turn", eventId: "first-turn" }), true);
      const next = await run(propertyId, { ...spec, text: "Please change the party size to three guests.", guests: 3 }, first);
      assert.equal(next.result.earliestFailure, null, JSON.stringify(next.diagnostics));
      assert.equal(next.calls, 1);
      assert.equal(next.result.finalDecision.action, "clarification");
      assert.equal(next.state.tasks.length, 1, "continuation must retain the existing pending task");
      assert.equal(next.state.tasks[0].guestCount, 3);
      // Providing all missing fields completes the target; readiness cannot
      // override source-bound SUPPLEMENT into an independent NEW_REQUEST.
      const completed = await run(propertyId, { ...spec, text: "Two guests, arriving 10/25 for one night.", guests: 2,
        relation: "SUPPLEMENT", temporal: { rawText: "10/25", kind: "month_day", checkInCandidate: null,
          checkOutCandidate: null, nightsCandidate: 1 } }, first);
      assert.equal(completed.result.earliestFailure, null, JSON.stringify(completed.diagnostics));
      assert.equal(completed.calls, 1, "valid completion must not trigger correction");
      assert.equal(completed.state.tasks.length, 1, "full supplementation retains exactly the pending task");
      assert.equal(completed.state.tasks[0].taskId, first.state.tasks[0].taskId);
      assert.equal(completed.state.tasks[0].guestCount, 2);
      assert.equal(completed.result.artifacts.canonicalItems[0].canonicalRequest.temporalState.checkIn, "2026-10-25");
      assert.equal(completed.result.artifacts.canonicalItems[0].canonicalRequest.temporalState.checkOut, "2026-10-26");
      assert.equal(completed.result.finalDecision.action, "reply");
      assert.equal(isValidatedFinalResponse(completed.result.finalResponse, { propertyId, turnId: "next-turn", eventId: "next-turn" }), true);

    });
  }
  test(`actual operator action retains human responsibility: ${propertyId}`, async () => {
    const x = await run(propertyId, { text: "Please cancel my confirmed reservation.", purpose: "operator_request",
      capability: "booking_operator_request", subject: { kind: "other_verified", catalogIdentity: null },
      safety: { operatorActionClass: "reservation_cancellation", riskClass: null } });
    assert.equal(x.result.earliestFailure, null);
    assert.equal(x.result.finalDecision.action, "handoff");
    assert.equal(x.result.finalResponse.shouldReply, true);
  });
  test(`personal deliberation has no booking task: ${propertyId}`, async () => {
    const x = await run(propertyId, { text: "We will think it over together.", purpose: "conversational_statement",
      capability: null, subject: { kind: null, catalogIdentity: null } });
    assert.equal(x.result.earliestFailure, null);
    assert.equal(x.result.finalDecision.action, "no_reply");
    assert.equal(x.result.finalResponse.replyText, "");
    assert.equal(x.state.tasks.length, 0);
  });
}
