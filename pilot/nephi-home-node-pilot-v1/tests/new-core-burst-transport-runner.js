'use strict';
// FAKE_INTEGRATION: coordinator + actual C01 production projection, local engine stub.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ConversationEngineV2Coordinator,isMergedTransportResult}=require('../lib/conversation-engine-v2/coordinator');
async function run(){
 let input;const coordinator=new ConversationEngineV2Coordinator({schedule:()=>1,cancel:()=>{},externalReplyToken:true,engine:{process:async value=>{input=value;return {traceId:'group-trace',finalResponse:{shouldReply:true,replyText:'合法回覆'},requestCycleRefs:['cycle']};}}});
 const scope={customerId:'p',channelId:'c',lineUserId:'u'};
 const first={...scope,eventId:'early',eventTimestamp:Date.parse('2026-09-10T15:59:59Z'),messageText:'第一題'};
 const last={...scope,eventId:'late',eventTimestamp:Date.parse('2026-09-10T16:00:01Z'),messageText:'第二題'};
 const a=coordinator.enqueue(first),b=coordinator.enqueue(last);await coordinator.flush(coordinator.key(last));return {input,first,last,a:await a,b:await b};
}
test('each event retains its temporal anchor',async()=>{const r=await run();assert.deepEqual(r.input.sourceEvents.map(e=>e.eventTimestamp===undefined?undefined:new Date(e.eventTimestamp).toISOString()),['2026-09-10T15:59:59.000Z','2026-09-10T16:00:01.000Z']);});
test('merged result has scoped transport evidence, no invented FinalResponse',async()=>{const r=await run();assert.equal(r.a.finalResponse,undefined);assert.equal(r.a.traceId,r.b.traceId);assert.equal(isMergedTransportResult(r.a,r.first),true);assert.equal(r.a.transportDisposition.targetEventId,'late');assert.equal(r.a.shouldReply,false);assert.equal(r.b.shouldReply,true);});
test('merged evidence cannot be cloned or moved to another scope',async()=>{const r=await run();assert.equal(isMergedTransportResult({...r.a},r.first),false);for(const key of ['customerId','channelId','lineUserId','eventId'])assert.equal(isMergedTransportResult(r.a,{...r.first,[key]:'foreign'}),false);});
