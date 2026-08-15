"use strict";

const assert = require("node:assert/strict");
const {
  CANONICAL_REQUEST_FIELDS,
  assertCanonicalRequest,
  createCanonicalRequest,
  isCanonicalRequest,
  validateCanonicalRequest
} = require("../lib/conversation-engine-v2/canonical-request");
const {
  CAPABILITY_REGISTRY,
  getCapabilityDefinition,
  validateCapabilityRegistry
} = require("../lib/conversation-engine-v2/capability-registry");
const {
  buildCanonicalFormalRequest,
  buildCanonicalQueryPlan
} = require("../lib/conversation-engine-v2/formal-request");
const {
  executeCanonicalQueryPlans
} = require("../lib/conversation-engine-v2/capability-executor");
const {
  buildPropertyCatalog
} = require("../lib/conversation-engine-v2/property-catalog");
const {
  composeSection
} = require("../lib/conversation-engine-v2/controlled-composer");

const REQUIRED_CAPABILITIES = [
  "availability",
  "available_dates",
  "amenity",
  "policy",
  "property_fact",
  "location",
  "parking",
  "bbq",
  "pool",
  "booking_request",
  "human_help",
  "high_risk"
];

function temporalState() {
  return {
    resolutionStatus: "resolved",
    checkIn: "2026-08-06",
    checkOut: "2026-08-07",
    nights: 1,
    searchRange: null,
    timezone: "Asia/Taipei",
    applicableTaskIds: ["availability-0"]
  };
}

function evidenceRefs() {
  return [{
    eventId: "event-1",
    messageRef: "",
    startOffset: 0,
    endOffset: 8,
    quote: "8/6 有房嗎"
  }];
}

function validCanonicalRequest() {
  const definition = getCapabilityDefinition("availability");
  return createCanonicalRequest({
    taskId: "availability-0",
    capability: definition.capability,
    canonicalEntity: {
      category: "other",
      canonicalId: null
    },
    lodgingProduct: {
      productType: "any",
      productId: null,
      roomTypeId: null,
      bundleId: null
    },
    detailIntent: "general",
    temporalState: temporalState(),
    stayDependency: definition.stayDependency,
    requiredFields: definition.requiredFields,
    resolverId: definition.resolverId,
    riskLevel: definition.riskLevel,
    responseMode: definition.responseMode,
    evidenceRefs: evidenceRefs()
  });
}

