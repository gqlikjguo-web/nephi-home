"use strict";

// RECORDED_REPRODUCTION: immutable Planner trace summaries below are copied from
// the downloaded private artifact. The report did not retain the complete raw
// Planner JSON, so each summary is deterministically hydrated only with schema-
// required source/evidence fields before entering the production compiler. This
// local replay does not call OpenAI and does not represent Provider acceptance.
const assert = require("node:assert/strict");
const { applyPlannerSemanticContract } = require("../lib/conversation-engine-v2/planner-schema");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildFinalDecision } = require("../lib/conversation-engine-v2/final-decision");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");

const RECORDED_PROVENANCE = Object.freeze({
  artifact: "junzan-artifact-8955397936/junzan-real-guest-acceptance-report.json",
  schemaVersion: 1,
  commit: "36fecd4bba4719b7e20eddc7062a3e3520d2a5b7",
  generatedAt: "2026-08-06T04:07:46.453Z",
  records: Object.freeze({
    availability_amenity_drift: Object.freeze({ caseId: "rg-026-ktv-availability", traceId: "511f4b5f-d3f4-4920-843e-c30e39c6c46f", task: Object.freeze({ taskId: "gha-rg-026-ktv-availability-1-21177bc2-738b-45ab-a72e-92913d006766-0", type: "availability", category: "", canonicalCandidate: null, detailIntent: "general" }) }),
    availability_property_fact_drift: Object.freeze({ caseId: "rg-020-parking", traceId: "61bb0915-f2dc-4e1c-a673-45f394fc35e0", task: Object.freeze({ taskId: "tsk-0-parking-availability-nephi_home", type: "availability", category: "", canonicalCandidate: null, detailIntent: "general" }) }),
    price_bundle_scope_loss: Object.freeze({ caseId: "rg-004-bundle-price", traceId: "222daa07-c7e0-4d84-beed-d3bdb40ce0b4", task: Object.freeze({ taskId: "availability-bundle_four_room_whole_house-price-0", type: "price", category: "", canonicalCandidate: null, detailIntent: "general" }) }),
    price_temporal_scope_loss: Object.freeze({ caseId: "rg-003-price-nights", traceId: "792c0f10-b2e5-4ef3-b6b8-8267062ec196", task: Object.freeze({ taskId: "task0", type: "price", category: "", canonicalCandidate: null, detailIntent: "general" }) }),
    multi_task_shared_evidence: Object.freeze({ caseId: "rg-037-multi-pool-price-checkin", traceId: "eaa5ec01-2e35-473e-965b-4409f34a0806", tasks: Object.freeze([
      Object.freeze({ taskId: "availability_room_count", type: "availability", category: "", canonicalCandidate: null, detailIntent: "general" }),
      Object.freeze({ taskId: "price_check_no_pool", type: "price", category: "", canonicalCandidate: null, detailIntent: "general" }),
      Object.freeze({ taskId: "check_in_time", type: "policy", category: "", canonicalCandidate: null, detailIntent: "start_time" })
    ]) })
  })
});

const emptyStay = () => ({ dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null });
const property = {
  propertyId: "recorded-property", displayName: "Recorded Property", timezone: "Asia/Taipei",
  rooms: [
    { id: "recorded-room", name: "Garden Family Room", type: "family", description: "Deep soaking tub", capacity: 4, enabled: true },
    { id: "recorded-bundle", name: "Courtyard Group Lodge", type: "whole house", inventoryType: "bundle", capacity: 10, enabled: true }
  ],
  commonAnswers: { parkingRule: "Parking is property controlled.", priceRule: "Prices depend on the stay." },
  faqs: [{ knowledgeKey: "fixture", question: "Which rooms include a deep soaking tub?", answer: "Use the formal room record." }],
  semanticCatalog: { aliases: { "recorded-room": ["Garden Room"], "recorded-bundle": ["Courtyard Lodge"], parking: ["parking"] } }
};
const catalog = buildPropertyCatalog(property);

function task(input) {
  return {
    candidateIndex: input.candidateIndex || 0, taskId: input.taskId, type: input.type,
    sourceText: input.sourceText, detailIntent: input.detailIntent || "general",
    requestedOutputs: input.requestedOutputs, eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: input.dependsOnStayContext,
    entity: { category: input.category, rawText: input.rawText, canonicalCandidate: input.canonicalCandidate || null, confidence: 0.95 },
    stayCandidate: input.stayCandidate === undefined ? null : input.stayCandidate, confidence: 0.95
  };
}

