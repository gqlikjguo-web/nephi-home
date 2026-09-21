'use strict';
// Store receipts are separate from facts/decision authority and cannot be forged by JSON.
const receipts = new WeakSet();
const planSources = new WeakMap();
function recordPlanImageSources(plan, requests) {
 const sources=[];
 for(const request of requests||[]){
  if(request.resolverId!=='property_catalog'
   || request.responseMode!=='answer' || request.detailIntent!=='general'
   || request.canonicalEntity?.status!=='resolved'
   || !['amenity','policy','transport'].includes(request.canonicalEntity.category))continue;
  const section=plan.sections.find(x=>(x.coveredTaskIds||[x.taskId]).includes(request.taskId));
  if(!section || section.status!=='answered' || section.claimType!=='FACTUAL_ANSWER'
   || section.facts?.propertyId!==plan.propertyId || section.facts?.source!=='property_catalog'
   || section.facts?.customReplyRuleId || Object.hasOwn(section.facts,'applicableBundles') || section.outcomeStatus==='unknown')continue;
  const id=request.canonicalEntity.canonicalId;
  if(typeof id==='string'&&id&&!sources.includes(id))sources.push(id);
 }
 planSources.set(plan,Object.freeze(sources));
}
function imageSourcesForPlan(plan){return planSources.get(plan)||[];}
function issueImageReceipt({propertyId, sourceId, originalContentUrl, previewImageUrl}) {
 const value=Object.freeze({type:'image',propertyId,sourceId,originalContentUrl,previewImageUrl});
 for(const key of ['originalContentUrl','previewImageUrl']){
  const url=new URL(value[key]);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('image_url_invalid');
 }
 receipts.add(value);return value;
}
function isImageReceipt(value){return Boolean(value&&receipts.has(value));}
function lineMessages(response) {
 const validator=require('./conversation-engine-v2/claim-validator');
 if(!validator.isValidatedFinalResponse(response))throw Error('image_final_response_unvalidated');
 return [{type:'text',text:response.replyText},...(response.attachments||[]).map(x=>({type:'image',originalContentUrl:x.originalContentUrl,previewImageUrl:x.previewImageUrl}))];
}
module.exports={issueImageReceipt,isImageReceipt,lineMessages,recordPlanImageSources,imageSourcesForPlan};
