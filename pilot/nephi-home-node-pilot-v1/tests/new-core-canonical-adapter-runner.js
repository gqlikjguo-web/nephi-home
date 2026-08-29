"use strict";

const assert = require("node:assert/strict");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const canonicalizer = require("../lib/conversation-engine-v2/canonicalizer");

// Module-boundary authority must already be immutable before the C08 adapter
// loads and captures it. Each attack must fail without changing the function.
const OFFICIAL_CANONICALIZER = canonicalizer.canonicalizeExecutionItem;
assert.throws(() => {
  canonicalizer.canonicalizeExecutionItem = () => ({
    canonicalRequest: { canonicalEntity: { status: "matched_set", canonicalSet: ["room-a"] } }
  });
}, TypeError);
assert.equal(canonicalizer.canonicalizeExecutionItem, OFFICIAL_CANONICALIZER);
assert.throws(() => {
  delete canonicalizer.canonicalizeExecutionItem;
}, TypeError);
assert.equal(canonicalizer.canonicalizeExecutionItem, OFFICIAL_CANONICALIZER);
assert.throws(() => {
  Object.defineProperty(canonicalizer, "canonicalizeExecutionItem", {
    value: () => ({
      canonicalRequest: { canonicalEntity: { status: "resolved", category: "amenity" } }
    })
  });
}, TypeError);
assert.equal(canonicalizer.canonicalizeExecutionItem, OFFICIAL_CANONICALIZER);
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const {
  buildUnderstandingTurnInput,
  buildPublicCatalogIdentityProjection
} = require("../lib/new-core/turn-input-adapter");
const { validateAndNormalizeSourceEvidence } = require("../lib/new-core/source-evidence-validator");
const {
  buildPublicCatalogIdentitySet,
  projectCapabilityRegistry,
  validateSemanticUnit
} = require("../lib/new-core/semantic-unit-validator");
const { validateContextLink } = require("../lib/new-core/context-link-validator");
const { createLifecycleDecision } = require("../lib/new-core/lifecycle-manager");
const {
  createUnitReplyRoutingRegistry,
  createUnitReadiness,
  createTrustedOperatorSafetyPolicy,
  createUnitRoutingDecision
} = require("../lib/new-core/unit-reply-router");
const {
  createCanonicalizerInputItem,
  executeCanonicalizerInputItem,
  isTrustedCanonicalizerInputItem
} = require("../lib/new-core/canonical-execution-adapter");
const {
  CANONICALIZER_INPUT_ITEM_FIELDS,
  validateCanonicalizerInputItem
} = require("../lib/new-core/contracts/canonicalizer-input-item");

