"use strict";

const assert = require("node:assert/strict");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");

const EVENT_TIMESTAMP = Date.parse("2026-07-23T10:30:00Z");
const property = {
  propertyId: "dialogue_temporal_contract_property",
  displayName: "Dialogue Temporal Contract Lodge",
  timezone: "Asia/Taipei",
  rooms: [
    { id: "room_double", name: "雙人房", type: "double", capacity: 2, enabled: true }
  ],
  commonAnswers: {
    parkingRule: "提供停車位。",
    bbqRule: "可依規定使用烤肉區。"
  },
  faqs: [
    { knowledgeKey: "pool", question: "戲水池", answer: "提供戲水池。" }
  ],
  semanticCatalog: {
    aliases: {
      room_double: ["雙人房"],
      parking: ["停車"],
      bbq: ["烤肉"],
      pool: ["戲水池"]
    }
  }
};

function task(type, taskId, options = {}) {
  const factType = ["amenity", "policy", "property_fact"].includes(type);
  return {
    taskId,
    type,
    sourceText: options.sourceText || taskId,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: options.dependsOnStayContext === undefined ? !factType : options.dependsOnStayContext,
    entity: {
      category: options.category || (type === "amenity" ? "amenity" : type === "policy" ? "policy" : type === "property_fact" ? "other" : "other"),
      rawText: options.rawText === undefined ? "" : options.rawText,
      canonicalCandidate: options.canonicalCandidate === undefined ? null : options.canonicalCandidate,
      confidence: 0.99
    },
    confidence: 0.99
  };
}

function plannerOutput(tasks, options = {}) {
  const rawText = options.rawText || "";
  const kind = options.kind || "none";
  const anchor = rawText ? "message_time" : "none";
  const stateOperations = [...(options.stateOperations || [])];
  if (rawText) {
    stateOperations.push(
      { field: "stay.dateExpression.rawText", operation: "set", value: rawText, sourceText: rawText },
      { field: "stay.dateExpression.kind", operation: "set", value: kind, sourceText: rawText },
      { field: "stay.dateExpression.anchor", operation: "set", value: anchor, sourceText: rawText }
    );
  }
  if (options.checkInCandidate) {
    stateOperations.push({ field: "stay.checkInCandidate", operation: "set", value: options.checkInCandidate, sourceText: rawText });
  }
  if (options.roomId) {
    stateOperations.push(
      { field: "inventory.entityId", operation: "set", value: options.roomId, sourceText: options.roomId },
      { field: "inventory.mode", operation: "set", value: "room_only", sourceText: options.roomId }
    );
  }
  return {
    schemaVersion: 2,
    discourse: { relation: options.relation || "new_request", confidence: 0.99 },
    stateOperations,
    stay: {
      dateExpression: { rawText, kind, anchor },
      checkInCandidate: options.checkInCandidate || null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: options.guests || null
    },
    tasks,
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: Boolean(options.shouldIgnore),
    reason: options.reason || "production_shape_regression"
  };
}

function memory() {
  const states = new Map();
  const messages = [];
  return {
    states,
    messages,
    getConversationState: (propertyId, channelId, lineUserId) => states.get(`${propertyId}:${channelId}:${lineUserId}`) || null,
    setConversationState: (propertyId, channelId, lineUserId, state) => states.set(`${propertyId}:${channelId}:${lineUserId}`, state),
    appendMessageLog: (_propertyId, value) => {
      messages.push(value);
      return { ...value, reviewId: value.needsReview ? `review-${messages.length}` : "" };
    },
    updateMessageEvent: (_propertyId, _channelId, _eventId, value) => {
      messages.push(value);
      return value;
    }
  };
}

function runtime(outputs, persistence = memory()) {
  const diagnostics = [];
  const availabilityCalls = [];
  const availableDatesCalls = [];
  const engine = new ConversationEngineV2({
    planner: { classify: async () => outputs.shift() },
    persistence,
    getProperty: () => property,
    availabilityResolver: (query) => {
      availabilityCalls.push(query);
      return { ...query, availabilityReliable: true, rooms: property.rooms };
    },
    availableDatesResolver: (query) => {
      availableDatesCalls.push(query);
      return { status: "answered", dates: [], source: "test" };
    },
    listPriceOverrides: () => [],
    now: () => new Date("2026-07-23T10:30:00.000Z"),
    onDiagnostic: (item) => diagnostics.push(item)
  });
  return { engine, persistence, diagnostics, availabilityCalls, availableDatesCalls };
}

