"use strict";

const assert = require("node:assert/strict");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const {
  buildPublicCatalogIdentitySet,
  projectCapabilityRegistry,
  validateSemanticUnit
} = require("../lib/new-core/semantic-unit-validator");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function evidence(overrides = {}) {
  return {
    eventId: "event-semantic",
    messageRef: "message-semantic",
    startOffset: 0,
    endOffset: 4,
    quote: "10/9住一晚",
    ...overrides
  };
}

function unit(overrides = {}) {
  return {
    unitId: "unit-semantic",
    evidenceRefs: [evidence()],
    purpose: "lodging_question",
    capability: "availability",
    subject: { kind: "bundle", catalogIdentity: "bundle-a" },
    stayDependent: true,
    temporalCandidate: null,
    contextLinkCandidateId: "link-semantic",
    replyCandidate: { disposition: "ANSWER", reasonClass: "lodging_need" },
    slotCandidates: [],
    confidenceBand: "high",
    ...overrides
  };
}

function c01Args(overrides = {}) {
  return {
    coreVersion: "new-core-v1",
    traceId: "trace-semantic",
    turnId: "turn-semantic",
    verifiedPropertyBinding: { propertyId: "property-a", channel: "line-a" },
    verifiedConversationScope: { channel: "line-a", userId: "guest-a" },
    sourceEvents: [{ eventId: "event-semantic", messageRef: "message-semantic", role: "guest", timestamp: "2026-08-28T08:00:00.000Z", messageKind: "text", messageText: "10/9住一晚" }],
    recentConversation: [],
    stateV3Snapshot: { scope: { propertyId: "property-a" }, referenceableCycles: [] },
    publicCatalog: {
      propertyId: "property-a",
      timezone: "Asia/Taipei",
      capabilityCatalog: ["availability", "property_fact"],
      publicSubjectCatalog: [
        { catalogIdentity: "property-a", kind: "property", publicName: "Property A", propertyId: "property-a" },
        { catalogIdentity: "room-a", kind: "room", publicName: "Room A", propertyId: "property-a" },
        { catalogIdentity: "bundle-a", kind: "bundle", publicName: "Bundle A", propertyId: "property-a" },
        { catalogIdentity: "matched-a", kind: "matched_room_set", publicName: "Matched rooms", propertyId: "property-a" },
        { catalogIdentity: "breakfast", kind: "amenity", publicName: "Breakfast", propertyId: "property-a" },
        { catalogIdentity: "pet-policy", kind: "policy", publicName: "Pet policy", propertyId: "property-a" },
        { catalogIdentity: "verified-service", kind: "other_verified", publicName: "Verified service", propertyId: "property-a" }
      ]
    },
    ...overrides
  };
}

const c01 = buildUnderstandingTurnInput(c01Args());
const publicCatalogIdentitySet = buildPublicCatalogIdentitySet(c01);
const capabilityRegistryProjection = projectCapabilityRegistry(CAPABILITY_REGISTRY);

function validate(candidate, overrides = {}) {
  return validateSemanticUnit({
    unit: candidate,
    validatedEvidenceRefs: [evidence()],
    understandingTurnInput: c01,
    publicCatalogIdentitySet,
    capabilityRegistryProjection,
    ...overrides
  });
}

function assertFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
}

// AC-ISO-004 / AC-SEM-004: only a module-branded projection derived from
// immutable C01 public catalog data may admit catalog identities. Raw or
// cloned arrays cannot forge a room/bundle, and C01 rejects cross-property
// catalog entries before a projection exists.
assert.equal(Array.isArray(publicCatalogIdentitySet), true);
assert.equal(buildPublicCatalogIdentitySet(c01), publicCatalogIdentitySet);
assert.equal(buildPublicCatalogIdentitySet(c01.publicSubjectCatalog), null);
assert.equal(buildPublicCatalogIdentitySet(clone(c01)), null);
assertFailure(validate(unit(), {
  publicCatalogIdentitySet: Object.freeze([["bundle-a", "bundle"]])
}), "CATALOG_IDENTITY_INVALID");
assert.throws(() => buildUnderstandingTurnInput(c01Args({
  publicCatalog: {
    ...c01Args().publicCatalog,
    publicSubjectCatalog: [{ catalogIdentity: "foreign-bundle", kind: "bundle", publicName: "Foreign bundle", propertyId: "property-b" }]
  }
})), (error) => error && error.code === "PROPERTY_SCOPE_INVALID");
const c01ForOtherProperty = buildUnderstandingTurnInput(c01Args({
  verifiedPropertyBinding: { propertyId: "property-b", channel: "line-b" },
  verifiedConversationScope: { channel: "line-b", userId: "guest-b" },
  stateV3Snapshot: { scope: { propertyId: "property-b" }, referenceableCycles: [] },
  publicCatalog: {
    propertyId: "property-b",
    timezone: "Asia/Taipei",
    capabilityCatalog: ["availability"],
    publicSubjectCatalog: [{ catalogIdentity: "bundle-b", kind: "bundle", publicName: "Bundle B", propertyId: "property-b" }]
  }
}));
const otherPropertyProjection = buildPublicCatalogIdentitySet(c01ForOtherProperty);
assertFailure(validate(unit({ subject: { kind: "bundle", catalogIdentity: "bundle-b" } }), {
  publicCatalogIdentitySet: otherPropertyProjection
}), "CATALOG_IDENTITY_INVALID");

