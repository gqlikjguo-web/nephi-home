'use strict';
// STRUCTURED_CONTRACT_TEST: invalid data must retain the formal rejection path.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateConversationTaskV3,createConversationTaskV3,createConversationStateV3,validateConversationStateV3,readConversationStateV3}=require('../lib/conversation-contracts/conversation-state-v3');
const {validateRequestQuantity}=require('../lib/new-core/contracts/request-quantity');
const now='2026-09-11T00:00:00.000Z',scope={propertyId:'p',channel:'test',userId:'u'};
const task=createConversationTaskV3({taskId:'t',taskType:'pricing',productType:'any',productId:null,roomTypeId:null,bundleId:null,checkIn:null,checkOut:null,guestCount:null,knownFields:['productType'],missingFields:['checkIn','checkOut'],status:'pending',createdAt:now,updatedAt:now,expiresAt:now});
for(const quantity of [0,-1,1.5,'2',null,undefined,NaN,Infinity])test('invalid typed quantity '+String(quantity),()=>{
 const input={...task,requestedQuantity:quantity,distinctRequirement:'none'};
 const result=validateConversationTaskV3(input);assert.equal(result.ok,false);assert.ok(result.errors.length);
 const state={...createConversationStateV3({...scope,tasks:[],createdAt:now,updatedAt:now,expiresAt:now}),tasks:[input]};
 assert.equal(validateConversationStateV3(state).ok,false);
 assert.throws(()=>readConversationStateV3(state,scope,now),e=>e.code==='invalid_conversation_state_v3'&&Array.isArray(e.validationErrors));
});
for(const q of [{requestedQuantity:2},{distinctRequirement:'none'},{requestedQuantity:2,distinctRequirement:'invented'}])test('incomplete quantity pair '+JSON.stringify(q),()=>assert.equal(validateConversationTaskV3({...task,...q}).ok,false));
test('missing quantity is not a default',()=>{const result=validateConversationTaskV3(task);assert.equal(result.ok,true);assert.equal(Object.hasOwn(result.value,'requestedQuantity'),false);});
