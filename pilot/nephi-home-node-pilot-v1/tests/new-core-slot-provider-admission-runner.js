"use strict";
// STRUCTURED_CONTRACT_TEST: schema vs actual C03; no natural-language resolver,
// no real model/facts call. IDs are varied, never implementation conditions.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const {buildUnderstandingTurnInput}=require("../lib/new-core/turn-input-adapter");
const {validateAndNormalizeSourceEvidence}=require("../lib/new-core/source-evidence-validator");
const {validateSemanticUnit,buildPublicCatalogIdentitySet,projectCapabilityRegistry}=require("../lib/new-core/semantic-unit-validator");
const {CAPABILITY_REGISTRY}=require("../lib/conversation-engine-v2/capability-registry");
const {catalogIdentityRuleFor}=require("../lib/new-core/capability-subject-policy");
const {openAiUnderstandingV1ProviderSchema}=require("../lib/providers/openai-understanding-v1");
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



function fixture() {
 const propertyId=randomUUID(),now="2026-09-12T00:00:00.000Z",text="An independently meaningful requirement";
 const evidence={eventId:"event",messageRef:"message",startOffset:0,endOffset:text.length,quote:text};
 const subjects=["property","room","bundle","matched_room_set","amenity","policy","other_verified"].map(kind=>({propertyId,kind,catalogIdentity:randomUUID(),publicName:kind}));
 const input=buildUnderstandingTurnInput({coreVersion:"new-core-v1",traceId:"trace",turnId:"turn",verifiedPropertyBinding:{propertyId,channel:"isolated"},verifiedConversationScope:{channel:"isolated",userId:"guest"},sourceEvents:[{eventId:"event",messageRef:"message",role:"guest",timestamp:now,messageKind:"text",messageText:text}],recentConversation:[],stateV3Snapshot:{scope:{propertyId,channel:"isolated",userId:"guest"},referenceableCycles:[]},publicCatalog:{propertyId,timezone:"Asia/Taipei",capabilityCatalog:Object.keys(CAPABILITY_REGISTRY),publicSubjectCatalog:subjects}});
 const refs=validateAndNormalizeSourceEvidence([evidence],input.sourceEvents);assert.equal(refs.ok,true);
 const projection=projectCapabilityRegistry(CAPABILITY_REGISTRY),identities=buildPublicCatalogIdentitySet(input);
 const schema=openAiUnderstandingV1ProviderSchema(input).properties.understandingOutput.properties.units.items;
 const validate=unit=>validateSemanticUnit({unit,validatedEvidenceRefs:refs.value,understandingTurnInput:input,publicCatalogIdentitySet:identities,capabilityRegistryProjection:projection});
 function unit(capability){const p=projection[capability],kind=p.subjectKinds[0],rule=catalogIdentityRuleFor(projection,capability,kind);return {unitId:"unit",evidenceRefs:[evidence],purpose:p.safetyPurposes[0],capability:capability==="null"?null:capability,subject:{kind,catalogIdentity:rule==="NULL"?null:subjects.find(s=>s.kind===kind).catalogIdentity},stayDependent:p.stayDependent,temporalCandidate:null,contextLinkCandidateId:"link",safetyCandidate:p.safetyShape==="operator_action"?{operatorActionClass:"special_arrangement",riskClass:null}:p.safetyShape==="risk"?{operatorActionClass:null,riskClass:"sensitive_request"}:null,slotCandidates:[],quantityCandidate:null,confidenceBand:"high"};}
 const slot=(name,operation,value)=>({slotCandidateId:randomUUID(),slot:name,operation,value,evidenceRefs:[evidence]});
 return {subjects,schema,validate,unit,slot,projection};
}
for(const capability of Object.keys(projectCapabilityRegistry(CAPABILITY_REGISTRY))) {
 test("schema and C03 share other-supported SET admission: "+capability,()=>{
  const f=fixture(),base=f.unit(capability);assert.equal(f.validate(base).ok,true,"baseline unit");assert.equal(schemaAccepts(f.schema,base),true);
  for(const value of [...f.subjects.map(s=>s.catalogIdentity),"unregistered requirement",7,true,null]) {
   const u={...base,slotCandidates:[f.slot("other_supported","SET",value)]};
   assert.equal(schemaAccepts(f.schema,u),f.validate(u).ok,"schema/C03 disagreement for "+capability+" value kind "+typeof value);
  }
 });
 test("existing CLEAR and transport survive: "+capability,()=>{
  const f=fixture(),base=f.unit(capability);
  for(const s of [f.slot("other_supported","CLEAR",null),f.slot("transport","SET","rail")]) {
   const u={...base,slotCandidates:[s]};assert.equal(f.validate(u).ok,true);assert.equal(schemaAccepts(f.schema,u),true);
  }
 });
}