const NOW = "2026-08-28T08:00:00.000Z";
const FUTURE = "2026-08-29T08:00:00.000Z";
const scope = { propertyId: "property-c08", channel: "line-c08", userId: "guest-c08" };
const routingRegistry = createUnitReplyRoutingRegistry(projectCapabilityRegistry(CAPABILITY_REGISTRY));
const PROVENANCE_INPUT_BY_C08 = new WeakMap();
const catalog = buildPropertyCatalog({
  propertyId: scope.propertyId,
  displayName: "C08 Property",
  timezone: "Asia/Taipei",
  businessProfile: { googleMapsUrl: "https://maps.app.goo.gl/C08CanonicalMap" },
  rooms: [
    { id: "room-a", displayName: "Room A", type: "four_person", aliases: ["四人房"], enabled: true },
    { id: "room-b", displayName: "Room B", type: "four_person", aliases: ["四人房"], enabled: true },
    { id: "bundle-a", displayName: "Whole House", inventoryType: "bundle", aliases: ["包棟"], enabled: true, memberRoomIds: ["room-a", "room-b"] }
  ],
  propertyFacts: [
    { canonicalId: "parking", category: "amenity", publicName: "Parking", status: "available", publicText: "Parking fact" },
    { canonicalId: "breakfast", category: "amenity", publicName: "Breakfast", status: "available", publicText: "Breakfast fact" },
    { canonicalId: "pet-policy", category: "policy", publicName: "Pet policy", status: "available", publicText: "Pet policy fact" }
  ],
  commonAnswers: {}
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function evidence(messageText, overrides = {}) {
  return {
    eventId: "event-c08",
    messageRef: "message-c08",
    startOffset: 0,
    endOffset: messageText.length,
    quote: messageText,
    ...overrides
  };
}

function turnInput(messageText, overrides = {}) {
  return buildUnderstandingTurnInput({
    coreVersion: "new-core-v1",
    traceId: `trace-${messageText.length}-${overrides.turnSuffix || "base"}`,
    turnId: `turn-${messageText.length}-${overrides.turnSuffix || "base"}`,
    verifiedPropertyBinding: { propertyId: scope.propertyId, channel: scope.channel },
    verifiedConversationScope: { channel: scope.channel, userId: scope.userId },
    sourceEvents: [{
      eventId: "event-c08",
      messageRef: "message-c08",
      role: "guest",
      timestamp: NOW,
      messageKind: "text",
      messageText
    }],
    recentConversation: [],
    stateV3Snapshot: {
      scope,
      referenceableCycles: [{
        requestCycleId: "cycle-c08",
        status: "answered",
        expiresAt: FUTURE,
        slotRefs: ["checkIn", "checkOut", "guestCount", "productId"]
      }]
    },
    publicCatalog: {
      propertyId: scope.propertyId,
      timezone: "Asia/Taipei",
      capabilityCatalog: ["availability", "available_dates", "price", "total_price", "capacity", "property_fact", "amenity", "policy", "location", "booking_request", "high_risk"],
      publicSubjectCatalog: [
        { catalogIdentity: scope.propertyId, kind: "property", propertyId: scope.propertyId, publicName: "C08 Property" },
        { catalogIdentity: "room-a", kind: "room", propertyId: scope.propertyId, publicName: "Room A" },
        { catalogIdentity: "room-b", kind: "room", propertyId: scope.propertyId, publicName: "Room B" },
        { catalogIdentity: "bundle-a", kind: "bundle", propertyId: scope.propertyId, publicName: "Whole House" },
        { catalogIdentity: "matched-four-person", kind: "matched_room_set", propertyId: scope.propertyId, publicName: "四人房" },
        { catalogIdentity: "parking", kind: "amenity", propertyId: scope.propertyId, publicName: "Parking" },
        { catalogIdentity: "breakfast", kind: "amenity", propertyId: scope.propertyId, publicName: "Breakfast" },
        { catalogIdentity: "pet-policy", kind: "policy", propertyId: scope.propertyId, publicName: "Pet policy" },
        { catalogIdentity: "operator-c08", kind: "other_verified", propertyId: scope.propertyId, publicName: "Operator request" }
      ]
    }
  });
}

function temporal(rawText = "2026/10/09-10/10") {
  return {
    rawText,
    kind: "date_range",
    checkInCandidate: "2026-10-09",
    checkOutCandidate: "2026-10-10",
    nightsCandidate: 1
  };
}

function slot(messageText, { id, slot: slotName, value, operation = "SET" }) {
  return {
    slotCandidateId: id,
    slot: slotName,
    operation,
    value,
    evidenceRefs: [evidence(messageText)]
  };
}

function candidate(messageText, overrides = {}) {
  return {
    unitId: overrides.unitId || `unit-${messageText.length}`,
    evidenceRefs: [evidence(messageText)],
    purpose: "lodging_question",
    capability: "availability",
    subject: { kind: "room", catalogIdentity: "room-a" },
    stayDependent: true,
    temporalCandidate: temporal(),
    contextLinkCandidateId: overrides.contextLinkCandidateId || `link-${messageText.length}`,
    replyCandidate: { disposition: "ANSWER", reasonClass: "lodging_need" },
    slotCandidates: [],
    confidenceBand: "high",
    ...overrides
  };
}

function pipeline({
  messageText,
  unitOverrides = {},
  action = "START",
  target = null,
  turnSuffix = "base"
}) {
  const input = turnInput(messageText, { turnSuffix });
  const rawUnit = candidate(messageText, unitOverrides);
  const normalizedEvidence = validateAndNormalizeSourceEvidence(rawUnit.evidenceRefs, input.sourceEvents);
  assert.equal(normalizedEvidence.ok, true, normalizedEvidence.code);
  const semantic = validateSemanticUnit({
    unit: rawUnit,
    validatedEvidenceRefs: normalizedEvidence.value,
    understandingTurnInput: input,
    publicCatalogIdentitySet: buildPublicCatalogIdentitySet(input),
    capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY)
  });
  assert.equal(semantic.ok, true, semantic.code);
  const context = validateContextLink({
    unit: semantic.value,
    linkCandidate: {
      contextLinkCandidateId: semantic.value.contextLinkCandidateId,
      unitId: semantic.value.unitId,
      actionCandidate: action,
      targetRequestCycleId: target,
      evidenceRefs: semantic.value.evidenceRefs
    },
    understandingTurnInput: input,
    validatedEvidenceRefs: normalizedEvidence.value,
    now: NOW
  });
  assert.equal(context.ok, true, context.code);
  const lifecycle = createLifecycleDecision({
    lifecycleDecisionId: `lifecycle-${semantic.value.unitId}-${turnSuffix}`,
    unit: semantic.value,
    validatedContextLink: context.value
  });
  assert.equal(lifecycle.ok, true, lifecycle.code);
  const readiness = createUnitReadiness({
    unit: semantic.value,
    lifecycleDecision: lifecycle.value,
    routingRegistry
  });
  assert.equal(readiness.ok, true, readiness.code);
  const safety = ["booking_operator_request", "high_risk"].includes(semantic.value.capability)
    ? createTrustedOperatorSafetyPolicy({
      unit: semantic.value,
      lifecycleDecision: lifecycle.value,
      routingRegistry
    })
    : null;
  if (safety) assert.equal(safety.ok, true, safety.code);
  const route = createUnitRoutingDecision({
    unit: semantic.value,
    lifecycleDecision: lifecycle.value,
    routingRegistry,
    readiness: readiness.value,
    operatorSafetyPolicy: safety && safety.value
  });
  assert.equal(route.ok, true, route.code);
  return { input, evidence: normalizedEvidence.value, unit: semantic.value, lifecycle: lifecycle.value, route: route.value };
}

function createC08(values, overrides = {}) {
  const canonicalizerCatalog = overrides.canonicalizerCatalog || catalog;
  const result = createCanonicalizerInputItem({
    unit: values.unit,
    lifecycleDecision: values.lifecycle,
    routingDecision: values.route,
    understandingTurnInput: values.input,
    canonicalizerCatalog,
    publicCatalogIdentityProjection: buildPublicCatalogIdentityProjection(values.input)
  });
  if (result.ok) PROVENANCE_INPUT_BY_C08.set(result.value, values.input);
  return result;
}

function contextSnapshot(overrides = {}) {
  return {
    scope: { propertyId: scope.propertyId, channelId: scope.channel, userId: scope.userId },
    generatedAt: NOW,
    cycles: [{
      requestCycleId: "cycle-c08",
      requestKind: "availability",
      status: "answered",
      confirmedInputs: {
        stay: { checkIn: "2026-09-01", checkOut: "2026-09-03", nights: 2, guests: 3, searchRange: null },
        inventory: { mode: "bundle_only", entityId: "bundle-a", features: [] },
        topic: { capabilityType: "availability", canonicalId: "bundle-a", category: "bundle", detailIntent: "general", detailFields: [] }
      },
      temporalResult: null,
      sourceEvidenceRefs: [],
      contextReuseExpiresAt: FUTURE,
      pendingRequestId: null
    }],
    ...overrides
  };
}

function execute(c08, overrides = {}) {
  return executeCanonicalizerInputItem({
    canonicalizerInputItem: c08,
    catalog: overrides.catalog || catalog,
    publicCatalogIdentityProjection: overrides.publicCatalogIdentityProjection
      || buildPublicCatalogIdentityProjection(PROVENANCE_INPUT_BY_C08.get(c08)),
    contextSnapshot: overrides.contextSnapshot || contextSnapshot()
  });
}

function hasKey(value, key, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((item) => hasKey(item, key, seen));
}

function assertFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
}

