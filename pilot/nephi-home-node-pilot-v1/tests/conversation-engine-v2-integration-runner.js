"use strict";
const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");

const states = new Map(), logs = [];
const persistence = {
  getConversationState: (p, c, u) => states.get(`${p}:${c}:${u}`) || null,
  setConversationState: (p, c, u, value) => states.set(`${p}:${c}:${u}`, value),
  appendMessageLog: (p, value) => { const item = { ...value, customerId: p, reviewId: value.needsReview ? `review-${logs.length + 1}` : "" }; logs.push(item); return item; }
};
const property = { propertyId: "p1", displayName: "測試旅宿", timezone: "Asia/Taipei", currency: "TWD", rooms: [{ id: "r1", name: "湖景雙人房", type: "雙人房", capacity: 2, enabled: true, mondayThursdayPrice: 2000, fridayPrice: 2200, saturdayHolidayPrice: 2600, sundayPrice: 2100 }], commonAnswers: { parkingRule: "有一個停車位" }, semanticCatalog: { aliases: { r1: ["兩人房"], parking: ["車位"] }, amenities: [] } };
const planner = { classify: async () => ({
  schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 },
  stateOperations: [
    { field: "stay.checkIn", operation: "set", value: "2026-08-06", sourceText: "8/6" },
    { field: "stay.nights", operation: "set", value: 1, sourceText: "一晚" },
    { field: "stay.guests", operation: "set", value: 2, sourceText: "兩位" },
    { field: "inventory.entityId", operation: "set", value: "r1", sourceText: "雙人房" },
    { field: "inventory.mode", operation: "set", value: "room_only", sourceText: "雙人房" }
  ],
  stay: { dateExpression: { rawText: "8/6", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-06", checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: 2 },
  tasks: [
    { taskId: "a", type: "availability", sourceText: "8/6雙人房有空嗎", requestedOutputs: ["availability"], dependsOnStayContext: true, entity: { category: "room", rawText: "雙人房", canonicalCandidate: "r1", confidence: 0.99 }, confidence: 0.99 },
    { taskId: "b", type: "amenity", sourceText: "有車位嗎", requestedOutputs: ["amenity"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 }, confidence: 0.99 },
    { taskId: "c", type: "amenity", sourceText: "有麻將嗎", requestedOutputs: ["amenity"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "麻將", canonicalCandidate: "mahjong", confidence: 0.7 }, confidence: 0.7 }
  ], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "multi_task"
}) };
const engine = new ConversationEngineV2({ planner, persistence, getProperty: () => property, availability: { getRows: () => [{ date: "2026-08-06", r1: "available" }] }, listPriceOverrides: () => [] });

(async () => {
  const result = await engine.process({ customerId: "p1", channelId: "c1", lineUserId: "u1", eventId: "e1", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6雙人房有空嗎 有車位嗎 有麻將嗎" });
  assert.equal(result.shouldReply, true);
  assert.ok(result.replyText.includes("湖景雙人房"));
  assert.ok(result.replyText.includes("停車位"));
  assert.ok(result.replyText.includes("麻將"));
  assert.equal(result.taskResults.length, 3);
  assert.equal(result.reviewCount, 1);
  assert.equal(logs.filter((x) => x.needsReview).length, 1);
  assert.equal(states.get("p1:c1:u1").schemaVersion, 2);
  assert.equal(result.claimValidation.ok, true);

  const incompleteComposer = { compose: async () => ({ replyText: "8/6 有湖景雙人房。", factTaskIds: ["a"] }) };
  const diagnostics = [];
  const guardedEngine = new ConversationEngineV2({ planner, composer: incompleteComposer, persistence, getProperty: () => property, availability: { getRows: () => [{ date: "2026-08-06", r1: "available" }] }, listPriceOverrides: () => [], onDiagnostic: (item) => diagnostics.push(item) });
  const guarded = await guardedEngine.process({ customerId: "p1", channelId: "c1", lineUserId: "u2", eventId: "e2", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6雙人房有空嗎 有車位嗎 有麻將嗎" });
  assert.ok(guarded.replyText.includes("湖景雙人房"));
  assert.ok(guarded.replyText.includes("停車位"));
  assert.ok(guarded.replyText.includes("麻將"));
  assert.deepEqual(guarded.claimValidation.coveredTaskIds.sort(), ["a", "b", "c"]);
  assert.deepEqual(diagnostics.map((item) => item.stage), ["planner", "validation", "state", "entity_resolution", "executor", "response_plan", "composer", "claim_validator", "line_ready"]);
  assert.equal(new Set(diagnostics.map((item) => item.traceId)).size, 1);
  console.log("conversation engine v2 integration: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
