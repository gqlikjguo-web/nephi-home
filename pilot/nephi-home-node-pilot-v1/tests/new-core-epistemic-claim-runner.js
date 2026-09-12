"use strict";
// FAKE_INTEGRATION + STRUCTURED_CONTRACT_TEST: fixture OpenAI; actual executor/claim authority.
const test=require('node:test'),assert=require('node:assert/strict');
const {run}=require('./new-core-request-responsibility-fixture');
const {buildResponsePlan}=require('../lib/conversation-engine-v2/response-planner');
const {composeControlledReply}=require('../lib/conversation-engine-v2/controlled-composer');
const {validateClaims}=require('../lib/conversation-engine-v2/claim-validator');
function validate(tasks,propertyId='fixture'){const plan=buildResponsePlan({propertyId,taskResults:tasks,inputTaskIds:tasks.map(t=>t.taskId)});return {plan,validation:validateClaims(composeControlledReply(plan),plan,tasks.map(t=>t.taskId))};}
const factual=(source=true)=>({taskId:'fact',type:'amenity',status:'answered',facts:{answer:'正式設備資料',...(source?{source:'property_catalog'}:{})}});
test('U6 epistemic unknown without provenance is rejected',async()=>{
  const {records}=await run(['ANSWER'],{unknownFacts:true});
  const original=records.planInputs[0].taskResults[0];
  assert.equal(validate([original],records.planInputs[0].propertyId).validation.ok,true);
  const {unknownProvenance,...withoutProvenance}=original;
  assert.ok(unknownProvenance);
  assert.equal(Object.hasOwn(withoutProvenance,'unknownProvenance'),false);
  const result=validate([withoutProvenance],records.planInputs[0].propertyId);
  assert.equal(result.plan.sections[0].claimType,'EPISTEMIC_UNKNOWN');
  assert.equal(result.validation.ok,false);
  assert.ok(result.validation.errors.includes('invalid_unknown_provenance'));
});
test('U1 official Unknown forms epistemic claim and nonempty reply',async()=>{const {result,records}=await run(['ANSWER'],{unknownFacts:true});const {plan,validation}=validate(records.planInputs[0].taskResults,records.planInputs[0].propertyId);assert.equal(plan.sections[0].claimType,'EPISTEMIC_UNKNOWN');assert.equal(validation.ok,true,JSON.stringify(validation));assert.equal(result.finalDecision.action,'reply');assert.ok(result.finalResponse.replyText.includes('目前無法確認'));assert.equal(result.finalResponse.shouldReply,true)});
test('U2 factual source remains mandatory',()=>{assert.equal(validate([factual()]).validation.ok,true);assert.ok(validate([factual(false)]).validation.errors.includes('missing_fact_source'))});
test('U3 forged unknown provenance is rejected',()=>{const x=validate([{taskId:'fake',type:'amenity',status:'answered',claimType:'EPISTEMIC_UNKNOWN',unknownProvenance:{sourceOutcomeStatus:'unknown',sourceReasonCode:'property_fact_unknown',taskId:'fake'},facts:{}}]);assert.ok(x.validation.errors.includes('invalid_unknown_provenance'),JSON.stringify(x.validation))});
test('U4 clarify and handoff are nonfactual',()=>{for(const status of ['needs_clarification','needs_human']){const x=validate([{taskId:'prompt',type:'amenity',status,facts:{},question:'請補充需求資訊。'}]);assert.equal(x.validation.ok,true,JSON.stringify(x.validation))}});
test('U5 mixed fact and unknown validate independently',async()=>{const {records}=await run(['ANSWER'],{unknownFacts:true});const unknown=records.planInputs[0].taskResults[0];const good=validate([factual(),unknown],records.planInputs[0].propertyId);assert.equal(good.validation.ok,true,JSON.stringify(good.validation));assert.equal(good.plan.sections[1].claimType,'EPISTEMIC_UNKNOWN');assert.ok(validate([factual(false),unknown],records.planInputs[0].propertyId).validation.errors.includes('missing_fact_source'))});

test('U7 official Unknown cannot cross property scope',async()=>{
  const {records}=await run(['ANSWER'],{unknownFacts:true});
  const original=records.planInputs[0];
  const wrongProperty=original.propertyId+'-different';
  const result=validate(original.taskResults,wrongProperty);
  assert.equal(result.validation.ok,false);
  assert.ok(result.validation.errors.includes('unknown_property_scope_mismatch'));
});
