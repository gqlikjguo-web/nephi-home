"use strict";
// FAKE_INTEGRATION: fixed source-bound Understanding, actual core and service
// Resolver. Does not claim REAL OpenAI, PostgreSQL, LINE, or deployed acceptance.
const {test}=require("node:test"),assert=require("node:assert/strict");
const {turn,refs,dateRange,scope,NOW}=require("./helpers/new-core-context-scenarios");
for(const [kind,identity] of [["room","room-a"],["bundle","bundle-a"]]) {
  test(`same lodging ${kind}: new price request cites availability conditions without replacing its cycle`,async()=>{
    const first=await turn([{capability:"availability",kind,identity,temporal:dateRange(),slots:[["guest_count",2]]}]);
    assert.equal(first.result.earliestFailure,null);
    assert.equal(first.result.artifacts.executionOutcomes[0].outcome,"answered");
    assert.equal(first.state.tasks.length,1);
    const before=JSON.parse(JSON.stringify(first.state.tasks[0]));
    const next=await turn([{capability:"price",kind,identity,relation:"RELATED_REQUEST",refs:refs(first),text:"What is the price for that same stay?"}],
      {previous:first.state,history:first.history,inventory:"closed"});
    console.log(JSON.stringify({classification:"FAKE_INTEGRATION",case:kind,first:{calls:first.calls,state:first.state},
      next:{calls:next.calls,c01:next.c01,earliestFailure:next.result.earliestFailure,lifecycle:next.result.artifacts.outcomes.map(o=>o.lifecycleDecision),
        requests:next.result.artifacts.formalRequests,state:next.state,diagnostics:next.diagnostics}}));
    assert.equal(next.result.earliestFailure,null,"explicit same-lodging relation is a supported contract");
    assert.equal(next.calls,1);
    const life=next.result.artifacts.outcomes[0].lifecycleDecision;
    assert.equal(life.action,"START");assert.equal(life.targetRequestCycleId,null);
    assert.equal(next.state.tasks.length,2);
    assert.deepEqual(next.state.tasks.find(t=>t.taskId===before.taskId),before,"source request is unchanged");
    const formal=next.result.artifacts.formalRequests[0];
    assert.notEqual(formal.requestCycleId,before.taskId);
    assert.equal(formal.resolverTask.checkIn,"2026-10-10");assert.equal(formal.resolverTask.checkOut,"2026-10-11");
    assert.equal(formal.resolverTask.guestCount,2);
    assert.equal(next.queries.length,1,"fresh facts come from the Resolver");
    const outcome=next.result.artifacts.executionOutcomes[0];
    assert.equal(outcome.type,"price");assert.equal(outcome.facts.availability,"full","old availability is not inherited");
    assert.equal(outcome.facts.prices[0].total,1200);
    assert.equal(next.result.artifacts.claimValidation.ok,true);
  });
}
test("same-cycle partial modification keeps validated dates when only occupancy changes",async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange(),slots:[["guest_count",2]]}]);
  assert.equal(first.result.artifacts.executionOutcomes[0].outcome,"answered");
  const next=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"MODIFICATION",refs:refs(first),
    text:"Change only our occupancy to three",slots:[["guest_count",3]]}],{previous:first.state,history:first.history});
  console.log(JSON.stringify({classification:"FAKE_INTEGRATION",case:"partial-modification",outcomes:next.result.artifacts.outcomes,
    requests:next.result.artifacts.formalRequests,earliestFailure:next.result.earliestFailure}));
  assert.equal(next.result.earliestFailure,null);
  assert.equal(next.result.artifacts.formalRequests.length,1,"readiness includes validated unchanged conditions");
  assert.equal(next.result.artifacts.formalRequests[0].resolverTask.checkIn,"2026-10-10");
  assert.equal(next.result.artifacts.formalRequests[0].resolverTask.guestCount,3);
  assert.equal(next.state.tasks.length,1);
});