// AC-CAN-001..003 / AC-AVL-001..003: a trusted room ANSWER becomes one
// candidate-index-free C08 and keeps C03/C04 fields exactly until the sole
// canonicalizer creates executable dates and capability policy.
const roomAvailability = pipeline({ messageText: "Room A 2026/10/09-10/10 還有房嗎？", turnSuffix: "room" });
const roomC08 = createC08(roomAvailability);
assert.equal(roomC08.ok, true, roomC08.code);
assert.equal(isTrustedCanonicalizerInputItem(roomC08.value), true);
assert.deepEqual(Object.keys(roomC08.value), CANONICALIZER_INPUT_ITEM_FIELDS);
assert.equal(roomC08.value.capabilityCandidate, roomAvailability.unit.capability);
assert.deepEqual(roomC08.value.subjectCandidate, roomAvailability.unit.subject);
assert.equal(roomC08.value.stayDependent, roomAvailability.unit.stayDependent);
assert.deepEqual(roomC08.value.temporalCandidate, roomAvailability.unit.temporalCandidate);
assert.deepEqual(roomC08.value.verifiedSlotInputs, roomAvailability.lifecycle.verifiedSlotOperations);
assert.deepEqual(roomC08.value.evidenceRefs, roomAvailability.unit.evidenceRefs);
assert.deepEqual(roomC08.value.propertyScope, roomAvailability.input.propertyScope);
assert.equal(Object.isFrozen(roomC08.value), true);
const canonicalRoom = execute(roomC08.value);
assert.equal(canonicalRoom.ok, true, canonicalRoom.code);
assert.equal(canonicalRoom.value.unitId, roomAvailability.unit.unitId);
assert.equal(canonicalRoom.value.canonicalRequest.capability, "availability");
assert.equal(canonicalRoom.value.canonicalRequest.canonicalEntity.canonicalId, "room-a");
assert.deepEqual([
  canonicalRoom.value.canonicalRequest.temporalState.checkIn,
  canonicalRoom.value.canonicalRequest.temporalState.checkOut,
  canonicalRoom.value.canonicalRequest.temporalState.nights
], ["2026-10-09", "2026-10-10", 1]);
assert.deepEqual(canonicalRoom.value.canonicalRequest.evidenceRefs, roomAvailability.unit.evidenceRefs);

