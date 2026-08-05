"use strict";

const assert = require("node:assert/strict");
const { applyPlannerSemanticContract, normalizeDuplicateTaskIds, plannerJsonSchema, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");

const eventTimestamp = Date.parse("2026-08-01T10:00:00+08:00");

function task({ taskId, type = "property_fact", category = "other", rawText, sourceText = rawText, canonicalCandidate = null, detailIntent = "general", requestedOutputs = ["answer"], dependsOnStayContext = false, stayCandidate = null }) {
  return {
    candidateIndex: 0, taskId, type, sourceText, detailIntent,
    requestedOutputs, eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext,
    entity: { category, rawText, canonicalCandidate, confidence: 0.99 },
    stayCandidate, confidence: 0.99
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
  semanticCatalog: { aliases: { location: ["directions"], parking: ["parking"], bbq: ["bbq", "barbecue"], cancellation: ["cancel"], pool: ["pool"], price: ["room rate"] }, amenities: [{ id: "pool", name: "Pool", aliases: ["pool"], status: "confirmed_yes", answer: "Alpha pool hours" }] }
};
const catalog = buildPropertyCatalog(property);

function canonical(taskValue) {
  const semantic = applyPlannerSemanticContract(plan([taskValue]), { catalog });
  const item = { candidateIndex: 0, requestCycleId: semantic.tasks[0].taskId, task: semantic.tasks[0], transition: { approvedProduct: { productType: "any", productId: null, roomTypeId: null, bundleId: null } } };
  return { semantic, item: canonicalizeExecutionItem({ item, relation: null, contextSnapshot: { cycles: [] }, catalog, guestMessage: taskValue.sourceText, eventTimestamp }) };
}

function assertContradictoryPlannerFieldsPreserveControlledCapability() {
  const cases = [
    ["stateful inventory type survives an incidental catalog entity", () => {
      const result = canonical(task({
        taskId: "stay-total",
        type: "total_price",
        category: "policy",
        rawText: "pool",
        canonicalCandidate: "pool",
        requestedOutputs: ["total_price"],
        dependsOnStayContext: true,
        stayCandidate: {
          dateExpression: { rawText: "", kind: "none", anchor: "none" },
          checkInCandidate: null,
          checkOutCandidate: null,
          nightsCandidate: null,
          guestCountCandidate: null
        }
      }));
      assert.equal(result.semantic.tasks[0].type, "total_price");
      assert.equal(result.semantic.tasks[0].entity.category, "other");
      assert.equal(result.semantic.tasks[0].entity.canonicalCandidate, null);
      assert.equal(result.item.canonicalRequest.capability, "total_price");
    }],
    ["unambiguous inventory output repairs an ungrounded low-risk task", () => {
      const result = canonical(task({
        taskId: "lodging-amount",
        type: "policy",
        category: "policy",
        rawText: "quoted lodging amount",
        requestedOutputs: ["price"]
      }));
      assert.equal(result.semantic.tasks[0].type, "price");
      assert.equal(result.semantic.tasks[0].dependsOnStayContext, true);
      assert.ok(result.semantic.tasks[0].stayCandidate);
      assert.equal(result.item.canonicalRequest.capability, "price");
    }],
    ["controlled restriction detail repairs an availability-shaped property rule", () => {
      const result = canonical(task({
        taskId: "shared-area-rule",
        type: "availability",
        category: "room_feature",
        rawText: "shared lounge",
        detailIntent: "usage_restrictions",
        requestedOutputs: ["usage_restrictions"]
      }));
      assert.equal(result.semantic.tasks[0].type, "policy");
      assert.equal(result.item.canonicalRequest.capability, "policy");
    }],
    ["an unresolved property fact keeps its semantic capability while truth stays unknown", () => {
      const result = canonical(task({
        taskId: "unlisted-house-detail",
        type: "property_fact",
        category: "other",
        rawText: "unlisted house detail",
        detailIntent: "conditions"
      }));
      assert.equal(result.semantic.tasks[0].type, "property_fact");
      assert.equal(result.item.canonicalRequest.capability, "property_fact");
      assert.equal(result.item.canonicalRequest.canonicalEntity.status, "not_found");
      assert.equal(result.item.canonicalRequest.resolverId, "property_catalog");
    }],
    ["a grounded catalog fact remains formal authority over a stray price output", () => {
      const result = canonical(task({
        taskId: "pool-rule",
        type: "policy",
        category: "policy",
        rawText: "pool",
        canonicalCandidate: "pool",
        requestedOutputs: ["price"]
      }));
      assert.equal(result.semantic.tasks[0].type, "amenity");
      assert.equal(result.semantic.tasks[0].entity.canonicalCandidate, "pool");
      assert.equal(result.item.canonicalRequest.capability, "pool");
    }],
    ["protected human action ignores inventory-shaped output", () => {
      const result = canonical(task({
        taskId: "operator-action",
        type: "human_help",
        category: "other",
        rawText: "operator action",
        requestedOutputs: ["price"]
      }));
      assert.equal(result.semantic.tasks[0].type, "human_help");
      assert.equal(result.item.canonicalRequest.resolverId, "human_handoff");
    }]
  ];
  const failures = [];
  for (const [name, check] of cases) {
    try { check(); }
    catch (error) { failures.push(new Error(`${name}: ${error.message}`)); }
  }
  if (failures.length) throw new AggregateError(failures, "contradictory Planner capability contract failed");
  return cases.length;
}

function main() {
  const contradictoryFieldCaseCount = assertContradictoryPlannerFieldsPreserveControlledCapability();
  const resolvedLocation = canonical(task({ taskId: "map", category: "transport", rawText: "directions" }));
  assert.equal(resolvedLocation.semantic.tasks[0].entity.canonicalCandidate, "location", "a uniquely property-catalog grounded transport entity must become location");
  assert.equal(resolvedLocation.item.canonicalRequest.capability, "location");
  assert.equal(resolvedLocation.item.canonicalRequest.resolverId, "property_catalog");

  const unresolvedTransport = canonical(task({ taskId: "unknown-transport", category: "transport", rawText: "near a market" }));
  assert.equal(unresolvedTransport.semantic.tasks[0].entity.canonicalCandidate, null, "unresolved transport must not be promoted to location");
  assert.notEqual(unresolvedTransport.item.canonicalRequest.capability, "location", "unresolved transport must not invoke the location capability");
  assert.equal(unresolvedTransport.item.canonicalRequest.canonicalEntity.status, "not_found");

  const policyCandidateWithAmenityShape = canonical(task({
    taskId: "policy-conditions",
    type: "amenity",
    category: "policy",
    rawText: "",
    sourceText: "cancellation conditions",
    canonicalCandidate: "cancellation",
    detailIntent: "conditions",
    requestedOutputs: ["conditions"]
  }));
  assert.equal(policyCandidateWithAmenityShape.semantic.tasks[0].type, "policy", "a catalog-resolved policy must correct an incompatible amenity-shaped Planner type even for a non-general detail request");
  assert.equal(policyCandidateWithAmenityShape.semantic.tasks[0].entity.category, "policy");
  assert.equal(policyCandidateWithAmenityShape.item.canonicalRequest.capability, "policy");
  assert.equal(policyCandidateWithAmenityShape.item.canonicalRequest.resolverId, "property_catalog");

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
  assert.equal(faqFragment.item.canonicalRequest.capability, "property_fact", "a property-authored FAQ must retain property-fact semantics instead of being flattened into an amenity");

  const amenityFeePolicy = canonical(task({
    taskId: "pool-fee-policy",
    type: "policy",
    category: "amenity",
    rawText: "pool",
    canonicalCandidate: "pool",
    detailIntent: "fee"
  }));
  assert.equal(amenityFeePolicy.semantic.tasks[0].type, "policy", "a policy question about an amenity must retain the Planner semantic type");
  assert.equal(amenityFeePolicy.semantic.tasks[0].entity.category, "amenity");
  assert.equal(amenityFeePolicy.item.canonicalRequest.capability, "policy");

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

  const substantiveAcknowledgement = plan([task({
    taskId: "payment-confirmation",
    type: "unknown",
    category: "other",
    rawText: "payment confirmation"
  })]);
  substantiveAcknowledgement.discourse = { relation: "acknowledgement", confidence: 0.95 };
  substantiveAcknowledgement.shouldIgnore = false;
  const retainedSubstantiveAcknowledgement = applyPlannerSemanticContract(substantiveAcknowledgement, { catalog });
  assert.equal(retainedSubstantiveAcknowledgement.shouldIgnore, false, "an acknowledgement-labeled output with an explicit substantive task must not override shouldIgnore=false");
  assert.equal(retainedSubstantiveAcknowledgement.tasks.length, 1, "the substantive task must survive acknowledgement relation normalization");
  assert.equal(retainedSubstantiveAcknowledgement.contextRelationCandidates[0].kind, "new_request", "the task's request relation must survive when the Planner did not authorize silence");
  const uncertainAcknowledgement = JSON.parse(JSON.stringify(substantiveAcknowledgement));
  uncertainAcknowledgement.contextRelationCandidates[0].kind = "relation_uncertain";
  const ignoredUncertainAcknowledgement = applyPlannerSemanticContract(uncertainAcknowledgement, { catalog });
  assert.equal(ignoredUncertainAcknowledgement.shouldIgnore, true, "an acknowledgement with only relation-uncertain generic tasks remains safely silent");

  const mergedMessage = "Can we use the barbecue, and can you arrange ingredients?";
  const mergedUnknownPlan = plan([task({
    taskId: "merged-unknown",
    type: "unknown",
    category: "other",
    rawText: mergedMessage,
    sourceText: mergedMessage
  })]);
  mergedUnknownPlan.contextRelationCandidates[0].evidenceRefs = [{
    eventId: "merged-unknown-event",
    messageRef: "",
    startOffset: 0,
    endOffset: mergedMessage.length,
    quote: mergedMessage
  }];
  const isolatedMergedUnknown = applyPlannerSemanticContract(mergedUnknownPlan, {
    catalog,
    sourceEvents: [{ eventId: "merged-unknown-event", messageRef: "", messageText: mergedMessage }]
  });
  assert.equal(isolatedMergedUnknown.tasks.length, 2, "a merged unknown task must not erase a separately grounded property-catalog subtask");
  assert.ok(isolatedMergedUnknown.tasks.some((item) => item.type === "unknown"), "the unresolved remainder must stay fail-closed");
  assert.ok(isolatedMergedUnknown.tasks.some((item) => item.entity.canonicalCandidate === "bbq"), "the verified catalog mention must survive as an isolated task");
  assert.equal(new Set(isolatedMergedUnknown.tasks.map((item) => item.candidateIndex)).size, 2, "isolated tasks must receive unique candidate indexes");
  assert.equal(isolatedMergedUnknown.contextRelationCandidates.length, 2, "each isolated task must retain verified current-event evidence");
  assert.equal(validatePlannerOutput(isolatedMergedUnknown).ok, true, "isolated tasks must remain a valid planner contract");
  const unverifiedMergedUnknownPlan = JSON.parse(JSON.stringify(mergedUnknownPlan));
  unverifiedMergedUnknownPlan.contextRelationCandidates[0].evidenceRefs[0].eventId = "wrong-event";
  const unverifiedMergedUnknown = applyPlannerSemanticContract(unverifiedMergedUnknownPlan, {
    catalog,
    sourceEvents: [{ eventId: "merged-unknown-event", messageRef: "", messageText: mergedMessage }]
  });
  assert.equal(unverifiedMergedUnknown.tasks.length, 1, "catalog task isolation must not trust evidence that fails current-source validation");
  const evidenceOnlyMentionPlan = JSON.parse(JSON.stringify(mergedUnknownPlan));
  evidenceOnlyMentionPlan.tasks[0].entity.rawText = "ingredient arrangement";
  const evidenceOnlyMention = applyPlannerSemanticContract(evidenceOnlyMentionPlan, {
    catalog,
    sourceEvents: [{ eventId: "merged-unknown-event", messageRef: "", messageText: mergedMessage }]
  });
  assert.equal(evidenceOnlyMention.tasks.length, 1, "the compiler must not infer business intent from message evidence when the Planner entity candidate does not contain the catalog concept");
  const alreadyRepresentedPlan = plan([
    task({ taskId: "explicit-barbecue", type: "policy", category: "policy", rawText: "barbecue" }),
    { ...task({ taskId: "remaining-unknown", type: "unknown", category: "other", rawText: mergedMessage, sourceText: mergedMessage }), candidateIndex: 1 }
  ]);
  alreadyRepresentedPlan.contextRelationCandidates.forEach((candidate) => {
    candidate.evidenceRefs = [{ eventId: "represented-event", messageRef: "", startOffset: 0, endOffset: mergedMessage.length, quote: mergedMessage }];
  });
  const alreadyRepresented = applyPlannerSemanticContract(alreadyRepresentedPlan, {
    catalog,
    sourceEvents: [{ eventId: "represented-event", messageRef: "", messageText: mergedMessage }]
  });
  assert.equal(alreadyRepresented.tasks.length, 2, "an already represented catalog task must never be duplicated during isolation");

  const duplicateTaskIdPlan = plan([
    task({ taskId: "capacity", type: "capacity", category: "other", rawText: "group size" }),
    { ...task({ taskId: "policy", type: "policy", category: "policy", rawText: "breakfast" }), candidateIndex: 1 },
    { ...task({ taskId: "policy", type: "policy", category: "policy", rawText: "cleaning fee", detailIntent: "fee" }), candidateIndex: 2 }
  ]);
  assert.deepEqual(validatePlannerOutput(duplicateTaskIdPlan).errors, ["tasks.taskId.duplicate"], "the deployed duplicate-id shape must begin structurally invalid");
  const normalizedDuplicateTaskIds = normalizeDuplicateTaskIds(duplicateTaskIdPlan);
  assert.equal(validatePlannerOutput(normalizedDuplicateTaskIds).ok, true, "duplicate Planner task IDs must be safely normalized before one task erases the others");
  assert.deepEqual(normalizedDuplicateTaskIds.tasks.map((item) => item.type), ["capacity", "policy", "policy"], "task-ID normalization must preserve every substantive task");
  assert.equal(new Set(normalizedDuplicateTaskIds.tasks.map((item) => item.taskId)).size, 3, "normalized task IDs must be unique");
  assert.deepEqual(normalizedDuplicateTaskIds.contextRelationCandidates.map((item) => item.candidateIndex), [0, 1, 2], "task-ID normalization must not alter candidate relations");
  const duplicateTaskIdSemantic = applyPlannerSemanticContract(normalizedDuplicateTaskIds, { catalog });
  assert.equal(duplicateTaskIdSemantic.semanticValidation.repairedTasks.filter((item) => item.reason === "duplicate_task_id_normalization").length, 1, "the controlled repair must remain visible in semantic validation evidence");
  const statefulDuplicateTaskIds = plan([
    { ...task({ taskId: "availability", type: "availability", category: "room", rawText: "room a" }), candidateIndex: 0 },
    { ...task({ taskId: "availability", type: "availability", category: "room", rawText: "room b" }), candidateIndex: 1 }
  ]);
  assert.equal(validatePlannerOutput(normalizeDuplicateTaskIds(statefulDuplicateTaskIds)).ok, false, "stateful duplicate task IDs must remain fail-closed because they become request-cycle identities");

  const schema = plannerJsonSchema();
  assert.ok(schema.properties.tasks.items.required.includes("eligibilityEvidence"));
  assert.deepEqual(schema.properties.tasks.items.properties.eligibilityEvidence.properties.kind.enum, ["none", "person", "room", "plan", "booking_mode", "identity", "stated_condition"]);
  console.log(JSON.stringify({ suite: "planner-semantic-contract", caseCount: 22 + contradictoryFieldCaseCount, passCount: 22 + contradictoryFieldCaseCount, failCount: 0 }));
}

main();
