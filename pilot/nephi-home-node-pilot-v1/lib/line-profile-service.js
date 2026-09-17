"use strict";
const fallback=()=>({displayName:null});
function createLineProfileService({store,bindingService,fetchImpl=globalThis.fetch}){
  async function request(path,token){
    const response=await fetchImpl(`https://api.line.me/v2/bot/${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000),redirect:'error'});
    if(!response.ok)throw Object.assign(Error('LINE_PROFILE_UNAVAILABLE'),{result:response.status===404?'unavailable':response.status===401||response.status===403?'forbidden':response.status===429?'rate_limited':'provider_error'});
    return response.json();
  }
  return {
    async decorateConversations(propertyId,items){
      try{
        const names=await store?.readNames({propertyId});
        if(!Array.isArray(names))return items;
        const key=x=>JSON.stringify([x.channelId,x.userId]);
        const byIdentity=new Map(names.map(x=>[key(x),x.displayName]));
        return items.map(item=>byIdentity.has(key(item))?{...item,displayName:byIdentity.get(key(item))}:item);
      }catch{return items;}
    },
    async observe(input){
      if(typeof input?.destination!=='string'||!input.destination||!input.credentialVersion)return null;
      try{return await store?.observe(input);}catch{return null;}
    },
    async lookup(input){
      let claim;
      try{
        claim=await store?.claim(input);if(!claim)return fallback();
        if(claim.kind==='cached')return {displayName:claim.displayName};
        const binding=bindingService?.resolveProfile(input.propertyId,input.channelId,claim.credentialVersion);
        if(!binding)throw Object.assign(Error('SOURCE_UNAVAILABLE'),{result:'source_mismatch'});
        const bot=await request('info',binding.channelAccessToken);
        if(bot.userId!==claim.destination)throw Object.assign(Error('SOURCE_MISMATCH'),{result:'source_mismatch'});
        const profile=await request(`profile/${encodeURIComponent(input.userId)}`,binding.channelAccessToken);
        if(profile.userId!==input.userId||typeof profile.displayName!=='string'||!profile.displayName.trim()||[...profile.displayName].length>256)throw Object.assign(Error('PROFILE_INVALID'),{result:'invalid_response'});
        // Deliberate field projection: never pass the original response to storage.
        return await store.finish({...input,...claim,result:'success',displayName:profile.displayName})||fallback();
      }catch(error){
        if(claim?.kind==='lookup')try{await store.finish({...input,...claim,result:error.result||'provider_error'});}catch{}
        return fallback();
      }
    }
  };
}
module.exports={createLineProfileService};
