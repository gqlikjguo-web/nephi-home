"use strict";

const assert = require("node:assert/strict");
const { createMvpService } = require("../lib/mvp-service");
const { normalizePlannerOutput } = require("../lib/conversation-engine-v2/engine");
const { availabilityRequest } = require("../lib/conversation-engine-v2/resolver-adapter");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { resolveEntity } = require("../lib/conversation-engine-v2/entity-resolver");
const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { executeTasks } = require("../lib/conversation-engine-v2/capability-executor");

const property = {
  propertyId: "regression_lodge",
  displayName: "Regression Lodge",
  timezone: "Asia/Taipei",
  rooms: [
    { id: "room_301", name: "301", type: "雙人房", capacity: 2, enabled: true },
    { id: "room_302", name: "302", type: "四人房", capacity: 4, enabled: true },
    { id: "room_401", name: "401", type: "雙人房", capacity: 2, enabled: true },
    { id: "room_402", name: "402", type: "四人房", capacity: 4, enabled: true }
  ],
  commonAnswers: { parkingRule: "Parking is available.", bbqRule: "Barbecue is available." }
};
const rows = {
  "2026-07-18": { date: "2026-07-18", room_301: "available", room_302: "available", room_401: "available", room_402: "closed" },
  "2026-08-06": { date: "2026-08-06", room_301: "available", room_302: "closed", room_401: "available", room_402: "available" }
};
const providers = {
  customerSettings: { getProperty: (id) => id === property.propertyId ? property : null, listProperties: () => [property] },
  availability: { getRows: (_id, from, to) => Object.values(rows).filter((row) => row.date >= from && row.date < to) },
  persistence: {}
};
const service = createMvpService(providers);

const plannerOutput = {
  stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" } },
  tasks: [{ taskId: "recent", type: "availability", sourceText: "最近哪一天有空房", entity: { category: "room", rawText: "空房", canonicalCandidate: null } }]
};
const normalizedRecent = normalizePlannerOutput(plannerOutput, {
  messageText: "最近哪一天有空房",
  eventTimestamp: Date.parse("2026-07-18T10:00:00+08:00"),
  timezone: property.timezone,
  previousConditions: { stay: { nights: null, searchRange: null } }
});
assert.equal(normalizedRecent.tasks[0].type, "available_dates");
assert.equal(normalizedRecent.tasks[0].entity.rawText, "");
assert.deepEqual(normalizedRecent.searchRange, { from: "2026-07-18", to: "2026-08-18" });

const catalog = buildPropertyCatalog(property);
const matched = resolveEntity(catalog, { category: "room", rawText: "雙人房", canonicalCandidate: "room_301" });
assert.equal(matched.status, "matched_set");
assert.deepEqual(
  availabilityRequest(property.propertyId, { stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", guests: 2 }, inventory: { mode: "room_only" } }, matched),
  { customerId: property.propertyId, checkIn: "2026-08-06", checkOut: "2026-08-07", guests: 2, roomType: "all", roomTypeSet: ["room_301", "room_401"], queryMode: "room_only" }
);

assert.deepEqual(
  service.searchAvailability({ customerId: property.propertyId, checkIn: "2026-07-18", checkOut: "2026-07-19", guests: null, roomType: "all", queryMode: "room_only" }).rooms.map((room) => room.id),
  ["room_301", "room_302", "room_401"]
);
assert.deepEqual(
  service.searchAvailability({ customerId: property.propertyId, checkIn: "2026-08-06", checkOut: "2026-08-07", guests: 2, roomType: "all", roomTypeSet: ["room_301", "room_401"], queryMode: "room_only" }).rooms.map((room) => room.id),
  ["room_301", "room_401"]
);

const matchedFour = resolveEntity(catalog, { category: "room", rawText: "四人房", canonicalCandidate: "room_302" });
assert.equal(matchedFour.status, "matched_set");
assert.deepEqual(matchedFour.entities.map((room) => room.canonicalId), ["room_302", "room_402"]);
assert.deepEqual(
  availabilityRequest(property.propertyId, { stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", guests: 4 }, inventory: { mode: "room_only" } }, matchedFour),
  { customerId: property.propertyId, checkIn: "2026-08-06", checkOut: "2026-08-07", guests: 4, roomType: "all", roomTypeSet: ["room_302", "room_402"], queryMode: "room_only" }
);
assert.deepEqual(
  service.searchAvailability({ customerId: property.propertyId, checkIn: "2026-08-06", checkOut: "2026-08-07", guests: 4, roomType: "all", roomTypeSet: ["room_302", "room_402"], queryMode: "room_only" }).rooms.map((room) => room.id),
  ["room_402"]
);

const reply = composeControlledReply(buildResponsePlan({ propertyId: property.propertyId, taskResults: [{ taskId: "double", type: "availability", status: "answered", facts: { checkIn: "2026-08-06", availableInventory: [{ publicName: "301" }, { publicName: "401" }] } }] }));
assert.ok(reply.includes("301"));
assert.ok(reply.includes("401"));
assert.equal(reply.includes("402"), false);

const multiTaskResults = executeTasks({
  property,
  catalog,
  request: { stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", guests: 2 }, inventory: { mode: "room_only" } },
  availabilityResolver: (query) => service.searchAvailability(query),
  availableDatesResolver: (query) => service.searchAvailableDates(query),
  tasks: [
    { taskId: "availability", type: "availability", entity: { category: "room", rawText: "雙人房", canonicalCandidate: null } },
    { taskId: "parking", type: "amenity", entity: { category: "amenity", rawText: "parking", canonicalCandidate: "parking" } },
    { taskId: "bbq", type: "policy", entity: { category: "policy", rawText: "bbq", canonicalCandidate: "bbq" } }
  ]
});
assert.deepEqual(multiTaskResults[0].facts.availableInventory.map((room) => room.canonicalId), ["room_301", "room_401"]);
assert.equal(multiTaskResults[1].status, "answered");
assert.equal(multiTaskResults[2].status, "answered");
const multiReply = composeControlledReply(buildResponsePlan({ propertyId: property.propertyId, taskResults: multiTaskResults }));
assert.ok(multiReply.includes("301"));
assert.ok(multiReply.includes("401"));
assert.ok(multiReply.includes("Parking is available."));
assert.ok(multiReply.includes("Barbecue is available."));
assert.equal(multiReply.includes("402"), false);

console.log("v2 live availability regressions: PASS");
