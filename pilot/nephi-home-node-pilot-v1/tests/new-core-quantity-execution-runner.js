'use strict';
// STRUCTURED_CONTRACT_TEST + FAKE_INTEGRATION. Reuse C03/C05/C08 fixture builders;
// local Resolver test double exercises real execution and response functions, not REAL E2E.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const assert=require('node:assert/strict'),test=require('node:test');
const filename=path.join(__dirname,'new-core-canonical-adapter-runner.js');
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(__dirname);
const source=fs.readFileSync(filename,'utf8');
m._compile(source.slice(0,source.indexOf('// AC-CAN-001'))+'\nmodule.exports={pipeline,createC08,execute,evidence,catalog,NOW};',filename);
const {pipeline,createC08,execute,evidence,catalog,NOW}=m.exports;
const {buildCanonicalFormalRequest,buildCanonicalQueryPlan}=require('../lib/conversation-engine-v2/formal-request');
const {executeCanonicalQueryPlans}=require('../lib/conversation-engine-v2/capability-executor');
const {buildResponsePlan}=require('../lib/conversation-engine-v2/response-planner');
const {composeControlledReply}=require('../lib/conversation-engine-v2/controlled-composer');
const {validateClaims}=require('../lib/conversation-engine-v2/claim-validator');
const {buildFinalDecision}=require('../lib/conversation-engine-v2/final-decision');
const {buildFinalResponse}=require('../lib/conversation-engine-v2/final-response-renderer');
for(const ids of [['room-a','room-b'],['room-a'],['room-a','room-a']])test('Q9/Q10 full canonical and response identity '+ids.join(','),()=>{
 const message='Products 2026/10/09-10/10';const quantityCandidate={requestedQuantity:2,distinctRequirement:'distinct_entities',evidenceRefs:[evidence(message)]};
 const p=pipeline({messageText:message,unitOverrides:{subject:{kind:'matched_room_set',catalogIdentity:'matched-four-person'},quantityCandidate}});
 const c08=createC08(p);assert.equal(c08.ok,true,c08.code);const c=execute(c08.value);assert.equal(c.ok,true,JSON.stringify(c));
 const cr=c.value.canonicalRequest;assert.deepEqual(cr.quantityCandidate,quantityCandidate);
 const property={propertyId:catalog.propertyId,timezone:'Asia/Taipei',rooms:catalog.rooms.map(r=>({id:r.canonicalId,name:r.publicName}))};
 const formal=buildCanonicalFormalRequest({property,canonicalRequest:cr,requestCycleId:cr.taskId});assert.equal(formal.readiness.status,'ready');
 const outcomes=executeCanonicalQueryPlans({property,catalog,queryPlans:[buildCanonicalQueryPlan(formal)],availabilityResolver:()=>({customerId:property.propertyId,availabilityReliable:true,rooms:ids.map(id=>({id,name:id,capacity:4})),checkIn:'2026-10-09',checkOut:'2026-10-10'}),now:NOW});
 const o=outcomes[0];assert.equal(o.matchedCount,new Set(ids).size);assert.equal(o.unresolvedRemainder,2-new Set(ids).size);
 const plan=buildResponsePlan({propertyId:property.propertyId,taskResults:[{...o,status:'answered'}],inputTaskIds:[o.taskId],canonicalRequests:[cr]});
 const text=composeControlledReply(plan);const validation=validateClaims(text,plan,[o.taskId]);assert.equal(validation.ok,true,JSON.stringify(validation));
 const decision=buildFinalDecision({executionOutcomes:outcomes,claimValidation:validation,requestEvidence:[{taskId:o.taskId,activeRequest:true}]});
 const reply=buildFinalResponse({finalDecision:decision,responsePlan:plan,validatedReplyText:text,claimValidation:validation});
 assert.equal(reply.shouldReply,true);assert.equal(reply.replyText.split('room-a').length-1,1);if(ids.includes('room-b'))assert.equal(reply.replyText.split('room-b').length-1,1);
 if(new Set(ids).size===1){assert.equal(o.fulfillmentStatus,'partial');assert.ok(reply.replyText.includes('1/2'));}
});
for (const hasQuantity of [false,true]) test('R1/R2/R3 legacy result projection quantity='+hasQuantity,()=>{
 const message='Products 2026/10/09-10/10';
 const q={requestedQuantity:2,distinctRequirement:'distinct_entities',evidenceRefs:[evidence(message)]};
 const p=pipeline({messageText:message,unitOverrides:{slotCandidates:[{slotCandidateId:'guests',slot:'guest_count',operation:'SET',value:4,evidenceRefs:[evidence(message)]}],...(hasQuantity?{quantityCandidate:q}:{})}});
 const input=createC08(p);assert.equal(input.ok,true,input.code);
 const result=execute(input.value);assert.equal(result.ok,true,JSON.stringify(result));
 const diagnostic=require('../lib/new-core/canonical-execution-adapter').c08ExecutionDiagnosticFor(result);
 assert.deepEqual(Object.keys(diagnostic.canonicalizerResult),['candidateIndex','requestCycleId','task','transition','canonicalRequest','stateInput']);
 assert.equal(Object.hasOwn(diagnostic.canonicalizerResult,'quantityCandidate'),false);
 assert.equal(result.value.stateInput.confirmedFields.guests,4);
 assert.deepEqual(result.value.canonicalRequest.evidenceRefs,p.unit.evidenceRefs);
 assert.equal(result.value.canonicalRequest.temporalState.checkIn,'2026-10-09');
 if(hasQuantity)assert.deepEqual(result.value.canonicalRequest.quantityCandidate,q);
 else assert.equal(Object.hasOwn(result.value.canonicalRequest,'quantityCandidate'),false);
});
