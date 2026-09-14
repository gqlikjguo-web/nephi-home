"use strict";
// FAKE_INTEGRATION: source-grounded queued attempts; unchanged C03/C05 and
// correction preservation decide adoption. No manufactured Context target.
const {test}=require("node:test"),assert=require("node:assert/strict");
const {buildUnderstandingTurnInput}=require("../lib/new-core/turn-input-adapter");
const {callOpenAIUnderstandingV1,OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC:META}=require("../lib/providers/openai-understanding-v1");
const {CAPABILITY_REGISTRY}=require("../lib/conversation-engine-v2/capability-registry");
const NOW="2026-09-14T04:30:00.000Z",text="Please quote two separate rooms and state the departure policy.";
const ref={eventId:"event",messageRef:"event",startOffset:0,endOffset:text.length,quote:text};
const scope={propertyId:"p",channel:"line",userId:"actor"};
const input=buildUnderstandingTurnInput({coreVersion:"new-core-v1",traceId:"trace",turnId:"turn",verifiedPropertyBinding:{propertyId:"p",channel:"line"},verifiedConversationScope:{channel:"line",userId:"actor"},sourceEvents:[{eventId:"event",messageRef:"event",role:"guest",timestamp:NOW,messageKind:"text",messageText:text}],recentConversation:[{eventId:"history",messageRef:"history",role:"assistant",timestamp:"2026-09-14T04:20:00.000Z",messageKind:"text",messageText:"An earlier discussion without a formal request.",referenceableCycleIds:[]}],stateV3Snapshot:{scope,referenceableCycles:[]},publicCatalog:{propertyId:"p",timezone:"Asia/Taipei",capabilityCatalog:Object.keys(CAPABILITY_REGISTRY),publicSubjectCatalog:[{propertyId:"p",kind:"room",catalogIdentity:"product",publicName:"Product"},{propertyId:"p",kind:"policy",catalogIdentity:"departure",publicName:"Departure policy"}]}});
async function run(removeQuantity=false){
 let calls=0;
 const base={evidenceRefs:[ref],purpose:"lodging_question",temporalCandidate:null,safetyCandidate:null,slotCandidates:[],quantityCandidate:null,confidenceBand:"high"};
 const units=[{...base,unitId:"price",contextLinkCandidateId:"price-link",capability:"price",subject:{kind:"room",catalogIdentity:"product"},stayDependent:true,quantityCandidate:{requestedQuantity:2,distinctRequirement:"distinct_entities",evidenceRefs:[ref]}},{...base,unitId:"policy",contextLinkCandidateId:"policy-link",capability:"policy",subject:{kind:"policy",catalogIdentity:"departure"},stayDependent:false}];
 const r=await callOpenAIUnderstandingV1(input,{apiKey:"isolated-model-double",nowMs:()=>Date.parse(NOW),fetchImpl:async()=>{
  calls++;const output={understandingOutput:{schemaVersion:1,turnId:"turn",units:units.map(u=>calls===2&&removeQuantity&&u.unitId==="price"?{...u,quantityCandidate:null}:u)},contextLinkCandidates:units.map(u=>({unitId:u.unitId,contextLinkCandidateId:u.contextLinkCandidateId,relationKind:calls===1&&u.unitId==="price"?"SUPPLEMENT":"NEW_REQUEST",currentSourceEvidenceRefs:[ref],referencedHistoryEventRefs:calls===1&&u.unitId==="price"?[{eventId:"history",messageRef:"history"}]:[]}))};
  return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({model:"gpt-5.6-luna",status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(output)}]}]})};
 }});return {r,calls};
}
test("unbound cited history is corrected once without fabricating a cycle",async()=>{
 const {r,calls}=await run();assert.equal(calls,2);assert.equal(r.failedUnits.length,0);
 assert.equal(r.validatedUnits.length,2);assert.equal(r.validatedUnits.find(u=>u.unitId==="price").quantityCandidate.requestedQuantity,2);
 assert.ok(r.validatedContextLinks.every(l=>l.relationKind==="NEW_REQUEST"&&l.referencedHistoryEventRefs.length===0));
 assert.equal(r[META].finalAcceptedAttempt,2);
});
test("repairing a relation never permits deleting trusted quantity or sibling",async()=>{
 const {r,calls}=await run(true);assert.equal(calls,2);
 assert.equal(r[META].attempts[1].validationResult.adoptionFailure,"CORRECTION_FIELD_NOT_PRESERVED");
 assert.ok(r.validatedUnits.some(u=>u.unitId==="policy"));assert.ok(r.failedUnits.length>0);
});
