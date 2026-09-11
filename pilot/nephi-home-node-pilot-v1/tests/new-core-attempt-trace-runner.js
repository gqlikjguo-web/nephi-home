'use strict';
// STRUCTURED_CONTRACT_TEST: safe formatter consumes actual producer diagnostic shape.
const assert=require('node:assert/strict');
const {formatNewCoreProductionTrace}=require('../lib/new-core/production-safe-trace');
const details={stage:'new_core_understanding_attempts',traceId:'trace',totalUnderstandingCalls:2,finalAcceptedAttempt:2,attempts:[
 {attemptNumber:1,attemptType:'initial',accepted:false,rejected:true,triggerFailure:null,validationResult:{ok:false,failures:[{boundary:'C05',failureCode:'CONTEXT_TARGET_UNAVAILABLE',errors:['historyBinding'],rawOutput:'private payload'}],terminalCode:null,category:null}},
 {attemptNumber:2,attemptType:'correction',accepted:true,rejected:false,triggerFailure:[{boundary:'C05',failureCode:'CONTEXT_TARGET_UNAVAILABLE',unitId:'private-unit'}],validationResult:{ok:true,failures:[],terminalCode:null,category:null}}
],rawOutput:'private payload'};
const safe=formatNewCoreProductionTrace(details);
assert.equal(safe.attempts[0].validationResult?.failures[0].failureCode,'CONTEXT_TARGET_UNAVAILABLE');
assert.equal(safe.attempts[1].triggerFailure?.[0].failureCode,'CONTEXT_TARGET_UNAVAILABLE');
assert.equal(safe.attempts[1].validationResult.ok,true);
assert.equal(JSON.stringify(safe).includes('private'),false);
assert.equal(safe.totalUnderstandingCalls,2);assert.equal(safe.attempts.length,2);
console.log('STRUCTURED_CONTRACT_TEST attempt validation/trigger evidence and safe redaction PASS');
