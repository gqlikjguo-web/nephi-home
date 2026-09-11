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
      messageText: "Room A 2間4人，謝謝"
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
    endOffset: 11,
    quote: "Room A 2間4人",
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



const fs=require('node:fs');
const clone=x=>JSON.parse(JSON.stringify(x));
const qty={requestedQuantity:2,distinctRequirement:'distinct_entities',evidenceRefs:[evidence()]};
const guests={slotCandidateId:'guests',slot:'guest_count',operation:'SET',value:4,evidenceRefs:[evidence()]};
const sibling=unit({unitId:'unit-b',contextLinkCandidateId:'link-b',evidenceRefs:[evidence({startOffset:12,endOffset:14,quote:'謝謝'})]});
function valid(){return providerOutput({understandingOutput:{schemaVersion:1,turnId:'turn-openai-understanding-v1',units:[unit({purpose:'lodging_question',capability:'capacity',subject:{kind:'room',catalogIdentity:'room-a'},stayDependent:true,quantityCandidate:qty,slotCandidates:[guests]}),sibling]},contextLinkCandidates:[link(),link({unitId:'unit-b',contextLinkCandidateId:'link-b',currentSourceEvidenceRefs:sibling.evidenceRefs})]})}
function invalid(boundary){const a=clone(valid());if(boundary==='C02')a.understandingOutput.units[0].extra=true;
if(boundary==='C04')a.contextLinkCandidates[0].currentSourceEvidenceRefs[0].quote='WRONG';
if(boundary==='C05'){a.contextLinkCandidates[0].relationKind='MODIFICATION';a.contextLinkCandidates[0].referencedHistoryEventRefs=[{eventId:'missing-history',messageRef:'missing-message'}];}
if(boundary==='C03'){a.understandingOutput.units[0].purpose='unknown';a.understandingOutput.units[0].capability='unsupported';a.understandingOutput.units[0].stayDependent=false;}
return a;}
async function run(first,second){let calls=0,bodies=[],headers=[],diagnostics=[],result,error;try{result=await callOpenAIUnderstandingV1(c01(),{apiKey:'local-mock-only',nowMs:()=>Date.parse(NOW),retryDelayMs:0,waitImpl:async()=>{},requestIdFactory:()=>`local-request-${calls+1}`,onDiagnostic:x=>diagnostics.push(x),onOperationalDiagnostic:x=>diagnostics.push(x),fetchImpl:async(url,req)=>{bodies.push(JSON.parse(req.body));headers.push(req.headers);calls++;if(calls>2)throw Error('more-than-two-calls');return successfulResponse(calls===1?first:second,`mock-response-${calls}`);}})}catch(e){error={message:e.message,code:e.code,meta:e[D]};}return {calls,bodies,headers,diagnostics,result,error,meta:result?.[D]||error?.meta};}
const cases=[];
for(const b of ['C02','C04','C05']){
 cases.push({name:`${b}-repair-only`,boundary:b,first:invalid(b),second:valid(),expected:2});
 const remove=clone(valid());remove.understandingOutput.units[0].quantityCandidate=null;
 cases.push({name:`${b}-drop-owned-quantity`,boundary:b,first:invalid(b),second:remove,expected:'reject'});
 const mutate=clone(valid());mutate.understandingOutput.units[0].slotCandidates[0].value=9;
 cases.push({name:`${b}-mutate-owned-guests`,boundary:b,first:invalid(b),second:mutate,expected:'reject'});
 const siblingGone=clone(valid());siblingGone.understandingOutput.units.pop();siblingGone.contextLinkCandidates.pop();
 cases.push({name:`${b}-drop-valid-sibling`,boundary:b,first:invalid(b),second:siblingGone,expected:'reject'});
}
cases.push({name:'C03-mutable-repair',boundary:'C03',first:invalid('C03'),second:valid(),expected:2});
const change=clone(valid());change.understandingOutput.units[0].slotCandidates[0].value=9;
cases.push({name:'C03-owned-guests-protected',boundary:'C03',first:invalid('C03'),second:change,expected:'reject'});
const wrongTurn=clone(valid());wrongTurn.understandingOutput.turnId='other-turn';
cases.push({name:'C05-correction-wrong-turn',boundary:'C05',first:invalid('C05'),second:wrongTurn,expected:'reject'});
cases.push({name:'C05-second-still-invalid',boundary:'C05',first:invalid('C05'),second:invalid('C05'),expected:'reject'});
const crossScope=clone(valid());crossScope.understandingOutput.units[0].subject.catalogIdentity='foreign-room';
cases.push({name:'C05-correction-foreign-catalog',boundary:'C05',first:invalid('C05'),second:crossScope,expected:'reject'});
cases.push({name:'control-valid-first',boundary:null,first:valid(),second:valid(),expected:1});
(async()=>{const matrix=[];for(const c of cases){const x=await run(c.first,c.second);const firstBoundary=x.meta?.attempts?.[0]?.validationResult?.failures?.[0]?.boundary||null;const accepted=x.meta?.finalAcceptedAttempt;const scopeStable=x.bodies.length<2||JSON.stringify(x.bodies[0].input)===JSON.stringify(x.bodies[1].input.slice(0,x.bodies[0].input.length));const requestIdsUnique=new Set(x.headers.map(h=>h['X-Client-Request-Id'])).size===x.calls;const pass=c.expected==='reject'?accepted!==2:accepted===c.expected;const prerequisite=firstBoundary===c.boundary;const row={name:c.name,expected:c.expected,accepted,firstBoundary,prerequisite,calls:x.calls,scopeStable,requestIdsUnique,pass:pass&&prerequisite&&scopeStable&&requestIdsUnique&&x.calls<=2,adoptionFailure:x.meta?.attempts?.[1]?.validationResult?.adoptionFailure||null,quantity:x.result?.validatedUnits.find(u=>u.unitId==='unit-a')?.quantityCandidate,guests:x.result?.validatedUnits.find(u=>u.unitId==='unit-a')?.slotCandidates,unitIds:x.result?.validatedUnits.map(u=>u.unitId)};matrix.push(row);if(process.env.JUNZAN_FIX_EVIDENCE_DIR)fs.writeFileSync(`${process.env.JUNZAN_FIX_EVIDENCE_DIR}/${c.name}.json`,JSON.stringify({classification:'FAKE_INTEGRATION',first:c.first,second:c.second,...x},null,2));console.log(JSON.stringify(row));}if(process.env.JUNZAN_FIX_EVIDENCE_DIR)fs.writeFileSync(`${process.env.JUNZAN_FIX_EVIDENCE_DIR}/matrix.json`,JSON.stringify(matrix,null,2));console.log(JSON.stringify({cases:matrix.length,failed:matrix.filter(x=>!x.pass).length,externalCalls:0}));process.exitCode=matrix.some(x=>!x.pass)?1:0;})();
