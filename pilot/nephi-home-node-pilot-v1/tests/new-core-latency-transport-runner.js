"use strict";
const assert=require("node:assert/strict");
const {setup}=require("./helpers/burst-production-fixture");

// FAKE_INTEGRATION: real provider/formatter with an isolated transport, no OpenAI.
function providerFixture(){
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
 const name=path.join(__dirname,'new-core-openai-adapter-contract-runner.js');
 const fixture=new Module(name,module);fixture.filename=name;fixture.paths=Module._nodeModulePaths(__dirname);
 fixture._compile(fs.readFileSync(name,'utf8').split('async function main()')[0]+'\nmodule.exports={c01,providerOutput,successfulResponse,response,options};',name);
 return fixture.exports;
}
async function transportCase(mode){
 const f=providerFixture(),{callOpenAIUnderstandingV1}=require('../lib/providers/openai-understanding-v1');
 const {formatNewCoreProductionTrace}=require('../lib/new-core/production-safe-trace');
 const requests=[],events=[],timers=[];let calls=0,result,error;
 const originalTimer=global.setTimeout,originalClear=global.clearTimeout;
 global.setTimeout=(callback,delay)=>{const t={callback,delay,cleared:false};timers.push(t);return t;};
 global.clearTimeout=t=>{t.cleared=true;};
 try{
  result=await callOpenAIUnderstandingV1(f.c01(),f.options(async(url,request)=>{
   calls++;requests.push(request);
   const abort=()=>new Promise((resolve,reject)=>{
    request.signal.addEventListener('abort',()=>reject(Object.assign(new Error('transport aborted'),{name:'AbortError'})),{once:true});
    queueMicrotask(()=>timers.at(-1).callback());
   });
   if(mode==='timeout')return abort();
   if(mode==='body-timeout')return {ok:true,status:200,headers:{get:()=> 'req-body'},text:abort};
   if(mode==='http')return f.response(429,JSON.stringify({error:{type:'rate_limit_error'}}),'req-limited');
   const output=f.providerOutput();
   if(mode==='correction'&&calls===1)output.understandingOutput.units[0].confidenceBand='invalid';
   return f.successfulResponse(output,mode==='secret-header'?f.options(()=>{}).apiKey:'req-success');
  },{requestIdFactory:()=>`12345678-1234-4234-8234-${String(calls+1).padStart(12,'0')}`,
   onOperationalDiagnostic:entry=>events.push(entry)}));
 }catch(e){error=e.code;}finally{global.setTimeout=originalTimer;global.clearTimeout=originalClear;}
 assert.ok(timers.every(t=>t.delay===30000&&t.cleared),'existing default deadline and timer cleanup');
 assert.equal(calls,mode==='correction'?2:1,'no retry or additional call');
 const entry=events.find(e=>e.stage==='new_core_understanding_attempts');
 return {calls,result,error,requests,entry,safe:formatNewCoreProductionTrace(entry)};
}
function ordered(transport,keys){
 let prior=0;
 for(const k of keys){assert.ok(Number.isSafeInteger(transport[k])&&transport[k]>=prior,k);prior=transport[k];}
}
async function transportEvidenceCases(persisted){
 const cases=[];
 async function test(name,work){try{await work();cases.push({name,status:'PASS'});}catch(e){cases.push({name,status:'FAIL',message:e.message});}}
 await test('successful persisted attempt retains metadata without raw input',()=>{
  const a=persisted.find(e=>e.stage==='new_core_understanding_attempts').attempts[0].transport;
  assert.ok(a,'persisted transport diagnostic is missing');
  ordered(a,['requestStartedAtMs','fetchStartedAtMs','headersReceivedAtMs','bodyCompletedAtMs']);
  assert.ok(a.clientRequestId);assert.equal(a.httpStatus,200);assert.equal(a.abortTriggeredAtMs,null);
  assert.ok(a.sizes.requestBodyBytes>a.sizes.modelInputBytes);
 });
 await test('successful request sizes match actual sent content and closed trace survives reformat',async()=>{
  const r=await transportCase('normal'),t=r.safe.attempts[0].transport;
  assert.ok(t,'transport diagnostic is missing');assert.equal(r.error,undefined);assert.equal(r.entry.finalAcceptedAttempt,1);
  const request=r.requests[0],body=JSON.parse(request.body),input=JSON.parse(body.input[1].content[0].text),bytes=x=>Buffer.byteLength(typeof x==='string'?x:JSON.stringify(x));
  assert.equal(t.clientRequestId,request.headers['X-Client-Request-Id']);assert.equal(t.providerRequestId,'req-success');
  assert.equal(t.sizes.requestBodyBytes,bytes(request.body));assert.equal(t.sizes.modelInputBytes,bytes(body.input));
  assert.equal(t.sizes.understandingInputBytes,bytes(body.input[1].content[0].text));assert.equal(t.sizes.schemaBytes,bytes(body.text.format.schema));
  for(const [key,value]of [['sourceEvents',input.sourceEvents],['history',input.recentConversation],['capabilityCatalog',input.capabilityCatalog],['subjectCatalog',input.publicSubjectCatalog]]){
   assert.equal(t.sizes[key+'Count'],value.length);assert.equal(t.sizes[key+'Bytes'],bytes(value));
  }
  const summaries=input.recentConversation.flatMap(e=>e.referenceableRequestSummaries||[]);
  assert.equal(t.sizes.contextSummaryCount,summaries.length);assert.equal(t.sizes.contextSummaryBytes,bytes(summaries));
  const encoded=JSON.stringify(t);for(const secret of [frozenSecret(), 'guest-a','Property A','謝謝','請提供日期'])assert.equal(encoded.includes(secret),false);
  assert.deepEqual(require('../lib/new-core/production-safe-trace').formatNewCoreProductionTrace(r.safe),r.safe);
 });
 await test('pre-header deadline records abort stage and preserves provider timeout',async()=>{
  const r=await transportCase('timeout'),t=r.safe.attempts[0].transport;assert.ok(t,'timeout transport is missing');
  assert.equal(r.error,'UNDERSTANDING_PROVIDER_TIMEOUT');ordered(t,['requestStartedAtMs','fetchStartedAtMs','abortTriggeredAtMs']);
  assert.equal(t.timeoutStage,'fetch');assert.equal(t.headersReceivedAtMs,null);assert.equal(t.bodyCompletedAtMs,null);assert.equal(t.httpStatus,null);assert.equal(t.providerRequestId,null);
 });
 await test('body deadline preserves existing parse failure and records received headers',async()=>{
  const r=await transportCase('body-timeout'),t=r.safe.attempts[0].transport;assert.ok(t,'body transport is missing');
  assert.equal(r.error,'UNDERSTANDING_SCHEMA_INVALID');assert.equal(r.entry.attempts[0].validationResult.category,'parse_failure');
  ordered(t,['requestStartedAtMs','fetchStartedAtMs','headersReceivedAtMs','abortTriggeredAtMs']);
  assert.equal(t.timeoutStage,'body');assert.equal(t.bodyCompletedAtMs,null);assert.equal(t.httpStatus,200);assert.equal(t.providerRequestId,'req-body');
 });
 await test('HTTP failure retains exact status/id and completed-body marker without retry',async()=>{
  const r=await transportCase('http'),t=r.safe.attempts[0].transport;assert.ok(t,'HTTP transport is missing');
  assert.equal(t.httpStatus,429);assert.equal(t.providerRequestId,'req-limited');assert.equal(t.abortTriggeredAtMs,null);assert.ok(t.bodyCompletedAtMs);assert.equal(r.entry.attempts[0].validationResult.category,'rate_limit');
 });
 await test('controlled correction keeps separate bounded metadata and same two-call admission',async()=>{
  const r=await transportCase('correction');assert.equal(r.entry.finalAcceptedAttempt,2);
  const ts=r.safe.attempts.map(a=>a.transport);assert.ok(ts.every(Boolean),'correction transport is missing');
  assert.notEqual(ts[0].clientRequestId,ts[1].clientRequestId);assert.equal(ts[0].sizes.correctionBytes,0);assert.ok(ts[1].sizes.correctionBytes>0);
 });
 await test('returned request-id cannot expose API credential',async()=>{
  const r=await transportCase('secret-header'),t=r.safe.attempts[0].transport;assert.ok(t,'safe transport is missing');
  assert.equal(t.providerRequestId,null);assert.equal(JSON.stringify(t).includes(frozenSecret()),false);
 });
 await test('untrusted additional fields and invalid numeric/id values are dropped',async()=>{
  const r=await transportCase('normal'),t=r.safe.attempts[0].transport;assert.ok(t,'safe transport is missing');
  const forged={...t,clientRequestId:'guest@example.invalid',providerRequestId:'Bearer private-value',requestStartedAtMs:'raw-private',prompt:'private',authorization:'private',sizes:{...t.sizes,raw:'private',historyBytes:Infinity}};
  const safe=require('../lib/new-core/production-safe-trace').formatNewCoreProductionTrace({...r.safe,attempts:[{...r.safe.attempts[0],transport:forged}]}).attempts[0].transport;
  assert.equal(safe.clientRequestId,null);assert.equal(safe.providerRequestId,null);assert.equal(safe.requestStartedAtMs,null);assert.equal(safe.sizes.historyBytes,null);assert.equal(JSON.stringify(safe).includes('private'),false);
 });
 console.log(JSON.stringify({classification:'FAKE_INTEGRATION',openAiCalls:0,transportEvidenceCases:cases}));
 assert.ok(cases.every(c=>c.status==='PASS'),'transport observability evidence matrix must pass');
}
function frozenSecret(){return providerFixture().options(()=>{}).apiKey;}

(async()=>{
 const x=await setup("latency-trace",{debounce:0});
 try {
  await x.post([x.event("latency")]);await x.done("latency");
  const trace=x.record("latency").safeTrace;
  const timing=trace.filter(e=>e.stage==="new_core_latency");
  assert.deepEqual(timing.map(e=>e.segment),["adapter_preparation","c01_preparation","provider"]);
  const [adapter,c01,provider]=timing;
  assert.ok(adapter.endedMs<=c01.startedMs&&c01.endedMs<=provider.startedMs);
  const inbound=trace.find(e=>e.stage==="line_inbound");
  const send=trace.find(e=>e.stage==="line_transport"&&e.reasonCode==="reply_attempt");
  assert.equal(inbound.monotonicMs,adapter.startedMs);
  assert.ok(send.monotonicMs>=provider.endedMs);
  assert.equal(provider.correctionCalls,0);
  assert.equal(x.record("latency").processingStatus,"reply_succeeded");
  assert.equal(x.core[0].earliestFailure,null);
  await transportEvidenceCases(trace);
  console.log("PASS production adapter -> provider -> safe persisted trace -> fake LINE; monotonic correlation");
 }finally{await x.app.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