const genericAvailability = pipeline({
  messageText: "2026/10/09-10/10 還有房嗎？",
  unitOverrides: {
    unitId: "unit-generic-property-availability",
    subject: { kind: "property", catalogIdentity: null }
  },
  turnSuffix: "generic-property-availability"
});
const genericC08 = createC08(genericAvailability);
assert.equal(genericC08.ok, true, JSON.stringify(genericC08));
const canonicalGeneric = execute(genericC08.value);
assert.equal(canonicalGeneric.ok, true, canonicalGeneric.code);
assert.equal(canonicalGeneric.value.canonicalRequest.capability, "availability");
assert.equal(canonicalGeneric.value.canonicalRequest.canonicalEntity.status, "not_requested");
assert.equal(canonicalGeneric.value.canonicalRequest.canonicalEntity.canonicalId, null);
assert.equal(canonicalGeneric.value.canonicalRequest.lodgingProduct.productType, "any");
assert.equal(canonicalGeneric.value.canonicalRequest.lodgingProduct.roomTypeId, null);
assert.equal(canonicalGeneric.value.canonicalRequest.lodgingProduct.bundleId, null);
assert.deepEqual(canonicalGeneric.value.stateInput.confirmedFields.inventory, null);

// Round-2 ruling: C03 temporal candidates are source-bound AI candidates, not
// executable dates. The sole official canonicalizer may reject those fields
// and repair them from its canonical temporal grammar.
const repairedCandidate = pipeline({
  messageText: "Room A 2026/10/09-10/10 還有房嗎？",
  unitOverrides: {
    unitId: "unit-repaired-c03-candidate",
    temporalCandidate: {
      rawText: "2026/10/09-10/10",
      kind: "date_range",
      checkInCandidate: "2030-01-02",
      checkOutCandidate: "2030-01-04",
      nightsCandidate: 2
    }
  },
  turnSuffix: "repaired-c03-candidate"
});
const repairedCandidateC08 = createC08(repairedCandidate);
assert.equal(repairedCandidateC08.ok, true, repairedCandidateC08.code);
const canonicalRepairedCandidate = execute(repairedCandidateC08.value);
assert.equal(canonicalRepairedCandidate.ok, true, canonicalRepairedCandidate.code);
assert.deepEqual([
  canonicalRepairedCandidate.value.canonicalRequest.temporalState.checkIn,
  canonicalRepairedCandidate.value.canonicalRequest.temporalState.checkOut,
  canonicalRepairedCandidate.value.canonicalRequest.temporalState.nights,
  canonicalRepairedCandidate.value.canonicalRequest.temporalState.repairReasonCode
], ["2026-10-09", "2026-10-10", 1, "planner_candidate_rejected"]);

