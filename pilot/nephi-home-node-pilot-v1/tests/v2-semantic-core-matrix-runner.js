"use strict";

const assert = require("node:assert/strict");
const { createMvpService } = require("../lib/mvp-service");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { resolveEntity } = require("../lib/conversation-engine-v2/entity-resolver");
const { executeTasks } = require("../lib/conversation-engine-v2/capability-executor");
const { resolveTemporalExpression, inferExplicitTemporalExpression } = require("../lib/conversation-engine-v2/temporal-resolver");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");

function buildApprovedPlan(options) {
  return buildResponsePlan(options);
}

const eventTime = Date.parse("2026-07-17T10:00:00+08:00");
const properties = [
  { propertyId: "matrix_alpha", displayName: "Alpha Lodge", timezone: "Asia/Taipei", rooms: [{ id: "a_double_1", name: "A1", type: "Double", capacity: 2, enabled: true }, { id: "a_double_2", name: "A2", type: "Double", capacity: 2, enabled: true }, { id: "a_quad", name: "A4", type: "Quad", capacity: 4, enabled: true }, { id: "a_house", name: "A House", type: "House", inventoryType: "bundle", capacity: 10, enabled: true }], commonAnswers: { parkingRule: "Alpha parking.", bbqRule: "Alpha barbecue.", checkInTime: "Alpha check-in.", selfCheckInRule: "Alpha self check-in." }, faqs: [{ knowledgeKey: "pool", question: "Pool", answer: "Alpha pool." }], semanticCatalog: { aliases: { parking: ["parking"], bbq: ["bbq"], check_in: ["checkin"], self_checkin: ["password"], pool: ["pool"] } } },
  { propertyId: "matrix_beta", displayName: "Beta Lodge", timezone: "Asia/Taipei", rooms: [{ id: "b_couple", name: "B Couple", type: "Couple", capacity: 2, enabled: true }, { id: "b_family", name: "B Family", type: "Family", capacity: 5, enabled: true }], commonAnswers: { parkingRule: "Beta parking." }, faqs: [{ knowledgeKey: "pool", question: "Pool", answer: "Beta pool." }], semanticCatalog: { aliases: { parking: ["parking"], pool: ["pool"] } } }
];
const rows = {
  matrix_alpha: { "2026-07-18": { date: "2026-07-18", a_double_1: "available", a_double_2: "available", a_quad: "available", a_house: "available" }, "2026-07-19": { date: "2026-07-19", a_double_1: "closed", a_double_2: "available", a_quad: "closed", a_house: "closed" }, "2026-08-06": { date: "2026-08-06", a_double_1: "available", a_double_2: "available", a_quad: "closed", a_house: "closed" } },
  matrix_beta: { "2026-07-18": { date: "2026-07-18", b_couple: "available", b_family: "available" } }
};
const service = createMvpService({ customerSettings: { getProperty: (id) => properties.find((property) => property.propertyId === id) || null, listProperties: () => properties }, availability: { getRows: (id, from, to) => Object.values(rows[id] || {}).filter((row) => row.date >= from && row.date < to) }, persistence: {} });
const alpha = properties[0], alphaCatalog = buildPropertyCatalog(alpha);
const request = { stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, guests: null, searchRange: { from: "2026-07-18", to: "2026-08-18" } }, inventory: { mode: "any" } };
const run = (property, catalog, tasks, currentRequest = request) => executeTasks({ property, catalog, tasks, request: currentRequest, availabilityResolver: (query) => service.searchAvailability(query), availableDatesResolver: (query) => service.searchAvailableDates(query) });

