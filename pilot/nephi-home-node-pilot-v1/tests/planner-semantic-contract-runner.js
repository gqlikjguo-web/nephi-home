"use strict";

const assert = require("node:assert/strict");
const { applyPlannerSemanticContract, normalizeDuplicateTaskIds, plannerJsonSchema, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");

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
  semanticCatalog: { aliases: { location: ["directions"], parking: ["parking"], bbq: ["bbq", "barbecue"], cancellation: ["cancel"], pool: ["pool"], price: ["room rate"], shared_cooking: ["shared kitchen"] }, amenities: [{ id: "pool", name: "Pool", aliases: ["pool"], status: "confirmed_yes", answer: "Alpha pool hours" }] }
};
const catalog = buildPropertyCatalog(property);

function sourceBoundSemantic(taskValue, { message = taskValue.sourceText, eventId = "source-bound-event", evidenceEventId = eventId, catalogOverride = catalog } = {}) {
  const value = plan([taskValue]);
  value.contextRelationCandidates[0].evidenceRefs = [{
    eventId: evidenceEventId,
    messageRef: "",
    startOffset: 0,
    endOffset: message.length,
    quote: message
  }];
  return applyPlannerSemanticContract(value, {
    catalog: catalogOverride,
    sourceEvents: [{ eventId, messageRef: "", messageText: message }]
  });
}