// AC-CAN-004 / AC-AVL-002,006: the historical bundle availability shape is
// passed as availability+bundle; only the unchanged canonicalizer may select
// its existing bundle_availability executable capability.
const bundleAvailability = pipeline({
  messageText: "Whole House 2026/10/09-10/10 是否還可以預訂？",
  unitOverrides: { unitId: "unit-bundle-availability", subject: { kind: "bundle", catalogIdentity: "bundle-a" } },
  turnSuffix: "bundle-availability"
});
const bundleC08 = createC08(bundleAvailability);
assert.equal(bundleC08.ok, true, bundleC08.code);
assert.equal(bundleC08.value.capabilityCandidate, "availability");
assert.deepEqual(bundleC08.value.subjectCandidate, { kind: "bundle", catalogIdentity: "bundle-a" });
const canonicalBundle = execute(bundleC08.value);
assert.equal(canonicalBundle.ok, true, canonicalBundle.code);
assert.equal(canonicalBundle.value.canonicalRequest.capability, "bundle_availability");
assert.equal(canonicalBundle.value.canonicalRequest.canonicalEntity.canonicalId, "bundle-a");
assert.equal(canonicalBundle.value.canonicalRequest.canonicalEntity.category, "bundle");
assert.equal(canonicalBundle.value.canonicalRequest.lodgingProduct.productType, "bundle");
assert.equal(canonicalBundle.value.canonicalRequest.lodgingProduct.bundleId, "bundle-a");
assert.deepEqual(canonicalBundle.value.stateInput.confirmedFields.inventory, {
  mode: "bundle_only",
  entityId: "bundle-a"
});

// AC-CAN-005 / AC-PRI-001..005: price and total-price candidates keep their
// exact capability, bundle subject, temporal input, and formal price route.
for (const capability of ["price", "total_price"]) {
  const priced = pipeline({
    messageText: `${capability} Whole House 2026/10/09-10/10`,
    unitOverrides: { unitId: `unit-${capability}`, capability, subject: { kind: "bundle", catalogIdentity: "bundle-a" } },
    turnSuffix: capability
  });
  const c08 = createC08(priced);
  assert.equal(c08.ok, true, c08.code);
  const canonical = execute(c08.value);
  assert.equal(canonical.ok, true, canonical.code);
  assert.equal(c08.value.capabilityCandidate, capability);
  assert.equal(canonical.value.canonicalRequest.capability, capability);
  assert.equal(canonical.value.canonicalRequest.resolverId, "availability_resolver");
  assert.equal(canonical.value.canonicalRequest.lodgingProduct.bundleId, "bundle-a");
}

// AC-CAN-006 / AC-FCT-001..010 / AC-LOC-001..005: facts, amenity, policy,
// and location subjects reach the current property catalog without adapter
// alias scanning or a facts/result field in C08.
for (const [capability, subject, expectedCapability, expectedCategory] of [
  ["property_fact", { kind: "amenity", catalogIdentity: "parking" }, "parking", "amenity"],
  ["amenity", { kind: "amenity", catalogIdentity: "breakfast" }, "amenity", "amenity"],
  ["policy", { kind: "policy", catalogIdentity: "pet-policy" }, "policy", "policy"],
  ["location", { kind: "external_place", catalogIdentity: null }, "location", "transport"]
]) {
  const messageText = `${capability} question`;
  const factual = pipeline({
    messageText,
    unitOverrides: {
      unitId: `unit-${capability}-${expectedCapability}`,
      capability,
      subject,
      stayDependent: false,
      temporalCandidate: null
    },
    turnSuffix: `${capability}-${expectedCapability}`
  });
  const c08 = createC08(factual);
  assert.equal(c08.ok, true, c08.code);
  assert.equal(Object.hasOwn(c08.value, "facts"), false);
  assert.equal(Object.hasOwn(c08.value, "resolverId"), false);
  const canonical = execute(c08.value);
  assert.equal(canonical.ok, true, canonical.code);
  assert.equal(canonical.value.canonicalRequest.capability, expectedCapability);
  assert.equal(canonical.value.canonicalRequest.resolverId, "property_catalog");
  assert.equal(canonical.value.canonicalRequest.canonicalEntity.category, expectedCategory);
  assert.equal(canonical.value.canonicalRequest.lodgingProduct.productType, "any");
  assert.equal(canonical.value.stateInput.confirmedFields.inventory, null);
}

// AC-CAN-007 / AC-AVL-005: a catalog-validated matched room set is passed as
// a set candidate and the unchanged entity resolver retains the complete set.
const matchedRooms = pipeline({
  messageText: "四人房 2026/10/09-10/10 還有嗎？",
  unitOverrides: { unitId: "unit-matched-rooms", subject: { kind: "matched_room_set", catalogIdentity: "matched-four-person" } },
  turnSuffix: "matched"
});
const matchedC08 = createC08(matchedRooms);
assert.equal(matchedC08.ok, true, matchedC08.code);
const canonicalMatched = execute(matchedC08.value);
assert.equal(canonicalMatched.ok, true, canonicalMatched.code);
assert.equal(canonicalMatched.value.canonicalRequest.canonicalEntity.status, "matched_set");
assert.equal(canonicalMatched.value.canonicalRequest.canonicalEntity.category, "room");
assert.deepEqual([...canonicalMatched.value.canonicalRequest.canonicalEntity.canonicalSet].sort(), ["room-a", "room-b"]);
assert.equal(canonicalMatched.value.canonicalRequest.lodgingProduct.productType, "any");
assert.equal(canonicalMatched.value.stateInput.confirmedFields.inventory, null);

