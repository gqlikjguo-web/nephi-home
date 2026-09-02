"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const EVENT_TIME = Date.parse("2026-07-27T10:00:00+08:00");
const NOW = () => new Date("2026-07-27T02:00:00.000Z");

function property(propertyId, label) {
  return {
    propertyId,
    displayName: label,
    timezone: "Asia/Taipei",
    currency: "TWD",
    rooms: [{
      id: `${propertyId}_room`,
      name: `${label} Double`,
      type: "double",
      capacity: 2,
      enabled: true
    }, {
      id: `${propertyId}_bundle`,
      name: `${label} Bundle`,
      inventoryType: "bundle",
      capacity: 2,
      enabled: true,
      memberRoomIds: [`${propertyId}_room`],
      entertainmentAmenities: [{ key: "singing", provided: true, statusSource: "operator", source: "preset", note: `${label} singing hours are 08:00-22:00.` }]
    }],
    propertyFacts: [
      {
        canonicalId: "parking",
        category: "amenity",
        status: "provided",
        publicText: `${label} parking fact.`,
        aliases: ["停車", "車位"]
      },
      {
        canonicalId: "bbq",
        category: "policy",
        status: "provided",
        publicText: `${label} barbecue fee is 1,000 TWD.`,
        aliases: ["烤肉"]
      },
      {
        canonicalId: "pool",
        category: "amenity",
        status: "provided",
        publicText: `${label} pool fact.`,
        aliases: ["戲水池"]
      },
      {
        canonicalId: "cancellation",
        category: "policy",
        status: "provided",
        publicText: `${label} cancellation conditions.`,
        aliases: ["cancellation"]
      },
      {
        canonicalId: "travel_subsidy",
        publicName: "國旅補助",
        category: "policy",
        status: "provided",
        publicText: `${label} travel subsidy policy.`,
        aliases: []
      },
      {
        canonicalId: "location",
        category: "location",
        status: "provided",
        publicText: `https://maps.google.com/?q=${propertyId}`,
        aliases: ["位置", "地址"]
      }
    ],
    semanticCatalog: {
      aliases: {
        parking: ["停車", "車位"],
        bbq: ["烤肉"],
        pool: ["戲水池"],
        location: ["位置", "地址", "民宿"]
      },
      amenities: []
    },
    commonAnswers: { bbqRule: `${label} barbecue fee is 1,000 TWD.` },
    faqs: []
  };
}

function task({
  candidateIndex = 0,
  taskId,
  type,
  sourceText,
  category,
  canonicalCandidate,
  rawText = sourceText,
  detailIntent = "general",
  requestedOutputs = ["answer"],
  dependsOnStayContext = false,
  stayCandidate = null
}) {
  return {
    candidateIndex,
    taskId,
    type,
    sourceText,
    detailIntent,
    requestedOutputs,
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext,
    entity: {
      category,
      rawText,
      canonicalCandidate,
      confidence: 0.99
    },
    stayCandidate,
    confidence: 0.99
  };
}

function plan(tasks, sourceEvent, { discourseRelation = "new_request", relationKind = "new_request", shouldIgnore = false } = {}) {
  return migrateFakePlannerOutput({
    schemaVersion: 2,
    discourse: { relation: discourseRelation, confidence: 0.99 },
    stateOperations: [],
    stay: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    },
    tasks,
    contextRelationCandidates: tasks.map((item) => {
      const startOffset = sourceEvent.messageText.indexOf(item.sourceText);
      return {
        candidateIndex: item.candidateIndex,
        kind: relationKind,
        candidateRequestCycleRefs: [],
        evidenceRefs: [{
          eventId: sourceEvent.eventId,
          messageRef: "",
          startOffset,
          endOffset: startOffset + item.sourceText.length,
          quote: item.sourceText
        }]
      };
    }),
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore,
    reason: "property_fact_routing_regression"
  });
}

