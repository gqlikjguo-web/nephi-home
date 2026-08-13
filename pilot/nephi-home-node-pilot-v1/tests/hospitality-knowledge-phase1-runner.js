"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateFriendlyProperty } = require("../lib/friendly-property-import");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { resolveEntity } = require("../lib/conversation-engine-v2/entity-resolver");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/nephi-home-property.json"), "utf8"));
const property = validateFriendlyProperty(fixture);
const roomsWithStructuredSinging = [...property.rooms, { id: "bundle_all", name: "包棟", inventoryType: "bundle", enabled: true, entertainmentAmenities: [{ key: "singing", provided: true, statusSource: "operator", source: "preset", note: "" }] }];
const catalog = buildPropertyCatalog({
  propertyId: property.propertyId,
  displayName: property.name,
  rooms: roomsWithStructuredSinging,
  commonAnswers: property.safeFacts,
  faqs: property.faqs
});

// Canonical capability aliases are generic language metadata.  They must resolve
// a property-provided fact; this runner deliberately contains no property answer.
const singing = catalog.amenities.find((fact) => fact.canonicalId === "singing");
assert.ok(singing, "structured equipment must materialize as the sole canonical singing fact");
assert.equal(catalog.faqs.some((fact) => fact.canonicalId === "singing"), false);
for (const utterance of ["有唱歌嗎？", "可以唱歌嗎？", "有卡拉 OK 嗎？", "有 KTV 嗎？", "可以唱到幾點？", "單訂房間可以唱歌嗎？", "包棟可以唱歌嗎？"]) {
  const resolved = resolveEntity(catalog, { category: "amenity", rawText: utterance, canonicalCandidate: "singing" });
  assert.equal(resolved.status, "resolved", `singing canonical fact must resolve: ${utterance}`);
  assert.match(resolved.entity.answer, /08:00-22:00/);
}

// New imports expose the V2 canonical cancellation fact, while the catalog must
// retain compatibility with already-materialized legacy lodgingRules records.
assert.equal(property.safeFacts.cancellationRule, fixture.cancellationPolicy);
const importedCancellation = catalog.policies.find((fact) => fact.canonicalId === "cancellation");
assert.equal(importedCancellation.status, "confirmed_yes");
assert.equal(importedCancellation.answer, fixture.cancellationPolicy);

const legacyCatalog = buildPropertyCatalog({
  propertyId: "legacy_property",
  commonAnswers: { lodgingRules: "Legacy cancellation policy" },
  rooms: [],
  faqs: []
});
const legacyCancellation = resolveEntity(legacyCatalog, { category: "policy", rawText: "退費", canonicalCandidate: "cancellation" });
assert.equal(legacyCancellation.status, "resolved");
assert.equal(legacyCancellation.entity.answer, "Legacy cancellation policy");
assert.notEqual(legacyCancellation.entity.status, "confirmed_no");

const otherCatalog = buildPropertyCatalog({
  propertyId: "other_property",
  commonAnswers: {},
  rooms: [{ id: "other_bundle", name: "Other bundle", inventoryType: "bundle", enabled: true, entertainmentAmenities: [{ key: "singing", provided: true, statusSource: "operator", source: "preset" }] }],
  faqs: [{ knowledgeKey: "singing", question: "Can guests sing?", answer: "Other property policy" }]
});
assert.match(resolveEntity(otherCatalog, { category: "amenity", rawText: "KTV", canonicalCandidate: "singing" }).entity.answer, /Other property policy/);

const planner = { classify: async ({ sourceEvents }) => {
  const output = ({
  schemaVersion: 2,
  discourse: { relation: "new_request", confidence: 1 },
  stateOperations: [],
  stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
  tasks: [
    { taskId: "singing", type: "amenity", sourceText: "可以唱到幾點？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "可以唱到幾點？", canonicalCandidate: "singing", confidence: 1 }, stayCandidate: null, confidence: 1 },
    { taskId: "cancellation-policy", type: "policy", sourceText: "可以退費嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "policy", rawText: "退費", canonicalCandidate: "cancellation", confidence: 1 }, stayCandidate: null, confidence: 1 },
    { taskId: "cancellation-operation", type: "human_help", sourceText: "請幫我取消訂房", requestedOutputs: ["handoff"], dependsOnStayContext: false, entity: { category: "other", rawText: "取消訂房", canonicalCandidate: null, confidence: 1 }, stayCandidate: null, confidence: 1 },
    { taskId: "missing", type: "amenity", sourceText: "有未提供的設施嗎？", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "未提供的設施", canonicalCandidate: "not_provided_feature", confidence: 1 }, stayCandidate: null, confidence: 1 }
  ],
  ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "phase1_multi_question"
  });
  const source = sourceEvents[0];
  const tasks = output.tasks.map((item, candidateIndex) => ({ ...item, candidateIndex }));
  return migrateFakePlannerOutput({
    ...output,
    tasks,
    contextRelationCandidates: tasks.map((item) => ({ candidateIndex: item.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: source.eventId, messageRef: source.messageRef || "", startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }] }))
  });
} };
const memory = new Map();
const engine = new ConversationEngineV2({
  planner,
  persistence: { getConversationState: (p, c, u) => memory.get(`${p}:${c}:${u}`) || null, setConversationState: (p, c, u, state) => memory.set(`${p}:${c}:${u}`, state), appendMessageLog: () => ({ reviewId: "review" }) },
  getProperty: () => ({ propertyId: property.propertyId, displayName: property.name, rooms: roomsWithStructuredSinging, commonAnswers: property.safeFacts, faqs: property.faqs }),
  availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
  listPriceOverrides: () => []
});
(async () => {
  const result = await engine.process({ customerId: property.propertyId, channelId: "test", lineUserId: "user", eventId: "phase1", eventTimestamp: Date.now(), messageText: "可以唱到幾點？還有未提供的設施嗎？" });
  assert.equal(result.taskResults[0].status, "answered");
  assert.equal(result.taskResults[1].status, "answered");
  assert.equal(result.taskResults[2].status, "needs_human");
  assert.equal(result.taskResults[3].status, "needs_human");
  assert.ok(result.replyText.includes(singing.answer), "known singing fact must survive a separate unknown task");
  assert.ok(result.replyText.includes(fixture.cancellationPolicy), "cancellation policy must be factual property data");
  assert.equal(result.replyText.includes("已取消"), false, "handoff must not claim cancellation was performed");
  assert.equal(result.replyText.includes("已退款"), false, "handoff must not claim refund was performed");
  assert.equal(result.replyText.includes("已延期"), false, "handoff must not claim date change was performed");
  assert.equal(result.replyText.includes("沒有未提供的設施"), false, "not_provided must not become no");
  console.log("hospitality knowledge Phase 1: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
