"use strict";

const assert = require("node:assert/strict");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
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

const publicCatalogIdentitySet = buildPublicCatalogIdentitySet([
  { catalogIdentity: "property-a", kind: "property", publicName: "Property A" },
  { catalogIdentity: "room-a", kind: "room", publicName: "Room A" },
  { catalogIdentity: "bundle-a", kind: "bundle", publicName: "Bundle A" },
  { catalogIdentity: "matched-a", kind: "matched_room_set", publicName: "Matched rooms" },
  { catalogIdentity: "breakfast", kind: "amenity", publicName: "Breakfast" },
  { catalogIdentity: "pet-policy", kind: "policy", publicName: "Pet policy" },
  { catalogIdentity: "verified-service", kind: "other_verified", publicName: "Verified service" }
]);
const capabilityRegistryProjection = projectCapabilityRegistry(CAPABILITY_REGISTRY);

function validate(candidate, overrides = {}) {
  return validateSemanticUnit({
    unit: candidate,
    validatedEvidenceRefs: [evidence()],
    publicCatalogIdentitySet,
    capabilityRegistryProjection,
    ...overrides
  });
}

function assertFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
}

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
assertFailure(validate(unit({ capability: "amenity", subject: { kind: "bundle", catalogIdentity: "bundle-a" }, stayDependent: false })), "CAPABILITY_SUBJECT_CONFLICT");
assertFailure(validate(unit({ stayDependent: false })), "STAY_DEPENDENCY_CONFLICT");
assertFailure(validate(unit({ capability: "property_fact", subject: { kind: "bundle", catalogIdentity: "bundle-a" }, stayDependent: false })), "CAPABILITY_SUBJECT_CONFLICT");

// AC-SEM-011..015: unsupported tuples do not receive a replacement
// capability. `other_supported` requires a registry-admitted verified subject.
assertFailure(validate(unit({ capability: "unsupported", subject: { kind: "other_verified", catalogIdentity: "verified-service" }, stayDependent: false })), "UNIT_MEANING_UNSUPPORTED");
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
  caseCount: 31,
  status: "PASS"
}));
