'use strict';
// FAKE_INTEGRATION: isolated persisted PGlite; no operational data or external AI.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const connection={kind:'pglite',dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'feedback-'))};
 await require('../lib/providers/postgres-migrate').migratePostgres(connection);
 const db=await require('../lib/providers/postgres-client').openPostgres(connection);
 try {
  for(const id of ['a','b']){await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$1)',[id]);await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,position) VALUES($1,$2,$3,2,0)",[id,id+'room',id+'套房']);}
  const {createFeedbackStore}=require('../lib/guest-feedback-store');
  let store=createFeedbackStore({db,now:()=>new Date('2026-09-18T04:00:00Z')});
  const a=await store.link('a'),b=await store.link('b');
  assert.notEqual(a,b);assert.match(a,/^[A-Za-z0-9_-]{43}$/);assert.equal(await store.link('a'),a);
  await assert.rejects(()=>store.submit('unknown',{overall:5},'ip'),e=>e.status===404);
  await assert.rejects(()=>store.submit(a,{overall:0},'ip'),e=>e.status===400);
  await assert.rejects(()=>store.submit(a,{overall:5,roomId:'broom'},'ip'),e=>e.status===400);
  await assert.rejects(()=>store.submit(a,{overall:5,comment:'x'.repeat(2001)},'ip'),e=>e.status===400);
  await assert.rejects(()=>store.submit(a,{overall:5,stayDate:'2026-02-30'},'ip'),e=>e.status===400);
  for(const stayDate of ['2026-13-01','2026-09-00'])await assert.rejects(()=>store.submit(a,{overall:5,stayDate},'ip'),e=>e.status===400);
  await assert.rejects(()=>store.submit(a,{overall:5,improvements:['none','noise']},'ip'),e=>e.status===400);
  await assert.rejects(()=>store.submit(a,{overall:5,propertyId:'b'},'ip'),e=>e.status===400);
  await store.submit(a,{overall:5,ratings:{cleanliness:5,comfort:5,equipment:4,arrival:5,noise:3},positives:['clean','arrival'],improvements:['noise'],revisit:'yes',comment:'<script>alert(1)</script>'},'ip');
  await store.submit(a,{overall:3,ratings:{cleanliness:3,noise:1},positives:['clean'],improvements:['noise','bed'],stayDate:'2026-09-17',roomId:'aroom'},'ip');
  await store.submit(b,{overall:1},'ip');
  let page=await store.list('a',{});assert.equal(page.items.length,2);assert.equal(page.items.find(x=>x.overall===5).stay_date,null);
  const id=page.items.find(x=>x.overall===3).id;
  await assert.rejects(()=>store.update('b',id,{status:'improved',internalNote:'leak'}),e=>e.status===404);
  for(const status of ['viewed','needs_improvement','improved','unviewed'])assert.equal((await store.update('a',id,{status,internalNote:'9/25 改善'})).status,status);
  await store.update('a',id,{status:'needs_improvement',internalNote:'private'});
  let s=await store.summary('a');assert.equal(s.average,4);assert.equal(s.monthCount,2);assert.equal(s.unviewed,1);assert.equal(s.needsImprovement,1);assert.equal(s.categories.cleanliness,4);assert.equal(s.categories.noise,2);assert.deepEqual(s.positives,[{key:'clean',count:2},{key:'arrival',count:1}]);assert.deepEqual(s.improvements,[{key:'noise',count:2},{key:'bed',count:1}]);
  assert.equal((await store.list('a',{status:'needs_improvement',rating:'low'})).items.length,1);
  assert.equal((await store.list('a',{rating:'5'})).items.length,1);
  await db.query("UPDATE guest_feedback SET created_at='2026-08-15T00:00:00Z' WHERE property_id='a' AND id=$1",[id]);
  assert.equal((await store.list('a',{period:'previous'})).items.length,1);
  assert.equal((await store.list('a',{period:'custom',from:'2026-08-01',to:'2026-08-31'})).items.length,1);
  assert.equal((await store.summary('a')).monthCount,1);
  for(let i=0;i<24;i++)await store.submit(a,{overall:4},'visitor'+i);
  page=await store.list('a',{});assert.equal(page.items.length,20);assert.ok(page.nextCursor);
  const next=await store.list('a',{cursor:page.nextCursor});assert.equal(next.items.length,6);assert.equal(new Set([...page.items,...next.items].map(x=>x.id)).size,26);
  await db.close();const reopened=await require('../lib/providers/postgres-client').openPostgres(connection);store=createFeedbackStore({db:reopened,now:()=>new Date('2026-09-18T04:00:00Z')});
  assert.equal(await store.link('a'),a);assert.equal((await store.summary('a')).average,4);
  const rotated=await store.rotate('a');assert.notEqual(rotated,a);await assert.rejects(()=>store.submit(a,{overall:5},'ip'),e=>e.status===404);assert.equal((await store.list('a',{})).items.length,20);
  for(let i=0;i<10;i++)await store.submit(rotated,{overall:5},'abuse');
  await assert.rejects(()=>store.submit(rotated,{overall:5},'abuse'),e=>e.status===429);
  await reopened.close();console.log('PASS persistence/reopen/fixed link/rotation/isolation/validation/statistics/history/status/notes/keyset/rate limit (FAKE_INTEGRATION); REAL_OPENAI_CALLS=0');
 }finally{try{await db.close()}catch{}fs.rmSync(connection.dataDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
