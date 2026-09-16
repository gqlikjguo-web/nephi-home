"use strict";
// RUNTIME_COMPONENT_TEST / FAKE_INTEGRATION: real provider, fake external HTTP.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const gatePath=path.join(__dirname,'../lib/commercial-ai-gate.js');
const gate=fs.existsSync(gatePath)?require(gatePath):{};
assert.equal(typeof gate.createCommercialAiController,'function','paid commercial gate must exist before provider transport');
const ff=path.join(__dirname,'new-core-openai-adapter-contract-runner.js'),fixture=new Module(ff,module);fixture.filename=ff;fixture.paths=Module._nodeModulePaths(__dirname);fixture._compile(fs.readFileSync(ff,'utf8').split('async function main()')[0]+'\nmodule.exports={c01,providerOutput,successfulResponse,options};',ff);const f=fixture.exports;
const {callOpenAIUnderstandingV1}=require('../lib/providers/openai-understanding-v1');
const input={customerId:'property-a',channelId:'line-a',lineUserId:'guest-a',eventId:'event-a'},key='local-commercial-gate-fixture';
async function scenario({denyReserve=false,denyBegin=false,failFinish=false,correction=false,wrongScope=false}={}) {
 const seen=[],store={reserve(x){seen.push(['reserve',x]);return {allowed:!denyReserve,reason:'AI_DISABLED'};},beginAttempt(x){seen.push(['begin',x]);if(denyBegin)throw Error('DB_UNAVAILABLE');return {allowed:true};},finishAttempt(x){seen.push(['finish',x]);if(failFinish)throw Error('LEDGER_WRITE_FAILED');return {saved:true};}};
 const controller=gate.createCommercialAiController(store,{apiKeys:[key]});let calls=0,result,error;
 try {
  result=await controller.run(input,()=>callOpenAIUnderstandingV1(f.c01(),{
   ...f.options(async()=>{
    calls++; const out=f.providerOutput();
    if(correction&&calls===1)out.understandingOutput.units[0].confidenceBand='invalid';
    const payload={model:'gpt-5.6-luna',status:'completed',usage:{input_tokens:100,input_tokens_details:{cached_tokens:20},output_tokens:10,total_tokens:110},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(out)}]}]};
    return {...f.successfulResponse(out),text:async()=>JSON.stringify(payload)};
   }),apiKey:key
  }));
 }catch(e){error=e;}finally{controller.close();}
 return {seen,calls,result,error};
}
(async()=>{
 const normal=await scenario();assert.equal(normal.error,undefined);assert.equal(normal.calls,1);assert.deepEqual(normal.result.understandingOutput,f.providerOutput().understandingOutput);assert.deepEqual(normal.seen.map(x=>x[0]),['reserve','begin','finish']);
 const denied=await scenario({denyReserve:true});assert.equal(denied.calls,0);assert.ok(denied.error);
 const db=await scenario({denyBegin:true});assert.equal(db.calls,0);assert.ok(db.error);
 const failed=await scenario({failFinish:true});assert.equal(failed.calls,1);assert.ok(failed.error,'post-response ledger failure must fail closed, never continue reply');
 const corrected=await scenario({correction:true});assert.equal(corrected.calls,2);assert.equal(corrected.seen.filter(x=>x[0]==='reserve').length,1);assert.deepEqual(corrected.seen.filter(x=>x[0]==='begin').map(x=>x[1].attemptNumber),[1,2]);assert.equal(corrected.seen.filter(x=>x[0]==='finish').length,2);assert.equal(corrected.seen[2][1].usage.input_tokens,100);
 let calls=0;const controller=gate.createCommercialAiController({},{apiKeys:[key]});try{await assert.rejects(()=>callOpenAIUnderstandingV1(f.c01(),{...f.options(async()=>{calls++;return f.successfulResponse();}),apiKey:key}));assert.equal(calls,0,'registered paid key cannot bypass admission by missing context');}finally{controller.close();}
 const scopeController=gate.createCommercialAiController({reserve:()=>({allowed:true}),beginAttempt:()=>{throw Error('must not reach wrong scope');}},{apiKeys:[key]});try{await assert.rejects(()=>scopeController.run({...input,customerId:'property-b'},()=>callOpenAIUnderstandingV1(f.c01(),{...f.options(async()=>{calls++;return f.successfulResponse();}),apiKey:key})));assert.equal(calls,0);}finally{scopeController.close();}
 const padded=gate.createCommercialAiController({},{apiKeys:['  '+key+'  ']});try{await assert.rejects(()=>callOpenAIUnderstandingV1(f.c01(),{...f.options(async()=>{calls++;return f.successfulResponse();}),apiKey:key}));assert.equal(calls,0,'credential normalization cannot bypass admission');}finally{padded.close();}
 let manualCalls=0;const manualSeen=[];const manual=gate.createCommercialAiController({authorizeManual:x=>{manualSeen.push(x);return {allowed:true};},reserve:()=>{throw Error('manual must never consume guest quota');},beginAttempt:()=>({allowed:true}),finishAttempt:()=>({success:true})},{apiKeys:[key]});
 try{assert.equal(typeof manual.runManual,'function');const output=await manual.runManual({propertyId:input.customerId,channelId:input.channelId,userId:input.lineUserId,turnId:'event-a',eventIds:['event-a'],ownerId:'owner',testSessionId:'session'},()=>callOpenAIUnderstandingV1(f.c01(),{...f.options(async()=>{manualCalls++;return f.successfulResponse();}),apiKey:key}));assert.ok(output);assert.equal(manualCalls,1);assert.equal(manualSeen.length,1);}finally{manual.close();}
 let operatorAdmissions=0;const operator=gate.createCommercialAiController({authorizeOperatorTest:()=>{operatorAdmissions++;return {allowed:true};},reserve:()=>{throw Error('operator test must not consume quota');},beginAttempt:()=>({allowed:true}),finishAttempt:()=>({success:true})},{apiKeys:[key]});try{assert.equal(typeof operator.runOperatorTest,'function');await operator.runOperatorTest({propertyId:input.customerId,channelId:input.channelId,userId:input.lineUserId,turnId:'event-a',eventIds:['event-a'],adminSessionHash:'local-session-hash'},()=>callOpenAIUnderstandingV1(f.c01(),{...f.options(async()=>f.successfulResponse()),apiKey:key}));assert.equal(operatorAdmissions,1);}finally{operator.close();}
 console.log('PASS commercial paid gate: reserve/begin/usage/correction/scope/missing-context/fail-closed');
})().catch(e=>{console.error(e);process.exitCode=1;});
