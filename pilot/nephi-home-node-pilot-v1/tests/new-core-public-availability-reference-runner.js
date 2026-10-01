'use strict';
// STRUCTURED_CONTRACT_TEST / FAKE_INTEGRATION; no real providers.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {finalizeTurnResponse}=require('../lib/new-core/application-service');
const {publicAvailabilityUrlForProperty}=require('../lib/public-property-routing');
const {validateVisibleCoverage}=require('../lib/conversation-engine-v2/render-obligation');
for(const propertyId of ['link-scope-a','link-scope-b'])for(const missing of ['checkIn','guestCount','productId'])test(`validated availability clarification keeps its own formal link: ${propertyId}/${missing}`,()=>{
 const property={propertyId,businessProfile:{publicSlug:propertyId.replaceAll('-','')}};
 const url=publicAvailabilityUrlForProperty('https://example.invalid',property),scope={propertyId,channel:'isolated',userId:'guest'};
 const outcome={taskId:'request',type:'availability',outcome:'not_ready',readinessStatus:'missing_information',missingFields:[missing],clarificationRequired:true};
 const result=finalizeTurnResponse({scope,turnId:'turn',property,publicAvailabilityUrl:url,
  requestEvidence:[{taskId:'request',requestPresence:'PRESENT',activeRequest:true,replyPermission:'ALLOWED'}],executionOutcomes:[outcome],
  taskResults:[{taskId:'request',type:'availability',status:'needs_clarification',facts:{},missingInputs:[missing],outcomeStatus:'not_ready',readinessStatus:'missing_information',clarificationRequired:true}]});
 assert.equal(result.finalDecision.action,'clarification');assert.equal(result.claimValidation.ok,true);
 assert.ok(result.finalResponse.replyText.includes(url),'every missing-input type retains the property reference');
 assert.ok(result.finalResponse.replyText.split('\n').some(line=>line&&!line.includes(url)),'a link cannot replace clarification');
 assert.ok(validateVisibleCoverage(result.finalResponse.replyText.replace(url,'https://example.invalid/foreign'),result.responsePlan,{finalDecision:result.finalDecision,publicAvailabilityUrl:url}).errors.length);
});
