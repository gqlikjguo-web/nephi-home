"use strict";
// FAKE_INTEGRATION: fixture OpenAI transport; real admission, lifecycle,
// canonicalization, catalog facts, FinalDecision and FinalResponse.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { isValidatedLifecycleDecision } = require("../lib/new-core/lifecycle-manager");

async function run({ capability = "amenity", relation = "NONE", purpose = "lodging_question", unknown = false, suppressed = false } = {}) {
  const now = "2026-09-17T00:00:00.000Z";
  const scope = { propertyId: "request-evidence-fixture", channel: "isolated", userId: "guest" };
  const property = { propertyId: scope.propertyId, displayName: "Fixture", rooms: [], commonAnswers: {}, businessProfile: {},
    availabilityAutoReplyEnabled: !suppressed,
    propertyFacts: [{ canonicalId: "fixture-fact", category: capability === "policy" ? "policy" : "amenity",
      publicName: "Fixture fact", status: unknown ? "unknown" : "allowed", publicText: unknown ? "" : "Official fixture answer" }] };
  let calls = 0;
  const result = await executeNewCoreTurn({ scope, property, now,
    state: createConversationStateV3({ ...scope, tasks: [], createdAt: now, updatedAt: now, expiresAt: "2026-09-18T00:00:00.000Z" }),
    input: { turnId: "turn", traceId: "trace", message: "Fixture source", recentConversation: [] },
    providerConfig: { apiKey: "fixture-only" },
    resolver: { availability: () => { throw Error("UNEXPECTED_DYNAMIC_QUERY"); }, availableDates: () => { throw Error("UNEXPECTED_DYNAMIC_QUERY"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, fetchImpl: async () => {
      calls++;
      const event = input.sourceEvents[0];
      const ref = { eventId: event.eventId, messageRef: event.messageRef, startOffset: 0, endOffset: event.messageText.length, quote: event.messageText };
      const unit = { unitId: "unit", evidenceRefs: [ref], purpose, capability,
        subject: capability === null ? { kind: null, catalogIdentity: null }
          : capability === "availability" ? { kind: "property", catalogIdentity: null } : { kind: capability, catalogIdentity: "fixture-fact" },
        stayDependent: capability === "availability", temporalCandidate: null, contextLinkCandidateId: "link", safetyCandidate: null, slotCandidates: [], confidenceBand: "high" };
      const output = { understandingOutput: { schemaVersion: 1, turnId: input.turnId, units: [unit] },
        contextLinkCandidates: [{ contextLinkCandidateId: "link", unitId: "unit", relationKind: relation, currentSourceEvidenceRefs: [ref], referencedHistoryEventRefs: [] }] };
      return { ok: true, status: 200, headers: { get: () => "fixture" }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
    } }) });
  assert.equal(calls, 1, "fixture admission requires no correction");
  assert.equal(result.artifacts.understanding.failedUnits.length, 0);
  return result;
}

for (const capability of ["amenity", "policy"]) for (const relation of ["NONE", "NEW_REQUEST"]) {
  test(`validated START keeps official ${capability} answer with relation ${relation}`, async () => {
    const r = await run({ capability, relation });
    assert.equal(isValidatedLifecycleDecision(r.artifacts.outcomes[0].lifecycleDecision), true);
    assert.equal(r.artifacts.outcomes[0].lifecycleDecision.action, "START");
    assert.equal(r.artifacts.outcomes[0].routingDecision.disposition, "ANSWER");
    assert.equal(r.artifacts.canonicalItems.length, 1);
    assert.equal(r.artifacts.executionOutcomes[0].outcome, "answered");
    assert.equal(r.artifacts.requestEvidence[0].activeRequest, true, "validated START must not be denied by a second relation-only request test");
    assert.equal(r.artifacts.requestEvidence[0].requestPresence, "PRESENT");
    assert.equal(r.finalDecision.action, "reply");
    assert.equal(r.finalResponse.replyText, "Official fixture answer");
    assert.equal(r.artifacts.claimValidation.ok, true);
  });
}
for (const purpose of ["conversational_statement", "acknowledgement", "social", "off_topic"]) {
  test(`genuine ${purpose} remains absent and silent`, async () => {
    const r = await run({ capability: null, purpose });
    assert.equal(r.artifacts.outcomes[0].lifecycleDecision.action, "NONE");
    assert.equal(r.artifacts.requestEvidence[0].activeRequest, false);
    assert.equal(r.artifacts.requestEvidence[0].requestPresence, "ABSENT");
    assert.equal(r.artifacts.canonicalItems.length, 0);
    assert.equal(r.finalDecision.action, "no_reply");
    assert.equal(r.finalResponse.replyText, "");
  });
}
test("request existence does not turn unknown facts into an answer", async () => {
  const r = await run({ unknown: true });
  assert.equal(r.artifacts.executionOutcomes[0].outcome, "unknown");
  assert.equal(r.finalResponse.shouldReply, false);
  assert.equal(r.finalResponse.replyText, "");
});
test("validated START does not bypass the property reply suppression gate", async () => {
  const r = await run({ capability: "availability", suppressed: true });
  assert.equal(r.artifacts.outcomes[0].lifecycleDecision.action, "START");
  assert.equal(r.artifacts.requestEvidence[0].replyPermission, "SUPPRESSED");
  assert.equal(r.finalResponse.shouldReply, false);
  assert.equal(r.finalResponse.replyText, "");
});
