'use strict';
// FAKE_INTEGRATION: persisted isolated PGlite, real migrations/store; no external AI.
// Catches lost legacy links/history, absent existing/future provisioning, alias scope
// leaks, duplicate canonical IDs, restart instability, or split abuse budgets.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{
 const connection={kind:'pglite',dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'feedback-short-'))};
 const {openPostgres}=require('../lib/providers/postgres-client'),{migratePostgres}=require('../lib/providers/postgres-migrate');
 let db=await openPostgres(connection);
 try{
  await db.exec('CREATE TABLE schema_migrations(filename text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of fs.readdirSync(path.resolve(__dirname,'../migrations')).filter(f=>f.endsWith('.sql')&&f<'030').sort()){
   await db.exec(fs.readFileSync(path.resolve(__dirname,'../migrations',file),'utf8'));await db.query('INSERT INTO schema_migrations(filename) VALUES($1)',[file]);
  }
  for(const id of ['short_a','short_b'])await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$1)',[id]);
  const legacy=crypto.randomBytes(32).toString('base64url');await db.query('INSERT INTO property_feedback_links(property_id,public_token) VALUES($1,$2)',['short_a',legacy]);
  await db.query("INSERT INTO guest_feedback(id,property_id,overall,comment,internal_note) VALUES($1,'short_a',4,'歷史留言','PRIVATE_HISTORY')",[crypto.randomUUID()]);
  const history=(await db.query('SELECT * FROM guest_feedback')).rows;
  await db.close();await migratePostgres(connection);db=await openPostgres(connection);
  const rows=(await db.query('SELECT * FROM property_feedback_links ORDER BY property_id')).rows;
  assert.equal(rows.length,2,'030 must provision every existing property, including one without a legacy link');
  for(const row of rows)assert.match(row.short_public_id,/^[A-Za-z0-9_-]{16}$/);
  assert.equal(rows[0].public_token,legacy);assert.notEqual(rows[0].short_public_id,rows[1].short_public_id);
  assert.deepEqual((await db.query('SELECT * FROM guest_feedback')).rows,history,'migration cannot rewrite history');
  const {createFeedbackStore}=require('../lib/guest-feedback-store');let store=createFeedbackStore({db});
  const a=await store.shortLink('short_a'),b=await store.shortLink('short_b');
  assert.equal(await store.resolve(a),'short_a');assert.equal(await store.resolve(legacy),'short_a');assert.equal(await store.resolve(b),'short_b');
  assert.equal(await store.link('short_a'),legacy);
  await assert.rejects(()=>db.query('UPDATE property_feedback_links SET short_public_id=$1 WHERE property_id=$2',[a,'short_b']),e=>e.code==='23505');
  await assert.rejects(()=>db.query('UPDATE property_feedback_links SET short_public_id=$1 WHERE property_id=$2',['guessable','short_b']),e=>e.code==='23514');
  await db.query("INSERT INTO properties(property_id,display_name) VALUES('short_future','Future')");
  const concurrent=await Promise.all(Array.from({length:16},()=>store.shortLink('short_future')));assert.equal(new Set(concurrent).size,1);assert.match(concurrent[0],/^[A-Za-z0-9_-]{16}$/);
  assert.equal((await db.query("SELECT count(*)::int n FROM property_feedback_links WHERE property_id='short_future'")).rows[0].n,1);
  for(const id of ['unknown','x'.repeat(16),'x'.repeat(43)])await assert.rejects(()=>store.resolve(id),e=>e.status===404);
  await store.submit(a,{overall:5},'short-visitor');await store.submit(legacy,{overall:3},'legacy-visitor');await store.submit(b,{overall:1},'b-visitor');
  assert.equal((await store.summary('short_a')).average,4);assert.equal((await store.list('short_b')).items.length,1);
  for(let i=0;i<10;i++)await store.submit(i%2?a:legacy,{overall:5},'same-visitor');
  await assert.rejects(()=>store.submit(a,{overall:5},'same-visitor'),e=>e.status===429);await assert.rejects(()=>store.submit(legacy,{overall:5},'same-visitor'),e=>e.status===429);
  await db.close();db=await openPostgres(connection);store=createFeedbackStore({db,now:()=>new Date('2027-02-01T00:00:00Z')});
  assert.equal(await store.shortLink('short_a'),a);assert.equal(await store.link('short_a'),legacy);assert.equal(await store.shortLink('short_future'),concurrent[0]);
  const before=(await db.query('SELECT * FROM guest_feedback ORDER BY id')).rows;await store.rotate('short_a');await assert.rejects(()=>store.resolve(a),e=>e.status===404);await assert.rejects(()=>store.resolve(legacy),e=>e.status===404);assert.deepEqual((await db.query('SELECT * FROM guest_feedback ORDER BY id')).rows,before);
  console.log('PASS existing/future/concurrent/stable/reopen/month/legacy/history/unique/check/isolation/shared-rate-limit/rotation; FAKE_INTEGRATION; REAL_OPENAI_CALLS=0');
 }finally{await db.close();fs.rmSync(connection.dataDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
