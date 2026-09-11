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
function rawValid(){return providerOutput({understandingOutput:{schemaVersion:1,turnId:'turn-openai-understanding-v1',units:[unit({purpose:'lodging_question',capability:'capacity',subject:{kind:'room',catalogIdentity:'room-a'},stayDependent:true,quantityCandidate:qty,slotCandidates:[guests]}),sibling]},contextLinkCandidates:[link(),link({unitId:'unit-b',contextLinkCandidateId:'link-b',currentSourceEvidenceRefs:sibling.evidenceRefs})]})}
function invalid(boundary){const a=clone(valid());if(boundary==='C02')a.understandingOutput.units[0].extra=true;
if(boundary==='C04')a.contextLinkCandidates[0].currentSourceEvidenceRefs[0].quote='WRONG';
if(boundary==='C05'){a.contextLinkCandidates[0].relationKind='MODIFICATION';a.contextLinkCandidates[0].referencedHistoryEventRefs=[{eventId:'missing-history',messageRef:'missing-message'}];}
if(boundary==='C03'){a.understandingOutput.units[0].purpose='unknown';a.understandingOutput.units[0].capability='unsupported';a.understandingOutput.units[0].stayDependent=false;}
return a;}
async function run(first,second){let calls=0,bodies=[],headers=[],diagnostics=[],result,error;try{result=await callOpenAIUnderstandingV1(c01(),{apiKey:'local-mock-only',nowMs:()=>Date.parse(NOW),retryDelayMs:0,waitImpl:async()=>{},requestIdFactory:()=>`local-request-${calls+1}`,onDiagnostic:x=>diagnostics.push(x),onOperationalDiagnostic:x=>diagnostics.push(x),fetchImpl:async(url,req)=>{bodies.push(JSON.parse(req.body));headers.push(req.headers);calls++;if(calls>2)throw Error('more-than-two-calls');return successfulResponse(calls===1?first:second,`mock-response-${calls}`);}})}catch(e){error={message:e.message,code:e.code,meta:e[D]};}return {calls,bodies,headers,diagnostics,result,error,meta:result?.[D]||error?.meta};}
function valid(){return clone(rawValid());}
const cases=[];
function addCase(name,first,second,accepted){cases.push({name,first,second,accepted});}
const addition=()=>{const x=valid();x.understandingOutput.units[0].slotCandidates.push({slotCandidateId:'opaque-new',slot:'product',operation:'SET',value:'room-a',evidenceRefs:clone(x.understandingOutput.units[0].evidenceRefs)});return x;};
addCase('A-additive-correction',invalid('C05'),addition(),true);
const gone=valid();gone.understandingOutput.units[0].slotCandidates=[];addCase('B-illegal-deletion',invalid('C05'),gone,false);
const overwrite=valid();overwrite.understandingOutput.units[0].slotCandidates[0].value=9;addCase('C-illegal-overwrite',invalid('C05'),overwrite,false);
addCase('D-valid-failure-directed-correction',invalid('C03'),valid(),true);
const siblingLost=valid();siblingLost.understandingOutput.units.pop();siblingLost.contextLinkCandidates.pop();addCase('E-sibling-deletion',invalid('C05'),siblingLost,false);
const conflict=valid();conflict.understandingOutput.units[0].slotCandidates.push({...clone(conflict.understandingOutput.units[0].slotCandidates[0]),slotCandidateId:'different-opaque-id',value:9});addCase('F-new-id-cannot-hide-conflicting-value',invalid('C05'),conflict,false);
const renamed=valid();renamed.understandingOutput.units[0].slotCandidates[0].slotCandidateId='renamed-opaque-id';addCase('G-opaque-id-not-semantic-identity',invalid('C05'),renamed,true);
const firstSibling=valid();firstSibling.understandingOutput.units[1].stayDependent=true;addCase('H-addition-to-valid-sibling',firstSibling,addition(),true);
const siblingChanged=valid();siblingChanged.understandingOutput.units[0].slotCandidates[0].value=9;addCase('I-valid-sibling-meaning-protected',firstSibling,siblingChanged,false);
const conflictSubject=valid();conflictSubject.understandingOutput.units[0].slotCandidates.push({slotCandidateId:'new-clear',slot:'product',operation:'CLEAR',value:null,evidenceRefs:clone(conflictSubject.understandingOutput.units[0].evidenceRefs)});addCase('J-addition-cannot-contradict-trusted-subject',invalid('C05'),conflictSubject,false);
(async()=>{const results=[];for(const c of cases){const x=await run(c.first,c.second);const actual=x.meta?.finalAcceptedAttempt===2;const pass=actual===c.accepted&&x.calls===2;results.push({name:c.name,expectedAcceptance:c.accepted,actualAcceptance:actual,pass,first:c.first,second:c.second,...x});console.log((pass?'PASS':'FAIL')+' '+c.name+' accepted='+actual);}
if(process.env.JUNZAN_FIX_EVIDENCE)fs.writeFileSync(process.env.JUNZAN_FIX_EVIDENCE,JSON.stringify({classification:'FAKE_INTEGRATION',results},null,2));process.exitCode=results.some(r=>!r.pass)?1:0;})();
