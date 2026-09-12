"use strict";
// FAKE_INTEGRATION: actual current Understanding admission/application/executor;
// injected provider payload, in-memory formal property data, no network or writes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { callOpenAIUnderstandingV1, openAiUnderstandingV1ProviderSchema } = require("../lib/providers/openai-understanding-v1");
const { isValidatedFinalResponse } = require("../lib/conversation-engine-v2/claim-validator");

for (const [propertyId, names] of [["collection-a", ["Garden pavilion", "Reading lounge"]],
  ["collection-b", ["觀景平台", "共用廚房"]]]) {
  test(`one admitted collection reaches official facts and one visible section: ${propertyId}`, async () => {
    const now = "2026-09-12T08:00:00.000Z", turnId = `turn-${propertyId}`;
    const scope = { propertyId, channel: "isolated", userId: "collection-guest" };
    const messageText = "What facilities are available?";
    const event = { eventId: turnId, messageRef: turnId, role: "guest", timestamp: now, messageKind: "text", messageText };
    const ref = { eventId: turnId, messageRef: turnId, startOffset: 0, endOffset: messageText.length, quote: messageText };
    const property = { propertyId, displayName: "Collection fixture", timezone: "Asia/Taipei", rooms: [], commonAnswers: {},
      propertyFacts: names.map((publicName, i) => ({ canonicalId: `facility-${i}`, category: "amenity", publicName,
        status: "provided", publicText: `${publicName} is provided.`, aliases: [] })) };
    let calls = 0, inventoryCalls = 0, admission = null;
    const result = await executeNewCoreTurn({ scope, property, now,
      state: createConversationStateV3({ ...scope, tasks: [], createdAt: now, updatedAt: now, expiresAt: now }),
      input: { turnId, traceId: turnId, message: messageText, sourceEvents: [event], recentConversation: [] },
      resolver: { availability: () => { inventoryCalls++; throw Error("unexpected inventory call"); },
        availableDates: () => { inventoryCalls++; throw Error("unexpected date search"); },
        priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
      providerConfig: { apiKey: "fixture-only" }, publicBaseUrl: "https://example.invalid",
      understandingProvider: (input, options) => {
        const branches = openAiUnderstandingV1ProviderSchema(input).properties.understandingOutput.properties.units.items.anyOf;
        const propertySubjects = branches.filter(branch => branch.properties.capability.enum.includes("amenity_list"))
          .flatMap(branch => branch.properties.subject.anyOf).filter(subject => subject.properties.kind.enum.includes("property"));
        admission = { propertySubjects, catalogSubjects: input.publicSubjectCatalog.filter(subject => subject.kind === "property") };
        // No fabricated identity: the payload can reference only a projected catalog subject.
        const propertyIdentity = admission.catalogSubjects[0]?.catalogIdentity ?? null;
        return callOpenAIUnderstandingV1(input, { ...options, fetchImpl: async () => {
        calls++;
        const unit = { unitId: "collection", evidenceRefs: [ref], purpose: "lodging_question", capability: "amenity_list",
          subject: { kind: "property", catalogIdentity: propertyIdentity }, stayDependent: false, temporalCandidate: null,
          contextLinkCandidateId: "collection-link", safetyCandidate: null, slotCandidates: [], quantityCandidate: null, confidenceBand: "high" };
        const output = { understandingOutput: { schemaVersion: 1, turnId, units: [unit] }, contextLinkCandidates: [{
          contextLinkCandidateId: unit.contextLinkCandidateId, unitId: unit.unitId, relationKind: "NEW_REQUEST",
          currentSourceEvidenceRefs: [ref], referencedHistoryEventRefs: [] }] };
        return { ok: true, status: 200, headers: { get: () => "fixture-request" }, text: async () => JSON.stringify({
          model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
      } }); }
    });
    assert.ok(admission.propertySubjects.length > 0 && admission.catalogSubjects.length > 0,
      `CORE_FAIL: property amenity_list has no legal public-catalog/provider representation: ${JSON.stringify(admission)}`);
    assert.equal(calls, 1);
    assert.equal(inventoryCalls, 0);
    assert.equal(result.earliestFailure, null);
    const a = result.artifacts;
    assert.equal(a.canonicalItems.length, 1);
    assert.equal(a.canonicalItems[0].canonicalRequest.capability, "amenity_list");
    assert.equal(a.executionOutcomes.length, 1);
    assert.equal(a.executionOutcomes[0].outcome, "answered");
    assert.equal(a.executionOutcomes[0].facts.source, "property_catalog");
    assert.equal(a.executionOutcomes[0].facts.propertyId, propertyId);
    assert.deepEqual(a.executionOutcomes[0].facts.amenities, names);
    assert.equal(result.finalDecision.reasonCode, "execution_answered");
    assert.equal(result.finalResponse.shouldReply, true);
    for (const name of names) assert.equal(result.finalResponse.replyText.split(name).length - 1, 1);
    assert.equal(isValidatedFinalResponse(result.finalResponse, { propertyId, turnId, eventId: turnId }), true);
  });
}
