'use strict';
const fs=require('node:fs'), assert=require('node:assert/strict');
const A=require('node:path').resolve(__dirname,'..');
const {executeNewCoreTurn: actualExecute}=require(A+'/lib/new-core/application-service');
const {createNewCoreProductionTurnAdapter}=require(A+'/lib/new-core/production-turn-adapter');
async function executeNewCoreTurn(args) {
let written=false; const diagnostics=[];
const adapter=createNewCoreProductionTurnAdapter({persistence:{getConversationState:()=>args.state,setConversationState:()=>{written=true}},customerSettings:{getProperty:()=>args.property,listInventoryPriceOverrides:args.resolver.priceOverrides,listDatePriceClassifications:args.resolver.dateClassifications},service:{searchAvailability:args.resolver.availability,searchAvailableDates:args.resolver.availableDates},customReplies:{list:args.resolver.customReplies},providerConfig:args.providerConfig,publicBaseUrl:args.publicBaseUrl,now:()=>new Date(args.now),onDiagnostic:x=>diagnostics.push(x),executeTurn:x=>actualExecute({...x,understandingProvider:args.understandingProvider})});
const result=await adapter.process({customerId:args.scope.propertyId,channelId:args.scope.channel,lineUserId:args.scope.userId,eventId:args.input.turnId,messageText:args.input.message,sourceEvents:args.input.sourceEvents});
result.audit={written,diagnostics}; return result;
}
const {callOpenAIUnderstandingV1}=require(A+'/lib/providers/openai-understanding-v1');
const {createConversationStateV3}=require(A+'/lib/conversation-contracts/conversation-state-v3');
const {canonicalExecutionProvenanceFor}=require(A+'/lib/conversation-engine-v2/capability-executor');
const now='2026-09-11T06:00:00.000Z',scope={propertyId:'audit-property',channel:'isolated',userId:'audit-user'};
async function run(spec){
const events=spec.units.map((kind,i)=>({eventId:'event-'+i,messageRef:'event-'+i,role:'guest',timestamp:now,messageKind:'text',messageText:({N:'好的謝謝',A:'退房時間？',U:'入住時間？',C:'有空房嗎？',H:'請幫我修改預訂'})[kind]}));
const property={propertyId:scope.propertyId,displayName:'Audit fixture',rooms:[],commonAnswers:{checkOutTime:'退房為上午十一點'},businessProfile:{},propertyFacts:[],availabilityAutoReplyEnabled:!spec.suppressed};
const rule={propertyId:scope.propertyId,ruleId:'r1',name:'Audit',topic:'checkin_checkout',scope:'all',enabled:true,effectiveStartDate:'2026-01-01',effectiveEndDate:'2026-12-31',approvedReply:'業者公告內容'};
const reads=[];let calls=0;
const resolver={availability:()=>{throw Error('Unexpected dynamic resolver')},availableDates:()=>{throw Error('Unexpected dynamic resolver')},priceOverrides:()=>{reads.push('priceOverrides');if(spec.fault==='priceOverrides')throw Error('AUX_PRICE_READ_FAILED');return []},dateClassifications:()=>{reads.push('dateClassifications');if(spec.fault==='dateClassifications')throw Error('AUX_DATE_READ_FAILED');return []},customReplies:()=>{reads.push('customReplies');if(spec.fault==='customReplies')throw Error('AUX_RULE_READ_FAILED');return spec.rule==='match'?[rule]:spec.rule==='ambiguous'?[rule,{...rule,ruleId:'r2',scope:'room_only'},{...rule,ruleId:'r3'}]:spec.rule==='foreign'?[{...rule,propertyId:'other-property'}]:[]}};
try {
const r=await executeNewCoreTurn({scope,property,now,publicBaseUrl:'https://example.invalid',state:createConversationStateV3({...scope,tasks:[],createdAt:now,updatedAt:now,expiresAt:'2026-09-12T06:00:00.000Z'}),input:{turnId:spec.id,traceId:spec.id,message:events.map(x=>x.messageText).join('\n'),sourceEvents:events,recentConversation:[]},resolver,providerConfig:{apiKey:'fixture-only'},understandingProvider:(input,options)=>callOpenAIUnderstandingV1(input,{...options,nowMs:()=>Date.parse(now),fetchImpl:async()=>{calls++;
const units=spec.units.map((kind,i)=>{const event=input.sourceEvents[i],ref={eventId:event.eventId,messageRef:event.messageRef,startOffset:0,endOffset:event.messageText.length,quote:event.messageText};return {unitId:'unit-'+i,evidenceRefs:[ref],purpose:kind==='N'?'acknowledgement':kind==='H'?'operator_request':'lodging_question',capability:kind==='N'?null:kind==='H'?'booking_operator_request':kind==='C'?'availability':'policy',subject:kind==='N'?{kind:null,catalogIdentity:null}:kind==='H'?{kind:'other_verified',catalogIdentity:null}:kind==='C'?{kind:'property',catalogIdentity:null}:{kind:'policy',catalogIdentity:kind==='A'?'check_out':'check_in'},stayDependent:kind==='C',temporalCandidate:null,contextLinkCandidateId:'link-'+i,safetyCandidate:kind==='H'?{operatorActionClass:'special_arrangement',riskClass:null}:null,slotCandidates:[],confidenceBand:'high'}});
const out={understandingOutput:{schemaVersion:1,turnId:input.turnId,units},contextLinkCandidates:units.map(u=>({contextLinkCandidateId:u.contextLinkCandidateId,unitId:u.unitId,relationKind:u.capability===null?'NONE':'NEW_REQUEST',currentSourceEvidenceRefs:u.evidenceRefs,referencedHistoryEventRefs:[]}))};return {ok:true,status:200,headers:{get:()=> 'fixture'},text:async()=>JSON.stringify({model:'gpt-5.6-luna',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(out)}]}]})};}})});
assert.equal(calls,1,'understanding fixture must require no correction');
return {spec,calls,reads,earliestFailure:r.earliestFailure,audit:r.audit,classification:'FAKE_INTEGRATION',outcomes:(r.artifacts?.executionOutcomes||[]).map(o=>({...o,hasProvenance:!!canonicalExecutionProvenanceFor(o)})),routing:r.routing,decision:r.finalDecision,response:r.finalResponse,initialValidation:r.artifacts?.initialClaimValidation,validation:r.artifacts?.claimValidation,rebuildCount:r.artifacts?.rebuildCount,plan:r.artifacts?.responsePlan,state:r.state};
}catch(e){return {spec,calls,reads,error:e.message,stack:e.stack,classification:'FAKE_INTEGRATION'}}}
const specs=[{id:'A-A',units:['A','A']},{id:'A-C',units:['A','C']},{id:'A-U',units:['A','U']},{id:'A-H',units:['A','H']},{id:'A-C-H',units:['A','C','H']},{id:'U-matching-rule',units:['U'],rule:'match'},{id:'A-U-matching-rule',units:['A','U'],rule:'match'},{id:'ambiguous-rule',units:['A'],rule:'ambiguous'},{id:'foreign-rule-control',units:['U'],rule:'foreign'}];
(async()=>{const rows=[];for(const spec of specs){const r=await run(spec);let problem;
try{assert.equal(r.error,undefined);assert.equal(r.validation?.ok,true);assert.equal(r.rebuildCount,0);
if(spec.units.includes('C'))assert.ok(r.response.replyText.includes('查房連結：'),'visible clarification reference missing');
if(spec.units.includes('H')){assert.equal(r.decision.reviewRequired,true);assert.ok(r.response.replyText.includes('請稍後，將盡快回覆您。'));assert.equal(r.decision.action,spec.units.includes('C')?'clarification':spec.units.includes('A')?'reply':'handoff');}
for(const o of r.outcomes.filter(x=>x.outcome==='unknown'&&x.reason!=='human_help'))assert.equal(o.hasProvenance,true);
}catch(e){problem=e.message;}rows.push({...r,pass:!problem,problem});console.log((problem?'FAIL ':'PASS ')+spec.id+(problem?' '+problem:''));}
if(process.env.JUNZAN_FIX_EVIDENCE)fs.writeFileSync(process.env.JUNZAN_FIX_EVIDENCE,JSON.stringify({classification:'FAKE_INTEGRATION',rows},null,2));process.exitCode=rows.some(x=>!x.pass)?1:0;})();
