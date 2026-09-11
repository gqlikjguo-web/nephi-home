'use strict';
// RUNTIME_COMPONENT_TEST: pre-task formal decisions retain visible safe responses.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildFinalDecision}=require('../lib/conversation-engine-v2/final-decision');
const {buildFinalResponse}=require('../lib/conversation-engine-v2/final-response-renderer');
for(const plannerFailure of ['planner_schema_invalid','planner_timeout','context_relation_invalid'])test('formal rejection '+plannerFailure,()=>{
 const finalDecision=buildFinalDecision({plannerFailure});const out=buildFinalResponse({finalDecision,responsePlan:null,validatedReplyText:'UNTRUSTED RAW CONTENT',claimValidation:{ok:true,errors:[]}});
 assert.equal(out.shouldReply,true);assert.ok(out.replyText.trim());assert.equal(out.replyText.includes('UNTRUSTED'),false);assert.equal(out.action,finalDecision.action);
});
test('decision-only clarification',()=>{const finalDecision=buildFinalDecision({executionOutcomes:[{taskId:'t',outcome:'not_ready',missingFields:['checkIn']}]});const out=buildFinalResponse({finalDecision,responsePlan:null});assert.equal(out.shouldReply,true);assert.ok(out.replyText.trim());});
for(const noReplyReason of ['absent','suppressed'])test('silent decision '+noReplyReason,()=>{const finalDecision=buildFinalDecision({noReplyReason});const out=buildFinalResponse({finalDecision,responsePlan:null,validatedReplyText:'do not send',responsePrefix:'prefix'});assert.equal(out.shouldReply,false);assert.equal(out.replyText,'');});
