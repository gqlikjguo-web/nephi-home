"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");

const EVENT_TIMESTAMP = Date.parse("2026-07-29T10:00:00+08:00");
const NOW = () => new Date("2026-07-29T02:00:00.000Z");
const EMPTY_STAY = Object.freeze({
  dateExpression: { rawText: "", kind: "none", anchor: "none" },
  checkInCandidate: null,
  checkOutCandidate: null,
  nightsCandidate: null,
  guestCountCandidate: null
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function property(propertyId, label) {
  return {
    propertyId,
    displayName: label,
    timezone: "Asia/Taipei",
    currency: "TWD",
    businessProfile: {
      googleMapsUrl: `https://maps.google.com/?q=${propertyId}`
    },
    rooms: [{
      id: `${propertyId}_room`,
      name: `${label} Room`,
      type: "double",
      capacity: 2,
      enabled: true
    }],
    propertyFacts: [
      {
        canonicalId: "pool",
        category: "amenity",
        status: "provided",
        publicText: `${label} pool fact.`
      },
      {
        canonicalId: "bbq",
        category: "amenity",
        status: "provided",
        publicText: `${label} barbecue fact.`
      }
    ],
    semanticCatalog: {
      aliases: {
        pool: ["戲水池", "游泳池", "pool"],
        bbq: ["烤肉", "bbq"],
        location: ["民宿位置", "民宿在哪裡", "location"]
      },
      amenities: []
    },
    commonAnswers: {}
  };
}

function plannerTask({
  taskId,
  type,
  sourceText,
  rawText,
  category,
  canonicalCandidate,
  detailIntent = "general",
  requestedOutputs = ["answer"],
  eligibilityEvidence = { kind: "none", sourceText: "" },
  dependsOnStayContext = false,
  stayCandidate = null
}) {
  return {
    candidateIndex: 0,
    taskId,
    type,
    sourceText,
    detailIntent,
    requestedOutputs,
    eligibilityEvidence,
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

function plan(task, sourceEvent) {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: clone(EMPTY_STAY),
    tasks: [task],
    contextRelationCandidates: [{
      candidateIndex: 0,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [{
        eventId: sourceEvent.eventId,
        messageRef: "",
        startOffset: 0,
        endOffset: sourceEvent.messageText.length,
        quote: sourceEvent.messageText
      }]
    }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "core_90_limited_regression"
  };
}

function memoryPersistence() {
  const states = new Map();
  return {
    getConversationState: (propertyId, channelId, lineUserId) =>
      states.get(`${propertyId}:${channelId}:${lineUserId}`) || null,
    setConversationState: (propertyId, channelId, lineUserId, value) =>
      states.set(`${propertyId}:${channelId}:${lineUserId}`, clone(value)),
    appendMessageLog: (propertyId, value) => ({
      ...value,
      customerId: propertyId,
      reviewId: value.needsReview ? `review-${value.eventId}` : ""
    })
  };
}

async function execute({
  currentProperty,
  message,
  task,
  rejectComposer = false
}) {
  const diagnostics = [];
  const eventId = `${currentProperty.propertyId}-${task.taskId}`;
  const engine = new ConversationEngineV2({
    planner: {
      classify: async ({ sourceEvents }) => plan(task, sourceEvents[0])
    },
    composer: rejectComposer ? {
      compose: async () => ({
        sections: [{
          taskId: task.taskId,
          responseMode: "answer",
          text: "已通知業者，並保證可以使用。"
        }]
      })
    } : null,
    persistence: memoryPersistence(),
    getProperty: (propertyId) =>
      propertyId === currentProperty.propertyId ? currentProperty : null,
    availabilityResolver: () => {
      throw new Error("property fact must not call availability resolver");
    },
    availableDatesResolver: () => {
      throw new Error("property fact must not call available-dates resolver");
    },
    listPriceOverrides: () => [],
    now: NOW,
    diagnosticDetail: true,
    onDiagnostic: (entry) => diagnostics.push(clone(entry))
  });
  const result = await engine.process({
    customerId: currentProperty.propertyId,
    channelId: eventId,
    lineUserId: eventId,
    eventId,
    eventTimestamp: EVENT_TIMESTAMP,
    messageText: message
  });
  const stage = (name) =>
    diagnostics.find((entry) => entry.stage === name) || null;
  return { result, diagnostics, stage };
}

async function deterministicFallbackClearsRejectedComposerState() {
  const currentProperty = property("property_fallback", "Fallback Lodge");
  const trace = await execute({
    currentProperty,
    message: "有游泳池嗎？",
    task: plannerTask({
      taskId: "fallback-pool",
      type: "amenity",
      sourceText: "有游泳池嗎？",
      rawText: "游泳池",
      category: "amenity",
      canonicalCandidate: "pool"
    }),
    rejectComposer: true
  });
  assert.equal(trace.stage("composer").validationResult, "rejected");
  assert.equal(trace.stage("composer").fallbackOccurred, true);
  assert.equal(trace.result.claimValidation.ok, true);
  assert.equal(trace.result.replyText, "Fallback Lodge pool fact.");
  assert.equal(
    trace.result.finalDecision.action,
    "reply",
    "a rejected Composer candidate must not survive a successful deterministic fallback"
  );
  assert.equal(trace.result.finalDecision.reviewRequired, false);
}

async function poolRoutingUsesGroundedPropertyCatalog() {
  for (const [propertyId, label, rawText] of [
    ["property_pool_alpha", "Pool Alpha", "戲水池"],
    ["property_pool_beta", "Pool Beta", "游泳池"]
  ]) {
    const currentProperty = property(propertyId, label);
    const wrongCandidate = await execute({
      currentProperty,
      message: `有${rawText}嗎？`,
      task: plannerTask({
        taskId: "pool-wrong-candidate",
        type: "amenity",
        sourceText: `有${rawText}嗎？`,
        rawText,
        category: "amenity",
        canonicalCandidate: "bbq"
      })
    });
    const wrongCanonical = wrongCandidate.stage("canonical_request").items[0];
    assert.equal(wrongCanonical.capability, "pool");
    assert.equal(wrongCanonical.canonicalEntity.canonicalId, "pool");
    assert.equal(wrongCandidate.result.replyText, `${label} pool fact.`);
    assert.equal(wrongCandidate.result.replyText.includes("barbecue"), false);

    const missingCandidate = await execute({
      currentProperty,
      message: `有${rawText}嗎？`,
      task: plannerTask({
        taskId: "pool-missing-candidate",
        type: "availability",
        sourceText: `有${rawText}嗎？`,
        rawText,
        category: "room",
        canonicalCandidate: null
      })
    });
    const missingCanonical = missingCandidate.stage("canonical_request").items[0];
    assert.equal(missingCanonical.capability, "pool");
    assert.equal(missingCanonical.canonicalEntity.canonicalId, "pool");
    assert.equal(missingCandidate.result.replyText, `${label} pool fact.`);
  }

  const detailedProperty = property("property_pool_details", "Pool Details");
  for (const [taskId, detailIntent, sourceText, eligibilityEvidence] of [
    [
      "pool-explicit-eligibility",
      "eligibility",
      "小朋友可以使用戲水池嗎？",
      { kind: "person", sourceText: "小朋友" }
    ],
    [
      "pool-fee",
      "fee",
      "戲水池費用多少？",
      { kind: "none", sourceText: "" }
    ]
  ]) {
    const detailed = await execute({
      currentProperty: detailedProperty,
      message: sourceText,
      task: plannerTask({
        taskId,
        type: "amenity",
        sourceText,
        rawText: "戲水池",
        category: "amenity",
        canonicalCandidate: "bbq",
        detailIntent,
        requestedOutputs: [detailIntent],
        eligibilityEvidence
      })
    });
    const semanticTask = detailed.stage("semantic_contract").outputTasks[0];
    assert.equal(
      semanticTask.detailIntent,
      detailIntent,
      "catalog grounding must not erase a valid detail-specific request"
    );
    assert.equal(detailed.stage("canonical_request").items[0].detailIntent, detailIntent);
  }

  const ambiguousProperty = property("property_pool_ambiguous", "Pool Ambiguous");
  ambiguousProperty.semanticCatalog.aliases.pool = ["共同設施"];
  ambiguousProperty.semanticCatalog.aliases.bbq = ["共同設施"];
  const ambiguous = await execute({
    currentProperty: ambiguousProperty,
    message: "共同設施可以使用嗎？",
    task: plannerTask({
      taskId: "pool-ambiguous",
      type: "availability",
      sourceText: "共同設施可以使用嗎？",
      rawText: "共同設施",
      category: "room",
      canonicalCandidate: null
    })
  });
  const ambiguousCanonical = ambiguous.stage("canonical_request").items[0];
  assert.notEqual(ambiguousCanonical.capability, "pool");
  assert.equal(ambiguousCanonical.canonicalEntity.canonicalId, null);
  assert.equal(ambiguous.result.replyText.includes("Pool Ambiguous pool fact."), false);
  assert.equal(ambiguous.result.replyText.includes("Pool Ambiguous barbecue fact."), false);
}

async function locationFailureStageIsComposerFallbackState() {
  const currentProperty = property("property_location", "Location Lodge");
  const trace = await execute({
    currentProperty,
    message: "民宿在哪裡？",
    task: plannerTask({
      taskId: "location",
      type: "property_fact",
      sourceText: "民宿在哪裡？",
      rawText: "民宿位置",
      category: "transport",
      canonicalCandidate: "location",
      requestedOutputs: ["map_url"]
    }),
    rejectComposer: true
  });
  assert.equal(trace.stage("planner").parserSucceeded, true);
  assert.equal(trace.stage("validation").rejectionReasons.length, 0);
  assert.equal(trace.stage("context_validation").rejectionReasons.length, 0);
  assert.equal(trace.stage("canonical_request").items[0].capability, "location");
  assert.equal(trace.stage("formal_request").items[0].readiness, "ready");
  assert.equal(trace.stage("executor").results[0].status, "answered");
  assert.equal(trace.stage("composer").validationResult, "rejected");
  assert.equal(trace.stage("composer").fallbackOccurred, true);
  assert.equal(trace.result.claimValidation.ok, true);
  assert.equal(
    trace.result.finalDecision.action,
    "reply",
    "location reaches a grounded answer; only stale Composer rejection state causes handoff"
  );
  assert.equal(
    trace.result.replyText,
    "Google 地圖：https://maps.google.com/?q=property_location\n請直接開啟地圖查看路線與周邊位置。"
  );
}

const cases = [
  ["deterministic fallback clears rejected Composer state", deterministicFallbackClearsRejectedComposerState],
  ["pool routing uses grounded property catalog", poolRoutingUsesGroundedPropertyCatalog],
  ["location failure stage is Composer fallback state", locationFailureStageIsComposerFallbackState]
];

(async () => {
  const failures = [];
  for (const [name, test] of cases) {
    try {
      await test();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL: ${name}`);
      console.error(error.stack || error);
    }
  }
  console.log(JSON.stringify({
    caseCount: cases.length,
    passCount: cases.length - failures.length,
    failCount: failures.length
  }));
  if (failures.length) process.exit(1);
  console.log("core 90 limited fixes: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
