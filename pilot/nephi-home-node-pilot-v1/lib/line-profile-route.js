"use strict";
function fail(status,code){throw Object.assign(Error(code),{status,code});}
async function lineProfileRoute({method,session,body={},query=new URLSearchParams(),conversationStore,profileService}){
  if(!session)fail(401,'LOGIN_REQUIRED');
  const propertyId=session.propertyId;
  if(!propertyId)fail(409,'PROPERTY_SELECTION_REQUIRED');
  if(!Array.isArray(session.properties)||!session.properties.some(p=>p.propertyId===propertyId))fail(403,'PROPERTY_ACCESS_DENIED');
  for(const claimed of [body.propertyId,body.customerId,query.get('propertyId'),query.get('customerId')])if(claimed&&claimed!==propertyId)fail(403,'PROPERTY_ACCESS_DENIED');
  if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
  const {channelId,userId}=body;
  if(typeof channelId!=='string'||!channelId||typeof userId!=='string'||!userId)fail(400,'CONVERSATION_REQUIRED');
  const items=await conversationStore.listConversations(propertyId);
  if(!items.some(x=>x.channelId===channelId&&x.userId===userId))fail(404,'CONVERSATION_NOT_FOUND');
  try{return await profileService.lookup({propertyId,channelId,userId});}catch{return {displayName:null};}
}
module.exports={lineProfileRoute};
