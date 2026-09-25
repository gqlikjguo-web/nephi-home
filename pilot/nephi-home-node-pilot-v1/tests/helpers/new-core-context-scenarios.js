"use strict";
// Fixed Understanding candidates through the actual admission/core/Resolver.
// The fixture defines inputs and facts only; it implements no Context decisions.
const { executeNewCoreTurn } = require("../../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../../lib/providers/openai-understanding-v1");
const { createConversationStateV3, readConversationStateV3 } = require("../../lib/conversation-contracts/conversation-state-v3");
const { createMvpService } = require("../../lib/mvp-service");
const { requestCycleRefsForResult } = require("../../lib/new-core/production-turn-adapter");
const NOW = "2026-09-24T03:00:00.000Z";
const scope = {propertyId:"context-fixture", channel:"isolated", userId:"context-guest"};
const room = {id:"room-a", name:"Room A", type:"double", capacity:4, basePrice:1200,
  mondayThursdayPrice:1200, fridayPrice:1200, saturdayHolidayPrice:1200, sundayPrice:1200};
const property = {propertyId:scope.propertyId, displayName:"Context fixture", timezone:"Asia/Taipei",
  rooms:[room, {...room,id:"room-b",name:"Room B"}, {...room,id:"bundle-a",name:"Bundle A",
    inventoryType:"bundle",memberRoomIds:["room-a","room-b"],capacity:8}],
  commonAnswers:{checkInTime:"15:00"}, businessProfile:{}, propertyFacts:[]};
let serial = 0;
const empty = (s=scope, now=NOW) => createConversationStateV3({...s,tasks:[],createdAt:now,updatedAt:now,
  expiresAt:new Date(Date.parse(now)+86400000).toISOString()});
function dateRange(checkIn="2026-10-10", checkOut="2026-10-11") {
  return {kind:"date_range",rawText:`${checkIn}入住，${checkOut}退房`,checkInCandidate:checkIn,
    checkOutCandidate:checkOut,nightsCandidate:(Date.parse(checkOut)-Date.parse(checkIn))/86400000};
}
async function turn(specs, {previous, history=[], turnScope=scope, now=NOW, inventory="available", extraMessages=[], transformOutput=value=>value}={}) {
  const id = `context-turn-${++serial}`;
  const events = specs.map((s,i)=>({eventId:`${id}-${i}`,messageRef:`${id}-${i}`,role:"guest",timestamp:now,
    messageKind:"text",messageText:s.text||[s.capability,s.kind,s.identity,s.temporal?.rawText].filter(Boolean).join(" ")}));
  for(const messageText of extraMessages)events.push({eventId:`${id}-${events.length}`,messageRef:`${id}-${events.length}`,
    role:"guest",timestamp:now,messageKind:"text",messageText});
  const scopedProperty={...property,propertyId:turnScope.propertyId};
  const service=createMvpService({customerSettings:{getProperty:()=>scopedProperty},persistence:{},availability:{
    getRows:(_property,start,end)=>{
      const rows=[];
      for(let ms=Date.parse(start);ms<Date.parse(end);ms+=86400000) rows.push({date:new Date(ms).toISOString().slice(0,10),
        "room-a":inventory,"room-b":inventory,"bundle-a":inventory});
      return rows;
    }
  }});
  let calls=0, c01;
  const queries=[], diagnostics=[];
  const result=await executeNewCoreTurn({scope:turnScope,property:scopedProperty,now,
    state:readConversationStateV3(previous||empty(turnScope,now),turnScope,now),publicBaseUrl:"https://example.invalid",
    input:{turnId:id,traceId:id,message:events.map(e=>e.messageText).join("\n"),sourceEvents:events,recentConversation:history},
    providerConfig:{apiKey:"fixture-only"},onDiagnostic:value=>diagnostics.push(value),
    resolver:{availability:query=>{queries.push(query);return service.searchAvailability(query);},
      availableDates:query=>{queries.push(query);return service.searchAvailableDates(query);},
      priceOverrides:()=>[],dateClassifications:()=>[],customReplies:()=>[]},
    understandingProvider:(input,options)=>callOpenAIUnderstandingV1(input,{...options,nowMs:()=>Date.parse(now),fetchImpl:async()=>{
      calls++;c01=input;
      const units=specs.map((s,i)=>{
        const e=events[i],ref={eventId:e.eventId,messageRef:e.messageRef,startOffset:0,endOffset:e.messageText.length,quote:e.messageText};
        return {unitId:s.id||`unit-${i}`,purpose:s.purpose||"lodging_question",capability:s.capability,
          subject:{kind:s.kind,catalogIdentity:s.identity},stayDependent:s.stayDependent??["availability","available_dates","price","total_price","capacity"].includes(s.capability),
          evidenceRefs:[ref],temporalCandidate:s.temporal||null,confidenceBand:"high",safetyCandidate:null,
          contextLinkCandidateId:`link-${i}`,slotCandidates:(s.slots||[]).map(([slot,value,operation="SET"],j)=>({
            slotCandidateId:`slot-${i}-${j}`,slot,value,operation,evidenceRefs:[ref]})),
          ...(s.quantity?{quantityCandidate:{...s.quantity,evidenceRefs:[ref]}}:{})};
      });
      const output={understandingOutput:{schemaVersion:1,turnId:input.turnId,units},contextLinkCandidates:units.map((u,i)=>({
        contextLinkCandidateId:u.contextLinkCandidateId,unitId:u.unitId,relationKind:specs[i].relation||"NEW_REQUEST",
        currentSourceEvidenceRefs:u.evidenceRefs,referencedHistoryEventRefs:specs[i].refs||[]}))};
      return {ok:true,status:200,headers:{get:()=>"fixture-context"},text:async()=>JSON.stringify({model:"gpt-5.6-luna",
        status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(transformOutput(output,input))}]}]})};
    }})});
  // Reload serialized actual State, never manufacture an ideal pending cycle.
  return {result,state:JSON.parse(JSON.stringify(result.state)),events,calls,c01,queries,diagnostics,
    history:events.map(event=>({...event,referenceableCycleIds:requestCycleRefsForResult(result)}))};
}
const refs = t => t.events.map(({eventId,messageRef})=>({eventId,messageRef}));
module.exports={turn,refs,dateRange,empty,scope,NOW};
