"use strict";
// RUNTIME_COMPONENT_TEST: production read model/routes, isolated PGlite; no external services.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
(async () => {
  const file = path.join(__dirname, '../lib/providers/commercial-ai-read-model.js');
  assert.ok(fs.existsSync(file), 'scoped usage/history read model is required');
  const { readCommercialUsage, readConversations, readHistory } = require(file);
  const { commercialAiRoute: route } = require('../lib/commercial-ai-routes');
  const { commercialOperation } = require('../lib/providers/commercial-ai-store');
  const { PGlite } = await import('@electric-sql/pglite'); const db = new PGlite();
  try {
    for (const f of fs.readdirSync(path.join(__dirname,'../migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',f),'utf8'));
    await db.exec("INSERT INTO properties(property_id,display_name) VALUES('a','Synthetic A'),('b','Synthetic B')");
    await db.exec("INSERT INTO commercial_ai_controls(property_id,monthly_limit) VALUES('a',10),('b',20)");
    await db.exec("INSERT INTO commercial_ai_monthly_usage(property_id,period,used) SELECT 'a',to_char(now() AT TIME ZONE 'Asia/Taipei','YYYY-MM'),2");
    await db.exec("INSERT INTO commercial_ai_message_ledger(property_id,event_id,channel_id,line_user_id,period) SELECT 'a','e'||n,'c','u',to_char(now() AT TIME ZONE 'Asia/Taipei','YYYY-MM') FROM generate_series(1,2) n");
    await db.exec("INSERT INTO commercial_ai_handoffs(property_id,channel_id,line_user_id,human_controlled) VALUES('a','c','u',true)");
    for(const [id,c,u,text] of [['a','c','u','A'],['a','c','other','Other guest'],['a','other','u','Other channel'],['b','c','u','Other property']]) {
      await db.query("INSERT INTO message_logs(property_id,channel_id,line_user_id,event_id,review_id,processing_status,payload) SELECT $1,$2,$3,$2||$3||'event'||n,$2||$3||'review'||lpad(n::text,3,'0'),'reply_succeeded',jsonb_build_object('guestMessage',$4::text||n,'replyText','AI reply','replyDelivered',true,'secret','must not escape') FROM generate_series(1,101) n",[id,c,u,text]);
    }
    const usage=await readCommercialUsage(db,'a'); assert.equal(usage.today,2); assert.equal(usage.week,2); assert.equal((await readCommercialUsage(db,'b')).today,0);
    const conversations=await readConversations(db,'a'); assert.equal(conversations.length,3);
    assert.equal(conversations.find(x=>x.channelId==='c'&&x.userId==='u').humanControlled,true);
    const store={listConversations:id=>readConversations(db,id),getUsage:id=>readCommercialUsage(db,id),getHistory:(...args)=>readHistory(db,...args)};
    const base={path:'/api/ai-controls/history',method:'GET',session:{propertyId:'a',properties:[{propertyId:'a'}]},store,query:new URLSearchParams({propertyId:'a',channelId:'c',userId:'u'})};
    const page=await route(base);assert.equal(page.items.length,100);assert.ok(page.nextCursor);
    assert.ok(page.items.every(x=>x.guestMessage.startsWith('A')&&!Object.hasOwn(x,'secret')));
    const older=await route({...base,query:new URLSearchParams({propertyId:'a',channelId:'c',userId:'u',before:page.nextCursor})});assert.equal(older.items.length,1);assert.equal(older.nextCursor,null);
    assert.equal(new Set([...older.items,...page.items].map(x=>x.reviewId)).size,101,'all saved messages reachable without duplicate pagination');
    assert.equal(page.items[0].replyDelivered,true);
    await assert.rejects(()=>route({...base,session:null}),e=>e.status===401);
    await assert.rejects(()=>route({...base,session:{propertyId:'a',properties:[{propertyId:'b'}]}}),e=>e.status===403);
    await assert.rejects(()=>route({...base,query:new URLSearchParams({propertyId:'b',channelId:'c',userId:'u'})}),e=>e.status===403);
    await assert.rejects(()=>route({...base,query:new URLSearchParams({channelId:'c',userId:'missing'})}),e=>e.status===404);
    await assert.rejects(()=>route({...base,method:'PUT'}),e=>e.status===405);
    await assert.rejects(()=>route({...base,query:new URLSearchParams({channelId:'c',userId:'u',before:'bad'})}),e=>e.status===400);
    const other=await route({...base,query:new URLSearchParams({channelId:'c',userId:'other'})});assert.ok(other.items.every(x=>x.guestMessage.startsWith('Other guest')));
    await db.query("INSERT INTO message_logs(property_id,channel_id,line_user_id,event_id,review_id,payload) VALUES('a','c','u','old:review:task','review-system',$1::jsonb)",[JSON.stringify({guestMessage:'Original guest reference',replyType:'scoped_handoff_v2',route:'human_handoff_required',replyText:''})]);
    const withReview=await readHistory(db,'a','c','u');assert.equal(withReview.items.find(x=>x.reviewId==='review-system').recordKind,'review','saved system review must not impersonate another guest turn');
    const a=await commercialOperation({transaction:fn=>db.transaction(fn)},'getStatus',['a']); assert.equal(a.used,2);assert.equal(a.remaining,8);
    assert.equal((await db.query('SELECT count(*)::int n FROM commercial_ai_message_ledger')).rows[0].n,2,'reading never reserves quota');
    console.log('PASS usage from ledger, scoped history pagination, unchanged monthly authority, property/guest/channel isolation (RUNTIME_COMPONENT_TEST)');
  } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
