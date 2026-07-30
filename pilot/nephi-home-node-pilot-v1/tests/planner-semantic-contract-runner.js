"use strict";

const assert = require("node:assert/strict");
const { applyPlannerSemanticContract, plannerJsonSchema } = require("../lib/conversation-engine-v2/planner-schema");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");

const eventTimestamp = Date.parse("2026-08-01T10:00:00+08:00");

function task({ taskId, type = "property_fact", category = "other", rawText, canonicalCandidate = null, detailIntent = "general", requestedOutputs = ["answer"] }) {
  return {
    candidateIndex: 0, taskId, type, sourceText: rawText, detailIntent,
    requestedOutputs, eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    entity: { category, rawText, canonicalCandidate, confidence: 0.99 },
    stayCandidate: null, confidence: 0.99
  };
}

function plan(tasks) {
  return {
    schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks, contextRelationCandidates: tasks.map((item) => ({ candidateIndex: item.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [] })),
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "semantic_contract_test"
  };
}

const property = {
  propertyId: "property_alpha", displayName: "Alpha", timezone: "Asia/Taipei", rooms: [],
  businessProfile: { googleMapsUrl: "https://maps.app.goo.gl/AlphaLocation" },
  commonAnswers: { parkingRule: "Alpha parking policy", bbqRule: "Alpha barbecue policy" },
  semanticCatalog: { aliases: { location: ["directions"], parking: ["parking"], bbq: ["bbq"], pool: ["pool"] }, amenities: [{ id: "pool", name: "Pool", aliases: ["pool"], status: "confirmed_yes", answer: "Alpha pool hours" }] }
};
const catalog = buildPropertyCatalog(property);

function canonical(taskValue) {
  const semantic = applyPlannerSemanticContract(plan([taskValue]), { catalog });
  const item = { candidateIndex: 0, requestCycleId: semantic.tasks[0].taskId, task: semantic.tasks[0], transition: { approvedProduct: { productType: "any", productId: null, roomTypeId: null, bundleId: null } } };
  return { semantic, item: canonicalizeExecutionItem({ item, relation: null, contextSnapshot: { cycles: [] }, catalog, guestMessage: taskValue.sourceText, eventTimestamp }) };
}

function main() {
  const resolvedLocation = canonical(task({ taskId: "map", category: "transport", rawText: "directions" }));
  assert.equal(resolvedLocation.semantic.tasks[0].entity.canonicalCandidate, "location", "a uniquely property-catalog grounded transport entity must become location");
  assert.equal(resolvedLocation.item.canonicalRequest.capability, "location");
  assert.equal(resolvedLocation.item.canonicalRequest.resolverId, "property_catalog");

  const unresolvedTransport = canonical(task({ taskId: "unknown-transport", category: "transport", rawText: "near a market" }));
  assert.equal(unresolvedTransport.semantic.tasks[0].entity.canonicalCandidate, null, "unresolved transport must not be promoted to location");
  assert.notEqual(unresolvedTransport.item.canonicalRequest.capability, "location", "unresolved transport must not invoke the location capability");
  assert.equal(unresolvedTransport.item.canonicalRequest.canonicalEntity.status, "not_found");

  for (const [id, category, rawText, expectedCapability] of [
    ["parking", "amenity", "parking", "parking"],
    ["pool", "amenity", "pool", "pool"],
    ["bbq", "policy", "bbq", "bbq"]
  ]) {
    const result = canonical(task({ taskId: id, type: "property_fact", category, rawText }));
    assert.equal(result.semantic.tasks[0].entity.canonicalCandidate, id, `${id} must be grounded from catalog data`);
    assert.equal(result.item.canonicalRequest.capability, expectedCapability, `${id} must retain its registered capability`);
    assert.equal(result.item.canonicalRequest.resolverId, "property_catalog");
  }

  const schema = plannerJsonSchema();
  assert.ok(schema.properties.tasks.items.required.includes("eligibilityEvidence"));
  assert.deepEqual(schema.properties.tasks.items.properties.eligibilityEvidence.properties.kind.enum, ["none", "person", "room", "plan", "booking_mode", "identity", "stated_condition"]);
  console.log(JSON.stringify({ suite: "planner-semantic-contract", caseCount: 6, passCount: 6, failCount: 0 }));
}

main();