for (const [kind,identity] of [["room","room-a"],["bundle","bundle-a"]]) {
  test(`clarification ${kind}: saved product and occupancy followed by missing dates`,async()=>{
    const first=await turn([{capability:"availability",kind,identity,slots:[["guest_count",2]]}]);
    assert.equal(first.state.tasks.length,1);
    assert.ok(first.state.tasks[0].missingFields.includes("checkIn"));
    const next=await turn([{capability:"availability",kind,identity,relation:"SUPPLEMENT",refs:refs(first),temporal:dateRange()}],
      {previous:first.state,history:first.history});
    assert.equal(next.result.earliestFailure,null);assert.equal(next.calls,1);
    const formal=next.result.artifacts.formalRequests[0];
    assert.equal(formal.requestCycleId,first.state.tasks[0].taskId);
    assert.equal(formal.resolverTask.productId,identity);assert.equal(formal.resolverTask.guestCount,2);
    assert.equal(formal.resolverTask.checkIn,"2026-10-10");assert.equal(next.state.tasks.length,1);
  });
}

test("date replacement retains product, occupancy and request identity",async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange(),slots:[["guest_count",2]]}]);
  const next=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"MODIFICATION",refs:refs(first),
    temporal:dateRange("2026-10-12","2026-10-14")}],{previous:first.state,history:first.history});
  assert.equal(next.result.earliestFailure,null);
  const formal=next.result.artifacts.formalRequests[0];
  assert.equal(formal.requestCycleId,first.state.tasks[0].taskId);
  assert.equal(formal.resolverTask.checkIn,"2026-10-12");assert.equal(formal.resolverTask.checkOut,"2026-10-14");
  assert.equal(formal.resolverTask.guestCount,2);assert.equal(formal.resolverTask.productId,"room-a");
});

for(const boundary of ["no_refs","unknown_ref","wrong_subject","non_lodging","expired","other_guest","other_channel","other_property","ambiguous"]) {
  test(`related request fails closed: ${boundary}`,async()=>{
    const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange()},
      ...(boundary==="ambiguous"?[{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange("2026-10-12","2026-10-13")}]:[])]);
    const nextSpec={capability:"price",kind:"room",identity:boundary==="wrong_subject"?"room-b":"room-a",
      relation:"RELATED_REQUEST",refs:boundary==="no_refs"?[]:boundary==="unknown_ref"?[{eventId:"unseen",messageRef:"unseen"}]:refs(first)};
    if(boundary==="non_lodging")Object.assign(nextSpec,{capability:"policy",kind:"policy",identity:"check_in"});
    const turnScope={...scope};
    if(boundary==="other_guest")turnScope.userId="another-guest";
    if(boundary==="other_channel")turnScope.channel="another-channel";
    if(boundary==="other_property")turnScope.propertyId="another-property";
    const next=await turn([nextSpec],{previous:first.state,history:first.history,turnScope,
      now:boundary==="expired"?new Date(Date.parse(NOW)+25*3600000).toISOString():NOW});
    assert.ok(next.result.earliestFailure,"unproven relation must not execute");
    assert.equal(next.queries.length,0);assert.equal(next.result.artifacts.formalRequests?.length||0,0);
    assert.ok(next.calls<=2,"one initial understanding plus at most one controlled correction");
  });
}

test("independent new stay never inherits prior conditions",async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange(),slots:[["guest_count",2]]}]);
  const next=await turn([{capability:"price",kind:"room",identity:"room-a",relation:"NEW_REQUEST",text:"A separate booking inquiry"}],
    {previous:first.state,history:first.history});
  assert.equal(next.result.earliestFailure,null);assert.equal(next.queries.length,0);
  const newTask=next.state.tasks.find(t=>t.taskId!==first.state.tasks[0].taskId);
  assert.equal(newTask.checkIn,null);assert.equal(newTask.guestCount,null);
});

test("unrelated topic is independent and cancellation makes the old stay unavailable",async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange()}]);
  const unrelated=await turn([{capability:null,kind:null,identity:null,purpose:"off_topic",relation:"NONE",text:"Unrelated topic"}],
    {previous:first.state,history:first.history});
  assert.equal(unrelated.result.finalResponse.shouldReply,false);assert.equal(unrelated.queries.length,0);
  const cancelled=await turn([{capability:null,kind:null,identity:null,purpose:"cancellation",relation:"TERMINATION",refs:refs(first),text:"Cancel that inquiry"}],
    {previous:unrelated.state,history:first.history});
  assert.equal(cancelled.result.earliestFailure,null);
  const next=await turn([{capability:"price",kind:"room",identity:"room-a",relation:"RELATED_REQUEST",refs:refs(first)}],
    {previous:cancelled.state,history:first.history});
  assert.ok(next.result.earliestFailure);assert.equal(next.queries.length,0);
});

