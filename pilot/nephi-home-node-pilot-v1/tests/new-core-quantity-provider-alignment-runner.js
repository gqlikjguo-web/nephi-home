"use strict";

// FAKE_INTEGRATION / STRUCTURED_CONTRACT_TEST. No real OpenAI or facts calls.
// This RED observes existing admission; it does not interpret source language.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const { validateAndNormalizeSourceEvidence } = require("../lib/new-core/source-evidence-validator");
const { validateSemanticUnit, buildPublicCatalogIdentitySet, projectCapabilityRegistry } = require("../lib/new-core/semantic-unit-validator");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const { callOpenAIUnderstandingV1, openAiUnderstandingV1ProviderSchema, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC: META } = require("../lib/providers/openai-understanding-v1");

// Structural schema checks only; no source-text matching or intent rules.
function schemaAccepts(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(item => schemaAccepts(item, value));
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const type = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  if (types.length && !types.includes(type)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (type === "string" && (value.length < (schema.minLength || 0) || value.length > (schema.maxLength || Infinity))) return false;
  if (type === "integer" && schema.minimum !== undefined && value < schema.minimum) return false;
  if (type === "array") return value.length >= (schema.minItems || 0) && value.length <= (schema.maxItems || Infinity) && value.every(item => schemaAccepts(schema.items, item));
  if (type === "object") {
    const properties = schema.properties || {};
    return !(schema.required || []).some(key => !Object.hasOwn(value, key))
      && !(schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key)))
      && Object.entries(properties).every(([key, child]) => !Object.hasOwn(value, key) || schemaAccepts(child, value[key]));
  }
  return true;
}


const test=require('node:test');
function fixture(){
  const propertyId = randomUUID(), now = "2026-09-07T06:00:00.000Z";
  const source = "source evidence";
  const evidence = { eventId: "event", messageRef: "message", startOffset: 0, endOffset: source.length, quote: source };
  const catalog = ["property", "room", "bundle", "matched_room_set", "amenity", "policy", "other_verified"].map(kind => ({
    propertyId, kind, catalogIdentity: randomUUID(), publicName: kind
  }));
  const input = buildUnderstandingTurnInput({
    coreVersion: "new-core-v1", traceId: "diagnostics-red", turnId: "turn",
    verifiedPropertyBinding: { propertyId, channel: "isolated" },
    verifiedConversationScope: { channel: "isolated", userId: "guest" },
    sourceEvents: [{ eventId: "event", messageRef: "message", role: "guest", timestamp: now, messageKind: "text", messageText: source }],
    recentConversation: [], stateV3Snapshot: { scope: { propertyId, channel: "isolated", userId: "guest" }, referenceableCycles: [] },
    publicCatalog: { propertyId, timezone: "Asia/Taipei", capabilityCatalog: ["booking_request"], publicSubjectCatalog: catalog }
  });
  const candidate = {
    unitId: "unit", evidenceRefs: [evidence], purpose: "operator_request", capability: "booking_operator_request",
    subject: { kind: "room", catalogIdentity: catalog.find(item => item.kind === "room").catalogIdentity },
    stayDependent: false, temporalCandidate: null, contextLinkCandidateId: "link",
    safetyCandidate: { operatorActionClass: "special_arrangement", riskClass: null },
    slotCandidates: [], confidenceBand: "high"
  };
  const normalized = validateAndNormalizeSourceEvidence([evidence], input.sourceEvents);
  assert.equal(normalized.ok, true, "fixture evidence must pass C04");
  const identitySet = buildPublicCatalogIdentitySet(input);
  const validate = unit => validateSemanticUnit({ unit, validatedEvidenceRefs: normalized.value, understandingTurnInput: input,
    publicCatalogIdentitySet: identitySet, capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY) });
  assert.equal(validate(candidate).ok, true, "control without the slot must be legal");

  const schema=openAiUnderstandingV1ProviderSchema(input).properties.understandingOutput.properties.units.items;
  const quantityCandidate={requestedQuantity:2,distinctRequirement:'distinct_entities',evidenceRefs:[evidence]};
  const legal={...candidate,quantityCandidate,slotCandidates:[{slotCandidateId:'guests',slot:'guest_count',operation:'SET',value:4,evidenceRefs:[evidence]}]};
  return {input,schema,legal,validate,catalog,evidence};
}
test('R1 quantity rejects non-product subject in provider schema',()=>{const f=fixture();const u={...f.legal,subject:{kind:'other_verified',catalogIdentity:null}};assert.equal(f.validate(u).code,'CAPABILITY_SUBJECT_CONFLICT');assert.equal(schemaAccepts(f.schema,u),false);});
test('R1 diagnostics describe quantity subject rule',()=>{const f=fixture();const r=f.validate({...f.legal,subject:{kind:'other_verified',catalogIdentity:null}});assert.deepEqual(r.diagnostics,{field:'subject.kind',rule:'quantitySubjectAdmission',actualKind:'other_verified',allowedKinds:['room','bundle','matched_room_set']});});
test('R2 product public name rejected and formal identity accepted',()=>{const f=fixture(),item=f.catalog.find(x=>x.kind==='matched_room_set');const u={...f.legal,slotCandidates:[{slotCandidateId:'product',slot:'product',operation:'SET',value:item.publicName,evidenceRefs:[f.evidence]}]};assert.equal(f.validate(u).code,'UNIT_MEANING_UNSUPPORTED');assert.equal(schemaAccepts(f.schema,u),false);u.slotCandidates[0].value=item.catalogIdentity;assert.equal(schemaAccepts(f.schema,u),true);assert.equal(f.validate(u).ok,true);});
test('R3 people and quantity remain independent; R4 distinct semantics accepted',()=>{const f=fixture();assert.equal(schemaAccepts(f.schema,f.legal),true);const r=f.validate(f.legal);assert.equal(r.ok,true);assert.equal(r.value.slotCandidates[0].value,4);assert.equal(r.value.quantityCandidate.requestedQuantity,2);assert.equal(r.value.quantityCandidate.distinctRequirement,'distinct_entities');});
for(const kind of ['room','bundle','matched_room_set'])test('R5 legal quantity '+kind,()=>{const f=fixture();const item=f.catalog.find(x=>x.kind===kind);const u={...f.legal,purpose:'lodging_question',capability:'capacity',stayDependent:true,safetyCandidate:null,subject:{kind,catalogIdentity:item.catalogIdentity}};assert.equal(schemaAccepts(f.schema,u),true);assert.equal(f.validate(u).ok,true);});
test('product CLEAR preserves existing admission',()=>{const f=fixture();const u={...f.legal,slotCandidates:[{slotCandidateId:'clear',slot:'product',operation:'CLEAR',value:null,evidenceRefs:[f.evidence]}]};assert.equal(schemaAccepts(f.schema,u),true);assert.equal(f.validate(u).ok,true);});