function canonical(taskValue, catalogOverride = catalog) {
  const semantic = applyPlannerSemanticContract(plan([taskValue]), { catalog: catalogOverride });
  const item = { candidateIndex: 0, requestCycleId: semantic.tasks[0].taskId, task: semantic.tasks[0], transition: { approvedProduct: { productType: "any", productId: null, roomTypeId: null, bundleId: null } } };
  return { semantic, item: canonicalizeExecutionItem({ item, relation: null, contextSnapshot: { cycles: [] }, catalog: catalogOverride, guestMessage: taskValue.sourceText, eventTimestamp }) };
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
    ["controlled restriction detail repairs an amenity-shaped property rule", () => {
      const result = canonical(task({
        taskId: "amenity-area-rule",
        type: "amenity",
        category: "amenity",
        rawText: "shared conversation area",
        detailIntent: "usage_restrictions",
        requestedOutputs: ["usage_restrictions"]
      }));
      assert.equal(result.semantic.tasks[0].type, "policy");
      assert.equal(result.item.canonicalRequest.capability, "policy");
    }],
    ["a room-scoped restriction receives a registry-compatible policy entity", () => {
      const result = canonical(task({
        taskId: "room-restriction",
        type: "availability",
        category: "room",
        rawText: "double room adjustment",
        detailIntent: "room_or_bundle_restriction",
        requestedOutputs: ["room_or_bundle_restriction"]
      }));
      assert.equal(result.semantic.tasks[0].type, "policy");
      assert.equal(result.semantic.tasks[0].entity.category, "policy");
      assert.equal(result.item.canonicalRequest.capability, "policy");
    }],
    ["a resolved lodging room is not erased by restriction-shaped detail drift", () => {
      const roomCatalog = buildPropertyCatalog({
        ...property,
        rooms: [{
          id: "inventory-room-a",
          name: "Inventory Room A",
          type: "family",
          capacity: 4,
          enabled: true
        }]
      });
      const result = canonical(task({
        taskId: "resolved-room-restriction-drift",
        type: "availability",
        category: "room",
        rawText: "Inventory Room A",
        sourceText: "Inventory Room A 7/20",
        canonicalCandidate: "inventory-room-a",
        detailIntent: "room_or_bundle_restriction",
        requestedOutputs: ["availability"],
        dependsOnStayContext: true,
        stayCandidate: {
          dateExpression: { rawText: "7/20", kind: "absolute", anchor: "message_time" },
          checkInCandidate: "2026-07-20",
          checkOutCandidate: null,
          nightsCandidate: 1,
          guestCountCandidate: null
        }
      }), roomCatalog);
      assert.equal(result.semantic.tasks[0].type, "availability", "a formally resolved room must keep its inventory capability");
      assert.equal(result.semantic.tasks[0].entity.category, "room");
      assert.equal(result.semantic.tasks[0].entity.canonicalCandidate, "inventory-room-a");
      assert.equal(result.item.canonicalRequest.capability, "availability");
      assert.equal(result.item.canonicalRequest.canonicalEntity.canonicalId, "inventory-room-a");
      assert.equal(result.item.canonicalRequest.temporalState.repairReasonCode, "past_date", "preserved inventory scope must retain temporal fail-closed authority");
      assert.ok(result.semantic.semanticValidation.repairedTasks.some((item) => item.reason === "resolved_inventory_detail_scope_preservation"), "the deployed semantic trace must prove the inventory-scope guard executed");
    }],
    ["a grounded amenity restriction remains a policy question", () => {
      const result = canonical(task({
        taskId: "grounded-amenity-restriction",
        type: "amenity",
        category: "amenity",
        rawText: "pool",
        canonicalCandidate: "pool",
        detailIntent: "usage_restrictions",
        requestedOutputs: ["usage_restrictions"]
      }));
      assert.equal(result.semantic.tasks[0].type, "policy");
      assert.equal(result.semantic.tasks[0].entity.canonicalCandidate, "pool");
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
  assert.equal(faqFragment.semantic.tasks[0].entity.canonicalCandidate, null, "a FAQ fragment must not recover a formal property fact");
  assert.equal(faqFragment.item.canonicalRequest.capability, "amenity", "an unresolved FAQ fragment must retain the Planner capability and fail closed");

  const sourceBoundTimeFact = sourceBoundSemantic(task({
    taskId: "source-bound-hours",
    type: "availability",
    category: "other",
    rawText: "",
    sourceText: "pool schedule",
    detailIntent: "time"
  }));
  assert.equal(sourceBoundTimeFact.tasks[0].entity.canonicalCandidate, "pool", "a verified task source with one formal fact must recover an empty time-detail entity");
  assert.equal(sourceBoundTimeFact.tasks[0].type, "amenity");

  const unverifiedSourceFact = sourceBoundSemantic(task({
    taskId: "unverified-source",
    type: "availability",
    category: "other",
    rawText: "",
    sourceText: "pool schedule",
    detailIntent: "time"
  }), { evidenceEventId: "wrong-event" });
  assert.equal(unverifiedSourceFact.tasks[0].entity.canonicalCandidate, null, "an unverified source must never ground a property fact");
  assert.equal(unverifiedSourceFact.tasks[0].type, "availability");

  const ambiguousSourceFact = sourceBoundSemantic(task({
    taskId: "ambiguous-source",
    type: "availability",
    category: "other",
    rawText: "",
    sourceText: "pool and shared kitchen schedule",
    detailIntent: "time"
  }));
  assert.equal(ambiguousSourceFact.tasks[0].entity.canonicalCandidate, null, "a task source naming multiple formal facts must remain unresolved");
  assert.equal(ambiguousSourceFact.tasks[0].type, "availability");

  const unrelatedEntitySourceFact = sourceBoundSemantic(task({
    taskId: "unrelated-source-entity",
    type: "amenity",
    category: "room_feature",
    rawText: "sound insulation",
    sourceText: "pool schedule and sound insulation",
    detailIntent: "conditions"
  }));
  assert.equal(unrelatedEntitySourceFact.tasks[0].entity.canonicalCandidate, null, "a catalog mention elsewhere in the same task source must not replace an unrelated non-empty entity");
  assert.equal(unrelatedEntitySourceFact.tasks[0].type, "amenity");

  const sourceBoundPrice = sourceBoundSemantic(task({
    taskId: "source-bound-price",
    type: "price",
    category: "other",
    rawText: "",
    sourceText: "pool package amount",
    requestedOutputs: ["price"],
    dependsOnStayContext: true
  }));
  assert.equal(sourceBoundPrice.tasks[0].type, "price", "source-bound fact recovery must not erase an inventory price capability");
  assert.equal(sourceBoundPrice.tasks[0].entity.canonicalCandidate, null);

  const sourceBoundInventoryCatalog = buildPropertyCatalog({
    ...property,
    rooms: [
      { id: "inventory-room-a", name: "Garden Family Room", type: "family", description: "Deep soaking tub", capacity: 4, enabled: true },
      { id: "inventory-bundle-a", name: "Courtyard Group Lodge", type: "whole house", inventoryType: "bundle", capacity: 10, enabled: true }
    ]
  });
  const sourceBoundTypoBundleMessage = "We want Courtyard Group Lodgd; confirm the lodging amount when the shared activity is not used.";
  const sourceBoundTypoBundlePrice = sourceBoundSemantic(task({
    taskId: "source-bound-typo-bundle-price",
    type: "price",
    category: "policy",
    rawText: "shared activity",
    sourceText: sourceBoundTypoBundleMessage,
    canonicalCandidate: "pool",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "8/20", kind: "absolute", anchor: "message_time" },
      checkInCandidate: "2026-08-20",
      checkOutCandidate: null,
      nightsCandidate: 1,
      guestCountCandidate: null
    }
  }), { message: sourceBoundTypoBundleMessage, catalogOverride: sourceBoundInventoryCatalog });
  assert.equal(sourceBoundTypoBundlePrice.tasks[0].entity.category, "bundle", "one-character guest drift may recover only a unique formal inventory name");
  assert.equal(sourceBoundTypoBundlePrice.tasks[0].entity.canonicalCandidate, "inventory-bundle-a");
  const genericTypeCatalog = buildPropertyCatalog({
    ...property,
    rooms: [{ id: "generic-suite-a", name: "Garden Suite A", type: "suite", capacity: 2, enabled: true }]
  });
  const genericTypeMessage = "The lodging amount is quite uncertain.";
  const genericTypePrice = sourceBoundSemantic(task({
    taskId: "generic-type-price",
    type: "price",
    category: "policy",
    rawText: "lodging amount",
    sourceText: genericTypeMessage,
    canonicalCandidate: "price",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "8/20", kind: "absolute", anchor: "message_time" },
      checkInCandidate: "2026-08-20",
      checkOutCandidate: null,
      nightsCandidate: 1,
      guestCountCandidate: null
    }
  }), { message: genericTypeMessage, catalogOverride: genericTypeCatalog });
  assert.equal(genericTypePrice.tasks[0].entity.category, "other", "one-substitution recovery must never use a short generic room type inside an unrelated word");
  assert.equal(genericTypePrice.tasks[0].entity.canonicalCandidate, null);
  const sourceBoundFaqCatalog = buildPropertyCatalog({
    ...property,
    rooms: [{ id: "faq-room-a", name: "Garden Family Room", type: "family", capacity: 4, enabled: true }],
    faqs: [{ knowledgeKey: "bathing_fixture", question: "Which rooms include a deep soaking tub?", answer: "The formal room record must decide this detail." }]
  });
  const sourceBoundFaqFeatureMessage = "Does Garden Family Room include Deep soaking tub?";
  const sourceBoundFaqFeature = sourceBoundSemantic(task({
    taskId: "source-bound-faq-room-feature",
    type: "availability",
    category: "room",
    rawText: "Garden Family Room",
    sourceText: sourceBoundFaqFeatureMessage,
    canonicalCandidate: "faq-room-a",
    requestedOutputs: ["availability"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }), { message: sourceBoundFaqFeatureMessage, catalogOverride: sourceBoundFaqCatalog });
  assert.equal(sourceBoundFaqFeature.tasks[0].type, "availability", "an FAQ fragment must not recover a room-feature capability");
  assert.equal(sourceBoundFaqFeature.tasks[0].entity.canonicalCandidate, "faq-room-a");
  const unrelatedFaqCatalog = buildPropertyCatalog({
    ...property,
    rooms: [{ id: "unrelated-faq-room", name: "Garden Family Room", type: "family", capacity: 4, enabled: true }],
    faqs: [{ knowledgeKey: "garden_access", question: "Is there garden access?", answer: "Garden access depends on the formal property record." }]
  });
  const unrelatedFaqMessage = "Is Garden Family Room available?";
  const unrelatedFaqAvailability = sourceBoundSemantic(task({
    taskId: "unrelated-faq-availability",
    type: "availability",
    category: "room",
    rawText: "Garden Family Room",
    sourceText: unrelatedFaqMessage,
    canonicalCandidate: "unrelated-faq-room",
    requestedOutputs: ["availability"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }), { message: unrelatedFaqMessage, catalogOverride: unrelatedFaqCatalog });
  assert.equal(unrelatedFaqAvailability.tasks[0].type, "availability", "one shared ordinary word with a formal FAQ must not erase room availability");
  const ambiguousSourceBoundFaqCatalog = buildPropertyCatalog({
    ...property,
    rooms: [{ id: "ambiguous-faq-room", name: "Garden Family Room", type: "family", capacity: 4, enabled: true }],
    faqs: [
      { knowledgeKey: "room_bathing_fixture", question: "Which rooms include a deep soaking tub?", answer: "Room fixture record." },
      { knowledgeKey: "suite_bathing_fixture", question: "Which suites include a deep soaking tub?", answer: "Suite fixture record." }
    ]
  });
  const ambiguousSourceBoundFaqFeature = sourceBoundSemantic(task({
    taskId: "ambiguous-source-bound-faq-room-feature",
    type: "availability",
    category: "room",
    rawText: "Garden Family Room",
    sourceText: sourceBoundFaqFeatureMessage,
    canonicalCandidate: "ambiguous-faq-room",
    requestedOutputs: ["availability"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }), { message: sourceBoundFaqFeatureMessage, catalogOverride: ambiguousSourceBoundFaqCatalog });
  assert.equal(ambiguousSourceBoundFaqFeature.tasks[0].type, "availability", "tied formal fact fragments must remain fail-closed");
  const sourceBoundFeatureMessage = "Does Garden Family Room include Deep soaking tub?";
  const sourceBoundFeature = sourceBoundSemantic(task({
    taskId: "source-bound-room-feature",
    type: "availability",
    category: "room",
    rawText: "Garden Family Room",
    sourceText: sourceBoundFeatureMessage,
    canonicalCandidate: "inventory-room-a",
    requestedOutputs: ["availability"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }), { message: sourceBoundFeatureMessage, catalogOverride: sourceBoundInventoryCatalog });
  assert.equal(sourceBoundFeature.tasks[0].type, "amenity", "a verified formal room-feature mention without stay intent must not become a room-availability request");
  assert.equal(sourceBoundFeature.tasks[0].entity.category, "amenity");
  assert.equal(sourceBoundFeature.tasks[0].entity.rawText, "Garden Family Room", "feature recovery must preserve the guest's room subject instead of asserting that another room's feature applies");
  assert.equal(sourceBoundFeature.tasks[0].entity.canonicalCandidate, null, "feature recovery must remain formally unknown when the requested room has no matching formal feature");
  assert.ok(sourceBoundFeature.semanticValidation.repairedTasks.some((item) => item.reason === "source_bound_inventory_feature_capability"));

  const datedFeatureAvailability = sourceBoundSemantic(task({
    taskId: "dated-room-feature-availability",
    type: "availability",
    category: "room",
    rawText: "Garden Family Room",
    sourceText: "Is Garden Family Room with Deep soaking tub available on 8/20?",
    canonicalCandidate: "inventory-room-a",
    requestedOutputs: ["availability"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "8/20", kind: "absolute", anchor: "message_time" },
      checkInCandidate: "2026-08-20",
      checkOutCandidate: null,
      nightsCandidate: 1,
      guestCountCandidate: null
    }
  }), { message: "Is Garden Family Room with Deep soaking tub available on 8/20?", catalogOverride: sourceBoundInventoryCatalog });
  assert.equal(datedFeatureAvailability.tasks[0].type, "availability", "an explicit stay constraint must keep a feature-filtered inventory request stateful");
  assert.equal(datedFeatureAvailability.tasks[0].entity.canonicalCandidate, "inventory-room-a");

  const unverifiedRoomFeature = sourceBoundSemantic(task({
    taskId: "unverified-room-feature",
    type: "availability",
    category: "room",
    rawText: "Garden Family Room",
    sourceText: sourceBoundFeatureMessage,
    canonicalCandidate: "inventory-room-a",
    requestedOutputs: ["availability"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }), { message: sourceBoundFeatureMessage, evidenceEventId: "wrong-event", catalogOverride: sourceBoundInventoryCatalog });
  assert.equal(unverifiedRoomFeature.tasks[0].type, "availability", "unverified text must never change an inventory capability");

  const topLevelDatedFeaturePlan = plan([task({
    taskId: "top-level-dated-room-feature",
    type: "availability",
    category: "room",
    rawText: "Garden Family Room",
    sourceText: sourceBoundFeatureMessage,
    canonicalCandidate: "inventory-room-a",
    requestedOutputs: ["availability"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  })]);
  topLevelDatedFeaturePlan.stay = {
    dateExpression: { rawText: "8/20", kind: "absolute", anchor: "message_time" },
    checkInCandidate: "2026-08-20",
    checkOutCandidate: null,
    nightsCandidate: 1,
    guestCountCandidate: null
  };
  topLevelDatedFeaturePlan.contextRelationCandidates[0].evidenceRefs = [{
    eventId: "top-level-dated-event",
    messageRef: "",
    startOffset: 0,
    endOffset: sourceBoundFeatureMessage.length,
    quote: sourceBoundFeatureMessage
  }];
  const topLevelDatedFeature = applyPlannerSemanticContract(topLevelDatedFeaturePlan, {
    catalog: sourceBoundInventoryCatalog,
    sourceEvents: [{ eventId: "top-level-dated-event", messageRef: "", messageText: sourceBoundFeatureMessage }]
  });
  assert.equal(topLevelDatedFeature.tasks[0].type, "availability", "an empty task stay object must not mask a populated top-level stay authority");
  assert.equal(topLevelDatedFeature.tasks[0].entity.canonicalCandidate, "inventory-room-a");

  const sourceBoundBundleMessage = "We want Courtyard Group Lodge; confirm the lodging amount when the shared activity is not used.";
  const sourceBoundBundlePrice = sourceBoundSemantic(task({
    taskId: "source-bound-bundle-price",
    type: "price",
    category: "policy",
    rawText: "shared activity",
    sourceText: sourceBoundBundleMessage,
    canonicalCandidate: "pool",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "8/20", kind: "absolute", anchor: "message_time" },
      checkInCandidate: "2026-08-20",
      checkOutCandidate: null,
      nightsCandidate: 1,
      guestCountCandidate: null
    }
  }), { message: sourceBoundBundleMessage, catalogOverride: sourceBoundInventoryCatalog });
  assert.equal(sourceBoundBundlePrice.tasks[0].type, "price");
  assert.equal(sourceBoundBundlePrice.tasks[0].entity.category, "bundle", "a verified unique catalog bundle must scope an explicitly stateful lodging-price task");
  assert.equal(sourceBoundBundlePrice.tasks[0].entity.canonicalCandidate, "inventory-bundle-a");
  assert.ok(sourceBoundBundlePrice.semanticValidation.repairedTasks.some((item) => item.reason === "source_bound_inventory_scope_preservation"));

  const unverifiedBundlePrice = sourceBoundSemantic(task({
    taskId: "unverified-bundle-price",
    type: "price",
    category: "policy",
    rawText: "shared activity",
    sourceText: sourceBoundBundleMessage,
    canonicalCandidate: "pool",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "8/20", kind: "absolute", anchor: "message_time" },
      checkInCandidate: "2026-08-20",
      checkOutCandidate: null,
      nightsCandidate: 1,
      guestCountCandidate: null
    }
  }), { message: sourceBoundBundleMessage, evidenceEventId: "wrong-event", catalogOverride: sourceBoundInventoryCatalog });
  assert.equal(unverifiedBundlePrice.tasks[0].entity.category, "other", "unverified source text must leave a contradictory stateful entity ungrounded");
  assert.equal(unverifiedBundlePrice.tasks[0].entity.canonicalCandidate, null);

  const ambiguousInventoryCatalog = buildPropertyCatalog({
    ...property,
    rooms: [
      { id: "inventory-bundle-east", name: "East Group Lodge", type: "whole house east", inventoryType: "bundle", capacity: 8, enabled: true },
      { id: "inventory-bundle-west", name: "West Group Lodge", type: "whole house west", inventoryType: "bundle", capacity: 8, enabled: true }
    ]
  });
  const ambiguousBundleMessage = "Compare East Group Lodge and West Group Lodge lodging amounts.";
  const ambiguousBundlePrice = sourceBoundSemantic(task({
    taskId: "ambiguous-source-bound-bundle-price",
    type: "price",
    category: "policy",
    rawText: "shared activity",
    sourceText: ambiguousBundleMessage,
    canonicalCandidate: "pool",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "8/20", kind: "absolute", anchor: "message_time" },
      checkInCandidate: "2026-08-20",
      checkOutCandidate: null,
      nightsCandidate: 1,
      guestCountCandidate: null
    }
  }), { message: ambiguousBundleMessage, catalogOverride: ambiguousInventoryCatalog });
  assert.equal(ambiguousBundlePrice.tasks[0].entity.category, "other", "multiple formal inventory mentions must not choose a lodging scope");
  assert.equal(ambiguousBundlePrice.tasks[0].entity.canonicalCandidate, null);

  const sourceBoundAmenityFee = sourceBoundSemantic(task({
    taskId: "source-bound-amenity-fee",
    type: "policy",
    category: "amenity",
    rawText: "pool",
    sourceText: sourceBoundBundleMessage,
    canonicalCandidate: "pool",
    detailIntent: "fee",
    requestedOutputs: ["fee"],
    dependsOnStayContext: false
  }), { message: sourceBoundBundleMessage, catalogOverride: sourceBoundInventoryCatalog });
  assert.notEqual(sourceBoundAmenityFee.tasks[0].type, "price", "a stateless amenity fee must never be promoted into lodging price");
  assert.notEqual(sourceBoundAmenityFee.tasks[0].entity.category, "bundle");

  const multiTaskMessage = "Garden Suite A has a feature. Confirm the lodging amount.";
  const multiTaskPlan = plan([
    task({
      taskId: "multi-task-price",
      type: "price",
      category: "policy",
      rawText: "lodging amount",
      sourceText: "Confirm the lodging amount.",
      canonicalCandidate: "price",
      requestedOutputs: ["price"],
      dependsOnStayContext: true,
      stayCandidate: {
        dateExpression: { rawText: "8/20", kind: "absolute", anchor: "message_time" },
        checkInCandidate: "2026-08-20",
        checkOutCandidate: null,
        nightsCandidate: 1,
        guestCountCandidate: null
      }
    }),
    { ...task({ taskId: "multi-task-feature", type: "amenity", category: "room_feature", rawText: "feature", sourceText: "Garden Suite A has a feature." }), candidateIndex: 1 }
  ]);
  multiTaskPlan.contextRelationCandidates.forEach((candidate) => {
    candidate.evidenceRefs = [{ eventId: "multi-task-event", messageRef: "", startOffset: 0, endOffset: multiTaskMessage.length, quote: multiTaskMessage }];
  });
  const isolatedMultiTask = applyPlannerSemanticContract(multiTaskPlan, {
    catalog: genericTypeCatalog,
    sourceEvents: [{ eventId: "multi-task-event", messageRef: "", messageText: multiTaskMessage }]
  });
  assert.equal(isolatedMultiTask.tasks[0].entity.category, "other", "one task must not borrow a different task clause's room scope from the complete evidence quote");
  assert.equal(isolatedMultiTask.tasks[0].entity.canonicalCandidate, null);

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

  const sameTurnMessage = "Check one stay, two guests, and one supplied amenity.";
  const sameTurnEvent = { eventId: "same-turn-event", messageRef: "", messageText: sameTurnMessage };
  const sameTurnPlan = plan([
    task({ taskId: "same-turn-stay", type: "availability", category: "room", rawText: "one stay", sourceText: sameTurnMessage }),
    { ...task({ taskId: "same-turn-guests", type: "availability", category: "room", rawText: "two guests", sourceText: sameTurnMessage, detailIntent: "quantity" }), candidateIndex: 1 },
    { ...task({ taskId: "same-turn-amenity", type: "amenity", category: "amenity", rawText: "supplied amenity", sourceText: sameTurnMessage }), candidateIndex: 2 }
  ]);
  sameTurnPlan.contextRelationCandidates.forEach((candidate) => {
    candidate.evidenceRefs = [{ eventId: sameTurnEvent.eventId, messageRef: "", startOffset: 0, endOffset: sameTurnMessage.length, quote: sameTurnMessage }];
    if (candidate.candidateIndex > 0) candidate.kind = "supplement_existing";
  });
  const repairedSameTurn = applyPlannerSemanticContract(sameTurnPlan, { catalog, sourceEvents: [sameTurnEvent] });
  assert.deepEqual(repairedSameTurn.contextRelationCandidates.map((candidate) => candidate.kind), ["new_request", "new_request", "new_request"], "unreferenced same-message supplements in an explicit new request must remain independently executable new tasks");
  assert.deepEqual(repairedSameTurn.semanticValidation.repairedRelations.map((item) => item.reason), ["unreferenced_same_turn_supplement", "unreferenced_same_turn_supplement"]);
  assert.equal(validateUnderstandingContext(repairedSameTurn, { cycles: [] }, { sourceEvents: [sameTurnEvent] }).ok, true, "the repaired tasks must pass the strict context validator");
  const continuationPlan = JSON.parse(JSON.stringify(sameTurnPlan));
  continuationPlan.discourse.relation = "continue";
  const retainedContinuation = applyPlannerSemanticContract(continuationPlan, { catalog, sourceEvents: [sameTurnEvent] });
  assert.equal(retainedContinuation.contextRelationCandidates[1].kind, "supplement_existing", "a continuation must not be rewritten as a new request");
  const referencedPlan = JSON.parse(JSON.stringify(sameTurnPlan));
  referencedPlan.contextRelationCandidates[1].candidateRequestCycleRefs = ["missing-cycle"];
  const retainedReference = applyPlannerSemanticContract(referencedPlan, { catalog, sourceEvents: [sameTurnEvent] });
  assert.equal(retainedReference.contextRelationCandidates[1].kind, "supplement_existing", "the compiler must not discard a claimed cycle reference");
  const unverifiedRelationPlan = JSON.parse(JSON.stringify(sameTurnPlan));
  unverifiedRelationPlan.contextRelationCandidates[1].evidenceRefs[0].eventId = "wrong-event";
  const retainedUnverifiedRelation = applyPlannerSemanticContract(unverifiedRelationPlan, { catalog, sourceEvents: [sameTurnEvent] });
  assert.equal(retainedUnverifiedRelation.contextRelationCandidates[1].kind, "supplement_existing", "unverified evidence must remain fail-closed");

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
  console.log(JSON.stringify({ suite: "planner-semantic-contract", caseCount: 42 + contradictoryFieldCaseCount, passCount: 42 + contradictoryFieldCaseCount, failCount: 0 }));
}

main();