test("date then explicit product modification preserves the same stay",async()=>{
  const first=await turn([{capability:"availability",kind:"property",identity:null,temporal:dateRange(),slots:[["guest_count",2]]}]);
  const next=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"MODIFICATION",refs:refs(first),
    slots:[["product","room-a"]],text:"Use Room A for that stay"}],{previous:first.state,history:first.history});
  console.log(JSON.stringify({classification:"FAKE_INTEGRATION",case:"product-modification",earliestFailure:next.result.earliestFailure,
    diagnostics:next.diagnostics,requests:next.result.artifacts.formalRequests}));
  assert.equal(next.result.earliestFailure,null);
  const formal=next.result.artifacts.formalRequests[0];
  assert.equal(formal.requestCycleId,first.state.tasks[0].taskId);assert.equal(formal.resolverTask.productId,"room-a");
  assert.equal(formal.resolverTask.checkIn,"2026-10-10");assert.equal(formal.resolverTask.guestCount,2);
});

test("related request preserves original quantity evidence without relabeling it as current evidence",async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange(),
    quantity:{requestedQuantity:2,distinctRequirement:"none"}}]);
  assert.equal(first.state.tasks[0].requestedQuantity,2);
  const next=await turn([{capability:"price",kind:"room",identity:"room-a",relation:"RELATED_REQUEST",refs:refs(first)}],
    {previous:first.state,history:first.history});
  const formal=next.result.artifacts.formalRequests[0];
  console.log(JSON.stringify({classification:"FAKE_INTEGRATION",case:"related-quantity",first:first.state,formal}));
  assert.equal(next.result.earliestFailure,null);
  assert.equal(formal.resolverTask.requestedQuantity,2);
  assert.deepEqual(formal.evidence.quantityEvidenceRefs,first.state.tasks[0].quantityEvidenceRefs);
});

test("multi-question continuation keeps each new capability bound to its cited lodging subject",async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange()},
    {capability:"availability",kind:"room",identity:"room-b",temporal:dateRange("2026-10-12","2026-10-13")}]);
  const next=await turn(["room-a","room-b"].map((identity,i)=>({capability:"price",kind:"room",identity,
    relation:"RELATED_REQUEST",refs:[refs(first)[i]]})),{previous:first.state,history:first.history});
  assert.equal(next.result.earliestFailure,null);assert.equal(next.calls,1);
  assert.equal(next.result.artifacts.formalRequests.length,2);
  assert.deepEqual(next.result.artifacts.formalRequests.map(request=>[request.resolverTask.productId,request.resolverTask.checkIn]),
    [["room-a","2026-10-10"],["room-b","2026-10-12"]]);
  assert.equal(next.state.tasks.length,4);
});

test("ambiguous current dates must not fall back to the previous stay",async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange()}]);
  const next=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"MODIFICATION",refs:refs(first),
    text:"Change to an uncertain date",temporal:{kind:"unknown",rawText:"an uncertain date",checkInCandidate:null,checkOutCandidate:null,nightsCandidate:null}}],
    {previous:first.state,history:first.history});
  assert.equal(next.queries.length,0);
  assert.equal(next.result.artifacts.outcomes[0].routingDecision.disposition,"CLARIFY");
});

test("nights-only modification keeps the verified check-in and replaces the old duration",async()=>{
  const first=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange()}]);
  const next=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"MODIFICATION",refs:refs(first),
    text:"改住三晚",temporal:{kind:"nights_only",rawText:"住三晚",checkInCandidate:null,checkOutCandidate:null,nightsCandidate:3}}],
    {previous:first.state,history:first.history});
  console.log(JSON.stringify({classification:"FAKE_INTEGRATION",case:"nights-only",earliestFailure:next.result.earliestFailure,
    outcomes:next.result.artifacts.outcomes,requests:next.result.artifacts.formalRequests}));
  assert.equal(next.result.earliestFailure,null);
  assert.equal(next.result.artifacts.formalRequests.length,1);
  const formal=next.result.artifacts.formalRequests[0];
  assert.equal(formal.resolverTask.checkIn,"2026-10-10");assert.equal(formal.resolverTask.checkOut,"2026-10-13");
  assert.equal(formal.stay.nights,3);assert.equal(formal.requestCycleId,first.state.tasks[0].taskId);
});