function recordedTask(recordName, hydration, taskIndex = 0) {
  const record = RECORDED_PROVENANCE.records[recordName];
  assert.ok(record, `missing recorded provenance ${recordName}`);
  const summary = record.task || record.tasks[taskIndex];
  assert.ok(summary, `missing recorded Planner task ${recordName}[${taskIndex}]`);
  return task({
    ...hydration,
    taskId: summary.taskId,
    type: summary.type,
    detailIntent: summary.detailIntent,
    canonicalCandidate: summary.canonicalCandidate
  });
}

function replay(tasks, { message, topStay = emptyStay(), evidenceQuotes, catalogOverride = catalog, evidenceEventId = "recorded-event" } = {}) {
  const relations = tasks.map((item, index) => {
    const quote = evidenceQuotes ? evidenceQuotes[index] : item.sourceText;
    const startOffset = message.indexOf(quote);
    return { candidateIndex: item.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: evidenceEventId, messageRef: "", startOffset, endOffset: startOffset + quote.length, quote }] };
  });
  const semantic = applyPlannerSemanticContract({
    schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.95 }, stateOperations: [], stay: topStay,
    tasks, contextRelationCandidates: relations, ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false,
    reason: "recorded_reproduction"
  }, { catalog: catalogOverride, sourceEvents: [{ eventId: "recorded-event", messageRef: "", messageText: message }] });
  const canonical = semantic.tasks.map((semanticTask) => canonicalizeExecutionItem({
    item: { candidateIndex: semanticTask.candidateIndex, requestCycleId: semanticTask.taskId, task: semanticTask, transition: { approvedProduct: { productType: "any", productId: null, roomTypeId: null, bundleId: null } } },
    relation: semantic.contextRelationCandidates.find((item) => item.candidateIndex === semanticTask.candidateIndex),
    contextSnapshot: { cycles: [] }, catalog: catalogOverride, guestMessage: message, eventTimestamp: Date.parse("2026-08-06T10:00:00+08:00")
  }).canonicalRequest);
  const outcomes = canonical.map((request) => request.canonicalEntity.status === "resolved"
    ? { taskId: request.taskId, type: request.capability, outcome: "answered" }
    : { taskId: request.taskId, type: request.capability, outcome: "not_ready", readinessStatus: "missing_information", missingFields: request.requiredFields });
  return { semantic, canonical, decision: buildFinalDecision({ executionOutcomes: outcomes }) };
}