async function execute({ currentProperty, message, tasks, planOptions }) {
  const states = new Map();
  const diagnostics = [];
  const persistence = {
    getConversationState: (propertyId, channelId, lineUserId) =>
      states.get(`${propertyId}:${channelId}:${lineUserId}`) || null,
    setConversationState: (propertyId, channelId, lineUserId, value) =>
      states.set(`${propertyId}:${channelId}:${lineUserId}`, value),
    appendMessageLog: (propertyId, value) => ({
      ...value,
      customerId: propertyId,
      reviewId: value.needsReview ? `review-${value.eventId}` : ""
    })
  };
  const eventId = `${currentProperty.propertyId}-${tasks.map((item) => item.taskId).join("-")}`;
  const planner = {
    classify: async (input) => plan(tasks, input.sourceEvents[0], planOptions)
  };
  const engine = new ConversationEngineV2({
    planner,
    composer: null,
    persistence,
    getProperty: (propertyId) =>
      propertyId === currentProperty.propertyId ? currentProperty : null,
    availabilityResolver: (query) => ({
      ...query,
      availabilityReliable: true,
      rooms: currentProperty.rooms,
      lineUrl: ""
    }),
    availableDatesResolver: () => ({ status: "answered", dates: [] }),
    listPriceOverrides: () => [],
    now: NOW,
    diagnosticDetail: true,
    onDiagnostic: (entry) => diagnostics.push(entry)
  });
  const result = await engine.process({
    customerId: currentProperty.propertyId,
    channelId: eventId,
    lineUserId: eventId,
    eventId,
    eventTimestamp: EVENT_TIME,
    messageText: message
  });
  return { result, diagnostics };
}

function canonicalCapabilities(diagnostics) {
  const canonical = diagnostics.find((entry) => entry.stage === "canonical_request");
  assert.ok(canonical, `canonical_request missing: ${JSON.stringify(diagnostics.map((entry) => ({ stage: entry.stage, rejectionReasons: entry.rejectionReasons || [], tasks: entry.stage === "planner" ? entry.tasks : undefined })))}`);
  return canonical.items.map((item) => item.capability);
}

function propertyFactTask(taskId, type, sourceText, category, canonicalCandidate, candidateIndex = 0) {
  return task({
    candidateIndex,
    taskId,
    type,
    sourceText,
    category,
    canonicalCandidate
  });
}

