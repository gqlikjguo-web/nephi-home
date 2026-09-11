'use strict';
// RUNTIME_COMPONENT_TEST; actual service over in-memory formal rows, no REAL providers.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMvpService}=require('../lib/mvp-service');
const {executeQueryPlan}=require('../lib/conversation-engine-v2/capability-executor');
const {composeSection}=require('../lib/conversation-engine-v2/controlled-composer');
const rooms=[{id:'east',name:'東側房',capacity:2},{id:'west',name:'西側房',capacity:3}];
function run({capability='availability',guests=5,quantity=2,open=['east','west'],reliable=true}={}){
 const property={propertyId:'p',rooms};
 const service=createMvpService({customerSettings:{getProperty:()=>property},availability:{getRows:()=>reliable?[{date:'2026-09-29',...Object.fromEntries(rooms.map(r=>[r.id,open.includes(r.id)?'available':'closed']))}]:[]},persistence:{}});
 const resolverTask={propertyId:'p',productType:'any',productId:null,checkIn:'2026-09-29',checkOut:'2026-09-30',guestCount:guests,requestedQuantity:quantity,distinctRequirement:'distinct_entities'};
 let raw;
 const outcome=executeQueryPlan({property,catalog:{},queryPlan:{taskId:'t',propertyId:'p',capability,resolverId:'availability_resolver',conditions:{stay:{checkIn:resolverTask.checkIn,checkOut:resolverTask.checkOut}},resolverTask},availabilityResolver:q=>(raw=service.searchAvailability(q))});
 return {raw,outcome,text:outcome.facts?composeSection({type:capability,status:'answered',facts:outcome.facts}):''};
}
for(const capability of ['availability','price']){
 test(capability+' capacity failure preserves open inventory and reason',()=>{const r=run({capability,guests:6});assert.equal(r.raw.availableRooms.length,2);assert.equal(r.raw.rooms.length,0);assert.equal(r.outcome.facts.availability,'available');assert.equal(r.outcome.facts.feasibility.capacityStatus,'insufficient');assert.ok(r.text.includes('容納'));assert.ok(!r.text.includes('已滿房'));});
 test(capability+' closed is separate from capacity',()=>{const r=run({capability,open:[]});assert.equal(r.outcome.facts.availability,'full');assert.equal(r.outcome.facts.feasibility.inventoryStatus,'closed');});
 test(capability+' unreliable remains technical failure',()=>{const r=run({capability,reliable:false});assert.equal(r.outcome.outcome,'technical_error');});
}
test('short collection retains partial candidates',()=>{const r=run({open:['east']});assert.equal(r.raw.rooms.length,1);assert.equal(r.raw.feasibility.inventoryStatus,'available');assert.equal(r.raw.feasibility.capacityStatus,'insufficient');});
test('single room capacity failure retains independent inventory evidence',()=>{const r=run({quantity:1,guests:4});assert.equal(r.raw.rooms.length,0);assert.equal(r.raw.availableRooms.length,2);assert.equal(r.raw.feasibility.capacityStatus,'insufficient');});
test('feasible collection keeps candidates',()=>{const r=run();assert.equal(r.raw.rooms.length,2);assert.equal(r.raw.feasibility.capacityStatus,'sufficient');});
