"use strict";

const assert = require("node:assert/strict");
const { applyPlannerSemanticContract, plannerJsonSchema, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");

const eventTimestamp = Date.parse("2026-08-01T10:00:00+08:00");

function task({ taskId, type = "property_fact", category = "other", rawText, sourceText = rawText, canonicalCandidate = null, detailIntent = "general", requestedOutputs = ["answer"] }) {
  return {
    candidateIndex: 0, taskId, type, sourceText, detailIntent,
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
  commonAnswers: { parkingRule: "Alpha parking policy", bbqRule: "Alpha barbecue policy", cancellationRule: "Alpha cancellation policy", priceRule: "Prices depend on the requested stay." },
  faqs: [
    { knowledgeKey: "shared_cooking", question: "Can registered guests use the shared kitchen?", answer: "Alpha kitchen policy." },
    { knowledgeKey: "prepayment_help", question: "How is a prepayment deposit arranged?", answer: "Alpha prepayment FAQ." },
    { knowledgeKey: "transport", question: "What address transport can guests arrange?", answer: "Alpha transport FAQ." }
  ],
  semanticCatalog: { aliases: { location: ["directions"], parking: ["parking"], bbq: ["bbq"], cancellation: ["cancel"], pool: ["pool"], price: ["room rate"] }, amenities: [{ id: "pool", name: "Pool", aliases: ["pool"], status: "confirmed_yes", answer: "Alpha pool hours" }] }
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

  const resolvedPrice = canonical(task({
    taskId: "price-candidate",
    type: "price",
    category: "policy",
    rawText: "cost",
    canonicalCandidate: "price"
  }));
  assert.equal(resolvedPrice.semantic.tasks[0].type, "price", "a catalog-confirmed price candidate must survive a non-alias raw phrase");
  assert.equal(resolvedPrice.semantic.tasks[0].entity.category, "other");
  assert.equal(resolvedPrice.item.canonicalRequest.capability, "price");
  assert.equal(resolvedPrice.item.canonicalRequest.resolverId, "availability_resolver");

  const ungroundedPrice = canonical(task({
    taskId: "generic-amount",
    type: "price",
    category: "policy",
    rawText: "quoted amount",
    requestedOutputs: ["price"]
  }));
  assert.equal(ungroundedPrice.semantic.tasks[0].type, "price");
  assert.equal(ungroundedPrice.semantic.tasks[0].entity.category, "other", "an ungrounded price task must retain its inventory capability with a compatible generic entity");
  assert.equal(ungroundedPrice.item.canonicalRequest.capability, "price");

  const bundlePriceOutput = canonical(task({
    taskId: "package-amount",
    type: "bundle_availability",
    category: "bundle",
    rawText: "lodging package",
    requestedOutputs: ["price"]
  }));
  assert.equal(bundlePriceOutput.semantic.tasks[0].type, "price", "an unambiguous controlled price output must correct an availability-shaped task");
  assert.equal(bundlePriceOutput.item.canonicalRequest.capability, "price");

  const standaloneAmenityAvailability = canonical(task({
    taskId: "portable-cot-availability",
    type: "availability",
    category: "amenity",
    rawText: "",
    sourceText: "portable cot availability"
  }));
  assert.equal(standaloneAmenityAvailability.semantic.tasks[0].type, "amenity", "standalone amenity availability must compile as an amenity fact task");
  assert.equal(standaloneAmenityAvailability.semantic.tasks[0].entity.category, "amenity");
  assert.equal(validatePlannerOutput(standaloneAmenityAvailability.semantic).ok, true, "normalized generic amenity tasks must remain schema-valid");
  assert.equal(standaloneAmenityAvailability.item.canonicalRequest.capability, "amenity");

  const standalonePolicyAvailability = canonical(task({
    taskId: "assisted-service-availability",
    type: "availability",
    category: "policy",
    rawText: "assisted service"
  }));
  assert.equal(standalonePolicyAvailability.semantic.tasks[0].type, "policy", "standalone policy availability must compile as a policy fact task");
  assert.equal(standalonePolicyAvailability.semantic.tasks[0].entity.category, "policy");
  assert.equal(standalonePolicyAvailability.item.canonicalRequest.capability, "policy");

  const amenityShapedPolicy = canonical(task({
    taskId: "shared-equipment-hours",
    type: "policy",
    category: "amenity",
    rawText: "",
    sourceText: "shared equipment hours",
    detailIntent: "usage_restrictions"
  }));
  assert.equal(amenityShapedPolicy.semantic.tasks[0].type, "policy");
  assert.equal(amenityShapedPolicy.semantic.tasks[0].entity.category, "policy", "an ungrounded policy task must use a policy-compatible entity category");
  assert.equal(validatePlannerOutput(amenityShapedPolicy.semantic).ok, true, "normalized generic policy tasks must remain schema-valid");
  assert.equal(amenityShapedPolicy.item.canonicalRequest.capability, "policy");

  const faqFragment = canonical(task({
    taskId: "shared-kitchen",
    type: "amenity",
    category: "amenity",
    rawText: "kitchen"
  }));
  assert.equal(faqFragment.semantic.tasks[0].entity.canonicalCandidate, "shared_cooking", "a unique Planner entity fragment must compile to the property-backed FAQ fact");
  assert.equal(faqFragment.item.canonicalRequest.capability, "amenity");

  const policyCandidateWithCrossCategoryFragment = canonical(task({
    taskId: "payment-candidate",
    type: "policy",
    category: "policy",
    rawText: "prepayment",
    canonicalCandidate: "payment"
  }));
  assert.equal(policyCandidateWithCrossCategoryFragment.semantic.tasks[0].entity.canonicalCandidate, "payment", "an amenity FAQ fragment must not override an exact policy candidate");
  assert.equal(policyCandidateWithCrossCategoryFragment.semantic.tasks[0].entity.category, "policy");
  assert.equal(policyCandidateWithCrossCategoryFragment.item.canonicalRequest.capability, "policy");

  const locationCandidateWithCrossCategoryFragment = canonical(task({
    taskId: "location-candidate",
    type: "property_fact",
    category: "transport",
    rawText: "address",
    canonicalCandidate: "location"
  }));
  assert.equal(locationCandidateWithCrossCategoryFragment.semantic.tasks[0].entity.canonicalCandidate, "location", "an amenity FAQ fragment must not override an exact transport candidate");
  assert.equal(locationCandidateWithCrossCategoryFragment.semantic.tasks[0].entity.category, "transport");
  assert.equal(locationCandidateWithCrossCategoryFragment.item.canonicalRequest.capability, "location");

  const protectedHumanAction = canonical(task({
    taskId: "cancel-action",
    type: "human_help",
    category: "other",
    rawText: "cancel booking"
  }));
  assert.equal(protectedHumanAction.semantic.tasks[0].type, "human_help", "fragment grounding must never demote a human action to an answerable fact");
  assert.equal(protectedHumanAction.item.canonicalRequest.resolverId, "human_handoff");

  const schema = plannerJsonSchema();
  assert.ok(schema.properties.tasks.items.required.includes("eligibilityEvidence"));
  assert.deepEqual(schema.properties.tasks.items.properties.eligibilityEvidence.properties.kind.enum, ["none", "person", "room", "plan", "booking_mode", "identity", "stated_condition"]);
  console.log(JSON.stringify({ suite: "planner-semantic-contract", caseCount: 16, passCount: 16, failCount: 0 }));
}

main();
