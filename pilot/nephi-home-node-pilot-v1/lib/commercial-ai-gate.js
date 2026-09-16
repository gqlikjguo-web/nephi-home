"use strict";
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const context = new AsyncLocalStorage();
// Server credential registrations are wiring, never balances or permissions.
const registeredKeys = new Map();
const keyHash = key => createHash('sha256').update(String(key || '').trim()).digest('hex');
function commercialError(reason) {
  return Object.assign(new Error('AI commercial admission stopped'), {code:'COMMERCIAL_AI_BLOCKED',reason,status:409});
}
function isCommercialError(error) { return error?.code === 'COMMERCIAL_AI_BLOCKED'; }
function stop(current, reason) { const error=commercialError(reason); if(current) current.failure=error; throw error; }
function createCommercialAiController(store,{apiKeys=[]}={}) {
  const hashes=[...new Set(apiKeys.filter(Boolean).map(keyHash))];
  hashes.forEach(key=>registeredKeys.set(key,(registeredKeys.get(key)||0)+1));
  let closed=false;
  return {
    async runOperatorTest(scope,work) {
      const current={store,scope,failure:null};
      let admitted;try{admitted=await store.authorizeOperatorTest(scope);}catch{stop(current,'ACCOUNTING_UNAVAILABLE');}
      if(!admitted?.allowed)stop(current,admitted?.reason||'MANUAL_AUTHORIZATION_REQUIRED');
      return context.run(current,async()=>{const result=await work();if(current.failure)throw current.failure;return result;});
    },
    async runManual(scope,work) {
      const current={store,scope,failure:null};
      let admitted;try{admitted=await store.authorizeManual(scope);}catch{stop(current,'ACCOUNTING_UNAVAILABLE');}
      if(!admitted?.allowed)stop(current,admitted?.reason||'MANUAL_AUTHORIZATION_REQUIRED');
      return context.run(current,async()=>{const result=await work();if(current.failure)throw current.failure;return result;});
    },
    async run(input,work) {
      const scope={propertyId:input.customerId,channelId:input.channelId,userId:input.lineUserId,
        eventIds:[...new Set(input.eventIds?.length?input.eventIds:input.sourceEvents?.length?input.sourceEvents.map(e=>e.eventId):[input.eventId])]};
      if(!scope.propertyId||!scope.channelId||!scope.userId||scope.eventIds.some(id=>typeof id!=='string'||!id))throw commercialError('UNTRUSTED_EVENT');
      const current={store,scope,failure:null};
      let reserve;try{reserve=await store.reserve(scope);}catch{stop(current,'ACCOUNTING_UNAVAILABLE');}
      if(!reserve?.allowed)stop(current,reserve?.reason||'ADMISSION_DENIED');
      return context.run(current,async()=>{const result=await work();if(current.failure)throw current.failure;return result;});
    },
    close(){if(closed)return;closed=true;hashes.forEach(key=>{const n=registeredKeys.get(key)-1;if(n)registeredKeys.set(key,n);else registeredKeys.delete(key);});}
  };
}
async function beforeCommercialAttempt(input,attemptNumber,apiKey) {
  const current=context.getStore();
  if(!current){if(registeredKeys.has(keyHash(apiKey)))throw commercialError('ADMISSION_CONTEXT_REQUIRED');return null;}
  if(current.failure)throw current.failure;
  const {scope,store}=current,p=input.propertyScope;
  if(!p||p.propertyId!==scope.propertyId||p.channel!==scope.channelId||p.userId!==scope.userId
    ||input.sourceEvents.length!==scope.eventIds.length||input.sourceEvents.some(e=>!scope.eventIds.includes(e.eventId)))stop(current,'SCOPE_MISMATCH');
  const attempt={...scope,turnId:input.turnId,attemptNumber};
  let admitted;try{admitted=await store.beginAttempt(attempt);}catch{stop(current,'ACCOUNTING_UNAVAILABLE');}
  if(!admitted?.allowed)stop(current,admitted?.reason||'ATTEMPT_DENIED');
  return {current,attempt,finished:false};
}
async function finishCommercialAttempt(ticket,usage,outcome) {
  if(!ticket||ticket.finished)return;
  ticket.finished=true;
  try{await ticket.current.store.finishAttempt({...ticket.attempt,usage,outcome});}
  catch{stop(ticket.current,'ACCOUNTING_UNAVAILABLE');}
}
module.exports={createCommercialAiController,beforeCommercialAttempt,finishCommercialAttempt,isCommercialError,commercialError};
