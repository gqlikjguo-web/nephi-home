"use strict";
const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { formatSafeTestOnlyConversationTrace } = require("../server");

const states = new Map(), logs = [];
const persistence = {
  getConversationState: (p, c, u) => states.get(`${p}:${c}:${u}`) || null,
  setConversationState: (p, c, u, value) => states.set(`${p}:${c}:${u}`, value),
  appendMessageLog: (p, value) => { const item = { ...value, customerId: p, reviewId: value.needsReview ? `review-${logs.length + 1}` : "" }; logs.push(item); return item; }
};

function explicitPlanner(basePlanner) {
  return {
    classify: async (input) => {
      const output = await basePlanner.classify(input);
      const source = input.sourceEvents[0];
      const tasks = output.tasks.map((task, candidateIndex) => ({ ...task, candidateIndex }));
      return {
        ...output,
        tasks,
        contextRelationCandidates: tasks.map((task) => ({ candidateIndex: task.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: source.eventId, startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }] }))
      };
    }
  };
}
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
    { taskId: "a", type: "availability", sourceText: "8/6雙人房有空嗎", requestedOutputs: ["availability"], dependsOnStayContext: true, entity: { category: "room", rawText: "雙人房", canonicalCandidate: "r1", confidence: 0.99 }, stayCandidate: { dateExpression: { rawText: "8/6", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-06", checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: 2 }, confidence: 0.99 },
    { taskId: "b", type: "amenity", sourceText: "有車位嗎", requestedOutputs: ["amenity"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 }, stayCandidate: null, confidence: 0.99 },
    { taskId: "c", type: "amenity", sourceText: "有麻將嗎", requestedOutputs: ["amenity"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "麻將", canonicalCandidate: "mahjong", confidence: 0.7 }, stayCandidate: null, confidence: 0.7 }
  ], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "multi_task"
}) };
const engine = new ConversationEngineV2({ planner: explicitPlanner(planner), persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [] });
function latestConditions(result) { return result.state.requestCycles.at(-1).confirmedInputs; }

