"use strict";
// FAKE_INTEGRATION: official production adapter/core/Resolver/FinalResponse;
// structured Understanding transport, isolated persistence and formal data.
const assert = require("node:assert/strict");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const { createNewCoreProductionTurnAdapter } = require("../lib/new-core/production-turn-adapter");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { isValidatedFinalResponse, unknownProvenanceFor } = require("../lib/conversation-engine-v2/claim-validator");
const { composition } = require("./new-core-room-composition-persistence-runner");
const NOW = "2026-09-12T12:00:00.000Z";

function formalProperty(id = "composition-alpha") {
  const rooms = [
    { id: "type-family", name: "Family type", capacity: 8, type: "family" },
    { id: "type-loft", name: "Loft type", capacity: 6, type: "double" },
    { id: "package", name: "Garden package", capacity: 20, inventoryType: "bundle", memberRoomIds: ["type-family", "type-loft"] }
  ];
  return { propertyId: id, displayName: "Contract Lodge", timezone: "Asia/Taipei", rooms,
    commonAnswers: {}, propertyFacts: [],
    roomCompositionV1: { ...composition(), revision: 1 },
    roomCompositionInventory: { propertyId: id, roomTypes: rooms.slice(0, 2), bundles: [rooms[2]] }
  };
}

async function query(property, specs, id = "composition-query") {
  const scope = { propertyId: property.propertyId, channel: "isolated", userId: "contract-guest" };
  const events = specs.map((spec, index) => ({ eventId: `${id}-${index}`, messageRef: `${id}-${index}`,
    role: "guest", timestamp: NOW, messageKind: "text", messageText: spec.text }));
  let calls = 0;
  const state = createConversationStateV3({ ...scope, tasks: [], createdAt: NOW, updatedAt: NOW, expiresAt: "2026-09-13T12:00:00.000Z" });
  const adapter = createNewCoreProductionTurnAdapter({
    persistence: { getConversationState: () => state, setConversationState: () => {} },
    customerSettings: { getProperty: () => property, listInventoryPriceOverrides: () => [], listDatePriceClassifications: () => [] },
    service: { searchAvailability: () => { throw Error("unexpected inventory lookup"); }, searchAvailableDates: () => { throw Error("unexpected dates lookup"); } },
    customReplies: { list: () => [] }, providerConfig: { apiKey: "isolated-fixture" },
    publicBaseUrl: "https://example.invalid", now: () => new Date(NOW),
    executeTurn: input => executeNewCoreTurn({ ...input, understandingProvider: (turn, options) => callOpenAIUnderstandingV1(turn, {
      ...options, nowMs: () => Date.parse(NOW), fetchImpl: async () => {
        calls++;
        const units = specs.map((spec, index) => ({ unitId: `unit-${index}`, purpose: spec.purpose || "lodging_question",
          capability: spec.capability, subject: spec.subject, stayDependent: false,
          evidenceRefs: [{ eventId: events[index].eventId, messageRef: events[index].messageRef, startOffset: 0, endOffset: spec.text.length, quote: spec.text }],
          temporalCandidate: null, contextLinkCandidateId: `link-${index}`, safetyCandidate: spec.safetyCandidate || null,
          slotCandidates: spec.informationNeed ? [{ slotCandidateId: `need-${index}`, slot: "information_need", operation: "SET", value: spec.informationNeed, evidenceRefs: [{ eventId: events[index].eventId, messageRef: events[index].messageRef, startOffset: 0, endOffset: spec.text.length, quote: spec.text }] }] : [], quantityCandidate: null, confidenceBand: "high" }));
        const envelope = { understandingOutput: { schemaVersion: 1, turnId: turn.turnId, units },
          contextLinkCandidates: units.map(unit => ({ contextLinkCandidateId: unit.contextLinkCandidateId, unitId: unit.unitId,
            relationKind: unit.capability === null ? "NONE" : "NEW_REQUEST", currentSourceEvidenceRefs: unit.evidenceRefs, referencedHistoryEventRefs: [] })) };
        return { ok: true, status: 200, headers: { get: () => "isolated-fixture" }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(envelope) }] }] }) };
      }
    }) })
  });
  const result = await adapter.process({ customerId: scope.propertyId, channelId: scope.channel, lineUserId: scope.userId,
    eventId: id, messageText: events.map(event => event.messageText).join("\n"), sourceEvents: events });
  return { result, calls, validated: isValidatedFinalResponse(result.finalResponse, { propertyId: scope.propertyId, eventId: id, turnId: id }) };
}

