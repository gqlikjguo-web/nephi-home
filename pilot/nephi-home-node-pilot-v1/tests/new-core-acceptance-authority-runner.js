'use strict';
// FAKE_INTEGRATION: authenticated local API, actual production adapter/core, mock OpenAI, no LINE sends.
const assert=require('node:assert/strict');
const {setup}=require('./helpers/burst-production-fixture');
(async()=>{const x=await setup('acceptance',{testOnly:true,acceptance:true});try{
 const response=await fetch(x.server.url+'/api/admin/test-only/conversation-acceptance',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer local-test-token'},body:JSON.stringify({customerId:'audit_a',conversationId:'formal-core',eventId:'acceptance-event',messageText:'請問入住時間？'})});
 const json=await response.json();const result=json.data||json;console.log(JSON.stringify({status:response.status,result,calls:x.calls.length}));
 assert.equal(response.status,200);assert.equal(x.calls.length,1,'acceptance must execute configured production core');
 assert.equal(result.executionAuthority,'new-core-v1');assert.equal(result.claimValidation.ok,true);assert.equal(result.finalResponse.replyText,x.core[0].response.replyText);
 assert.equal(x.sent.length,0);assert.ok(result.trace.some(row=>row.stage==='new_core_understanding_attempts'));
 console.log('FAKE_INTEGRATION configured current-core acceptance authority PASS');
 }finally{await x.app.stop();}})().catch(error=>{console.error(error);process.exitCode=1;});
