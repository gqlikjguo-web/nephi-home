"use strict";

const assert = require("node:assert/strict");
const { applyPlannerSemanticContract, normalizeDuplicateTaskIds, plannerJsonSchema, plannerProviderJsonSchema, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const eventTimestamp = Date.parse("2026-08-01T10:00:00+08:00");

function assertOpenAiStructuredOutputObjectRequirements(node, path = "$") {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes("object")) {
    assert.equal(node.additionalProperties, false, `${path}: OpenAI strict object must forbid additional properties`);
    assert.ok(node.properties && typeof node.properties === "object" && !Array.isArray(node.properties), `${path}: OpenAI strict object must declare properties`);
    assert.deepEqual(
      [...(node.required || [])].sort(),
      Object.keys(node.properties).sort(),
      `${path}: OpenAI strict object required must include every properties key`
    );
  }
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === "object") assertOpenAiStructuredOutputObjectRequirements(value, `${path}.${key}`);
  }
}

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
  return migrateFakePlannerOutput({
    schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks, contextRelationCandidates: tasks.map((item) => ({ candidateIndex: item.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [] })),
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "semantic_contract_test"
  });
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
      assert.equal(result.semantic.tasks[0].entity.category, "policy");
      assert.equal(result.semantic.tasks[0].entity.canonicalCandidate, "pool");
      assert.equal(result.item.canonicalRequest.capability, "unknown");
    }],
    ["unambiguous inventory output repairs an ungrounded low-risk task", () => {
      const result = canonical(task({
        taskId: "lodging-amount",
        type: "policy",
        category: "policy",
        rawText: "quoted lodging amount",
        requestedOutputs: ["price"]
      }));
      assert.equal(result.semantic.tasks[0].type, "policy");
      assert.equal(result.semantic.tasks[0].dependsOnStayContext, false);
      assert.equal(result.item.canonicalRequest.capability, "policy");
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
      assert.equal(result.semantic.tasks[0].type, "availability");
      assert.equal(result.item.canonicalRequest.capability, "unknown");
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
      assert.equal(result.semantic.tasks[0].type, "amenity");
      assert.equal(result.item.canonicalRequest.capability, "amenity");
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
      assert.equal(result.semantic.tasks[0].type, "availability");
      assert.equal(result.semantic.tasks[0].entity.category, "other");
      assert.equal(result.item.canonicalRequest.capability, "availability");
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
      assert.ok(!result.semantic.semanticValidation.repairedTasks.some((item) => item.reason === "resolved_inventory_detail_scope_preservation"), "core must not reclassify a Planner task from source-derived semantics");
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
      assert.equal(result.semantic.tasks[0].type, "amenity");
      assert.equal(result.semantic.tasks[0].entity.canonicalCandidate, "pool");
      assert.equal(result.item.canonicalRequest.capability, "pool");
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
      assert.equal(result.semantic.tasks[0].type, "policy");
      assert.equal(result.semantic.tasks[0].entity.canonicalCandidate, "pool");
      assert.equal(result.item.canonicalRequest.capability, "policy");
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
  const incoherentSourceIdentity = sourceBoundSemantic(task({
    taskId: "source-identity-conflict",
    type: "amenity",
    category: "room_feature",
    rawText: "private in-room leisure fixture",
    canonicalCandidate: "bbq"
  }));
  assert.equal(incoherentSourceIdentity.tasks[0].type, "unknown", "a substantive source-bound raw entity must fail closed when it cannot uniquely ground to the supplied catalog identity");
  assert.equal(incoherentSourceIdentity.tasks[0].entity.canonicalCandidate, null, "an unrelated but valid catalog identity must not replace ungrounded source identity");
  assert.ok(
    incoherentSourceIdentity.semanticValidation.rejectedTasks.some((item) => item.taskId === "source-identity-conflict" && item.reason === "property_catalog_entity_conflict"),
    "the source/raw/canonical coherence rejection must remain visible"
  );
  const incoherentCanonical = canonicalizeExecutionItem({
    item: {
      candidateIndex: 0,
      requestCycleId: "source-identity-conflict",
      task: incoherentSourceIdentity.tasks[0],
      transition: { approvedProduct: { productType: "any", productId: null, roomTypeId: null, bundleId: null } }
    },
    relation: null,
    contextSnapshot: { cycles: [] },
    catalog,
    guestMessage: "private in-room leisure fixture",
    eventTimestamp
  });
  assert.notEqual(incoherentCanonical.canonicalRequest.resolverId, "property_catalog", "an incoherent formal identity must not reach the property executor path");

  const conflictingResolvedIdentity = sourceBoundSemantic(task({
    taskId: "resolved-source-identity-conflict",
    type: "policy",
    category: "policy",
    rawText: "cancel",
    canonicalCandidate: "bbq"
  }));
  assert.equal(conflictingResolvedIdentity.tasks[0].type, "unknown", "a uniquely resolved source identity must fail closed when a same-category canonical candidate names a different fact");
  assert.equal(conflictingResolvedIdentity.tasks[0].entity.canonicalCandidate, null);

  const coherentSourceIdentity = sourceBoundSemantic(task({
    taskId: "source-identity-coherent",
    type: "property_fact",
    category: "policy",
    rawText: "barbecue",
    canonicalCandidate: "bbq"
  }));
  assert.equal(coherentSourceIdentity.tasks[0].entity.canonicalCandidate, "bbq", "a source alias and matching canonical identity must remain valid");
  assert.notEqual(coherentSourceIdentity.tasks[0].type, "unknown");

  const policyCategoryCatalog = buildPropertyCatalog({
    ...property,
    commonAnswers: { ...property.commonAnswers, checkInTime: "15:00", checkOutTime: "11:00" }
  });
  for (const [canonicalCandidate, category, rawText] of [
    ["check_in", "check_in", "入住"],
    ["check_out", "check_out", "退房"]
  ]) {
    const sameCanonicalPolicyFact = sourceBoundSemantic(task({
      taskId: `same-canonical-policy-category-${canonicalCandidate}`,
      type: "policy",
      category,
      rawText,
      canonicalCandidate,
      detailIntent: "time"
    }), { catalogOverride: policyCategoryCatalog });
    assert.equal(sameCanonicalPolicyFact.tasks[0].type, "policy");
    assert.equal(sameCanonicalPolicyFact.tasks[0].entity.category, "policy", "a unique current-property canonical fact must use its formal catalog category");
    assert.equal(sameCanonicalPolicyFact.tasks[0].entity.canonicalCandidate, canonicalCandidate);
    const canonicalized = canonicalizeExecutionItem({
      item: {
        candidateIndex: 0,
        requestCycleId: sameCanonicalPolicyFact.tasks[0].taskId,
        task: sameCanonicalPolicyFact.tasks[0],
        transition: { approvedProduct: { productType: "any", productId: null, roomTypeId: null, bundleId: null } }
      },
      relation: null,
      contextSnapshot: { cycles: [] },
      catalog: policyCategoryCatalog,
      guestMessage: rawText,
      eventTimestamp
    });
    assert.equal(canonicalized.canonicalRequest.canonicalEntity.status, "resolved");
    assert.equal(canonicalized.canonicalRequest.canonicalEntity.canonicalId, canonicalCandidate);
    assert.equal(canonicalized.canonicalRequest.resolverId, "property_catalog");
  }

  const nestedIdentityCatalog = buildPropertyCatalog({
    ...property,
    commonAnswers: { ...property.commonAnswers, checkInTime: "15:00", latestArrivalTime: "22:00", checkOutTime: "11:00" }
  });
  const nestedSpecificIdentity = sourceBoundSemantic(task({
    taskId: "nested-specific-source-identity",
    type: "policy",
    category: "policy",
    rawText: "最晚入住時間",
    canonicalCandidate: "check_in__latest_arrival_policy",
    detailIntent: "latest_arrival_policy"
  }), { catalogOverride: nestedIdentityCatalog });
  assert.equal(nestedSpecificIdentity.tasks[0].entity.canonicalCandidate, "check_in__latest_arrival_policy", "a uniquely resolved specific source identity must not conflict merely because its text also contains a generic parent alias");
  assert.notEqual(nestedSpecificIdentity.tasks[0].type, "unknown");

  const earlyArrivalCatalog = buildPropertyCatalog({
    ...property,
    commonAnswers: {
      ...property.commonAnswers,
      checkInTime: "15:00",
      early_checkin: "Early arrival requires confirmation."
    }
  });
  const earlyArrivalDetailIdentity = sourceBoundSemantic(task({
    taskId: "base-topic-detail-identity",
    type: "policy",
    category: "policy",
    rawText: "下午1點入住",
    canonicalCandidate: "early_checkin",
    detailIntent: "early_arrival_policy"
  }), { catalogOverride: earlyArrivalCatalog });
  assert.equal(earlyArrivalDetailIdentity.tasks[0].type, "policy", "a formal detail fact must retain the registered property-policy capability");
  assert.equal(earlyArrivalDetailIdentity.tasks[0].entity.canonicalCandidate, "check_in", "a formal detail fact must bind to its uniquely source-grounded base topic");
  assert.equal(earlyArrivalDetailIdentity.tasks[0].detailIntent, "early_arrival_policy", "base-topic grounding must preserve the controlled detail intent");
  assert.equal(earlyArrivalDetailIdentity.tasks[0].entity.rawText, "下午1點入住", "base-topic grounding must preserve current source evidence");

  const lateDepartureCatalog = buildPropertyCatalog({
    ...property,
    commonAnswers: {
      ...property.commonAnswers,
      checkOutTime: "11:00",
      late_checkout: "Late departure requires confirmation."
    }
  });
  const lateDepartureDetailIdentity = sourceBoundSemantic(task({
    taskId: "checkout-base-topic-detail-identity",
    type: "policy",
    category: "policy",
    rawText: "下午1點退房",
    canonicalCandidate: "late_checkout",
    detailIntent: "late_departure_policy"
  }), { catalogOverride: lateDepartureCatalog });
  assert.equal(lateDepartureDetailIdentity.tasks[0].type, "policy");
  assert.equal(lateDepartureDetailIdentity.tasks[0].entity.canonicalCandidate, "check_out");
  assert.equal(lateDepartureDetailIdentity.tasks[0].detailIntent, "late_departure_policy");

  const propertyWithoutDetail = buildPropertyCatalog({
    ...property,
    propertyId: "property_without_detail",
    commonAnswers: { ...property.commonAnswers, checkOutTime: "10:00" }
  });
  const missingCurrentPropertyDetail = sourceBoundSemantic(task({
    taskId: "missing-current-property-detail",
    type: "policy",
    category: "policy",
    rawText: "下午1點退房",
    canonicalCandidate: "late_checkout",
    detailIntent: "late_departure_policy"
  }), { catalogOverride: propertyWithoutDetail });
  assert.notEqual(missingCurrentPropertyDetail.tasks[0].entity.canonicalCandidate, "check_out", "a detail fact from another property must not authorize base-topic grounding");

  const exactStay = {
    dateExpression: { rawText: "8/14-8/15", kind: "range", anchor: "message_time" },
    checkInCandidate: "2026-08-14", checkOutCandidate: "2026-08-15", nightsCandidate: 1, guestCountCandidate: 7
  };
  const uncertainGuestPlan = plan([task({
    taskId: "uncertain-guest-count",
    type: "availability",
    category: "other",
    rawText: "8/14-8/15 人數大概6-8人",
    requestedOutputs: ["availability"],
    dependsOnStayContext: true,
    stayCandidate: exactStay
  })]);
  uncertainGuestPlan.stay = { ...exactStay, guestCountCandidate: null };
  uncertainGuestPlan.missingInformation = ["exact guest count"];
  uncertainGuestPlan.semanticCandidates[0].lodgingScopeCandidate = {
    scopeId: "80000000-0000-4000-8000-000000000001",
    bundleCanonicalCandidate: null,
    roomCanonicalCandidates: [],
    guestCountCandidate: 7
  };
  const uncertainGuest = applyPlannerSemanticContract(uncertainGuestPlan, { catalog });
  assert.equal(uncertainGuest.tasks[0].stayCandidate.guestCountCandidate, null, "a task-level integer must not become confirmed when the Planner's shared stay certainty leaves guest count unresolved");
  assert.equal(uncertainGuest.semanticCandidates[0].lodgingScopeCandidate.guestCountCandidate, null, "the owned lodging scope must not retain a guest count rejected by the certainty contract");
  assert.equal(uncertainGuest.tasks[0].stayCandidate.checkInCandidate, "2026-08-14", "guest certainty rejection must preserve temporal evidence");
  assert.equal(uncertainGuest.tasks[0].stayCandidate.checkOutCandidate, "2026-08-15", "guest certainty rejection must preserve the date range");

  const exactGuestPlan = plan([task({
    taskId: "exact-guest-count",
    type: "availability",
    category: "other",
    rawText: "8/14-8/15 7人",
    requestedOutputs: ["availability"],
    dependsOnStayContext: true,
    stayCandidate: exactStay
  })]);
  exactGuestPlan.stay = { ...exactStay };
  exactGuestPlan.semanticCandidates[0].lodgingScopeCandidate = {
    scopeId: "80000000-0000-4000-8000-000000000002",
    bundleCanonicalCandidate: null,
    roomCanonicalCandidates: [],
    guestCountCandidate: 7
  };
  const exactGuest = applyPlannerSemanticContract(exactGuestPlan, { catalog });
  assert.equal(exactGuest.tasks[0].stayCandidate.guestCountCandidate, 7, "a cross-representation exact guest count must remain confirmed");
  assert.equal(exactGuest.semanticCandidates[0].lodgingScopeCandidate.guestCountCandidate, 7, "an exact guest count must remain coherent in the owned lodging scope");

  const resolvedLocation = canonical(task({ taskId: "map", category: "transport", rawText: "directions" }));
  assert.equal(resolvedLocation.semantic.tasks[0].entity.canonicalCandidate, null, "core must not infer a canonical identity from a raw alias omitted by the Planner");
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
  assert.equal(policyCandidateWithAmenityShape.semantic.tasks[0].type, "amenity", "core must preserve the Planner capability instead of repairing it from a catalog alias");
  assert.equal(policyCandidateWithAmenityShape.semantic.tasks[0].entity.category, "policy");
  assert.equal(policyCandidateWithAmenityShape.item.canonicalRequest.capability, "unknown");
  assert.equal(policyCandidateWithAmenityShape.item.canonicalRequest.resolverId, "human_handoff");

  for (const [id, category, rawText, expectedCapability] of [
    ["parking", "amenity", "parking", "parking"],
    ["pool", "amenity", "pool", "pool"],
    ["bbq", "policy", "bbq", "bbq"]
  ]) {
    const result = canonical(task({ taskId: id, type: "property_fact", category, rawText }));
    assert.equal(result.semantic.tasks[0].entity.canonicalCandidate, null, `${id} raw aliases must not be promoted into Planner-omitted canonical identities`);
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
  assert.equal(resolvedPrice.semantic.tasks[0].entity.category, "policy");
  assert.equal(resolvedPrice.item.canonicalRequest.capability, "unknown");
  assert.equal(resolvedPrice.item.canonicalRequest.resolverId, "human_handoff");

  const ungroundedPrice = canonical(task({
    taskId: "generic-amount",
    type: "price",
    category: "policy",
    rawText: "quoted amount",
    requestedOutputs: ["price"]
  }));
  assert.equal(ungroundedPrice.semantic.tasks[0].type, "price");
  assert.equal(ungroundedPrice.semantic.tasks[0].entity.category, "policy", "core must preserve Planner structure instead of repairing category from capability");
  assert.equal(ungroundedPrice.item.canonicalRequest.capability, "unknown");

  const bundlePriceOutput = canonical(task({
    taskId: "package-amount",
    type: "bundle_availability",
    category: "bundle",
    rawText: "lodging package",
    requestedOutputs: ["price"]
  }));
  assert.equal(bundlePriceOutput.semantic.tasks[0].type, "bundle_availability", "requested outputs must not cause capability reclassification");
  assert.equal(bundlePriceOutput.item.canonicalRequest.capability, "bundle_availability");

  const standaloneAmenityAvailability = canonical(task({
    taskId: "portable-cot-availability",
    type: "availability",
    category: "amenity",
    rawText: "",
    sourceText: "portable cot availability"
  }));
  assert.equal(standaloneAmenityAvailability.semantic.tasks[0].type, "availability", "core must preserve the Planner capability");
  assert.equal(standaloneAmenityAvailability.semantic.tasks[0].entity.category, "amenity");
  assert.equal(validatePlannerOutput(standaloneAmenityAvailability.semantic).ok, true, "normalized generic amenity tasks must remain schema-valid");
  assert.equal(standaloneAmenityAvailability.item.canonicalRequest.capability, "unknown");

  const standalonePolicyAvailability = canonical(task({
    taskId: "assisted-service-availability",
    type: "availability",
    category: "policy",
    rawText: "assisted service"
  }));
  assert.equal(standalonePolicyAvailability.semantic.tasks[0].type, "availability", "core must preserve the Planner capability");
  assert.equal(standalonePolicyAvailability.semantic.tasks[0].entity.category, "policy");
  assert.equal(standalonePolicyAvailability.item.canonicalRequest.capability, "unknown");

  const amenityShapedPolicy = canonical(task({
    taskId: "shared-equipment-hours",
    type: "policy",
    category: "amenity",
    rawText: "",
    sourceText: "shared equipment hours",
    detailIntent: "usage_restrictions"
  }));
  assert.equal(amenityShapedPolicy.semantic.tasks[0].type, "policy");
  assert.equal(amenityShapedPolicy.semantic.tasks[0].entity.category, "amenity", "core must not repair category from capability");
  assert.equal(amenityShapedPolicy.item.canonicalRequest.capability, "policy");

  const faqFragment = canonical(task({
    taskId: "shared-kitchen",
    type: "amenity",
    category: "amenity",
    rawText: "kitchen"
  }));
  assert.equal(faqFragment.semantic.tasks[0].entity.canonicalCandidate, null, "a FAQ fragment must not recover a formal property fact");
  assert.equal(faqFragment.item.canonicalRequest.capability, "amenity", "an unresolved FAQ fragment must retain the Planner capability and fail closed");

  const registeredFaqCatalog = buildPropertyCatalog({
    propertyId: "registered-faq-property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    faqs: [{ knowledgeKey: "pool", question: "What is the pool fee?", answer: "Confirmed pool policy." }],
    semanticCatalog: { aliases: { pool: ["pool"] } }
  });
  const registeredFaqSource = "What is the pool fee";
  const registeredFaqSemantic = sourceBoundSemantic(task({
    taskId: "registered-faq-fee-drift",
    type: "price",
    category: "policy",
    rawText: "fee",
    sourceText: registeredFaqSource,
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }
  }), { message: registeredFaqSource, catalogOverride: registeredFaqCatalog });
  const registeredFaqTask = registeredFaqSemantic.tasks[0];
  assert.equal(registeredFaqTask.type, "price", "catalog wording must not replace the Planner's structured capability");
  assert.equal(registeredFaqTask.entity.canonicalCandidate, null, "catalog wording must not invent a canonical identity omitted by the Planner");
  assert.equal(registeredFaqSemantic.semanticValidation.repairedTasks.some((repair) => repair.taskId === registeredFaqTask.taskId && repair.reason === "registered_faq_capability_grounding"), false);
  const mixedRegisteredSource = "What is the lodging price and pool fee";
  const mixedPriceTask = task({ taskId: "mixed-lodging-price", type: "price", category: "policy", rawText: "fee", sourceText: mixedRegisteredSource, requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null } });
  const mixedPoolTask = task({ taskId: "mixed-pool", type: "property_fact", category: "amenity", rawText: "pool", sourceText: "pool fee", canonicalCandidate: "pool" });
  mixedPoolTask.candidateIndex = 1;
  const mixedRegisteredPlan = plan([mixedPriceTask, mixedPoolTask]);
  mixedRegisteredPlan.contextRelationCandidates = [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "mixed-registered", messageRef: "", startOffset: 0, endOffset: mixedRegisteredSource.length, quote: mixedRegisteredSource }] },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "mixed-registered", messageRef: "", startOffset: mixedRegisteredSource.indexOf("pool fee"), endOffset: mixedRegisteredSource.length, quote: "pool fee" }] }
  ];
  const mixedRegisteredSemantic = applyPlannerSemanticContract(mixedRegisteredPlan, { catalog: registeredFaqCatalog, sourceEvents: [{ eventId: "mixed-registered", messageText: mixedRegisteredSource }] });
  assert.equal(mixedRegisteredSemantic.tasks.find((item) => item.taskId === "mixed-lodging-price").type, "price", "a source-bound FAQ sibling must not erase the legal lodging-price sibling");
  assert.equal(mixedRegisteredSemantic.tasks.find((item) => item.taskId === "mixed-pool").entity.canonicalCandidate, "pool");

  const conflictingRegisteredSemantic = sourceBoundSemantic(task({
    taskId: "conflicting-registered-faq",
    type: "price", category: "policy", rawText: "fee", canonicalCandidate: "bbq", sourceText: registeredFaqSource,
    requestedOutputs: ["price"], dependsOnStayContext: true,
    stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }
  }), { message: registeredFaqSource, catalogOverride: registeredFaqCatalog });
  assert.equal(conflictingRegisteredSemantic.tasks[0].type, "price", "a conflicting canonical candidate must block registered FAQ grounding");

  const multiRegisteredCatalog = buildPropertyCatalog({
    propertyId: "multi-registered-faq-property", timezone: "Asia/Taipei", rooms: [], commonAnswers: {},
    faqs: [
      { knowledgeKey: "pool", question: "Pool fee information", answer: "Pool policy." },
      { knowledgeKey: "bbq", question: "Barbecue fee information", answer: "BBQ policy." }
    ],
    semanticCatalog: { aliases: { pool: ["pool"], bbq: ["barbecue"] } }
  });
  const multiRegisteredSource = "pool fee and barbecue fee";
  const multiRegisteredSemantic = sourceBoundSemantic(task({
    taskId: "multi-registered-faq", type: "price", category: "policy", rawText: "fee", sourceText: multiRegisteredSource,
    requestedOutputs: ["price"], dependsOnStayContext: true,
    stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }
  }), { message: multiRegisteredSource, catalogOverride: multiRegisteredCatalog });
  assert.equal(multiRegisteredSemantic.tasks[0].type, "price", "multiple registered FAQ subjects must remain ambiguous and fail closed");
  assert.equal(multiRegisteredSemantic.tasks[0].entity.canonicalCandidate, null);
  const selectedMultiSemantic = sourceBoundSemantic(task({
    taskId: "selected-multi-registered-faq", type: "price", category: "policy", rawText: "fee", sourceText: multiRegisteredSource, canonicalCandidate: "pool",
    requestedOutputs: ["price"], dependsOnStayContext: true,
    stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }
  }), { message: multiRegisteredSource, catalogOverride: multiRegisteredCatalog });
  assert.equal(selectedMultiSemantic.tasks[0].type, "unknown", "a canonical identity conflicting with a multi-subject source must fail closed");

  const multiSiblingPrice = task({ taskId: "multi-sibling-price", type: "price", category: "policy", rawText: "fee", sourceText: multiRegisteredSource, requestedOutputs: ["price"], dependsOnStayContext: true, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null } });
  const multiSiblingPool = task({ taskId: "multi-sibling-pool", type: "property_fact", category: "amenity", rawText: "pool", sourceText: "pool fee", canonicalCandidate: "pool" });
  multiSiblingPool.candidateIndex = 1;
  const multiSiblingPlan = plan([multiSiblingPrice, multiSiblingPool]);
  multiSiblingPlan.contextRelationCandidates = [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "multi-sibling", messageRef: "", startOffset: 0, endOffset: multiRegisteredSource.length, quote: multiRegisteredSource }] },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "multi-sibling", messageRef: "", startOffset: 0, endOffset: "pool fee".length, quote: "pool fee" }] }
  ];
  const multiSiblingSemantic = applyPlannerSemanticContract(multiSiblingPlan, { catalog: multiRegisteredCatalog, sourceEvents: [{ eventId: "multi-sibling", messageText: multiRegisteredSource }] });
  assert.equal(multiSiblingSemantic.tasks.find((item) => item.taskId === "multi-sibling-price").type, "price", "one sibling must not collapse the remaining multi-FAQ source into another subject");
  assert.equal(multiSiblingSemantic.tasks.find((item) => item.taskId === "multi-sibling-pool").entity.canonicalCandidate, "pool");


  const sourceBoundTimeFact = sourceBoundSemantic(task({
    taskId: "source-bound-hours",
    type: "availability",
    category: "other",
    rawText: "",
    sourceText: "pool schedule",
    detailIntent: "time"
  }));
  assert.equal(sourceBoundTimeFact.tasks[0].entity.canonicalCandidate, null, "core must not recover a Planner-omitted identity from source wording");
  assert.equal(sourceBoundTimeFact.tasks[0].type, "availability");

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
  assert.equal(sourceBoundTypoBundlePrice.tasks[0].entity.category, "other", "core must not fuzzy-match source prose into a formal inventory identity");
  assert.equal(sourceBoundTypoBundlePrice.tasks[0].entity.canonicalCandidate, null);
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
  assert.equal(genericTypePrice.tasks[0].entity.category, "policy", "core must preserve the Planner category without fuzzy source recovery");
  assert.equal(genericTypePrice.tasks[0].entity.canonicalCandidate, "price");
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
  assert.equal(sourceBoundFeature.tasks[0].type, "availability", "feature wording must not reclassify a Planner task");
  assert.equal(sourceBoundFeature.tasks[0].entity.category, "room");
  assert.equal(sourceBoundFeature.tasks[0].entity.canonicalCandidate, "inventory-room-a");
  assert.equal(sourceBoundFeature.semanticValidation.repairedTasks.some((item) => item.reason === "source_bound_inventory_feature_capability"), false);

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
  assert.equal(sourceBoundBundlePrice.tasks[0].type, "unknown", "verified source/canonical identity conflict must remain fail-closed");
  assert.equal(sourceBoundBundlePrice.tasks[0].entity.category, "other");
  assert.equal(sourceBoundBundlePrice.tasks[0].entity.canonicalCandidate, null);
  assert.equal(sourceBoundBundlePrice.semanticValidation.repairedTasks.some((item) => item.reason === "source_bound_inventory_scope_preservation"), false);

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
  assert.equal(unverifiedBundlePrice.tasks[0].entity.category, "policy", "unverified source text must not mutate Planner structure");
  assert.equal(unverifiedBundlePrice.tasks[0].entity.canonicalCandidate, "pool");

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
  assert.equal(ambiguousBundlePrice.tasks[0].entity.category, "policy", "source inventory mentions must not replace Planner structure");
  assert.equal(ambiguousBundlePrice.tasks[0].entity.canonicalCandidate, "pool");

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

  const usageAndFeeMessage = "Can guests use the pool, and what is its fee?";
  const usageTask = task({
    taskId: "catalog-usage",
    type: "amenity",
    category: "amenity",
    rawText: "pool",
    sourceText: usageAndFeeMessage,
    canonicalCandidate: "pool",
    detailIntent: "general"
  });
  const catalogFeeTask = task({
    taskId: "catalog-fee",
    type: "price",
    category: "amenity",
    rawText: "pool",
    sourceText: usageAndFeeMessage,
    canonicalCandidate: "pool",
    detailIntent: "fee",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  });
  catalogFeeTask.candidateIndex = 1;
  const usageAndFeePlan = plan([usageTask, catalogFeeTask]);
  usageAndFeePlan.contextRelationCandidates.forEach((relation) => {
    relation.evidenceRefs = [{
      eventId: "usage-and-fee",
      messageRef: "",
      startOffset: 0,
      endOffset: usageAndFeeMessage.length,
      quote: usageAndFeeMessage
    }];
  });
  const usageAndFeeSemantic = applyPlannerSemanticContract(usageAndFeePlan, {
    catalog: sourceBoundInventoryCatalog,
    sourceEvents: [{ eventId: "usage-and-fee", messageRef: "", messageText: usageAndFeeMessage }]
  });
  const retainedUsage = usageAndFeeSemantic.tasks.find((item) => item.taskId === "catalog-usage");
  const groundedFee = usageAndFeeSemantic.tasks.find((item) => item.taskId === "catalog-fee");
  assert.equal(retainedUsage.type, "amenity", "catalog fee grounding must retain the usage sibling");
  assert.equal(retainedUsage.entity.canonicalCandidate, "pool");
  assert.equal(groundedFee.type, "amenity", "a source-bound catalog fee must use the formal stateless capability");
  assert.equal(groundedFee.detailIntent, "fee");
  assert.deepEqual(groundedFee.requestedOutputs, ["fee"]);
  assert.equal(groundedFee.dependsOnStayContext, false);
  assert.equal(groundedFee.stayCandidate, null);
  assert.equal(groundedFee.entity.canonicalCandidate, "pool");
  const canonicalFee = canonicalizeExecutionItem({
    item: {
      candidateIndex: groundedFee.candidateIndex,
      requestCycleId: groundedFee.taskId,
      task: groundedFee,
      transition: { approvedProduct: { productType: "any", productId: null, roomTypeId: null, bundleId: null } }
    },
    relation: null,
    contextSnapshot: { cycles: [] },
    catalog: sourceBoundInventoryCatalog,
    guestMessage: usageAndFeeMessage,
    eventTimestamp
  }).canonicalRequest;
  assert.equal(canonicalFee.capability, "pool");
  assert.equal(canonicalFee.resolverId, "property_catalog");

  const activityFeeCatalog = {
    ...sourceBoundInventoryCatalog,
    amenities: sourceBoundInventoryCatalog.amenities.map((item) => item.canonicalId === "pool"
      ? { ...item, category: "activity" }
      : item)
  };
  const activityFee = sourceBoundSemantic(task({
    taskId: "activity-fee",
    type: "total_price",
    category: "activity",
    rawText: "pool",
    sourceText: "What is the activity fee for the pool?",
    canonicalCandidate: "pool",
    detailIntent: "fee",
    requestedOutputs: ["total_price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }), { message: "What is the activity fee for the pool?", catalogOverride: activityFeeCatalog });
  assert.equal(activityFee.tasks[0].type, "amenity");
  assert.equal(activityFee.tasks[0].entity.category, "activity");
  assert.deepEqual(activityFee.tasks[0].requestedOutputs, ["fee"]);

  const policyFee = sourceBoundSemantic(task({
    taskId: "policy-fee",
    type: "price",
    category: "policy",
    rawText: "bbq",
    sourceText: "What fee applies to bbq?",
    canonicalCandidate: "bbq",
    detailIntent: "fee",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }), { message: "What fee applies to bbq?" });
  assert.equal(policyFee.tasks[0].type, "policy");
  assert.equal(policyFee.tasks[0].entity.category, "policy");
  assert.deepEqual(policyFee.tasks[0].requestedOutputs, ["fee"]);

  const poolFeeMessage = "What is the fee for the pool?";
  const malformedPoolFee = sourceBoundSemantic(task({
    taskId: "malformed-pool-fee",
    type: "price",
    category: "policy",
    rawText: "pool",
    sourceText: poolFeeMessage,
    canonicalCandidate: "pool",
    detailIntent: "general",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }), { message: poolFeeMessage, catalogOverride: sourceBoundInventoryCatalog });
  assert.equal(malformedPoolFee.tasks[0].type, "price", "a task-local general price must not be reclassified without a separate verified formal subject");
  assert.equal(malformedPoolFee.tasks[0].entity.canonicalCandidate, "pool", "the exact formal pool subject must survive semantic normalization");
  assert.equal(malformedPoolFee.tasks[0].dependsOnStayContext, true);

  const sourceBoundGeneralFeePlan = plan([
    task({
      taskId: "general-fee-usage",
      type: "amenity",
      category: "amenity",
      rawText: "pool",
      sourceText: "Can guests use the pool?",
      canonicalCandidate: "pool"
    }),
    {
      ...task({
        taskId: "general-fee-price",
        type: "price",
        category: "amenity",
        rawText: "pool",
        sourceText: "What is its fee?",
        canonicalCandidate: "pool",
        detailIntent: "general",
        requestedOutputs: ["price"],
        dependsOnStayContext: true,
        stayCandidate: {
          dateExpression: { rawText: "", kind: "none", anchor: "none" },
          checkInCandidate: null,
          checkOutCandidate: null,
          nightsCandidate: null,
          guestCountCandidate: null
        }
      }),
      candidateIndex: 1
    }
  ]);
  const sourceBoundGeneralFeeMessage = "Can guests use the pool? What is its fee?";
  sourceBoundGeneralFeePlan.contextRelationCandidates[0].evidenceRefs = [{
    eventId: "general-fee-event", messageRef: "", startOffset: 0, endOffset: 24, quote: "Can guests use the pool?"
  }];
  sourceBoundGeneralFeePlan.contextRelationCandidates[1].evidenceRefs = [{
    eventId: "general-fee-event", messageRef: "", startOffset: 25, endOffset: sourceBoundGeneralFeeMessage.length, quote: "What is its fee?"
  }];
  const sourceBoundGeneralFee = applyPlannerSemanticContract(sourceBoundGeneralFeePlan, {
    catalog: sourceBoundInventoryCatalog,
    sourceEvents: [{ eventId: "general-fee-event", messageRef: "", messageText: sourceBoundGeneralFeeMessage }]
  });
  const retainedGeneralUsage = sourceBoundGeneralFee.tasks.find((item) => item.taskId === "general-fee-usage");
  const reconciledGeneralFee = sourceBoundGeneralFee.tasks.find((item) => item.taskId === "general-fee-price");
  assert.equal(retainedGeneralUsage.type, "amenity", "general fee reconciliation must retain the verified usage sibling");
  assert.equal(reconciledGeneralFee.type, "amenity", "a fee-only relation may use the unique verified current-request catalog subject");
  assert.equal(reconciledGeneralFee.detailIntent, "fee");
  assert.deepEqual(reconciledGeneralFee.requestedOutputs, ["fee"]);
  assert.equal(reconciledGeneralFee.dependsOnStayContext, false);
  assert.equal(reconciledGeneralFee.stayCandidate, null);
  assert.equal(reconciledGeneralFee.entity.canonicalCandidate, "pool");

  const lodgingScopedGeneralFee = sourceBoundSemantic(task({
    taskId: "lodging-scoped-general-fee",
    type: "price",
    category: "amenity",
    rawText: "pool",
    sourceText: "What is the lodging price when using the pool?",
    canonicalCandidate: "pool",
    detailIntent: "general",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "8/20", kind: "absolute", anchor: "message_time" },
      checkInCandidate: "2026-08-20",
      checkOutCandidate: "2026-08-21",
      nightsCandidate: 1,
      guestCountCandidate: null
    }
  }), { message: "What is the lodging price when using the pool?", catalogOverride: sourceBoundInventoryCatalog });
  assert.equal(lodgingScopedGeneralFee.tasks[0].type, "price", "a lodging-scoped price must retain lodging price authority");
  assert.equal(lodgingScopedGeneralFee.tasks[0].detailIntent, "general");

  const ambiguousGeneralFeeMessage = "What fee applies to pool and shared kitchen?";
  const ambiguousGeneralFee = sourceBoundSemantic(task({
    taskId: "ambiguous-general-fee",
    type: "price",
    category: "amenity",
    rawText: "pool and shared kitchen",
    sourceText: ambiguousGeneralFeeMessage,
    canonicalCandidate: "pool",
    detailIntent: "general",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }), { message: ambiguousGeneralFeeMessage, catalogOverride: sourceBoundInventoryCatalog });
  assert.notEqual(ambiguousGeneralFee.tasks[0].type, "amenity", "multiple formal subjects must remain fail-closed");
  assert.notEqual(ambiguousGeneralFee.tasks[0].detailIntent, "fee", "ambiguous subject evidence must not manufacture fee intent");

  const blankRawPoolFee = sourceBoundSemantic(task({
    taskId: "blank-raw-pool-fee",
    type: "price",
    category: "policy",
    rawText: "",
    sourceText: poolFeeMessage,
    canonicalCandidate: "pool",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }), { message: poolFeeMessage, catalogOverride: sourceBoundInventoryCatalog });
  assert.equal(blankRawPoolFee.tasks[0].type, "price", "verified source wording must not replace the Planner capability");
  assert.equal(blankRawPoolFee.tasks[0].entity.canonicalCandidate, "pool");

  const combinedMessage = "What is the lodging amount, and what is the fee for the pool?";
  const combinedPriceTask = task({
    taskId: "combined-price",
    type: "price",
    category: "policy",
    rawText: "pool",
    sourceText: combinedMessage,
    canonicalCandidate: "pool",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  });
  const combinedPoolTask = task({ taskId: "combined-pool", type: "amenity", category: "amenity", rawText: "pool", sourceText: combinedMessage, canonicalCandidate: "pool" });
  combinedPoolTask.candidateIndex = 1;
  const combinedPlan = plan([combinedPriceTask, combinedPoolTask]);
  combinedPlan.contextRelationCandidates.forEach((relation) => {
    relation.evidenceRefs = [{ eventId: "combined", messageRef: "", startOffset: 0, endOffset: combinedMessage.length, quote: combinedMessage }];
  });
  const combinedSemantic = applyPlannerSemanticContract(combinedPlan, { catalog: sourceBoundInventoryCatalog, sourceEvents: [{ eventId: "combined", messageRef: "", messageText: combinedMessage }] });
  assert.equal(combinedSemantic.tasks.find((item) => item.taskId === "combined-price").type, "price", "a separately represented formal subject must not erase the preserved lodging-price task");
  assert.equal(combinedSemantic.tasks.find((item) => item.taskId === "combined-pool").entity.canonicalCandidate, "pool");

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
  assert.equal(isolatedMultiTask.tasks[0].entity.category, "policy", "one task must preserve its Planner structure rather than borrow another clause's room scope");
  assert.equal(isolatedMultiTask.tasks[0].entity.canonicalCandidate, "price");

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
  assert.equal(isolatedMergedUnknown.tasks.length, 1, "catalog wording inside an unknown task must not create a synthetic sibling");
  assert.equal(isolatedMergedUnknown.tasks[0].type, "unknown", "the Planner's unresolved task must remain fail-closed");
  assert.equal(isolatedMergedUnknown.contextRelationCandidates.length, 1, "the core must not synthesize relation ownership for an omitted task");
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
    { ...task({ taskId: "availability", type: "availability", category: "room", rawText: "four guests" }), candidateIndex: 0 },
    { ...task({ taskId: "availability", type: "availability", category: "room", rawText: "room 402" }), candidateIndex: 1 }
  ]);
  const statefulScopeIds = ["80000000-0000-4000-8000-000000000001", "80000000-0000-4000-8000-000000000002"];
  statefulDuplicateTaskIds.tasks.forEach((item, index) => { item.lodgingScopeId = statefulScopeIds[index]; });
  statefulDuplicateTaskIds.semanticCandidates.forEach((candidate, index) => {
    candidate.lodgingScopeCandidate = {
      scopeId: statefulScopeIds[index],
      bundleCanonicalCandidate: null,
      roomCanonicalCandidates: index === 0 ? [] : ["room-402"],
      guestCountCandidate: index === 0 ? 4 : null
    };
    candidate.evidenceRefs = [{
      eventId: "duplicate-availability-event",
      messageRef: "",
      startOffset: index === 0 ? 0 : 16,
      endOffset: index === 0 ? 11 : 24,
      quote: index === 0 ? "four guests" : "room 402"
    }];
  });
  statefulDuplicateTaskIds.contextRelationCandidates.forEach((relation, index) => {
    relation.evidenceRefs = statefulDuplicateTaskIds.semanticCandidates[index].evidenceRefs.map((ref) => ({ ...ref }));
  });
  assert.deepEqual(validatePlannerOutput(statefulDuplicateTaskIds).errors, ["tasks.taskId.duplicate"], "the ownership-isolated availability fixture must begin invalid only because of its duplicate technical task ID");
  const normalizedStatefulDuplicateTaskIds = normalizeDuplicateTaskIds(statefulDuplicateTaskIds);
  assert.equal(validatePlannerOutput(normalizedStatefulDuplicateTaskIds).ok, true, "ownership-isolated availability technical IDs must be normalized");
  assert.equal(new Set(normalizedStatefulDuplicateTaskIds.tasks.map((item) => item.taskId)).size, 2);
  assert.deepEqual(
    normalizedStatefulDuplicateTaskIds.tasks.map(({ taskId: _taskId, ...item }) => item),
    statefulDuplicateTaskIds.tasks.map(({ taskId: _taskId, ...item }) => item),
    "stateful normalization must change only the technical taskId"
  );

  function assertStatefulDuplicateRemainsFailClosed(mutator, message) {
    const unsafe = JSON.parse(JSON.stringify(statefulDuplicateTaskIds));
    mutator(unsafe);
    const normalizedUnsafe = normalizeDuplicateTaskIds(unsafe);
    assert.equal(new Set(normalizedUnsafe.tasks.map((item) => item.taskId)).size, 1, message);
    assert.equal(validatePlannerOutput(normalizedUnsafe).ok, false, message);
  }
  assertStatefulDuplicateRemainsFailClosed((value) => { value.tasks[1].candidateIndex = value.tasks[0].candidateIndex; }, "duplicate candidate ownership must not be normalized");
  assertStatefulDuplicateRemainsFailClosed((value) => { value.tasks[1].semanticCandidateIds = []; }, "empty semantic ownership must not be normalized");
  assertStatefulDuplicateRemainsFailClosed((value) => { value.tasks[1].semanticCandidateIds = [...value.tasks[0].semanticCandidateIds]; }, "overlapping semantic ownership must not be normalized");
  assertStatefulDuplicateRemainsFailClosed((value) => { value.tasks[1].lodgingScopeId = value.tasks[0].lodgingScopeId; }, "conflicting lodging scope ownership must not be normalized");
  assertStatefulDuplicateRemainsFailClosed((value) => { value.contextRelationCandidates.pop(); }, "unverifiable relation ownership must not be normalized");
  assertStatefulDuplicateRemainsFailClosed((value) => {
    value.semanticCandidates[1].lodgingScopeCandidate = {
      ...value.semanticCandidates[0].lodgingScopeCandidate,
      scopeId: value.tasks[1].lodgingScopeId
    };
  }, "tasks representing the same semantic lodging unit must not be normalized");

  const mixedAvailability = task({ taskId: "mixed-availability", type: "availability", category: "room", rawText: "雙人房", sourceText: "我想預訂雙人房，也請先確認房況", canonicalCandidate: null, requestedOutputs: ["availability"], dependsOnStayContext: true, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: 2 } });
  const mixedBooking = { ...task({ taskId: "mixed-booking", type: "booking_request", category: "other", rawText: "", sourceText: "我想預訂雙人房，也請先確認房況", requestedOutputs: ["handoff"] }), candidateIndex: 1 };
  const mixedBookingResult = applyPlannerSemanticContract(plan([mixedAvailability, mixedBooking]));
  assert.deepEqual(mixedBookingResult.tasks.map((item) => item.type), ["availability", "booking_request"], "a booking action must not replace an independently verifiable availability task");
  assert.deepEqual(mixedBookingResult.tasks.map((item) => item.requestedOutputs), [["availability"], ["handoff"]], "mixed booking must retain both the formal-data answer and mandatory handoff authority");
  const availabilityOnly = { ...mixedAvailability, taskId: "availability-only", sourceText: "請確認雙人房房況" };
  assert.equal(applyPlannerSemanticContract(plan([availabilityOnly])).tasks[0].type, "availability", "ordinary availability remains executable without a booking task");

  const schema = plannerJsonSchema();
  assert.ok(schema.properties.tasks.items.required.includes("eligibilityEvidence"));
  assert.deepEqual(schema.properties.tasks.items.properties.eligibilityEvidence.properties.kind.enum, ["none", "person", "room", "plan", "booking_mode", "identity", "stated_condition"]);
  const providerSchema = plannerProviderJsonSchema();
  assertOpenAiStructuredOutputObjectRequirements(providerSchema);
  const providerCandidateSchema = providerSchema.properties.semanticCandidates.items;
  assert.ok(providerCandidateSchema.required.includes("evidenceRefs"));
  assert.ok(providerCandidateSchema.required.includes("provenanceRelationCandidateIndexes"));
  assert.equal(providerCandidateSchema.properties.evidenceRefs.minItems, 0, "bound lifecycle can represent its required empty raw-evidence field");
  assert.equal(providerCandidateSchema.properties.provenanceRelationCandidateIndexes.minItems, 0, "pending lifecycle can represent its required empty relation-provenance field");
  console.log(JSON.stringify({ suite: "planner-semantic-contract", caseCount: 50 + contradictoryFieldCaseCount, passCount: 50 + contradictoryFieldCaseCount, failCount: 0 }));
}

main();
