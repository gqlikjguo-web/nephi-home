"use strict";
// RECORDED_REPRODUCTION / FAKE_INTEGRATION. Fixed Understanding outputs,
// real admission/Context/Resolver code; no real OpenAI, database or LINE.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { turn, refs, dateRange, NOW } = require("./helpers/new-core-context-scenarios");
const { OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC: DIAGNOSTIC } = require("../lib/providers/openai-understanding-v1");

async function lodgingHistory() {
  const one = await turn([{capability:"availability",kind:"room",identity:"room-a",
    text:"10/14兩個人住雙人房",temporal:{kind:"month_day",rawText:"10/14",checkInCandidate:null,checkOutCandidate:null,nightsCandidate:null},
    slots:[["guest_count",2]]}]);
  const two = await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"MODIFICATION",refs:refs(one),
    text:"需要住兩晚",temporal:{kind:"nights_only",rawText:"兩晚",checkInCandidate:null,checkOutCandidate:null,nightsCandidate:2}}],
    {previous:one.state,history:one.history});
  const four = await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"MODIFICATION",refs:refs(two),
    text:"改住四晚好了",temporal:{kind:"nights_only",rawText:"四晚",checkInCandidate:null,checkOutCandidate:null,nightsCandidate:4}}],
    {previous:two.state,history:[...one.history,...two.history]});
  assert.equal(four.result.earliestFailure,null);
  assert.equal(four.state.tasks[0].checkIn,"2026-10-14");
  assert.equal(four.state.tasks[0].checkOut,"2026-10-18");
  return {...four,history:[...one.history,...two.history,...four.history]};
}
function changedProductAndPrice(output, input, previousRefs) {
  const price=output.understandingOutput.units[0], evidence=price.evidenceRefs;
  const source={...structuredClone(price),unitId:"updated-lodging",contextLinkCandidateId:"updated-lodging-link",
    capability:"availability",slotCandidates:[{slotCandidateId:"new-product",slot:"product",operation:"SET",value:price.subject.catalogIdentity,evidenceRefs:structuredClone(evidence)}]};
  output.understandingOutput.units.unshift(source);
  const priceLink=output.contextLinkCandidates[0];
  Object.assign(priceLink,{relationKind:"RELATED_UNIT",referencedCurrentUnitId:source.unitId,referencedHistoryEventRefs:[]});
  output.contextLinkCandidates.unshift({contextLinkCandidateId:source.contextLinkCandidateId,unitId:source.unitId,
    relationKind:"MODIFICATION",currentSourceEvidenceRefs:structuredClone(evidence),referencedHistoryEventRefs:previousRefs,
    referencedCurrentUnitId:null});
  return output;
}
function fourthTurn(prior, transformOutput) {
  return turn([{capability:"price",kind:"room",identity:"room-b",text:"那如果是四人房會是多少呢？"}],
    {previous:prior.state,history:prior.history,transformOutput});
}

test("recorded missing lodging relation is rejected, corrected once, and actually queries the changed product for four nights",async()=>{
  const prior=await lodgingHistory();let count=0;
  const next=await fourthTurn(prior,(output,input)=>++count===1?output:changedProductAndPrice(output,input,refs(prior)));
  assert.equal(next.calls,2,"missing relation evidence must not be accepted as an independent price request");
  assert.equal(next.result.earliestFailure,null);
  const attempts=next.result.artifacts.understanding[DIAGNOSTIC].attemptEvidence;
  assert.equal(attempts[0].validationResult.ok,false);
  assert.equal(attempts[0].schemaError.actual.valueType,"undefined");
  assert.equal(attempts[1].accepted,true);
  const request=next.result.artifacts.formalRequests.find(item=>item.capability==="price");
  assert.ok(request,"corrected price must actually execute, not only have plausible text");
  assert.equal(request.resolverTask.checkIn,"2026-10-14");
  assert.equal(request.resolverTask.checkOut,"2026-10-18");
  assert.equal(request.resolverTask.productId,"room-b");
  assert.equal(next.result.finalDecision.action,"reply");
  assert.equal(next.queries.length,2);
});

function independence(output,input) {
  output.contextLinkCandidates[0].independentRequestEvidence={
    currentSourceEvidenceRefs:structuredClone(output.understandingOutput.units[0].evidenceRefs),
    assessedHistoryEventRefs:input.recentConversation.map(({eventId,messageRef})=>({eventId,messageRef}))};
  return output;
}

test("a genuinely independent undated price request is admitted on attempt one without inheriting a stay",async()=>{
  const prior=await lodgingHistory();
  const next=await turn([{capability:"price",kind:"room",identity:"room-b",text:"另一趟旅行的房價，日期還沒決定"}],
    {previous:prior.state,history:prior.history,transformOutput:independence});
  assert.equal(next.calls,1);assert.equal(next.result.earliestFailure,null);assert.equal(next.queries.length,0);
  const price=next.state.tasks.find(task=>task.taskId!==prior.state.tasks[0].taskId);
  assert.ok(price);assert.equal(price.checkIn,null);assert.equal(price.checkOut,null);assert.equal(price.guestCount,null);
  assert.equal(next.result.finalDecision.action,"clarification");
});

