'use strict';
// FAKE_INTEGRATION: real isolated PGlite and image decoding; object storage double.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function fixture() {
  const connection = {kind:'pglite',dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'room-gallery-'))};
  await require('../lib/providers/postgres-migrate').migratePostgres(connection);
  const db = await require('../lib/providers/postgres-client').openPostgres(connection);
  for (const id of ['gallery_a','gallery_b']) {
    await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$1)',[id]);
    await db.query('INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,$2,$2,2,$3,$4,0)',[id,'double','room','']);
  }
  const objects = new Map(); let failPut = false, failDelete = false;
  const storage = {
    url:key=>'https://photos.example.test/'+key,
    async put(key,bytes){if(failPut && key.endsWith('preview.jpg'))throw Error('injected object failure');objects.set(key,Buffer.from(bytes));},
    async remove(key){if(failDelete)throw Error('injected delete failure');objects.delete(key);}
  };
  const make = () => require('../lib/room-gallery-store').createRoomGalleryStore({db,storage,report:()=>{}});
  return {db,objects,storage,make,setFailures:(put,del)=>{failPut=put;failDelete=del;}};
}
async function run() {
  assert.ok(fs.existsSync(path.resolve(__dirname,'../lib/room-gallery-store.js')),'room gallery store must exist');
  const f = await fixture(); const {db,objects,make} = f; let store=make();
  try {
    const columns=(await db.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='room_gallery_photos'")).rows;
    assert.ok(columns.length,'metadata schema exists');assert.ok(columns.every(x=>x.data_type!=='bytea'),'DB must not store photo binary');
    assert.deepEqual(await store.list('gallery_a','double'),[]);
    await assert.rejects(()=>store.add('gallery_a','not-formal',PNG),e=>e.status===404);
    for(const bytes of [Buffer.from('<svg/>'),Buffer.alloc(8*1024*1024+1)])await assert.rejects(()=>store.add('gallery_a','double',bytes));
    const a=(await store.add('gallery_a','double',PNG))[0];
    const b=(await store.add('gallery_b','double',PNG))[0];
    assert.notEqual(a.id,b.id);assert.notEqual(a.originalUrl,b.originalUrl);
    assert.match(a.originalUrl,/^https:\/\/photos\.example\.test\/room-photos\/[\w-]{32}\/original\.jpg$/);
    assert.equal(JSON.stringify(a).includes('gallery_a'),false);
    for(const bytes of objects.values())assert.equal(bytes[0],255,'all stored bytes sanitized JPEG');
    await assert.rejects(()=>store.remove('gallery_a','double',b.id),e=>e.status===404);
    assert.deepEqual((await store.list('gallery_b','double')).map(x=>x.id),[b.id]);
    const simultaneous=await Promise.allSettled(Array.from({length:12},()=>store.add('gallery_a','double',PNG)));
    assert.equal(simultaneous.filter(x=>x.status==='fulfilled').length,9,'concurrent writes stop at ten');
    assert.ok(simultaneous.filter(x=>x.status==='rejected').every(x=>x.reason.status===409));
    let rows=await store.list('gallery_a','double');assert.equal(rows.length,10);
    const reversed=rows.map(x=>x.id).reverse();
    await assert.rejects(()=>store.reorder('gallery_a','double',[...reversed.slice(1),b.id]),e=>e.status===409);
    await assert.rejects(()=>store.reorder('gallery_a','double',Array(10).fill(a.id)),e=>e.status===400);
    await store.reorder('gallery_a','double',reversed);store=make();
    assert.deepEqual((await store.list('gallery_a','double')).map(x=>x.id),reversed,'order survives new store instance');
    await db.query('UPDATE room_types SET enabled=false WHERE property_id=$1',['gallery_a']);
    assert.deepEqual(await store.list('gallery_a','double',{publicOnly:true}),[]);
    assert.equal((await store.list('gallery_a','double')).length,10,'disabled room remains manageable');
    await db.query('UPDATE room_types SET enabled=true WHERE property_id=$1',['gallery_a']);
    f.setFailures(false,true);
    await assert.rejects(()=>store.remove('gallery_a','double',a.id),e=>e.status===503);
    assert.equal((await store.list('gallery_a','double')).find(x=>x.id===a.id).ready,false,'failed deletion retained for explicit retry');
    assert.equal((await store.list('gallery_a','double',{publicOnly:true})).length,9,'incomplete deletion not publicly displayed');
    f.setFailures(false,false);await store.remove('gallery_a','double',a.id);
    assert.equal(objects.has(new URL(a.originalUrl).pathname.slice(1)),false);assert.equal(objects.has(new URL(a.previewUrl).pathname.slice(1)),false);
    f.setFailures(true,false);const before=objects.size;
    await assert.rejects(()=>store.add('gallery_a','double',PNG),e=>e.status===503);
    assert.equal(objects.size,before,'partial upload compensated');assert.equal((await store.list('gallery_a','double')).length,9);
    f.setFailures(true,true);await assert.rejects(()=>store.add('gallery_a','double',PNG),e=>e.status===503);
    const pending=(await store.list('gallery_a','double')).find(x=>!x.ready);assert.ok(pending);assert.equal(pending.originalUrl,null);
    assert.equal((await store.list('gallery_a','double',{publicOnly:true})).length,9);
    f.setFailures(false,false);await store.remove('gallery_a','double',pending.id);
    console.log('PASS room gallery metadata-only storage, max10 concurrency, formal-room/property isolation, order, disabled visibility, compensation and recovery; FAKE_INTEGRATION; OPENAI_CALLS=0');
  } finally {await db.close();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture,PNG};