function input(eventId, messageText, lineUserId = "same-user") {
  return {
    customerId: property.propertyId,
    channelId: "test-only-line",
    lineUserId,
    eventId,
    eventTimestamp: EVENT_TIMESTAMP,
    messageText
  };
}

async function processOne(output, messageText, eventId) {
  const current = runtime([output]);
  const result = await current.engine.process(input(eventId, messageText, eventId));
  return { ...current, result };
}

async function testAcknowledgementContradictions() {
  const propertyFact = await processOne(plannerOutput([
    task("property_fact", "greeting-property-fact", {
      sourceText: "一般社交訊息",
      rawText: "一般社交訊息",
      category: "other"
    })
  ], { relation: "acknowledgement", shouldIgnore: false }), "一般社交訊息", "ack-property-fact");
  assert.equal(propertyFact.result.finalDecision.type, "no_reply");
  assert.equal(propertyFact.result.reviewCount, 0);
  assert.equal(propertyFact.availabilityCalls.length, 0);
  const propertyFactSemantic = propertyFact.diagnostics.find((item) => item.stage === "semantic_contract");
  assert.equal(propertyFactSemantic.shouldIgnore, true);
  assert.deepEqual(propertyFactSemantic.outputTasks.map((item) => item.type), ["unknown"]);

  const unknown = await processOne(plannerOutput([
    task("unknown", "ack-unknown", {
      sourceText: "一般社交訊息",
      rawText: "一般社交訊息",
      category: "other"
    })
  ], { relation: "acknowledgement", shouldIgnore: false }), "一般社交訊息", "ack-unknown");
  assert.equal(unknown.result.finalDecision.type, "no_reply");
  assert.equal(unknown.result.reviewCount, 0);

  const policy = await processOne(plannerOutput([
    task("policy", "ack-policy", {
      sourceText: "一般社交訊息",
      rawText: "一般社交訊息",
      category: "policy",
      canonicalCandidate: "unresolved_social_candidate"
    })
  ], { relation: "acknowledgement", shouldIgnore: false }), "一般社交訊息", "ack-policy");
  assert.equal(policy.result.finalDecision.type, "no_reply");
  assert.equal(policy.result.reviewCount, 0);
}

async function testAcknowledgementWithSubstantiveQuestion() {
  const current = await processOne(plannerOutput([
    task("unknown", "ack-prefix", {
      sourceText: "一般社交片段",
      rawText: "一般社交片段"
    }),
    task("availability", "mixed-availability", {
      sourceText: "明日房況問題",
      rawText: ""
    })
  ], {
    relation: "acknowledgement",
    shouldIgnore: true,
    rawText: "明天",
    kind: "relative"
  }), "一般社交片段加住宿問題", "ack-mixed");
  assert.equal(current.result.finalDecision.type, "reply");
  assert.equal(current.availabilityCalls.length, 1);
  assert.equal(current.availabilityCalls[0].checkIn, "2026-07-24");
  assert.deepEqual(current.result.taskResults.map((item) => item.taskId), ["mixed-availability"]);
}

async function testMislabeledRelativeDateIsCanonicalAmbiguity() {
  const current = await processOne(plannerOutput([
    task("availability", "today-availability", {
      sourceText: "相對日期房況問題",
      rawText: ""
    })
  ], {
    rawText: "今天",
    kind: "absolute",
    checkInCandidate: null
  }), "相對日期房況問題", "today-mislabeled");
  assert.equal(current.result.finalDecision.type, "clarification");
  assert.deepEqual(current.result.finalDecision.clarificationFields, ["stay.checkIn"]);
  assert.equal(current.availabilityCalls.length, 0);
  assert.equal(current.availableDatesCalls.length, 0);
  const semantic = current.diagnostics.find((item) => item.stage === "semantic_contract");
  assert.equal(semantic.semanticValidation.temporal.status, "ambiguous");
  assert.equal(semantic.semanticValidation.temporal.reasonCode, "absolute_candidate_missing");
  const temporal = current.diagnostics.find((item) => item.stage === "temporal");
  assert.equal(temporal.output.resolutionStatus, "ambiguous");
  assert.equal(temporal.output.ambiguity, "absolute_candidate_missing");

  const availableDates = await processOne(plannerOutput([
    task("available_dates", "today-available-dates", {
      sourceText: "相對日期範圍候選",
      rawText: ""
    })
  ], {
    rawText: "今天",
    kind: "absolute",
    checkInCandidate: null
  }), "相對日期範圍候選", "today-mislabeled-range");
  assert.equal(availableDates.result.finalDecision.type, "clarification");
  assert.deepEqual(availableDates.result.finalDecision.clarificationFields, ["stay.searchRange"]);
  assert.equal(availableDates.availableDatesCalls.length, 0, "an unresolved date attempt must not receive the default available-dates range");
}

