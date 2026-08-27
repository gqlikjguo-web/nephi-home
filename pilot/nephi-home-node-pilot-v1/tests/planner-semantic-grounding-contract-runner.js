"use strict";

const assert = require("node:assert/strict");
const { applyPlannerSemanticContract, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { compileSemanticCandidates } = require("../lib/conversation-engine-v2/semantic-candidate-contract");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");

const catalog = buildPropertyCatalog({
  propertyId: "semantic-grounding-property",
  displayName: "Contract Property",
  timezone: "Asia/Taipei",
  businessProfile: { googleMapsUrl: "https://maps.google.com/?q=semantic-grounding-property" },
  rooms: [],
  propertyFacts: [
    { canonicalId: "parking", category: "amenity", publicName: "停車", status: "provided", publicText: "提供停車。", aliases: [] },
    { canonicalId: "breakfast", category: "policy", publicName: "早餐說明", status: "provided", publicText: "住宿不附早餐。", aliases: [] },
    { canonicalId: "television", category: "amenity", publicName: "電視", status: "provided", publicText: "提供電視。", aliases: [] },
    { canonicalId: "elevator", category: "amenity", publicName: "電梯", status: "provided", publicText: "提供電梯。", aliases: [] }
  ]
});

function evidence(message, eventId) {
  return [{ eventId, messageRef: "", startOffset: 0, endOffset: message.length, quote: message }];
}

function taskFor(message, groundingId, overrides = {}) {
  return {
    candidateIndex: 0,
    taskId: `task-${groundingId}`,
    groundingId,
    type: "amenity_list",
    sourceText: message,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    entity: { category: "other", rawText: message, canonicalCandidate: null, confidence: 1 },
    stayCandidate: null,
    confidence: 1,
    ...overrides
  };
}

function plan(message, task, grounding, eventId) {
  const refs = evidence(message, eventId);
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 1 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [task],
    semanticGroundings: [{ ...grounding, groundingId: task.groundingId, provenanceRelationCandidateIndexes: [0], evidenceRefs: refs }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: refs }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "semantic_grounding_contract"
  };
}

function canonical(message, task, grounding, eventId) {
  const sourceEvents = [{ eventId, messageRef: "", messageText: message }];
  const semantic = applyPlannerSemanticContract(plan(message, task, grounding, eventId), { catalog, sourceEvents });
  const compiled = compileSemanticCandidates(semantic, { catalog, sourceEvents, contextSnapshot: { scope: {}, cycles: [] } }, { synthesizeMissingCandidates: true });
  assert.deepEqual(validatePlannerOutput(compiled), { ok: true, errors: [] });
  const item = canonicalizeExecutionItem({
    item: { candidateIndex: 0, requestCycleId: compiled.tasks[0].taskId, task: compiled.tasks[0], transition: { approvedProduct: { productType: "any", productId: null, roomTypeId: null, bundleId: null } } },
    relation: compiled.contextRelationCandidates[0],
    contextSnapshot: { cycles: [] },
    catalog,
    guestMessage: message,
    eventTimestamp: Date.parse("2026-08-27T10:00:00+08:00")
  });
  return { semantic: compiled, canonicalRequest: item.canonicalRequest };
}

const externalGrounding = {
  subject: { scope: "external_place", catalogIdentity: null },
  relation: "property_to_external_place",
  requestedOutput: "map_url"
};

for (const [name, message] of [
  ["production-breakfast-shop", "民宿附近有早餐店嗎"],
  ["restaurant", "旅宿周邊有餐廳嗎"],
  ["convenience-store", "住宿地點旁邊有便利商店嗎"],
  ["station", "從民宿到車站怎麼走"]
]) {
  const result = canonical(message, taskFor(message, name), externalGrounding, `event-${name}`);
  assert.equal(result.semantic.tasks[0].type, "property_fact", `${name}: grounding must reject the conflicting amenity_list task`);
  assert.deepEqual(result.semantic.tasks[0].entity, { category: "transport", rawText: message, canonicalCandidate: "location", confidence: 1 });
  assert.deepEqual(result.semantic.tasks[0].requestedOutputs, ["map_url"]);
  assert.equal(result.canonicalRequest.capability, "location");
}

