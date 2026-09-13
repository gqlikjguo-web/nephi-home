"use strict";
const { isDeepStrictEqual: equal } = require("node:util");
const { composeSection } = require("./controlled-composer");
const SAFE_HANDOFF_TEXT = "請稍候，將盡快回覆您。";
const ISSUED = new WeakSet();
const CONSTRUCTION_ERRORS = new WeakMap();
// Formal readiness reasons select response semantics, never match guest text.
const TEMPORAL_REJECTIONS = Object.freeze({
  past_date: Object.freeze({ nextInput: "future_check_in", text: "您提供的住宿日期已過，請改提供今天之後的入住日期。" })
});
const QUESTIONS = Object.freeze({checkIn:"請提供入住日期。",checkOut:"請補充退房日期。",guestCount:"請補充入住人數。",searchFrom:"請補充查詢起始日期。",searchTo:"請補充查詢結束日期。",productId:"請補充想查詢的住宿商品。",roomTypeId:"請補充想查詢的房型。",bundleId:"請補充想查詢的包棟方案。","stay.checkIn":"請提供入住日期。","stay.checkOut":"請補充退房日期。","stay.nights":"請補充住宿晚數。","stay.guests":"請補充入住人數。","stay.guestCount":"請補充入住人數。","inventory.entityId":"請補充想詢問的房型。","inventory.features":"請補充需要的房間條件。",entity:"請補充想詢問的房型。"});
function freeze(value){if(!value||typeof value!=="object"||Object.isFrozen(value))return value;Object.values(value).forEach(freeze);return Object.freeze(value);}
function claimType(result){return result.claimType||(result.status==="answered"?"FACTUAL_ANSWER":result.status==="needs_clarification"?"CLARIFY":"HANDOFF");}
function issueRenderObligations({propertyId,turnId,taskResults=[],executionOutcomes=[],requestEvidence=[]}) {
  const records=[], errors=[], ids=new Set();
  for(const result of taskResults){
    const taskId=result.taskId;
    if(ids.has(taskId)){errors.push("duplicate_task_outcome");continue;}
    ids.add(taskId);
    const execution=executionOutcomes.find(item=>item.taskId===taskId);
    const permission=requestEvidence.find(item=>item.taskId===taskId);
    const type=claimType(result);
    const readinessStatus=result.readinessStatus||execution?.readinessStatus||null;
    const kind=permission?.requestPresence==="ABSENT"?"ABSENT":permission?.replyPermission&&permission.replyPermission!=="ALLOWED"?"SUPPRESSED":type==="CLARIFY"&&TEMPORAL_REJECTIONS[readinessStatus]?"TEMPORAL_REJECTION":type;
    const payload=freeze({...result,taskId,coveredTaskIds:[taskId],claimType:type,
      facts:structuredClone(result.facts||{}),missingInputs:[...(result.missingInputs||execution?.missingFields||[])],
      readinessStatus,outcomeStatus:result.outcomeStatus||execution?.outcome||null,
      outcomeReason:result.outcomeReason||execution?.reason||null});
    const record=Object.freeze({propertyId,turnId,taskId,kind,payload,
      provenance:result.terminalFailure||result.unknownProvenance||result.executionProvenance||null});
    ISSUED.add(record);records.push(record);
  }
  for(const evidence of requestEvidence)if(!records.some(item=>item.taskId===evidence.taskId)){
    const kind=evidence.requestPresence==="ABSENT"?"ABSENT":evidence.replyPermission!=="ALLOWED"?"SUPPRESSED":"MISSING_OUTCOME";
    const record=Object.freeze({propertyId,turnId,taskId:evidence.taskId,kind,payload:Object.freeze({}),provenance:null});ISSUED.add(record);records.push(record);
  }
  CONSTRUCTION_ERRORS.set(records, Object.freeze(errors));
  return Object.freeze(records);
}
function questions(fields){const minimal=fields.filter(field=>!(field==="checkOut"&&fields.includes("checkIn"))&&!(field==="stay.checkOut"&&fields.includes("stay.checkIn")));return [...new Set(minimal.map(field=>QUESTIONS[field]||"請補充尚缺的資訊。"))];}
function fragmentsFor(record,publicAvailabilityUrl){
  const p=record.payload;
  const body=text=>({text,resource:null});
  const reference=url=>({text:`查房連結：${url}`,resource:{kind:"availability_reference",propertyId:record.propertyId,turnId:record.turnId,url}});
  if(["ABSENT","SUPPRESSED","MISSING_OUTCOME"].includes(record.kind))return [];
  if(record.kind==="TEMPORAL_REJECTION")return [body(TEMPORAL_REJECTIONS[p.readinessStatus].text)];
  if(record.kind==="CLARIFY"){
    if(p.publicAvailabilityUrl)return [reference(p.publicAvailabilityUrl)];
    const text=questions(p.missingInputs);if(!text.length)text.push("目前提供的資訊無法安全確認。");
    const fragments=text.map(body);
    if(publicAvailabilityUrl&&p.missingInputs.some(field=>["checkIn","stay.checkIn"].includes(field)))fragments.push(reference(publicAvailabilityUrl));
    return fragments;
  }
  const parts=[composeSection(p)].filter(Boolean).map(body);
  const url=p.publicAvailabilityUrl||(["availability","bundle_availability"].includes(p.type)?publicAvailabilityUrl:"");
  if(url)parts.push(reference(url));
  return parts;
}
function partsFor(record,publicAvailabilityUrl){return fragmentsFor(record,publicAvailabilityUrl).map(part=>part.text);}
function obligationErrors(plan){
  const records=plan.renderObligations;
  if(!Array.isArray(records))return ["render_obligations_required"];
  const errors=[...(CONSTRUCTION_ERRORS.get(records)||[])],ids=new Set(),sections=new Map();
  for(const section of plan.sections||[])for(const id of section.coveredTaskIds||[section.taskId]){
    if(sections.has(id))errors.push("duplicate_render_obligation");sections.set(id,section);
  }
  for(const record of records){
    if(!ISSUED.has(record)||record.propertyId!==plan.propertyId||record.turnId!==plan.turnId)errors.push("render_obligation_scope_mismatch");
    if(ids.has(record.taskId))errors.push("duplicate_render_obligation");ids.add(record.taskId);
    if(["ABSENT","SUPPRESSED"].includes(record.kind))continue;
    const section=sections.get(record.taskId);
    if(record.kind==="MISSING_OUTCOME"||!section){errors.push("final_section_missing");continue;}
    const facts=section.factOrigins?.find(item=>item.taskId===record.taskId)?.facts||section.facts||{};
    if(claimType(section)!==record.payload.claimType||!equal(facts,record.payload.facts))errors.push("render_obligation_payload_mismatch");
  }
  for(const section of plan.sections||[]){
    const members=records.filter(record=>(section.coveredTaskIds||[section.taskId]).includes(record.taskId));
    if(members.length>1&&!members.every(record=>canSharePresentation(members[0],record)))errors.push("presentation_group_conflict");
  }
  if([...sections.keys()].some(id=>!ids.has(id)))errors.push("unexpected_render_obligation");
  return errors;
}
function samePricedAnswer(left, right) {
  const eligible = section => section.claimType === "FACTUAL_ANSWER" && section.status === "answered"
    && ["availability", "bundle_availability", "price", "total_price"].includes(section.type)
    && Array.isArray(section.facts.prices) && section.facts.prices.length > 0;
  if (!eligible(left) || !eligible(right)) return false;
  const identity = section => ({ propertyId: section.facts.propertyId,
    checkIn: section.facts.checkIn, checkOut: section.facts.checkOut,
    availability: section.facts.availability, prices: section.facts.prices,
    requestedQuantity: section.requestedQuantity, distinctRequirement: section.distinctRequirement,
    fulfillmentStatus: section.fulfillmentStatus, matchedUniqueIdentities: section.matchedUniqueIdentities,
    matchedCount: section.matchedCount, unresolvedRemainder: section.unresolvedRemainder });
  return Boolean(left.facts.propertyId) && equal(identity(left), identity(right))
    && composeSection(left) === composeSection(right);
}

