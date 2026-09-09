"use strict";
const assert=require('node:assert/strict'),{test}=require('node:test');
const {buildUnderstandingTurnInput}=require('../lib/new-core/turn-input-adapter');
const {callOpenAIUnderstandingV1,OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC:D}=require('../lib/providers/openai-understanding-v1');
const NOW = "2026-08-29T08:00:00.000Z";

function c01(overrides = {}) {
  return buildUnderstandingTurnInput({
    coreVersion: "new-core-v1",
    traceId: "trace-openai-understanding-v1",
    turnId: "turn-openai-understanding-v1",
    verifiedPropertyBinding: { propertyId: "property-a", channel: "line-a" },
    verifiedConversationScope: { channel: "line-a", userId: "guest-a" },
    sourceEvents: [{
      eventId: "event-a",
      messageRef: "message-a",
      role: "guest",
      timestamp: NOW,
      messageKind: "text",
      messageText: "謝謝"
    }],
    recentConversation: [{
      eventId: "history-a",
      messageRef: "history-message-a",
      role: "assistant",
      timestamp: "2026-08-29T07:59:00.000Z",
      messageKind: "text",
      messageText: "請提供日期",
      referenceableCycleIds: ["cycle-a"]
    }],
    stateV3Snapshot: {
      scope: { propertyId: "property-a", channel: "line-a", userId: "guest-a" },
      referenceableCycles: [{
        requestCycleId: "cycle-a",
        requestKind: "availability",
        capability: "availability",
        status: "active",
        expiresAt: "2026-08-30T08:00:00.000Z",
        subject: { kind: "room", catalogIdentity: "room-a" },
        missingFields: ["checkIn"],
        confirmedValues: { checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null },
        slotRefs: ["stay.checkIn"]
      }]
    },
    publicCatalog: {
      propertyId: "property-a",
      timezone: "Asia/Taipei",
      capabilityCatalog: ["availability", "property_fact"],
      publicSubjectCatalog: [
        { catalogIdentity: "property-a", kind: "property", propertyId: "property-a", publicName: "Property A" },
        { catalogIdentity: "room-a", kind: "room", propertyId: "property-a", publicName: "Room A" }
      ]
    },
    ...overrides
  });
}

function evidence(overrides = {}) {
  return {
    eventId: "event-a",
    messageRef: "message-a",
    startOffset: 0,
    endOffset: 2,
    quote: "謝謝",
    ...overrides
  };
}

function unit(overrides = {}) {
  return {
    unitId: "unit-a",
    evidenceRefs: [evidence()],
    purpose: "acknowledgement",
    capability: null,
    subject: { kind: null, catalogIdentity: null },
    stayDependent: false,
    temporalCandidate: null,
    contextLinkCandidateId: "link-a",
    safetyCandidate: null,
    slotCandidates: [],
    confidenceBand: "high",
    ...overrides
  };
}

function link(overrides = {}) {
  return {
    contextLinkCandidateId: "link-a",
    unitId: "unit-a",
    relationKind: "NONE",
    currentSourceEvidenceRefs: [evidence()],
    referencedHistoryEventRefs: [],
    ...overrides
  };
}

function providerOutput(overrides = {}) {
  return {
    understandingOutput: {
      schemaVersion: 1,
      turnId: "turn-openai-understanding-v1",
      units: [unit()]
    },
    contextLinkCandidates: [link()],
    ...overrides
  };
}

function response(status, body, requestId = "", resolvedModel = "gpt-5.6-luna") {
  let safeBody = String(body);
  if (status >= 200 && status < 300) {
    try {
      const parsed = JSON.parse(safeBody);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
        && !Object.hasOwn(parsed, "model")) {
        safeBody = JSON.stringify({ model: resolvedModel, ...parsed });
      }
    } catch { /* malformed-body tests must remain malformed */ }
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === "x-request-id" ? requestId : null },
    text: async () => safeBody
  };
}

function structuredResponse(value = providerOutput(), status = "completed", requestId = "req-understanding-a", resolvedModel = "gpt-5.6-luna") {
  return response(200, JSON.stringify({
    model: resolvedModel,
    status,
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(value) }]
    }]
  }), requestId);
}

function successfulResponse(value = providerOutput(), requestId = "req-understanding-a") {
  return structuredResponse(value, "completed", requestId);
}


