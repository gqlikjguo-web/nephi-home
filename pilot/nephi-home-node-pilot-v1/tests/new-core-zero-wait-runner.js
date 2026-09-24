
'use strict';
// UNIT_TEST + FAKE_INTEGRATION. No external OpenAI or LINE transport.
const assert = require('node:assert/strict');
const { runtimeConfig } = require('../config/runtime');
const { ConversationEngineV2Coordinator } = require('../lib/conversation-engine-v2/coordinator');
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  if (process.argv.includes('--context-only')) {
    const {setup}=require('./helpers/burst-production-fixture');
    const x=await setup('independent-context',{debounce:1});
    try {
      await x.post([x.event('prior')]);await x.done('prior');
      await x.post([x.event('next')]);await x.done('next');
      assert.ok(x.calls[1].priorRevision>x.calls[0].priorRevision);
      assert.ok(x.calls[1].c01.recentConversation.every(event=>event.eventId==='prior'),'Only the verified prior scoped event may enter C01');
      assert.ok(x.calls[1].c01.referenceableCycles.every(cycle=>x.core[0].state.tasks.some(task=>task.taskId===cycle.requestCycleId)),'Every semantic target must belong to persisted scoped State');
    } finally {await x.app.stop();}
    console.log('PASS immediate C01 input with scoped persisted State');return;
  }
  assert.equal(runtimeConfig({}).conversationDebounceMs, 0, 'Production default must not wait for another message');
  let release, timers = 0;
  const held = new Promise(resolve => { release = resolve; });
  const entered = [], snapshots = new Map();
  const c = new ConversationEngineV2Coordinator({
    debounceMs: 0,
    schedule: () => { timers++; throw new Error('ZERO_WAIT_MUST_NOT_SCHEDULE'); },
    engine: { async process(input) {
      const key = c.key(input);
      entered.push(input);
      const previous = snapshots.get(key) || [];
      if (input.eventId === 'first') await held;
      snapshots.set(key, [...previous, input.eventId]);
      return {traceId: input.eventId, requestCycleRefs: ['cycle-' + input.eventId],
        finalResponse: {shouldReply:true,replyText:'formal answer'}};
    }}
  });
  const base = {customerId:'property-a',channelId:'channel',lineUserId:'guest',messageText:'opaque',eventId:'first',replyToken:'token-first',eventTimestamp:123};
  const one = c.enqueue(base);
  const two = c.enqueue({...base,eventId:'second',replyToken:'token-second',eventTimestamp:456});
  const other = c.enqueue({...base,customerId:'property-b',eventId:'other'});
  await tick();
  assert.equal(timers,0);
  assert.deepEqual(entered.map(x=>x.eventId),['first','other']);
  assert.equal(c.pending.size,0,'Immediate mode must not retain a coalescing window');
  release();
  const [a,b] = await Promise.all([one,two,other]);
  assert.deepEqual(snapshots.get(c.key(base)),['first','second']);
  assert.deepEqual(entered[0].sourceEvents.map(x=>x.eventId),['first']);
  assert.deepEqual(entered[2].sourceEvents.map(x=>[x.eventId,x.eventTimestamp]),[['second',456]]);
  assert.deepEqual(a.requestCycleRefs,['cycle-first']);
  assert.deepEqual(b.requestCycleRefs,['cycle-second']);
  assert.equal(a.replyToken,'token-first');assert.equal(b.replyToken,'token-second');
  assert.equal((await c.enqueue(base)).duplicate,true);
  assert.equal(entered.length,3);
  console.log('PASS UNIT_TEST zero timer, immediate dispatch, same-guest ordering, scope isolation, source events, cycles, reply tokens, dedup');

  const {setup}=require('./helpers/burst-production-fixture');
  const x=await setup('zero-wait',{debounce:0,holdEvent:'first',pg:process.argv.includes('--postgres')});
  try {
    await x.post([x.event('first'),x.event('second'),x.event('first')]);
    await tick();
    assert.equal(x.app.lineWebhookCoordinator.debounceMs,0);
    assert.equal(x.app.lineWebhookCoordinator.pending.size,0);
    assert.deepEqual(x.calls.map(c=>c.event),['first']);
    x.release();
    await x.done('first');await x.done('second');
    assert.deepEqual(x.calls.map(c=>c.event),['first','second']);
    assert.equal(x.sent.length,2);
    assert.deepEqual(x.sent.map(s=>s.replyToken),['local-first','local-second']);
    for(const id of ['first','second']){
      assert.equal(x.record(id).processingStatus,'reply_succeeded');
      assert.equal(x.record(id).requestCycleRefs.length,1);
      assert.equal(x.core.find(c=>c.event===id).earliestFailure,null);
    }
    assert.ok(x.calls[1].priorRevision>x.calls[0].priorRevision);
    assert.ok(x.calls[1].c01.recentConversation.every(event=>event.eventId==='first'));
    assert.ok(x.calls[1].c01.referenceableCycles.every(cycle=>x.core[0].state.tasks.some(task=>task.taskId===cycle.requestCycleId)));
    await x.post([x.event('third')]);await x.done('third');
    assert.ok(x.calls[2].c01.recentConversation.every(event=>['first','second'].includes(event.eventId)));
    assert.ok(x.calls[2].c01.referenceableCycles.every(cycle=>x.core[1].state.tasks.some(task=>task.taskId===cycle.requestCycleId)));
    const ids=x.core.map(c=>c.state.tasks.map(t=>t.taskId));
    assert.ok(ids[1].includes(ids[0][0]),'Previous State remains persisted');
    assert.equal(new Set(x.core.flatMap(c=>c.state.tasks.map(t=>t.taskId))).size,3,'Each event owns a distinct request cycle');
    for (const c of x.calls) assert.deepEqual(c.c01.sourceEvents.map(e=>e.eventId),[c.event]);
    await x.post([x.event('third')]);await tick();
    assert.equal(x.sent.length,3);
    console.log('PASS FAKE_INTEGRATION signed local webhook, rapid events, duplicate claim, persisted State/history, validated delivery');
  } finally {x.release();await x.app.stop();}
})().catch(error=>{console.error(error);process.exitCode=1;});