(async () => {
  const pricingCalls = [];
  let pricingAvailableDatesCalls = 0;
  const pricingPlanner = { classify: async () => ({
    schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations: [],
    stay: { dateExpression: { rawText: "8/6", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-06", checkOutCandidate: "2026-08-08", nightsCandidate: 2, guestCountCandidate: 2 },
    tasks: [{
      taskId: "active-engine-price", type: "price", sourceText: "price request", detailIntent: "general", requestedOutputs: ["price"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true,
      entity: { category: "room", rawText: "Price room", canonicalCandidate: "r1", confidence: 0.99 },
      stayCandidate: { dateExpression: { rawText: "8/6", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-06", checkOutCandidate: "2026-08-08", nightsCandidate: 2, guestCountCandidate: 2 }, confidence: 0.99
    }], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "active_engine_pricing"
  }) };
  const pricingEngine = new ConversationEngineV2({
    planner: explicitPlanner(pricingPlanner), persistence, getProperty: () => property,
    availabilityResolver: (query) => { pricingCalls.push(query); return { ...query, availabilityReliable: true, rooms: property.rooms, lineUrl: "" }; },
    availableDatesResolver: () => { pricingAvailableDatesCalls += 1; return { status: "answered", dates: [] }; },
    listPriceOverrides: () => [{ roomId: "r1", date: "2026-08-07", price: 2500 }], now: () => new Date("2026-07-17T02:00:00.000Z")
  });
  const pricingResult = await pricingEngine.process({ customerId: "p1", channelId: "pricing", lineUserId: "pricing-user", eventId: "pricing-event", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "price request" });
  assert.equal(pricingResult.taskResults[0].status, "answered", "active Engine pricing runtime must execute QueryPlan pricing");
  assert.equal(pricingCalls.length, 1, "active Engine pricing runtime must execute QueryPlan pricing through availability Resolver once");
  assert.equal(pricingAvailableDatesCalls, 0, "active Engine pricing runtime must not call available-dates Resolver for price");
  assert.deepEqual(pricingCalls[0], { customerId: "p1", checkIn: "2026-08-06", checkOut: "2026-08-08", guests: 2, roomType: "r1", queryMode: "room_only" });
  assert.equal(pricingCalls[0].customerId, "p1", "availability Resolver property scope must equal the FormalRequest propertyId");
  const activeEnginePrices = pricingResult.taskResults[0].facts.prices;
  assert.ok(Array.isArray(activeEnginePrices) && activeEnginePrices.length === 1, "active Engine pricing runtime must return QueryPlan pricing facts");
  assert.equal(activeEnginePrices[0].inventory.canonicalId, "r1");
  assert.deepEqual(activeEnginePrices[0].daily, [
    { date: "2026-08-06", price: 2000, source: "room_pricing" },
    { date: "2026-08-07", price: 2500, source: "price_override" }
  ]);
  assert.equal(activeEnginePrices[0].total, 4500);
  assert.equal(activeEnginePrices[0].currency, "TWD");
  assert.equal(pricingResult.taskResults[0].facts.propertyId, "p1");
  assert.equal(pricingResult.taskResults[0].facts.checkIn, "2026-08-06");
  assert.equal(pricingResult.taskResults[0].facts.checkOut, "2026-08-08");

  const rejectedPricingEngine = new ConversationEngineV2({
    planner: explicitPlanner(pricingPlanner), composer: { compose: async () => ({ replyText: "unverified", factTaskIds: [] }) }, persistence, getProperty: () => property,
    availabilityResolver: (query) => ({ ...query, availabilityReliable: true, rooms: property.rooms, lineUrl: "" }),
    availableDatesResolver: () => ({ status: "answered", dates: [] }), listPriceOverrides: () => [], now: () => new Date("2026-07-17T02:00:00.000Z")
  });
  const rejectedPricing = await rejectedPricingEngine.process({ customerId: "p1", channelId: "pricing-rejected", lineUserId: "pricing-rejected-user", eventId: "pricing-rejected-event", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "price request" });
  assert.equal(rejectedPricing.finalDecision.action, "handoff", "claim validator rejection must be recorded by FinalDecision even after the safe fallback reply is validated");
  assert.equal(rejectedPricing.finalDecision.reasonCode, "claim_validation_failed");
  assert.equal(rejectedPricing.finalDecision.reviewRequired, true);
  assert.equal(rejectedPricing.replyText.includes("unverified"), false, "claim-validator-rejected text must not reach the reply");

  const result = await engine.process({ customerId: "p1", channelId: "c1", lineUserId: "u1", eventId: "e1", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6雙人房有空嗎 有車位嗎 有麻將嗎" });
  assert.equal(result.shouldReply, true);
  assert.ok(result.replyText.includes("湖景雙人房"));
  assert.ok(result.replyText.includes("停車位"));
  assert.ok(result.replyText.includes("麻將"));
  assert.equal(result.taskResults.length, 3);
  assert.equal(result.reviewCount, 1);
  assert.equal(logs.filter((x) => x.needsReview && String(x.eventId).startsWith("e1:review:")).length, 1);
  assert.equal(logs.find((x) => x.eventId === "e1").needsReview, true, "handoff FinalDecision must mark its primary message record for review");
  assert.equal(states.get("p1:c1:u1").schemaVersion, 2);
  assert.equal(result.claimValidation.ok, true);

  const incompleteComposer = { compose: async () => ({ replyText: "8/6 有湖景雙人房。", factTaskIds: ["a"] }) };
  const diagnostics = [];
  const guardedEngine = new ConversationEngineV2({ planner: explicitPlanner(planner), composer: incompleteComposer, persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [], onDiagnostic: (item) => diagnostics.push(item) });
  const guarded = await guardedEngine.process({ customerId: "p1", channelId: "c1", lineUserId: "u2", eventId: "e2", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6雙人房有空嗎 有車位嗎 有麻將嗎" });
  assert.ok(guarded.replyText.includes("湖景雙人房"));
  assert.ok(guarded.replyText.includes("停車位"));
  assert.ok(guarded.replyText.includes("麻將"));
  assert.deepEqual(guarded.claimValidation.coveredTaskIds.sort(), ["a", "b", "c"]);
  assert.deepEqual(diagnostics.map((item) => item.stage), ["property_catalog", "planner", "validation", "semantic_contract", "context_validation", "pending_request", "no_reply_gate", "temporal", "state", "entity_resolution", "formal_request", "query_plan", "pending_request", "executor", "response_plan", "composer", "claim_validator", "line_ready", "final_decision"]);
  assert.equal(new Set(diagnostics.map((item) => item.traceId)).size, 1);
  assert.equal(guarded.replyText, result.replyText);
  const safeDiagnostics = diagnostics.map(formatSafeTestOnlyConversationTrace).filter(Boolean);
  const safePlanner = safeDiagnostics.find((item) => item.stage === "planner");
  assert.equal(safePlanner.parserSucceeded, true);
  assert.deepEqual(safePlanner.tasks.map(({ taskId, type, category, canonicalCandidate, detailIntent }) => ({ taskId, type, category, canonicalCandidate, detailIntent })), [
    { taskId: "a", type: "availability", category: "room", canonicalCandidate: "r1", detailIntent: "" },
    { taskId: "b", type: "amenity", category: "amenity", canonicalCandidate: "parking", detailIntent: "" },
    { taskId: "c", type: "amenity", category: "amenity", canonicalCandidate: "mahjong", detailIntent: "" }
  ]);
  const safeValidation = safeDiagnostics.find((item) => item.stage === "validation");
  const normalizedTasks = safePlanner.tasks.map((task) => ({ ...task, detailIntent: "general" }));
  assert.deepEqual(safeValidation.acceptedTasks, normalizedTasks);
  assert.deepEqual(safeValidation.rejectedTasks, []);
  assert.deepEqual(safeValidation.rejectionReasons, []);
  assert.deepEqual(safeValidation.finalTasks, normalizedTasks);
  const safeContextValidation = safeDiagnostics.find((item) => item.stage === "context_validation");
  assert.deepEqual(safeContextValidation.rejectionReasons, []);
  assert.deepEqual(safeContextValidation.candidates, [
    { candidateIndex: 0, relationKind: "new_request", candidateRequestCycleRefCount: 0, evidenceRefCount: 1, evidenceSourceMatches: [true] },
    { candidateIndex: 1, relationKind: "new_request", candidateRequestCycleRefCount: 0, evidenceRefCount: 1, evidenceSourceMatches: [true] },
    { candidateIndex: 2, relationKind: "new_request", candidateRequestCycleRefCount: 0, evidenceRefCount: 1, evidenceSourceMatches: [true] }
  ]);
  const rejectedTrace = formatSafeTestOnlyConversationTrace({
    traceId: "rejected-trace", propertyId: "p1", stage: "validation", acceptedTasks: [],
    rejectedTasks: [{ ...normalizedTasks[0], reasons: ["tasks.0"] }], rejectionReasons: ["tasks.0"], finalTasks: []
  });
  assert.deepEqual(rejectedTrace.rejectedTasks[0].reasons, ["tasks.0"]);
  assert.deepEqual(rejectedTrace.finalTasks, []);
  const hostileContextTrace = formatSafeTestOnlyConversationTrace({
    traceId: "hostile-context-trace",
    propertyId: "p1",
    stage: "context_validation",
    rejectionReasons: ["contextRelationCandidates.0", "PRIVATE GUEST MESSAGE"],
    candidates: [{
      candidateIndex: 0,
      relationKind: "modify_existing",
      candidateRequestCycleRefCount: 2,
      evidenceRefCount: 2,
      evidenceSourceMatches: [true, false],
      quote: "PRIVATE EVIDENCE QUOTE",
      eventId: "PRIVATE EVENT ID",
      messageRef: "PRIVATE MESSAGE REF"
    }],
    messageText: "PRIVATE GUEST MESSAGE",
    propertyData: { rooms: "PRIVATE PROPERTY DATA" },
    apiKey: "PRIVATE API KEY",
    accessToken: "PRIVATE LINE TOKEN"
  });
  assert.deepEqual(hostileContextTrace.rejectionReasons, ["contextRelationCandidates.0"]);
  assert.deepEqual(hostileContextTrace.candidates, [{
    candidateIndex: 0,
    relationKind: "modify_existing",
    candidateRequestCycleRefCount: 2,
    evidenceRefCount: 2,
    evidenceSourceMatches: [true, false]
  }]);
  const hostileTrace = formatSafeTestOnlyConversationTrace({
    traceId: "safe-trace", propertyId: "p1", stage: "planner", parserSucceeded: true, taskCount: 0, tasks: [],
    messageText: "PRIVATE GUEST MESSAGE", eventId: "PRIVATE EVENT ID", lineUserId: "PRIVATE USER ID",
    apiKey: "PRIVATE API KEY", accessToken: "PRIVATE LINE TOKEN", signature: "PRIVATE SIGNATURE",
    googleMapsUrl: "https://maps.example.invalid/private"
  });
  const safeSerialized = JSON.stringify([...safeDiagnostics, rejectedTrace, hostileContextTrace, hostileTrace]);
  for (const forbidden of ["PRIVATE EVIDENCE QUOTE", "PRIVATE GUEST MESSAGE", "PRIVATE EVENT ID", "PRIVATE MESSAGE REF", "PRIVATE PROPERTY DATA", "PRIVATE USER ID", "PRIVATE API KEY", "PRIVATE LINE TOKEN", "PRIVATE SIGNATURE", "maps.example.invalid"]) {
    assert.equal(safeSerialized.includes(forbidden), false, `safe trace leaked ${forbidden}`);
  }

  const rejectedContextDiagnostics = [];
  const rejectedContextPlanner = {
    classify: async (input) => {
      const output = await explicitPlanner(planner).classify(input);
      output.contextRelationCandidates[0].evidenceRefs[0].eventId = "PRIVATE REJECTED EVENT ID";
      return output;
    }
  };
  const rejectedContextEngine = new ConversationEngineV2({
    planner: rejectedContextPlanner,
    persistence,
    getProperty: () => property,
    availabilityResolver,
    listPriceOverrides: () => [],
    onDiagnostic: (item) => rejectedContextDiagnostics.push(item)
  });
  const rejectedContextResult = await rejectedContextEngine.process({
    customerId: "p1",
    channelId: "rejected-context",
    lineUserId: "rejected-context-user",
    eventId: "rejected-context-event",
    eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"),
    messageText: "rejected context"
  });
  const rejectedContextSafeTrace = rejectedContextDiagnostics.map(formatSafeTestOnlyConversationTrace).find((item) => item && item.stage === "context_validation");
  assert.deepEqual(rejectedContextSafeTrace.rejectionReasons, ["contextRelationCandidates.0", "tasks.0.contextRelationCandidate"]);
  assert.deepEqual(rejectedContextSafeTrace.candidates[0], {
    candidateIndex: 0,
    relationKind: "new_request",
    candidateRequestCycleRefCount: 0,
    evidenceRefCount: 1,
    evidenceSourceMatches: [false]
  });
  assert.equal(JSON.stringify(rejectedContextSafeTrace).includes("PRIVATE REJECTED EVENT ID"), false);
  assert.equal(rejectedContextResult.finalDecision.action, "handoff");
  assert.equal(rejectedContextResult.finalDecision.reasonCode, "context_relation_invalid");

  const detailedDiagnostics = [];
  const detailedEngine = new ConversationEngineV2({ planner: explicitPlanner(planner), persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [], diagnosticDetail: true, onDiagnostic: (item) => detailedDiagnostics.push(item) });
  await detailedEngine.process({ customerId: "p1", channelId: "c1", lineUserId: "trace-user", eventId: "trace-event", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？" });
  assert.ok(detailedDiagnostics.some((item) => item.stage === "state_before" && item.userKeyHash && item.userKeyHash !== "trace-user"));
  assert.ok(detailedDiagnostics.some((item) => item.stage === "planner" && Array.isArray(item.tasks) && item.tasks[0].entity));
  assert.ok(detailedDiagnostics.some((item) => item.stage === "executor" && Array.isArray(item.results) && Array.isArray(item.resolverCalls)));
  const composerDiagnostic = detailedDiagnostics.find((item) => item.stage === "composer");
  assert.ok(composerDiagnostic.composerInput && typeof composerDiagnostic.finalOutput === "string");
  assert.equal(JSON.stringify(detailedDiagnostics).includes("trace-user"), false);

  const unknownPlanner = { classify: async () => ({
    schemaVersion: 2, discourse: { relation: "new_topic", confidence: 0.99 }, stateOperations: [{ field: "*", operation: "clear", value: null, sourceText: "你不開心是嗎？" }],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{ taskId: "unknown", type: "unknown", sourceText: "你不開心是嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "other", rawText: "你不開心", canonicalCandidate: null, confidence: 0.9 }, confidence: 0.9 }],
    ambiguities: [], missingInformation: [], needsHuman: true, shouldIgnore: false, reason: "unknown"
  }) };
  for (const [index, unsafeText] of [":-(", ".", ".\"", ".NET開發者需要人工協助。"].entries()) {
    const unsafeDiagnostics = [];
    const unsafeComposer = { compose: async () => ({ sections: [{ taskId: "unknown", responseMode: "handoff", text: unsafeText }] }) };
    const unsafeEngine = new ConversationEngineV2({ planner: explicitPlanner(unknownPlanner), composer: unsafeComposer, persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [], onDiagnostic: (item) => unsafeDiagnostics.push(item) });
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
  const groundedEngine = new ConversationEngineV2({ planner: explicitPlanner(groundedPlanner), composer: { compose: async () => ({ sections: [{ taskId: "parking", responseMode: "answer", text: "有一個停車位" }] }) }, persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [], onDiagnostic: (item) => groundedDiagnostics.push(item) });
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
      { taskId: "availability", type: "availability", sourceText: "8/6 有雙人房嗎？", requestedOutputs: ["room_options", "availability"], dependsOnStayContext: true, entity: { category: "room", rawText: "雙人房", canonicalCandidate: null, confidence: 0.95 }, stayCandidate: { dateExpression: { rawText: "8/6", kind: "absolute", anchor: "message_time" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null }, confidence: 0.95 },
      { taskId: "parking", type: "amenity", sourceText: "有車位嗎？", requestedOutputs: ["availability", "policy"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 }, stayCandidate: null, confidence: 0.99 },
      { taskId: "bbq", type: "policy", sourceText: "可以烤肉嗎？", requestedOutputs: ["policy"], dependsOnStayContext: false, entity: { category: "policy", rawText: "烤肉", canonicalCandidate: "bbq", confidence: 0.99 }, stayCandidate: null, confidence: 0.99 }
    ], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "multi_task"
  }) };
  const multiTaskEngine = new ConversationEngineV2({ planner: explicitPlanner(multiTaskPlanner), persistence, getProperty: () => multiRoomProperty,
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
    const operationValues = new Map(operations.filter((item) => item && item.operation !== "clear").map((item) => [item.field, item.value]));
    const dateExpression = {
      rawText: operationValues.get("stay.dateExpression.rawText") || "",
      kind: operationValues.get("stay.dateExpression.kind") || "none",
      anchor: operationValues.get("stay.dateExpression.anchor") || "none"
    };
    const stay = {
      dateExpression,
      checkInCandidate: operationValues.get("stay.checkInCandidate") || null,
      checkOutCandidate: operationValues.get("stay.checkOutCandidate") || null,
      nightsCandidate: nightsCandidate || operationValues.get("stay.nightsCandidate") || null,
      guestCountCandidate: guestCountCandidate || operationValues.get("stay.guestCountCandidate") || null
    };
    const rawTasks = tasks || [{
      taskId: "availability",
      type: "availability",
      sourceText: message,
      requestedOutputs: ["availability"],
      dependsOnStayContext: true,
      entity: { category: "room", rawText: "雙人房", canonicalCandidate: "r1", confidence: 0.98 },
      confidence: 0.98
    }];
    const stayTaskCount = rawTasks.filter((task) => task.dependsOnStayContext).length;
    const scopedTasks = rawTasks.map((task) => task.stayCandidate !== undefined ? task : {
      ...task,
      stayCandidate: task.dependsOnStayContext && stayTaskCount === 1 ? stay : null
    });
    return { classify: async () => ({
      schemaVersion: 2,
      discourse: { relation: "new_request", confidence: 0.99 },
      stateOperations: [],
      stay,
      tasks: scopedTasks,
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
    const temporalEngine = new ConversationEngineV2({ planner: explicitPlanner(plannerOutput), persistence, getProperty: () => temporalProperty, availabilityResolver: temporalAvailabilityResolver, listPriceOverrides: () => [], now: () => new Date(eventTimestamp) });
    return temporalEngine.process({ customerId: "p1", channelId: "c1", lineUserId: userId, eventId: `event-${userId}`, eventTimestamp, messageText: message });
  }

  const singleDate = await runTemporal("8/6 有雙人房嗎？", temporalPlanner({ message: "8/6 有雙人房嗎？", operations: dateOperations("8/6", "absolute", { checkInCandidate: "2026-08-06" }) }), "date-single");
  assert.equal(latestConditions(singleDate).stay.checkIn, "2026-08-06");
  assert.equal(latestConditions(singleDate).stay.checkOut, "2026-08-07");
  assert.equal(latestConditions(singleDate).stay.nights, 1);
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
  assert.deepEqual(latestConditions(oneNight).stay, { checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, guests: 2, searchRange: null });

  const twoNights = await runTemporal("8/6 住兩晚", temporalPlanner({ message: "8/6 住兩晚", operations: dateOperations("8/6", "absolute", { checkInCandidate: "2026-08-06", nightsCandidate: 2 }) }), "date-two-nights");
  assert.equal(latestConditions(twoNights).stay.checkOut, "2026-08-08");
  assert.equal(latestConditions(twoNights).stay.nights, 2);

  const missingDate = await runTemporal("有雙人房嗎？", temporalPlanner({ message: "有雙人房嗎？" }), "date-missing");
  assert.equal(missingDate.taskResults[0].status, "needs_clarification");
  assert.ok(missingDate.taskResults[0].missingInputs.includes("stay.checkIn"));

  const nightsWithoutDate = await runTemporal("two guests for two nights with bathtub", temporalPlanner({
    message: "two guests for two nights with bathtub",
    operations: [
      { field: "stay.nightsCandidate", operation: "set", value: 2, sourceText: "two nights" },
      { field: "stay.guestCountCandidate", operation: "set", value: 2, sourceText: "two guests" },
      { field: "inventory.features", operation: "set", value: ["bathtub"], sourceText: "bathtub" }
    ],
    nightsCandidate: 2,
    guestCountCandidate: 2
  }), "nights-without-date");
  assert.equal(latestConditions(nightsWithoutDate).stay.nights, 2);
  assert.equal(latestConditions(nightsWithoutDate).stay.guests, 2);
  assert.equal(nightsWithoutDate.taskResults[0].status, "needs_clarification");
  assert.deepEqual(nightsWithoutDate.taskResults[0].missingInputs, ["stay.checkIn"]);

  const staleStateUser = "explicit-date-replaces-state";
  await runTemporal("8/6 availability", temporalPlanner({ message: "8/6 availability", operations: dateOperations("8/6", "absolute", { checkInCandidate: "2026-08-06" }) }), staleStateUser);
  const pastExplicitDate = await runTemporal("7/18 availability", temporalPlanner({ message: "7/18 availability", operations: dateOperations("7/18", "absolute", { checkInCandidate: "2026-07-18" }) }), staleStateUser, Date.parse("2026-07-19T10:00:00+08:00"));
  assert.equal(latestConditions(pastExplicitDate).stay.checkIn, null);
  assert.equal(latestConditions(pastExplicitDate).stay.checkOut, null);
  assert.equal(pastExplicitDate.taskResults[0].status, "needs_clarification");

  const conditionStateUser = "condition-state-matrix";
  const initialConditions = await runTemporal("two guests two nights bathtub", temporalPlanner({
    message: "two guests two nights bathtub",
    operations: [
      { field: "stay.nightsCandidate", operation: "set", value: 2, sourceText: "two nights" },
      { field: "stay.guestCountCandidate", operation: "set", value: 2, sourceText: "two guests" },
      { field: "inventory.features", operation: "set", value: ["bathtub"], sourceText: "bathtub" }
    ], nightsCandidate: 2, guestCountCandidate: 2
  }), conditionStateUser);
  assert.deepEqual(latestConditions(initialConditions).stay, { checkIn: null, checkOut: null, nights: 2, guests: 2, searchRange: null });
  const replacedGuests = await runTemporal("change to four guests", temporalPlanner({
    message: "change to four guests", operations: [{ field: "stay.guestCountCandidate", operation: "replace", value: 4, sourceText: "four guests" }], guestCountCandidate: 4
  }), conditionStateUser);
  assert.equal(latestConditions(replacedGuests).stay.guests, 4);
  assert.equal(latestConditions(replacedGuests).stay.nights, null);
  assert.deepEqual(latestConditions(replacedGuests).inventory.features, []);
  const clearedFeature = await runTemporal("no bathtub needed", temporalPlanner({
    message: "no bathtub needed", operations: [{ field: "inventory.features", operation: "clear", value: null, sourceText: "no bathtub" }]
  }), conditionStateUser);
  assert.equal(latestConditions(clearedFeature).stay.guests, null);
  assert.equal(latestConditions(clearedFeature).stay.nights, null);
  assert.deepEqual(latestConditions(clearedFeature).inventory.features, []);

  const crossYearTimestamp = Date.parse("2026-12-20T10:00:00+08:00");
  const crossYear = await runTemporal("1/5 有雙人房嗎？", temporalPlanner({ message: "1/5 有雙人房嗎？", operations: dateOperations("1/5") }), "date-cross-year", crossYearTimestamp);
  assert.equal(latestConditions(crossYear).stay.checkIn, "2027-01-05");
  assert.equal(latestConditions(crossYear).stay.checkOut, "2027-01-06");

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
    planner: explicitPlanner(wrongCandidatePlanner),
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
    assert.equal(latestConditions(repeated).stay.checkIn, "2026-07-18");
    assert.equal(latestConditions(repeated).stay.checkOut, "2026-07-19");
    assert.equal(repeated.taskResults[0].status, "answered");
    assert.equal(repeated.taskResults[0].facts.availableInventory[0].canonicalId, "r1");
  }
  assert.deepEqual(repeatedAvailabilityCalls, Array.from({ length: 3 }, () => ({ propertyId: "p1", from: "2026-07-18", to: "2026-07-19" })));
  console.log("conversation engine v2 integration: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
