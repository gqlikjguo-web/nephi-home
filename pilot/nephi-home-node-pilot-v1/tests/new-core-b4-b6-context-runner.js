"use strict";
// FAKE_INTEGRATION: fixed source-bound Understanding through actual C02-C08,
// State, formal Resolver, FinalDecision and byte coverage. No real model/DB claim.
const {test}=require("node:test"), assert=require("node:assert/strict");
const {turn,refs,dateRange}=require("./helpers/new-core-context-scenarios");
const {validateVisibleCoverage}=require("../lib/conversation-engine-v2/render-obligation");
const day=(nights=null)=>({kind:"absolute_date",rawText:nights?`2026-10-15住${nights}晚`:"2026-10-15入住",
  checkInCandidate:"2026-10-15",checkOutCandidate:null,nightsCandidate:nights});
async function prior(){return turn([{capability:"availability",kind:"room",identity:"room-a",
  temporal:dateRange("2026-10-07","2026-10-09"),slots:[["guest_count",2]]}]);}
for(const [name,temporal,end] of [["date-only keeps verified two nights",day(),"2026-10-17"],
  ["explicit nights override old duration",day(3),"2026-10-18"],
  ["explicit checkout overrides old duration",dateRange("2026-10-15","2026-10-19"),"2026-10-19"]]) {
  test(`B4 ${name}`,async()=>{
    const first=await prior();
    const next=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"MODIFICATION",refs:refs(first),temporal}],
      {previous:first.state,history:first.history});
    assert.equal(next.result.earliestFailure,null);
    const req=next.result.artifacts.formalRequests[0];
    assert.equal(req.resolverTask.checkIn,"2026-10-15");assert.equal(req.resolverTask.checkOut,end);
    assert.equal(req.resolverTask.guestCount,2);
    assert.equal(next.state.tasks[0].checkOut,end);
    if(temporal.nightsCandidate===null){
      const t=next.result.artifacts.canonicalItems[0].canonicalRequest.temporalState;
      assert.equal(t.nights,2);assert.equal(t.provenance.nights,"context");
      assert.equal(t.provenance.checkOut,"derived");
    }
  });
}
test("B4 independent date-only request still defaults to one night",async()=>{
  const first=await prior();
  const next=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:day()}],{previous:first.state,history:first.history});
  assert.equal(next.result.artifacts.formalRequests[0].resolverTask.checkOut,"2026-10-16");
});
function linkTo(sourceId){return output=>{
  const price=output.contextLinkCandidates.find(link=>link.unitId==="price-unit");
  price.relationKind="RELATED_UNIT";price.referencedCurrentUnitId=sourceId;
  return output;
};}
async function related(first,{sourceId="source-unit",reverse=false,sourceTemporal=dateRange("2026-10-15","2026-10-17"),priceIdentity="bundle-a",...options}={}){
  const specs=[{id:"source-unit",capability:"availability",kind:"bundle",identity:"bundle-a",relation:"MODIFICATION",refs:refs(first),
    slots:[["product","bundle-a"]],temporal:sourceTemporal},
    {id:"price-unit",capability:"price",kind:"bundle",identity:priceIdentity,text:"Price for the same updated lodging"}];
  return turn(reverse?specs.reverse():specs,{previous:first.state,history:first.history,transformOutput:linkTo(sourceId),...options});
}
for(const reverse of [false,true])test(`B6 explicit same-turn source uses updated lodging conditions, reverse=${reverse}`,async()=>{
  const first=await prior(),next=await related(first,{reverse});
  assert.equal(next.result.earliestFailure,null);
  const requests=next.result.artifacts.formalRequests;
  assert.equal(requests.length,2);assert.equal(next.queries.length,2,"both requests actually query fresh facts");
  assert.equal(new Set(requests.map(r=>r.requestCycleId)).size,2);
  for(const r of requests){assert.equal(r.resolverTask.productId,"bundle-a");assert.equal(r.resolverTask.checkIn,"2026-10-15");
    assert.equal(r.resolverTask.checkOut,"2026-10-17");assert.equal(r.resolverTask.guestCount,2);}
  assert.equal(next.state.tasks.length,2);
  assert.ok(next.result.artifacts.executionOutcomes.every(o=>o.outcome==="answered"));
  assert.equal(next.result.finalDecision.action,"reply");
});
for(const sourceId of ["missing-unit","price-unit"])test(`B6 invalid current source fails closed: ${sourceId}`,async()=>{
  const next=await related(await prior(),{sourceId});
  assert.ok(next.result.earliestFailure);
  assert.ok(!next.result.artifacts.formalRequests?.some(r=>r.taskId==="price-unit"));
});
test("B6 same-turn mismatched subject cannot inherit",async()=>{
  const next=await related(await prior(),{priceIdentity:"room-a"});
  assert.ok(next.result.earliestFailure);assert.ok(!next.result.artifacts.formalRequests?.some(r=>r.taskId==="price-unit"));
});
test("B6 no-date price cannot be READY or covered by a shared link",async()=>{
  const next=await turn([{capability:"availability",kind:"room",identity:"room-a",temporal:dateRange()},
    {capability:"price",kind:"room",identity:"room-a",text:"An independent price inquiry without dates"}]);
  assert.equal(next.result.earliestFailure,null);
  const outcome=next.result.artifacts.outcomes.find(o=>o.unit.capability==="price");
  assert.equal(outcome.readiness.status,"MISSING_GUEST_FIELDS");
  assert.equal(outcome.routingDecision.disposition,"CLARIFY");
  assert.equal(next.result.finalDecision.action,"clarification");
  assert.ok(next.result.finalResponse.replyText.includes("請提供入住日期。"));
  const omitted=next.result.finalResponse.replyText.replace("請提供入住日期。","");
  assert.ok(validateVisibleCoverage(omitted,next.result.artifacts.responsePlan,{finalDecision:next.result.finalDecision}).errors.length>0);
});
test("B6 formal not_ready itself requires a visible question even without a C07 flag",()=>{
  const {finalizeTurnResponse}=require("../lib/new-core/application-service");
  const {resultForNotReady}=require("../lib/conversation-engine-v2/formal-request");
  const execution=resultForNotReady({taskId:"price",capability:"price",readiness:{status:"missing_information",missingFields:["checkIn","checkOut"]}});
  const result=finalizeTurnResponse({scope:{propertyId:"fixture"},turnId:"clarify",property:{},
    executionOutcomes:[execution],requestEvidence:[{taskId:"price",requestPresence:"PRESENT",activeRequest:true,replyPermission:"ALLOWED"}],
    taskResults:[{taskId:"price",type:"price",status:"needs_clarification",outcomeStatus:execution.outcome,missingInputs:execution.missingFields,facts:{}}],
    publicAvailabilityUrl:"https://example.invalid/fixture"});
  assert.equal(result.finalDecision.action,"clarification");
  assert.ok(result.finalResponse.replyText.includes("請提供入住日期。"));
  assert.ok(validateVisibleCoverage("查房連結：https://example.invalid/fixture",result.responsePlan,{finalDecision:result.finalDecision}).errors.length>0);
});
for(const boundary of ["expired","other_guest","other_channel","other_property","invalid_source_evidence","cycle"]){
  test(`B6 current-unit source fails closed at ${boundary}`,async()=>{
    const {scope,NOW}=require("./helpers/new-core-context-scenarios");
    const options={};
    if(boundary==="expired")options.now=new Date(Date.parse(NOW)+25*3600000).toISOString();
    if(boundary.startsWith("other_"))options.turnScope={...scope,
      [boundary==="other_guest"?"userId":boundary==="other_channel"?"channel":"propertyId"]:"unrelated-scope"};
    if(boundary==="invalid_source_evidence"||boundary==="cycle")options.transformOutput=output=>{
      linkTo("source-unit")(output);
      const source=output.understandingOutput.units.find(u=>u.unitId==="source-unit");
      if(boundary==="invalid_source_evidence")source.evidenceRefs[0].quote="unowned source text";
      else {const link=output.contextLinkCandidates.find(l=>l.unitId==="source-unit");
        link.relationKind="RELATED_UNIT";link.referencedHistoryEventRefs=[];link.referencedCurrentUnitId="price-unit";}
      return output;
    };
    const next=await related(await prior(),options);
    assert.ok(next.result.earliestFailure);
    assert.equal(next.result.artifacts.formalRequests?.length||0,0);
    assert.equal(next.queries.length,0);
  });
}
test("B6 unresolved source dates leave both questions visibly incomplete",async()=>{
  const next=await related(await prior(),{sourceTemporal:{kind:"unknown",rawText:"ambiguous date",checkInCandidate:null,checkOutCandidate:null,nightsCandidate:null}});
  assert.equal(next.result.earliestFailure,null);
  assert.equal(next.queries.length,0);
  assert.ok(next.result.artifacts.outcomes.every(o=>o.routingDecision.disposition==="CLARIFY"));
  assert.equal(next.result.finalDecision.action,"clarification");
  assert.ok(next.result.finalResponse.replyText.includes("請提供入住日期。"));
});