async function testInvalidCurrentDateCannotReusePreviousStay() {
  const current = runtime([
    plannerOutput([
      task("availability", "initial-availability", {
        sourceText: "明確日期房況",
        rawText: ""
      })
    ], {
      rawText: "7/25",
      kind: "absolute",
      checkInCandidate: "2026-07-25"
    }),
    plannerOutput([
      task("availability", "invalid-date-availability", {
        sourceText: "無法解析日期房況",
        rawText: ""
      })
    ], {
      rawText: "7224",
      kind: "absolute"
    })
  ]);
  const first = await current.engine.process(input("previous-date", "明確日期房況"));
  assert.equal(first.finalDecision.type, "reply");
  assert.equal(current.availabilityCalls.length, 1);
  assert.equal(current.availabilityCalls[0].checkIn, "2026-07-25");

  const second = await current.engine.process(input("invalid-current-date", "無法解析日期房況"));
  assert.equal(second.finalDecision.type, "clarification");
  assert.deepEqual(second.finalDecision.clarificationFields, ["stay.checkIn"]);
  assert.equal(current.availabilityCalls.length, 1, "an unresolved current-turn date must not call Resolver with a stale date");
  assert.equal(current.availableDatesCalls.length, 0);
  assert.equal(second.state.conditions.stay.checkIn, null);
  assert.equal(second.state.conditions.stay.checkOut, null);
  assert.ok(second.state.transition.cleared.includes("stay.checkIn"));
  assert.ok(second.state.transition.cleared.includes("stay.checkOut"));
}

async function testNoDateRoomFollowUpCanReusePreviousStay() {
  const current = runtime([
    plannerOutput([
      task("availability", "initial-room-stay", {
        sourceText: "明確日期房況",
        rawText: ""
      })
    ], {
      rawText: "7/25",
      kind: "absolute",
      checkInCandidate: "2026-07-25"
    }),
    plannerOutput([
      task("availability", "room-follow-up", {
        sourceText: "房型追問",
        rawText: "雙人房",
        category: "room"
      })
    ], {
      relation: "continue",
      roomId: "room_double"
    })
  ]);
  await current.engine.process(input("room-stay-first", "明確日期房況"));
  const followUp = await current.engine.process(input("room-stay-follow-up", "房型追問"));
  assert.equal(followUp.finalDecision.type, "reply");
  assert.equal(current.availabilityCalls.length, 2);
  assert.equal(current.availabilityCalls[1].checkIn, "2026-07-25");
  assert.equal(current.availabilityCalls[1].roomType, "room_double");
}

async function testRelativeDatesAndBookingStayStable() {
  for (const [label, rawText, checkIn] of [
    ["tomorrow", "明天", "2026-07-24"],
    ["day-after", "後天", "2026-07-25"]
  ]) {
    const current = await processOne(plannerOutput([
      task("availability", `${label}-availability`, {
        sourceText: "相對日期房況",
        rawText: ""
      })
    ], {
      rawText,
      kind: "relative"
    }), "相對日期房況", label);
    assert.equal(current.result.finalDecision.type, "reply");
    assert.equal(current.availabilityCalls.length, 1);
    assert.equal(current.availabilityCalls[0].checkIn, checkIn);
  }

  const booking = await processOne(plannerOutput([
    task("availability", "booking-feasibility", {
      sourceText: "預訂可行性房況問題",
      rawText: "雙人房",
      category: "room"
    })
  ], {
    rawText: "7/25",
    kind: "absolute",
    checkInCandidate: "2026-07-25",
    roomId: "room_double",
    guests: 2
  }), "預訂可行性房況問題", "booking-feasibility");
  assert.equal(booking.result.finalDecision.type, "reply");
  assert.equal(booking.availabilityCalls.length, 1);
  assert.equal(booking.availabilityCalls[0].checkIn, "2026-07-25");
  assert.equal(booking.availabilityCalls[0].roomType, "room_double");
}

(async () => {
  await testAcknowledgementContradictions();
  await testAcknowledgementWithSubstantiveQuestion();
  await testMislabeledRelativeDateIsCanonicalAmbiguity();
  await testInvalidCurrentDateCannotReusePreviousStay();
  await testNoDateRoomFollowUpCanReusePreviousStay();
  await testRelativeDatesAndBookingStayStable();
  console.log("dialogue temporal state contract: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
