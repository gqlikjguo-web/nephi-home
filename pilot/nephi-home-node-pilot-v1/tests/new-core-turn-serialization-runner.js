"use strict";
const assert = require('node:assert/strict');
const { ConversationEngineV2Coordinator } = require('../lib/conversation-engine-v2/coordinator');
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const entered = [], stored = new Map();
  const coordinator = new ConversationEngineV2Coordinator({
    schedule: () => 1, cancel: () => {}, externalReplyToken: true,
    engine: { async process(input) {
      entered.push(input.eventId);
      const scope = JSON.stringify([input.customerId, input.channelId, input.lineUserId]);
      const before = stored.get(scope) || [];
      if (input.eventId === 'first') await held;
      stored.set(scope, [...before, input.eventId]);
      return { finalResponse: { shouldReply: false } };
    } }
  });
  const input = {customerId:'p',channelId:'c',lineUserId:'u',messageText:'opaque',eventId:'first'};
  const one = coordinator.enqueue(input), f1 = coordinator.flush(coordinator.key(input));
  await tick();
  const two = coordinator.enqueue({...input,eventId:'second'}), f2 = coordinator.flush(coordinator.key(input));
  const otherInput = {...input,customerId:'other',eventId:'independent'};
  const other = coordinator.enqueue(otherInput), f3 = coordinator.flush(coordinator.key(otherInput));
  await tick();
  const premature = entered.includes('second');
  assert(entered.includes('independent'), 'Different scopes must remain concurrent');
  release();
  await Promise.all([one,two,other,f1,f2,f3]);
  assert.equal(premature,false,'Same-scope turn loaded before its predecessor saved State');
  assert.deepEqual(stored.get(JSON.stringify(['p','c','u'])),['first','second']);
  assert.notEqual(coordinator.key({...input,customerId:'p:c',channelId:'x'}),coordinator.key({...input,customerId:'p',channelId:'c:x'}),'Scope tuple encoding must be unambiguous');
  console.log('PASS FAKE_INTEGRATION same-scope serialization, other-scope concurrency, scope tuple identity');
})().catch(error=>{console.error(error);process.exitCode=1;});