test("valid current modification and dependent price remain one-call, independently identified queries",async()=>{
  const prior=await lodgingHistory();
  const next=await fourthTurn(prior,(output,input)=>changedProductAndPrice(output,input,refs(prior)));
  assert.equal(next.calls,1);assert.equal(next.result.earliestFailure,null);assert.equal(next.queries.length,2);
  const requests=next.result.artifacts.formalRequests;
  assert.equal(new Set(requests.map(request=>request.requestCycleId)).size,2);
  assert.ok(requests.every(request=>request.resolverTask.checkOut==="2026-10-18"));
});

test("valid RELATED_REQUEST and NONE remain admitted without independence proof",async()=>{
  const prior=await lodgingHistory();
  const related=await turn([{capability:"price",kind:"room",identity:"room-a",relation:"RELATED_REQUEST",refs:refs(prior)}],
    {previous:prior.state,history:prior.history});
  assert.equal(related.calls,1);assert.equal(related.result.earliestFailure,null);
  assert.equal(related.result.artifacts.formalRequests[0].resolverTask.checkOut,"2026-10-18");
  const unrelated=await turn([{capability:null,kind:null,identity:null,purpose:"off_topic",relation:"NONE",text:"謝謝"}],
    {previous:prior.state,history:prior.history});
  assert.equal(unrelated.calls,1);assert.equal(unrelated.result.earliestFailure,null);assert.equal(unrelated.queries.length,0);
});

for(const invalid of ["source_identity","source_quote","unassessed_history","foreign_history","duplicate_history"]){
  test(`untrusted independence evidence fails closed: ${invalid}`,async()=>{
    const prior=await lodgingHistory();
    const next=await fourthTurn(prior,(output,input)=>{
      const proof=independence(output,input).contextLinkCandidates[0].independentRequestEvidence;
      if(invalid==="source_identity")proof.currentSourceEvidenceRefs[0].eventId="foreign-event";
      if(invalid==="source_quote")proof.currentSourceEvidenceRefs[0].quote="invented independent trip";
      if(invalid==="unassessed_history")proof.assessedHistoryEventRefs.pop();
      if(invalid==="foreign_history")proof.assessedHistoryEventRefs[0].messageRef="foreign-message";
      if(invalid==="duplicate_history")proof.assessedHistoryEventRefs.push(proof.assessedHistoryEventRefs[0]);
      return output;
    });
    assert.equal(next.calls,2);assert.ok(next.result.earliestFailure);assert.equal(next.queries.length,0);
  });
}

test("missing relation on both attempts is rejected after two calls without selecting a prior cycle",async()=>{
  const prior=await lodgingHistory(),next=await fourthTurn(prior,output=>output);
  assert.equal(next.calls,2);assert.ok(next.result.earliestFailure);assert.equal(next.queries.length,0);
  assert.deepEqual(next.state.tasks,prior.state.tasks);
});

test("no available history and expired history do not create an independence obligation",async()=>{
  const prior=await lodgingHistory();
  const spec={capability:"price",kind:"room",identity:"room-b",text:"房價多少"};
  const fresh=await turn([spec]);
  const expired=await turn([spec],{previous:prior.state,history:prior.history,
    now:new Date(Date.parse(NOW)+25*3600000).toISOString()});
  for(const next of [fresh,expired]){
    assert.equal(next.calls,1);assert.equal(next.result.earliestFailure,null);assert.equal(next.queries.length,0);
  }
});

test("a complete independent dated request retains its own dates on attempt one",async()=>{
  const prior=await lodgingHistory();
  const next=await turn([{capability:"price",kind:"room",identity:"room-b",temporal:dateRange("2026-11-01","2026-11-03")}],
    {previous:prior.state,history:prior.history});
  assert.equal(next.calls,1);assert.equal(next.result.earliestFailure,null);
  assert.equal(next.result.artifacts.formalRequests[0].resolverTask.checkIn,"2026-11-01");
  assert.equal(next.result.artifacts.formalRequests[0].resolverTask.checkOut,"2026-11-03");
});

test("relation correction preserves a valid sibling and its independent dates",async()=>{
  const prior=await lodgingHistory();let count=0;
  const next=await turn([{capability:"price",kind:"room",identity:"room-b",text:"那個住宿改別的商品並詢價"},
    {capability:"availability",kind:"room",identity:"room-a",temporal:dateRange("2026-11-01","2026-11-03")}],
    {previous:prior.state,history:prior.history,transformOutput:(output,input)=>
      ++count===1?output:changedProductAndPrice(output,input,refs(prior))});
  assert.equal(next.calls,2);assert.equal(next.result.earliestFailure,null);
  const attempts=next.result.artifacts.understanding[DIAGNOSTIC].attemptEvidence;
  assert.equal(attempts[0].validationResult.failures[1].unitValidationFailed,false);
  assert.deepEqual(attempts[0].structuredOutput.understandingOutput.units[1],
    attempts[1].structuredOutput.understandingOutput.units[2]);
  const independent=next.result.artifacts.formalRequests.find(request=>request.resolverTask.checkIn==="2026-11-01");
  assert.ok(independent);assert.equal(independent.resolverTask.checkOut,"2026-11-03");
});
