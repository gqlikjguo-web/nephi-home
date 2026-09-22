'use strict';
// STRUCTURED_CONTRACT_TEST: AWS command boundary double; no real R2 request.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
  assert.ok(fs.existsSync(path.resolve(__dirname,'../lib/room-gallery-r2.js')),'R2 adapter required');
  const {createRoomGalleryR2,readRoomGalleryConfig}=require('../lib/room-gallery-r2');
  assert.equal(readRoomGalleryConfig({}),null);
  const config={accountId:'a'.repeat(32),bucket:'test-room-photos',accessKeyId:'fixture-access',secretAccessKey:'fixture-secret',publicBaseUrl:'https://photos.example.test'};
  for(const publicBaseUrl of ['http://photos.example.test','https://photos.example.test/path','https://user:pass@photos.example.test','https://photos.example.test/?signed=1','http://photos.r2.dev','https://photos.r2.dev/path','https://photos.r2.dev/?signed=1','https://photos.r2.dev/#fragment','https://user:pass@photos.r2.dev','https://example.r2.cloudflarestorage.com','ftp://photos.r2.dev'])assert.throws(()=>createRoomGalleryR2({...config,publicBaseUrl},{send:async()=>{}}));
  const approved=createRoomGalleryR2({...config,publicBaseUrl:'https://pub-approved-fixture.r2.dev'},{send:async()=>{}});
  assert.equal(approved.url('room-photos/'+'k'.repeat(32)+'/original.jpg'),'https://pub-approved-fixture.r2.dev/room-photos/'+'k'.repeat(32)+'/original.jpg','user-approved HTTPS r2.dev origin must preserve object identity');
  const calls=[],client={send:async(command,options)=>{calls.push({command,options});}};
  const r2=createRoomGalleryR2(config,client),key='room-photos/'+'k'.repeat(32)+'/original.jpg';
  await r2.put(key,Buffer.from([255,216,255]));await r2.remove(key);
  assert.equal(calls[0].command.constructor.name,'PutObjectCommand');assert.equal(calls[1].command.constructor.name,'DeleteObjectCommand');
  assert.equal(calls[0].command.input.Bucket,config.bucket);assert.equal(calls[0].command.input.Key,key);
  assert.equal(calls[0].command.input.ContentType,'image/jpeg');assert.equal(calls[0].command.input.CacheControl,'no-store');
  assert.ok(calls.every(x=>x.options.abortSignal),'bounded request lifetime');assert.equal(r2.url(key),'https://photos.example.test/'+key);
  for(const bad of ['../elsewhere','other-property/key','https://evil.example/img']){assert.throws(()=>r2.url(bad));await assert.rejects(()=>r2.put(bad,Buffer.from([1])));await assert.rejects(()=>r2.remove(bad));}
  console.log('PASS R2 command contract, HTTPS stable origin, strict object keys, bounded requests; STRUCTURED_CONTRACT_TEST; REAL_R2=NOT_RUN; OPENAI_CALLS=0');
})().catch(e=>{console.error(e);process.exitCode=1;});