async function run() {
  let cases = 0;
  for (const propertyId of ["composition-alpha", "composition-beta"]) {
    for (const spec of [
      { text: "住宿共有多少實際房間？", subject: { kind: "property", catalogIdentity: null }, count: 3, members: ["East suite", "West suite", "Loft"] },
      { text: "這個房型總共有幾間？", subject: { kind: "room", catalogIdentity: "type-family" }, count: 2, members: ["East suite", "West suite"] },
      { text: "套裝裡面由哪些房間組成？", subject: { kind: "bundle", catalogIdentity: "package" }, count: 2, members: ["West suite", "Loft"] }
    ]) {
      const { result, calls, validated } = await query(formalProperty(propertyId), [{ ...spec, capability: "lodging_room_composition" }]);
      assert.equal(result.earliestFailure, null, JSON.stringify(result.earliestFailure));
      assert.equal(calls, 1); assert.equal(validated, true);
      assert.equal(result.artifacts.executionOutcomes[0].outcome, "answered");
      assert.equal(result.artifacts.executionOutcomes[0].facts.physicalRoomCount, spec.count);
      assert.equal(result.artifacts.executionOutcomes[0].facts.propertyId, propertyId);
      for (const member of spec.members) assert.ok(result.finalResponse.replyText.includes(member), "physical composition must be visible");
      cases++;
    }
  }
  for (const state of ["absent", "incomplete", "foreign_inventory", "invalid_document"]) {
    const property = formalProperty();
    if (state === "absent") delete property.roomCompositionV1;
    if (state === "incomplete") property.roomCompositionV1.inventoryComplete = false;
    if (state === "foreign_inventory") property.roomCompositionInventory.propertyId = "foreign";
    if (state === "invalid_document") property.roomCompositionV1.physicalRooms.push(property.roomCompositionV1.physicalRooms[0]);
    const { result, calls, validated } = await query(property, [{ text: "整個住宿的房間總數？", capability: "lodging_room_composition", subject: { kind: "property", catalogIdentity: null } }]);
    assert.equal(result.earliestFailure, null); assert.equal(calls, 1); assert.equal(validated, false);
    assert.equal(result.finalResponse.shouldReply, false); assert.equal(result.finalResponse.replyText, "");
    const outcome = result.artifacts.executionOutcomes[0];
    if (["foreign_inventory", "invalid_document"].includes(state)) {
      assert.equal(outcome.outcome, "technical_error", "invalid formal data is not epistemic Unknown");
      assert.equal(unknownProvenanceFor(outcome), null);
    } else {
      assert.equal(outcome.outcome, "unknown"); assert.ok(unknownProvenanceFor(outcome));
      assert.equal(outcome.facts.physicalRoomCount, undefined, "unconfirmed mapping is not zero rooms");
    }
    assert.notEqual(result.finalDecision.action, "handoff"); cases++;
  }
  {
    const property = formalProperty();
    property.rooms[0].type = property.rooms[1].type = "Shared category";
    const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
    const { buildC01PublicCatalog } = require("../lib/new-core/turn-input-adapter");
    const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
    const catalog = buildC01PublicCatalog(property, buildPropertyCatalog(property), Object.keys(CAPABILITY_REGISTRY));
    const target = catalog.publicSubjectCatalog.find(item => item.kind === "matched_room_set");
    assert.ok(target);
    const { result, validated } = await query(property, [{ text: "這一類的實際房間總共有多少？", capability: "lodging_room_composition", subject: { kind: target.kind, catalogIdentity: target.catalogIdentity } }]);
    assert.equal(result.earliestFailure, null); assert.equal(validated, true);
    assert.equal(result.artifacts.executionOutcomes[0].facts.physicalRoomCount, 3); cases++;
  }
  {
    const { result, validated } = await query(formalProperty(), [
      { text: "家庭房型有幾間？", capability: "lodging_room_composition", subject: { kind: "room", catalogIdentity: "type-family" } },
      { text: "包套包含哪些房間？", capability: "lodging_room_composition", subject: { kind: "bundle", catalogIdentity: "package" } }
    ]);
    assert.equal(result.earliestFailure, null); assert.equal(validated, true);
    assert.deepEqual(result.artifacts.executionOutcomes.map(item => item.facts.physicalRoomCount), [2, 2]);
    assert.ok(result.finalResponse.replyText.includes("Family type"), "room type count must identify its requested scope");
    assert.ok(result.finalResponse.replyText.includes("Garden package"), "bundle count must identify its requested scope"); cases++;
  }
  console.log(`room composition query: ${cases}/${cases} PASS (FAKE_INTEGRATION)`);
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { query, formalProperty, run };
