"use strict";
// STRUCTURED_CONTRACT_TEST: quantity belongs to the request, not guest count or facts.
const test=require('node:test'),assert=require('node:assert/strict');
const {validateSemanticUnitCandidate}=require('../lib/new-core/contracts/semantic-unit-candidate');
const ref={eventId:'source',messageRef:'source',startOffset:0,endOffset:1,quote:'X'};
const unit={unitId:'unit',evidenceRefs:[ref],purpose:'lodging_question',capability:'availability',subject:{kind:'matched_room_set',catalogIdentity:'fixture-set'},stayDependent:true,temporalCandidate:null,contextLinkCandidateId:'link',safetyCandidate:null,slotCandidates:[],confidenceBand:'high'};
test('baseline fixture is a legal semantic wire unit',()=>assert.equal(validateSemanticUnitCandidate(unit).ok,true));
for(const requestedQuantity of [1,2,3])test('product quantity '+requestedQuantity+' has formal owned field',()=>{
 const r=validateSemanticUnitCandidate({...unit,quantityCandidate:{requestedQuantity,distinctRequirement:'distinct_entities',evidenceRefs:[ref]}});
 assert.equal(r.ok,true,'QUANTITY_CONTRACT_FIELD_NOT_SUPPORTED: '+JSON.stringify(r));
});
test('guest count and product quantity are independent',()=>{
 const withGuests={...unit,slotCandidates:[{slotCandidateId:'guests',slot:'guest_count',operation:'SET',value:4,evidenceRefs:[ref]}]};
 assert.equal(validateSemanticUnitCandidate(withGuests).ok,true);
 assert.equal(Object.hasOwn(withGuests,'quantityCandidate'),false);
 assert.equal(validateSemanticUnitCandidate({...withGuests,quantityCandidate:{requestedQuantity:2,distinctRequirement:'distinct_entities',evidenceRefs:[ref]}}).ok,true,'INDEPENDENT_QUANTITY_CONTRACT_MISSING');
});
const executor=require('../lib/conversation-engine-v2/capability-executor');
for(const scenario of [
 {name:'Q1 unique set fulfilled',ids:['entity-a','entity-b'],status:'known',count:2,remainder:0,fulfillmentStatus:'fulfilled'},
 {name:'Q2 duplicate identities do not fulfill quantity',ids:['entity-a','entity-a'],status:'known',count:1,remainder:1,fulfillmentStatus:'partial'},
 {name:'Q3 partial unique match',ids:['entity-a'],status:'known',count:1,remainder:1,fulfillmentStatus:'partial'},
 {name:'Q7 matched_room_set identity uniqueness',ids:['entity-b','entity-a','entity-b'],status:'known',count:2,remainder:0,fulfillmentStatus:'fulfilled'},
 {name:'Q8 unknown is not none',ids:[],status:'unknown',count:null,remainder:null,fulfillmentStatus:'unknown'},
 {name:'known empty result is none',ids:[],status:'known',count:0,remainder:2,fulfillmentStatus:'none'}
])test(scenario.name,()=>{
 assert.equal(typeof executor.evaluateProductFulfillment,'function','FORMAL_POST_RESOLVER_FULFILLMENT_MISSING');
 const result=executor.evaluateProductFulfillment({requestedQuantity:2,distinctRequirement:'distinct_entities'}, {status:scenario.status,matchedIdentities:scenario.ids});
 assert.equal(result.matchedCount,scenario.count);assert.equal(result.unresolvedRemainder,scenario.remainder);assert.equal(result.fulfillmentStatus,scenario.fulfillmentStatus);
});
