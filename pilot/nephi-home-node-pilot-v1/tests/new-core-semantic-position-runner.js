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
const slots=x=>x.understandingOutput.units[0].slotCandidates;
function multi(){const x=valid(); for(const [id,value] of [['one','train'],['two','bus']]) slots(x).push({slotCandidateId:id,slot:'transport',operation:'SET',value,evidenceRefs:[evidence()]}); return x;}
function failedSibling(x){x=clone(x);x.understandingOutput.units[1].stayDependent=true;return x;}
function add(name,first,second,accepted){cases.push({name,first,second,accepted});}
const base=multi();
add('multi-unchanged',failedSibling(base),base,true);
const third=multi();slots(third).push({...clone(slots(third)[1]),slotCandidateId:'three',value:'walk'});
add('multi-additive',failedSibling(base),third,true);
const removed=multi();slots(removed).pop();add('multi-deletion',failedSibling(base),removed,false);
const reordered=multi();slots(reordered).reverse();add('multi-reorder',failedSibling(base),reordered,true);
const dup=multi();slots(dup).push({...clone(slots(dup)[1]),slotCandidateId:'copy'});
add('multi-duplicate-rejected',failedSibling(base),dup,false);
const clear=multi();slots(clear).push({...clone(slots(clear)[1]),slotCandidateId:'clear',operation:'CLEAR',value:null});
add('multi-clear-conflict-rejected',failedSibling(base),clear,false);
add('single-preserved',failedSibling(valid()),valid(),true);
const competition=valid();slots(competition).push({...clone(slots(competition)[0]),slotCandidateId:'competitor',value:9});
add('single-competition-rejected',failedSibling(valid()),competition,false);
const overwrite=valid();slots(overwrite)[0].value=9;add('single-overwrite-rejected',failedSibling(valid()),overwrite,false);
add('failure-directed-correction',invalid('C03'),valid(),true);
const product=valid();slots(product).push({slotCandidateId:'product-add',slot:'product',operation:'SET',value:'room-a',evidenceRefs:[evidence()]});
add('product-addition',invalid('C05'),product,true);
const lost=valid();lost.understandingOutput.units.pop();lost.contextLinkCandidates.pop();add('sibling-missing',invalid('C05'),lost,false);
const quantity=valid();quantity.understandingOutput.units[0].quantityCandidate.requestedQuantity=3;add('quantity-overwrite',failedSibling(valid()),quantity,false);
const distinct=valid();distinct.understandingOutput.units[0].quantityCandidate.distinctRequirement='none';add('distinct-overwrite',failedSibling(valid()),distinct,false);
add('duplicate-consolidation',dup,base,true);
add('single-conflict-correction',competition,valid(),true);
add('clear-conflict-correction',clear,base,true);
const dupChanged=clone(base);slots(dupChanged)[0].value=9;add('duplicate-correction-protects-independent-position',dup,dupChanged,false);
(async()=>{const results=[];for(const c of cases){const x=await run(c.first,c.second);const actual=x.meta?.finalAcceptedAttempt===2;const pass=actual===c.accepted&&x.calls===2;results.push({name:c.name,expectedAcceptance:c.accepted,actualAcceptance:actual,pass,first:c.first,second:c.second,...x});console.log((pass?'PASS':'FAIL')+' '+c.name+' accepted='+actual+' calls='+x.calls);}
if(process.env.JUNZAN_FIX_EVIDENCE)fs.writeFileSync(process.env.JUNZAN_FIX_EVIDENCE,JSON.stringify({classification:'FAKE_INTEGRATION',results},null,2));process.exitCode=results.some(r=>!r.pass)?1:0;})();
