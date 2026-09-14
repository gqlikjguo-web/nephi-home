"use strict";
// FAKE_INTEGRATION: official provider admission, core State writer/reload and C01/C05/C08.
const { test } = require("node:test"), assert = require("node:assert/strict");
const { executeNewCoreTurn, turnStateSnapshot } = require("../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3, createConversationTaskV3, readConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const NOW = "2026-09-13T08:00:00.000Z", FUTURE = "2026-09-14T08:00:00.000Z";
const scope = { propertyId: "status-roundtrip", channel: "isolated", userId: "actor" };
const property = { propertyId: scope.propertyId, displayName: "Fixture lodging", timezone: "Asia/Taipei", commonAnswers: {}, rooms: [{ id: "room-a", name: "Garden", capacity: 8, enabled: true }], propertyFacts: [{ canonicalId: "facility-a", category: "amenity", publicName: "Facility", status: "allowed", publicText: "Facility provided." }] };
async function turn(id, state, specs, history = []) {
  const message = specs.map(s => s.text).join("\n"); let calls = 0;
  const result = await executeNewCoreTurn({ scope, property, state, now: NOW, publicBaseUrl: "https://example.invalid", providerConfig: { apiKey: "isolated-provider-double" },
    input: { turnId: id, traceId: id, message, recentConversation: history, sourceEvents: [{ eventId: id, messageRef: id, role: "guest", timestamp: NOW, messageKind: "text", messageText: message }] },
    resolver: { availability: () => { throw new Error("isolated_dependency_failure"); }, availableDates: () => { throw new Error("isolated_dependency_failure"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, nowMs: () => Date.parse(NOW), fetchImpl: async () => {
      calls++;
      const units = specs.map((s, index) => {
        const startOffset = message.indexOf(s.text), evidenceRefs = [{ eventId: id, messageRef: id, startOffset, endOffset: startOffset + s.text.length, quote: s.text }];
        return { unitId: `${id}-${index}`, contextLinkCandidateId: `link-${index}`, evidenceRefs, purpose: s.capability === null ? "conversational_statement" : "lodging_question", capability: s.capability,
          subject: s.capability === null ? { kind: null, catalogIdentity: null } : s.capability === "amenity" ? { kind: "amenity", catalogIdentity: "facility-a" } : { kind: "room", catalogIdentity: "room-a" },
          stayDependent: s.capability === "price", temporalCandidate: s.date ? { rawText: s.date, kind: "absolute_date", checkInCandidate: s.date, checkOutCandidate: null, nightsCandidate: null } : null,
          slotCandidates: [], safetyCandidate: null, confidenceBand: "high" };
      });
      const payload = { understandingOutput: { schemaVersion: 1, turnId: id, units }, contextLinkCandidates: units.map((u, index) => ({ unitId: u.unitId, contextLinkCandidateId: u.contextLinkCandidateId,
        relationKind: specs[index].relation || (u.capability === null ? "NONE" : "NEW_REQUEST"), currentSourceEvidenceRefs: u.evidenceRefs, referencedHistoryEventRefs: specs[index].refs || [] })) };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }] }) };
    } }) });
  return { result, calls };
}
async function firstTurn(status) {
  const empty = createConversationStateV3({ ...scope, tasks: [], createdAt: NOW, updatedAt: NOW, expiresAt: FUTURE });
  const first = await turn("first", empty, [{ capability: "price", date: "2026-12-25", text: "2026-12-25 lodging rate" }]);
  assert.equal(first.result.state.tasks[0].status, "ready", "formal technical outcome retains a ready task");
  const state = readConversationStateV3(JSON.parse(JSON.stringify(first.result.state)), scope, NOW);
  return createConversationStateV3({ ...state, tasks: state.tasks.map(task => createConversationTaskV3({ ...task, status })) });
}
for (const status of ["ready", "in_progress"]) {
  test(`${status}: execution status projects to active without changing persisted data`, async () => {
    const state = await firstTurn(status), before = JSON.stringify(state), cycle = turnStateSnapshot(state, scope, NOW).referenceableCycles[0];
    assert.equal(cycle.status, "active"); assert.equal(cycle.confirmedValues.checkIn, "2026-12-25"); assert.equal(cycle.subject.catalogIdentity, "room-a");
    assert.equal(JSON.stringify(state), before); assert.equal(state.tasks[0].status, status);
    assert.equal(turnStateSnapshot(state, { ...scope, propertyId: "foreign" }, NOW).referenceableCycles.length, 0);
  });
  for (const spec of [{ capability: null, text: "我先和朋友討論，謝謝" }, { capability: "amenity", text: "Is the facility provided?" }]) {
    test(`${status}: history cannot poison independent ${spec.capability || "closure"}`, async () => {
      const next = await turn("next", await firstTurn(status), [spec]);
      assert.equal(next.calls, 1); assert.equal(next.result.earliestFailure, null);
      assert.equal(next.result.finalResponse.shouldReply, spec.capability !== null);
      assert.equal(next.result.finalResponse.replyText.length > 0, spec.capability !== null);
    });
  }
  test(`${status}: evidence-bound date modification retains target identity`, async () => {
    const state = await firstTurn(status), task = state.tasks[0];
    const history = [{ eventId: "history", messageRef: "history", role: "guest", timestamp: "2026-09-13T07:59:00.000Z", messageKind: "text", messageText: "prior lodging request", referenceableCycleIds: [task.taskId] }];
    const next = await turn("changed", state, [{ capability: "price", date: "2026-12-27", text: "Change to 2026-12-27", relation: "MODIFICATION", refs: [{ eventId: "history", messageRef: "history" }] }], history);
    assert.equal(next.calls, 1); assert.equal(next.result.earliestFailure, null);
    assert.equal(next.result.artifacts.canonicalItems[0].canonicalRequest.temporalState.checkIn, "2026-12-27");
    assert.equal(next.result.state.tasks.find(t => t.taskId === task.taskId).checkIn, "2026-12-27");
  });
}
