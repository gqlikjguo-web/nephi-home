"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");

const MESSAGE = "民宿在哪裡？";
const EVENT_TIMESTAMP = Date.parse("2026-07-27T10:00:00+08:00");
const NOW = () => new Date("2026-07-27T02:00:00.000Z");
const EMPTY_STAY = Object.freeze({
  dateExpression: { rawText: "", kind: "none", anchor: "none" },
  checkInCandidate: null,
  checkOutCandidate: null,
  nightsCandidate: null,
  guestCountCandidate: null
});
const INVALID_TOP_LEVEL_STAY = Object.freeze({
  dateExpression: {
    rawText: "not-in-the-guest-message",
    kind: "absolute",
    anchor: "message_time"
  },
  checkInCandidate: "2030-01-01",
  checkOutCandidate: null,
  nightsCandidate: null,
  guestCountCandidate: null
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function property(propertyId, label, mapUrl) {
  return {
    propertyId,
    displayName: label,
    timezone: "Asia/Taipei",
    currency: "TWD",
    businessProfile: mapUrl ? { googleMapsUrl: mapUrl } : {},
    rooms: [],
    propertyFacts: [],
    semanticCatalog: {
      aliases: {
        location: ["位置", "地址", "民宿"]
      },
      amenities: []
    },
    commonAnswers: {}
  };
}

function locationPlan(sourceEvent, topLevelStay) {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: clone(topLevelStay),
    tasks: [{
      candidateIndex: 0,
      taskId: "location-task",
      type: "property_fact",
      sourceText: MESSAGE,
      detailIntent: "general",
      requestedOutputs: ["map_url"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: {
        category: "transport",
        rawText: "民宿",
        canonicalCandidate: "location",
        confidence: 0.99
      },
      stayCandidate: null,
      confidence: 0.99
    }],
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
    reason: "location_readiness_regression"
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

async function execute({ currentProperty, topLevelStay }) {
  const diagnostics = [];
  const eventId = `${currentProperty.propertyId}-${topLevelStay.dateExpression.kind}`;
  const planner = {
    classify: async ({ sourceEvents }) =>
      locationPlan(sourceEvents[0], topLevelStay)
  };
  const engine = new ConversationEngineV2({
    planner,
    composer: null,
    persistence: memoryPersistence(),
    getProperty: (propertyId) =>
      propertyId === currentProperty.propertyId ? currentProperty : null,
    availabilityResolver: () => {
      throw new Error("location must not call availability resolver");
    },
    availableDatesResolver: () => {
      throw new Error("location must not call available-dates resolver");
    },
    listPriceOverrides: () => [],
    now: NOW,
    diagnosticDetail: true,
    onDiagnostic: (entry) => diagnostics.push(clone(entry))
  });
  const result = await engine.process({
    customerId: currentProperty.propertyId,
    channelId: eventId,
    lineUserId: `fresh-${eventId}`,
    eventId,
    eventTimestamp: EVENT_TIMESTAMP,
    messageText: MESSAGE,
    sourceEvents: [{
      eventId,
      messageRef: "",
      messageText: MESSAGE
    }]
  });
  const stage = (name) =>
    diagnostics.find((entry) => entry.stage === name) || null;
  return {
    result,
    canonical: stage("canonical_request").items[0],
    formal: stage("formal_request").items[0],
    queryPlan: stage("query_plan"),
    contextValidation: stage("context_validation"),
    executor: stage("executor"),
    propertyCatalog: stage("property_catalog")
  };
}

function assertCanonicalLocation(trace) {
  assert.equal(trace.contextValidation.rejectionReasons.length, 0);
  assert.equal(trace.canonical.capability, "location");
  assert.equal(trace.canonical.canonicalEntity.status, "resolved");
  assert.equal(trace.canonical.canonicalEntity.canonicalId, "location");
  assert.deepEqual(trace.canonical.requiredFields, []);
  assert.equal(trace.canonical.stayDependency, false);
  assert.equal(trace.canonical.resolverId, "property_catalog");
  assert.equal(trace.canonical.riskLevel, "low");
  assert.equal(trace.canonical.responseMode, "answer");
  assert.equal(trace.canonical.evidenceRefs.length, 1);
}

function assertAnsweredLocation(trace, expectedPropertyId, expectedMapUrl) {
  assertCanonicalLocation(trace);
  assert.equal(trace.formal.readiness, "ready");
  assert.equal(trace.queryPlan.count, 1);
  assert.equal(trace.queryPlan.items[0].operation, "property_catalog");
  assert.equal(trace.result.taskResults[0].status, "answered");
  assert.equal(trace.result.taskResults[0].facts.source, "property_catalog");
  assert.equal(trace.result.taskResults[0].facts.propertyId, expectedPropertyId);
  assert.equal(
    trace.result.taskResults[0].facts.locationMapUrl,
    expectedMapUrl
  );
  assert.equal(trace.result.finalDecision.action, "reply");
  assert.equal(trace.result.finalDecision.reasonCode, "execution_answered");
}

(async () => {
  const alphaUrl = "https://maps.google.com/?q=property_alpha";
  const betaUrl = "https://maps.google.com/?q=property_beta";
  const alpha = property("property_alpha", "Alpha", alphaUrl);
  const beta = property("property_beta", "Beta", betaUrl);

  const successfulControl = await execute({
    currentProperty: alpha,
    topLevelStay: EMPTY_STAY
  });
  assert.equal(
    successfulControl.canonical.temporalState.resolutionStatus,
    "absent"
  );
  assertAnsweredLocation(successfulControl, "property_alpha", alphaUrl);

  const failedPlannerShape = await execute({
    currentProperty: alpha,
    topLevelStay: INVALID_TOP_LEVEL_STAY
  });
  assert.equal(
    failedPlannerShape.canonical.temporalState.resolutionStatus,
    "unresolved",
    "Canonical Temporal must continue rejecting an ungrounded Planner date"
  );
  assert.equal(
    failedPlannerShape.canonical.temporalState.repairReasonCode,
    "planner_temporal_span_invalid"
  );
  assertAnsweredLocation(
    failedPlannerShape,
    "property_alpha",
    alphaUrl
  );

  const betaControl = await execute({
    currentProperty: beta,
    topLevelStay: INVALID_TOP_LEVEL_STAY
  });
  assertAnsweredLocation(betaControl, "property_beta", betaUrl);
  assert.equal(
    betaControl.result.taskResults[0].facts.locationMapUrl === alphaUrl,
    false,
    "property_beta must never receive property_alpha location data"
  );

  const missingFact = await execute({
    currentProperty: property("property_missing", "Missing", ""),
    topLevelStay: INVALID_TOP_LEVEL_STAY
  });
  assertCanonicalLocation(missingFact);
  assert.equal(missingFact.propertyCatalog.location.urlValidation, "fail");
  assert.equal(missingFact.formal.readiness, "ready");
  assert.equal(missingFact.result.taskResults[0].status, "needs_human");
  assert.equal(
    missingFact.result.taskResults[0].facts.locationMapUrl,
    undefined
  );
  assert.equal(missingFact.result.finalDecision.action, "handoff");

  console.log(JSON.stringify({
    caseCount: 4,
    passCount: 4,
    failCount: 0
  }));
  console.log("location readiness regression: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
