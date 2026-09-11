"use strict";
// FAKE_INTEGRATION: signed local webhook, actual production core, mock OpenAI + LINE, JSON provider.
const assert=require('node:assert/strict');
const {setup}=require('./helpers/burst-production-fixture');
(async()=>{const x=await setup('burst',{debounce:20});try{
 await x.post([x.event('early','2026-09-10T15:59:59Z'),x.event('late','2026-09-10T16:00:01Z')]);
 await x.done('late');await x.done('early');
 const early=x.record('early'),late=x.record('late');
 console.log(JSON.stringify({classification:'FAKE_INTEGRATION',early,lateStatus:late.processingStatus,sourceEvents:x.calls[0].c01.sourceEvents,sends:x.sent.length}));
 assert.equal(early.processingStatus,'no_reply');
 assert.equal(early.decisionReason,'merged_into_turn');
 assert.ok(early.safeTrace.length>0);
 assert.equal(early.safeTrace[0].targetEventId,'late');
 assert.equal(early.requestCycleRefs?.length,1,'merged source event must retain its admitted cycle binding');
 assert.ok(late.requestCycleRefs.includes(early.requestCycleRefs[0]));
 assert.equal(late.processingStatus,'reply_succeeded');assert.equal(x.sent.length,1);assert.equal(x.calls.length,1);
 assert.deepEqual(x.calls[0].c01.sourceEvents.map(e=>e.timestamp),['2026-09-10T15:59:59.000Z','2026-09-10T16:00:01.000Z']);
 console.log('FAKE_INTEGRATION burst provenance + tail-only delivery PASS');
 }finally{await x.app.stop();}})().catch(error=>{console.error(error);process.exitCode=1;});
