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

// FAKE_INTEGRATION: existing provider admission; no real model or facts.
const qty={requestedQuantity:2,distinctRequirement:'distinct_entities',evidenceRefs:[evidence()]};
const guests={slotCandidateId:'guests',slot:'guest_count',operation:'SET',value:4,evidenceRefs:[evidence()]};
function envelope(u){return providerOutput({understandingOutput:{schemaVersion:1,turnId:'turn-openai-understanding-v1',units:[u]}})}
function rejected(){return unit({purpose:'unknown',capability:'unsupported',subject:{kind:'room',catalogIdentity:'room-a'},quantityCandidate:qty,slotCandidates:[guests]})}
function corrected(){return {...rejected(),purpose:'lodging_question',capability:'capacity',stayDependent:true}}
function ledger(x){const content=x.bodies[1].input.at(-1).content[0].text;return JSON.parse(content.slice(content.indexOf('\n')+1)).failures[0].fieldValidationState}
test('P1 fully validated independent guest field is preserved',async()=>{const x=await run(envelope(rejected()),envelope(corrected()));assert.equal(x.meta.finalAcceptedAttempt,2);const f=ledger(x).find(f=>f.slotCandidateId==='guests');assert.equal(f.preservation,'PRESERVE');assert.deepEqual(f.validationPending,[])});
test('P2 partial quantity is not fully trusted',async()=>{const x=await run(envelope(rejected()),envelope(corrected()));const f=ledger(x).find(f=>f.field==='quantityCandidate');assert.equal(f.preservation,'REVALIDATE');assert.ok(f.validationCompleted.includes('evidenceOwnership'));assert.ok(f.validationPending.includes('quantitySubjectAdmission'))});
test('P3/P7 dependent quantity may change after same formal validation',async()=>{const good=corrected();good.quantityCandidate={...qty,requestedQuantity:3};const x=await run(envelope(rejected()),envelope(good));assert.equal(x.meta.finalAcceptedAttempt,2);assert.ok(ledger(x).find(f=>f.field==='quantityCandidate').dependsOn.includes('subject.kind'))});
test('P6 removal or change of trusted field rejects adoption',async()=>{for(const slots of [[],[{...guests,value:5}]]){const good={...corrected(),slotCandidates:slots};const x=await run(envelope(rejected()),envelope(good));assert.equal(x.calls,2);assert.notEqual(x.meta.finalAcceptedAttempt,2)}});
test('owned partial quantity cannot silently disappear',async()=>{const x=await run(envelope(rejected()),envelope({...corrected(),quantityCandidate:null}));assert.equal(x.calls,2);assert.notEqual(x.meta.finalAcceptedAttempt,2);assert.equal(x.meta.attempts[1].validationResult.adoptionFailure,'CORRECTION_FIELD_NOT_PRESERVED')});
test('P5 failed unit id remains required',async()=>{const good={...corrected(),unitId:'replacement'};const second=envelope(good);second.contextLinkCandidates[0].unitId='replacement';const x=await run(envelope(rejected()),second);assert.notEqual(x.meta.finalAcceptedAttempt,2)});
