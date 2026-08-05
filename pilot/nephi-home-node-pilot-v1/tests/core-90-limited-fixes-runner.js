"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");

const EVENT_TIMESTAMP = Date.parse("2026-07-29T10:00:00+08:00");
const NOW = () => new Date("2026-07-29T02:00:00.000Z");
const EMPTY_STAY = Object.freeze({
  dateExpression: { rawText: "", kind: "none", anchor: "none" },
  checkInCandidate: null,
  checkOutCandidate: null,
  nightsCandidate: null,
  guestCountCandidate: null
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function property(propertyId, label) {
  return {
    propertyId,
    displayName: label,
    timezone: "Asia/Taipei",
    currency: "TWD",
    businessProfile: {
      googleMapsUrl: `https://maps.google.com/?q=${propertyId}`
    },
    rooms: [{
      id: `${propertyId}_room`,
      name: `${label} Room`,
      type: "double",
      capacity: 2,
      enabled: true
    }],
    propertyFacts: [
      {
        canonicalId: "pool",
        category: "policy",
        status: "provided",
        publicText: `${label} pool fact.`
      },
      {
        canonicalId: "parking",
        category: "amenity",
        status: "provided",
        publicText: `${label} parking fact.`
      },
      {
        canonicalId: "bbq",
        category: "amenity",
        status: "provided",
        publicText: `${label} barbecue fact.`
      }
    ],
    faqs: [{
      knowledgeKey: "singing",
      question: "Can guests use karaoke?",
      answer: `${label} karaoke is available from 08:00 to 22:00.`
    }],
    semanticCatalog: {
      aliases: {
        singing: ["karaoke"],
        pool: ["戲水池", "游泳池", "pool"],
        parking: ["車位", "停車位", "parking"],
        bbq: ["烤肉", "bbq"],
        location: ["民宿位置", "民宿在哪裡", "location"]
      },
      amenities: []
    },
    commonAnswers: {}
  };
}

function plannerTask({
  taskId,
  type,
  sourceText,
  rawText,
  category,
  canonicalCandidate,
  detailIntent = "general",
  requestedOutputs = ["answer"],
  eligibilityEvidence = { kind: "none", sourceText: "" },
  dependsOnStayContext = false,
  stayCandidate = null
}) {
  return {
    candidateIndex: 0,
    taskId,
    type,
    sourceText,
    detailIntent,
    requestedOutputs,
    eligibilityEvidence,
    dependsOnStayContext,
    entity: {
      category,
      rawText,
      canonicalCandidate,
      confidence: 0.99
    },
    stayCandidate,
    confidence: 0.99
  };
}

function plan(task, sourceEvent) {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: clone(EMPTY_STAY),
    tasks: [task],
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
    reason: "core_90_limited_regression"
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

async function execute({
  currentProperty,
  message,
  task,
  rejectComposer = false
}) {
  const diagnostics = [];
  const eventId = `${currentProperty.propertyId}-${task.taskId}`;
  const engine = new ConversationEngineV2({
    planner: {
      classify: async ({ sourceEvents }) => plan(task, sourceEvents[0])
    },
    composer: rejectComposer ? {
      compose: async () => ({
        sections: [{
          taskId: task.taskId,
          responseMode: "answer",
          text: "已通知業者，並保證可以使用。"
        }]
      })
    } : null,
    persistence: memoryPersistence(),
    getProperty: (propertyId) =>
      propertyId === currentProperty.propertyId ? currentProperty : null,
    availabilityResolver: () => {
      throw new Error("property fact must not call availability resolver");
    },
    availableDatesResolver: () => {
      throw new Error("property fact must not call available-dates resolver");
    },
    listPriceOverrides: () => [],
    now: NOW,
    diagnosticDetail: true,
    onDiagnostic: (entry) => diagnostics.push(clone(entry))
  });
  const result = await engine.process({
    customerId: currentProperty.propertyId,
    channelId: eventId,
    lineUserId: eventId,
    eventId,
    eventTimestamp: EVENT_TIMESTAMP,
    messageText: message
  });
  const stage = (name) =>
    diagnostics.find((entry) => entry.stage === name) || null;
  return { result, diagnostics, stage };
}

async function deterministicFallbackClearsRejectedComposerState() {
  const currentProperty = property("property_fallback", "Fallback Lodge");
  const trace = await execute({
    currentProperty,
    message: "有游泳池嗎？",
    task: plannerTask({
      taskId: "fallback-pool",
      type: "amenity",
      sourceText: "有游泳池嗎？",
      rawText: "游泳池",
      category: "amenity",
      canonicalCandidate: "pool"
    }),
    rejectComposer: true
  });
  assert.equal(trace.stage("composer").validationResult, "rejected");
  assert.equal(trace.stage("composer").fallbackOccurred, true);
  assert.equal(trace.result.claimValidation.ok, true);
  assert.equal(trace.result.replyText, "Fallback Lodge pool fact.");
  assert.equal(
    trace.result.finalDecision.action,
    "reply",
    "a rejected Composer candidate must not survive a successful deterministic fallback"
  );
  assert.equal(trace.result.finalDecision.reviewRequired, false);
}

async function poolRoutingUsesGroundedPropertyCatalog() {
  for (const [propertyId, label, rawText] of [
    ["property_pool_alpha", "Pool Alpha", "戲水池"],
    ["property_pool_beta", "Pool Beta", "游泳池"]
  ]) {
    const currentProperty = property(propertyId, label);
    const catalog = buildPropertyCatalog(currentProperty);
    const policyPool = catalog.policies.find((item) => item.canonicalId === "pool");
    assert.ok(policyPool, "the provider-shaped pool fixture must enter the policy catalog");
    assert.equal(policyPool.category, "policy");
    assert.equal(
      catalog.amenities.some((item) => item.canonicalId === "pool"),
      false,
      "the regression fixture must not silently turn the real policy-shaped pool into an amenity"
    );

    const wrongCandidate = await execute({
      currentProperty,
      message: `有${rawText}嗎？`,
      task: plannerTask({
        taskId: "pool-wrong-candidate",
        type: "amenity",
        sourceText: `有${rawText}嗎？`,
        rawText,
        category: "amenity",
        canonicalCandidate: "bbq"
      })
    });
    const wrongCanonical = wrongCandidate.stage("canonical_request").items[0];
    assert.equal(wrongCanonical.capability, "pool");
    assert.equal(wrongCanonical.canonicalEntity.canonicalId, "pool");
    assert.equal(wrongCanonical.canonicalEntity.category, "policy");
    assert.equal(wrongCanonical.resolverId, "property_catalog");
    assert.equal(wrongCandidate.result.replyText, `${label} pool fact.`);
    assert.equal(wrongCandidate.result.replyText.includes("barbecue"), false);

    const missingCandidate = await execute({
      currentProperty,
      message: `有${rawText}嗎？`,
      task: plannerTask({
        taskId: "pool-missing-candidate",
        type: "availability",
        sourceText: `有${rawText}嗎？`,
        rawText: "",
        category: "amenity",
        canonicalCandidate: null
      })
    });
    const missingCanonicalStage = missingCandidate.stage("canonical_request");
    assert.ok(
      missingCanonicalStage,
      `missing-candidate pool must reach canonical_request; stages=${missingCandidate.diagnostics.map((item) => item.stage).join(",")}`
    );
    const missingCanonical = missingCanonicalStage.items[0];
    assert.notEqual(missingCanonical.capability, "pool", "an empty Planner entity must not be recovered by scanning the complete source text");
    assert.equal(missingCanonical.canonicalEntity.canonicalId, null);
    assert.equal(missingCandidate.result.finalDecision.action, "handoff");
    assert.equal(missingCandidate.result.replyText.includes(`${label} pool fact.`), false);
  }

  for (const [propertyId, label] of [
    ["property_parking_alpha", "Parking Alpha"],
    ["property_parking_beta", "Parking Beta"]
  ]) {
    const currentProperty = property(propertyId, label);
    const missingCandidate = await execute({
      currentProperty,
      message: "有車位嗎？",
      task: plannerTask({
        taskId: "parking-missing-candidate",
        type: "availability",
        sourceText: "有車位嗎？",
        rawText: "",
        category: "amenity",
        canonicalCandidate: null
      })
    });
    const canonical = missingCandidate.stage("canonical_request").items[0];
    assert.notEqual(canonical.capability, "parking", "an empty Planner entity must not be recovered by scanning the complete source text");
    assert.equal(canonical.canonicalEntity.canonicalId, null);
    assert.equal(missingCandidate.result.finalDecision.action, "handoff");
    assert.equal(missingCandidate.result.replyText.includes(`${label} parking fact.`), false);
  }

  const detailedProperty = property("property_pool_details", "Pool Details");
  for (const [taskId, detailIntent, sourceText, eligibilityEvidence] of [
    [
      "pool-explicit-eligibility",
      "eligibility",
      "小朋友可以使用戲水池嗎？",
      { kind: "person", sourceText: "小朋友" }
    ],
    [
      "pool-fee",
      "fee",
      "戲水池費用多少？",
      { kind: "none", sourceText: "" }
    ]
  ]) {
    const detailed = await execute({
      currentProperty: detailedProperty,
      message: sourceText,
      task: plannerTask({
        taskId,
        type: "amenity",
        sourceText,
        rawText: "戲水池",
        category: "amenity",
        canonicalCandidate: "bbq",
        detailIntent,
        requestedOutputs: [detailIntent],
        eligibilityEvidence
      })
    });
    const semanticTask = detailed.stage("semantic_contract").outputTasks[0];
    assert.equal(
      semanticTask.detailIntent,
      detailIntent,
      "catalog grounding must not erase a valid detail-specific request"
    );
    const detailedCanonical = detailed.stage("canonical_request").items[0];
    assert.equal(detailedCanonical.capability, "pool");
    assert.equal(detailedCanonical.canonicalEntity.canonicalId, "pool");
    assert.equal(detailedCanonical.canonicalEntity.category, "policy");
    assert.equal(detailedCanonical.resolverId, "property_catalog");
    assert.equal(detailedCanonical.detailIntent, detailIntent);
  }

  const ambiguousProperty = property("property_pool_ambiguous", "Pool Ambiguous");
  ambiguousProperty.semanticCatalog.aliases.pool = ["共同設施"];
  ambiguousProperty.semanticCatalog.aliases.bbq = ["共同設施"];
  const ambiguous = await execute({
    currentProperty: ambiguousProperty,
    message: "共同設施可以使用嗎？",
    task: plannerTask({
      taskId: "pool-ambiguous",
      type: "availability",
      sourceText: "共同設施可以使用嗎？",
      rawText: "",
      category: "amenity",
      canonicalCandidate: null
    })
  });
  const ambiguousCanonical = ambiguous.stage("canonical_request").items[0];
  assert.notEqual(ambiguousCanonical.capability, "pool");
  assert.notEqual(ambiguousCanonical.capability, "parking");
  assert.notEqual(ambiguousCanonical.capability, "bbq");
  assert.equal(ambiguousCanonical.canonicalEntity.canonicalId, null);
  assert.equal(ambiguous.result.replyText.includes("Pool Ambiguous pool fact."), false);
  assert.equal(ambiguous.result.replyText.includes("Pool Ambiguous barbecue fact."), false);

  const unregistered = await execute({
    currentProperty: property("property_pool_unregistered", "Pool Unregistered"),
    message: "有滑水道嗎？",
    task: plannerTask({
      taskId: "pool-unregistered",
      type: "availability",
      sourceText: "有滑水道嗎？",
      rawText: "",
      category: "amenity",
      canonicalCandidate: null
    })
  });
  const unregisteredCanonical = unregistered.stage("canonical_request").items[0];
  assert.notEqual(unregisteredCanonical.capability, "pool");
  assert.notEqual(unregisteredCanonical.capability, "parking");
  assert.equal(unregisteredCanonical.canonicalEntity.canonicalId, null);
  assert.equal(unregistered.result.replyText.includes("Pool Unregistered pool fact."), false);
  assert.equal(unregistered.result.replyText.includes("Pool Unregistered parking fact."), false);
}

async function parkingUnresolvablePlannerEntityUsesUniqueSourceAlias() {
  const providerShapes = [
    {
      propertyId: "property_parking_room_feature",
      label: "Parking Room Feature",
      category: "room_feature",
      rawText: "有車位嗎？"
    },
    {
      propertyId: "property_parking_amenity",
      label: "Parking Amenity",
      category: "amenity",
      rawText: "有停車位嗎？"
    }
  ];

  for (const shape of providerShapes) {
    const currentProperty = property(shape.propertyId, shape.label);
    const trace = await execute({
      currentProperty,
      message: shape.rawText,
      task: plannerTask({
        taskId: `parking-${shape.category}`,
        type: "availability",
        sourceText: shape.rawText,
        rawText: shape.rawText,
        category: shape.category,
        canonicalCandidate: null
      })
    });
    const canonicalStage = trace.stage("canonical_request");
    assert.ok(
      canonicalStage,
      `${shape.category} provider shape must reach canonical_request; stages=${trace.diagnostics.map((item) => item.stage).join(",")}`
    );
    const canonical = canonicalStage.items[0];
    assert.notEqual(canonical.capability, "parking", "a non-exact Planner entity must not be recovered by scanning the complete source text");
    assert.equal(canonical.canonicalEntity.canonicalId, null);
    assert.equal(trace.result.finalDecision.action, "handoff");
    assert.equal(trace.result.replyText.includes(`${shape.label} parking fact.`), false);
  }

  const conflictingEntity = await execute({
    currentProperty: property("property_parking_conflict", "Parking Conflict"),
    message: "有車位嗎？",
    task: plannerTask({
      taskId: "parking-conflicting-registered-entity",
      type: "availability",
      sourceText: "有車位嗎？",
      rawText: "烤肉",
      category: "amenity",
      canonicalCandidate: null
    })
  });
  const conflictingSemantic = conflictingEntity.stage("semantic_contract").outputTasks[0];
  assert.equal(conflictingSemantic.type, "amenity");
  assert.equal(conflictingSemantic.canonicalCandidate, "bbq");
  assert.equal(conflictingEntity.stage("semantic_contract").semanticValidation.repairedTasks[0].reason, "property_catalog_entity_grounding");
  assert.equal(conflictingEntity.result.finalDecision.action, "reply");
  assert.equal(conflictingEntity.result.replyText.includes("parking fact."), false);
  assert.equal(conflictingEntity.result.replyText.includes("barbecue fact."), true, "a uniquely grounded entity must use its registered capability even when the Planner type is inaccurate");

  const ambiguousProperty = property("property_parking_ambiguous_source", "Parking Ambiguous Source");
  ambiguousProperty.semanticCatalog.aliases.parking = ["共用設施"];
  ambiguousProperty.semanticCatalog.aliases.pool = ["共用設施"];
  const ambiguousSource = await execute({
    currentProperty: ambiguousProperty,
    message: "共用設施可以使用嗎？",
    task: plannerTask({
      taskId: "parking-ambiguous-source",
      type: "availability",
      sourceText: "共用設施可以使用嗎？",
      rawText: "共用設施可以使用嗎？",
      category: "amenity",
      canonicalCandidate: null
    })
  });
  const ambiguousSemantic = ambiguousSource.stage("semantic_contract").outputTasks[0];
  assert.equal(ambiguousSemantic.canonicalCandidate, null);
  assert.notEqual(ambiguousSemantic.type, "parking");
  assert.equal(ambiguousSource.result.replyText.includes("parking fact."), false);
  assert.equal(ambiguousSource.result.replyText.includes("pool fact."), false);

  const unregisteredAlias = await execute({
    currentProperty: property("property_parking_unregistered_source", "Parking Unregistered Source"),
    message: "有代客泊車服務嗎？",
    task: plannerTask({
      taskId: "parking-unregistered-source",
      type: "availability",
      sourceText: "有代客泊車服務嗎？",
      rawText: "有代客泊車服務嗎？",
      category: "amenity",
      canonicalCandidate: null
    })
  });
  const unregisteredSemantic = unregisteredAlias.stage("semantic_contract").outputTasks[0];
  assert.equal(unregisteredSemantic.canonicalCandidate, null);
  assert.equal(unregisteredAlias.result.replyText.includes("parking fact."), false);

  const unregisteredCapabilityProperty = property(
    "property_parking_unregistered_capability",
    "Parking Unregistered Capability"
  );
  unregisteredCapabilityProperty.propertyFacts.push({
    canonicalId: "valet_service",
    category: "amenity",
    status: "provided",
    publicText: "Valet service fixture.",
    aliases: ["代客泊車"]
  });
  unregisteredCapabilityProperty.semanticCatalog.aliases.valet_service = ["代客泊車"];
  const unregisteredCapability = await execute({
    currentProperty: unregisteredCapabilityProperty,
    message: "有代客泊車嗎？",
    task: plannerTask({
      taskId: "parking-unregistered-capability",
      type: "availability",
      sourceText: "有代客泊車嗎？",
      rawText: "有代客泊車嗎？",
      category: "amenity",
      canonicalCandidate: null
    })
  });
  const unregisteredCapabilitySemantic =
    unregisteredCapability.stage("semantic_contract").outputTasks[0];
  assert.equal(unregisteredCapabilitySemantic.canonicalCandidate, null);
  assert.equal(
    unregisteredCapability.result.replyText.includes("Valet service fixture."),
    false,
    "a unique catalog alias without a registered capability must remain unresolved"
  );
}

async function contradictoryPlannerFieldsPreserveControlledCapabilities() {
  const currentProperty = property("property_capability_contract", "Capability Contract");
  const statefulPrice = await execute({
    currentProperty,
    message: "Confirm the lodging total after excluding an optional facility.",
    task: plannerTask({
      taskId: "stateful-total",
      type: "total_price",
      sourceText: "Confirm the lodging total after excluding an optional facility.",
      rawText: "pool",
      category: "policy",
      canonicalCandidate: "pool",
      requestedOutputs: ["total_price"],
      dependsOnStayContext: true,
      stayCandidate: clone(EMPTY_STAY)
    })
  });
  assert.equal(statefulPrice.stage("semantic_contract").outputTasks[0].type, "total_price");
  assert.equal(statefulPrice.stage("canonical_request").items[0].capability, "total_price");
  assert.equal(statefulPrice.stage("query_plan").count, 0, "a date-less total must clarify without querying availability");
  assert.equal(statefulPrice.result.finalDecision.action, "clarification");

  const outputGroundedPrice = await execute({
    currentProperty,
    message: "What is the lodging amount?",
    task: plannerTask({
      taskId: "output-grounded-price",
      type: "policy",
      sourceText: "What is the lodging amount?",
      rawText: "quoted lodging amount",
      category: "policy",
      canonicalCandidate: null,
      requestedOutputs: ["price"]
    })
  });
  assert.equal(outputGroundedPrice.stage("semantic_contract").outputTasks[0].type, "price");
  assert.equal(outputGroundedPrice.stage("canonical_request").items[0].capability, "price");
  assert.equal(outputGroundedPrice.stage("query_plan").count, 0, "an unresolved lodging price must clarify before querying availability");
  assert.equal(outputGroundedPrice.result.finalDecision.action, "clarification");

  const propertyRule = await execute({
    currentProperty,
    message: "Are there restrictions on using the shared lounge?",
    task: plannerTask({
      taskId: "shared-rule",
      type: "availability",
      sourceText: "Are there restrictions on using the shared lounge?",
      rawText: "shared lounge",
      category: "room_feature",
      canonicalCandidate: null,
      detailIntent: "usage_restrictions",
      requestedOutputs: ["usage_restrictions"]
    })
  });
  assert.equal(propertyRule.stage("semantic_contract").outputTasks[0].type, "policy");
  assert.equal(propertyRule.stage("canonical_request").items[0].capability, "policy");
  assert.equal(propertyRule.stage("executor").results[0].status, "needs_human", "missing formal policy data must remain Unknown");
  assert.equal(propertyRule.result.finalDecision.action, "handoff");

  const unresolvedFact = await execute({
    currentProperty,
    message: "Please confirm an unlisted house detail.",
    task: plannerTask({
      taskId: "unlisted-fact",
      type: "property_fact",
      sourceText: "Please confirm an unlisted house detail.",
      rawText: "unlisted house detail",
      category: "other",
      canonicalCandidate: null,
      detailIntent: "conditions"
    })
  });
  assert.equal(unresolvedFact.stage("semantic_contract").outputTasks[0].type, "property_fact");
  assert.equal(unresolvedFact.stage("canonical_request").items[0].capability, "property_fact");
  assert.equal(unresolvedFact.stage("executor").results[0].status, "needs_human", "an unresolved property fact must not become an answer");
  assert.equal(unresolvedFact.result.finalDecision.action, "handoff");

  const sourceGroundedDetail = await execute({
    currentProperty,
    message: "Please confirm the karaoke operating time.",
    task: plannerTask({
      taskId: "source-grounded-detail",
      type: "availability",
      sourceText: "Please confirm the karaoke operating time.",
      rawText: "karaoke operating time",
      category: "amenity",
      canonicalCandidate: null,
      detailIntent: "time",
      requestedOutputs: ["time"]
    })
  });
  assert.equal(sourceGroundedDetail.stage("semantic_contract").outputTasks[0].type, "property_fact");
  assert.equal(sourceGroundedDetail.stage("canonical_request").items[0].canonicalEntity.canonicalId, "singing");
  assert.equal(sourceGroundedDetail.stage("executor").results[0].status, "answered");
  assert.match(sourceGroundedDetail.result.finalResponse.replyText, /08:00.+22:00/);

  const ambiguousProperty = property("property_ambiguous_detail", "Ambiguous Detail");
  ambiguousProperty.propertyFacts.push(
    { canonicalId: "first_clock", category: "amenity", status: "provided", publicText: "First clock: 08:00." },
    { canonicalId: "second_clock", category: "amenity", status: "provided", publicText: "Second clock: 22:00." }
  );
  ambiguousProperty.semanticCatalog.aliases.first_clock = ["shared timer"];
  ambiguousProperty.semanticCatalog.aliases.second_clock = ["shared timer"];
  const ambiguousDetail = await execute({
    currentProperty: ambiguousProperty,
    message: "Please confirm the shared timer operating time.",
    task: plannerTask({
      taskId: "ambiguous-detail",
      type: "availability",
      sourceText: "Please confirm the shared timer operating time.",
      rawText: "shared timer operating time",
      category: "amenity",
      canonicalCandidate: null,
      detailIntent: "time",
      requestedOutputs: ["time"]
    })
  });
  assert.equal(ambiguousDetail.stage("canonical_request").items[0].canonicalEntity.canonicalId, null);
  assert.notEqual(ambiguousDetail.stage("executor").results[0].status, "answered");

  const unboundEntity = await execute({
    currentProperty,
    message: "Please confirm the leisure schedule.",
    task: plannerTask({
      taskId: "unbound-detail",
      type: "availability",
      sourceText: "Please confirm the leisure schedule.",
      rawText: "karaoke operating time",
      category: "amenity",
      canonicalCandidate: null,
      detailIntent: "time",
      requestedOutputs: ["time"]
    })
  });
  assert.equal(unboundEntity.stage("canonical_request").items[0].canonicalEntity.canonicalId, null);
  assert.notEqual(unboundEntity.stage("executor").results[0].status, "answered");

  const protectedTask = await execute({
    currentProperty,
    message: "Please have an operator handle the karaoke operating time.",
    task: plannerTask({
      taskId: "protected-detail",
      type: "high_risk",
      sourceText: "Please have an operator handle the karaoke operating time.",
      rawText: "karaoke operating time",
      category: "other",
      canonicalCandidate: null,
      detailIntent: "time",
      requestedOutputs: ["handoff"]
    })
  });
  assert.equal(protectedTask.stage("canonical_request").items[0].capability, "high_risk");
  assert.equal(protectedTask.stage("canonical_request").items[0].resolverId, "human_handoff");
}

async function locationFailureStageIsComposerFallbackState() {
  const currentProperty = property("property_location", "Location Lodge");
  const trace = await execute({
    currentProperty,
    message: "民宿在哪裡？",
    task: plannerTask({
      taskId: "location",
      type: "property_fact",
      sourceText: "民宿在哪裡？",
      rawText: "民宿位置",
      category: "transport",
      canonicalCandidate: "location",
      requestedOutputs: ["map_url"]
    }),
    rejectComposer: true
  });
  assert.equal(trace.stage("planner").parserSucceeded, true);
  assert.equal(trace.stage("validation").rejectionReasons.length, 0);
  assert.equal(trace.stage("context_validation").rejectionReasons.length, 0);
  assert.equal(trace.stage("canonical_request").items[0].capability, "location");
  assert.equal(trace.stage("formal_request").items[0].readiness, "ready");
  assert.equal(trace.stage("executor").results[0].status, "answered");
  assert.equal(trace.stage("composer").validationResult, "rejected");
  assert.equal(trace.stage("composer").fallbackOccurred, true);
  assert.equal(trace.result.claimValidation.ok, true);
  assert.equal(
    trace.result.finalDecision.action,
    "reply",
    "location reaches a grounded answer; only stale Composer rejection state causes handoff"
  );
  assert.equal(
    trace.result.replyText,
    "Google 地圖：https://maps.google.com/?q=property_location\n請直接開啟地圖查看路線與周邊位置。"
  );
}

const cases = [
  ["deterministic fallback clears rejected Composer state", deterministicFallbackClearsRejectedComposerState],
  ["pool routing uses grounded property catalog", poolRoutingUsesGroundedPropertyCatalog],
  ["parking unresolvable Planner entity uses unique source alias", parkingUnresolvablePlannerEntityUsesUniqueSourceAlias],
  ["contradictory Planner fields preserve controlled capabilities", contradictoryPlannerFieldsPreserveControlledCapabilities],
  ["location failure stage is Composer fallback state", locationFailureStageIsComposerFallbackState]
];

(async () => {
  const failures = [];
  for (const [name, test] of cases) {
    try {
      await test();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL: ${name}`);
      console.error(error.stack || error);
    }
  }
  console.log(JSON.stringify({
    caseCount: cases.length,
    passCount: cases.length - failures.length,
    failCount: failures.length
  }));
  if (failures.length) process.exit(1);
  console.log("core 90 limited fixes: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
