"use strict";

const assert = require("node:assert/strict");
const { validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { resolveTemporalExpression } = require("../lib/conversation-engine-v2/temporal-resolver");
const { reduceConversationState, emptyStateV2, conditionsForCycle } = require("../lib/conversation-engine-v2/state-reducer");
const { resolveEntity } = require("../lib/conversation-engine-v2/entity-resolver");
const { executeTasks } = require("../lib/conversation-engine-v2/capability-executor");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");
const { validateClaims } = require("../lib/conversation-engine-v2/claim-validator");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

function buildApprovedPlan(options) {
  return buildResponsePlan(options);
}

function plan(overrides = {}) {
  const output = {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.95 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{ taskId: "t1", type: "availability", sourceText: "有房嗎", requestedOutputs: ["availability"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true, entity: { category: "room", rawText: "雙人房", canonicalCandidate: null, confidence: 0.9 }, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, confidence: 0.95 }],
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "availability_request",
    ...overrides
  };
  const tasks = (output.tasks || []).map((task, candidateIndex) => ({ ...task, candidateIndex }));
  return migrateFakePlannerOutput({
    ...output,
    tasks,
    contextRelationCandidates: output.contextRelationCandidates || tasks.map((task) => ({ candidateIndex: task.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "fixture", messageRef: "", startOffset: 0, endOffset: 1, quote: "x" }] }))
  });
}

const property = {
  propertyId: "property_alpha", displayName: "山屋", timezone: "Asia/Taipei", currency: "TWD",
  rooms: [
    { id: "r1", name: "森林雙人房", type: "雙人房", description: "有浴缸", capacity: 2, enabled: true, mondayThursdayPrice: 2000, fridayPrice: 2300, saturdayHolidayPrice: 2800, sundayPrice: 2100 },
    { id: "r2", name: "家庭四人房", type: "四人房", description: "陽台", capacity: 4, enabled: true, mondayThursdayPrice: 3200, fridayPrice: 3500, saturdayHolidayPrice: 4200, sundayPrice: 3300 },
    { id: "b1", name: "十二人包棟", type: "包棟", inventoryType: "bundle", memberRoomIds: ["r1", "r2"], capacity: 12, enabled: true, mondayThursdayPrice: 9000, fridayPrice: 10000, saturdayHolidayPrice: 12000, sundayPrice: 9500 }
  ],
  commonAnswers: { equipment: ["投影機"], parkingRule: "有兩個停車位", bbqRule: "可在指定區域烤肉", elevatorRule: "館內有電梯", cancellationRule: "取消依確認條款", quietHoursRule: "晚上十點後請降低音量" },
  faqs: [{ knowledgeKey: "equipment", question: "有投影機嗎", answer: "有投影機" }],
  semanticCatalog: { aliases: { r1: ["兩人房"], parking: ["車位", "亭車"] }, amenities: [{ id: "projector", name: "投影機", aliases: ["projector"], status: "confirmed_yes" }, { id: "ktv", name: "唱歌設備", aliases: ["KTV", "卡拉OK", "歡唱"], status: "confirmed_no" }] }
};

assert.equal(validatePlannerOutput(plan()).ok, true);
assert.equal(validatePlannerOutput(plan({ tasks: [{ taskId: "nearest", type: "available_dates", sourceText: "最近哪天有空房", requestedOutputs: ["availability"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 0.95 }, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, confidence: 0.95 }] })).ok, true);
assert.equal(validatePlannerOutput(plan({ tasks: [] })).ok, false);
assert.equal(validatePlannerOutput({ ...plan(), schemaVersion: 1 }).ok, false);
assert.equal(validatePlannerOutput(plan({ stateOperations: [{ field: "stay.unapprovedCandidate", operation: "set", value: "x", sourceText: "x" }] })).ok, false);

const catalog = buildPropertyCatalog(property);
assert.equal(catalog.propertyId, "property_alpha");
assert.equal(JSON.stringify(catalog).includes("內部"), false);
assert.equal(resolveEntity(catalog, { category: "other", rawText: "", canonicalCandidate: "elevator" }).entity.answer, "館內有電梯");
assert.equal(resolveEntity(catalog, { category: "other", rawText: "", canonicalCandidate: "quietHoursRule" }).entity.answer, "晚上十點後請降低音量");
assert.equal(resolveEntity(catalog, { category: "room", rawText: "兩人房", canonicalCandidate: "r1" }).status, "resolved");
assert.equal(resolveEntity(catalog, { category: "amenity", rawText: "卡拉 OK", canonicalCandidate: "ktv" }).entity.status, "confirmed_no");
assert.equal(resolveEntity(catalog, { category: "amenity", rawText: "麻將", canonicalCandidate: "mahjong" }).status, "not_found");
assert.deepEqual(
  buildApprovedPlan({ propertyId: property.propertyId, taskResults: [
    { taskId: "parking-first", type: "amenity", status: "answered", facts: { subject: "停車", status: "confirmed_yes", answer: "有停車位" } },
    { taskId: "availability-second", type: "availability", status: "answered", facts: { checkIn: "2026-08-06", availableInventory: [{ publicName: "森林雙人房" }] } }
  ] }).sections.map((section) => section.taskId),
  ["parking-first", "availability-second"],
  "response sections must remain in the guest question order"
);
const groupedProperty = { ...property, rooms: [
  { id: "g1", name: "Garden 1", type: "Double", capacity: 2, enabled: true },
  { id: "g2", name: "Garden 2", type: "Double", capacity: 2, enabled: true }
] };
const groupedResolution = resolveEntity(buildPropertyCatalog(groupedProperty), { category: "room", rawText: "Double", canonicalCandidate: null });
assert.equal(groupedResolution.status, "matched_set");
assert.deepEqual(groupedResolution.entities.map((item) => item.canonicalId), ["g1", "g2"]);