const clone=x=>JSON.parse(JSON.stringify(x));
async function run(first,second=providerOutput(),extra={}){let calls=0,bodies=[],diagnostics=[];let result,error;
try{result=await callOpenAIUnderstandingV1(c01(),{apiKey:'test-credential',nowMs:()=>Date.parse(NOW),retryDelayMs:0,waitImpl:async()=>{},onDiagnostic:x=>diagnostics.push(x),onOperationalDiagnostic:x=>diagnostics.push(x),fetchImpl:async(url,req)=>{bodies.push(JSON.parse(req.body));const v=++calls===1?first:second;if(v instanceof Error)throw v;return typeof v==='function'?v():successfulResponse(v)},...extra})}catch(e){error=e}
return {calls,bodies,result,error,diagnostics,meta:(result||error)?.[D]};}
test('normal PASS is one call',async()=>{const x=await run(providerOutput());assert.equal(x.calls,1);assert.equal(x.result.validatedUnits.length,1)});
for(const kind of ['C02','C04','C03','C05'])test(kind+' corrects through same admission',async()=>{let bad=clone(providerOutput());
if(kind==='C02')bad.understandingOutput.turnId='wrong';
if(kind==='C04')bad.understandingOutput.units[0].evidenceRefs[0].quote='不存在';
if(kind==='C03')bad.understandingOutput.units[0].stayDependent=true;
if(kind==='C05'){bad.contextLinkCandidates[0].relationKind='MODIFICATION';bad.contextLinkCandidates[0].referencedHistoryEventRefs=[{eventId:'invented',messageRef:'invented'}];}
const x=await run(bad);assert.equal(x.calls,2);assert.equal(x.result?.validatedUnits.length,1);assert.equal(x.meta.finalAcceptedAttempt,2);assert.equal(x.meta.attempts[1].triggerFailure[0].boundary,kind);assert.equal(x.meta.totalUnderstandingCalls,2);assert.deepEqual(x.bodies[0].text,x.bodies[1].text);assert.ok(JSON.stringify(x.bodies[1]).includes('correction'));assert.ok(!JSON.stringify(x.meta).includes('test-credential'));
});
test('second invalid terminates at two',async()=>{const bad=clone(providerOutput());bad.extra=true;const x=await run(bad,bad);assert.equal(x.calls,2);assert.ok(x.error)});
test('second timeout terminates at two',async()=>{const bad=clone(providerOutput());bad.extra=true;const e=Object.assign(new Error('private timeout'),{name:'AbortError'});const x=await run(bad,e);assert.equal(x.calls,2);assert.ok(x.error);assert.equal(x.meta.totalUnderstandingCalls,2)});
for(const status of [401,429,500])test('HTTP '+status+' never corrects',async()=>{const x=await run(()=>response(status,'{}'));assert.equal(x.calls,1);assert.ok(x.error)});
test('network never corrects',async()=>{const x=await run(new Error('network private'));assert.equal(x.calls,1);assert.ok(x.error)});
test('legal silent omission remains one call',async()=>{const x=await run(providerOutput({understandingOutput:{schemaVersion:1,turnId:'turn-openai-understanding-v1',units:[]},contextLinkCandidates:[]}));assert.equal(x.calls,1);assert.ok(x.result)});
test('correction cannot remove valid sibling; keep first partial',async()=>{const good=unit(),bad=unit({unitId:'unit-b',contextLinkCandidateId:'link-b',stayDependent:true});const first=providerOutput({understandingOutput:{schemaVersion:1,turnId:'turn-openai-understanding-v1',units:[good,bad]},contextLinkCandidates:[link(),link({unitId:'unit-b',contextLinkCandidateId:'link-b'})]});const second=providerOutput({understandingOutput:{schemaVersion:1,turnId:'turn-openai-understanding-v1',units:[unit({unitId:'unit-b',contextLinkCandidateId:'link-b'})]},contextLinkCandidates:[link({unitId:'unit-b',contextLinkCandidateId:'link-b'})]});const x=await run(first,second);assert.equal(x.calls,2);assert.deepEqual(x.result.validatedUnits.map(u=>u.unitId),['unit-a']);assert.equal(x.meta.finalAcceptedAttempt,1);assert.equal(x.result.failedUnits.length,1)});
test('trace failure cannot change reply admission',async()=>{const x=await run(providerOutput(),providerOutput(),{onDiagnostic:()=>{throw Error('trace failed')}});assert.equal(x.calls,1);assert.equal(x.result.validatedUnits.length,1)});
const {executeNewCoreTurn}=require('../lib/new-core/application-service');
const {formatNewCoreProductionTrace}=require('../lib/new-core/production-safe-trace');
for(const scenario of [
 {id:'unknown',message:'有停車嗎？',purpose:'lodging_question',capability:'amenity',subject:{kind:'amenity',catalogIdentity:'parking'},action:'reply'},
 {id:'no_reply',message:'我們已經到家了',purpose:'conversational_statement',capability:null,subject:{kind:null,catalogIdentity:null},action:'no_reply'},
 {id:'operator',message:'我要訂房',purpose:'operator_request',capability:'booking_operator_request',subject:{kind:'other_verified',catalogIdentity:null},safetyCandidate:{operatorActionClass:'booking_mutation',riskClass:null},action:'handoff'}
])test('application '+scenario.id+' uses one call and existing FinalDecision',async()=>{
 let calls=0;const scope={propertyId:'property-a',channel:'line-a',userId:'guest-a'};
 const property={propertyId:'property-a',displayName:'Test',rooms:[],commonAnswers:{},businessProfile:{},propertyFacts:[{canonicalId:'parking',category:'amenity',publicName:'停車',status:'unknown',publicText:''}]};
 const turn=await executeNewCoreTurn({scope,state:require('../lib/conversation-contracts/conversation-state-v3').createConversationStateV3({...scope,tasks:[],createdAt:NOW,updatedAt:NOW,expiresAt:'2026-08-30T08:00:00.000Z'}),property,now:NOW,input:{turnId:'app-'+scenario.id,traceId:'app-'+scenario.id,message:scenario.message,recentConversation:[]},providerConfig:{apiKey:'test-only'},resolver:{availability:()=>{throw Error('unexpected availability')},availableDates:()=>{throw Error('unexpected dates')},priceOverrides:()=>[],dateClassifications:()=>[],customReplies:()=>[]},understandingProvider:(input,opts)=>callOpenAIUnderstandingV1(input,{...opts,nowMs:()=>Date.parse(NOW),fetchImpl:async()=>{calls++;const event=input.sourceEvents[0],ref={eventId:event.eventId,messageRef:event.messageRef,startOffset:0,endOffset:scenario.message.length,quote:scenario.message};const u=unit({evidenceRefs:[ref],purpose:scenario.purpose,capability:scenario.capability,subject:scenario.subject,safetyCandidate:scenario.safetyCandidate||null});return successfulResponse({understandingOutput:{schemaVersion:1,turnId:input.turnId,units:[u]},contextLinkCandidates:[link({relationKind:scenario.capability?'NEW_REQUEST':'NONE',currentSourceEvidenceRefs:[ref]})]})}})});
 assert.equal(calls,1);assert.equal(turn.finalDecision.action,scenario.action);assert.ok(turn.finalResponse);if(scenario.id==='unknown')assert.equal(turn.artifacts.executionOutcomes[0].outcome,'unknown');
});
test('safe trace retains both attempts without secret material',async()=>{const bad=clone(providerOutput());bad.extra=true;const x=await run(bad);const event=x.diagnostics.find(e=>e.stage==='new_core_understanding_attempts');const trace=formatNewCoreProductionTrace({...event,apiKey:'sk-secretprivatevalue'});assert.ok(trace);assert.equal(trace.totalUnderstandingCalls,2);assert.equal(trace.finalAcceptedAttempt,2);assert.equal(trace.attempts[0].attemptType,'initial');assert.equal(trace.attempts[1].attemptType,'correction');assert.equal(trace.attempts[1].accepted,true);assert.ok(!JSON.stringify(trace).includes('sk-secretprivatevalue'))});
test('C05 genuine missing target never corrects',async()=>{const bad=clone(providerOutput());bad.contextLinkCandidates[0].relationKind='MODIFICATION';bad.contextLinkCandidates[0].referencedHistoryEventRefs=[{eventId:'history-a',messageRef:'history-message-a'}];const x=await run(bad,providerOutput(),{nowMs:()=>Date.parse('2026-08-31T08:00:00Z')});assert.equal(x.calls,1);assert.equal(x.result.failedUnits.length,1)});