// AC-CAN-008 / AC-TMP-006,010 / context-slot coverage: the adapter maps only
// this unit's evidence-bound temporal source and exact verified slots. Context
// target data is admitted only through the exact C06 target and same scope.
const contextMessage = "改問 Whole House 2026/10/09-10/10，4位";
const continued = pipeline({
  messageText: contextMessage,
  unitOverrides: {
    unitId: "unit-context-answer",
    capability: "capacity",
    subject: { kind: "bundle", catalogIdentity: "bundle-a" },
    slotCandidates: [
      slot(contextMessage, { id: "slot-guests-c08", slot: "guest_count", value: 4 }),
      slot(contextMessage, { id: "slot-product-c08", slot: "product", value: "bundle-a" })
    ]
  },
  action: "CONTINUE",
  target: "cycle-c08",
  turnSuffix: "context"
});
const continuedC08 = createC08(continued);
assert.equal(continuedC08.ok, true, continuedC08.code);
assert.deepEqual(continuedC08.value.verifiedSlotInputs, continued.lifecycle.verifiedSlotOperations);
const canonicalContinued = execute(continuedC08.value);
assert.equal(canonicalContinued.ok, true, canonicalContinued.code);
assert.equal(canonicalContinued.value.stateInput.confirmedFields.guests, 4);
assert.equal(canonicalContinued.value.canonicalRequest.lodgingProduct.bundleId, "bundle-a");

// The exact approved context remains canonicalizer input authority on
// CONTINUE. C03 need not duplicate dates already owned by that context.
const approvedContextContinuation = pipeline({
  messageText: "parking question",
  unitOverrides: {
    unitId: "unit-approved-context-continuation",
    capability: "property_fact",
    subject: { kind: "amenity", catalogIdentity: "parking" },
    stayDependent: false,
    temporalCandidate: null
  },
  action: "CONTINUE",
  target: "cycle-c08",
  turnSuffix: "approved-context-continuation"
});
const approvedContextC08 = createC08(approvedContextContinuation);
assert.equal(approvedContextC08.ok, true, approvedContextC08.code);
const canonicalApprovedContext = execute(approvedContextC08.value);
assert.equal(canonicalApprovedContext.ok, true, canonicalApprovedContext.code);
assert.deepEqual([
  canonicalApprovedContext.value.canonicalRequest.temporalState.expressionType,
  canonicalApprovedContext.value.canonicalRequest.temporalState.checkIn,
  canonicalApprovedContext.value.canonicalRequest.temporalState.checkOut,
  canonicalApprovedContext.value.canonicalRequest.temporalState.resolutionSource
], ["context", "2026-09-01", "2026-09-03", "approved_context"]);
assert.equal(canonicalApprovedContext.value.canonicalRequest.canonicalEntity.category, "amenity");
assert.equal(canonicalApprovedContext.value.canonicalRequest.lodgingProduct.productType, "bundle");
assert.equal(canonicalApprovedContext.value.canonicalRequest.lodgingProduct.bundleId, "bundle-a");
assert.equal(canonicalApprovedContext.value.stateInput.confirmedFields.inventory, null);

