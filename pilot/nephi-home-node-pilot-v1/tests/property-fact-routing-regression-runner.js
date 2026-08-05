"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");

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
    faqs: [{ knowledgeKey: "singing", question: "When can guests sing?", answer: `${label} singing hours are 08:00-22:00.` }]
  };
}

function task({
  candidateIndex = 0,
  taskId,
  type,
  sourceText,
  category,
  canonicalCandidate,
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
      rawText: sourceText,
      canonicalCandidate,
      confidence: 0.99
    },
    stayCandidate,
    confidence: 0.99
  };
}

function plan(tasks, sourceEvent) {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
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
        kind: "new_request",
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
    shouldIgnore: false,
    reason: "property_fact_routing_regression"
  };
}

async function execute({ currentProperty, message, tasks }) {
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
    classify: async (input) => plan(tasks, input.sourceEvents[0])
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
  return diagnostics
    .find((entry) => entry.stage === "canonical_request")
    .items.map((item) => item.capability);
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

  const parking = await execute({
    currentProperty: alpha,
    message: "有車位嗎？",
    tasks: [propertyFactTask("parking", "availability", "有車位嗎？", "amenity", "parking")]
  });
  assert.deepEqual(canonicalCapabilities(parking.diagnostics), ["parking"]);
  assert.equal(parking.result.taskResults[0].facts.source, "property_catalog");
  assert.equal(parking.result.finalDecision.action, "reply");

  const bbq = await execute({
    currentProperty: alpha,
    message: "可以烤肉嗎？",
    tasks: [propertyFactTask("bbq", "availability", "可以烤肉嗎？", "policy", "bbq")]
  });
  assert.deepEqual(
    canonicalCapabilities(bbq.diagnostics),
    ["bbq"],
    "a resolved property-scoped BBQ entity must not become unknown solely because the Planner used availability"
  );
  assert.equal(bbq.result.taskResults[0].facts.source, "property_catalog");
  assert.equal(bbq.result.finalDecision.action, "reply");

  const pool = await execute({
    currentProperty: alpha,
    message: "有戲水池嗎？",
    tasks: [propertyFactTask("pool", "availability", "有戲水池嗎？", "amenity", "pool")]
  });
  assert.deepEqual(
    canonicalCapabilities(pool.diagnostics),
    ["pool"],
    "a resolved property-scoped pool entity must not inherit parking capability from Planner type overlap"
  );
  assert.equal(pool.result.taskResults[0].facts.source, "property_catalog");
  assert.equal(pool.result.finalDecision.action, "reply");

  const singingHours = await execute({
    currentProperty: alpha,
    message: "singing hours",
    tasks: [task({
      taskId: "singing-hours",
      type: "availability",
      sourceText: "singing hours",
      category: "amenity",
      canonicalCandidate: "singing",
      detailIntent: "time"
    })]
  });
  assert.deepEqual(canonicalCapabilities(singingHours.diagnostics), ["property_fact"]);
  assert.match(singingHours.result.replyText, /08:00-22:00/, "a formal FAQ answer containing a controlled time range must be projected instead of falsely reported missing");

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
  noDetailProperty.faqs.find((item) => item.knowledgeKey === "singing").answer = "Singing equipment is available.";
  const unstructuredFee = await execute({
    currentProperty: noDetailProperty,
    message: "barbecue fee",
    tasks: [task({ taskId: "unstructured-fee", type: "policy", sourceText: "barbecue fee", category: "policy", canonicalCandidate: "bbq", detailIntent: "fee" })]
  });
  assert.equal(unstructuredFee.result.taskResults[0].facts.detailNeedsConfirmation, true, "a free-text rule without a controlled currency amount must not be promoted to a fee answer");
  assert.equal(unstructuredFee.result.taskResults[0].facts.detailProvided, false);
  const unstructuredTime = await execute({
    currentProperty: noDetailProperty,
    message: "singing hours",
    tasks: [task({ taskId: "unstructured-time", type: "availability", sourceText: "singing hours", category: "amenity", canonicalCandidate: "singing", detailIntent: "time" })]
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
  assert.deepEqual(canonicalCapabilities(mergedUnknown.diagnostics), ["unknown", "bbq"]);
  assert.deepEqual(mergedUnknown.result.taskResults.map((item) => item.status), ["needs_human", "answered"]);
  assert.match(mergedUnknown.result.replyText, /barbecue fee is 1,000 TWD/, "the formal catalog subtask must survive a merged unknown Planner task");
  assert.equal(mergedUnknown.result.finalDecision.action, "reply");
  assert.equal(mergedUnknown.result.claimValidation.ok, true);
  assert.deepEqual(mergedUnknown.result.claimValidation.missingTaskIds, []);

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
      tasks: [propertyFactTask("scoped-parking", "availability", "有車位嗎？", "amenity", "parking")]
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

  console.log(JSON.stringify({ caseCount: 13, passCount: 13, failCount: 0 }));
  console.log("property fact routing regression: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
