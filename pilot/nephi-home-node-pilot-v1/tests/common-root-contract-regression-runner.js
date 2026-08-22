"use strict";

const assert = require("node:assert/strict");
const { resolveCanonicalTemporal } = require("../lib/conversation-engine-v2/temporal-resolver");
const { applyPlannerSemanticContract } = require("../lib/conversation-engine-v2/planner-schema");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { buildCanonicalFormalRequest, resultForNotReady } = require("../lib/conversation-engine-v2/formal-request");
const { buildFinalDecision } = require("../lib/conversation-engine-v2/final-decision");
const { buildFinalResponse } = require("../lib/conversation-engine-v2/final-response-renderer");

const EVENT_TIMESTAMP = Date.parse("2026-08-04T12:00:00+08:00");

function stay(rawText = "", kind = "none", nightsCandidate = null) {
  return {
    dateExpression: { rawText, kind, anchor: rawText ? "message_time" : "none" },
    checkInCandidate: null,
    checkOutCandidate: null,
    nightsCandidate,
    guestCountCandidate: null
  };
}

function temporal(message, rawText = "", kind = "none", nightsCandidate = null, defaults = {}) {
  return resolveCanonicalTemporal({
    guestMessage: message,
    candidateSourceText: message,
    plannerCandidate: stay(rawText, kind, nightsCandidate),
    eventTimestamp: EVENT_TIMESTAMP,
    timezone: "Asia/Taipei",
    ...defaults
  });
}

function plannerTask({ taskId, sourceText, type = "amenity", category = "other", rawText = "", canonicalCandidate = null }) {
  return {
    candidateIndex: 0,
    taskId,
    type,
    sourceText,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: { category, rawText, canonicalCandidate, confidence: 0.99 },
    confidence: 0.99
  };
}

function plannerPlan(task) {
  const evidenceRef = { eventId: "event", messageRef: "message", startOffset: 0, endOffset: task.sourceText.length, quote: task.sourceText };
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: stay(),
    tasks: [task],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [evidenceRef] }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "common_root_contract"
  };
}

function assertTemporalContracts() {
  const dotted = temporal("8/6.8/8住兩晚", "8/6.8/8住兩晚", "range");
  assert.equal(dotted.resolutionStatus, "resolved");
  assert.deepEqual([dotted.checkIn, dotted.checkOut, dotted.nights], ["2026-08-06", "2026-08-08", 2]);

  const inclusiveDays = temporal("8/6.8/7兩天", "8/6.8/7兩天", "range");
  assert.equal(inclusiveDays.resolutionStatus, "resolved");
  assert.deepEqual([inclusiveDays.checkIn, inclusiveDays.checkOut, inclusiveDays.nights], ["2026-08-06", "2026-08-07", 1]);

  const labeled = temporal("入住日期：8/6，退房日期：8/8", "入住日期：8/6，退房日期：8/8", "range");
  assert.equal(labeled.resolutionStatus, "resolved");
  assert.deepEqual([labeled.checkIn, labeled.checkOut, labeled.nights], ["2026-08-06", "2026-08-08", 2]);

  const nightsOnly = temporal("我們想住兩天怎麼安排", "", "none", 2);
  assert.equal(nightsOnly.resolutionStatus, "absent");
  assert.equal(nightsOnly.nights, 2, "an explicit duration must survive while dates remain absent");

  const rawNightsOnly = temporal("兩晚", "兩晚", "none", 2);
  assert.equal(rawNightsOnly.resolutionStatus, "absent");
  assert.equal(rawNightsOnly.nights, 2, "a standalone duration expression must remain usable without fabricating dates");

  const past = temporal("7/15可以訂房嗎", "7/15", "absolute", null, { defaultNights: 1 });
  assert.equal(past.resolutionStatus, "unresolved");
  assert.equal(past.repairReasonCode, "past_date");
  assert.equal(past.nights, 1, "past-date rejection must retain the normalized stay duration evidence");

  const catalog = buildPropertyCatalog({ propertyId: "p", timezone: "Asia/Taipei", rooms: [], commonAnswers: {} });
  const canonicalItem = canonicalizeExecutionItem({
    item: {
      candidateIndex: 0,
      requestCycleId: "cycle",
      task: {
        ...plannerTask({ taskId: "past", sourceText: "7/15可以訂房嗎", type: "availability" }),
        dependsOnStayContext: true,
        stayCandidate: stay("7/15", "absolute")
      },
      transition: { approvedProduct: { productType: "any" } }
    },
    relation: null,
    contextSnapshot: { cycles: [] },
    catalog,
    guestMessage: "7/15可以訂房嗎",
    eventTimestamp: EVENT_TIMESTAMP
  });
  const formal = buildCanonicalFormalRequest({
    property: { propertyId: "p" },
    canonicalRequest: canonicalItem.canonicalRequest,
    requestCycleId: "cycle",
    confirmedInputs: {}
  });
  assert.equal(formal.readiness.status, "missing_information");
  assert.equal(formal.readiness.reasonCode, "past_date");
  const decision = buildFinalDecision({ executionOutcomes: [resultForNotReady(formal)] });
  assert.equal(decision.reasonCode, "past_date");
  const response = buildFinalResponse({ finalDecision: decision, responsePlan: { sections: [], maxLength: 1200 }, validatedReplyText: "", claimValidation: { ok: true } });
  assert.match(response.replyText, /已過/u, "past dates must be rejected explicitly instead of being treated as missing");
}