// AC-CAN-009: only a trusted exact ANSWER may own C08. CLARIFY, HANDOFF,
// NO_REPLY, and even a structurally ANSWER lifecycle END own no canonical item.
const clarify = pipeline({
  messageText: "Room A 還有嗎？",
  unitOverrides: { unitId: "unit-clarify", temporalCandidate: null, replyCandidate: { disposition: "CLARIFY", reasonClass: "missing_stay_dates" } },
  turnSuffix: "clarify"
});
assertFailure(createC08(clarify), "CANONICAL_INPUT_NOT_ANSWER");
const handoff = pipeline({
  messageText: "幫我取消訂房",
  unitOverrides: {
    unitId: "unit-handoff",
    purpose: "operator_request",
    capability: "booking_operator_request",
    subject: { kind: "other_verified", catalogIdentity: "operator-c08" },
    stayDependent: false,
    temporalCandidate: null,
    replyCandidate: { disposition: "HANDOFF", reasonClass: "reservation_cancellation" }
  },
  turnSuffix: "handoff"
});
assertFailure(createC08(handoff), "CANONICAL_INPUT_NOT_ANSWER");
const noReply = pipeline({
  messageText: "謝謝",
  unitOverrides: {
    unitId: "unit-no-reply",
    purpose: "acknowledgement",
    capability: null,
    subject: { kind: null, catalogIdentity: null },
    stayDependent: false,
    temporalCandidate: null,
    replyCandidate: { disposition: "NO_REPLY", reasonClass: "acknowledgement" }
  },
  action: "NONE",
  turnSuffix: "no-reply"
});
assertFailure(createC08(noReply), "CANONICAL_INPUT_NOT_ANSWER");
const lifecycleOnly = pipeline({
  messageText: "parking question",
  unitOverrides: {
    unitId: "unit-answer-end",
    capability: "property_fact",
    subject: { kind: "amenity", catalogIdentity: "parking" },
    stayDependent: false,
    temporalCandidate: null
  },
  action: "END",
  target: "cycle-c08",
  turnSuffix: "answer-end"
});
assert.equal(lifecycleOnly.route.disposition, "ANSWER", "this proves C08 closes the lifecycle/router gap itself");
assertFailure(createC08(lifecycleOnly), "CANONICAL_INPUT_NOT_ANSWER");

// AC-CAN-010: missing/invalid evidence and closed-schema additions fail at
// the C08 contract instead of being repaired from source text or catalog data.
assertFailure(validateCanonicalizerInputItem({
  ...clone(roomC08.value),
  evidenceRefs: []
}), "CANONICAL_INPUT_INCOMPLETE");
assertFailure(validateCanonicalizerInputItem({
  ...clone(roomC08.value),
  inventedSemanticRepair: "parking"
}), "CANONICAL_INPUT_INCOMPLETE");

// AC-CAN-011 / AC-ISO-002..004: identifier-equivalent clones, foreign exact
// C03/C06/C07 owners, wrong-property catalogs, and wrong-scope context fail
// closed. Equality of public fields is never authority.
assertFailure(createCanonicalizerInputItem({
  unit: clone(roomAvailability.unit),
  lifecycleDecision: roomAvailability.lifecycle,
  routingDecision: roomAvailability.route,
  understandingTurnInput: roomAvailability.input
}), "CANONICAL_ADAPTER_OWNERSHIP_CONFLICT");
assertFailure(createCanonicalizerInputItem({
  unit: roomAvailability.unit,
  lifecycleDecision: clone(roomAvailability.lifecycle),
  routingDecision: roomAvailability.route,
  understandingTurnInput: roomAvailability.input
}), "CANONICAL_ADAPTER_OWNERSHIP_CONFLICT");
const foreignRoom = pipeline({ messageText: "Room A 2026/10/09-10/10 還有房嗎？", unitOverrides: { unitId: roomAvailability.unit.unitId }, turnSuffix: "foreign" });
assertFailure(createCanonicalizerInputItem({
  unit: roomAvailability.unit,
  lifecycleDecision: roomAvailability.lifecycle,
  routingDecision: foreignRoom.route,
  understandingTurnInput: roomAvailability.input
}), "CANONICAL_ADAPTER_OWNERSHIP_CONFLICT");
const foreignCatalogAtCreation = clone(catalog);
foreignCatalogAtCreation.rooms = foreignCatalogAtCreation.rooms.map((room) => (
  room.canonicalId === "room-a" ? { ...room, canonicalId: "foreign-room" } : room
));
assertFailure(createCanonicalizerInputItem({
  unit: roomAvailability.unit,
  lifecycleDecision: roomAvailability.lifecycle,
  routingDecision: roomAvailability.route,
  understandingTurnInput: roomAvailability.input,
  canonicalizerCatalog: foreignCatalogAtCreation,
  publicCatalogIdentityProjection: buildPublicCatalogIdentityProjection(roomAvailability.input)
}), "CANONICAL_ADAPTER_OWNERSHIP_CONFLICT");
assertFailure(execute(roomC08.value, { catalog: { ...catalog, propertyId: "property-foreign" } }), "CANONICAL_ADAPTER_OWNERSHIP_CONFLICT");
assertFailure(execute(roomC08.value, { catalog: clone(catalog) }), "CANONICAL_ADAPTER_OWNERSHIP_CONFLICT");
assertFailure(execute(roomC08.value, {
  publicCatalogIdentityProjection: clone(buildPublicCatalogIdentityProjection(roomAvailability.input))
}), "CANONICAL_ADAPTER_OWNERSHIP_CONFLICT");
assertFailure(execute(continuedC08.value, {
  contextSnapshot: contextSnapshot({ scope: { propertyId: scope.propertyId, channelId: "line-foreign", userId: scope.userId } })
}), "CANONICAL_ADAPTER_OWNERSHIP_CONFLICT");

