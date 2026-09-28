"use strict";
// RECORDED_REPRODUCTION / FAKE_INTEGRATION: saved REAL failure shape through
// actual admission, Context, canonical Temporal and Resolver. No real providers.
const assert=require("node:assert/strict"),{test}=require("node:test");
const {turn,refs}=require("./helpers/new-core-context-scenarios");
const date="2026年10月12日入住，10月14日退房";
const message=`${date}，兩位，請查空房。`;
const temporal={rawText:date,kind:"date_range",checkInCandidate:null,checkOutCandidate:null,nightsCandidate:null};
const spec=text=>({capability:"availability",kind:"property",identity:null,text,temporal,slots:[["guest_count",2]]});
const evidence=(event,start,end)=>({eventId:event.eventId,messageRef:event.messageRef,startOffset:start,endOffset:end,
  quote:event.messageText.slice(start,end)});
function withRefs(makeRefs){return(output,input)=>{
 const unit=output.understandingOutput.units[0];unit.evidenceRefs=makeRefs(input.sourceEvents);
 output.contextLinkCandidates[0].currentSourceEvidenceRefs=unit.evidenceRefs;
 return output;
};}
test("dates-first Context: overlapping valid spans for one occurrence establish State before product modification",async()=>{
 const first=await turn([spec(message)],{transformOutput:withRefs(([event])=>[
  evidence(event,0,date.length),evidence(event,date.length+1,date.length+3),evidence(event,0,message.length)
 ])});
 console.log(JSON.stringify({classification:"RECORDED_REPRODUCTION",case:"overlapping-same-occurrence",earliestFailure:first.result.earliestFailure,
  requests:first.result.artifacts.formalRequests,state:first.state,diagnostics:first.diagnostics}));
 assert.equal(first.result.earliestFailure,null,"two citations of one source occurrence are not two temporal sources");
 assert.equal(first.result.finalDecision.action,"reply");assert.equal(first.queries.length,1);assert.equal(first.state.tasks.length,1);
 const saved=first.state.tasks[0];assert.equal(saved.checkIn,"2026-10-12");assert.equal(saved.checkOut,"2026-10-14");assert.equal(saved.guestCount,2);
 assert.equal(first.result.artifacts.formalRequests[0].evidence.sourceEvidenceRefs.length,3,"all validated evidence is retained");
 const second=await turn([{capability:"availability",kind:"room",identity:"room-a",relation:"MODIFICATION",refs:refs(first),
  text:"Use Room A for that same stay",slots:[["product","room-a"]]}],{previous:first.state,history:first.history});
 assert.equal(second.result.earliestFailure,null);assert.equal(second.result.finalDecision.action,"reply");
 const request=second.result.artifacts.formalRequests[0];assert.equal(request.requestCycleId,saved.taskId);
 assert.equal(request.resolverTask.checkIn,saved.checkIn);assert.equal(request.resolverTask.checkOut,saved.checkOut);assert.equal(request.resolverTask.guestCount,2);
 assert.equal(request.resolverTask.productId,"room-a");assert.equal(second.queries.length,1);
});
test("one exact source span retains the prior canonical behavior",async()=>{
 const value=await turn([spec(message)],{transformOutput:withRefs(([event])=>[evidence(event,0,date.length)])});
 assert.equal(value.result.earliestFailure,null);assert.equal(value.result.artifacts.formalRequests[0].resolverTask.checkOut,"2026-10-14");
});
test("identical dates cited from distinct source events remain ambiguous",async()=>{
 const value=await turn([spec(message)],{extraMessages:[message],transformOutput:withRefs(events=>events.map(event=>evidence(event,0,date.length)))});
 assert.equal(value.result.earliestFailure.failureCode,"CANONICAL_INPUT_INCOMPLETE");assert.equal(value.queries.length,0);
});
test("distinct occurrences within one event do not collapse into one source",async()=>{
 const text=`${date}；${date}`;
 const value=await turn([spec(text)],{transformOutput:withRefs(([event])=>[
  evidence(event,0,date.length),evidence(event,date.length+1,text.length)
 ])});
 assert.equal(value.result.earliestFailure.failureCode,"CANONICAL_INPUT_INCOMPLETE");assert.equal(value.queries.length,0);
});