for (const [name, message, task, grounding, expected] of [
  ["amenity-list", "有哪些設備", taskFor("有哪些設備", "amenity-list"), { subject: { scope: "property_owned", catalogIdentity: null }, relation: "collection_membership", requestedOutput: "answer" }, "amenity_list"],
  ["parking", "有停車嗎", taskFor("有停車嗎", "parking", { type: "amenity", entity: { category: "amenity", rawText: "有停車嗎", canonicalCandidate: "parking", confidence: 1 } }), { subject: { scope: "property_owned", catalogIdentity: "parking" }, relation: "property_fact", requestedOutput: "answer" }, "parking"],
  ["breakfast", "有提供早餐嗎", taskFor("有提供早餐嗎", "breakfast", { type: "amenity", entity: { category: "amenity", rawText: "有提供早餐嗎", canonicalCandidate: "breakfast", confidence: 1 } }), { subject: { scope: "property_owned", catalogIdentity: "breakfast" }, relation: "property_fact", requestedOutput: "answer" }, "policy"]
  , ["television", "有電視嗎", taskFor("有電視嗎", "television", { type: "amenity", entity: { category: "amenity", rawText: "有電視嗎", canonicalCandidate: "television", confidence: 1 } }), { subject: { scope: "property_owned", catalogIdentity: "television" }, relation: "property_fact", requestedOutput: "answer" }, "amenity"]
  , ["elevator", "有電梯嗎", taskFor("有電梯嗎", "elevator", { type: "amenity", entity: { category: "amenity", rawText: "有電梯嗎", canonicalCandidate: "elevator", confidence: 1 } }), { subject: { scope: "property_owned", catalogIdentity: "elevator" }, relation: "property_fact", requestedOutput: "answer" }, "amenity"]
]) {
  const result = canonical(message, task, grounding, `event-${name}`);
  assert.equal(result.canonicalRequest.capability, expected, `${name}: existing property authority must remain stable`);
}

{
  const message = "停車要收費嗎";
  const grounded = canonical(message, taskFor(message, "parking-fee", {
    type: "amenity",
    detailIntent: "fee",
    requestedOutputs: ["fee"],
    entity: { category: "amenity", rawText: message, canonicalCandidate: "parking", confidence: 1 }
  }), { subject: { scope: "property_owned", catalogIdentity: "parking" }, relation: "property_fact", requestedOutput: "answer" }, "event-parking-fee");
  assert.equal(grounded.semantic.tasks[0].detailIntent, "fee", "grounding alignment must preserve the existing detail intent");
  assert.deepEqual(grounded.semantic.tasks[0].requestedOutputs, ["fee"], "grounding alignment must preserve existing property-fact outputs");
}

{
  const message = "generic duplicate candidate request";
  const eventId = "event-duplicate-candidate";
  const value = plan(message, taskFor(message, "first-owner"), externalGrounding, eventId);
  value.tasks.push({ ...value.tasks[0], taskId: "second-owner", groundingId: "second-owner", candidateIndex: 0 });
  value.semanticGroundings.push({ ...value.semanticGroundings[0], groundingId: "second-owner" });
  const semantic = applyPlannerSemanticContract(value, { catalog, sourceEvents: [{ eventId, messageRef: "", messageText: message }] });
  assert.deepEqual(semantic.tasks.map((task) => task.type), ["unknown", "unknown"], "duplicate task candidate ownership must fail closed without index collision");
}

for (const [name, mutate] of [
  ["missing-binding", (value) => { value.tasks[0].groundingId = "missing-grounding"; }],
  ["duplicate-ownership", (value) => { value.tasks.push({ ...value.tasks[0], taskId: "duplicate-owner", candidateIndex: 1 }); }],
  ["invalid-evidence", (value) => { value.semanticGroundings[0].evidenceRefs[0].quote = "not-source-evidence"; }],
  ["invalid-catalog-identity", (value) => { value.semanticGroundings[0].subject = { scope: "property_owned", catalogIdentity: "not-in-property" }; value.semanticGroundings[0].relation = "property_fact"; value.semanticGroundings[0].requestedOutput = "answer"; }],
  ["conflicting-tuple", (value) => { value.semanticGroundings[0].requestedOutput = "answer"; }]
]) {
  const message = "generic semantic request";
  const eventId = `event-${name}`;
  const value = plan(message, taskFor(message, name), externalGrounding, eventId);
  mutate(value);
  const semantic = applyPlannerSemanticContract(value, { catalog, sourceEvents: [{ eventId, messageRef: "", messageText: message }] });
  assert.equal(semantic.tasks[0].type, "unknown", `${name}: invalid grounding must fail closed before canonical request`);
}

console.log("planner semantic grounding contract: PASS");