// AC-SEM-001..003 / AC-AVL-001..002: capability, subject, and stay remain
// independent. In particular, a valid bundle availability question stays
// availability and never becomes a property fact.
const availableBundle = unit();
const availableBundleBefore = clone(availableBundle);
const validAvailability = validate(availableBundle);
assert.equal(validAvailability.ok, true);
assert.deepEqual(validAvailability.value, availableBundleBefore);
assert.equal(validAvailability.value.capability, "availability", "availability must never be rewritten to property_fact");
assert.equal(validAvailability.value.subject.kind, "bundle");
assert.equal(validAvailability.value.stayDependent, true);
assert.notEqual(validAvailability.value, availableBundle);
assert.equal(Object.isFrozen(validAvailability.value), true);
assert.deepEqual(availableBundle, availableBundleBefore, "semantic validation never mutates C03");

const genericAvailability = validate(unit({
  subject: { kind: "property", catalogIdentity: null }
}));
assert.equal(genericAvailability.ok, true, genericAvailability.code);
assert.deepEqual(genericAvailability.value.subject, {
  kind: "property",
  catalogIdentity: null
});

// AC-AVL-005 / AC-PRI-001..005 / AC-RDY-001..010: inventory families retain
// their independently declared subject and required stay dependency.
for (const candidate of [
  unit({ subject: { kind: "room", catalogIdentity: "room-a" } }),
  unit({ subject: { kind: "matched_room_set", catalogIdentity: "matched-a" } }),
  unit({ capability: "available_dates" }),
  unit({ capability: "price" }),
  unit({ capability: "total_price" }),
  unit({ capability: "capacity" })
]) {
  assert.equal(validate(candidate).ok, true);
}

// AC-LOC-001..005: location can name an external place without inventing a
// property catalog identity, while property location remains catalog scoped.
assert.equal(validate(unit({
  capability: "location",
  subject: { kind: "external_place", catalogIdentity: null },
  stayDependent: false
})).ok, true);

// AC-SEM-001 / AC-NRP-001 / AC-CTX-015: C03 permits a non-actionable unit
// with no capability or subject. It must reach later C05/C07 as unchanged
// NO_REPLY/NONE input rather than being invented into an executable request.
assert.equal(validate(unit({
  purpose: "acknowledgement",
  capability: null,
  subject: { kind: null, catalogIdentity: null },
  stayDependent: false,
  replyCandidate: { disposition: "NO_REPLY", reasonClass: "acknowledgement" }
})).ok, true);
assert.equal(validate(unit({
  capability: "location",
  subject: { kind: "property", catalogIdentity: "property-a" },
  stayDependent: false
})).ok, true);

// AC-FCT-001..010 / AC-PRI-001: facts, amenities, policies, price, and
// capacity retain their catalog-supported family rather than sharing aliases.
for (const candidate of [
  unit({ capability: "property_fact", subject: { kind: "property", catalogIdentity: "property-a" }, stayDependent: false }),
  unit({ capability: "property_fact", subject: { kind: "room", catalogIdentity: "room-a" }, stayDependent: false }),
  unit({ capability: "amenity", subject: { kind: "amenity", catalogIdentity: "breakfast" }, stayDependent: false }),
  unit({ capability: "policy", subject: { kind: "policy", catalogIdentity: "pet-policy" }, stayDependent: false })
]) {
  assert.equal(validate(candidate).ok, true);
}

