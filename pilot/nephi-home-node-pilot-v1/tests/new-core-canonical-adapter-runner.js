"use strict";

const assert = require("node:assert/strict");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const canonicalizer = require("../lib/conversation-engine-v2/canonicalizer");
const { createCanonicalRequest } = require("../lib/conversation-engine-v2/canonical-request");
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

function createC08(values) {
  const result = createCanonicalizerInputItem({
    unit: values.unit,
    lifecycleDecision: values.lifecycle,
    routingDecision: values.route,
    understandingTurnInput: values.input,
    canonicalizerCatalog: catalog,
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
assert.equal(canonicalBundle.value.canonicalRequest.lodgingProduct.bundleId, "bundle-a");

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
for (const [capability, subject, expectedCapability] of [
  ["property_fact", { kind: "amenity", catalogIdentity: "parking" }, "parking"],
  ["amenity", { kind: "amenity", catalogIdentity: "breakfast" }, "amenity"],
  ["policy", { kind: "policy", catalogIdentity: "pet-policy" }, "policy"],
  ["location", { kind: "external_place", catalogIdentity: null }, "location"]
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
assert.deepEqual([...canonicalMatched.value.canonicalRequest.canonicalEntity.canonicalSet].sort(), ["room-a", "room-b"]);

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

// AC-CAN-012 / AC-MNT-009: candidateIndex is generated only in the legacy
// call scope. It owns task/relation compatibility there and is absent from C08
// plus the returned canonical result and authoritative CanonicalRequest.
const originalCanonicalize = canonicalizer.canonicalizeExecutionItem;
let capturedCompatibilityInput = null;
canonicalizer.canonicalizeExecutionItem = (args) => {
  capturedCompatibilityInput = args;
  return originalCanonicalize(args);
};
try {
  const capturedResult = execute(roomC08.value);
  assert.equal(capturedResult.ok, true, capturedResult.code);
  assert.equal(Number.isInteger(capturedCompatibilityInput.item.candidateIndex), true);
  assert.equal(capturedCompatibilityInput.item.task.candidateIndex, capturedCompatibilityInput.item.candidateIndex);
  assert.equal(capturedCompatibilityInput.relation.candidateIndex, capturedCompatibilityInput.item.candidateIndex);
  assert.equal(hasKey(roomC08.value, "candidateIndex"), false);
  assert.equal(hasKey(capturedResult.value, "candidateIndex"), false);
} finally {
  canonicalizer.canonicalizeExecutionItem = originalCanonicalize;
}

// Existing canonicalizer rejection is a terminal C08 failure. The adapter
// neither retries nor mutates/reclassifies C03/C06/C07/C08 in response.
const immutableBeforeRejection = clone(roomC08.value);
let rejectionCalls = 0;
canonicalizer.canonicalizeExecutionItem = () => {
  rejectionCalls += 1;
  const error = new TypeError("fixture canonical rejection");
  error.code = "invalid_canonical_request";
  throw error;
};
try {
  assertFailure(execute(roomC08.value), "invalid_canonical_request");
  assert.equal(rejectionCalls, 1);
  assert.deepEqual(roomC08.value, immutableBeforeRejection);
  assert.equal(roomC08.value.capabilityCandidate, "availability");
  assert.deepEqual(roomC08.value.subjectCandidate, { kind: "room", catalogIdentity: "room-a" });
} finally {
  canonicalizer.canonicalizeExecutionItem = originalCanonicalize;
}

// A canonical request remains branded when a wrong capability/resolver pair
// is substituted under the same unitId and evidence. C08 must still reject
// that ownership mismatch instead of accepting branding alone.
canonicalizer.canonicalizeExecutionItem = (args) => originalCanonicalize({
  ...args,
  item: {
    ...args.item,
    task: {
      ...args.item.task,
      type: "property_fact",
      dependsOnStayContext: false,
      entity: { category: "amenity", rawText: "", canonicalCandidate: "parking", confidence: 1 },
      stayCandidate: null
    }
  }
});
try {
  assertFailure(execute(roomC08.value), "CANONICAL_INPUT_INCOMPLETE");
  assert.equal(roomC08.value.capabilityCandidate, "availability");
  assert.deepEqual(roomC08.value.subjectCandidate, { kind: "room", catalogIdentity: "room-a" });
} finally {
  canonicalizer.canonicalizeExecutionItem = originalCanonicalize;
}

// Review-fix adversarial matrix: the matched set returned by the legacy
// resolver may contain only room identities in the exact trusted C01 catalog.
// A same-property catalog containing a foreign room is not substitute authority.
canonicalizer.canonicalizeExecutionItem = (args) => {
  const roomA = args.catalog.rooms.find((room) => room.canonicalId === "room-a");
  return originalCanonicalize({
    ...args,
    catalog: {
      ...args.catalog,
      rooms: [
        roomA,
        { ...roomA, canonicalId: "foreign-room", publicName: "Foreign Room" }
      ]
    }
  });
};
try {
  assertFailure(execute(matchedC08.value), "CANONICAL_INPUT_INCOMPLETE");
} finally {
  canonicalizer.canonicalizeExecutionItem = originalCanonicalize;
}

// Every semantic field returned by the compatibility call must be derivable
// from the exact C08/C01/context authority. These mutations exercise the real
// canonicalizer and alter one boundary value at a time.
const adversarialResultMutations = [
  {
    name: "guestMessage",
    c08: roomC08.value,
    mutate(args) {
      return originalCanonicalize({
        ...args,
        guestMessage: "substituted guest message without the owned temporal span"
      });
    }
  },
  {
    name: "canonical dates",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      const substituted = originalCanonicalize({
        ...args,
        guestMessage: "Room A 2030/01/02-01/04 還有房嗎？",
        item: {
          ...args.item,
          task: {
            ...args.item.task,
            sourceText: "Room A 2030/01/02-01/04 還有房嗎？",
            stayCandidate: {
              ...args.item.task.stayCandidate,
              dateExpression: { rawText: "2030/01/02-01/04", kind: "range", anchor: "message_time" },
              checkInCandidate: "2030-01-02",
              checkOutCandidate: "2030-01-04",
              nightsCandidate: 2
            }
          }
        }
      });
      return {
        ...result,
        canonicalRequest: substituted.canonicalRequest,
        stateInput: {
          ...result.stateInput,
          temporalResult: substituted.canonicalRequest.temporalState
        }
      };
    }
  },
  {
    name: "lodging product",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      const substituted = originalCanonicalize({
        ...args,
        item: {
          ...args.item,
          transition: {
            ...args.item.transition,
            approvedProduct: { productType: "bundle", productId: "bundle-a", roomTypeId: null, bundleId: "bundle-a" }
          }
        }
      });
      return { ...result, canonicalRequest: substituted.canonicalRequest };
    }
  },
  {
    name: "guests",
    c08: continuedC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      return {
        ...result,
        stateInput: {
          ...result.stateInput,
          confirmedFields: { ...result.stateInput.confirmedFields, guests: 9 }
        }
      };
    }
  },
  {
    name: "nights",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      return {
        ...result,
        stateInput: {
          ...result.stateInput,
          confirmedFields: { ...result.stateInput.confirmedFields, nights: 3 }
        }
      };
    }
  },
  {
    name: "inventory",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      return {
        ...result,
        stateInput: {
          ...result.stateInput,
          confirmedFields: {
            ...result.stateInput.confirmedFields,
            inventory: { mode: "room_only", entityId: "foreign-room" }
          }
        }
      };
    }
  },
  {
    name: "state evidence",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      return {
        ...result,
        stateInput: {
          ...result.stateInput,
          sourceEvidenceRefs: [{ eventId: "foreign", messageRef: "foreign", startOffset: 0, endOffset: 1, quote: "x" }]
        }
      };
    }
  },
  {
    name: "facts",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      return { ...result, facts: [{ canonicalId: "parking", answer: "invented" }] };
    }
  },
  {
    name: "extra state semantics",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      return { ...result, stateInput: { ...result.stateInput, inferredCapability: "parking" } };
    }
  },
  {
    name: "recursive candidateIndex",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      return { ...result, stateInput: { ...result.stateInput, nested: { candidateIndex: 77 } } };
    }
  },
  {
    name: "canonical temporal candidateIndex",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      const temporalState = clone(result.canonicalRequest.temporalState);
      temporalState.fields.checkIn.candidateIndex = 77;
      const canonicalRequest = createCanonicalRequest({ ...result.canonicalRequest, temporalState });
      return {
        ...result,
        canonicalRequest,
        stateInput: { ...result.stateInput, temporalResult: canonicalRequest.temporalState }
      };
    }
  },
  {
    name: "canonical temporal facts",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      const temporalState = clone(result.canonicalRequest.temporalState);
      temporalState.fields.checkIn.facts = [{ invented: true }];
      const canonicalRequest = createCanonicalRequest({ ...result.canonicalRequest, temporalState });
      return {
        ...result,
        canonicalRequest,
        stateInput: { ...result.stateInput, temporalResult: canonicalRequest.temporalState }
      };
    }
  },
  {
    name: "canonical temporal expression semantics",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      const temporalState = clone(result.canonicalRequest.temporalState);
      temporalState.expressionType = "invented_semantics";
      const canonicalRequest = createCanonicalRequest({ ...result.canonicalRequest, temporalState });
      return {
        ...result,
        canonicalRequest,
        stateInput: { ...result.stateInput, temporalResult: canonicalRequest.temporalState }
      };
    }
  },
  {
    name: "canonical temporal rule semantics",
    c08: roomC08.value,
    mutate(args) {
      const result = originalCanonicalize(args);
      const temporalState = clone(result.canonicalRequest.temporalState);
      temporalState.ruleRefs.checkIn = "facts:invented";
      temporalState.fields.checkIn.ruleRef = "facts:invented";
      const canonicalRequest = createCanonicalRequest({ ...result.canonicalRequest, temporalState });
      return {
        ...result,
        canonicalRequest,
        stateInput: { ...result.stateInput, temporalResult: canonicalRequest.temporalState }
      };
    }
  }
];
for (const adversarial of adversarialResultMutations) {
  canonicalizer.canonicalizeExecutionItem = adversarial.mutate;
  try {
    assertFailure(execute(adversarial.c08), "CANONICAL_INPUT_INCOMPLETE");
  } finally {
    canonicalizer.canonicalizeExecutionItem = originalCanonicalize;
  }
}

// Only rejection codes already owned by the canonicalizer contract survive.
// Invented and cross-contract codes collapse to the C08 fail-closed code.
for (const code of ["invented_semantic_repair", "PROPERTY_SCOPE_INVALID", "TURN_INPUT_INVALID"]) {
  canonicalizer.canonicalizeExecutionItem = () => {
    const error = new TypeError("adversarial rejection code");
    error.code = code;
    throw error;
  };
  try {
    assertFailure(execute(roomC08.value), "CANONICAL_INPUT_INCOMPLETE");
  } finally {
    canonicalizer.canonicalizeExecutionItem = originalCanonicalize;
  }
}

for (const code of ["invalid_lodging_product", "canonical_request_required"]) {
  canonicalizer.canonicalizeExecutionItem = () => {
    const error = new TypeError("owned canonical rejection code");
    error.code = code;
    throw error;
  };
  try {
    assertFailure(execute(roomC08.value), code);
  } finally {
    canonicalizer.canonicalizeExecutionItem = originalCanonicalize;
  }
}

console.log(JSON.stringify({ suite: "new-core-canonical-adapter", caseCount: 34, passCount: 34, failCount: 0, evidenceLevel: "STRUCTURED_CONTRACT_TEST" }));
