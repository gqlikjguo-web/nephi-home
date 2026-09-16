"use strict";
function failure(status,code){return Object.assign(new Error(code),{status,code});}
function only(body,keys){if(Object.keys(body).some(k=>!keys.includes(k)))throw failure(400,'AI_CONTROL_FIELDS_INVALID');}
async function commercialAiRoute({path,method,body={},query=new URLSearchParams(),session,platform,store}) {
  if(!session)throw failure(401,'LOGIN_REQUIRED');
  if(!store)throw failure(503,'COMMERCIAL_STORAGE_REQUIRED');
  if(path==='/api/platform/ai-controls') {
    if(!platform)throw failure(403,'PLATFORM_ADMIN_REQUIRED');
    const id=method==='GET'?query.get('propertyId'):body.propertyId;
    if(typeof id!=='string'||!id)throw failure(400,'PROPERTY_REQUIRED');
    if(method==='GET')return store.getStatus(id);
    if(method!=='PUT')throw failure(405,'METHOD_NOT_ALLOWED');
    only(body,['propertyId','monthlyLimit']);
    if(body.monthlyLimit!==null&&(!Number.isSafeInteger(body.monthlyLimit)||body.monthlyLimit<0))throw failure(400,'QUOTA_INVALID');
    return store.setLimit(id,body.monthlyLimit);
  }
  const id=session.propertyId;
  if(!id)throw failure(409,'PROPERTY_SELECTION_REQUIRED');
  if(Array.isArray(session.properties)&&!session.properties.some(property=>property.propertyId===id))throw failure(403,'PROPERTY_ACCESS_DENIED');
  for(const claimed of [query.get('propertyId'),query.get('customerId'),body.propertyId,body.customerId])if(claimed&&claimed!==id)throw failure(403,'PROPERTY_ACCESS_DENIED');
  if(path==='/api/ai-controls') {
    if(method==='GET')return store.getStatus(id);
    if(method!=='PUT')throw failure(405,'METHOD_NOT_ALLOWED');
    if(Object.hasOwn(body,'monthlyLimit'))throw failure(403,'PLATFORM_ADMIN_REQUIRED');
    only(body,['aiEnabled']);if(typeof body.aiEnabled!=='boolean')throw failure(400,'AI_SWITCH_INVALID');
    return store.setAiEnabled(id,body.aiEnabled);
  }
  if(path==='/api/ai-controls/usage') {
    if(method!=='GET')throw failure(405,'METHOD_NOT_ALLOWED');
    return store.getUsage(id);
  }
  if(!['/api/ai-controls/conversations','/api/ai-controls/history'].includes(path))throw failure(404,'NOT_FOUND');
  if(path==='/api/ai-controls/history'&&method!=='GET')throw failure(405,'METHOD_NOT_ALLOWED');
  const items=await store.listConversations(id);
  const channel=method==='GET'?query.get('channelId'):body.channelId,user=method==='GET'?query.get('userId'):body.userId;
  if(path==='/api/ai-controls/conversations'&&method==='GET'&&!channel&&!user)return {items};
  if(!items.some(item=>item.channelId===channel&&item.userId===user))throw failure(404,'CONVERSATION_NOT_FOUND');
  if(path==='/api/ai-controls/history')return store.getHistory(id,channel,user,query.get('before'));
  if(method==='GET')return store.getHandoff(id,channel,user);
  if(method!=='PUT')throw failure(405,'METHOD_NOT_ALLOWED');
  only(body,['channelId','userId','humanControlled']);if(typeof body.humanControlled!=='boolean')throw failure(400,'HANDOFF_INVALID');
  return store.setHandoff(id,channel,user,body.humanControlled);
}
module.exports={commercialAiRoute};
