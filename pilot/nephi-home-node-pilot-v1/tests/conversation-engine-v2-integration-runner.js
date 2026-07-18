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
const availabilityResolver = ({ customerId, checkIn, checkOut, guests, roomType, queryMode }) => ({ customerId, checkIn, checkOut, guests, roomType, queryMode, availabilityReliable: true, rooms: property.rooms.filter((room) => room.id === roomType || roomType === "all"), lineUrl: "" });
const planner = { classify: async () => ({
  schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 },
  stateOperations: [
    { field: "stay.checkInCandidate", operation: "set", value: "2026-08-06", sourceText: "8/6" },
    { field: "stay.nightsCandidate", operation: "set", value: 1, sourceText: "一晚" },
    { field: "stay.guestCountCandidate", operation: "set", value: 2, sourceText: "兩位" },
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
const engine = new ConversationEngineV2({ planner, persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [] });

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
  const guardedEngine = new ConversationEngineV2({ planner, composer: incompleteComposer, persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [], onDiagnostic: (item) => diagnostics.push(item) });
  const guarded = await guardedEngine.process({ customerId: "p1", channelId: "c1", lineUserId: "u2", eventId: "e2", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6雙人房有空嗎 有車位嗎 有麻將嗎" });
  assert.ok(guarded.replyText.includes("湖景雙人房"));
  assert.ok(guarded.replyText.includes("停車位"));
  assert.ok(guarded.replyText.includes("麻將"));
  assert.deepEqual(guarded.claimValidation.coveredTaskIds.sort(), ["a", "b", "c"]);
  assert.deepEqual(diagnostics.map((item) => item.stage), ["planner", "validation", "temporal", "state", "entity_resolution", "executor", "response_plan", "composer", "claim_validator", "line_ready"]);
  assert.equal(new Set(diagnostics.map((item) => item.traceId)).size, 1);

  const unknownPlanner = { classify: async () => ({
    schemaVersion: 2, discourse: { relation: "new_topic", confidence: 0.99 }, stateOperations: [{ field: "*", operation: "clear", value: null, sourceText: "你不開心是嗎？" }],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{ taskId: "unknown", type: "unknown", sourceText: "你不開心是嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "other", rawText: "你不開心", canonicalCandidate: null, confidence: 0.9 }, confidence: 0.9 }],
    ambiguities: [], missingInformation: [], needsHuman: true, shouldIgnore: false, reason: "unknown"
  }) };
  for (const [index, unsafeText] of [":-(", ".", ".\"", ".NET開發者需要人工協助。"].entries()) {
    const unsafeDiagnostics = [];
    const unsafeComposer = { compose: async () => ({ sections: [{ taskId: "unknown", responseMode: "handoff", text: unsafeText }] }) };
    const unsafeEngine = new ConversationEngineV2({ planner: unknownPlanner, composer: unsafeComposer, persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [], onDiagnostic: (item) => unsafeDiagnostics.push(item) });
    const unsafe = await unsafeEngine.process({ customerId: "p1", channelId: "c1", lineUserId: `unsafe-${index}`, eventId: `unsafe-${index}`, eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "你不開心是嗎？" });
    assert.equal(unsafe.replyText, "這部分需要請業者確認。");
    assert.equal(unsafe.replyText.includes(unsafeText), false);
    const composerTrace = unsafeDiagnostics.find((item) => item.stage === "composer");
    assert.equal(composerTrace.composerSource, "deterministic");
    assert.equal(composerTrace.fallbackOccurred, true);
    assert.ok(composerTrace.rejectionReasonCodes.includes("handoff_deterministic_boundary"));
  }
  const groundedPlanner = { classify: async () => ({
    schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{ taskId: "parking", type: "amenity", sourceText: "有車位嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 }, confidence: 0.99 }],
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "known_fact"
  }) };
  const groundedDiagnostics = [];
  const groundedEngine = new ConversationEngineV2({ planner: groundedPlanner, composer: { compose: async () => ({ sections: [{ taskId: "parking", responseMode: "answer", text: "有一個停車位" }] }) }, persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [], onDiagnostic: (item) => groundedDiagnostics.push(item) });
  const groundedReply = await groundedEngine.process({ customerId: "p1", channelId: "c1", lineUserId: "grounded", eventId: "grounded", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "有車位嗎？" });
  assert.equal(groundedReply.replyText, "有一個停車位");
  assert.equal(groundedDiagnostics.find((item) => item.stage === "composer").composerSource, "openai");
  assert.equal(groundedDiagnostics.find((item) => item.stage === "composer").fallbackOccurred, false);
  const multiRoomProperty = { ...property, rooms: [
    { id: "r1", name: "A 雙人房", type: "雙人房", capacity: 2, enabled: true },
    { id: "r2", name: "B 雙人房", type: "雙人房", capacity: 2, enabled: true },
    { id: "r3", name: "C 四人房", type: "四人房", capacity: 4, enabled: true }
  ], commonAnswers: { parkingRule: "有停車位", bbqRule: "可依規則烤肉" }, semanticCatalog: { aliases: { parking: ["車位"], bbq: ["烤肉"] }, amenities: [] } };
  const multiTaskPlanner = { classify: async () => ({
    schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations: [],
    stay: { dateExpression: { rawText: "8/6", kind: "absolute", anchor: "message_time" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null },
    tasks: [
      { taskId: "availability", type: "availability", sourceText: "8/6 有雙人房嗎？", requestedOutputs: ["room_options", "availability"], dependsOnStayContext: true, entity: { category: "room", rawText: "雙人房", canonicalCandidate: null, confidence: 0.95 }, confidence: 0.95 },
      { taskId: "parking", type: "amenity", sourceText: "有車位嗎？", requestedOutputs: ["availability", "policy"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 }, confidence: 0.99 },
      { taskId: "bbq", type: "policy", sourceText: "可以烤肉嗎？", requestedOutputs: ["policy"], dependsOnStayContext: false, entity: { category: "policy", rawText: "烤肉", canonicalCandidate: "bbq", confidence: 0.99 }, confidence: 0.99 }
    ], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "multi_task"
  }) };
  const multiTaskEngine = new ConversationEngineV2({ planner: multiTaskPlanner, persistence, getProperty: () => multiRoomProperty,
    availabilityResolver: (query) => ({ ...query, availabilityReliable: true, rooms: multiRoomProperty.rooms.filter((room) => room.id !== "r3"), lineUrl: "" }), listPriceOverrides: () => [], now: () => new Date("2026-07-17T02:00:00.000Z") });
  const multiTask = await multiTaskEngine.process({ customerId: "p1", channelId: "c1", lineUserId: "multi", eventId: "multi-1", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？" });
  const availabilityResult = multiTask.taskResults.find((item) => item.taskId === "availability");
  assert.equal(availabilityResult.status, "answered");
  assert.deepEqual(availabilityResult.facts.availableInventory.map((item) => item.canonicalId), ["r1", "r2"]);
  assert.ok(multiTask.replyText.includes("A 雙人房"));
  assert.ok(multiTask.replyText.includes("B 雙人房"));
  assert.ok(!multiTask.replyText.includes("哪一個"));
  assert.deepEqual(multiTask.claimValidation.missingTaskIds, []);

  function temporalPlanner({ message, operations = [], tasks, nightsCandidate = null, guestCountCandidate = null }) {
    return { classify: async () => ({
      schemaVersion: 2,
      discourse: { relation: "new_request", confidence: 0.99 },
      stateOperations: operations,
      stay: {
        dateExpression: { rawText: "", kind: "none", anchor: "none" },
        checkInCandidate: null,
        checkOutCandidate: null,
        nightsCandidate,
        guestCountCandidate
      },
      tasks: tasks || [{
        taskId: "availability",
        type: "availability",
        sourceText: message,
        requestedOutputs: ["availability"],
        dependsOnStayContext: true,
        entity: { category: "room", rawText: "雙人房", canonicalCandidate: "r1", confidence: 0.98 },
        confidence: 0.98
      }],
      ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "temporal_flow"
    }) };
  }
  const dateOperations = (rawText, kind = "absolute", { checkInCandidate = null, nightsCandidate = null, guestCountCandidate = null } = {}) => [
    { field: "stay.dateExpression.rawText", operation: "set", value: rawText, sourceText: rawText },
    { field: "stay.dateExpression.kind", operation: "set", value: kind, sourceText: rawText },
    { field: "stay.dateExpression.anchor", operation: "set", value: "message_time", sourceText: rawText },
    ...(checkInCandidate ? [{ field: "stay.checkInCandidate", operation: "set", value: checkInCandidate, sourceText: rawText }] : []),
    ...(nightsCandidate ? [{ field: "stay.nightsCandidate", operation: "set", value: nightsCandidate, sourceText: rawText }] : []),
    ...(guestCountCandidate ? [{ field: "stay.guestCountCandidate", operation: "set", value: guestCountCandidate, sourceText: rawText }] : [])
  ];
  const temporalProperty = { ...property, commonAnswers: { parkingRule: "有停車位。", bbqRule: "可依規則烤肉。" }, semanticCatalog: { aliases: { r1: ["雙人房"], parking: ["車位"], bbq: ["烤肉"] }, amenities: [] } };
  const temporalAvailabilityResolver = (query) => ({ ...query, availabilityReliable: true, rooms: temporalProperty.rooms.filter((room) => query.roomType === "all" || room.id === query.roomType), lineUrl: "" });
  async function runTemporal(message, plannerOutput, userId, eventTimestamp = Date.parse("2026-07-17T10:00:00+08:00")) {
    const temporalEngine = new ConversationEngineV2({ planner: plannerOutput, persistence, getProperty: () => temporalProperty, availabilityResolver: temporalAvailabilityResolver, listPriceOverrides: () => [], now: () => new Date(eventTimestamp) });
    return temporalEngine.process({ customerId: "p1", channelId: "c1", lineUserId: userId, eventId: `event-${userId}`, eventTimestamp, messageText: message });
  }

  const singleDate = await runTemporal("8/6 有雙人房嗎？", temporalPlanner({ message: "8/6 有雙人房嗎？", operations: dateOperations("8/6", "absolute", { checkInCandidate: "2026-08-06" }) }), "date-single");
  assert.equal(singleDate.state.conditions.stay.checkIn, "2026-08-06");
  assert.equal(singleDate.state.conditions.stay.checkOut, "2026-08-07");
  assert.equal(singleDate.state.conditions.stay.nights, 1);
  assert.equal(singleDate.taskResults[0].status, "answered");

  const multiDateTasks = [
    { taskId: "availability", type: "availability", sourceText: "8/6 有雙人房嗎？", requestedOutputs: ["availability"], dependsOnStayContext: true, entity: { category: "room", rawText: "雙人房", canonicalCandidate: "r1", confidence: 0.98 }, confidence: 0.98 },
    { taskId: "parking", type: "amenity", sourceText: "有車位嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.98 }, confidence: 0.98 },
    { taskId: "bbq", type: "policy", sourceText: "可以烤肉嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "policy", rawText: "烤肉", canonicalCandidate: "bbq", confidence: 0.98 }, confidence: 0.98 }
  ];
  const multiDate = await runTemporal("8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？", temporalPlanner({ message: "8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？", operations: dateOperations("8/6"), tasks: multiDateTasks }), "date-multi");
  assert.deepEqual(multiDate.taskResults.map((item) => item.status), ["answered", "answered", "answered"]);
  assert.deepEqual(multiDate.claimValidation.missingTaskIds, []);

  const oneNight = await runTemporal("8月6號兩個人住一晚還有嗎？", temporalPlanner({ message: "8月6號兩個人住一晚還有嗎？", operations: dateOperations("8月6號", "absolute", { checkInCandidate: "2026-08-06", nightsCandidate: 1, guestCountCandidate: 2 }) }), "date-guests");
  assert.deepEqual(oneNight.state.conditions.stay, { checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, guests: 2, searchRange: null });

  const twoNights = await runTemporal("8/6 住兩晚", temporalPlanner({ message: "8/6 住兩晚", operations: dateOperations("8/6", "absolute", { checkInCandidate: "2026-08-06", nightsCandidate: 2 }) }), "date-two-nights");
  assert.equal(twoNights.state.conditions.stay.checkOut, "2026-08-08");
  assert.equal(twoNights.state.conditions.stay.nights, 2);

  const missingDate = await runTemporal("有雙人房嗎？", temporalPlanner({ message: "有雙人房嗎？" }), "date-missing");
  assert.equal(missingDate.taskResults[0].status, "needs_clarification");
  assert.ok(missingDate.taskResults[0].missingInputs.includes("stay.checkIn"));

  const crossYearTimestamp = Date.parse("2026-12-20T10:00:00+08:00");
  const crossYear = await runTemporal("1/5 有雙人房嗎？", temporalPlanner({ message: "1/5 有雙人房嗎？", operations: dateOperations("1/5") }), "date-cross-year", crossYearTimestamp);
  assert.equal(crossYear.state.conditions.stay.checkIn, "2027-01-05");
  assert.equal(crossYear.state.conditions.stay.checkOut, "2027-01-06");

  const repeatedAvailabilityCalls = [];
  const repeatEventTime = Date.parse("2026-07-17T10:00:00+08:00");
  const wrongCandidatePlanner = temporalPlanner({
    message: "7/18 的301可以預訂嗎？",
    operations: dateOperations("7/18", "absolute", { checkInCandidate: "2056-07-18" }),
    tasks: [{
      taskId: "availability-301",
      type: "availability",
      sourceText: "7/18 的301可以預訂嗎？",
      requestedOutputs: ["availability"],
      dependsOnStayContext: true,
      entity: { category: "room", rawText: "301", canonicalCandidate: "r1", confidence: 0.99 },
      confidence: 0.99
    }]
  });
  const repeatedEngine = new ConversationEngineV2({
    planner: wrongCandidatePlanner,
    persistence,
    getProperty: () => temporalProperty,
    availabilityResolver: (query) => { repeatedAvailabilityCalls.push({ propertyId: query.customerId, from: query.checkIn, to: query.checkOut }); return { ...query, availabilityReliable: true, rooms: temporalProperty.rooms.filter((room) => room.id === query.roomType), lineUrl: "" }; },
    listPriceOverrides: () => [],
    now: () => new Date(repeatEventTime)
  });
  for (let index = 0; index < 3; index += 1) {
    const repeated = await repeatedEngine.process({
      customerId: "p1",
      channelId: "c1",
      lineUserId: "date-repeat",
      eventId: `date-repeat-${index}`,
      eventTimestamp: repeatEventTime,
      messageText: "7/18 的301可以預訂嗎？"
    });
    assert.equal(repeated.state.conditions.stay.checkIn, "2026-07-18");
    assert.equal(repeated.state.conditions.stay.checkOut, "2026-07-19");
    assert.equal(repeated.taskResults[0].status, "answered");
    assert.equal(repeated.taskResults[0].facts.availableInventory[0].canonicalId, "r1");
  }
  assert.deepEqual(repeatedAvailabilityCalls, Array.from({ length: 3 }, () => ({ propertyId: "p1", from: "2026-07-18", to: "2026-07-19" })));
  console.log("conversation engine v2 integration: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