function assertCatalogGroundingContracts() {
  const property = {
    propertyId: "p",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: { breakfastRule: "Breakfast fact", petRule: "Pet fact", priceRule: "Pricing depends on stay dates." },
    semanticCatalog: { aliases: { breakfast: ["breakfast"], pets: ["pets"], price: ["price", "fee"] } },
    propertyFacts: [
      { canonicalId: "breakfast", category: "policy", publicName: "Breakfast", status: "available", publicText: "Breakfast fact" },
      { canonicalId: "pets", category: "policy", publicName: "Pets", status: "available", publicText: "Pet fact" }
    ]
  };
  const catalog = buildPropertyCatalog(property);

  const candidateGrounded = applyPlannerSemanticContract(plannerPlan(plannerTask({
    taskId: "breakfast",
    sourceText: "Do you provide breakfast?",
    type: "amenity",
    category: "amenity",
    rawText: "breakfast",
    canonicalCandidate: "breakfast"
  })), { catalog, sourceEvents: [{ eventId: "event", messageRef: "message", messageText: "Do you provide breakfast?" }] });
  assert.equal(candidateGrounded.tasks[0].type, "policy");
  assert.equal(candidateGrounded.tasks[0].entity.category, "policy");
  assert.equal(candidateGrounded.tasks[0].entity.canonicalCandidate, "breakfast");

  const sourceGrounded = applyPlannerSemanticContract(plannerPlan(plannerTask({
    taskId: "pets",
    sourceText: "Is this property friendly to pets?",
    type: "amenity",
    category: "amenity",
    rawText: "pets",
    canonicalCandidate: "pets"
  })), { catalog, sourceEvents: [{ eventId: "event", messageRef: "message", messageText: "Is this property friendly to pets?" }] });
  assert.equal(sourceGrounded.tasks[0].type, "policy");
  assert.equal(sourceGrounded.tasks[0].entity.category, "policy");
  assert.equal(sourceGrounded.tasks[0].entity.canonicalCandidate, "pets");

  const priceGrounded = applyPlannerSemanticContract(plannerPlan({ ...plannerTask({
    taskId: "price",
    sourceText: "What is the price?",
    type: "price",
    category: "other",
    canonicalCandidate: "price"
  }), dependsOnStayContext: true, requestedOutputs: ["price"], stayCandidate: stay() }), { catalog, sourceEvents: [{ eventId: "event", messageRef: "message", messageText: "What is the price?" }] });
  assert.equal(priceGrounded.tasks[0].type, "price");
  assert.equal(priceGrounded.tasks[0].dependsOnStayContext, true);
  assert.equal(priceGrounded.tasks[0].entity.category, "other");
}


function assertCanonicalLodgingScopeContracts() {
  const catalog = buildPropertyCatalog({
    propertyId: "p",
    timezone: "Asia/Taipei",
    rooms: [
      { id: "alpha-room", name: "Alpha room", type: "double", capacity: 2, enabled: true },
      { id: "beta-room", name: "Beta room", type: "double", capacity: 2, enabled: true }
    ],
    commonAnswers: {},
    semanticCatalog: { aliases: { "alpha-room": ["Alpha room"], "beta-room": ["Beta room"] } }
  });
  const canonicalize = (entity) => canonicalizeExecutionItem({
    item: {
      candidateIndex: 0,
      requestCycleId: "cycle",
      task: { ...plannerTask({ taskId: "scope", sourceText: "Alpha room", type: "availability", ...entity }), requestedOutputs: ["availability"], dependsOnStayContext: true, stayCandidate: stay() },
      transition: { approvedProduct: { productType: "any" } }
    },
    relation: null,
    contextSnapshot: { cycles: [] },
    catalog,
    guestMessage: "Alpha room",
    eventTimestamp: EVENT_TIMESTAMP
  }).canonicalRequest;
  const resolved = canonicalize({ category: "room", rawText: "Alpha room", canonicalCandidate: "alpha-room" });
  assert.deepEqual(resolved.lodgingProduct, { productType: "room_type", productId: "alpha-room", roomTypeId: "alpha-room", bundleId: null }, "Canonical must preserve a uniquely resolved lodging scope from the same task");
  const ambiguous = canonicalize({ category: "room", rawText: "double", canonicalCandidate: null });
  assert.deepEqual(ambiguous.lodgingProduct, { productType: "any", productId: null, roomTypeId: null, bundleId: null }, "Canonical must not invent one lodging scope from an ambiguous candidate");
}
assertTemporalContracts();
assertCatalogGroundingContracts();
assertCanonicalLodgingScopeContracts();
console.log(JSON.stringify({ suite: "common-root-contract-regression", passCount: 11, failCount: 0 }));
