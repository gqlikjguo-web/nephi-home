"use strict";
// FAKE_INTEGRATION: queued Understanding, official core/Resolver over isolated
// formal PostgreSQL provider/PGlite. Not REAL OpenAI or live PostgreSQL.
const {test}=require("node:test"), assert=require("node:assert/strict");
const {run}=require("./new-core-inventory-unknown-outcome-runner");
const {unknownProvenanceFor}=require("../lib/conversation-engine-v2/claim-validator");
const {coverageLayout}=require("../lib/conversation-engine-v2/render-obligation");
for(const propertyId of ["inventory-a","inventory-b"]) for(const kind of ["room","bundle"]) for(const inventory of ["missing","closed"]){
 test(`registered rate independent of inventory ${propertyId}/${kind}/${inventory}`,async()=>{
  const r=await run({propertyId,kind,inventory,capabilities:["availability","price"]});
  const [a,p]=r.artifacts.executionOutcomes;
  assert.equal(a.outcome,inventory==="missing"?"unknown":"no_availability");
  if(inventory==="missing")assert.ok(unknownProvenanceFor(a));
  assert.equal(p.outcome,"answered");assert.equal(p.facts.source,"pricing_provider");
  assert.equal(p.facts.priceBasis,"registered_rate");
  assert.equal(p.facts.prices.length,1);assert.equal(p.facts.prices[0].total,1000);
  assert.equal(p.facts.prices[0].inventory.canonicalId,kind==="room"?"product-a":"product-b");
  assert.equal(p.facts.availability,inventory==="missing"?"unknown":"full");
  assert.ok(r.finalResponse.replyText.includes("1,000"));
  assert.ok(!r.finalResponse.replyText.includes("目前可預訂"));
  assert.equal(r.finalDecision.reviewRequired,false);
  const l=coverageLayout(r.artifacts.responsePlan,{finalDecision:r.finalDecision});
  assert.equal(l.segments.filter(s=>Buffer.from(l.text).subarray(s.start,s.end).toString().startsWith("查房連結：")).length,1);
 });
}
for(const inventory of ["exception","untyped_unreliable"])test(`technical remains technical: ${inventory}`,async()=>{
 const r=await run({inventory,capabilities:["availability","price"]});
 assert.deepEqual(r.artifacts.executionOutcomes.map(o=>o.outcome),["technical_error","technical_error"]);
 assert.ok(r.artifacts.executionOutcomes.every(o=>unknownProvenanceFor(o)===null));
 assert.equal(r.finalResponse.replyText,"");
});
test("existing open inventory shares its price and resource once",async()=>{
 const r=await run({inventory:"available",capabilities:["availability","price"]});
 assert.ok(r.artifacts.executionOutcomes.every(o=>o.outcome==="answered"));
 const l=coverageLayout(r.artifacts.responsePlan,{finalDecision:r.finalDecision});
 assert.equal(l.segments.length,2);assert.ok(l.segments.every(s=>s.taskIds.length===2));
});
