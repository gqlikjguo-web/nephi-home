"use strict";
// FAKE_INTEGRATION: current provider/C03/C08/State/application; no external calls.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeNewCoreTurn, turnStateSnapshot } = require("../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3, readConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const NOW = "2026-09-12T11:34:00.000Z";
const FUTURE = "2026-09-13T11:34:00.000Z";

function fixture(propertyId) {
  const scope = { propertyId, channel: "isolated", userId: "fixture-guest" };
  const property = { propertyId, displayName: "Property fixture", timezone: "Asia/Taipei",
    rooms: [{ id: "lodging-a", displayName: "Garden room", type: "double", enabled: true }], commonAnswers: {},
    propertyFacts: [{ canonicalId: "facility-a", category: "amenity", publicName: "Facility A", status: "provided", publicText: "Facility A is provided." },
      { canonicalId: "policy-a", category: "policy", publicName: "Policy A", status: "allowed", publicText: "Policy A is allowed." }] };
  return { scope, property };
}

async function turn(f, turnId, state, specs) {
  const text = specs.map(s => s.text).join("\n");
  const event = { eventId: turnId, messageRef: turnId, timestamp: NOW, role: "guest", messageKind: "text", messageText: text };
  let calls = 0;
  const result = await executeNewCoreTurn({ ...f, state, now: NOW, publicBaseUrl: "https://example.invalid",
    input: { turnId, traceId: turnId, message: text, sourceEvents: [event], recentConversation: [] },
    providerConfig: { apiKey: "fixture-only" }, resolver: { availability: () => { throw Error("unexpected inventory query"); },
      availableDates: () => { throw Error("unexpected date query"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, fetchImpl: async () => {
      calls++;
      const units = specs.map((s, i) => ({ unitId: `candidate-${i}`, purpose: s.capability === null ? "conversational_statement" : "lodging_question",
        capability: s.capability, subject: { kind: s.kind, catalogIdentity: s.identity },
        evidenceRefs: [{ eventId: turnId, messageRef: turnId, startOffset: text.indexOf(s.text), endOffset: text.indexOf(s.text) + s.text.length, quote: s.text }],
        stayDependent: s.capability === "availability", temporalCandidate: null, contextLinkCandidateId: `link-${i}`,
        slotCandidates: [], quantityCandidate: null, safetyCandidate: null, confidenceBand: "high" }));
      const payload = { understandingOutput: { schemaVersion: 1, turnId, units }, contextLinkCandidates: units.map(u => ({
        contextLinkCandidateId: u.contextLinkCandidateId, unitId: u.unitId, relationKind: u.capability === null ? "NONE" : "NEW_REQUEST",
        currentSourceEvidenceRefs: u.evidenceRefs, referencedHistoryEventRefs: [] })) };
      return { ok: true, status: 200, headers: { get: () => "fixture-request" }, text: async () => JSON.stringify({ model: "gpt-5.6-luna",
        status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }] }) };
    } }) });
  return { result, calls };
}

const initial = { text: "Could you describe the Garden room?", capability: "property_fact", kind: "room", identity: "lodging-a" };
const facility = { text: "Is Facility A provided?", capability: "amenity", kind: "amenity", identity: "facility-a" };
const policy = { text: "What is Policy A?", capability: "policy", kind: "policy", identity: "policy-a" };
const cases = [
  ["single facility", [facility], true],
  ["mixed independent questions", [facility, policy], true],
  ["availability clarification", [{ text: "I would like to check availability.", capability: "availability", kind: "property", identity: null }], true],
  ["conversational closure", [{ text: "I will discuss it with my companions, thank you.", capability: null, kind: null, identity: null }], false]
];
for (const propertyId of ["roundtrip-alpha", "roundtrip-beta"]) for (const [name, specs, shouldReply] of cases) {
  test(`room fact State reload cannot poison ${name}: ${propertyId}`, async () => {
    const f = fixture(propertyId);
    const empty = createConversationStateV3({ ...f.scope, tasks: [], createdAt: NOW, updatedAt: NOW, expiresAt: FUTURE });
    const first = await turn(f, "first", empty, [initial]);
    assert.equal(first.result.earliestFailure, null);
    assert.equal(first.result.artifacts.canonicalItems[0].canonicalRequest.canonicalEntity.category, "room_feature");
    const stored = readConversationStateV3(JSON.parse(JSON.stringify(first.result.state)), f.scope, NOW);
    assert.equal(stored.tasks[0].entityCategory, "room_feature");
    const snapshot = turnStateSnapshot(stored, f.scope, NOW);
    assert.equal(snapshot.referenceableCycles[0].subject.kind, "room", "canonical room_feature must project back to its formal room subject");
    assert.equal(snapshot.referenceableCycles[0].subject.catalogIdentity, "lodging-a");
    assert.equal(turnStateSnapshot(stored, { ...f.scope, propertyId: "unrelated" }, NOW).referenceableCycles.length, 0);
    const before = JSON.stringify(stored);
    const next = await turn(f, "next", stored, specs);
    assert.equal(next.calls, 1);
    assert.equal(next.result.earliestFailure, null);
    assert.equal(next.result.finalResponse.shouldReply, shouldReply);
    assert.equal(next.result.finalResponse.replyText.length > 0, shouldReply);
    assert.equal(JSON.stringify(stored), before);
    assert.equal(next.result.artifacts.understanding.validatedUnits.length, specs.length);
  });
}
