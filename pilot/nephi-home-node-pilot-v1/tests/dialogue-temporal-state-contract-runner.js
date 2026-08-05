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
  return {
    candidateIndex: options.candidateIndex === undefined ? 0 : options.candidateIndex,
    taskId,
    type,
    sourceText: options.sourceText || taskId,
    detailIntent: options.detailIntent || "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: options.dependsOnStayContext === undefined
      ? new Set(["availability", "available_dates", "bundle_availability", "room_options", "capacity", "price", "total_price"]).has(type)
      : options.dependsOnStayContext,
    entity: {
      category: options.category || (type === "amenity" ? "amenity" : type === "policy" ? "policy" : type === "property_fact" ? "other" : "other"),
      rawText: options.rawText === undefined ? "" : options.rawText,
      canonicalCandidate: options.canonicalCandidate === undefined ? null : options.canonicalCandidate,
      confidence: 0.99
    },
    stayCandidate: null,
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
    ...(options.contextRelationKind ? { testContextRelationKind: options.contextRelationKind } : {}),
    schemaVersion: 2,
    discourse: { relation: options.relation || "new_request", confidence: 0.99 },
    stateOperations,
    stay: {
      dateExpression: { rawText, kind, anchor },
      checkInCandidate: options.checkInCandidate || null,
      checkOutCandidate: null,
      nightsCandidate: options.nights || null,
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

function bindPlanToSource(output, sourceEvents, contextSnapshot) {
  const source = sourceEvents[0];
  const contextCycle = contextSnapshot && Array.isArray(contextSnapshot.cycles)
    ? contextSnapshot.cycles.at(-1)
    : null;
  const referencesContext = ["continue", "modify", "answer_clarification"].includes(output.discourse.relation);
  const forcedContextRelationKind = output.testContextRelationKind || "";
  delete output.testContextRelationKind;
  output.tasks = output.tasks.map((item, index) => ({
    ...item,
    candidateIndex: index,
    stayCandidate: item.dependsOnStayContext ? { ...output.stay } : null
  }));
  output.contextRelationCandidates = output.tasks.map((item) => ({
    candidateIndex: item.candidateIndex,
    kind: forcedContextRelationKind || (item.type === "unknown"
      ? "relation_uncertain"
      : output.discourse.relation === "modify"
        ? "modify_existing"
        : ["continue", "answer_clarification"].includes(output.discourse.relation)
          ? "supplement_existing"
          : output.discourse.relation === "acknowledgement"
            ? "relation_uncertain"
            : "new_request"),
    candidateRequestCycleRefs: referencesContext && contextCycle ? [contextCycle.requestCycleId] : [],
    evidenceRefs: [{
      eventId: source.eventId,
      messageRef: source.messageRef || "",
      startOffset: 0,
      endOffset: source.messageText.length,
      quote: source.messageText
    }]
  }));
  return output;
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
    planner: { classify: async ({ sourceEvents, contextSnapshot }) => bindPlanToSource(outputs.shift(), sourceEvents, contextSnapshot) },
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
  assert.equal(propertyFact.result.finalDecision.action, "no_reply", JSON.stringify({
    finalDecision: propertyFact.result.finalDecision,
    finalResponse: propertyFact.result.finalResponse,
    diagnostics: propertyFact.diagnostics
  }));
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
  assert.equal(unknown.result.finalDecision.action, "no_reply");
  assert.equal(unknown.result.reviewCount, 0);

  const substantiveUnknown = await processOne(plannerOutput([
    task("unknown", "verification-required", {
      sourceText: "A completed action needs verification",
      rawText: "completed action",
      category: "other",
      detailIntent: "missing_information"
    })
  ], { relation: "acknowledgement", shouldIgnore: false }), "A completed action needs verification", "ack-substantive-unknown");
  assert.equal(substantiveUnknown.result.finalDecision.action, "handoff", "an acknowledgement-shaped task that still carries a substantive missing-information intent must fail closed instead of being silenced");
  assert.equal(substantiveUnknown.result.finalResponse.shouldReply, true);
  assert.notEqual(substantiveUnknown.result.finalResponse.replyText, "");

  const invalidEndRelation = await processOne(plannerOutput([
    task("unknown", "ack-invalid-end", {
      sourceText: "Understood",
      rawText: "Understood",
      category: "other"
    })
  ], {
    relation: "acknowledgement",
    shouldIgnore: true,
    contextRelationKind: "end_existing"
  }), "Understood", "ack-invalid-end");
  assert.equal(invalidEndRelation.result.finalDecision.action, "no_reply", JSON.stringify({
    finalDecision: invalidEndRelation.result.finalDecision,
    diagnostics: invalidEndRelation.diagnostics
  }));
  assert.equal(invalidEndRelation.result.reviewCount, 0);
  const invalidEndContext = invalidEndRelation.diagnostics.find((item) => item.stage === "context_validation");
  assert.deepEqual(invalidEndContext.rejectionReasons, []);
  assert.equal(invalidEndContext.candidates[0].relationKind, "relation_uncertain");

  const contradictoryHumanHelp = await processOne(plannerOutput([
    task("human_help", "ack-human-help", {
      sourceText: "Acknowledged",
      rawText: "Acknowledged",
      category: "other"
    })
  ], {
    relation: "acknowledgement",
    shouldIgnore: true,
    contextRelationKind: "end_existing"
  }), "Acknowledged", "ack-human-help");
  assert.equal(contradictoryHumanHelp.result.finalDecision.action, "no_reply", "an ignored acknowledgement must not become a human handoff solely because its generic task type contradicts the Planner dialogue act");
  const contradictorySemantic = contradictoryHumanHelp.diagnostics.find((item) => item.stage === "semantic_contract");
  assert.deepEqual(contradictorySemantic.outputTasks.map((item) => item.type), ["unknown"]);

  const substantiveHumanHelp = await processOne(plannerOutput([
    task("human_help", "explicit-human-help", {
      sourceText: "Operator assistance is required",
      rawText: "Operator assistance",
      category: "other"
    })
  ], { relation: "acknowledgement", shouldIgnore: false }), "Operator assistance is required", "explicit-human-help");
  assert.equal(substantiveHumanHelp.result.finalDecision.action, "handoff", "a substantive human-help task must remain actionable when the Planner did not mark the turn ignorable");

  const malformedIgnoredHumanHelpPlan = plannerOutput([
    task("human_help", "malformed-ignored-human-help", {
      sourceText: "Thanks",
      rawText: "Thanks",
      category: "other"
    })
  ], { relation: "acknowledgement", shouldIgnore: true });
  malformedIgnoredHumanHelpPlan.tasks[0].entity.category = "";
  const malformedIgnoredHumanHelp = await processOne(
    malformedIgnoredHumanHelpPlan,
    "Thanks",
    "ack-malformed-human-help"
  );
  assert.equal(malformedIgnoredHumanHelp.result.finalDecision.action, "no_reply", "a malformed generic task must not override an explicit ignored-acknowledgement dialogue act before semantic compilation");
  assert.equal(malformedIgnoredHumanHelp.result.reviewCount, 0);

  const malformedIgnoredUnknownPlan = plannerOutput([
    task("unknown", "malformed-ignored-unknown", {
      sourceText: "OK emoji",
      rawText: "OK emoji",
      category: "other"
    })
  ], { relation: "acknowledgement", shouldIgnore: true });
  malformedIgnoredUnknownPlan.tasks[0].entity.category = "";
  const malformedIgnoredUnknown = await processOne(
    malformedIgnoredUnknownPlan,
    "OK emoji",
    "ack-malformed-unknown"
  );
  assert.equal(malformedIgnoredUnknown.result.finalDecision.action, "no_reply", "a malformed unknown acknowledgement fragment must be normalized instead of escalating to handoff");
  assert.equal(malformedIgnoredUnknown.result.reviewCount, 0);

  const policy = await processOne(plannerOutput([
    task("policy", "ack-policy", {
      sourceText: "一般社交訊息",
      rawText: "一般社交訊息",
      category: "policy",
      canonicalCandidate: "unresolved_social_candidate"
    })
  ], { relation: "acknowledgement", shouldIgnore: false }), "一般社交訊息", "ack-policy");
  assert.equal(policy.result.finalDecision.action, "no_reply");
  assert.equal(policy.result.reviewCount, 0);
}

async function testAcknowledgementWithSubstantiveQuestion() {
  const current = await processOne(plannerOutput([
    task("unknown", "ack-prefix", {
      sourceText: "一般社交片段",
      rawText: "一般社交片段"
    }),
    task("availability", "mixed-availability", {
      sourceText: "明天有房嗎",
      rawText: ""
    })
  ], {
    relation: "acknowledgement",
    shouldIgnore: true,
    rawText: "明天",
    kind: "relative",
    nights: 1
  }), "一般社交片段，明天有房嗎？", "ack-mixed");
  assert.equal(current.result.finalDecision.action, "reply", JSON.stringify({
    finalDecision: current.result.finalDecision,
    diagnostics: current.diagnostics
  }));
  assert.equal(current.availabilityCalls.length, 1);
  assert.equal(current.availabilityCalls[0].checkIn, "2026-07-24");
  assert.deepEqual(current.result.taskResults.map((item) => item.taskId), ["mixed-availability"]);
}

async function testMislabeledRelativeDateUsesCanonicalGrammar() {
  const current = await processOne(plannerOutput([
    task("availability", "today-availability", {
      sourceText: "今天有房嗎",
      rawText: ""
    })
  ], {
    rawText: "今天",
    kind: "absolute",
    checkInCandidate: null
  }), "今天有房嗎？", "today-mislabeled");
  assert.equal(current.result.finalDecision.action, "reply");
  assert.equal(current.availabilityCalls.length, 1);
  assert.equal(current.availabilityCalls[0].checkIn, "2026-07-23");
  assert.equal(current.availabilityCalls[0].checkOut, "2026-07-24");
  assert.equal(current.availableDatesCalls.length, 0);
  const temporal = current.diagnostics.find((item) => item.stage === "temporal");
  const temporalItem = temporal.items.find((item) => item.taskIds.includes("today-availability"));
  assert.equal(temporalItem.resolutionStatus, "resolved");
  assert.equal(temporalItem.fields.checkIn.value, "2026-07-23");
  assert.equal(temporalItem.fields.checkOut.value, "2026-07-24");

  const availableDates = await processOne(plannerOutput([
    task("available_dates", "today-available-dates", {
      sourceText: "今天有哪些日期有房",
      rawText: ""
    })
  ], {
    rawText: "今天",
    kind: "absolute",
    checkInCandidate: null
  }), "今天有哪些日期有房？", "today-mislabeled-range");
  assert.equal(availableDates.result.finalDecision.action, "clarification");
  assert.deepEqual(availableDates.result.finalDecision.missingFields, ["checkOut"]);
  assert.equal(availableDates.availabilityCalls.length, 0);
  assert.equal(availableDates.availableDatesCalls.length, 0, "an unresolved date attempt must not receive the default available-dates range");
}

async function testInvalidCurrentDateCannotReusePreviousStay() {
  const current = runtime([
    plannerOutput([
      task("availability", "initial-availability", {
        sourceText: "7/25有房嗎",
        rawText: ""
      })
    ], {
      rawText: "7/25",
      kind: "absolute",
      checkInCandidate: "2026-07-25",
      nights: 1
    }),
    plannerOutput([
      task("availability", "invalid-date-availability", {
        sourceText: "7224有房嗎",
        rawText: ""
      })
    ], {
      rawText: "7224",
      kind: "absolute"
    })
  ]);
  const first = await current.engine.process(input("previous-date", "7/25有房嗎？"));
  assert.equal(first.finalDecision.action, "reply");
  assert.equal(current.availabilityCalls.length, 1);
  assert.equal(current.availabilityCalls[0].checkIn, "2026-07-25");

  const second = await current.engine.process(input("invalid-current-date", "7224有房嗎？"));
  assert.equal(second.finalDecision.action, "clarification");
  assert.deepEqual(second.finalDecision.missingFields, ["checkIn", "checkOut"]);
  assert.equal(current.availabilityCalls.length, 1, "an unresolved current-turn date must not call Resolver with a stale date");
  assert.equal(current.availableDatesCalls.length, 0);
  const invalidTask = second.state.tasks.find((item) => item.taskId === "invalid-date-availability");
  assert.ok(invalidTask, JSON.stringify(second.state));
  assert.equal(invalidTask.checkIn, null);
  assert.equal(invalidTask.checkOut, null);
  assert.deepEqual(invalidTask.missingFields, ["checkIn", "checkOut"]);
}

async function testNoDateRoomFollowUpCanReusePreviousStay() {
  const current = runtime([
    plannerOutput([
      task("availability", "initial-room-stay", {
        sourceText: "7/25有房嗎",
        rawText: ""
      })
    ], {
      rawText: "7/25",
      kind: "absolute",
      checkInCandidate: "2026-07-25",
      nights: 1
    }),
    plannerOutput([
      task("availability", "room-follow-up", {
        sourceText: "雙人房還有嗎",
        rawText: "雙人房",
        category: "room",
        canonicalCandidate: "room_double"
      })
    ], {
      relation: "continue",
      roomId: "room_double"
    })
  ]);
  await current.engine.process(input("room-stay-first", "7/25有房嗎？"));
  const followUp = await current.engine.process(input("room-stay-follow-up", "雙人房還有嗎？"));
  assert.equal(followUp.finalDecision.action, "reply", JSON.stringify({
    finalDecision: followUp.finalDecision,
    diagnostics: current.diagnostics
  }));
  assert.equal(current.availabilityCalls.length, 2);
  assert.equal(current.availabilityCalls[1].checkIn, "2026-07-25");
  assert.equal(current.availabilityCalls[1].roomType, "room_double", JSON.stringify({
    query: current.availabilityCalls[1],
    state: followUp.state,
    diagnostics: current.diagnostics.filter((item) => item.eventId === "room-stay-follow-up")
  }));
}

async function testRelativeDatesAndBookingStayStable() {
  for (const [label, rawText, checkIn] of [
    ["tomorrow", "明天", "2026-07-24"],
    ["day-after", "後天", "2026-07-25"]
  ]) {
    const current = await processOne(plannerOutput([
      task("availability", `${label}-availability`, {
        sourceText: `${rawText}有房嗎`,
        rawText: ""
      })
    ], {
      rawText,
      kind: "relative",
      nights: 1
    }), `${rawText}有房嗎？`, label);
    assert.equal(current.result.finalDecision.action, "reply");
    assert.equal(current.availabilityCalls.length, 1);
    assert.equal(current.availabilityCalls[0].checkIn, checkIn);
  }

  const booking = await processOne(plannerOutput([
    task("availability", "booking-feasibility", {
      sourceText: "7/25雙人房2位有房嗎",
      rawText: "雙人房",
      category: "room",
      canonicalCandidate: "room_double"
    })
  ], {
    rawText: "7/25",
    kind: "absolute",
    checkInCandidate: "2026-07-25",
    nights: 1,
    roomId: "room_double",
    guests: 2
  }), "7/25雙人房2位有房嗎？", "booking-feasibility");
  assert.equal(booking.result.finalDecision.action, "reply");
  assert.equal(booking.availabilityCalls.length, 1);
  assert.equal(booking.availabilityCalls[0].checkIn, "2026-07-25");
  assert.equal(booking.availabilityCalls[0].roomType, "room_double");
}

(async () => {
  await testAcknowledgementContradictions();
  await testAcknowledgementWithSubstantiveQuestion();
  await testMislabeledRelativeDateUsesCanonicalGrammar();
  await testInvalidCurrentDateCannotReusePreviousStay();
  await testNoDateRoomFollowUpCanReusePreviousStay();
  await testRelativeDatesAndBookingStayStable();
  console.log("dialogue temporal state contract: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