function run() {
  assert.deepEqual(CANONICAL_REQUEST_FIELDS, [
    "taskId",
    "capability",
    "canonicalEntity",
    "lodgingProduct",
    "detailIntent",
    "temporalState",
    "stayDependency",
    "requiredFields",
    "resolverId",
    "riskLevel",
    "responseMode",
    "evidenceRefs"
  ]);

  const registryValidation = validateCapabilityRegistry(CAPABILITY_REGISTRY);
  assert.deepEqual(registryValidation, { ok: true, errors: [] });
  REQUIRED_CAPABILITIES.forEach((capability) => {
    assert.ok(Object.hasOwn(CAPABILITY_REGISTRY, capability), capability);
  });
  ["room_options", "bundle_availability", "capacity", "price", "total_price", "amenity_list", "unknown"]
    .forEach((capability) => {
      assert.ok(Object.hasOwn(CAPABILITY_REGISTRY, capability), capability);
    });

  const request = validCanonicalRequest();
  assert.equal(validateCanonicalRequest(request).ok, true);
  assert.equal(isCanonicalRequest(request), true);
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.canonicalEntity), true);
  assert.equal(Object.isFrozen(request.lodgingProduct), true);
  assert.equal(Object.isFrozen(request.temporalState), true);
  assert.equal(Object.isFrozen(request.requiredFields), true);
  assert.equal(Object.isFrozen(request.evidenceRefs), true);
  assert.equal(Object.isFrozen(request.evidenceRefs[0]), true);

  const originalCapability = request.capability;
  const originalResolverId = request.resolverId;
  assert.throws(() => { request.capability = "parking"; }, TypeError);
  assert.throws(() => { request.resolverId = "property_catalog"; }, TypeError);
  assert.equal(request.capability, originalCapability);
  assert.equal(request.resolverId, originalResolverId);
  [
    "capability",
    "canonicalEntity",
    "lodgingProduct",
    "temporalState",
    "stayDependency",
    "requiredFields",
    "resolverId",
    "riskLevel",
    "responseMode"
  ].forEach((field) => {
    assert.throws(() => { request[field] = null; }, TypeError, field);
  });
  assert.throws(() => { request.temporalState.checkIn = "2099-01-01"; }, TypeError);
  assert.throws(() => { request.requiredFields.push("planner.injected"); }, TypeError);

  const plannerCandidate = {
    taskId: "planner-only",
    type: "availability",
    entity: { category: "room", canonicalCandidate: "double" },
    dependsOnStayContext: false,
    stayCandidate: { checkInCandidate: "2099-01-01" }
  };
  assert.equal(isCanonicalRequest(plannerCandidate), false);
  assert.equal(validateCanonicalRequest(plannerCandidate).ok, false);
  assert.throws(() => assertCanonicalRequest(plannerCandidate), /canonical_request_required/);
  const forgedCanonicalClone = Object.freeze(JSON.parse(JSON.stringify(request)));
  assert.equal(validateCanonicalRequest(forgedCanonicalClone).ok, true);
  assert.equal(isCanonicalRequest(forgedCanonicalClone), false);
  assert.throws(() => assertCanonicalRequest(forgedCanonicalClone), /canonical_request_required/);
  assert.equal(assertCanonicalRequest(request), request);

  const changedCanonicalField = {
    ...request,
    resolverId: "property_catalog"
  };
  const changedValidation = validateCanonicalRequest(changedCanonicalField);
  assert.equal(changedValidation.ok, false);
  assert.ok(changedValidation.errors.includes("resolverId_registry_mismatch"));

  const capacityDefinition = getCapabilityDefinition("capacity");
  const capacityProperty = {
    propertyId: "property-capacity-contract",
    displayName: "Capacity Contract Property",
    timezone: "Asia/Taipei",
    rooms: [
      { id: "orchid-suite", name: "蘭花套房", capacity: 3, enabled: true },
      { id: "harbor-villa", name: "海港包棟", capacity: 11, enabled: true, inventoryType: "bundle", memberRoomIds: ["orchid-suite"] }
    ]
  };
  const capacityCatalog = buildPropertyCatalog(capacityProperty);
  let availabilityResolverCalls = 0;
  function runCapacityFlow({ taskId, canonicalEntity, lodgingProduct, catalog = capacityCatalog }) {
    const canonicalRequest = createCanonicalRequest({
      taskId,
      capability: "capacity",
      canonicalEntity,
      lodgingProduct,
      detailIntent: "general",
      temporalState: {
        resolutionStatus: "absent",
        checkIn: null,
        checkOut: null,
        nights: null,
        searchRange: null,
        timezone: "Asia/Taipei",
        applicableTaskIds: [taskId]
      },
      stayDependency: capacityDefinition.stayDependency,
      requiredFields: capacityDefinition.requiredFields,
      resolverId: capacityDefinition.resolverId,
      riskLevel: capacityDefinition.riskLevel,
      responseMode: capacityDefinition.responseMode,
      evidenceRefs: evidenceRefs()
    });
    const formalRequest = buildCanonicalFormalRequest({
      property: capacityProperty,
      canonicalRequest,
      requestCycleId: `${taskId}-cycle`,
      confirmedInputs: {
        stay: { checkIn: null, checkOut: null, guests: null },
        inventory: { mode: "any", entityId: canonicalEntity.canonicalId, features: [] }
      }
    });
    const queryPlan = buildCanonicalQueryPlan(formalRequest);
    const outcomes = executeCanonicalQueryPlans({
      property: capacityProperty,
      catalog,
      queryPlans: queryPlan ? [queryPlan] : [],
      availabilityResolver: () => {
        availabilityResolverCalls += 1;
        throw new Error("capacity_must_not_call_availability");
      }
    });
    return { canonicalRequest, formalRequest, queryPlan, outcomes };
  }

  for (const target of [
    { taskId: "capacity-room", canonicalId: "orchid-suite", category: "room", productType: "room_type", capacity: 3, publicName: "蘭花套房" },
    { taskId: "capacity-bundle", canonicalId: "harbor-villa", category: "bundle", productType: "bundle", capacity: 11, publicName: "海港包棟" }
  ]) {
    const flow = runCapacityFlow({
      taskId: target.taskId,
      canonicalEntity: { status: "resolved", category: target.category, canonicalId: target.canonicalId, canonicalSet: [], rawText: target.publicName },
      lodgingProduct: {
        productType: target.productType,
        productId: target.canonicalId,
        roomTypeId: target.productType === "room_type" ? target.canonicalId : null,
        bundleId: target.productType === "bundle" ? target.canonicalId : null
      }
    });
    assert.equal(flow.outcomes.length, 1, `capacity production flow stopped before Executor: ${JSON.stringify({ definition: capacityDefinition, readiness: flow.formalRequest.readiness })}`);
    assert.equal(flow.formalRequest.readiness.status, "ready");
    assert.equal(flow.queryPlan.resolverId, "property_catalog");
    assert.equal(flow.outcomes[0].outcome, "answered");
    assert.equal(flow.outcomes[0].resolverAttempted, false);
    assert.deepEqual(flow.outcomes[0].facts, {
      subject: target.publicName,
      capacity: target.capacity,
      source: "property_catalog",
      propertyId: capacityProperty.propertyId
    });
    assert.equal(composeSection({ type: "capacity", status: "answered", facts: flow.outcomes[0].facts }), `${target.publicName}最多可住 ${target.capacity} 人。`);
  }
  assert.equal(availabilityResolverCalls, 0);
  assert.deepEqual({
    stayDependency: capacityDefinition.stayDependency,
    requiredFields: capacityDefinition.requiredFields,
    resolverId: capacityDefinition.resolverId
  }, {
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog"
  });

  const missingCapacityCatalog = buildPropertyCatalog({
    ...capacityProperty,
    rooms: [{ id: "capacity-missing", name: "容量未設定房型", capacity: 0, enabled: true }]
  });
  const missingCapacity = runCapacityFlow({
    taskId: "capacity-missing",
    canonicalEntity: { status: "resolved", category: "room", canonicalId: "capacity-missing", canonicalSet: [], rawText: "容量未設定房型" },
    lodgingProduct: { productType: "room_type", productId: "capacity-missing", roomTypeId: "capacity-missing", bundleId: null },
    catalog: missingCapacityCatalog
  });
  assert.equal(missingCapacity.outcomes[0].outcome, "unknown");
  assert.equal(missingCapacity.outcomes[0].reason, "capacity_unknown");

  for (const unresolvedEntity of [
    { status: "not_found", category: "room", canonicalId: null, canonicalSet: [], rawText: "未解析房型" },
    { status: "matched_set", category: "room", canonicalId: null, canonicalSet: ["orchid-suite", "harbor-villa"], rawText: "模糊房型" }
  ]) {
    const unresolved = runCapacityFlow({
      taskId: `capacity-${unresolvedEntity.status}`,
      canonicalEntity: unresolvedEntity,
      lodgingProduct: { productType: "any", productId: null, roomTypeId: null, bundleId: null }
    });
    assert.equal(unresolved.outcomes[0].outcome, "unknown");
    assert.equal(unresolved.outcomes[0].reason, "capacity_unknown");
  }

  const uncertainGuestFormal = buildCanonicalFormalRequest({
    property: { propertyId: "property-alpha" },
    canonicalRequest: request,
    requestCycleId: "uncertain-guest-cycle",
    confirmedInputs: {
      stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", guests: null },
      inventory: { mode: "any", entityId: null, features: [] },
      uncertainties: { guestCount: true }
    }
  });
  assert.equal(uncertainGuestFormal.readiness.status, "missing_information", "an explicitly uncertain guest count must block availability execution");
  assert.deepEqual(uncertainGuestFormal.readiness.missingFields, ["guestCount"]);

  const absentGuestFormal = buildCanonicalFormalRequest({
    property: { propertyId: "property-alpha" },
    canonicalRequest: request,
    requestCycleId: "absent-guest-cycle",
    confirmedInputs: {
      stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", guests: null },
      inventory: { mode: "any", entityId: null, features: [] }
    }
  });
  assert.equal(absentGuestFormal.readiness.status, "ready", "ordinary availability without a guest-count request must remain executable");

  const exactGuestFormal = buildCanonicalFormalRequest({
    property: { propertyId: "property-alpha" },
    canonicalRequest: request,
    requestCycleId: "exact-guest-cycle",
    confirmedInputs: {
      stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", guests: 7 },
      inventory: { mode: "any", entityId: null, features: [] }
    }
  });
  assert.equal(exactGuestFormal.readiness.status, "ready", "an exact guest count must remain executable");

  console.log("canonical request contract: PASS");
}

run();
