"use strict";
// STRUCTURED_CONTRACT_TEST. No language classification or provider double is
// treated as a REAL Understanding result.
const {test}=require("node:test"),assert=require("node:assert/strict");
const {buildUnderstandingTurnInput}=require("../lib/new-core/turn-input-adapter");
const {openAiUnderstandingV1ProviderSchema}=require("../lib/providers/openai-understanding-v1");
const {CAPABILITY_REGISTRY}=require("../lib/conversation-engine-v2/capability-registry");
const {RISK_CLASSES}=require("../lib/new-core/contracts/unit-routing-decision");
const {validateAndNormalizeSourceEvidence}=require("../lib/new-core/source-evidence-validator");
const {validateSemanticUnit,buildPublicCatalogIdentitySet,projectCapabilityRegistry}=require("../lib/new-core/semantic-unit-validator");
function accepts(s,v){
 if(s.anyOf)return s.anyOf.some(b=>accepts(b,v));
 const type=v===null?"null":Array.isArray(v)?"array":Number.isInteger(v)?"integer":typeof v;
 if(s.type&&!(Array.isArray(s.type)?s.type:[s.type]).includes(type))return false;
 if(s.enum&&!s.enum.includes(v))return false;
 if(type==="object")return (s.required||[]).every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>s.additionalProperties!==false||Object.hasOwn(s.properties,k))&&Object.entries(v).every(([k,x])=>!s.properties[k]||accepts(s.properties[k],x));
 if(type==="array")return v.length<=(s.maxItems??Infinity)&&v.every(x=>accepts(s.items,x));
 return true;
}
const text="Please handle protected operational information.",now="2026-09-14T04:30:00.000Z";
const ref={eventId:"event",messageRef:"event",startOffset:0,endOffset:text.length,quote:text};
const input=buildUnderstandingTurnInput({coreVersion:"new-core-v1",traceId:"trace",turnId:"turn",verifiedPropertyBinding:{propertyId:"p",channel:"line"},verifiedConversationScope:{channel:"line",userId:"actor"},sourceEvents:[{eventId:"event",messageRef:"event",role:"guest",timestamp:now,messageKind:"text",messageText:text}],recentConversation:[],stateV3Snapshot:{scope:{propertyId:"p",channel:"line",userId:"actor"},referenceableCycles:[]},publicCatalog:{propertyId:"p",timezone:"Asia/Taipei",capabilityCatalog:Object.keys(CAPABILITY_REGISTRY),publicSubjectCatalog:[]}});
const schema=openAiUnderstandingV1ProviderSchema(input).properties.understandingOutput.properties.units.items;
const unit={unitId:"unit",contextLinkCandidateId:"link",evidenceRefs:[ref],purpose:"sensitive_request",capability:"high_risk",subject:{kind:"other_verified",catalogIdentity:null},stayDependent:false,temporalCandidate:null,safetyCandidate:null,slotCandidates:[],quantityCandidate:null,confidenceBand:"high"};
for(const riskClass of RISK_CLASSES)test(`risk ${riskClass} remains admissible without a synthetic catalog identity`,()=>{
 const supported={...unit,safetyCandidate:{operatorActionClass:null,riskClass}};
 assert.equal(accepts(schema,supported),true);
 const validated=validateAndNormalizeSourceEvidence([ref],input.sourceEvents);
 assert.equal(validateSemanticUnit({unit:supported,validatedEvidenceRefs:validated.value,understandingTurnInput:input,publicCatalogIdentitySet:buildPublicCatalogIdentitySet(input),capabilityRegistryProjection:projectCapabilityRegistry(CAPABILITY_REGISTRY)}).ok,true);

});
test("unsupported without invented policy remains representable and rejected by C03",()=>{
 const u={...unit,purpose:"unknown",capability:"unsupported",safetyCandidate:null};
 assert.equal(accepts(schema,u),true);
 const v=validateSemanticUnit({unit:u,validatedEvidenceRefs:validateAndNormalizeSourceEvidence([ref],input.sourceEvents).value,understandingTurnInput:input,publicCatalogIdentitySet:buildPublicCatalogIdentitySet(input),capabilityRegistryProjection:projectCapabilityRegistry(CAPABILITY_REGISTRY)});
 assert.equal(v.code,"UNIT_MEANING_UNSUPPORTED");
});

for(const riskClass of RISK_CLASSES)test(`formal ${riskClass} responsibility reaches the single handoff authority`,async()=>{
 const {answer}=require("./custom-arrival-departure-text-runner");
 const property={propertyId:"risk-scope",displayName:"Lodge",rooms:[],commonAnswers:{},propertyFacts:[]};
 const r=await answer(property,null,{capability:"high_risk",kind:"other_verified",purpose:"sensitive_request",safetyCandidate:{operatorActionClass:null,riskClass}});
 assert.equal(r.earliestFailure,null);assert.equal(r.finalDecision.action,"handoff");
 assert.equal(r.finalDecision.reviewRequired,true);assert.equal(r.finalResponse.replyText,"請稍後，將盡快回覆您。");
 assert.ok(r.artifacts.requestEvidence.some(e=>e.humanJudgmentRequired));
 assert.equal(r.artifacts.canonicalItems.length,0,"human responsibility does not invent a facts request");
});