// Catalog/C01 authority is snapshotted at C08 issuance. Mutating the exact
// caller-owned catalog object afterward cannot replace the room the official
// canonicalizer sees.
const mutableRoomCatalog = clone(catalog);
const immutableRoomC08 = createC08(roomAvailability, {
  canonicalizerCatalog: mutableRoomCatalog
});
assert.equal(immutableRoomC08.ok, true, immutableRoomC08.code);
assert.equal(Object.isFrozen(mutableRoomCatalog), false, "issuance must detach instead of freezing caller data");
mutableRoomCatalog.rooms.find((room) => room.canonicalId === "room-a").canonicalId = "foreign-room";
const immutableRoomResult = execute(immutableRoomC08.value, { catalog: mutableRoomCatalog });
assert.equal(immutableRoomResult.ok, true, immutableRoomResult.code);
assert.equal(immutableRoomResult.value.canonicalRequest.canonicalEntity.canonicalId, "room-a");

// Adding a matching foreign room after issuance cannot expand the complete
// official matched set beyond exact trusted C01 room identities.
const mutableMatchedCatalog = clone(catalog);
const immutableMatchedC08 = createC08(matchedRooms, {
  canonicalizerCatalog: mutableMatchedCatalog
});
assert.equal(immutableMatchedC08.ok, true, immutableMatchedC08.code);
const roomTemplate = mutableMatchedCatalog.rooms.find((room) => room.canonicalId === "room-a");
mutableMatchedCatalog.rooms.push({
  ...clone(roomTemplate),
  canonicalId: "foreign-room",
  publicName: "Foreign Room"
});
const immutableMatchedResult = execute(immutableMatchedC08.value, {
  catalog: mutableMatchedCatalog
});
assert.equal(immutableMatchedResult.ok, true, immutableMatchedResult.code);
assert.deepEqual(
  [...immutableMatchedResult.value.canonicalRequest.canonicalEntity.canonicalSet].sort(),
  ["room-a", "room-b"]
);

// AC-CAN-012 / AC-MNT-009: candidateIndex is created and destroyed inside
// the captured official compatibility call. It is never present in C08 or in
// the closed new-core result at any recursive depth.
const officialRoomResult = execute(roomC08.value);
assert.equal(officialRoomResult.ok, true, officialRoomResult.code);
assert.equal(hasKey(roomC08.value, "candidateIndex"), false);
assert.equal(hasKey(officialRoomResult.value, "candidateIndex"), false);
assert.equal(officialRoomResult.value.canonicalRequest.canonicalEntity.category, "room");
assert.equal(officialRoomResult.value.canonicalRequest.lodgingProduct.productType, "room_type");
assert.equal(officialRoomResult.value.canonicalRequest.lodgingProduct.roomTypeId, "room-a");
assert.deepEqual(officialRoomResult.value.stateInput.confirmedFields.inventory, {
  mode: "room_only",
  entityId: "room-a"
});

// Assignment/delete/redefine attacks above occurred before the adapter load.
// The exact official function still supplies the complete set and the exact
// room category/product/inventory mapping after that preload boundary.
const subsetAttempt = execute(matchedC08.value);
assert.equal(subsetAttempt.ok, true, subsetAttempt.code);
assert.deepEqual(
  [...subsetAttempt.value.canonicalRequest.canonicalEntity.canonicalSet].sort(),
  ["room-a", "room-b"]
);
const categoryAttempt = execute(roomC08.value);
assert.equal(categoryAttempt.ok, true, categoryAttempt.code);
assert.equal(categoryAttempt.value.canonicalRequest.canonicalEntity.category, "room");
assert.equal(categoryAttempt.value.canonicalRequest.canonicalEntity.canonicalId, "room-a");
assert.equal(categoryAttempt.value.canonicalRequest.lodgingProduct.productType, "room_type");
assert.deepEqual(categoryAttempt.value.stateInput.confirmedFields.inventory, {
  mode: "room_only",
  entityId: "room-a"
});

console.log(JSON.stringify({ suite: "new-core-canonical-adapter", caseCount: 24, passCount: 24, failCount: 0, evidenceLevel: "STRUCTURED_CONTRACT_TEST" }));