const unknownRoomResult = executeTasks({
  property: groupedProperty,
  catalog: buildPropertyCatalog(groupedProperty),
  tasks: [{ taskId: "unknown-room", type: "availability", entity: { category: "room", rawText: "Unconfigured room class", canonicalCandidate: null } }],
  request: { stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, guests: null }, inventory: { mode: "room_only", entityId: null, features: [] } },
  availabilityResolver: () => ({ customerId: "property_alpha", checkIn: "2026-08-06", checkOut: "2026-08-07", availabilityReliable: true, rooms: [] })
})[0];
assert.equal(unknownRoomResult.status, "needs_human");
assert.notEqual(unknownRoomResult.facts.availability, "full");

const priceResult = executeTasks({
  property,
  catalog,
  tasks: [{ taskId: "price", type: "price", entity: { category: "room", rawText: "森林雙人房", canonicalCandidate: "r1" } }],
  request: { stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, guests: 2 }, inventory: { mode: "room_only", entityId: null, features: [] } },
  availabilityResolver: () => ({ customerId: "property_alpha", checkIn: "2026-08-06", checkOut: "2026-08-07", availabilityReliable: true, rooms: [property.rooms[0]] })
})[0];
assert.equal(priceResult.status, "answered");
assert.deepEqual(priceResult.facts.prices.map((item) => [item.inventory.canonicalId, item.total]), [["r1", 2000]]);

const eventTime = Date.parse("2026-07-17T10:00:00+08:00");
assert.deepEqual(resolveTemporalExpression({ rawText: "明天", kind: "relative", anchor: "message_time" }, { eventTimestamp: eventTime, timezone: "Asia/Taipei", nightsCandidate: 1 }).checkIn, "2026-07-18");
const mislabeledSingleDate = resolveTemporalExpression({ rawText: "8/6", kind: "range", anchor: "message_time" }, { eventTimestamp: eventTime, timezone: "Asia/Taipei", defaultNights: 1 });
assert.equal(mislabeledSingleDate.checkIn, "2026-08-06");
assert.equal(mislabeledSingleDate.checkOut, "2026-08-07");
assert.equal(mislabeledSingleDate.resolutionStatus, "resolved");
const wrongYearCandidate = resolveTemporalExpression(
  { rawText: "7/18", kind: "absolute", anchor: "message_time" },
  { eventTimestamp: eventTime, timezone: "Asia/Taipei", checkInCandidate: "2056-07-18", defaultNights: 1 }
);
assert.equal(wrongYearCandidate.checkIn, "2026-07-18");
assert.equal(wrongYearCandidate.checkOut, "2026-07-19");
const wrongDayCandidate = resolveTemporalExpression(
  { rawText: "7/18", kind: "absolute", anchor: "message_time" },
  { eventTimestamp: eventTime, timezone: "Asia/Taipei", checkInCandidate: "2056-07-19", defaultNights: 1 }
);
assert.equal(wrongDayCandidate.checkIn, "2026-07-18");
assert.equal(resolveTemporalExpression(
  { rawText: "8/6", kind: "absolute", anchor: "message_time" },
  { eventTimestamp: eventTime, timezone: "Asia/Taipei", checkInCandidate: "2026-08-06", defaultNights: 1 }
).checkIn, "2026-08-06");
assert.equal(resolveTemporalExpression(
  { rawText: "12月3日", kind: "absolute", anchor: "message_time" },
  { eventTimestamp: eventTime, timezone: "Asia/Taipei", checkInCandidate: "2056-12-03", defaultNights: 1 }
).checkIn, "2026-12-03");
assert.equal(resolveTemporalExpression(
  { rawText: "2056/7/18", kind: "absolute", anchor: "message_time" },
  { eventTimestamp: eventTime, timezone: "Asia/Taipei", checkInCandidate: "2056-07-18", defaultNights: 1 }
).checkIn, "2056-07-18");
const yearEnd = Date.parse("2026-12-20T10:00:00+08:00");
assert.equal(resolveTemporalExpression(
  { rawText: "1/5", kind: "absolute", anchor: "message_time" },
  { eventTimestamp: yearEnd, timezone: "Asia/Taipei", checkInCandidate: "2026-01-05", defaultNights: 1 }
).checkIn, "2027-01-05");
assert.deepEqual(resolveTemporalExpression({ rawText: "下週三", kind: "weekday", anchor: "message_time" }, { eventTimestamp: eventTime, timezone: "Asia/Taipei", nightsCandidate: 1 }).checkIn, "2026-07-22");
assert.equal(resolveTemporalExpression({ rawText: "2/30", kind: "absolute", anchor: "message_time" }, { eventTimestamp: eventTime, timezone: "Asia/Taipei" }).resolutionStatus, "unresolved");

