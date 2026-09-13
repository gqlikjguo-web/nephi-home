"use strict";
// FAKE_INTEGRATION: official application/render/validation; source-bound model
// doubles and formal isolated property rows. No REAL model/database claim.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {run}=require("./new-core-inventory-unknown-outcome-runner");
const {coverageLayout,validateVisibleCoverage}=require("../lib/conversation-engine-v2/render-obligation");
const {composeSection}=require("../lib/conversation-engine-v2/controlled-composer");
for(const propertyId of ["inventory-a","inventory-b"])for(const kind of ["room","bundle"]){
 test(`closed inventory retains explicit price responsibility ${propertyId}/${kind}`,async()=>{
  const r=await run({propertyId,kind,inventory:"closed",capabilities:["availability","price"]});
  const price=r.artifacts.executionOutcomes.find(o=>o.type==="price");
  assert.equal(price.outcome,"no_availability");assert.equal(price.reason,"no_bookable_inventory");
  assert.deepEqual(price.facts.prices,[]);assert.equal(price.facts.source,"availability_provider");
  const p=r.artifacts.responsePlan,options={finalDecision:r.finalDecision},l=coverageLayout(p,options);
  assert.equal(p.renderObligations.length,2);assert.equal(l.segments.length,3,"two distinct outcome bodies and one shared resource");
  assert.equal(l.segments.filter(s=>s.taskIds.length===2).length,1);
  assert.equal(validateVisibleCoverage(r.finalResponse.replyText,p,options).errors.length,0);
  for(const s of l.segments){const bytes=Buffer.from(r.finalResponse.replyText);const changed=Buffer.concat([bytes.subarray(0,s.start),bytes.subarray(s.end)]).toString();
   assert.ok(validateVisibleCoverage(changed,p,options).errors.includes("final_section_missing"),"neither an answer nor shared resource can be omitted");}
 });
 test(`available priced inventory merges safely ${propertyId}/${kind}`,async()=>{
  const r=await run({propertyId,kind,inventory:"available",capabilities:["availability","price"]});
  assert.ok(r.artifacts.executionOutcomes.every(o=>o.outcome==="answered"));
  const l=coverageLayout(r.artifacts.responsePlan,{finalDecision:r.finalDecision});
  assert.equal(l.segments.length,2);assert.ok(l.segments.every(s=>s.taskIds.length===2));
 });
}
test("untyped legacy price composition remains unchanged",()=>assert.equal(composeSection({status:"answered",facts:{availability:"full",checkIn:"2026-10-12",prices:[]}}),"2026-10-12 入住目前已滿房。"));
test("unreliable is still technical and never a no-inventory price answer",async()=>{
 const r=await run({inventory:"untyped_unreliable",capabilities:["availability","price"]});
 assert.ok(r.artifacts.executionOutcomes.every(o=>o.outcome==="technical_error"));
 assert.equal(r.finalDecision.reasonCode,"terminal_processing_status");
});
