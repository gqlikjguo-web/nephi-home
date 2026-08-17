"use strict";
const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { composeSection } = require("../lib/conversation-engine-v2/controlled-composer");
const { formatSafeTestOnlyConversationTrace } = require("../server");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const states = new Map(), logs = [];
let stateWriteCount = 0;
const persistence = {
  getConversationState: (p, c, u) => states.get(`${p}:${c}:${u}`) || null,
  setConversationState: (p, c, u, value) => {
    stateWriteCount += 1;
    return states.set(`${p}:${c}:${u}`, value);
  },
  appendMessageLog: (p, value) => { const item = { ...value, customerId: p, reviewId: value.needsReview ? `review-${logs.length + 1}` : "" }; logs.push(item); return item; }
};

function explicitPlanner(basePlanner) {
  return {
    classify: async (input) => {
      const output = await basePlanner.classify(input);
      const source = input.sourceEvents[0];
      const tasks = output.tasks.map((task, candidateIndex) => ({ ...task, candidateIndex }));
      return migrateFakePlannerOutput({
        ...output,
        tasks,
        contextRelationCandidates: tasks.map((task) => ({ candidateIndex: task.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: source.eventId, startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }] }))
      });
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
function latestConditions(result) {
  const task = result.state.tasks.at(-1);
  const nights = task.checkIn && task.checkOut
    ? Math.round(
      (Date.parse(`${task.checkOut}T00:00:00.000Z`)
        - Date.parse(`${task.checkIn}T00:00:00.000Z`))
      / (24 * 60 * 60 * 1000)
    )
    : null;
  return {
    stay: {
      checkIn: task.checkIn,
      checkOut: task.checkOut,
      nights,
      guests: task.guestCount,
      searchRange: task.searchFrom && task.searchTo
        ? { from: task.searchFrom, to: task.searchTo }
        : null
    },
    inventory: {
      mode: task.productType === "bundle"
        ? "bundle_only"
        : task.productType === "room_type"
          ? "room_only"
          : "any",
      entityId: task.productId,
      features: []
    }
  };
}

(async () => {
  const pricingCalls = [];
  let pricingAvailableDatesCalls = 0;
  const pricingPlanner = { classify: async () => ({
    schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations: [],
    stay: { dateExpression: { rawText: "8/6", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-06", checkOutCandidate: "2026-08-08", nightsCandidate: 2, guestCountCandidate: 2 },
    tasks: [{
      taskId: "active-engine-price", type: "price", sourceText: "8/6 price request", detailIntent: "general", requestedOutputs: ["price"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true,
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
  const pricingResult = await pricingEngine.process({ customerId: "p1", channelId: "pricing", lineUserId: "pricing-user", eventId: "pricing-event", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6 price request" });
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

  let rejectedPricingStateWrittenBeforeComposer = false;
  const rejectedPricingEngine = new ConversationEngineV2({
    planner: explicitPlanner(pricingPlanner), composer: { compose: async () => {
      rejectedPricingStateWrittenBeforeComposer = states.has("p1:pricing-rejected:pricing-rejected-user");
      return { replyText: "unverified", factTaskIds: [] };
    } }, persistence, getProperty: () => property,
    availabilityResolver: (query) => ({ ...query, availabilityReliable: true, rooms: property.rooms, lineUrl: "" }),
    availableDatesResolver: () => ({ status: "answered", dates: [] }), listPriceOverrides: () => [], now: () => new Date("2026-07-17T02:00:00.000Z")
  });
  const rejectedPricing = await rejectedPricingEngine.process({ customerId: "p1", channelId: "pricing-rejected", lineUserId: "pricing-rejected-user", eventId: "pricing-rejected-event", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6 price request" });
  assert.equal(rejectedPricing.finalDecision.action, "reply", "a rejected Composer candidate must not override a subsequently validated safe fallback");
  assert.equal(rejectedPricing.finalDecision.reasonCode, "execution_answered");
  assert.equal(rejectedPricing.finalDecision.reviewRequired, false);
  assert.equal(rejectedPricing.claimValidation.ok, true);
  assert.equal(rejectedPricing.replyText.includes("unverified"), false, "claim-validator-rejected text must not reach the reply");
  assert.equal(rejectedPricingStateWrittenBeforeComposer, true, "V3 state must persist before the async Composer boundary");

  const result = await engine.process({ customerId: "p1", channelId: "c1", lineUserId: "u1", eventId: "e1", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6雙人房有空嗎 有車位嗎 有麻將嗎" });
  assert.equal(result.shouldReply, true);
  assert.ok(result.replyText.includes("湖景雙人房"));
  assert.ok(result.replyText.includes("停車位"));
  assert.ok(result.replyText.includes("麻將"));
  assert.equal(result.taskResults.length, 3);
  assert.equal(result.reviewCount, 1);
  assert.equal(logs.filter((x) => x.needsReview && String(x.eventId).startsWith("e1:review:")).length, 1);
  assert.equal(logs.find((x) => x.eventId === "e1").needsReview, true, "handoff FinalDecision must mark its primary message record for review");
  assert.equal(states.get("p1:c1:u1").schemaVersion, 3);
  assert.equal(result.claimValidation.ok, true);

  const incompleteComposer = { compose: async () => ({ replyText: "8/6 有湖景雙人房。", factTaskIds: ["a"] }) };
  const diagnostics = [];
  const guardedEngine = new ConversationEngineV2({ planner: explicitPlanner(planner), composer: incompleteComposer, persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [], onDiagnostic: (item) => diagnostics.push(item) });
  const guarded = await guardedEngine.process({ customerId: "p1", channelId: "c1", lineUserId: "u2", eventId: "e2", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6雙人房有空嗎 有車位嗎 有麻將嗎" });
  assert.ok(guarded.replyText.includes("湖景雙人房"));
  assert.ok(guarded.replyText.includes("停車位"));
  assert.ok(guarded.replyText.includes("麻將"));
  assert.deepEqual(guarded.claimValidation.coveredTaskIds.sort(), ["a", "b", "c"]);
  assert.deepEqual(diagnostics.map((item) => item.stage), ["property_catalog", "planner", "validation", "semantic_contract", "context_validation", "pending_request", "no_reply_gate", "context_execution", "canonical_request", "temporal", "entity_resolution", "formal_request", "query_plan", "executor", "response_plan", "state", "pending_request", "composer", "claim_validator", "line_ready", "final_decision"]);
  assert.equal(new Set(diagnostics.map((item) => item.traceId)).size, 1);
  assert.equal(guarded.replyText, result.replyText);
  const safeDiagnostics = diagnostics.map(formatSafeTestOnlyConversationTrace).filter(Boolean);
  const safePlanner = safeDiagnostics.find((item) => item.stage === "planner");
  assert.equal(safePlanner.parserSucceeded, true);
  assert.equal(Object.hasOwn(safePlanner, "dateExpression"), false, "safe Planner traces must not expose guest temporal text");
  assert.equal(Object.hasOwn(safePlanner, "dateCandidates"), false, "safe Planner traces must not expose raw Planner date candidates");
  assert.deepEqual(safePlanner.tasks.map(({ taskId, type, category, canonicalCandidate, detailIntent }) => ({ taskId, type, category, canonicalCandidate, detailIntent })), [
    { taskId: "a", type: "availability", category: "room", canonicalCandidate: "r1", detailIntent: "" },
    { taskId: "b", type: "amenity", category: "amenity", canonicalCandidate: "parking", detailIntent: "" },
    { taskId: "c", type: "amenity", category: "amenity", canonicalCandidate: "mahjong", detailIntent: "" }
  ]);
  const safeValidation = safeDiagnostics.find((item) => item.stage === "validation");
  const temporalDiagnostic = diagnostics.find((item) => item.stage === "temporal");
  assert.equal(temporalDiagnostic.items[0].expressionType, "absolute_date");
  assert.equal(temporalDiagnostic.items[0].resolutionStatus, "resolved");
  assert.deepEqual(temporalDiagnostic.items[0].produced, { checkIn: true, checkOut: true, nights: true });
  assert.equal(safeDiagnostics.some((item) => item.stage === "temporal"), false, "raw temporal provenance must not enter safe traces");
  const normalizedTasks = safePlanner.tasks.map((task) => ({ ...task, detailIntent: "general" }));
  assert.deepEqual(safeValidation.acceptedTasks, normalizedTasks);
  assert.deepEqual(safeValidation.rejectedTasks, []);
  assert.deepEqual(safeValidation.rejectionReasons, []);
  assert.deepEqual(safeValidation.finalTasks, normalizedTasks);
  const safeContextValidation = safeDiagnostics.find((item) => item.stage === "context_validation");
  assert.deepEqual(safeContextValidation.rejectionReasons, []);
  const safeContextExecution = safeDiagnostics.find((item) => item.stage === "context_execution");
  assert.deepEqual(safeContextExecution.items.map((item) => item.reasonCode), ["new_task", "new_task", "new_task"]);
  assert.deepEqual(safeContextExecution.automaticPendingRelation, {
    reasonCode: "planner_task_count_not_one",
    plannerTaskCount: 3,
    explicitRelationPresent: false,
    slotOnlyLodgingTurn: false,
    clarificationCandidateCount: 0,
    compatibleCandidateCount: 0,
    continuationSelected: false
  });
  const safeSlotPredicateTrace = formatSafeTestOnlyConversationTrace({
    traceId: "slot-predicate-trace",
    propertyId: "p1",
    stage: "context_execution",
    items: [],
    automaticPendingRelation: {
      reasonCode: "not_slot_only_lodging_turn",
      plannerTaskCount: 1,
      slotPredicateDiagnostic: {
        hasDate: true,
        hasRangeOrCheckOut: false,
        hasStandaloneNights: false,
        hasGuests: false,
        hasProduct: false,
        hasOtherEntity: false,
        suppliedSlotKindCount: 1,
        entityRawTextPresent: true,
        sourceEqualsDateExpression: true,
        finalSlotOnlyResult: false,
        rawText: "PRIVATE GUEST TEXT"
      }
    }
  });
  assert.deepEqual(safeSlotPredicateTrace.automaticPendingRelation.slotPredicateDiagnostic, {
    hasDate: true,
    hasRangeOrCheckOut: false,
    hasStandaloneNights: false,
    hasGuests: false,
    hasProduct: false,
    hasOtherEntity: false,
    suppliedSlotKindCount: 1,
    entityRawTextPresent: true,
    sourceEqualsDateExpression: true,
    finalSlotOnlyResult: false
  });
  assert.equal(JSON.stringify(safeSlotPredicateTrace).includes("PRIVATE GUEST TEXT"), false);
  assert.deepEqual(safeContextValidation.candidates, [
    { candidateIndex: 0, relationKind: "new_request", candidateRequestCycleRefCount: 0, evidenceRefCount: 1, evidenceSourceMatches: [true] },
    { candidateIndex: 1, relationKind: "new_request", candidateRequestCycleRefCount: 0, evidenceRefCount: 1, evidenceSourceMatches: [true] },
    { candidateIndex: 2, relationKind: "new_request", candidateRequestCycleRefCount: 0, evidenceRefCount: 1, evidenceSourceMatches: [true] }
  ]);
  const safeCanonicalRequest = safeDiagnostics.find((item) => item.stage === "canonical_request");
  assert.deepEqual(safeCanonicalRequest.items[0].temporalState, {
    resolutionStatus: "resolved", expressionType: "absolute_date", repairReasonCode: "",
    checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, timezone: "Asia/Taipei"
  });
  assert.deepEqual(safeCanonicalRequest.items.map(({ taskId, capability, stayDependency, resolverId, evidenceRefCount }) => ({
    taskId, capability, stayDependency, resolverId, evidenceRefCount
  })), [
    { taskId: "a", capability: "availability", stayDependency: "required", resolverId: "availability_resolver", evidenceRefCount: 1 },
    { taskId: "b", capability: "parking", stayDependency: false, resolverId: "property_catalog", evidenceRefCount: 1 },
    { taskId: "c", capability: "amenity", stayDependency: false, resolverId: "property_catalog", evidenceRefCount: 1 }
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
  const hostileCanonicalTrace = formatSafeTestOnlyConversationTrace({
    traceId: "hostile-canonical-trace",
    propertyId: "p1",
    stage: "canonical_request",
    items: [{
      taskId: "a",
      capability: "availability",
      canonicalEntity: { category: "room", canonicalId: "r1", status: "resolved", rawText: "PRIVATE GUEST MESSAGE" },
      detailIntent: "general",
      temporalState: { resolutionStatus: "resolved", checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, timezone: "Asia/Taipei", rawText: "PRIVATE GUEST MESSAGE" },
      stayDependency: "required",
      requiredFields: ["checkIn", "checkOut"],
      resolverId: "availability_resolver",
      riskLevel: "standard",
      responseMode: "answer",
      evidenceRefs: [{ eventId: "PRIVATE EVENT ID", messageRef: "PRIVATE MESSAGE REF", quote: "PRIVATE EVIDENCE QUOTE" }],
      propertyData: { rooms: "PRIVATE PROPERTY DATA" }
    }]
  });
  const pastDateCanonicalTrace = formatSafeTestOnlyConversationTrace({
    traceId: "past-date-trace",
    propertyId: "p1",
    stage: "canonical_request",
    items: [{
      taskId: "past-date-task",
      capability: "availability",
      temporalState: {
        resolutionStatus: "unresolved",
        expressionType: "date_range",
        repairReasonCode: "past_date",
        checkIn: null,
        checkOut: null,
        nights: 2,
        timezone: "Asia/Taipei",
        rawText: "PRIVATE GUEST MESSAGE"
      }
    }]
  });
  assert.deepEqual(pastDateCanonicalTrace.items[0].temporalState, {
    resolutionStatus: "unresolved",
    expressionType: "date_range",
    repairReasonCode: "past_date",
    checkIn: "",
    checkOut: "",
    nights: 2,
    timezone: "Asia/Taipei"
  });
  const safeSerialized = JSON.stringify([...safeDiagnostics, rejectedTrace, hostileContextTrace, hostileTrace, hostileCanonicalTrace, pastDateCanonicalTrace]);
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

  const identifiedNewRequestDiagnostics = [];
  const identifiedNewRequestPlanner = {
    classify: async (input) => {
      const output = await explicitPlanner(planner).classify(input);
      output.tasks[0] = { ...output.tasks[0], sourceText: "planner paraphrase absent from source" };
      output.contextRelationCandidates[0].evidenceRefs[0] = {
        eventId: input.sourceEvents[0].eventId,
        messageRef: "",
        startOffset: 999,
        endOffset: 1000,
        quote: "planner paraphrase absent from source"
      };
      return output;
    }
  };
  const identifiedNewRequestEngine = new ConversationEngineV2({
    planner: identifiedNewRequestPlanner,
    persistence,
    getProperty: () => property,
    availabilityResolver,
    listPriceOverrides: () => [],
    onDiagnostic: (item) => identifiedNewRequestDiagnostics.push(item)
  });
  const identifiedNewRequestResult = await identifiedNewRequestEngine.process({
    customerId: "p1",
    channelId: "identified-new-request",
    lineUserId: "identified-new-request-user",
    eventId: "identified-new-request-event",
    eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"),
    messageText: "identified current source event"
  });
  assert.notEqual(
    identifiedNewRequestResult.finalDecision.reasonCode,
    "context_relation_invalid",
    "a uniquely identified current-turn new request must normalize malformed Planner evidence to the exact source event"
  );
  const identifiedNewRequestContext = identifiedNewRequestDiagnostics.find((item) => item.stage === "context_validation");
  assert.deepEqual(identifiedNewRequestContext.rejectionReasons, []);
  assert.deepEqual(identifiedNewRequestContext.candidates[0].evidenceSourceMatches, [true]);

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
    tasks: [{ taskId: "parking", type: "property_fact", sourceText: "有車位嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 }, confidence: 0.99 }],
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "known_fact"
  }) };
  const groundedDiagnostics = [];
  const groundedEngine = new ConversationEngineV2({ planner: explicitPlanner(groundedPlanner), composer: { compose: async () => ({ sections: [{ taskId: "parking", responseMode: "answer", text: "有一個停車位" }] }) }, persistence, getProperty: () => property, availabilityResolver, listPriceOverrides: () => [], onDiagnostic: (item) => groundedDiagnostics.push(item) });
  const groundedReply = await groundedEngine.process({ customerId: "p1", channelId: "c1", lineUserId: "grounded", eventId: "grounded", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "有車位嗎？" });
  assert.equal(groundedReply.replyText, "有一個停車位");
  const groundedSemanticTrace = groundedDiagnostics.find((item) => item.stage === "semantic_contract");
  assert.equal(Object.hasOwn(groundedSemanticTrace, "repairProvenance"), false, "a structurally valid Planner task must not need source-derived semantic repair");
  const groundedSafeDiagnostics = groundedDiagnostics.map(formatSafeTestOnlyConversationTrace).filter(Boolean);
  const groundedSafeValidation = groundedSafeDiagnostics.find((item) => item.stage === "validation");
  const groundedSafeSemantic = groundedSafeDiagnostics.find((item) => item.stage === "semantic_contract");
  assert.deepEqual(groundedSafeValidation.repairProvenance, groundedSemanticTrace.repairProvenance, "validation must retain the semantic repair join in the safe trace");
  assert.equal(Object.hasOwn(groundedSafeSemantic, "repairProvenance"), false, "semantic repair provenance must have exactly one authoritative safe stage");
  assert.equal(groundedSafeDiagnostics.filter((item) => Array.isArray(item.repairProvenance)).length, 0, "no semantic repair ledger is projected when no repair occurred");
  assert.equal(Object.hasOwn(groundedReply.taskResults[0], "repairCorrelationId"), false, "diagnostic provenance must not enter product task results");
  assert.equal(groundedDiagnostics.find((item) => item.stage === "composer").composerSource, "openai");
  assert.equal(groundedDiagnostics.find((item) => item.stage === "composer").fallbackOccurred, false);
  for (const [index, question] of ["有車位嗎？", "停車方便嗎？", "需要預約車位嗎？"].entries()) {
    let parkingAvailabilityCalls = 0;
    const parkingPlanner = { classify: async () => ({
      schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations: [],
      stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
      tasks: [{ taskId: "parking", type: "amenity", sourceText: question, requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "停車", canonicalCandidate: "parking", confidence: 0.99 }, stayCandidate: null, confidence: 0.99 }],
      ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "parking_question"
    }) };
    const parkingEngine = new ConversationEngineV2({
      planner: explicitPlanner(parkingPlanner), persistence, getProperty: () => property,
      availabilityResolver: () => { parkingAvailabilityCalls += 1; throw new Error("parking_must_not_call_availability"); },
      listPriceOverrides: () => []
    });
    const parkingReply = await parkingEngine.process({ customerId: "p1", channelId: "parking", lineUserId: `parking-${index}`, eventId: `parking-${index}`, eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: question });
    assert.equal(parkingReply.taskResults[0].status, "answered");
    assert.equal(parkingReply.taskResults[0].type, "parking");
    assert.equal(parkingReply.taskResults[0].facts.source, "property_catalog");
    assert.equal(parkingReply.taskResults[0].facts.answer, "有一個停車位");
    assert.equal(parkingAvailabilityCalls, 0);
    assert.equal(parkingReply.finalDecision.action, "reply");
    assert.equal(parkingReply.replyText, "有一個停車位");
  }
  const parkingUnknownPlanner = { classify: async () => ({
    schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{ taskId: "parking", type: "amenity", sourceText: "有車位嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 }, stayCandidate: null, confidence: 0.99 }],
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "parking_unknown"
  }) };
  const propertyWithoutParkingFact = { ...property, commonAnswers: {}, semanticCatalog: { aliases: { parking: ["車位"] }, amenities: [] } };
  let parkingUnknownAvailabilityCalls = 0;
  const parkingUnknownEngine = new ConversationEngineV2({
    planner: explicitPlanner(parkingUnknownPlanner), persistence, getProperty: () => propertyWithoutParkingFact,
    availabilityResolver: () => { parkingUnknownAvailabilityCalls += 1; throw new Error("parking_must_not_call_availability"); },
    listPriceOverrides: () => []
  });
  const parkingUnknown = await parkingUnknownEngine.process({ customerId: "p1", channelId: "parking", lineUserId: "parking-unknown", eventId: "parking-unknown", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "有車位嗎？" });
  assert.equal(parkingUnknown.taskResults[0].status, "needs_human");
  assert.equal(parkingUnknown.taskResults[0].reason, "property_fact_unknown");
  assert.equal(parkingUnknownAvailabilityCalls, 0);
  assert.equal(parkingUnknown.finalDecision.action, "handoff");
  assert.ok(parkingUnknown.replyText.includes("需要請業者確認"));
  assert.ok(!parkingUnknown.replyText.includes("停車場"));

  async function runMixedResult({ id, messageText, tasks }) {
    let composerCalls = 0;
    const writesBefore = stateWriteCount;
    const mixedPlanner = { classify: async () => ({
      schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations: [],
      stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
      tasks, ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "mixed_result"
    }) };
    const diagnostics = [];
    const mixedEngine = new ConversationEngineV2({
      planner: explicitPlanner(mixedPlanner), persistence, getProperty: () => property,
      availabilityResolver, listPriceOverrides: () => [],
      composer: { compose: async () => { composerCalls += 1; throw new Error("mixed_plan_must_remain_deterministic"); } },
      onDiagnostic: (item) => diagnostics.push(item)
    });
    const result = await mixedEngine.process({ customerId: "p1", channelId: "mixed", lineUserId: id, eventId: id, eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText });
    return {
      result,
      diagnostics,
      composerCalls,
      stateWrites: stateWriteCount - writesBefore
    };
  }

  const parkingTask = { taskId: "parking", type: "amenity", sourceText: "有車位嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 }, stayCandidate: null, confidence: 0.99 };
  const mixedUnknown = await runMixedResult({
    id: "mixed-unknown", messageText: "有車位嗎？未知問題",
    tasks: [parkingTask, { taskId: "unknown", type: "unknown", sourceText: "未知問題", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "other", rawText: "未知問題", canonicalCandidate: null, confidence: 0.9 }, stayCandidate: null, confidence: 0.9 }]
  });
  assert.deepEqual(mixedUnknown.result.taskResults.map((item) => item.status), ["answered", "needs_human"]);
  assert.equal(mixedUnknown.composerCalls, 0);
  assert.equal(mixedUnknown.diagnostics.find((item) => item.stage === "composer").validationResult, "accepted");
  assert.equal(mixedUnknown.result.claimValidation.ok, true);
  assert.equal(mixedUnknown.result.finalDecision.action, "reply");
  assert.equal(mixedUnknown.result.finalDecision.reviewRequired, true);
  assert.ok(mixedUnknown.result.replyText.includes("有一個停車位"));
  assert.ok(mixedUnknown.result.replyText.includes("需要請業者確認"));

  const mixedClarification = await runMixedResult({
    id: "mixed-clarification", messageText: "有車位嗎？有雙人房嗎？",
    tasks: [parkingTask, { taskId: "room", type: "availability", sourceText: "有雙人房嗎？", requestedOutputs: ["availability"], dependsOnStayContext: true, entity: { category: "room", rawText: "雙人房", canonicalCandidate: "r1", confidence: 0.99 }, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, confidence: 0.99 }]
  });
  assert.equal(mixedClarification.result.taskResults.find((item) => item.taskId === "parking").status, "answered");
  assert.equal(mixedClarification.result.taskResults.find((item) => item.taskId === "room").status, "needs_clarification");
  assert.equal(mixedClarification.composerCalls, 0);
  assert.equal(mixedClarification.diagnostics.find((item) => item.stage === "composer").validationResult, "accepted");
  assert.equal(mixedClarification.result.claimValidation.ok, true);
  assert.equal(mixedClarification.result.finalDecision.action, "clarification");
  assert.equal(
    mixedClarification.result.state.tasks.find((task) => task.taskId === "room").status,
    "needs_clarification",
    "the FinalDecision not-ready task must be the persisted clarification focus"
  );
  assert.equal(mixedClarification.stateWrites, 1, "a clarification turn must persist V3 state exactly once");
  assert.ok(mixedClarification.result.replyText.includes("有一個停車位"));
  assert.ok(mixedClarification.result.replyText.includes("請補充入住日期。"));

  const mixedHighRisk = await runMixedResult({
    id: "mixed-high-risk", messageText: "有車位嗎？高風險問題",
    tasks: [parkingTask, { taskId: "risk", type: "high_risk", sourceText: "高風險問題", requestedOutputs: ["handoff"], dependsOnStayContext: false, entity: { category: "other", rawText: "高風險問題", canonicalCandidate: null, confidence: 0.99 }, stayCandidate: null, confidence: 0.99 }]
  });
  assert.deepEqual(mixedHighRisk.result.taskResults.map((item) => item.status), ["answered", "needs_human"]);
  assert.equal(mixedHighRisk.composerCalls, 0);
  assert.equal(mixedHighRisk.result.claimValidation.ok, true);
  assert.equal(mixedHighRisk.result.finalDecision.action, "handoff");
  assert.notEqual(
    mixedHighRisk.result.state.tasks.find((task) => task.taskId === "risk").status,
    "needs_clarification",
    "a handoff must not create clarification focus"
  );
  assert.equal(mixedHighRisk.stateWrites, 1, "a handoff turn must persist V3 state exactly once");
  assert.equal(mixedHighRisk.result.finalDecision.reasonCode, "high_risk");
  assert.ok(mixedHighRisk.result.replyText.includes("有一個停車位"));
  assert.ok(mixedHighRisk.result.replyText.includes("需要請業者確認"));

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
      { taskId: "parking", type: "amenity", sourceText: "有車位嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 }, stayCandidate: null, confidence: 0.99 },
      { taskId: "bbq", type: "policy", sourceText: "可以烤肉嗎？", requestedOutputs: ["policy"], dependsOnStayContext: false, entity: { category: "policy", rawText: "烤肉", canonicalCandidate: "bbq", confidence: 0.99 }, stayCandidate: null, confidence: 0.99 }
    ], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "multi_task"
  }) };
  const mismatchedEvidencePlanner = {
    classify: async (input) => {
      const output = await multiTaskPlanner.classify(input);
      const tasks = output.tasks.map((task, candidateIndex) => ({ ...task, candidateIndex }));
      const migrated = migrateFakePlannerOutput({
        ...output,
        tasks,
        contextRelationCandidates: tasks.map((task) => ({
          candidateIndex: task.candidateIndex,
          kind: "new_request",
          candidateRequestCycleRefs: [],
          evidenceRefs: [{ eventId: "planner-invented-event", messageRef: "", startOffset: 999, endOffset: 1000, quote: "planner mismatch" }]
        }))
      });
      const source = input.sourceEvents[0];
      for (const task of migrated.tasks) {
        const startOffset = source.messageText.indexOf(task.sourceText);
        const candidate = migrated.semanticCandidates.find((item) => task.semanticCandidateIds.includes(item.candidateId));
        candidate.evidenceRefs = [{ eventId: source.eventId, messageRef: "", startOffset, endOffset: startOffset + task.sourceText.length, quote: task.sourceText }];
      }
      return migrated;
    }
  };
  const multiTaskDiagnostics = [];
  let multiTaskAvailabilityCalls = 0;
  const multiTaskEngine = new ConversationEngineV2({ planner: mismatchedEvidencePlanner, persistence, getProperty: () => multiRoomProperty,
    availabilityResolver: (query) => { multiTaskAvailabilityCalls += 1; return { ...query, availabilityReliable: true, rooms: multiRoomProperty.rooms.filter((room) => room.id !== "r3"), lineUrl: "" }; },
    composer: { compose: async (plan) => ({ sections: plan.sections.map((section) => ({ taskId: section.taskId, responseMode: section.responseMode, text: section.responseMode === "clarification" ? "使用限制目前沒有正式資料" : composeSection(section) })) }) },
    listPriceOverrides: () => [], now: () => new Date("2026-07-17T02:00:00.000Z"),
    onDiagnostic: (item) => multiTaskDiagnostics.push(item) });
  const multiTask = await multiTaskEngine.process({ customerId: "p1", channelId: "c1", lineUserId: "multi", eventId: "multi-1", eventTimestamp: Date.parse("2026-07-17T10:00:00+08:00"), messageText: "8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？" });
  assert.notEqual(multiTask.finalDecision.reasonCode, "context_relation_invalid", "unique exact task sourceText must prevent the real three-question evidence mismatch fallback");
  const multiTaskContextValidation = multiTaskDiagnostics.find((item) => item.stage === "context_validation");
  assert.deepEqual(multiTaskContextValidation.candidates.map((candidate) => candidate.evidenceSourceMatches), [[true], [true], [true]]);
  assert.equal(multiTaskDiagnostics.some((item) => item.stage === "fallback" && item.reasonCode === "context_relation_invalid"), false);
  for (const stage of ["temporal", "formal_request", "query_plan", "executor"]) {
    assert.ok(multiTaskDiagnostics.some((item) => item.stage === stage), `canonical evidence must continue through ${stage}`);
  }
  const availabilityResult = multiTask.taskResults.find((item) => item.taskId === "availability");
  const parkingResult = multiTask.taskResults.find((item) => item.taskId === "parking");
  const bbqResult = multiTask.taskResults.find((item) => item.taskId === "bbq");
  const multiTaskComposerTrace = multiTaskDiagnostics.find((item) => item.stage === "composer");
  assert.deepEqual({
    parkingStatus: parkingResult.status,
    composerValidationResult: multiTaskComposerTrace.validationResult,
    finalAction: multiTask.finalDecision.action,
    finalReasonCode: multiTask.finalDecision.reasonCode
  }, {
    parkingStatus: "answered",
    composerValidationResult: "accepted",
    finalAction: "reply",
    finalReasonCode: "execution_answered"
  });
  assert.equal(availabilityResult.status, "answered");
  assert.equal(availabilityResult.facts.source, "availability_resolver");
  assert.equal(parkingResult.facts.source, "property_catalog");
  assert.equal(parkingResult.facts.answer, "有停車位");
  assert.equal(bbqResult.status, "answered");
  assert.equal(bbqResult.facts.source, "property_catalog");
  assert.equal(multiTaskAvailabilityCalls, 1);
  assert.equal(multiTask.taskResults.length, 3);
  assert.deepEqual(availabilityResult.facts.availableInventory.map((item) => item.canonicalId), ["r1", "r2"]);
  assert.ok(multiTask.replyText.includes("A 雙人房"));
  assert.ok(multiTask.replyText.includes("B 雙人房"));
  assert.ok(multiTask.replyText.includes("有停車位"));
  assert.ok(multiTask.replyText.includes("可依規則烤肉"));
  assert.ok(!multiTask.replyText.includes("哪一個"));
  assert.ok(!multiTask.replyText.includes("使用限制目前沒有正式資料"));
  assert.equal(multiTask.claimValidation.ok, true);
  assert.deepEqual(multiTask.claimValidation.missingTaskIds, []);

  function temporalPlanner({ message, operations = [], tasks, semanticCandidates, nightsCandidate = null, guestCountCandidate = null, missingInformation = [] }) {
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
      ...(Array.isArray(semanticCandidates) ? { semanticCandidates } : {}),
      ambiguities: [], missingInformation, needsHuman: false, shouldIgnore: false, reason: "temporal_flow"
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
  async function runTemporal(message, plannerOutput, userId, eventTimestamp = Date.parse("2026-07-17T10:00:00+08:00"), resolver = temporalAvailabilityResolver) {
    const temporalEngine = new ConversationEngineV2({ planner: explicitPlanner(plannerOutput), persistence, getProperty: () => temporalProperty, availabilityResolver: resolver, listPriceOverrides: () => [], now: () => new Date(eventTimestamp) });
    return temporalEngine.process({ customerId: "p1", channelId: "c1", lineUserId: userId, eventId: `event-${userId}`, eventTimestamp, messageText: message });
  }

  const singleDate = await runTemporal("8/6 有雙人房嗎？", temporalPlanner({ message: "8/6 有雙人房嗎？", operations: dateOperations("8/6", "absolute", { checkInCandidate: "2026-08-06" }) }), "date-single");
  assert.equal(latestConditions(singleDate).stay.checkIn, "2026-08-06");
  assert.equal(latestConditions(singleDate).stay.checkOut, "2026-08-07");
  assert.equal(latestConditions(singleDate).stay.nights, 1);
  assert.equal(singleDate.taskResults[0].status, "answered");

  let uncertainGuestAvailabilityCalls = 0;
  const uncertainGuestMessage = "8/14-8/15 人數大概6-8人";
  const uncertainGuestScopeId = "80000000-0000-4000-8000-000000000019";
  const uncertainAvailabilityCandidateId = "81000000-0000-4000-8000-000000000019";
  const uncertainCapacityCandidateId = "82000000-0000-4000-8000-000000000019";
  const uncertainGuestScope = { scopeId: uncertainGuestScopeId, bundleCanonicalCandidate: null, roomCanonicalCandidates: [], guestCountCandidate: 7 };
  const uncertainGuest = await runTemporal(uncertainGuestMessage, temporalPlanner({
    message: uncertainGuestMessage,
    operations: dateOperations("8/14-8/15", "range", { checkInCandidate: "2026-08-14" }),
    tasks: [{
      taskId: "uncertain-guest-availability",
      semanticCandidateIds: [uncertainAvailabilityCandidateId],
      lodgingScopeId: uncertainGuestScopeId,
      type: "availability",
      sourceText: uncertainGuestMessage,
      requestedOutputs: ["availability"],
      dependsOnStayContext: true,
      entity: { category: "room", rawText: "雙人房", canonicalCandidate: "r1", confidence: 0.98 },
      stayCandidate: {
        dateExpression: { rawText: "8/14-8/15", kind: "range", anchor: "message_time" },
        checkInCandidate: "2026-08-14",
        checkOutCandidate: "2026-08-15",
        nightsCandidate: 1,
        guestCountCandidate: 7
      },
      confidence: 0.98
    }, {
      taskId: "uncertain-guest-capacity",
      semanticCandidateIds: [uncertainCapacityCandidateId],
      lodgingScopeId: uncertainGuestScopeId,
      type: "capacity",
      sourceText: uncertainGuestMessage,
      detailIntent: "quantity",
      requestedOutputs: ["answer"],
      dependsOnStayContext: true,
      entity: { category: "room", rawText: "房型", canonicalCandidate: null, confidence: 0.98 },
      stayCandidate: {
        dateExpression: { rawText: "8/14-8/15", kind: "range", anchor: "message_time" },
        checkInCandidate: "2026-08-14",
        checkOutCandidate: "2026-08-15",
        nightsCandidate: 1,
        guestCountCandidate: 7
      },
      confidence: 0.98
    }],
    semanticCandidates: [
      { candidateId: uncertainAvailabilityCandidateId, semanticKind: "capability", capability: "availability", canonicalIdentityCandidate: null, evidenceRefs: [], lodgingScopeCandidate: uncertainGuestScope, temporalSemanticCandidate: null, propertyCatalogIdentity: null },
      { candidateId: uncertainCapacityCandidateId, semanticKind: "capability", capability: "capacity", canonicalIdentityCandidate: null, evidenceRefs: [], lodgingScopeCandidate: uncertainGuestScope, temporalSemanticCandidate: null, propertyCatalogIdentity: null }
    ],
    missingInformation: ["exact guest count"]
  }), "uncertain-guest-count", Date.parse("2026-07-17T10:00:00+08:00"), (query) => {
    uncertainGuestAvailabilityCalls += 1;
    return temporalAvailabilityResolver(query);
  });
  assert.equal(uncertainGuest.finalDecision.action, "clarification", "an explicitly uncertain guest count must clarify");
  const uncertainAvailability = uncertainGuest.taskResults.find((item) => item.taskId === "uncertain-guest-availability");
  assert.equal(uncertainAvailability.status, "needs_clarification");
  assert.deepEqual(uncertainAvailability.missingInputs, ["guestCount"]);
  assert.equal(uncertainGuestAvailabilityCalls, 0, "an explicitly uncertain guest count must not execute availability");

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
  assert.deepEqual(missingDate.taskResults[0].missingInputs, ["checkIn", "checkOut"]);

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
  assert.equal(latestConditions(nightsWithoutDate).stay.nights, null);
  assert.equal(latestConditions(nightsWithoutDate).stay.guests, 2);
  assert.equal(nightsWithoutDate.taskResults[0].status, "needs_clarification");
  assert.deepEqual(nightsWithoutDate.taskResults[0].missingInputs, ["checkIn", "checkOut"]);

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
  assert.deepEqual(latestConditions(initialConditions).stay, { checkIn: null, checkOut: null, nights: null, guests: 2, searchRange: null });
  const replacedGuests = await runTemporal("change to four guests", temporalPlanner({
    message: "change to four guests", operations: [{ field: "stay.guestCountCandidate", operation: "replace", value: 4, sourceText: "four guests" }], guestCountCandidate: 4
  }), conditionStateUser);
  assert.equal(latestConditions(replacedGuests).stay.guests, 4);
  assert.equal(latestConditions(replacedGuests).stay.nights, null);
  assert.deepEqual(latestConditions(replacedGuests).inventory.features, []);
  const guestCycleId = replacedGuests.state.tasks.at(-1).taskId;
  const clearedFeature = await runTemporal("no bathtub needed", temporalPlanner({
    message: "no bathtub needed",
    tasks: [{
      taskId: "bathtub-feature",
      type: "property_fact",
      sourceText: "no bathtub needed",
      requestedOutputs: ["answer"],
      dependsOnStayContext: false,
      entity: { category: "room_feature", rawText: "bathtub", canonicalCandidate: "r1", confidence: 0.98 },
      stayCandidate: null,
      confidence: 0.98
    }]
  }), conditionStateUser);
  assert.notEqual(clearedFeature.state.tasks.at(-1).taskId, guestCycleId, "a substantive room-feature request must start a new cycle");
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