let state = emptyStateV2({ propertyId: "property_alpha", channelId: "c1", lineUserId: "u1", now: "2026-07-17T02:00:00.000Z" });
state = reduceConversationState(state, { contextDecision: { action: "start", requestCycleId: "state-test" }, contextPatch: [
  { field: "stay.checkIn", operation: "set", value: "2026-08-06", sourceText: "8/6" },
  { field: "stay.guests", operation: "set", value: 2, sourceText: "兩個人" }
] }, { propertyId: "property_alpha", channelId: "c1", lineUserId: "u1", eventId: "e1", now: "2026-07-17T02:00:00.000Z" });
assert.equal(conditionsForCycle(state, "state-test").stay.guests, 2);
state = reduceConversationState(state, { contextDecision: { action: "replace" }, contextPatch: [{ field: "stay.guests", operation: "replace", value: 4, sourceText: "改四個人" }] }, { propertyId: "property_alpha", channelId: "c1", lineUserId: "u1", eventId: "e2", now: "2026-07-17T02:01:00.000Z" });
assert.equal(state.requestCycles.at(-1).confirmedInputs.stay.guests, 4);
state = reduceConversationState(state, { contextDecision: { action: "continue" }, contextPatch: [{ field: "inventory.features", operation: "clear", value: null, sourceText: "不用浴缸" }] }, { propertyId: "property_alpha", channelId: "c1", lineUserId: "u1", eventId: "e3", now: "2026-07-17T02:02:00.000Z" });
assert.deepEqual(state.requestCycles.at(-1).confirmedInputs.inventory.features, []);

const availabilityResolver = (query) => ({ ...query, availabilityReliable: true, rooms: property.rooms.filter((room) => room.id === "r1") });
const taskResults = executeTasks({
  property, catalog, tasks: [
    plan().tasks[0],
    { taskId: "t2", type: "amenity", sourceText: "有KTV嗎", requestedOutputs: ["amenity"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "KTV", canonicalCandidate: "ktv", confidence: 0.95 }, confidence: 0.95 }
  ],
  request: { stay: { checkIn: "2026-08-06", checkOut: "2026-08-08", nights: 2, guests: 2 }, inventory: { mode: "room_only", entityId: "r1", features: [] } },
  availabilityResolver, priceOverrides: [{ roomId: "r1", date: "2026-08-06", price: 2500, currency: "TWD" }]
});
assert.equal(taskResults[0].status, "answered");
assert.equal(taskResults[0].facts.availableInventory[0].canonicalId, "r1");
assert.equal(taskResults[1].facts.status, "confirmed_no");

const availableDateCalls = [];
const availableDateResult = executeTasks({ property, catalog, tasks: [{ taskId: "dates", type: "available_dates", sourceText: "哪幾天有房", requestedOutputs: ["availability"], dependsOnStayContext: true, entity: { category: "room", rawText: "", canonicalCandidate: null, confidence: 0.9 }, confidence: 0.9 }], request: { stay: { checkIn: null, checkOut: null, nights: 1, guests: 2, searchRange: { from: "2026-08-06", to: "2026-08-08" } }, inventory: { mode: "any", entityId: null, features: [] } }, availableDatesResolver: (query) => { availableDateCalls.push(query); return { status: "answered", dates: [{ checkIn: "2026-08-06", checkOut: "2026-08-07", available: true, roomTypes: [{ roomTypeId: "r1", roomTypeName: "森林雙人房" }] }], source: "property_resolver" }; } })[0];
assert.equal(availableDateResult.status, "answered");
assert.deepEqual(availableDateResult.facts.availableDates, ["2026-08-06"]);
assert.deepEqual(availableDateCalls, [{ customerId: "property_alpha", dateFrom: "2026-08-06", dateTo: "2026-08-08", nights: 1, guests: 2, roomType: "all", queryMode: "any" }]);

const responsePlan = buildApprovedPlan({ propertyId: "property_alpha", taskResults, reviewActions: [] });
const reply = composeControlledReply(responsePlan);
assert.ok(reply.includes("森林雙人房"));
assert.ok(reply.includes("唱歌設備"));
assert.equal(validateClaims(reply, responsePlan).ok, true);
assert.equal(validateClaims("已經幫你保留房間", responsePlan).ok, false);

console.log("conversation engine v2 capability matrix: PASS");
