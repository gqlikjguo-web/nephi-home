'use strict';
// RECORDED_REPRODUCTION / FAKE_INTEGRATION / STRUCTURED_CONTRACT_TEST.
// No real OpenAI, PostgreSQL, LINE or deployment. Existing validators/executor remain real.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const app=require('../lib/new-core/application-service');
const claim=require('../lib/conversation-engine-v2/claim-validator');
const {buildResponsePlan}=require('../lib/conversation-engine-v2/response-planner');
const {composeControlledReply}=require('../lib/conversation-engine-v2/controlled-composer');
const {buildFinalResponse}=require('../lib/conversation-engine-v2/final-response-renderer');
const provider=require('../lib/providers/openai-understanding-v1');
const {createConversationStateV3}=require('../lib/conversation-contracts/conversation-state-v3');
const {run}=require('./new-core-request-responsibility-fixture');
const saved=require('./fixtures/terminal-rq3-recorded.json');
const terminalPath=require.resolve('../lib/new-core/application-service').replace('application-service.js','terminal-failure.js');
function terminal(){assert.ok(fs.existsSync(terminalPath),'TERMINAL_FAILURE_CONTRACT_MISSING');return require(terminalPath)}
const scope={propertyId:'terminal-property',channel:'offline',userId:'offline'};
const property={propertyId:scope.propertyId};
function context(){return terminal().createTerminalContext({propertyId:scope.propertyId,turnId:'turn'})}
const evidence=id=>({taskId:id,requestPresence:'PRESENT',activeRequest:true,replyPermission:'ALLOWED',humanActionRequired:false,humanJudgmentRequired:false,resolverUnresolvedRequiresHuman:false,existingOperatorResponsibility:false});
const fact=(id='answer',source=true)=>({taskId:id,type:'amenity',status:'answered',facts:{answer:'正式可回答內容',...(source?{source:'property_catalog'}:{})}});
function finish(tasks,ctx=context(),overrides={}){
 assert.equal(typeof app.finalizeTurnResponse,'function','TERMINAL_FINALIZER_MISSING');
 return app.finalizeTurnResponse({scope,turnId:'turn',property,terminalContext:ctx,requestEvidence:tasks.map(t=>evidence(t.taskId)),executionOutcomes:tasks.map(t=>({taskId:t.taskId,type:t.type,outcome:t.status==='needs_human'?'unknown':t.status==='needs_clarification'?'not_ready':'answered',reason:t.status==='needs_human'?'human_help':'',facts:t.facts,missingFields:t.missingInputs||[]})),taskResults:tasks,canonicalItems:[],publicAvailabilityUrl:'',...overrides});
}
async function recorded(){
 let calls=0;const source=saved.c01.sourceEvents;const cscope={propertyId:saved.property.propertyId,channel:'offline-recorded',userId:'offline-recorded'};
 const now=source[0].timestamp;const state=createConversationStateV3({...cscope,tasks:[],createdAt:now,updatedAt:now,expiresAt:'2026-09-11T00:00:00.000Z'});
 const result=await app.executeNewCoreTurn({scope:cscope,state,property:saved.property,now,input:{turnId:saved.c01.turnId,traceId:'recorded-terminal',message:source.map(x=>x.messageText).join(''),sourceEvents:source,recentConversation:[]},providerConfig:{apiKey:'fixture-only'},publicBaseUrl:'https://example.invalid',resolver:{availability:()=>{throw Error('UNTRUSTED_REQUEST_EXECUTED')},availableDates:()=>{throw Error('UNTRUSTED_REQUEST_EXECUTED')},priceOverrides:()=>[],dateClassifications:()=>[],customReplies:()=>[]},understandingProvider:(input,options)=>provider.callOpenAIUnderstandingV1(input,{...options,fetchImpl:async()=>{assert.ok(calls<2,'THIRD_CALL');const output=saved.outputs[calls++];return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({model:'gpt-5.6-luna',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]})};}})});
 return {result,calls};
}
test('R1 recorded rejected correction stays untrusted but receives a scoped processing status',async()=>{
 const {result:r,calls}=await recorded();assert.equal(calls,2);assert.equal(r.artifacts.canonicalItems.length,0);assert.equal(r.artifacts.executionOutcomes.length,0);
 assert.equal(r.artifacts.understanding.failedUnits[0].failureCode,'UNIT_MEANING_UNSUPPORTED');
 assert.equal(r.finalResponse.shouldReply,true,'REJECTED_CORRECTION_SILENTLY_DROPPED');
 assert.equal(r.artifacts.requestEvidence[0].requestPresence,'UNDETERMINED');
 assert.equal(r.artifacts.terminalFailures[0].kind,'CORRECTION_REJECTED');assert.equal(r.finalDecision.reviewRequired,false);
 assert.ok(!r.state.tasks.length,'NOTICE_MUST_NOT_CREATE_BUSINESS_TASK');
});
test('R2 validated statements are ABSENT, no notification',async()=>{const {result:r}=await run(['NO_REPLY'],{withSlot:true});assert.equal(r.finalResponse.shouldReply,false);assert.equal(r.artifacts.requestEvidence[0].requestPresence,'ABSENT')});
test('R3 suppressed or policy-undetermined failure cannot silence an allowed answer',()=>{const ctx=context();ctx.fromException(new Error('fixture'), 'failed');const r=finish([fact()],ctx,{property:{...property,availabilityAutoReplyEnabled:false}});assert.equal(r.finalResponse.replyText,'正式可回答內容');assert.equal(r.finalDecision.reviewRequired,false);assert.ok(r.terminalFailures.length)});
test('R4 processing failure has distinct provenance, unknown still requires Resolver authority',async()=>{const ctx=context();ctx.fromException(new Error('query failed'),'failed');const r=finish([],ctx);assert.equal(r.responsePlan.sections[0].claimType,'PROCESSING_STATUS');assert.equal(r.finalResponse.shouldReply,true);assert.equal(r.responsePlan.sections[0].unknownProvenance,undefined);const {result:u}=await run(['ANSWER'],{unknownFacts:true});assert.ok(u.finalResponse.replyText.includes('目前無法確認'));assert.equal(u.finalDecision.reviewRequired,false)});
test('R5 code-only exception evidence and forged status provenance are rejected',()=>{assert.throws(()=>context().fromException({code:'FAIL'},'bad'));const task={...fact(),claimType:'PROCESSING_STATUS',terminalFailure:{kind:'EXECUTION_TECHNICAL',code:'FAIL'}};const plan=buildResponsePlan({propertyId:scope.propertyId,turnId:'turn',taskResults:[task],inputTaskIds:[task.taskId]});assert.equal(claim.validateClaims(composeControlledReply(plan),plan,[task.taskId]).ok,false)});
test('R6 status provenance cannot be deleted, cloned or moved across property turn or scope',()=>{const ctx=context();ctx.fromException(new Error('failure'),'failed');const r=finish([],ctx);const section=r.responsePlan.sections[0];for(const mode of ['absent','clone','property','turn','scope']){const plan={...r.responsePlan,sections:[{...section}]};if(mode==='absent')delete plan.sections[0].terminalFailure;if(mode==='clone')plan.sections[0].terminalFailure={...section.terminalFailure};if(mode==='property')plan.propertyId='another';if(mode==='turn')plan.turnId='another';if(mode==='scope')plan.sections[0].taskId='another';assert.equal(claim.validateClaims(composeControlledReply(plan),plan,plan.sections.map(s=>s.taskId)).ok,false,mode)}});
test('R7 mixed answer plus processing failure preserves both without human responsibility',()=>{const ctx=context();ctx.fromException(new Error('failed'),'failed');const r=finish([fact()],ctx);assert.ok(r.finalResponse.replyText.includes('正式可回答內容'));assert.equal(r.responsePlan.sections.length,2);assert.equal(r.finalDecision.reviewRequired,false)});
test('R8 legitimate human responsibility survives processing status',()=>{const ctx=context();ctx.fromException(new Error('failed'),'failed');const tasks=[fact(),{taskId:'human',type:'human_help',status:'needs_human',facts:{}}];const r=finish(tasks,ctx,{requestEvidence:[evidence('answer'),{...evidence('human'),humanActionRequired:true}]});assert.equal(r.finalDecision.reviewRequired,true);assert.ok(r.finalResponse.replyText.includes('正式可回答內容'));assert.ok(r.finalResponse.replyText.includes('業者確認'));assert.ok(r.finalResponse.replyText.includes('未能'))});
test('R9 local claim rejection rebuilds only once and retains independent answer',()=>{const r=finish([fact(),fact('bad',false)]);assert.equal(r.rebuildCount,1);assert.ok(r.finalResponse.replyText.includes('正式可回答內容'));assert.equal(r.responsePlan.sections[1].claimType,'PROCESSING_STATUS');assert.equal(r.claimValidation.ok,true)});
test('R10 global failure cannot masquerade as a safe local section',()=>{const r=finish([fact()],context(),{maxLength:2});assert.equal(r.finalResponse.shouldReply,false);assert.equal(r.rebuildCount,1);assert.equal(r.finalDecision.reasonCode,'terminal_safety_blocked');assert.notEqual(r.finalDecision.reasonCode,'no_actionable_requests')});
test('R11 links are validated as part of the actual final response, tampering fails delivery attestation',()=>{const r=finish([{taskId:'link',type:'availability',status:'answered',facts:{source:'availability_resolver',checkIn:'2026-09-29',availableInventory:[]}}],context(),{publicAvailabilityUrl:'https://example.invalid/availability'});assert.ok(r.finalResponse.replyText.includes('查房連結'));assert.equal(typeof claim.isValidatedFinalResponse,'function');assert.equal(claim.isValidatedFinalResponse(r.finalResponse),true);assert.equal(claim.isValidatedFinalResponse({...r.finalResponse,replyText:r.finalResponse.replyText+'追加內容'}),false);assert.equal(r.claimValidation.validatedText,r.finalResponse.replyText)});
test('R12 unknown provenance remains mandatory and factual sources are not relaxed',()=>{const r=finish([{...fact(),claimType:'EPISTEMIC_UNKNOWN',unknownProvenance:null}]);assert.equal(r.rebuildCount,1);assert.equal(r.responsePlan.sections[0].claimType,'PROCESSING_STATUS');assert.ok(r.initialClaimValidation.errors.includes('invalid_unknown_provenance'))});
test('R13 adapter exception uses the same non-human terminal path and never writes state',async()=>{
 const {createNewCoreProductionTurnAdapter}=require('../lib/new-core/production-turn-adapter');let writes=0;
 const adapter=createNewCoreProductionTurnAdapter({persistence:{getConversationState:()=>null,setConversationState:()=>{writes++}},customerSettings:{getProperty:()=>property,listInventoryPriceOverrides:()=>[],listDatePriceClassifications:()=>[]},service:{searchAvailability:()=>{},searchAvailableDates:()=>{}},customReplies:{list:()=>[]},providerConfig:{apiKey:'fixture-only'},publicBaseUrl:'https://example.invalid',now:()=>new Date('2026-09-10T00:00:00Z'),executeTurn:async()=>{throw Error('fixture exception')}});
 const r=await adapter.process({customerId:scope.propertyId,channelId:'offline',lineUserId:'offline',eventId:'turn',messageText:'recorded input'});assert.equal(r.finalDecision.action,'reply','EXCEPTION_GENERIC_HANDOFF');assert.equal(r.finalDecision.reviewRequired,false);assert.equal(writes,0);assert.equal(claim.isValidatedFinalResponse(r.finalResponse),true);
});
