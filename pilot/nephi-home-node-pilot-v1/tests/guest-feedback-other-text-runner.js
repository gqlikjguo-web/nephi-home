'use strict';
// FAKE_INTEGRATION: isolated persisted PGlite, no external services.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const connection={kind:'pglite',dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'feedback-other-'))};
 await require('../lib/providers/postgres-migrate').migratePostgres(connection);
 let db=await require('../lib/providers/postgres-client').openPostgres(connection);
 try{
  for(const id of ['other_a','other_b'])await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$1)',[id]);
  let store=require('../lib/guest-feedback-store').createFeedbackStore({db});const a=await store.shortLink('other_a'),b=await store.shortLink('other_b');
  await store.submit(a,{overall:5,positives:['other'],improvements:['other'],positiveOtherText:'  陽台很舒服  ',improvementOtherText:'  停車入口不好找  ',comment:'獨立留言'},'both');
  let item=(await store.list('other_a')).items[0];assert.equal(item.positive_other_text,'陽台很舒服');assert.equal(item.improvement_other_text,'停車入口不好找');assert.equal(item.comment,'獨立留言');
  assert.equal((await store.list('other_b')).items.length,0);await assert.rejects(()=>store.update('other_b',item.id,{status:'viewed'}),e=>e.status===404);
  for(const [field,category] of [['positiveOtherText','positives'],['improvementOtherText','improvements']]){
   for(const value of ['hidden','x'.repeat(501),42,'bad\u0000'])await assert.rejects(()=>store.submit(a,{overall:5,[field]:value},'invalid'),e=>e.status===400);
   await assert.rejects(()=>store.submit(a,{overall:5,[category]:['other'],[field]:'x'.repeat(501)},'long'),e=>e.status===400);
   await store.submit(b,{overall:4,[category]:['other'],[field]:'x'.repeat(500)},field);
  }
  await store.submit(b,{overall:3,positiveOtherText:'   ',improvementOtherText:''},'empty');
  const empty=(await store.list('other_b')).items.find(x=>x.overall===3);assert.equal(empty.positive_other_text,null);assert.equal(empty.improvement_other_text,null);
  await store.submit(a,{overall:4},'legacy-client');const legacy=(await store.list('other_a')).items.find(x=>x.overall===4);assert.equal(legacy.positive_other_text,null);assert.equal(legacy.improvement_other_text,null);
  assert.deepEqual((await store.summary('other_a')).positives,[{key:'other',count:1}]);assert.deepEqual((await store.summary('other_a')).improvements,[{key:'other',count:1}]);
  await assert.rejects(()=>db.query('UPDATE guest_feedback SET positive_other_text=$1 WHERE id=$2',['hidden',legacy.id]),e=>e.code==='23514');
  await db.close();db=await require('../lib/providers/postgres-client').openPostgres(connection);store=require('../lib/guest-feedback-store').createFeedbackStore({db});item=(await store.list('other_a')).items.find(x=>x.overall===5);assert.equal(item.positive_other_text,'陽台很舒服');assert.equal(item.improvement_other_text,'停車入口不好找');assert.equal(await store.shortLink('other_a'),a);
  console.log('PASS separate other text/trim/null/500 limit/category validation/old clients/persistence/isolation/category-only rankings; FAKE_INTEGRATION; REAL_OPENAI_CALLS=0');
 }finally{await db.close();fs.rmSync(connection.dataDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
