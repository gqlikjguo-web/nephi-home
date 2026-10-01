"use strict";
// FAKE_INTEGRATION: actual admission/core, serialized State, fixture Resolver.
const {test}=require("node:test"),assert=require("node:assert/strict");
const {turn,refs,scope,NOW}=require("./helpers/new-core-context-scenarios");
const duration=n=>({kind:"nights_only",rawText:`住${n}晚`,checkInCandidate:null,checkOutCandidate:null,nightsCandidate:n});
const date={kind:"absolute_date",rawText:"2026-10-10",checkInCandidate:"2026-10-10",checkOutCandidate:null,nightsCandidate:null};
for(const n of [2,4])test(`independent ${n} nights survive persisted State before check-in`,async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:duration(n)}]);
  assert.equal(first.result.earliestFailure,null);assert.equal(first.calls,1);
  assert.equal(first.state.tasks[0].nights,n,"independent nights must be persisted");
  assert.deepEqual(first.state.tasks[0].nightsEvidence.sourceEvidenceRefs,first.result.artifacts.outcomes[0].unit.evidenceRefs);
  const second=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"SUPPLEMENT",refs:refs(first),temporal:date}],{previous:first.state,history:first.history});
  assert.equal(second.result.earliestFailure,null);assert.equal(second.calls,1);
  const req=second.result.artifacts.formalRequests[0];
  assert.equal(req.stay.nights,n);assert.equal(req.stay.checkIn,"2026-10-10");assert.equal(req.stay.checkOut,n===2?"2026-10-12":"2026-10-14");
  assert.equal(req.canonicalRequest.temporalState.fields.nights.provenance,"context");
  assert.deepEqual(req.canonicalRequest.temporalState.fields.nights.sourceEvidenceRefs,first.state.tasks[0].nightsEvidence.sourceEvidenceRefs);
  assert.equal(second.state.tasks[0].taskId,first.state.tasks[0].taskId);
  assert.equal(second.state.tasks[0].nights,n);
});
test("explicit new duration overrides stored independent duration",async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:duration(2)}]);
  const second=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"SUPPLEMENT",refs:refs(first),
    temporal:{...date,rawText:"2026-10-10住三晚",nightsCandidate:3}}],{previous:first.state,history:first.history});
  assert.equal(second.result.earliestFailure,null);assert.equal(second.result.artifacts.formalRequests[0].stay.nights,3);
  assert.equal(second.state.tasks[0].nights,3);
});

test("duration modification while dates are missing replaces persisted value and source",async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:duration(2)}]);
  const changed=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"MODIFICATION",refs:refs(first),temporal:duration(4)}],{previous:first.state,history:first.history});
  assert.equal(changed.result.earliestFailure,null);assert.equal(changed.state.tasks[0].nights,4);
  assert.deepEqual(changed.state.tasks[0].nightsEvidence.sourceEvidenceRefs,changed.result.artifacts.outcomes[0].unit.evidenceRefs);
  const dated=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"SUPPLEMENT",refs:refs(changed),temporal:date}],{previous:changed.state,history:[...first.history,...changed.history]});
  assert.equal(dated.result.earliestFailure,null);assert.equal(dated.result.artifacts.formalRequests[0].stay.checkOut,"2026-10-14");
});

test("stored duration rejects ungrounded or contradictory metadata and retains old State compatibility",async()=>{
  const {validateConversationTaskV3,readConversationStateV3}=require("../lib/conversation-contracts/conversation-state-v3");
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:duration(2)}]);
  const task=first.state.tasks[0];
  assert.equal(validateConversationTaskV3(task).ok,true);
  assert.equal(validateConversationTaskV3({...task,nights:3}).ok,false);
  assert.equal(validateConversationTaskV3({...task,nightsEvidence:{...task.nightsEvidence,sourceEvidenceRefs:[]}}).ok,false);
  const old={...task};delete old.nights;delete old.nightsEvidence;
  assert.equal(validateConversationTaskV3(old).ok,true);
  const forgedScope={...scope,propertyId:"other-property"};
  assert.equal(readConversationStateV3(first.state,forgedScope,NOW).tasks.length,0);
  assert.equal(require("../lib/new-core/application-service").turnStateSnapshot(readConversationStateV3(first.state,scope,"2026-09-26T03:00:00.000Z"),scope,"2026-09-26T03:00:00.000Z").referenceableCycles.length,0);
});

test("grounded room-set identity survives a pending duration-only request and date supplement",async()=>{
  const first=await turn([{capability:"availability",kind:"matched_room_set",identity:null,
    text:"雙人房住兩晚，日期未定",temporal:{...duration(2),rawText:"住兩晚"}}],{transformOutput:(output,input)=>{
      const subject=input.publicSubjectCatalog.find(item=>item.kind==="matched_room_set");
      assert.ok(subject);output.understandingOutput.units[0].subject={kind:subject.kind,catalogIdentity:subject.catalogIdentity};return output;
    }});
  assert.equal(first.result.earliestFailure,null);assert.equal(first.calls,1);
  const subject=first.result.artifacts.understanding.validatedUnits[0].subject;
  assert.equal(first.state.tasks[0].entityId,subject.catalogIdentity);
  assert.equal(first.state.tasks[0].entityCategory,"matched_room_set");
  assert.equal(first.state.tasks[0].productId,null);
  const snapshot=require("../lib/new-core/application-service").turnStateSnapshot(first.state,scope,NOW);
  assert.deepEqual(snapshot.referenceableCycles[0].subject,subject);
  const second=await turn([{capability:"availability",kind:subject.kind,identity:subject.catalogIdentity,relation:"SUPPLEMENT",refs:refs(first),temporal:date}],
    {previous:first.state,history:first.history});
  assert.equal(second.result.earliestFailure,null);assert.equal(second.calls,1);
  const request=second.result.artifacts.formalRequests[0];
  assert.equal(request.stay.nights,2);assert.equal(request.stay.checkOut,"2026-10-12");
  assert.deepEqual(request.resolverTask.roomTypeSet.sort(),["room-a","room-b"]);
  assert.equal(second.state.tasks[0].entityId,subject.catalogIdentity);
});
