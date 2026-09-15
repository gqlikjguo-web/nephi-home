"use strict";
// FAKE_INTEGRATION: fixed Understanding, real C03/C06/C08/Resolver/FinalResponse; zero OpenAI calls.
const assert = require("node:assert/strict");
const {query,formalProperty}=require("./new-core-room-composition-query-runner");
const {informationNeedAdmission}=require("../lib/new-core/contracts/information-need");
async function run(){
 let cases=0;
 for(const id of ["list-alpha","list-beta"]){
  for(const [subject,want] of [
   [{kind:"property",catalogIdentity:null},["Family type","Loft type"]],
   [{kind:"room",catalogIdentity:"type-family"},["Family type"]],
   [{kind:"bundle",catalogIdentity:"package"},["Family type","Loft type"]]
  ]){
   const property=formalProperty(id);
   const spec={text:"請列出正式房型名稱",capability:"lodging_room_composition",subject,informationNeed:"room_types"};
   const {result,validated}=await query(property,[spec]);
   assert.equal(result.earliestFailure,null,JSON.stringify(result.earliestFailure));
   assert.equal(validated,true);
   const facts=result.artifacts.executionOutcomes[0].facts;
   assert.deepEqual(facts.roomTypes.map(x=>x.publicName),want);
   assert.equal(facts.propertyId,id);
   assert.equal(facts.physicalRoomCount,undefined,"type names are not a physical count");
   for(const name of want)assert.ok(result.finalResponse.replyText.includes(name));
   for(const name of ["East suite","West suite","Loft"])assert.ok(!result.finalResponse.replyText.includes(name+"、"));
   assert.ok(!result.finalResponse.replyText.includes("East suite"));
   cases++;
  }
 }
 for(const kind of ["missing","incomplete","missing-name","foreign"]){
  const property=formalProperty();
  if(kind==="missing")delete property.roomCompositionV1;
  if(kind==="incomplete")property.roomCompositionV1.inventoryComplete=false;
  if(kind==="missing-name"){ property.roomCompositionInventory=structuredClone(property.roomCompositionInventory); delete property.roomCompositionInventory.roomTypes[0].name; }
  if(kind==="foreign")property.roomCompositionInventory.propertyId="foreign";
  const {result}=await query(property,[{text:"列出房型",capability:"lodging_room_composition",subject:{kind:"property",catalogIdentity:null},informationNeed:"room_types"}]);
  assert.equal(result.earliestFailure,null);
  assert.equal(result.finalResponse.shouldReply,false);
  assert.equal(result.artifacts.executionOutcomes[0].outcome,["foreign","missing-name"].includes(kind)?"technical_error":"unknown");cases++;
 }
 const slot={slot:"information_need",operation:"SET",value:"room_types"};
 assert.equal(informationNeedAdmission(slot,{registryCapabilities:["policy"]}).allowed,false);
 assert.equal(informationNeedAdmission({...slot,value:"eligibility"},{registryCapabilities:["lodging_room_composition"]}).allowed,false);cases++;
 const {result,validated}=await query(formalProperty(),[
  {text:"有哪些房型",capability:"lodging_room_composition",subject:{kind:"property",catalogIdentity:null},informationNeed:"room_types"},
  {text:"家庭房型共有幾間",capability:"lodging_room_composition",subject:{kind:"room",catalogIdentity:"type-family"}}
 ]);
 assert.equal(validated,true);assert.equal(result.artifacts.executionOutcomes[1].facts.physicalRoomCount,2);
 assert.ok(result.finalResponse.replyText.includes("Family type"));assert.ok(result.finalResponse.replyText.includes("East suite"));cases++;
 console.log(`room type list: ${cases}/${cases} PASS (FAKE_INTEGRATION)`);
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
