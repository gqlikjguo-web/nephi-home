'use strict';
// STRUCTURED_CONTRACT_TEST: outer State task shape gate.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateConversationTaskV3,createConversationTaskV3}=require('../lib/conversation-contracts/conversation-state-v3');
for(const [name,input] of [['undefined',undefined],['null',null],['number',1],['string','task'],['boolean',false],['array',[]],['empty',{}]])test(name,()=>{const result=validateConversationTaskV3(input);assert.equal(result.ok,false);assert.ok(Array.isArray(result.errors)&&result.errors.length);assert.ok(Object.hasOwn(result,'value'));});
const t={taskId:'t',taskType:'pricing',productType:'any',productId:null,roomTypeId:null,bundleId:null,checkIn:null,checkOut:null,guestCount:null,knownFields:['productType'],missingFields:['checkIn','checkOut'],status:'pending',createdAt:'2026-09-11T00:00:00Z',updatedAt:'2026-09-11T00:00:00Z',expiresAt:'2026-09-12T00:00:00Z'};
test('valid task',()=>assert.equal(validateConversationTaskV3(t).ok,true));
test('invalid quantity',()=>assert.equal(validateConversationTaskV3({...t,requestedQuantity:0,distinctRequirement:'none'}).ok,false));
test('valid quantity',()=>{const input={...t,requestedQuantity:3,distinctRequirement:'distinct_entities'};assert.equal(validateConversationTaskV3(input).ok,true);assert.equal(createConversationTaskV3(input).requestedQuantity,3);});
