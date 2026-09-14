"use strict";
// RUNTIME_COMPONENT_TEST: real admin handlers, isolated DOM/API doubles.
const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
test("admin loads, edits, saves and clears both property-scoped texts",async()=>{
 const code=fs.readFileSync(root+"/public/assets/admin.js","utf8"),html=fs.readFileSync(root+"/public/admin.html","utf8");
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:"",dataset:{selected:"true"},reportValidity:()=>true});return nodes.get(id)};
 const profile={propertyName:"Lodge",checkInTime:"15:00",checkOutTime:"11:00",checkInGuestText:"Arrival\nexact  text",checkOutGuestText:"Departure text"},writes=[];
 const api=async(url,opts)=>{assert.equal(url,opts?"/api/property-profile":"/api/property-profile?propertyId=scope-alpha");if(opts){const data=JSON.parse(opts.body);writes.push(data);Object.assign(profile,data);}return profile;};
 const context=vm.createContext({$,session:{propertyId:"scope-alpha"},api,renderAvailabilityAutoReply:()=>{},populateSelfCheckInOutCard:()=>{}});
 const start=code.indexOf("async function loadProfile()"),end=code.indexOf("function propertyProfilePayload()",start);
 vm.runInContext(code.slice(start,end),context);
 const payloadStart=end,payloadEnd=code.indexOf("\n",end);
 vm.runInContext(code.slice(payloadStart,payloadEnd),context);
 const submit=code.split("\n").find(line=>line.startsWith('$("profileForm").onsubmit ='));
 assert.ok(submit);vm.runInContext(submit,context);
 for(const stem of ["CheckIn","CheckOut"]){const at=html.indexOf(`id="profile${stem}Time"`),custom=html.indexOf(`id="profile${stem}GuestText"`);assert.ok(at>=0&&custom>at&&custom-at<300);}
 await vm.runInContext("loadProfile()",context);
 assert.equal($("profileCheckInGuestText").value,profile.checkInGuestText);
 assert.equal($("profileCheckOutGuestText").value,profile.checkOutGuestText);
 $("profileCheckInGuestText").value="Edited arrival\nverbatim";$("profileCheckOutGuestText").value="Edited departure";
 const event={preventDefault:()=>{},currentTarget:$("profileForm")};await $("profileForm").onsubmit(event);
 assert.equal(writes[0].checkInGuestText,"Edited arrival\nverbatim");assert.equal(writes[0].checkOutGuestText,"Edited departure");assert.equal(writes[0].propertyId,"scope-alpha");
 $("profileCheckInGuestText").value="";$("profileCheckOutGuestText").value="";await $("profileForm").onsubmit(event);
 assert.equal(writes[1].checkInGuestText,"");assert.equal(writes[1].checkOutGuestText,"");assert.equal(writes[1].checkInTime,"15:00");
 const otherSave=vm.runInContext("propertyProfilePayload()",context);assert.equal(otherSave.checkInGuestText,"");assert.equal(otherSave.propertyId,"scope-alpha");
});
