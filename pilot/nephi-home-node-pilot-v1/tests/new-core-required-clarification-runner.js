"use strict";
// FAKE_INTEGRATION: official admission, lifecycle, render and byte validation;
// source-bound model double, no REAL provider or production data claim.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { validateVisibleCoverage } = require("../lib/conversation-engine-v2/render-obligation");
const NOW = "2026-09-14T02:00:00.000Z";

async function run(propertyId, capability, subject) {
  const scope = { propertyId, channel: "isolated", userId: "guest" };
  const property = { propertyId, displayName: "Fixture lodge", timezone: "Asia/Taipei",
    commonAnswers: {}, propertyFacts: [], rooms: [
      { id: "room-type", name: "A lodging type", capacity: 2, type: "double" },
      { id: "lodging-set", name: "Combined lodging", capacity: 2, inventoryType: "bundle", memberRoomIds: ["room-type"] }
    ] };
  const text = capability === "price" ? "Please tell me the lodging rates." : "We would like to arrange lodging.";
  const refs = [{ eventId: "event", messageRef: "event", startOffset: 0, endOffset: text.length, quote: text }];
  let calls = 0, resolverCalls = 0;
  const result = await executeNewCoreTurn({ scope, property, now: NOW,
    state: createConversationStateV3({ ...scope, createdAt: NOW, updatedAt: NOW, expiresAt: "2026-09-15T02:00:00.000Z" }),
    publicBaseUrl: "https://example.invalid", providerConfig: { apiKey: "isolated-model-double" },
    input: { turnId: "event", traceId: "event", message: text, recentConversation: [],
      sourceEvents: [{ eventId: "event", messageRef: "event", role: "guest", timestamp: NOW, messageKind: "text", messageText: text }] },
    resolver: { availability: () => { resolverCalls++; throw Error("unexpected execution"); }, availableDates: () => { resolverCalls++; throw Error("unexpected execution"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, fetchImpl: async () => {
      calls++;
      const unit = { unitId: "request", contextLinkCandidateId: "link", purpose: "lodging_question", capability, subject,
        stayDependent: true, temporalCandidate: null, safetyCandidate: null,
        quantityCandidate: null, slotCandidates: [], evidenceRefs: refs, confidenceBand: "high" };
      const envelope = { understandingOutput: { schemaVersion: 1, turnId: "event", units: [unit] }, contextLinkCandidates: [
        { unitId: "request", contextLinkCandidateId: "link", relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: refs, referencedHistoryEventRefs: [] }
      ] };
      return { ok: true, status: 200, headers: { get: () => "isolated" }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(envelope) }] }] }) };
    } }) });
  assert.equal(result.earliestFailure, null);
  assert.equal(calls, 1);
  assert.equal(resolverCalls, 0);
  return result;
}
for (const propertyId of ["clarifyalpha", "clarifybeta"]) {
  for (const subject of [{ kind: "property", catalogIdentity: null }, { kind: "bundle", catalogIdentity: "lodging-set" }]) {
    test(`${propertyId}/${subject.kind}: required question survives a public reference`, async () => {
      const result = await run(propertyId, "availability", subject);
      assert.equal(result.finalDecision.action, "clarification");
      assert.equal(result.state.tasks.length, 1);
      assert.ok(result.finalResponse.replyText.includes("請提供入住日期。"));
      assert.ok(result.finalResponse.replyText.includes("查房連結："));
      const omitted = result.finalResponse.replyText.replace("請提供入住日期。\n", "");
      assert.ok(validateVisibleCoverage(omitted, result.artifacts.responsePlan, { finalDecision: result.finalDecision }).errors.includes("final_section_missing"));
    });
  }
  test(`${propertyId}: undated price retains its existing reference response`, async () => {
    const result = await run(propertyId, "price", { kind: "property", catalogIdentity: null });
    assert.deepEqual(result.routing, ["ANSWER"]);
    assert.equal(result.finalResponse.replyText, `查房連結：https://example.invalid/${propertyId}`);
  });
}
