'use strict';
// STRUCTURED_CONTRACT_TEST: real custom reply time boundary, no model or Resolver.
const test=require('node:test'),assert=require('node:assert/strict');
const {localDateKey,ruleState,evaluateCustomReplyMatch}=require('../lib/custom-reply-rules');
const iso='2026-09-09T06:00:00.000Z',tz='Asia/Taipei';
test('R1 valid Date retains local date',()=>assert.equal(localDateKey(new Date(iso),tz),'2026-09-09'));
test('R2 ISO timestamp equals Date',()=>assert.equal(localDateKey(iso,tz),localDateKey(new Date(iso),tz)));
test('R3 existing numeric timestamp support',()=>assert.equal(localDateKey(Date.parse(iso),tz),localDateKey(new Date(iso),tz)));
test('R4 invalid time fails closed',()=>{for(const value of ['invalid-date',new Date(NaN),NaN])assert.throws(()=>localDateKey(value,tz),RangeError)});
test('R5 no rules control',()=>assert.equal(evaluateCustomReplyMatch({rules:[],propertyId:'fixture',now:iso}).reason.code,'NO_RULES_FOR_PROPERTY'));
test('R6 enabled rule dates evaluate using ISO',()=>{const rule={enabled:true,effectiveStartDate:'2026-09-01',effectiveEndDate:'2026-09-30'};assert.equal(ruleState(rule,iso,tz),'active');assert.equal(ruleState({...rule,effectiveStartDate:'2026-09-10'},iso,tz),'pending');assert.equal(ruleState({...rule,effectiveEndDate:'2026-09-08'},iso,tz),'expired')});
