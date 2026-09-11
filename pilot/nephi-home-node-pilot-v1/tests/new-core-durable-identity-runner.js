'use strict';
const fs=require('fs'),assert=require('assert/strict');
const app=require('node:path').resolve(__dirname,'..');
const {executeNewCoreTurn}=require(app+'/lib/new-core/application-service');
const {callOpenAIUnderstandingV1}=require(app+'/lib/providers/openai-understanding-v1');
const {createConversationStateV3}=require(app+'/lib/conversation-contracts/conversation-state-v3');
const NOW='2026-09-11T06:00:00.000Z', FUTURE='2026-09-12T06:00:00.000Z';
const scope={propertyId:'audit-property',channel:'isolated',userId:'audit-guest'};
const property={propertyId:scope.propertyId,displayName:'Audit fixture',timezone:'Asia/Taipei',rooms:[{id:'room-a',displayName:'Room A',type:'four_person',enabled:true,aliases:[]},{id:'room-b',displayName:'Room B',type:'four_person',enabled:true,aliases:[]},{id:'bundle-a',displayName:'Bundle A',inventoryType:'bundle',memberRoomIds:['room-a','room-b'],enabled:true,aliases:[]}],commonAnswers:{},businessProfile:{},propertyFacts:[{canonicalId:'policy-a',category:'policy',publicName:'Policy A',status:'allowed',publicText:'Fixture policy A'},{canonicalId:'policy-b',category:'policy',publicName:'Policy B',status:'allowed',publicText:'Fixture policy B'}]};
let serial=0;
function empty(s=scope){return createConversationStateV3({...s,tasks:[],createdAt:NOW,updatedAt:NOW,expiresAt:FUTURE});}
function question(id,identity,capability='policy',kind='policy'){return {id,capability,kind,identity};}
async function runTurn(specs,prior=empty(),history=[],turnScope=scope){
 const turnId='audit-turn-'+(++serial), events=specs.map((s,i)=>({eventId:turnId+'-'+i,messageRef:turnId+'-'+i,role:'guest',timestamp:NOW,messageKind:'text',messageText:s.text||'Synthetic source '+i}));let calls=0;const diagnostics=[];
 const result=await executeNewCoreTurn({scope:turnScope,property:{...property,propertyId:turnScope.propertyId},state:prior,now:NOW,publicBaseUrl:'https://example.invalid',input:{turnId,traceId:turnId,message:events.map(e=>e.messageText).join(' '),sourceEvents:events,recentConversation:history},providerConfig:{apiKey:'synthetic-no-network'},resolver:{availability:()=>{throw Error('UNEXPECTED_DYNAMIC_PROVIDER');},availableDates:()=>{throw Error('UNEXPECTED_DYNAMIC_PROVIDER');},priceOverrides:()=>[],dateClassifications:()=>[],customReplies:()=>[]},onDiagnostic:d=>diagnostics.push(d),understandingProvider:(input,opts)=>callOpenAIUnderstandingV1(input,{...opts,nowMs:()=>Date.parse(NOW),fetchImpl:async()=>{
 calls++;const units=specs.map((s,i)=>{let e=events[i],ref={eventId:e.eventId,messageRef:e.messageRef,startOffset:0,endOffset:e.messageText.length,quote:e.messageText};return {unitId:s.id,evidenceRefs:[ref],purpose:s.purpose||(s.capability===null?'context_update':'lodging_question'),capability:s.capability,subject:{kind:s.kind??null,catalogIdentity:s.identity??null},stayDependent:['availability','available_dates','price','total_price','capacity'].includes(s.capability),temporalCandidate:s.temporal||null,contextLinkCandidateId:'link-'+i,safetyCandidate:null,slotCandidates:(s.slots||[]).map((x,j)=>({slotCandidateId:'slot-'+i+'-'+j,slot:x[0],operation:x[2]||'SET',value:x[1],evidenceRefs:[ref]})),confidenceBand:'high'};});
 const output={understandingOutput:{schemaVersion:1,turnId:input.turnId,units},contextLinkCandidates:units.map((u,i)=>({contextLinkCandidateId:u.contextLinkCandidateId,unitId:u.unitId,relationKind:specs[i].relation||'NEW_REQUEST',currentSourceEvidenceRefs:u.evidenceRefs,referencedHistoryEventRefs:specs[i].refs||[]}))};
 return {ok:true,status:200,headers:{get:()=> 'fixture'},text:async()=>JSON.stringify({model:'gpt-5.6-luna',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]})};}})});
 return {result,calls,diagnostics,events};
}
function h(ids,n=0){return {eventId:'history-'+n,messageRef:'history-'+n,role:'guest',timestamp:'2026-09-11T05:00:00.000Z',messageKind:'text',messageText:'Prior fixture request',referenceableCycleIds:ids};}
function ref(n=0){return {eventId:'history-'+n,messageRef:'history-'+n};}
const cases=[];
async function test(id,expected,fn){let observed,error;try{observed=await fn();}catch(e){error={message:e.message,stack:e.stack};observed=e.observed;}cases.push({id,expected,observed,error,status:error?'FAIL':'PASS',exitCode:error?1:0,classification:'FAKE_INTEGRATION'});}
function summary(x){return {calls:x.calls,earliestFailure:x.result.earliestFailure||null,tasks:x.result.state.tasks,canonicalItems:x.result.artifacts.canonicalItems,lifecycle:x.result.artifacts.lifecycleDecisions,outcomes:x.result.artifacts.outcomes,c08Diagnostics:(x.result.artifacts.outcomes||[]).map(o=>require(app+'/lib/new-core/canonical-execution-adapter').c08ExecutionDiagnosticFor(o.c08ExecutionResult)),failures:x.result.artifacts.terminalFailures,diagnostics:x.diagnostics};}
function check(x,fn){const out=summary(x);try{fn(x.result);}catch(e){e.observed=out;throw e;}return out;}
(async()=>{
await test('new-answered-cycle-collision','A new request cannot replace an answered cycle',async()=>{const a=await runTurn([question('u-1','policy-a')]);return check(await runTurn([question('u-1','policy-b')],a.result.state),r=>{assert.equal(r.state.tasks.length,2);assert.equal(r.state.tasks.find(t=>t.entityId==='policy-a').taskId,'u-1');assert.notEqual(r.state.tasks.find(t=>t.entityId==='policy-b').taskId,'u-1');});});
await test('new-answer-pending-collision','A new answer cannot replace an unrelated pending need',async()=>{const a=await runTurn([question('u-1','room-a','availability','room')]);return check(await runTurn([question('u-1','policy-a')],a.result.state),r=>{assert.equal(r.state.tasks.length,2);assert.equal(r.state.tasks.find(t=>t.productId==='room-a').taskId,'u-1');});});
await test('mixed-modify-and-new','Bound modification and new request reserve distinct durable identities',async()=>{const a=await runTurn([question('old','policy-a')]);return check(await runTurn([{...question('fresh','policy-a'),relation:'MODIFICATION',refs:[ref()]},question('old','policy-b')],a.result.state,[h(['old'])]),r=>{assert.equal(r.state.tasks.length,2);assert.equal(r.state.tasks.find(t=>t.entityId==='policy-a').taskId,'old');assert.notEqual(r.state.tasks.find(t=>t.entityId==='policy-b').taskId,'old');});});
await test('history-ref-roundtrip','Production result publishes actual created cycle refs usable by C01',async()=>{
 const {createNewCoreProductionTurnAdapter,bindProductionHistoryToCycles}=require(app+'/lib/new-core/production-turn-adapter');
 let stored=null, last;
 const adapter=createNewCoreProductionTurnAdapter({persistence:{getConversationState:()=>stored,setConversationState:(p,c,u,s)=>{stored=s;}},customerSettings:{getProperty:()=>property,listInventoryPriceOverrides:()=>[],listDatePriceClassifications:()=>[]},service:{searchAvailability:()=>{throw Error('unexpected availability')},searchAvailableDates:()=>{throw Error('unexpected dates')}},customReplies:{list:()=>[]},now:()=>new Date(NOW),executeTurn:async({state})=>{last=await runTurn([question('repeated','policy-a')],state);return last.result;}});
 const input={customerId:scope.propertyId,channelId:scope.channel,lineUserId:scope.userId,eventId:'e1',messageText:'policy query'};
 const first=await adapter.process(input);assert.equal(first.requestCycleRefs.length,1);assert.equal(first.requestCycleRefs[0],stored.tasks[0].taskId);
 const second=await adapter.process({...input,eventId:'e2'});assert.equal(second.requestCycleRefs.length,1);assert.notEqual(second.requestCycleRefs[0],first.requestCycleRefs[0]);assert(stored.tasks.some(t=>t.taskId===second.requestCycleRefs[0]));
 const bound=second.artifacts.adapted.canonicalTaskBindings.find(b=>b.unitId==='repeated');assert.equal(second.artifacts.formalRequests[0].requestCycleId,bound.requestCycleId);return {firstRefs:first.requestCycleRefs,secondRefs:second.requestCycleRefs,tasks:stored.tasks};
});
for(const c of cases) console.log(c.status+' '+c.id+(c.error?' '+c.error.message:''));
if(process.env.JUNZAN_FIX_EVIDENCE)fs.writeFileSync(process.env.JUNZAN_FIX_EVIDENCE,JSON.stringify({classification:'FAKE_INTEGRATION',cases},null,2));
process.exitCode=cases.some(c=>c.status==='FAIL')?1:0;
})();
