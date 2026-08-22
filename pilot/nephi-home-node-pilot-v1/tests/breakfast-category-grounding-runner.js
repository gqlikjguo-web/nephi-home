"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");

const property = {
  propertyId: "breakfast_property", displayName: "通用旅宿", timezone: "Asia/Taipei", currency: "TWD",
  rooms: [{ id: "bundle_main", name: "全館包棟", inventoryType: "bundle", capacity: 12, enabled: true, memberRoomIds: [] }],
  propertyFacts: [{ canonicalId: "breakfast", category: "policy", publicName: "早餐說明", status: "provided", publicText: "住宿不附早餐，可協助提供附近早餐店資訊。", aliases: ["早餐"] }],
  semanticCatalog: { aliases: { breakfast: ["早餐"], bundle_main: ["包棟"] } }
};

function task({ candidateIndex, taskId, type, sourceText, category, canonicalCandidate, detailIntent = "general", requestedOutputs = ["answer"] }) {
  return { candidateIndex, taskId, type, sourceText, detailIntent, requestedOutputs, eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: false,
    entity: { category, rawText: sourceText, canonicalCandidate, confidence: 1 }, stayCandidate: null, confidence: 1 };
}

function plan(messageText, tasks) {
  return { schemaVersion: 2, discourse: { relation: "new_request", confidence: 1 }, stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, tasks,
    contextRelationCandidates: tasks.map((item) => { const startOffset = messageText.indexOf(item.sourceText); assert.notEqual(startOffset, -1); return { candidateIndex: item.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "event", messageRef: "message", startOffset, endOffset: startOffset + item.sourceText.length, quote: item.sourceText }] }; }),
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "breakfast_category_grounding" };
}

async function execute(messageText, tasks) {
  const engine = new ConversationEngineV2({ planner: { classify: async () => plan(messageText, tasks) },
    persistence: { getConversationState: () => null, setConversationState: () => {}, appendMessageLog: () => ({ reviewId: "" }), updateMessageEvent: () => ({}) },
    getProperty: () => property, availabilityResolver: () => { throw new Error("breakfast must not call availability"); }, availableDatesResolver: () => ({ status: "answered", dates: [] }),
    listPriceOverrides: () => [], listDatePriceClassifications: () => [], listCustomReplies: () => [], now: () => new Date("2026-08-22T02:00:00.000Z") });
  return engine.process({ customerId: property.propertyId, channelId: `channel-${tasks.length}`, lineUserId: "guest", eventId: "event", messageRef: "message", eventTimestamp: Date.parse("2026-08-22T10:00:00+08:00"), messageText });
}

async function singleBreakfast() {
  const message = "請問有早餐嗎";
  const result = await execute(message, [task({ candidateIndex: 0, taskId: "breakfast", type: "amenity", sourceText: message, category: "amenity", canonicalCandidate: "breakfast" })]);
  assert.equal(result.finalDecision.action, "reply");
  assert.match(result.replyText, /住宿不附早餐，可協助提供附近早餐店資訊。/);
  assert.equal(result.taskResults[0].facts.source, "property_catalog");
  assert.equal(result.taskResults[0].facts.propertyId, property.propertyId);
}

async function multiQuestionBreakfast() {
  const message = "包棟最多幾人，以及附早餐嗎？酌收清潔費多少？";
  const result = await execute(message, [
    task({ candidateIndex: 0, taskId: "capacity", type: "lodging_product_capacity", sourceText: "包棟最多幾人", category: "bundle", canonicalCandidate: "bundle_main" }),
    task({ candidateIndex: 1, taskId: "breakfast", type: "amenity", sourceText: "附早餐嗎？", category: "amenity", canonicalCandidate: "breakfast" }),
    task({ candidateIndex: 2, taskId: "cleaning", type: "unknown", sourceText: "清潔費多少？", category: "other", canonicalCandidate: null })
  ]);
  assert.match(result.replyText, /全館包棟/);
  assert.match(result.replyText, /最多可住 12 人/);
  assert.match(result.replyText, /住宿不附早餐，可協助提供附近早餐店資訊。/);
  assert.equal(result.taskResults.find((item) => item.taskId === "capacity").status, "answered");
  assert.equal(result.taskResults.find((item) => item.taskId === "breakfast").status, "answered");
  assert.equal(result.taskResults.find((item) => item.taskId === "cleaning").status, "needs_human");
  assert.equal(result.finalDecision.action, "reply");
  assert.equal(result.finalDecision.reviewRequired, true);
}

async function nonGeneralDoesNotUseCategoryDrift() {
  const message = "早餐費用";
  const result = await execute(message, [task({ candidateIndex: 0, taskId: "breakfast-fee", type: "amenity", sourceText: message, category: "amenity", canonicalCandidate: "breakfast", detailIntent: "fee", requestedOutputs: ["fee"] })]);
  assert.equal(result.finalDecision.action, "handoff");
  assert.notEqual(result.taskResults[0].status, "answered");
}

Promise.allSettled([singleBreakfast(), multiQuestionBreakfast(), nonGeneralDoesNotUseCategoryDrift()]).then((results) => {
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) { for (const failure of failures) console.error(failure.reason && failure.reason.stack || failure.reason); process.exitCode = 1; return; }
  console.log("breakfast category grounding: PASS");
});
