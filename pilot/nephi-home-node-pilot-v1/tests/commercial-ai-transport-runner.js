"use strict";
// FAKE_INTEGRATION: isolated PostgreSQL-compatible storage and fake Luna/LINE.
const assert=require('node:assert/strict');
const {setup}=require('./helpers/burst-production-fixture');
(async()=>{
 const x=await setup('commercial-control',{pg:true,debounce:0});
 try{
  const store=x.providers.commercial;
  assert.equal(typeof store?.setLimit,'function','production app must expose persistent commercial control');
  store.setLimit('audit_a',20);store.setLimit('audit_b',20);
  store.setAiEnabled('audit_a',false);
  await x.post([x.event('disabled')]);await x.done('disabled');
  assert.equal(x.record('disabled').guestMessage,'請問入住時間？');assert.equal(x.calls.length,0);assert.equal(x.sent.length,0);assert.equal(x.record('disabled').processingStatus,'no_reply');
  const disabled=x.record('disabled');const conversation=store.listConversations('audit_a')[0];assert.equal(conversation.messagePreview,disabled.guestMessage);assert.ok(conversation.lastMessageAt);store.setAiEnabled('audit_a',true);store.setHandoff('audit_a',disabled.channelId,'audit-user',true);
  await x.post([x.event('handoff')]);await x.done('handoff');assert.equal(x.calls.length,0);assert.equal(x.sent.length,0);
  const other=x.event('other');other.source.userId='other-user';await x.post([other]);await x.done('other');assert.equal(x.sent.length,1);assert.equal(store.getStatus('audit_a').used,1);
  await x.post([other]);assert.equal(store.getStatus('audit_a').used,1,'LINE resend must not charge again');
  store.setHandoff('audit_a',disabled.channelId,'audit-user',false);store.setLimit('audit_a',1);
  await x.post([x.event('exhausted')]);await x.done('exhausted');assert.equal(x.record('exhausted').processingStatus,'no_reply');assert.equal(x.sent.length,1);
  const reserve=store.reserve;store.reserve=()=>{throw Error('DB_UNAVAILABLE');};await x.post([x.event('db-down')]);await x.done('db-down');store.reserve=reserve;assert.equal(x.sent.length,1);assert.equal(x.calls.length,1);
  const session=x.providers.persistence.getAdminSession;x.providers.persistence.getAdminSession=()=>({propertyId:'audit_a',username:'owner'});
  const status=await fetch(x.server.url+'/api/ai-controls',{headers:{cookie:'nephi_admin_session=local-session'}});assert.equal(status.status,200);assert.equal((await status.json()).data.used,1);
  const forbidden=await fetch(x.server.url+'/api/ai-controls',{method:'PUT',headers:{cookie:'nephi_admin_session=local-session','content-type':'application/json'},body:JSON.stringify({monthlyLimit:999})});assert.equal(forbidden.status,403);assert.equal(store.getStatus('audit_a').monthlyLimit,1);
  const cross=await fetch(x.server.url+'/api/ai-controls?propertyId=audit_b',{headers:{cookie:'nephi_admin_session=local-session'}});assert.equal(cross.status,403);x.providers.persistence.getAdminSession=session;
 }finally{await x.app.stop();}
 const y=await setup('commercial-correction',{pg:true,debounce:0,providerResponse(payload,attempt){payload.usage={input_tokens:100,input_tokens_details:{cached_tokens:30},output_tokens:10,total_tokens:110};if(attempt===1){const out=JSON.parse(payload.output[0].content[0].text);out.understandingOutput.units[0].confidenceBand='invalid';payload.output[0].content[0].text=JSON.stringify(out);}return payload;}});
 try{y.providers.commercial.setLimit('audit_a',2);await y.post([y.event('corrected')]);await y.done('corrected');assert.equal(y.sent.length,1);assert.equal(y.calls[0].mockCalls,2);assert.equal(y.providers.commercial.getStatus('audit_a').used,1);}finally{await y.app.stop();}
 console.log('PASS commercial message persistence/zero-call switches/quota/retry/property/HTTP authority/correction integration');
})().catch(e=>{console.error(e);process.exitCode=1;});