// AC-SEM-004..010 / AC-AVL-009: malformed C03, catalog misses, catalog kind
// conflicts, capability/subject conflicts, and stay conflicts fail closed.
assertFailure(validate(unit({ evidenceRefs: [] })), "SEMANTIC_UNIT_INVALID");
assertFailure(validate(unit({ subject: { kind: "room", catalogIdentity: "invented-room" } })), "CATALOG_IDENTITY_INVALID");
assertFailure(validate(unit({ subject: { kind: "bundle", catalogIdentity: "room-a" } })), "CATALOG_IDENTITY_INVALID");
assertFailure(validate(unit({ subject: { kind: "property", catalogIdentity: "property-a" } })), "CATALOG_IDENTITY_INVALID");
assertFailure(validate(unit({ capability: "amenity", subject: { kind: "bundle", catalogIdentity: "bundle-a" }, stayDependent: false })), "CAPABILITY_SUBJECT_CONFLICT");
assertFailure(validate(unit({ stayDependent: false })), "STAY_DEPENDENCY_CONFLICT");
assertFailure(validate(unit({ capability: "property_fact", subject: { kind: "bundle", catalogIdentity: "bundle-a" }, stayDependent: false })), "CAPABILITY_SUBJECT_CONFLICT");

// AC-SEM-011..015: unsupported tuples do not receive a replacement
// capability. `other_supported` requires a registry-admitted verified subject.
assertFailure(validate(unit({ capability: "unsupported", subject: { kind: "other_verified", catalogIdentity: "verified-service" }, stayDependent: false })), "UNIT_MEANING_UNSUPPORTED");
assertFailure(validate(unit({
  purpose: "social",
  capability: "availability",
  subject: { kind: "room", catalogIdentity: "room-a" },
  stayDependent: true
})), "UNIT_MEANING_UNSUPPORTED");
const forgedRegistryProjection = clone(capabilityRegistryProjection);
forgedRegistryProjection.availability = {
  registryCapabilities: ["availability"],
  subjectKinds: ["property"],
  stayDependent: false,
  allowsOtherSupported: false
};
assertFailure(validate(unit({
  subject: { kind: "property", catalogIdentity: null },
  stayDependent: false
}), { capabilityRegistryProjection: forgedRegistryProjection }), "UNIT_MEANING_UNSUPPORTED");
assertFailure(validate(unit({
  capability: "amenity",
  subject: { kind: "amenity", catalogIdentity: "breakfast" },
  stayDependent: false,
  slotCandidates: [{
    slotCandidateId: "slot-other",
    slot: "other_supported",
    operation: "SET",
    value: "verified-service",
    evidenceRefs: [evidence()]
  }]
})), "UNIT_MEANING_UNSUPPORTED");
assert.equal(validate(unit({
  purpose: "operator_request",
  capability: "booking_operator_request",
  subject: { kind: "other_verified", catalogIdentity: "verified-service" },
  stayDependent: false,
  slotCandidates: [{
    slotCandidateId: "slot-other",
    slot: "other_supported",
    operation: "SET",
    value: "verified-service",
    evidenceRefs: [evidence()]
  }]
})).ok, true);

// AC-SEM-008 / AC-EVD-010: C04 evidence must be owned by this unit or its
// slots. A source-shaped but unvalidated ref cannot be admitted or rewritten.
assertFailure(validate(unit(), { validatedEvidenceRefs: [] }), "UNIT_EVIDENCE_MISSING");
assertFailure(validate(unit({ evidenceRefs: [evidence({ quote: "invented" })] })), "UNIT_EVIDENCE_MISSING");
assertFailure(validate(unit({
  slotCandidates: [{
    slotCandidateId: "slot-product",
    slot: "product",
    operation: "SET",
    value: "bundle-a",
    evidenceRefs: [evidence({ quote: "unvalidated" })]
  }]
})), "UNIT_EVIDENCE_MISSING");

// AC-MUT-001..004 / AC-SEM-010: valid output is detached and frozen, while
// neither C03 nor validated C04 inputs may be changed by semantic validation.
const frozenEvidence = Object.freeze([Object.freeze(evidence())]);
const mutableUnit = unit();
const mutableUnitBefore = clone(mutableUnit);
const mutationSafe = validate(mutableUnit, { validatedEvidenceRefs: frozenEvidence });
assert.equal(mutationSafe.ok, true);
assert.deepEqual(mutableUnit, mutableUnitBefore);
assert.throws(() => { mutationSafe.value.capability = "property_fact"; }, TypeError);
assert.throws(() => { mutationSafe.value.subject.catalogIdentity = "room-a"; }, TypeError);
assert.deepEqual(frozenEvidence, [evidence()]);

console.log(JSON.stringify({
  suite: "new-core-semantic-unit",
  classification: "STRUCTURED_CONTRACT_TEST",
  caseCount: 34,
  status: "PASS"
}));