let cases = 0;
for (const rawText of ["房", "房間", "空房", "有房", "還有房", "可以訂", "可訂", "可預訂"]) {
  const result = run(alpha, alphaCatalog, [{ taskId: rawText, type: "availability", entity: { category: "other", rawText, canonicalCandidate: null } }])[0];
  assert.equal(result.status, "answered"); assert.deepEqual(result.facts.availableInventory.map((room) => room.canonicalId), ["a_double_1", "a_double_2"]); cases += 1;
}
for (const item of [
  [{ rawText: "7/18", kind: "absolute" }, "2026-07-18"], [{ rawText: "明天", kind: "relative" }, "2026-07-18"], [{ rawText: "後天", kind: "relative" }, "2026-07-19"], [{ rawText: "下週三", kind: "weekday" }, "2026-07-22"], [{ rawText: "1/5", kind: "absolute" }, "2027-01-05"], [{ rawText: "週末", kind: "weekend" }, "2026-07-18"], [{ rawText: "8/6", kind: "range" }, "2026-08-06"], [{ rawText: "12月3日", kind: "absolute" }, "2026-12-03"]
]) { assert.equal(resolveTemporalExpression({ rawText: item[0].rawText, kind: item[0].kind, anchor: "message_time" }, { eventTimestamp: eventTime, timezone: "Asia/Taipei", defaultNights: 1 }).checkIn || resolveTemporalExpression({ rawText: item[0].rawText, kind: item[0].kind, anchor: "message_time" }, { eventTimestamp: eventTime, timezone: "Asia/Taipei", defaultNights: 1 }).searchRange.from, item[1]); cases += 1; }
const pastDate = resolveTemporalExpression({ rawText: "7/18", kind: "absolute", anchor: "message_time" }, { eventTimestamp: Date.parse("2026-07-19T10:00:00+08:00"), timezone: "Asia/Taipei", defaultNights: 1 });
assert.equal(pastDate.resolutionStatus, "unresolved"); assert.equal(pastDate.ambiguity, "past_date"); cases += 1;
assert.deepEqual(inferExplicitTemporalExpression("7/18 包棟住兩晚還有嗎？"), { rawText: "7/18", kind: "absolute", anchor: "message_time" }); cases += 1;
const doubles = resolveEntity(alphaCatalog, { category: "room", rawText: "Double", canonicalCandidate: "a_double_1" });
assert.equal(doubles.status, "matched_set"); assert.deepEqual(doubles.entities.map((room) => room.canonicalId), ["a_double_1", "a_double_2"]); cases += 1;
const named = resolveEntity(alphaCatalog, { category: "room", rawText: "A4", canonicalCandidate: null }); assert.equal(named.entity.canonicalId, "a_quad"); cases += 1;
const house = resolveEntity(alphaCatalog, { category: "room", rawText: "House", canonicalCandidate: null }); assert.equal(house.entity.canonicalId, "a_house"); cases += 1;
const recent = run(alpha, alphaCatalog, [{ taskId: "recent", type: "available_dates", entity: { category: "other", rawText: "", canonicalCandidate: null } }], { ...request, stay: { ...request.stay, searchRange: { from: "2026-07-18", to: "2026-07-20" } } })[0]; assert.equal(recent.status, "answered"); assert.equal(recent.facts.availableDates[0], "2026-07-18"); cases += 1;
const multi = run(alpha, alphaCatalog, [{ taskId: "stay", type: "availability", entity: { category: "room", rawText: "Double", canonicalCandidate: null } }, { taskId: "parking", type: "amenity", entity: { category: "amenity", rawText: "parking", canonicalCandidate: "parking" } }, { taskId: "bbq", type: "policy", entity: { category: "policy", rawText: "bbq", canonicalCandidate: "bbq" } }, { taskId: "checkin", type: "policy", entity: { category: "policy", rawText: "checkin", canonicalCandidate: "check_in" } }, { taskId: "unknown", type: "amenity", entity: { category: "amenity", rawText: "unknown amenity", canonicalCandidate: null } }]);
assert.deepEqual(multi.map((item) => item.status), ["answered", "answered", "answered", "answered", "needs_human"]); const reply = composeControlledReply(buildApprovedPlan({ propertyId: alpha.propertyId, taskResults: multi })); for (const expected of ["A1", "A2", "Alpha parking.", "Alpha barbecue.", "Alpha check-in."]) assert.ok(reply.includes(expected)); assert.ok(reply.includes("unknown amenity")); cases += 1;
const betaResult = run(properties[1], buildPropertyCatalog(properties[1]), [{ taskId: "pool", type: "amenity", entity: { category: "amenity", rawText: "pool", canonicalCandidate: "pool" } }, { taskId: "parking", type: "amenity", entity: { category: "amenity", rawText: "parking", canonicalCandidate: "parking" } }], { ...request, stay: { ...request.stay, checkIn: "2026-07-18", checkOut: "2026-07-19" } }); assert.deepEqual(betaResult.map((item) => item.facts.answer), ["Beta pool.", "Beta parking."]); cases += 1;
const first = run(alpha, alphaCatalog, [{ taskId: "repeat", type: "availability", entity: { category: "other", rawText: "有房", canonicalCandidate: null } }])[0].facts.availableInventory.map((room) => room.canonicalId); for (let index = 0; index < 3; index += 1) assert.deepEqual(run(alpha, alphaCatalog, [{ taskId: `repeat-${index}`, type: "availability", entity: { category: "other", rawText: "有房", canonicalCandidate: null } }])[0].facts.availableInventory.map((room) => room.canonicalId), first); cases += 3;
console.log(JSON.stringify({ suite: "v2-semantic-core-matrix", caseCount: cases, passCount: cases, failCount: 0 }));
