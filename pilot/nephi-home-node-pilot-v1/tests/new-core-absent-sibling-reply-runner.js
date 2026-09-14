"use strict";
// FAKE_INTEGRATION: formal core with queued Understanding and formal fixtures.
const {test}=require("node:test"),assert=require("node:assert/strict");
const {run}=require("./new-core-request-responsibility-fixture");
const {publicReplyAction}=require("../lib/conversation-engine-v2/final-decision");
for(const types of [["NO_REPLY","ANSWER"],["ANSWER","NO_REPLY"],["NO_REPLY","HANDOFF"]]) {
 test(`absent meaning does not remove visible responsibility: ${types.join('+')}`,async()=>{
  const {result:r}=await run(types);
  assert.equal(r.earliestFailure,null);assert.equal(r.artifacts.rebuildCount,0);
  assert.equal(r.artifacts.claimValidation.ok,true);assert.equal(r.finalResponse.shouldReply,true);
  for(const [i,type]of types.entries()) {
   const expected={NO_REPLY:"no_reply",ANSWER:"reply",CLARIFY:"clarification",HANDOFF:"handoff"}[type];
   assert.equal(publicReplyAction(r.finalDecision,{propertyId:r.artifacts.responsePlan.propertyId,turnId:"turn",taskId:`unit-${i}`}),expected);
   if(type==="ANSWER")assert.ok(r.finalResponse.replyText.includes(`Official fixture fact ${i}`));
   if(type==="CLARIFY")assert.ok(r.finalResponse.replyText.includes("請提供入住日期"));
   if(type==="HANDOFF")assert.ok(r.finalResponse.replyText.includes("請稍後，將盡快回覆您。"));
  }
  assert.equal(publicReplyAction(r.finalDecision,{propertyId:"foreign",turnId:"turn",taskId:"unit-0"}),undefined);
 });
}

for(const permission of ["ABSENT","SUPPRESSED"])test(`silent ${permission} plus clarification retains necessary question`,()=>{
 const {finalizeTurnResponse}=require("../lib/new-core/application-service");
 const r=finalizeTurnResponse({scope:{propertyId:"p"},turnId:"turn",property:{propertyId:"p"},
  requestEvidence:[{taskId:"quiet",requestPresence:permission==="ABSENT"?"ABSENT":"PRESENT",activeRequest:permission!=="ABSENT",replyPermission:permission==="SUPPRESSED"?"SUPPRESSED":"ALLOWED"},{taskId:"stay",requestPresence:"PRESENT",activeRequest:true,replyPermission:"ALLOWED"}],
  executionOutcomes:[{taskId:"stay",type:"availability",outcome:"not_ready",readinessStatus:"missing_information",missingFields:["checkIn","checkOut"]}],
  taskResults:[{taskId:"stay",type:"availability",status:"needs_clarification",missingInputs:["checkIn","checkOut"],facts:{}}]});
 assert.equal(r.rebuildCount,0);assert.equal(r.finalDecision.action,"clarification");
 assert.equal(r.finalResponse.replyText,"請提供入住日期。");assert.equal(r.claimValidation.ok,true);
});
