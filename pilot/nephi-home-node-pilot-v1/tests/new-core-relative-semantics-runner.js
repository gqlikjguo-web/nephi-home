'use strict';
// STRUCTURED_CONTRACT_TEST; exact source spans and actual C03/C05/C06/C07/C08/Temporal.
const assert=require('node:assert/strict'),{test}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.join(__dirname,'new-core-canonical-adapter-runner.js');
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(__dirname);
const source=fs.readFileSync(filename,'utf8');m._compile(source.slice(0,source.indexOf('// AC-CAN-001'))+'\nmodule.exports={pipeline,createC08,execute};',filename);
const {pipeline,createC08,execute}=m.exports;
const {resolveTemporalExpression}=require('../lib/conversation-engine-v2/temporal-resolver');
function candidate(rawText,dayOffset=1,dayPeriod='evening'){return {rawText,kind:'relative_date',checkInCandidate:null,checkOutCandidate:null,nightsCandidate:1,relativeSemantics:{dayOffset,dayPeriod}};}
for(const text of ['明晚','明天傍晚入住','tomorrow evening','隔一天晚上入住'])test('same typed relative meaning: '+text,()=>{
 const p=pipeline({messageText:text,unitOverrides:{temporalCandidate:candidate(text)}});const c=createC08(p);assert.equal(c.ok,true);const e=execute(c.value);assert.equal(e.ok,true);assert.equal(e.value.canonicalRequest.temporalState.checkIn,'2026-08-29');assert.equal(e.value.canonicalRequest.temporalState.checkOut,'2026-08-30');
});
function resolve(rawText,dayOffset,stamp='2026-09-10T16:00:01Z'){return resolveTemporalExpression({rawText,kind:'relative',anchor:'message_time',relativeSemantics:{dayOffset,dayPeriod:'night'}},{eventTimestamp:stamp,timezone:'Asia/Taipei',nightsCandidate:1,sourceEvidenceRefs:[{eventId:'e',startOffset:0,endOffset:rawText.length,quote:rawText}]});}
test('timezone anchor before midnight',()=>assert.equal(resolve('次日夜間',1,'2026-09-10T15:59:59Z').checkIn,'2026-09-11'));
test('timezone anchor after midnight',()=>assert.equal(resolve('次日夜間',1).checkIn,'2026-09-12'));
test('past relative candidate is rejected by canonical temporal',()=>assert.equal(resolve('previous night',-1).repairReasonCode,'past_date'));
test('typed relative cannot contradict recognized source grammar',()=>assert.equal(resolve('明天',2).resolutionStatus,'unresolved'));
test('invalid typed relative offset rejected',()=>assert.equal(resolve('opaque',1.5).resolutionStatus,'unresolved'));
test('absolute grammar remains supported',()=>assert.equal(resolveTemporalExpression({rawText:'2026/10/09',kind:'absolute',anchor:'message_time'},{eventTimestamp:'2026-09-11T00:00:00Z',timezone:'Asia/Taipei'}).checkIn,'2026-10-09'));
test('typed day cannot erase a recognized date range',()=>assert.equal(resolve('2026/09/12-09/14',1).resolutionStatus,'unresolved'));
test('typed relative and absolute representation agree on the complete interval',()=>{
 const result=resolve('2026/09/12',1);
 assert.equal(result.resolutionStatus,'resolved');
 assert.equal(result.checkIn,'2026-09-12');
 assert.equal(result.checkOut,'2026-09-13');
 assert.equal(result.nights,1);
});
test('typed relative and absolute representation disagree on the interval',()=>{
 const result=resolve('2026/09/12',2);
 assert.equal(result.resolutionStatus,'unresolved');
 assert.equal(result.repairReasonCode,'relative_semantics_conflict');
 assert.equal(result.checkIn,null);
 assert.equal(result.checkOut,null);
});
test('typed relative day preserves consistent explicit duration',()=>{
 const text='明天住兩晚';const p=pipeline({messageText:text,unitOverrides:{temporalCandidate:{...candidate(text,1,'unspecified'),nightsCandidate:2}}});
 const c=createC08(p);assert.equal(c.ok,true);const e=execute(c.value);assert.equal(e.ok,true);
 assert.equal(e.value.canonicalRequest.temporalState.checkIn,'2026-08-29');assert.equal(e.value.canonicalRequest.temporalState.checkOut,'2026-08-31');assert.equal(e.value.canonicalRequest.temporalState.nights,2);
});
test('typed candidate retains existing broader source-constraint recovery',()=>{
 const p=pipeline({messageText:'明天住兩晚',unitOverrides:{temporalCandidate:{...candidate('明天住兩晚',1,'unspecified'),nightsCandidate:null}}});
 const c=createC08(p);assert.equal(c.ok,true);const e=execute(c.value);assert.equal(e.ok,true);
 assert.equal(e.value.canonicalRequest.temporalState.checkIn,'2026-08-29');assert.equal(e.value.canonicalRequest.temporalState.checkOut,'2026-08-31');assert.equal(e.value.canonicalRequest.temporalState.nights,2);
});
