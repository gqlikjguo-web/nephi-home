'use strict';
// FAKE_INTEGRATION: isolated persisted PGlite + actual catalog/core; zero OpenAI/LINE.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { answer } = require('./custom-arrival-departure-text-runner');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function run() {
 const connection = {kind:'pglite',dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'property-images-'))};
 await require('../lib/providers/postgres-migrate').migratePostgres(connection);
 let db = await require('../lib/providers/postgres-client').openPostgres(connection);
 try {
  assert.equal((await db.query("SELECT to_regclass('public.property_explanation_images') AS name")).rows[0].name,'property_explanation_images','persisted property-owned image table is required');
  const properties = {};
  for(const id of ['image_alpha','image_beta']){
   properties[id]={propertyId:id,displayName:'Lodge',rooms:[],commonAnswers:{},propertyFacts:[{canonicalId:'parking',category:'policy',publicName:'停車',status:'allowed',publicText:id==='image_alpha'?'請將車輛停在指定停車區。':'請使用入口旁的停車區。'}]};
   await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$2)',[id,'Lodge']);
   await db.query('INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)',[id,JSON.stringify(properties[id])]);
  }
  const make=()=>require('../lib/property-image-store').createPropertyImageStore({db,publicBaseUrl:'https://images.example.test'});
  let store=make();
  const a=await store.save('image_alpha','parking',PNG),b=await store.save('image_beta','parking',PNG);
  assert.notEqual(a.originalContentUrl,b.originalContentUrl);assert.match(a.originalContentUrl,/^https:\/\/images\.example\.test\/media\/[A-Za-z0-9_-]{32}\/original$/);
  assert.equal(JSON.stringify(a).includes('image_alpha'),false,'public identity must not expose property ID');
  assert.equal((await store.list('image_alpha')).length,1);
  for(const bad of [Buffer.from('<svg onload="alert(1)"/>'),Buffer.from('not an image'),Buffer.alloc(8*1024*1024+1)])await assert.rejects(()=>store.save('image_alpha','parking',bad));
  await assert.rejects(()=>store.save('image_alpha','not-a-formal-source',PNG),e=>e.status===400);
  const token=new URL(a.originalContentUrl).pathname.split('/')[2];
  assert.equal((await store.publicImage(token,'original')).content[0],255);
  assert.equal((await store.publicImage(token,'preview')).contentType,'image/jpeg');
  const r=await answer(properties.image_alpha,'parking');
  assert.equal(r.finalResponse.replyText,'請將車輛停在指定停車區。');
  const validator=require('../lib/conversation-engine-v2/claim-validator');
  assert.deepEqual(validator.finalResponseImageSources(r.finalResponse),['parking']);
  const images=await store.attachments('image_alpha',['parking']);
  const response=validator.attachFinalResponseImages(r.finalResponse,images);
  assert.equal(response.replyText,'請將車輛停在指定停車區。');assert.equal(response.action,'reply');
  assert.equal(response.attachments.length,1);assert.equal(response.attachments[0].originalContentUrl,a.originalContentUrl);
  assert.ok(validator.isValidatedFinalResponse(response,{propertyId:'image_alpha',turnId:'event',eventId:'event'}));
  assert.throws(()=>validator.attachFinalResponseImages(r.finalResponse,awaitNever()),/image/);
  function awaitNever(){return [{...images[0]}];} // A copied receipt cannot forge provider provenance.
  assert.throws(()=>validator.attachFinalResponseImages(r.finalResponse,[{propertyId:'image_alpha',sourceId:'parking',originalContentUrl:'https://evil.example/a'}]),/image/);
  assert.throws(()=>validator.attachFinalResponseImages(r.finalResponse,[] .concat(b)),/image/);
  const beta=await store.attachments('image_beta',['parking']);
  assert.throws(()=>validator.attachFinalResponseImages(r.finalResponse,beta),/image/);
  const unknown=await answer({...properties.image_alpha,propertyFacts:[]},'parking');
  assert.deepEqual(validator.finalResponseImageSources(unknown.finalResponse),[]);
  assert.throws(()=>validator.attachFinalResponseImages(unknown.finalResponse,images),/image/);
  // Regression: a bundle catalog fact can override a property card with the same ID.
  const collision={...properties.image_alpha,propertyFacts:[{canonicalId:'bbq',category:'amenity',publicName:'烤肉',status:'allowed',publicText:'一般烤肉說明。'}],rooms:[{id:'bundle',name:'包棟方案',inventoryType:'bundle',enabled:true,entertainmentAmenities:[{key:'bbq',provided:true,statusSource:'operator',note:'僅包棟露台使用。',source:'preset'}]}]};
  const propertyReply=await answer({...collision,rooms:[]},'bbq',{capability:'amenity',kind:'amenity'});
  assert.equal(propertyReply.finalResponse.replyText,'一般烤肉說明。');
  assert.deepEqual(validator.finalResponseImageSources(propertyReply.finalResponse),['bbq'],'registered capabilities use formal source identity, not a capability-name whitelist');
  const bundleReply=await answer(collision,'bbq',{capability:'amenity',kind:'amenity'});
  assert.equal(bundleReply.artifacts.executionOutcomes[0].facts.answer,'僅包棟露台使用。');
  assert.deepEqual(validator.finalResponseImageSources(bundleReply.finalResponse),[],'same canonical ID from bundle source cannot use property-card image');
  await db.close();db=await require('../lib/providers/postgres-client').openPostgres(connection);store=make();
  assert.equal((await store.list('image_alpha'))[0].originalContentUrl,a.originalContentUrl);
  const replacement=await store.save('image_alpha','parking',PNG);assert.notEqual(replacement.originalContentUrl,a.originalContentUrl);
  assert.equal(await store.publicImage(token,'original'),null);
  await store.remove('image_alpha','parking');assert.equal((await store.list('image_alpha')).length,0);assert.equal((await store.list('image_beta')).length,1);
  assert.equal((await db.query('SELECT settings FROM property_settings WHERE property_id=$1',['image_alpha'])).rows[0].settings.propertyFacts[0].publicText,'請將車輛停在指定停車區。');
  console.log('PASS image persistence/restart/replacement/deletion, property isolation, file validation, exact formal-source attachments, sealed provenance, unchanged independent final text; FAKE_INTEGRATION; OPENAI_CALLS=0');
 } finally {await db.close();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={PNG};