const cases = [
  ["availability amenity drift", () => {
    const message = "Does Garden Family Room include Deep soaking tub?";
    const result = replay([recordedTask("availability_amenity_drift", { category: "room", rawText: "Garden Family Room", canonicalCandidate: "recorded-room", sourceText: message, requestedOutputs: ["availability"], dependsOnStayContext: true, stayCandidate: emptyStay() })], { message });
    assert.equal(result.canonical[0].capability, "amenity");
    assert.equal(result.decision.action, "clarification");
  }],
  ["availability property fact drift", () => {
    const message = "Is parking provided?";
    const result = replay([recordedTask("availability_property_fact_drift", { category: "amenity", rawText: "parking", sourceText: message, requestedOutputs: ["availability"], dependsOnStayContext: false })], { message });
    assert.ok(["amenity", "parking", "property_fact"].includes(result.canonical[0].capability));
    assert.equal(result.canonical[0].canonicalEntity.status, "resolved");
  }],
  ["price bundle scope", () => {
    const message = "Courtyard Group Lodge lodging amount.";
    const result = replay([recordedTask("price_bundle_scope_loss", { category: "policy", rawText: "lodging amount", canonicalCandidate: "price", sourceText: message, requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { ...emptyStay(), nightsCandidate: 1 } })], { message });
    assert.deepEqual([result.canonical[0].capability, result.canonical[0].canonicalEntity.canonicalId], ["price", "recorded-bundle"]);
  }],
  ["total price room scope", () => {
    const message = "Garden Room total lodging amount.";
    const result = replay([task({ taskId: "room-total", type: "total_price", category: "policy", rawText: "lodging amount", sourceText: message, requestedOutputs: ["total_price"], dependsOnStayContext: true, stayCandidate: { ...emptyStay(), nightsCandidate: 2 } })], { message });
    assert.deepEqual([result.canonical[0].capability, result.canonical[0].canonicalEntity.canonicalId], ["total_price", "recorded-room"]);
  }],
  ["top-level stay authority", () => {
    const message = "Is Garden Family Room available?";
    const topStay = { dateExpression: { rawText: "8/20-8/22", kind: "range", anchor: "message_time" }, checkInCandidate: "2026-08-20", checkOutCandidate: "2026-08-22", nightsCandidate: 2, guestCountCandidate: 4 };
    const result = replay([task({ taskId: "stay", type: "availability", category: "room", rawText: "Garden Family Room", canonicalCandidate: "recorded-room", sourceText: message, requestedOutputs: ["availability"], dependsOnStayContext: true, stayCandidate: emptyStay() })], { message, topStay });
    assert.equal(result.semantic.tasks[0].stayCandidate.guestCountCandidate, 4);
    assert.deepEqual(result.semantic.tasks[0].stayCandidate, topStay);
    assert.equal(result.canonical[0].temporalState.resolutionStatus, "unresolved", "unquoted recorded temporal input must remain fail closed at CanonicalRequest");
  }],
  ["shared evidence task isolation", () => {
    const message = "Garden Family Room has a feature. Confirm the lodging amount.";
    const result = replay([
      recordedTask("multi_task_shared_evidence", { candidateIndex: 0, category: "policy", rawText: "lodging amount", sourceText: "Confirm the lodging amount.", requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { ...emptyStay(), nightsCandidate: 1 } }, 1),
      task({ candidateIndex: 1, taskId: "hydrated-feature-scope", type: "amenity", category: "room_feature", rawText: "feature", sourceText: "Garden Family Room has a feature.", requestedOutputs: ["answer"], dependsOnStayContext: false })
    ], { message, evidenceQuotes: [message, message] });
    assert.equal(result.canonical[0].canonicalEntity.status, "not_requested");
    assert.equal(result.decision.action, "clarification");
  }],
  ["formal name and alias only", () => {
    const formal = replay([task({ taskId: "formal", type: "price", category: "policy", rawText: "amount", sourceText: "Courtyard Group Lodgd amount.", requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { ...emptyStay(), nightsCandidate: 1 } })], { message: "Courtyard Group Lodgd amount." });
    const alias = replay([task({ taskId: "alias", type: "price", category: "policy", rawText: "amount", sourceText: "Courtyard Lodge amount.", requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { ...emptyStay(), nightsCandidate: 1 } })], { message: "Courtyard Lodge amount." });
    assert.equal(formal.canonical[0].canonicalEntity.canonicalId, "recorded-bundle");
    assert.equal(alias.canonical[0].canonicalEntity.canonicalId, "recorded-bundle");
  }],
  ["generic type and FAQ fragment fail closed", () => {
    const generic = replay([task({ taskId: "generic", type: "price", category: "policy", rawText: "amount", sourceText: "Suite amount.", requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { ...emptyStay(), nightsCandidate: 1 } })], { message: "Suite amount." });
    const faq = replay([task({ taskId: "faq", type: "availability", category: "room", rawText: "Garden Family Room", canonicalCandidate: "recorded-room", sourceText: "Does Garden Family Room include deep soaking space?", requestedOutputs: ["availability"], dependsOnStayContext: true, stayCandidate: emptyStay() })], { message: "Does Garden Family Room include deep soaking space?" });
    assert.equal(generic.canonical[0].canonicalEntity.status, "not_requested");
    assert.equal(faq.canonical[0].capability, "availability");
  }],
  ["ambiguous unverified cross-property fail closed", () => {
    const ambiguousCatalog = buildPropertyCatalog({ ...property, propertyId: "other-property", rooms: [...property.rooms, { id: "second-bundle", name: "Courtyard Group Lodger", type: "whole house", inventoryType: "bundle", capacity: 8, enabled: true }] });
    const result = replay([task({ taskId: "unsafe", type: "price", category: "policy", rawText: "amount", sourceText: "Courtyard Group Lodge and Courtyard Group Lodger amount.", requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { ...emptyStay(), nightsCandidate: 1 } })], { message: "Courtyard Group Lodge and Courtyard Group Lodger amount.", catalogOverride: ambiguousCatalog, evidenceEventId: "unverified-event" });
    assert.equal(result.canonical[0].canonicalEntity.status, "not_requested");
    assert.equal(result.decision.action, "clarification");
  }]
];

for (const [name, run] of cases) { run(); console.log(`PASS ${name}`); }
console.log(JSON.stringify({ suite: "planner-semantic-recorded-replay", classification: "RECORDED_REPRODUCTION", artifact: RECORDED_PROVENANCE.artifact, artifactCommit: RECORDED_PROVENANCE.commit, recordedTraceCount: Object.keys(RECORDED_PROVENANCE.records).length, caseCount: cases.length, passCount: cases.length, failCount: 0, openAiCalls: 0, providerAcceptance: false }));
