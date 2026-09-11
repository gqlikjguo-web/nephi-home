'use strict';
// STRUCTURED_CONTRACT_TEST / FAKE_INTEGRATION, no real provider calls.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {formatNewCoreProductionTrace:format}=require('../lib/new-core/production-safe-trace');
function trace(results){return {stage:'new_core_understanding_attempts',traceId:'scope-trace',totalUnderstandingCalls:results.length,finalAcceptedAttempt:null,attempts:results.map((result,i)=>({attemptNumber:i+1,attemptType:i?'correction':'initial',accepted:false,rejected:true,...(result===undefined?{}:{validationResult:result})}))};}
for(const [label,result,expected] of [['true',{ok:true},true],['false',{ok:false},false],['undefined',{ok:undefined},undefined],['null',{ok:null},undefined],['absent',{},undefined],['not-applicable',{notApplicable:true},undefined],['invalid-string',{ok:'false'},undefined]])test(label,()=>{
 const out=format(trace([result]));const v=out.attempts[0].validationResult;
 if(expected===undefined)assert.equal(Object.hasOwn(v||{},'ok'),false);else assert.equal(v.ok,expected);
 if(result.notApplicable)assert.equal(v.notApplicable,true);
 assert.deepEqual(format(out),out,'safe projection remains idempotent');assert.equal(out.traceId,'scope-trace');
});
for(const values of [[{ok:true},undefined],[undefined,{ok:false}]])test('mixed attempt presence '+values.findIndex(v=>v!==undefined),()=>{
 const out=format(trace(values));assert.equal(out.attempts.length,2);for(let i=0;i<2;i++)assert.equal(Object.hasOwn(out.attempts[i].validationResult||{},'ok'),values[i]!==undefined);
});
test('unknown verdict retains safe correction evidence without payload',()=>{const out=format(trace([{ok:null,failures:[{boundary:'C05',failureCode:'CONTEXT_TARGET_UNAVAILABLE',raw:'private'}],adoptionFailure:'CORRECTION_FIELD_NOT_PRESERVED'}]));assert.equal(Object.hasOwn(out.attempts[0].validationResult,'ok'),false);assert.equal(out.attempts[0].validationResult.failures[0].failureCode,'CONTEXT_TARGET_UNAVAILABLE');assert.equal(out.attempts[0].validationResult.adoptionFailure,'CORRECTION_FIELD_NOT_PRESERVED');assert.equal(JSON.stringify(out).includes('private'),false);});
const filename=path.join(__dirname,'new-core-understanding-correction-runner.js');const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(__dirname);const source=fs.readFileSync(filename,'utf8');m._compile(source.slice(0,source.indexOf('\ntest('))+'\nmodule.exports={run,providerOutput};',filename);
const {run,providerOutput}=m.exports;
test('transport before validator has no runtime or safe verdict',async()=>{const x=await run(new Error('synthetic network failure'));assert.equal(x.calls,1);assert.equal(Object.hasOwn(x.meta.attempts[0].validationResult,'ok'),false);const out=format(x.diagnostics.find(d=>d.stage==='new_core_understanding_attempts'));assert.equal(Object.hasOwn(out.attempts[0].validationResult||{},'ok'),false);});
test('formal failure then success retains false and true in both traces',async()=>{const first={...providerOutput(),extra:true};const x=await run(first);assert.equal(x.calls,2);assert.deepEqual(x.meta.attempts.map(a=>a.validationResult.ok),[false,true]);const out=format(x.diagnostics.find(d=>d.stage==='new_core_understanding_attempts'));assert.deepEqual(out.attempts.map(a=>a.validationResult.ok),[false,true]);assert.ok(out.attempts[1].triggerFailure.length);});
