"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");

const property = {
  propertyId: "supplement_property",
  displayName: "測試旅宿",
  timezone: "Asia/Taipei",
  currency: "TWD",
  businessProfile: { publicSlug: "supplement-lodge" },
  rooms: [
    { id: "room_alpha", name: "四人套房", type: "四人房", capacity: 4, enabled: true, mondayThursdayPrice: 3200, fridayPrice: 3500, saturdayHolidayPrice: 4200, sundayPrice: 3300 },
    { id: "bundle_alpha", name: "全館包棟", inventoryType: "bundle", capacity: 8, enabled: true, memberRoomIds: ["room_alpha"], mondayThursdayPrice: 8800, fridayPrice: 9600, saturdayHolidayPrice: 10800, sundayPrice: 9200 }
  ],
  semanticCatalog: { aliases: { room_alpha: ["四人房"], bundle_alpha: ["包棟"] } }
};

const emptyStay = () => ({
  dateExpression: { rawText: "", kind: "none", anchor: "none" },
  checkInCandidate: null,
  checkOutCandidate: null,
  nightsCandidate: null,
  guestCountCandidate: null
});

function task({ taskId, sourceText, entity, stayCandidate = emptyStay() }) {
  return {
    candidateIndex: 0,
    taskId,
    type: "price",
    sourceText,
    detailIntent: "general",
    requestedOutputs: ["price"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: true,
    entity: entity || { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 },
    stayCandidate,
    confidence: 1
  };
}

function plan({ source, plannerTask, contextSnapshot, relation = "new_request" }) {
  const cycleId = contextSnapshot.cycles[0] && contextSnapshot.cycles[0].requestCycleId;
  return {
    schemaVersion: 2,
    discourse: { relation: relation === "new_request" ? "new_request" : "continue", confidence: 1 },
    stateOperations: [],
    stay: plannerTask.stayCandidate || emptyStay(),
    tasks: [plannerTask],
    contextRelationCandidates: [{
      candidateIndex: 0,
      kind: relation,
      candidateRequestCycleRefs: relation === "new_request" ? [] : [cycleId],
      evidenceRefs: [{ eventId: source.eventId, messageRef: source.messageRef || "", startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }]
    }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "lodging_price_slot_supplement"
  };
}

function harness(plans) {
  const states = new Map();
  const resolverCalls = [];
  const diagnostics = [];
  const engine = new ConversationEngineV2({
    planner: {
      classify: async ({ sourceEvents, contextSnapshot }) => {
        const next = plans.shift();
        return plan({ source: sourceEvents[0], contextSnapshot, ...next });
      }
    },
    persistence: {
      getConversationState: (propertyId, channelId, userId) => states.get(`${propertyId}:${channelId}:${userId}`) || null,
      setConversationState: (propertyId, channelId, userId, state) => states.set(`${propertyId}:${channelId}:${userId}`, state),
      appendMessageLog: () => ({ reviewId: "" }),
      updateMessageEvent: () => ({})
    },
    getProperty: () => property,
    availabilityResolver: (query) => {
      resolverCalls.push(query);
      const rooms = property.rooms.filter((room) => query.roomType === "all" || room.id === query.roomType);
      return { ...query, availabilityReliable: true, rooms };
    },
    availableDatesResolver: () => ({ status: "answered", dates: [], source: "formal_availability" }),
    listPriceOverrides: () => [],
    listDatePriceClassifications: () => [],
    listCustomReplies: () => [],
    publicBaseUrl: "https://guest.example",
    now: () => new Date("2026-08-22T02:00:00.000Z"),
    onDiagnostic: (entry) => diagnostics.push(entry)
  });
  const process = (session, turn, messageText) => engine.process({
    customerId: property.propertyId,
    channelId: session,
    lineUserId: "guest",
    eventId: `${session}-${turn}`,
    messageRef: `${session}-${turn}-message`,
    eventTimestamp: Date.parse("2026-08-22T10:00:00+08:00"),
    messageText
  });
  return { process, resolverCalls, diagnostics };
}

async function bundleThenDate() {
  const dateStay = { ...emptyStay(), dateExpression: { rawText: "星期六", kind: "weekday", anchor: "message_time" } };
  const runtime = harness([
    { plannerTask: task({ taskId: "bundle-price", sourceText: "包棟多少", entity: { category: "bundle", rawText: "包棟", canonicalCandidate: "bundle_alpha", confidence: 1 } }) },
    { relation: "supplement_existing", plannerTask: task({ taskId: "bundle-date", sourceText: "星期六", stayCandidate: dateStay }) }
  ]);
  const first = await runtime.process("bundle-date", 1, "包棟多少");
  assert.equal(first.finalDecision.action, "clarification");
  assert.match(first.replyText, /請提供入住日期/);
  assert.match(first.replyText, /https:\/\/guest\.example\/supplementlodge/);
  const second = await runtime.process("bundle-date", 2, "星期六");
  assert.notEqual(second.finalDecision.action, "handoff", "a valid date supplement must not fail semantic ownership");
  assert.equal(second.taskResults[0].type, "price");
  assert.equal(second.taskResults[0].status, "answered");
  assert.equal(runtime.resolverCalls.length, 1);
  assert.equal(runtime.resolverCalls[0].roomType, "bundle_alpha");
  assert.ok(second.replyText.includes("全館包棟"));
}

async function priceThenRoomThenDate() {
  const dateStay = { ...emptyStay(), dateExpression: { rawText: "下週日", kind: "weekday", anchor: "message_time" } };
  const runtime = harness([
    { plannerTask: task({ taskId: "generic-price", sourceText: "價格？" }) },
    { relation: "supplement_existing", plannerTask: task({ taskId: "room-supplement", sourceText: "四人房", entity: { category: "room", rawText: "四人房", canonicalCandidate: "room_alpha", confidence: 1 } }) },
    { relation: "supplement_existing", plannerTask: task({ taskId: "date-supplement", sourceText: "下週日", stayCandidate: dateStay }) }
  ]);
  const first = await runtime.process("room-date", 1, "價格？");
  assert.equal(first.finalDecision.action, "clarification");
  const second = await runtime.process("room-date", 2, "四人房");
  assert.equal(second.finalDecision.action, "clarification", "a valid product supplement must retain the price request");
  assert.match(second.replyText, /請提供入住日期/);
  assert.match(second.replyText, /https:\/\/guest\.example\/supplementlodge/);
  const third = await runtime.process("room-date", 3, "下週日");
  assert.notEqual(third.finalDecision.action, "handoff", "a valid date supplement must retain the approved room and price request");
  assert.equal(third.taskResults[0].type, "price");
  assert.equal(third.taskResults[0].status, "answered");
  assert.equal(runtime.resolverCalls.length, 1);
  assert.equal(runtime.resolverCalls[0].roomType, "room_alpha");
  assert.ok(third.replyText.includes("四人套房"));
}

Promise.allSettled([bundleThenDate(), priceThenRoomThenDate()])
  .then((results) => {
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      for (const failure of failures) console.error(failure.reason && failure.reason.stack || failure.reason);
      process.exitCode = 1;
      return;
    }
    console.log("lodging price supplement semantic ownership: PASS");
  });
