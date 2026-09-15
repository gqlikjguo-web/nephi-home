"use strict";
// FAKE_INTEGRATION: saved structured fixture, fake fetch only. No network.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module");
const filename=path.join(__dirname,"new-core-openai-adapter-contract-runner.js");
const fixture=new Module(filename,module);fixture.filename=filename;fixture.paths=Module._nodeModulePaths(__dirname);
fixture._compile(fs.readFileSync(filename,"utf8").split("async function main()")[0]+"\nmodule.exports={c01,providerOutput,successfulResponse,options};",filename);
const f=fixture.exports;
const {callOpenAIUnderstandingV1}=require("../lib/providers/openai-understanding-v1");
const {formatNewCoreProductionTrace}=require("../lib/new-core/production-safe-trace");
async function run(kind,throwSink=false){
 const events=[],requests=[];let calls=0;
 const input=f.c01(),before=JSON.stringify(input);
 let result,error;
 try {result=await callOpenAIUnderstandingV1(input,f.options(async(url,options)=>{
  requests.push({url,body:options.body});calls++;
  await new Promise(resolve=>setImmediate(resolve));
  if(kind==="network")throw Error("synthetic outage");
  const output=f.providerOutput();
  if(kind==="correction"&&calls===1)output.understandingOutput.units[0].confidenceBand="invalid";
  return f.successfulResponse(output);
 },{onOperationalDiagnostic:entry=>{if(throwSink)throw Error("synthetic observer outage");events.push(entry);}}));}
 catch(e){error=e.code;}
 assert.equal(JSON.stringify(input),before,"timing must not mutate C01");
 return {business:{kind,calls,requests,result,error},events};
}
(async()=>{
 const runs=[];for(const kind of ["normal","correction","network"])runs.push(await run(kind));
 assert.deepEqual(runs.map(r=>r.business.calls),[1,2,1]);
 if(process.argv.includes("--business-only")){console.log(JSON.stringify(runs.map(r=>r.business)));return;}
 const probe=formatNewCoreProductionTrace({stage:"new_core_latency",traceId:"trace",segment:"provider",prepMs:1,openaiMs:2,validationMs:3,otherMs:4,totalMs:10,correctionCalls:0,startedMs:10,endedMs:20,rawOutput:"private",apiKey:"private",prompt:"private"});
 assert.ok(probe,"safe production timing trace must exist");
 assert.equal(JSON.stringify(probe).includes("private"),false);
 assert.equal(probe.totalMs,10);
 for(const r of runs){
  const events=r.events.filter(e=>e.stage==="new_core_latency"&&e.segment==="provider");assert.equal(events.length,1);
  const e=events[0];for(const key of ["prepMs","openaiMs","validationMs","otherMs","totalMs"])assert.ok(Number.isFinite(e[key])&&e[key]>=0,key);
  assert.ok(Math.abs(e.prepMs+e.openaiMs+e.validationMs+e.otherMs-e.totalMs)<0.00001,"disjoint phases cover provider elapsed time");
  assert.equal(e.correctionCalls,r.business.kind==="correction"?1:0);
  assert.ok(e.openaiMs>0);
  const safe=formatNewCoreProductionTrace(e);assert.equal(safe.traceId,f.c01().traceId);
  assert.deepEqual((await run(r.business.kind,true)).business,r.business,"observer failure cannot change inputs/output/call count");
 }
 const {createLatencyClock}=require("../lib/new-core/understanding-latency");
 let now=10;const clock=createLatencyClock(()=>now);
 now=13;clock.enter("openai");now=20;clock.enter("validation");now=25;clock.enter("other");now=27;
 assert.deepEqual(clock.finish(),{startedMs:10,endedMs:27,prepMs:3,openaiMs:7,validationMs:5,otherMs:2,totalMs:17});
 for(const value of [null,undefined,NaN,Infinity,-1,"12"]){
  const safe=formatNewCoreProductionTrace({stage:"new_core_latency",traceId:"trace",segment:"provider",prepMs:value});
  assert.equal(Object.hasOwn(safe,"prepMs"),false,"missing or invalid values must not become zero");
 }
 console.log("PASS monotonic phases, correction count, safe masking, unchanged request/result, observer failure isolation");
})().catch(e=>{console.error(e);process.exitCode=1;});