(async () => {
  const alpha = property("property_alpha", "Alpha");
  const beta = property("property_beta", "Beta");
  beta.propertyFacts = beta.propertyFacts.filter((item) => item.canonicalId !== "travel_subsidy");
  const alphaLatestArrivalText = "最晚22:00，超過請提前聯絡";
  const alphaEarlyCheckInText = "Alpha early check-in requires confirmation";
  alpha.commonAnswers = { ...alpha.commonAnswers, checkInTime: "15:00", earlyCheckInPolicy: alphaEarlyCheckInText, latestArrivalTime: alphaLatestArrivalText, checkOutTime: "11:00" };
  beta.commonAnswers = { ...beta.commonAnswers, checkInTime: "14:00", earlyCheckInPolicy: "Beta early check-in policy", latestArrivalTime: "20:00", checkOutTime: "10:00" };

  const alphaCatalog = buildPropertyCatalog(alpha);
  const alphaGeneralCheckIn = alphaCatalog.policies.find((item) => item.canonicalId === "check_in");
  const alphaEarlyCheckIn = alphaCatalog.policies.find((item) => item.canonicalId === "check_in__early_arrival_policy");
  const alphaLatestArrival = alphaCatalog.policies.find((item) => item.canonicalId === "check_in__latest_arrival_policy");
  const betaLatestArrival = buildPropertyCatalog(beta).policies.find((item) => item.canonicalId === "check_in__latest_arrival_policy");
  assert.equal(alphaGeneralCheckIn.answer, "15:00", "general check-in must remain backed only by checkInTime");
  assert.equal(alphaEarlyCheckIn.answer, alphaEarlyCheckInText, "early check-in must have its own property-scoped formal fact");
  assert.equal(buildPropertyCatalog(beta).policies.find((item) => item.canonicalId === "check_in__early_arrival_policy").answer, "Beta early check-in policy", "early check-in facts must remain property-scoped");
  assert.ok(alphaLatestArrival, "latestArrivalTime must create check_in__latest_arrival_policy");
  assert.ok(betaLatestArrival, "each property must create its own latest-arrival detail identity");
  assert.deepEqual(
    { category: alphaLatestArrival.category, status: alphaLatestArrival.status, answer: alphaLatestArrival.answer },
    { category: "policy", status: "confirmed_yes", answer: alphaLatestArrivalText },
    "latestArrivalTime must create the exact formal detail identity"
  );
  assert.equal(betaLatestArrival.answer, "20:00", "each property must retain its own latest-arrival detail");

  const latestArrival = await execute({
    currentProperty: alpha,
    message: "最晚幾點可以入住？",
    tasks: [task({
      taskId: "latest-arrival",
      type: "policy",
      sourceText: "最晚幾點可以入住？",
      category: "policy",
      canonicalCandidate: "check_in",
      detailIntent: "latest_arrival_policy"
    })]
  });
  assert.deepEqual(canonicalCapabilities(latestArrival.diagnostics), ["policy"]);
  assert.equal(latestArrival.result.taskResults[0].status, "answered");
  assert.equal(latestArrival.result.taskResults[0].facts.source, "property_catalog");
  assert.equal(latestArrival.result.taskResults[0].facts.answer, alphaLatestArrivalText);
  assert.equal(latestArrival.result.taskResults[0].facts.detailProvided, true);
  assert.equal(latestArrival.result.taskResults[0].facts.detailNeedsConfirmation, false);
  assert.equal(latestArrival.result.finalDecision.action, "reply");
  assert.equal(latestArrival.result.finalDecision.reviewRequired, false);
  assert.match(latestArrival.result.replyText, /最晚22:00，超過請提前聯絡/);

  const missingLatestProperty = property("property_missing_latest", "MissingLatest");
  missingLatestProperty.commonAnswers = { ...missingLatestProperty.commonAnswers, checkInTime: "15:00", checkOutTime: "11:00" };
  const missingLatestArrival = await execute({
    currentProperty: missingLatestProperty,
    message: "最晚幾點可以入住？",
    tasks: [task({
      taskId: "missing-latest-arrival",
      type: "policy",
      sourceText: "最晚幾點可以入住？",
      category: "policy",
      canonicalCandidate: "check_in",
      detailIntent: "latest_arrival_policy"
    })]
  });
  assert.equal(missingLatestArrival.result.taskResults[0].status, "answered");
  assert.equal(missingLatestArrival.result.taskResults[0].facts.answer, "", "general checkInTime must not substitute for the requested latest-arrival detail");
  assert.equal(missingLatestArrival.result.taskResults[0].facts.detailProvided, false);
  assert.equal(missingLatestArrival.result.taskResults[0].facts.detailNeedsConfirmation, true);
  assert.equal(missingLatestArrival.result.finalDecision.action, "reply");
  assert.equal(missingLatestArrival.result.finalDecision.reviewRequired, true);

  const parking = await execute({
    currentProperty: alpha,
    message: "有車位嗎？",
    tasks: [propertyFactTask("parking", "property_fact", "有車位嗎？", "amenity", "parking")]
  });
  assert.deepEqual(canonicalCapabilities(parking.diagnostics), ["parking"]);
  assert.equal(parking.result.taskResults[0].facts.source, "property_catalog");
  assert.equal(parking.result.finalDecision.action, "reply");

  const bbq = await execute({
    currentProperty: alpha,
    message: "可以烤肉嗎？",
    tasks: [propertyFactTask("bbq", "property_fact", "可以烤肉嗎？", "policy", "bbq")]
  });
  assert.deepEqual(
    canonicalCapabilities(bbq.diagnostics),
    ["bbq"],
    "a resolved property-scoped BBQ entity must use the Planner-provided property-fact capability"
  );
  assert.equal(bbq.result.taskResults[0].facts.source, "property_catalog");
  assert.equal(bbq.result.finalDecision.action, "reply");

  const pool = await execute({
    currentProperty: alpha,
    message: "有戲水池嗎？",
    tasks: [propertyFactTask("pool", "property_fact", "有戲水池嗎？", "amenity", "pool")]
  });
  assert.deepEqual(
    canonicalCapabilities(pool.diagnostics),
    ["pool"],
    "a resolved property-scoped pool entity must not inherit parking capability from Planner type overlap"
  );
  assert.equal(pool.result.taskResults[0].facts.source, "property_catalog");
  assert.equal(pool.result.finalDecision.action, "reply");

  const travelSubsidy = await execute({
    currentProperty: alpha,
    message: "國旅補助",
    tasks: [propertyFactTask("travel-subsidy", "policy", "國旅補助", "policy", "travel_subsidy")]
  });
  assert.deepEqual(canonicalCapabilities(travelSubsidy.diagnostics), ["policy"]);
  assert.equal(travelSubsidy.result.taskResults[0].facts.source, "property_catalog");
  assert.equal(travelSubsidy.result.taskResults[0].facts.propertyId, "property_alpha");
  assert.match(travelSubsidy.result.replyText, /Alpha travel subsidy policy\./);
  assert.equal(travelSubsidy.result.finalDecision.action, "reply");

  const missingTravelSubsidy = await execute({
    currentProperty: beta,
    message: "國旅補助",
    tasks: [propertyFactTask("travel-subsidy-missing", "policy", "國旅補助", "policy", "travel_subsidy")]
  });
  assert.equal(missingTravelSubsidy.result.finalDecision.action, "handoff");
  assert.doesNotMatch(missingTravelSubsidy.result.replyText, /Alpha travel subsidy policy\./);

  const singingHours = await execute({
    currentProperty: alpha,
    message: "singing",
    tasks: [task({
      taskId: "singing-hours",
      type: "property_fact",
      sourceText: "singing",
      category: "amenity",
      canonicalCandidate: "singing",
      detailIntent: "time"
    })]
  });
  assert.deepEqual(canonicalCapabilities(singingHours.diagnostics), ["property_fact"]);
  assert.match(singingHours.result.replyText, /08:00-22:00/, "a formal FAQ answer containing a controlled time range must be projected instead of falsely reported missing");

  const sourceBoundSingingHours = await execute({
    currentProperty: alpha,
    message: "When can guests sing?",
    tasks: [task({
      taskId: "source-bound-singing-hours",
      type: "availability",
      sourceText: "When can guests sing?",
      rawText: "",
      category: "other",
      canonicalCandidate: null,
      detailIntent: "time"
    })]
  });
  assert.deepEqual(canonicalCapabilities(sourceBoundSingingHours.diagnostics), ["availability"]);
  assert.notEqual(sourceBoundSingingHours.result.taskResults[0].status, "answered");
  assert.equal(sourceBoundSingingHours.result.finalDecision.action, "clarification");

  const bbqFee = await execute({
    currentProperty: alpha,
    message: "barbecue fee",
    tasks: [task({
      taskId: "barbecue-fee",
      type: "policy",
      sourceText: "barbecue fee",
      category: "policy",
      canonicalCandidate: "bbq",
      detailIntent: "fee"
    })]
  });
  assert.deepEqual(canonicalCapabilities(bbqFee.diagnostics), ["policy"]);
  assert.match(bbqFee.result.replyText, /1,000 TWD/, "a formal property rule containing a controlled currency amount must be projected instead of falsely reported missing");

  const noDetailProperty = property("property_no_detail", "NoDetail");
  noDetailProperty.propertyFacts.find((item) => item.canonicalId === "bbq").publicText = "A separate fee may apply.";
  noDetailProperty.rooms.find((item) => item.inventoryType === "bundle").entertainmentAmenities[0].note = "";
  const unstructuredFee = await execute({
    currentProperty: noDetailProperty,
    message: "barbecue fee",
    tasks: [task({ taskId: "unstructured-fee", type: "policy", sourceText: "barbecue fee", category: "policy", canonicalCandidate: "bbq", detailIntent: "fee" })]
  });
  assert.equal(unstructuredFee.result.taskResults[0].facts.detailNeedsConfirmation, true, "a free-text rule without a controlled currency amount must not be promoted to a fee answer");
  assert.equal(unstructuredFee.result.taskResults[0].facts.detailProvided, false);
  assert.equal(unstructuredFee.result.finalDecision.action, "reply", "rgs-003 must keep the controlled reply");
  assert.equal(unstructuredFee.result.finalDecision.reviewRequired, true, "rgs-003 must create formal review when the requested controlled detail needs confirmation");
  const unstructuredTime = await execute({
    currentProperty: noDetailProperty,
    message: "singing hours",
    tasks: [task({ taskId: "unstructured-time", type: "property_fact", sourceText: "singing hours", category: "amenity", canonicalCandidate: "singing", detailIntent: "time" })]
  });
  assert.equal(unstructuredTime.result.taskResults[0].facts.detailNeedsConfirmation, true, "a FAQ answer without a controlled clock time must not be promoted to an hours answer");
  assert.equal(unstructuredTime.result.taskResults[0].facts.detailProvided, false);

  const mergedUnknownMessage = "我們想烤肉，也可以代訂食材嗎？";
  const mergedUnknown = await execute({
    currentProperty: alpha,
    message: mergedUnknownMessage,
    tasks: [task({
      taskId: "merged-unknown",
      type: "unknown",
      sourceText: mergedUnknownMessage,
      category: "other",
      canonicalCandidate: null
    })]
  });
  assert.deepEqual(canonicalCapabilities(mergedUnknown.diagnostics), ["unknown"]);
  assert.deepEqual(mergedUnknown.result.taskResults.map((item) => item.status), ["needs_human"]);
  assert.doesNotMatch(mergedUnknown.result.replyText, /barbecue fee is 1,000 TWD/, "core must not synthesize a catalog subtask omitted by the Planner");
  assert.equal(mergedUnknown.result.finalDecision.action, "handoff");
  assert.equal(mergedUnknown.result.claimValidation.ok, true);
  assert.deepEqual(mergedUnknown.result.claimValidation.missingTaskIds, []);

  const substantiveAcknowledgement = await execute({
    currentProperty: alpha,
    message: "payment confirmation",
    tasks: [task({
      taskId: "payment-confirmation",
      type: "unknown",
      sourceText: "payment confirmation",
      category: "other",
      canonicalCandidate: null
    })],
    planOptions: { discourseRelation: "acknowledgement", shouldIgnore: false }
  });
  assert.deepEqual(canonicalCapabilities(substantiveAcknowledgement.diagnostics), ["unknown"]);
  assert.equal(substantiveAcknowledgement.result.finalDecision.action, "handoff", "a substantive acknowledgement-labeled task must reach a controlled handoff instead of no_reply");
  assert.notEqual(substantiveAcknowledgement.result.finalDecision.reasonCode, "no_reply_gate_hit");

  const substantiveNotifications = [
    { id: "payment-notification", message: "已匯款", category: "payment", canonicalCandidate: "payment" },
    { id: "booking-notification", message: "訂房資料已送出", category: "other", canonicalCandidate: null },
    { id: "refund-notification", message: "退款資料已送出", category: "payment", canonicalCandidate: "payment" },
    { id: "cancellation-notification", message: "取消申請已送出", category: "cancellation", canonicalCandidate: "cancellation" }
  ];
  for (const fixture of substantiveNotifications) {
    const result = await execute({
      currentProperty: alpha,
      message: fixture.message,
      tasks: [task({
        taskId: fixture.id,
        type: "unknown",
        sourceText: fixture.message,
        category: fixture.category,
        canonicalCandidate: fixture.canonicalCandidate
      })],
      planOptions: { discourseRelation: "acknowledgement", relationKind: "new_request", shouldIgnore: true }
    });
    assert.equal(result.result.finalDecision.action, "handoff", `${fixture.id} must not be silenced by contradictory acknowledgement metadata`);
    assert.notEqual(result.result.replyText, "", `${fixture.id} must produce a controlled reply`);
    assert.doesNotMatch(result.result.replyText, /已收到款項|已完成訂房|已保留房間|已完成退款|已完成取消/);
  }

  const pureAcknowledgement = await execute({
    currentProperty: alpha,
    message: "OK",
    tasks: [task({
      taskId: "pure-acknowledgement",
      type: "unknown",
      sourceText: "OK",
      category: "other",
      canonicalCandidate: null
    })],
    planOptions: { discourseRelation: "acknowledgement", relationKind: "relation_uncertain", shouldIgnore: true }
  });
  assert.equal(pureAcknowledgement.result.finalDecision.action, "no_reply");
  assert.equal(pureAcknowledgement.result.replyText, "");

  const policyCandidateWithAmenityShape = await execute({
    currentProperty: alpha,
    message: "cancellation conditions",
    tasks: [task({
      taskId: "policy-conditions",
      type: "amenity",
      sourceText: "cancellation conditions",
      category: "policy",
      canonicalCandidate: "cancellation",
      detailIntent: "conditions",
      requestedOutputs: ["conditions"]
    })]
  });
  assert.deepEqual(canonicalCapabilities(policyCandidateWithAmenityShape.diagnostics), ["unknown"]);
  assert.equal(policyCandidateWithAmenityShape.result.finalDecision.action, "handoff", "an incompatible Planner capability must fail closed instead of being repaired from catalog aliases");
  assert.equal(policyCandidateWithAmenityShape.result.claimValidation.ok, true);
  assert.equal(policyCandidateWithAmenityShape.result.finalDecision.reasonCode, "unknown");

  const location = await execute({
    currentProperty: alpha,
    message: "民宿在哪裡？",
    tasks: [propertyFactTask("location", "property_fact", "民宿在哪裡？", "transport", "location")]
  });
  assert.deepEqual(canonicalCapabilities(location.diagnostics), ["location"]);
  assert.equal(location.result.finalDecision.action, "reply");

  const stayCandidate = {
    dateExpression: { rawText: "7/28", kind: "absolute", anchor: "message_time" },
    checkInCandidate: "2026-07-28",
    checkOutCandidate: null,
    nightsCandidate: 1,
    guestCountCandidate: null
  };
  const mixed = await execute({
    currentProperty: alpha,
    message: "7/28 有房嗎？可以烤肉嗎？有車位嗎？",
    tasks: [
      task({
        candidateIndex: 0,
        taskId: "availability",
        type: "availability",
        sourceText: "7/28 有房嗎？",
        category: "other",
        canonicalCandidate: null,
        requestedOutputs: ["availability"],
        dependsOnStayContext: true,
        stayCandidate
      }),
      propertyFactTask("mixed-bbq", "policy", "可以烤肉嗎？", "policy", "bbq", 1),
      task({
        candidateIndex: 2,
        taskId: "mixed-parking",
        type: "amenity",
        sourceText: "有車位嗎？",
        category: "amenity",
        canonicalCandidate: "parking"
      })
    ]
  });
  assert.deepEqual(
    mixed.result.taskResults.map((item) => item.status),
    ["answered", "answered", "answered"]
  );
  assert.equal(mixed.result.finalDecision.action, "reply");

  for (const [currentProperty, ownLabel, foreignLabel] of [
    [alpha, "Alpha", "Beta"],
    [beta, "Beta", "Alpha"]
  ]) {
    const scoped = await execute({
      currentProperty,
      message: "有車位嗎？",
      tasks: [propertyFactTask("scoped-parking", "property_fact", "有車位嗎？", "amenity", "parking")]
    });
    assert.equal(scoped.result.replyText.includes(`${ownLabel} parking fact.`), true);
    assert.equal(scoped.result.replyText.includes(`${foreignLabel} parking fact.`), false);
  }

  const unknown = await execute({
    currentProperty: alpha,
    message: "有未知設施嗎？",
    tasks: [propertyFactTask("unknown", "property_fact", "有未知設施嗎？", "other", null)]
  });
  assert.equal(unknown.result.finalDecision.action, "handoff");
  assert.equal(unknown.result.replyText.includes("Alpha parking fact."), false);
  assert.equal(unknown.result.replyText.includes("Alpha barbecue fact."), false);
  assert.equal(unknown.result.replyText.includes("Alpha pool fact."), false);

  console.log(JSON.stringify({ caseCount: 23, passCount: 23, failCount: 0 }));
  console.log("property fact routing regression: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