function canSharePresentation(left,right){
  if(left.kind!=="FACTUAL_ANSWER"||right.kind!==left.kind)return false;
  const a=left.payload,b=right.payload;
  if(samePricedAnswer(a,b))return true;
  const semantics=p=>({type:p.type,facts:p.facts,requestedQuantity:p.requestedQuantity,
    distinctRequirement:p.distinctRequirement,fulfillmentStatus:p.fulfillmentStatus,
    matchedUniqueIdentities:p.matchedUniqueIdentities,matchedCount:p.matchedCount,
    unresolvedRemainder:p.unresolvedRemainder,publicAvailabilityUrl:p.publicAvailabilityUrl,
    outcomeStatus:p.outcomeStatus,outcomeReason:p.outcomeReason,readinessStatus:p.readinessStatus});
  return equal(semantics(a),semantics(b));
}
// Pre-task decisions have no admitted task obligations. Their existing decision
// fields, rather than an absent section container or caller text, own the response.
function decisionOnlyLayout(finalDecision, responsePrefix, publicAvailabilityUrl) {
  if (finalDecision?.action === "no_reply") return {text:"",segments:[],errors:[]};
  let parts;
  if (finalDecision?.action === "handoff" && finalDecision.reviewRequired === true) {
    parts = [SAFE_HANDOFF_TEXT];
  } else if (finalDecision?.action === "clarification") {
    parts = partsFor({kind:TEMPORAL_REJECTIONS[finalDecision.reasonCode] ? "TEMPORAL_REJECTION" : "CLARIFY",
      payload:{readinessStatus:finalDecision.reasonCode,missingInputs:finalDecision.missingFields || []}}, publicAvailabilityUrl);
  } else {
    throw new TypeError("formal_response_plan_required");
  }
  return {text:responsePrefix+parts.join("\n"),segments:[],errors:[]};
}
function coverageLayout(plan,{finalDecision,responsePrefix="",publicAvailabilityUrl=""}={}){
  if (plan === null) return decisionOnlyLayout(finalDecision, responsePrefix, publicAvailabilityUrl);
  const errors=obligationErrors(plan),records=plan.renderObligations||[];
  const visible=records.filter(item=>!["ABSENT","SUPPRESSED","MISSING_OUTCOME"].includes(item.kind));
  if(finalDecision?.action==="no_reply")return {text:"",segments:[],errors:visible.length?[...errors,"final_section_missing"]:errors};
  const ordered=[...visible];
  const rank=item=>["CLARIFY","TEMPORAL_REJECTION"].includes(item.kind)?1:item.kind==="HANDOFF"?2:0;
  if(finalDecision?.action!=="reply")ordered.sort((a,b)=>rank(a)-rank(b));
  const groups=[];
  for(const record of ordered){
    const shared=groups.find(group=>canSharePresentation(group.record,record));
    if(shared){shared.taskIds.push(record.taskId);continue;}
    groups.push({record,taskIds:[record.taskId],parts:fragmentsFor(record,publicAvailabilityUrl)});
  }
  // Resource identity is typed and scope-bound. Sharing presentation does not
  // create, merge or discard task obligations; content is never text-deduped.
  const content=[],references=[];
  for(const group of groups)for(const part of group.parts){
    const fragment={...part,taskIds:[...group.taskIds],kind:group.record.kind};
    if(!part.resource){content.push(fragment);continue;}
    const shared=references.find(item=>equal(item.resource,part.resource));
    if(shared)shared.taskIds.push(...fragment.taskIds);
    else references.push(fragment);
  }
  let text=String(responsePrefix);const segments=[];
  for(const part of [...content,...references]){
    if(segments.length)text+='\n';const start=Buffer.byteLength(text);text+=part.text;
    segments.push({taskIds:part.taskIds,kind:part.kind,start,end:Buffer.byteLength(text)});
  }
  return {text,segments,errors};
}
function validateVisibleCoverage(text,plan,options){
  const layout=coverageLayout(plan,options),actual=Buffer.from(String(text)),expected=Buffer.from(layout.text),errors=[...layout.errors];
  const covered=new Set();
  for(const record of plan.renderObligations||[]){
    if(["ABSENT","SUPPRESSED"].includes(record.kind))continue;
    const segments=layout.segments.filter(segment=>segment.taskIds.includes(record.taskId));
    const obligationParts=partsFor(record,options.publicAvailabilityUrl||"");
    const visible=segments.length===obligationParts.length&&segments.length>0&&segments.every((segment,index)=>
      segment.end<=actual.length&&actual.subarray(segment.start,segment.end).equals(Buffer.from(obligationParts[index])));
    if(!visible)errors.push("final_section_missing");
    else covered.add(record.taskId);
  }
  if(!actual.equals(expected))errors.push("final_text_mismatch");
  return {errors:[...new Set(errors)],coveredTaskIds:[...covered]};
}
module.exports={SAFE_HANDOFF_TEXT,samePricedAnswer,issueRenderObligations,coverageLayout,validateVisibleCoverage,obligationErrors};
