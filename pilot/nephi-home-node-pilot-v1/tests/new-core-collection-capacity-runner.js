'use strict';
// STRUCTURED_CONTRACT_TEST + FAKE_INTEGRATION. Reuse C03/C05/C08 fixture builders;
// local Resolver test double exercises real execution and response functions, not REAL E2E.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const assert=require('node:assert/strict'),test=require('node:test');
const filename=path.join(__dirname,'new-core-canonical-adapter-runner.js');
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(__dirname);
const source=fs.readFileSync(filename,'utf8');
m._compile(source.slice(0,source.indexOf('// AC-CAN-001'))+'\nmodule.exports={pipeline,createC08,execute,evidence,catalog,NOW};',filename);
const {pipeline,createC08,execute,evidence,catalog,NOW}=m.exports;
const {buildCanonicalFormalRequest,buildCanonicalQueryPlan}=require('../lib/conversation-engine-v2/formal-request');
const {executeCanonicalQueryPlans}=require('../lib/conversation-engine-v2/capability-executor');
const {buildResponsePlan}=require('../lib/conversation-engine-v2/response-planner');
const {composeControlledReply}=require('../lib/conversation-engine-v2/controlled-composer');
const {validateClaims}=require('../lib/conversation-engine-v2/claim-validator');
const {buildFinalDecision}=require('../lib/conversation-engine-v2/final-decision');
const {buildFinalResponse}=require('../lib/conversation-engine-v2/final-response-renderer');

const {createMvpService}=require('../lib/mvp-service');
const {availabilityRequestFromResolverTask}=require('../lib/conversation-engine-v2/resolver-adapter');
const {evaluateProductFulfillment}=require('../lib/conversation-engine-v2/capability-executor');
const A={id:'entity-a',name:'A',type:'category',capacity:2},B={id:'entity-b',name:'B',type:'category',capacity:2};
const requirement={requestedQuantity:2,distinctRequirement:'distinct_entities'};
function resolve({rooms=[A,B],available=rooms.map(r=>r.id),guests=4,quantity=2,reliable=true,mode='any'}={}){
 const property={propertyId:'collection-scope',displayName:'Collection',rooms};
 const service=createMvpService({customerSettings:{getProperty:()=>property},availability:{getRows:()=>reliable?[{date:'2026-09-29',...Object.fromEntries(rooms.map(r=>[r.id,available.includes(r.id)?'available':'closed']))}]:[]},persistence:{}});
 const task={propertyId:property.propertyId,productType:'any',productId:null,roomTypeSet:rooms.map(r=>r.id),checkIn:'2026-09-29',checkOut:'2026-09-30',guestCount:guests,...(quantity==null?{}:{requestedQuantity:quantity,distinctRequirement:'distinct_entities'})};
 const query=availabilityRequestFromResolverTask(task);if(mode!=='any')query.queryMode=mode;
 const result=service.searchAvailability(query);
 const fulfillment=evaluateProductFulfillment(requirement,{status:result.availabilityReliable?'known':'unknown',matchedIdentities:result.rooms.map(r=>r.id)});
 return {result,query,fulfillment};
}
test('C1 collection admits two small products',()=>{const x=resolve();assert.deepEqual(x.result.rooms.map(r=>r.id),[A.id,B.id]);assert.equal(x.fulfillment.fulfillmentStatus,'fulfilled')});
test('C2 preserves partial available candidate',()=>{const x=resolve({available:[B.id]});assert.deepEqual(x.result.rooms.map(r=>r.id),[B.id]);assert.equal(x.fulfillment.matchedCount,1);assert.equal(x.fulfillment.unresolvedRemainder,1);assert.equal(x.fulfillment.fulfillmentStatus,'partial')});
test('C3 quantity one retains single product capacity',()=>assert.equal(resolve({rooms:[B],quantity:1}).result.rooms.length,0));
test('C4 single product fits',()=>assert.equal(resolve({rooms:[B],guests:2,quantity:1}).result.rooms.length,1));
test('C5 insufficient aggregate capacity cannot fulfill',()=>{const x=resolve({guests:5});assert.equal(x.result.rooms.length,0);assert.notEqual(x.fulfillment.fulfillmentStatus,'fulfilled')});
test('C6 duplicates cannot supply quantity or capacity',()=>{const x=resolve({rooms:[A,A]});assert.deepEqual(x.result.rooms.map(r=>r.id),[A.id]);assert.equal(x.fulfillment.fulfillmentStatus,'partial')});
test('C7 absent quantity preserves single product contract',()=>{const x=resolve({quantity:null});assert.equal(x.query.requestedQuantity,undefined);assert.equal(x.result.rooms.length,0)});
test('C8 absent guests remain absent',()=>{const x=resolve({guests:null});assert.equal(x.query.guests,null);assert.equal(x.result.rooms.length,2)});
test('C9 unreliable availability stays unknown',()=>{const x=resolve({reliable:false});assert.equal(x.result.availabilityReliable,false);assert.equal(x.fulfillment.fulfillmentStatus,'unknown');assert.equal(x.fulfillment.matchedCount,null)});
test('C10 bundle product still uses official membership/type',()=>{const bundle={id:'bundle-x',name:'Bundle',capacity:4,inventoryType:'bundle',memberRoomIds:[A.id,B.id]};const x=resolve({rooms:[A,B,bundle],quantity:1,mode:'bundle_only'});assert.deepEqual(x.result.rooms.map(r=>r.id),[bundle.id])});
test('canonical quantity reaches resolver query',()=>{const message='Products 2026/10/09-10/10';const quantityCandidate={...requirement,evidenceRefs:[evidence(message)]};const p=pipeline({messageText:message,unitOverrides:{subject:{kind:'matched_room_set',catalogIdentity:'matched-four-person'},quantityCandidate}});const c=execute(createC08(p).value);assert.equal(c.ok,true);const f=buildCanonicalFormalRequest({property:{propertyId:catalog.propertyId,timezone:'Asia/Taipei'},canonicalRequest:c.value.canonicalRequest,confirmedInputs:{stay:{guests:4}}});const q=availabilityRequestFromResolverTask(f.resolverTask);assert.equal(q.requestedQuantity,2);assert.equal(q.distinctRequirement,'distinct_entities')});
