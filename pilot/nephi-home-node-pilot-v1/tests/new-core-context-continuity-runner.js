// FAKE_INTEGRATION: preserved production-wiring and history-publication RED cases. No real providers.
"use strict";
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {setup}=require('./helpers/burst-production-fixture');
test('approved continuity: completed first event reaches next production C01',async()=>{
 const x=await setup('context-wiring-red',{debounce:0,pg:true});let seen;
 try{await x.post([x.event('context-first')]);await x.done('context-first');await x.post([x.event('context-next')]);await x.done('context-next');seen=x.calls[1];}
 finally{await x.app.stop();}
 console.log(JSON.stringify({level:'FAKE_INTEGRATION',case:'wiring',priorRevision:seen.priorRevision,history:seen.c01.recentConversation,cycles:seen.c01.referenceableCycles}));
 assert.ok(seen.priorRevision>0,'first turn really persisted State');
 assert.ok(seen.c01.recentConversation.some(e=>e.eventId==='context-first'),'validated prior message must reach C01');
 assert.ok(seen.c01.referenceableCycles.length>0,'validated prior cycle must reach C01');
});
test('approved continuity: saved State and processing message expose one coherent completed core turn',async()=>{
 const x=await setup('context-history-red',{debounce:0,pg:true});const p=x.providers.persistence,original=p.updateMessageEvent.bind(p);let entered,release;
 const reached=new Promise(r=>entered=r),hold=new Promise(r=>release=r);let observed;
 p.updateMessageEvent=(property,channel,event,patch)=>{
  if(event==='timing-first'&&patch.processingStatus==='reply_succeeded'){entered();return hold.then(()=>original(property,channel,event,patch));}
  return original(property,channel,event,patch);
 };
 try{
  await x.post([x.event('timing-first')]);await reached;
  const scope=x.calls[0].scope;
  observed={state:p.getConversationState(scope.propertyId,scope.channel,scope.userId),first:x.record('timing-first'),history:p.listRecentMessages(scope.propertyId,scope.channel,scope.userId,{limit:10})};
 }finally{release();await x.done('timing-first');await x.app.stop();}
 console.log(JSON.stringify({level:'FAKE_INTEGRATION',case:'history-barrier',revision:observed.state.revision,status:observed.first.processingStatus,eventCycles:observed.first.requestCycleRefs,history:observed.history}));
 assert.ok(observed.state.revision>0);assert.ok(observed.first.requestCycleRefs.length>0);
 assert.ok(observed.history.some(e=>e.eventId==='timing-first'),'validated turn must become referenceable before delivery completion');
});
test('next actual webhook reads the saved predecessor before its LINE delivery starts',async()=>{
 const x=await setup('context-in-flight',{debounce:0,pg:true});
 const p=x.providers.persistence,update=p.updateMessageEvent.bind(p);let entered,release;
 const reached=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 p.updateMessageEvent=async(property,channel,event,patch)=>{
  const value=await update(property,channel,event,patch);
  if(event==='held-first'&&patch.replyType==='reply_v2'){entered();await hold;}
  return value;
 };
 try{
  await x.post([x.event('held-first')]);await reached;
  assert.equal(x.sent.length,0,'first event delivery has not started');
  const saved=p.getConversationState(x.calls[0].scope.propertyId,x.calls[0].scope.channel,x.calls[0].scope.userId);
  assert.ok(saved.revision>0);
  await x.post([x.event('following'),x.event('following')]);await x.done('following');
  assert.deepEqual(x.calls.map(call=>call.event),['held-first','following']);
  assert.equal(x.calls[1].priorRevision,saved.revision);
  assert.deepEqual(x.calls[1].c01.sourceEvents.map(event=>event.eventId),['following']);
  const prior=x.calls[1].c01.recentConversation.find(event=>event.eventId==='held-first');
  assert.ok(prior);assert.deepEqual(prior.referenceableCycleIds,x.record('held-first').requestCycleRefs);
  assert.ok(prior.referenceableCycleIds.every(id=>saved.tasks.some(task=>task.taskId===id)));
  assert.equal(x.record('held-first').processingStatus,'decided');
  assert.deepEqual(x.sent.map(send=>send.replyToken),['local-following']);
  console.log(JSON.stringify({level:'FAKE_INTEGRATION',case:'actual-next-before-delivery',revision:saved.revision,
   history:x.calls[1].c01.recentConversation,source:x.calls[1].c01.sourceEvents}));
 }finally{release();await x.done('held-first');await x.app.stop();}
});
