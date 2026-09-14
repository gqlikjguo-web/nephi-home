"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {answer}=require("./custom-arrival-departure-text-runner");
const {unknownProvenanceFor}=require("../lib/conversation-engine-v2/claim-validator");
// FAKE_INTEGRATION. A catalog identity is not itself a policy answer.
for(const propertyId of ["catalog-alpha","catalog-beta"]) {
 const property={propertyId,displayName:"Lodge",rooms:[{id:"product",name:"Product",type:"double",capacity:2}],propertyFacts:[],commonAnswers:{}};
 test(`${propertyId}: empty known collection cannot invent an operator referral`,async()=>{
  const r=await answer(property,null,{capability:"amenity_list",kind:"property"});
  assert.equal(r.earliestFailure,null);assert.equal(r.artifacts.executionOutcomes[0].outcome,"unknown");
  assert.ok(unknownProvenanceFor(r.artifacts.executionOutcomes[0]));assert.equal(r.finalResponse.replyText,"");
 });
 test(`${propertyId}: product identity without answer remains formal Unknown`,async()=>{
  const r=await answer(property,"product",{capability:"property_fact",kind:"room"});
  assert.equal(r.earliestFailure,null);const o=r.artifacts.executionOutcomes[0];
  assert.equal(o.outcome,"unknown");assert.equal(unknownProvenanceFor(o).propertyId,propertyId);
  assert.equal(r.finalResponse.replyText,"");assert.equal(r.finalDecision.reviewRequired,false);
 });
 for(const [status,text]of [["allowed","Operator's exact published policy."],["not_allowed",""]])test(`${propertyId}: registered ${status} answer remains visible`,async()=>{
  const p={...property,propertyFacts:[{canonicalId:"policy-item",category:"policy",publicName:"Service",status,publicText:text}]};
  const r=await answer(p,"policy-item");assert.equal(r.earliestFailure,null);
  assert.equal(r.artifacts.executionOutcomes[0].outcome,"answered");assert.equal(r.finalDecision.action,"reply");
  assert.ok(r.finalResponse.replyText.length>0);if(text)assert.equal(r.finalResponse.replyText,text);
 });
}
