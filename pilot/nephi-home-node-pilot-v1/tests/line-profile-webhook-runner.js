"use strict";
// RUNTIME_COMPONENT_TEST: signed local webhook + production providers, PGlite, fake LINE/Luna.
const assert=require('node:assert/strict');
const {setup}=require('./helpers/burst-production-fixture');
(async()=>{
  const originalFetch=globalThis.fetch;let requests=[];
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith('https://api.line.me/')){requests.push(String(url));return {ok:true,status:200,json:async()=>String(url).endsWith('/info')?{userId:'official-bot'}:{userId:'audit-user',displayName:'PRIVATE_PROFILE_NAME',pictureUrl:'DO_NOT_SAVE'}};}
    return originalFetch(url,options);
  };
  let x;
  try{
    x=await setup('profile-webhook',{pg:true,debounce:0});
    assert.equal(typeof x.providers.lineProfiles?.claim,'function','production provider must expose profile sidecar');
    x.providers.commercial.setAiEnabled('audit_a',false);
    const response=await x.binding.post(x.server.url,JSON.stringify({destination:'official-bot',events:[x.event('origin')]}));assert.equal(response.status,200);await x.done('origin');
    assert.equal(requests.length,0,'webhook never calls LINE Profile');assert.equal(x.calls.length,0);
    const identity=x.record('origin');
    x.providers.persistence.getAdminSession=()=>({propertyId:'audit_a',properties:[{propertyId:'audit_a'}]});
    const lookup=async(body)=>fetch(x.server.url+'/api/ai-controls/profile?propertyId=audit_a',{method:'POST',headers:{cookie:'nephi_admin_session=local-only','content-type':'application/json'},body:JSON.stringify(body)});
    const name=await lookup({channelId:identity.channelId,userId:'audit-user'});assert.equal(name.status,200);assert.equal((await name.json()).data.displayName,'PRIVATE_PROFILE_NAME');assert.equal(requests.length,2);
    assert.equal((await lookup({channelId:identity.channelId,userId:'other-user'})).status,404);assert.equal(requests.length,2);
    const handoff=x.providers.commercial.getHandoff('audit_a',identity.channelId,'audit-user');assert.equal(handoff.humanControlled,false);
    x.providers.commercial.setAiEnabled('audit_a',true);
    await x.post([x.event('after-profile')]);await x.done('after-profile');assert.equal(x.sent.length,1);assert.equal(x.providers.commercial.getStatus('audit_a').used,1);
    assert.ok(!JSON.stringify(x.calls).includes('PRIVATE_PROFILE_NAME'),'displayName never enters Understanding input');assert.ok(!JSON.stringify(x.record('after-profile')).includes('PRIVATE_PROFILE_NAME'),'profile never changes saved conversation');
    const observe=x.providers.lineProfiles.observe;x.providers.lineProfiles.observe=()=>{throw Error('PROFILE_DB_FAILURE')};
    await x.binding.post(x.server.url,JSON.stringify({destination:'official-bot',events:[x.event('profile-db-down')]}));await x.done('profile-db-down');assert.equal(x.sent.length,2,'profile storage failure cannot suppress the normal reply');x.providers.lineProfiles.observe=observe;
    let release;x.providers.lineProfiles.observe=()=>new Promise(r=>release=r);
    const ack=await Promise.race([x.binding.post(x.server.url,JSON.stringify({destination:'official-bot',events:[x.event('profile-delayed')]})),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('profile delayed webhook ACK')),1500);timer.unref();})]);
    assert.equal(ack.status,200);await x.done('profile-delayed');assert.equal(x.sent.length,3,'unresolved optional persistence does not block a reply');release();x.providers.lineProfiles.observe=observe;
    assert.equal(requests.length,2,'AI/message processing never fetches profile');
    console.log('PASS signed origin→profile route, zero webhook profile requests, unchanged controls/quota, no Luna exposure, profile failure isolation (RUNTIME_COMPONENT_TEST)');
  }finally{if(x)await x.app.stop();globalThis.fetch=originalFetch;}
})().catch(e=>{console.error(e);process.exitCode=1;});
