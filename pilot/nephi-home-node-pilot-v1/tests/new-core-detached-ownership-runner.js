"use strict";

const assert = require("node:assert/strict");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const {
  buildPublicCatalogIdentitySet,
  projectCapabilityRegistry,
  validateSemanticUnit
} = require("../lib/new-core/semantic-unit-validator");
const {
  capabilityPolicyFor
} = require("../lib/new-core/capability-subject-policy");

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
    safetyCandidate: null,
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

const {test}=require('node:test');
const {validateSemanticUnitCandidate}=require('../lib/new-core/contracts/semantic-unit-candidate');
function member(id,ref){return {slotCandidateId:id,slot:'transport',operation:'SET',value:id,evidenceRefs:[ref]};}
test('C03 preserves repeated evidence object across independent fields',()=>{
 const ref=evidence();const input=unit({evidenceRefs:[ref],slotCandidates:[member('one',ref)]});
 const out=validate(input);assert.equal(out.ok,true);assert.deepEqual(out.value,input);
 assert.equal(validateSemanticUnitCandidate(out.value).ok,true);
 assert.notEqual(out.value.evidenceRefs[0],ref);assert.equal(Object.isFrozen(ref),false);
 ref.quote='caller mutation';assert.equal(out.value.slotCandidates[0].evidenceRefs[0].quote,'10/9住一晚');
});
test('C03 preserves repeated object within an evidence array',()=>{
 const ref=evidence();const input=unit({evidenceRefs:[ref,ref]});const out=validate(input);
 assert.equal(out.ok,true);assert.deepEqual(out.value,input);
});
test('C03 preserves shared nested evidence between sibling semantic items',()=>{
 const ref=evidence();const input=unit({slotCandidates:[member('one',ref),member('two',ref)]});
 const out=validate(input);assert.equal(out.ok,true);assert.deepEqual(out.value,input);
});
test('C03 preserves repeated array and independent quantity value',()=>{
 const refs=[evidence()];const input=unit({evidenceRefs:refs,quantityCandidate:{requestedQuantity:2,distinctRequirement:'distinct_entities',evidenceRefs:refs}});
 const out=validate(input);assert.equal(out.ok,true);assert.deepEqual(out.value,input);assert.equal(Object.isFrozen(refs),false);
});
test('C03 ledger retains every value-based owner without acquiring input ownership',()=>{
 const input=unit();const out=validate(input);assert.equal(out.ok,true);
 for(const obligation of out.fieldValidationState){assert.deepEqual(obligation.owner,{propertyScope:c01.propertyScope,turnId:c01.turnId,unitId:input.unitId});assert.equal(Object.isFrozen(obligation.owner),true);assert.notEqual(obligation.owner.propertyScope,c01.propertyScope);}
});
test('rejected position ledger retains scope and evidence through detach',()=>{
 const ref=evidence();const input=unit({slotCandidates:[member('one',ref),{...member('two',ref),value:'one'}]});
 const out=validate(input);assert.equal(out.ok,false);
 const repair=out.fieldValidationState.find(x=>x.obligationKind==='positionRepair');assert.ok(repair);
 assert.deepEqual(repair.evidenceRefs,[evidence(),evidence()]);
 assert.deepEqual(repair.owner,{propertyScope:c01.propertyScope,turnId:c01.turnId,unitId:input.unitId});
});
test('circular data cannot acquire semantic admission',()=>{
 const input=unit();input.subject.catalogIdentity=input.subject;
 assert.equal(validate(input).ok,false);
});
