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
  buildCanonicalFormalRequest
} = require("../lib/conversation-engine-v2/formal-request");

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
  const capacityRequest = createCanonicalRequest({
    taskId: "capacity-0",
    capability: "capacity",
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
    temporalState: {
      ...temporalState(),
      applicableTaskIds: ["capacity-0"]
    },
    stayDependency: capacityDefinition.stayDependency,
    requiredFields: capacityDefinition.requiredFields,
    resolverId: capacityDefinition.resolverId,
    riskLevel: capacityDefinition.riskLevel,
    responseMode: capacityDefinition.responseMode,
    evidenceRefs: evidenceRefs()
  });
  const capacityFormal = buildCanonicalFormalRequest({
    property: { propertyId: "property-alpha" },
    canonicalRequest: capacityRequest,
    requestCycleId: "capacity-cycle",
    confirmedInputs: {
      stay: {
        checkIn: "2026-08-06",
        checkOut: "2026-08-07",
        guests: null
      },
      inventory: { mode: "any", entityId: null, features: [] }
    }
  });
  assert.equal(capacityFormal.readiness.status, "missing_information");
  assert.deepEqual(capacityFormal.readiness.missingFields, ["guestCount"]);
  assert.deepEqual(capacityFormal.resolverTask, {
    propertyId: "property-alpha",
    taskType: "capacity",
    productType: "any",
    productId: null,
    checkIn: "2026-08-06",
    checkOut: "2026-08-07",
    guestCount: null
  });

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
