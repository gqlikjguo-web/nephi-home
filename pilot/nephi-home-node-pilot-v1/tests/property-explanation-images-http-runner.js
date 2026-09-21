'use strict';
// FAKE_INTEGRATION: actual routes/storage with isolated PGlite; session lookup double.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PNG}=require('./property-explanation-images-runner');
(async()=>{
 const file=path.resolve(__dirname,'../lib/property-image-routes.js');assert.ok(fs.existsSync(file),'authenticated image routes required');
 const connection={kind:'pglite',dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'image-http-'))};
 await require('../lib/providers/postgres-migrate').migratePostgres(connection);
 const db=await require('../lib/providers/postgres-client').openPostgres(connection);
 for(const id of ['http_a','http_b']){await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$1)',[id]);await db.query('INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)',[id,JSON.stringify({propertyFacts:[{canonicalId:'parking',category:'policy',publicName:'停車',status:'allowed',publicText:'請使用停車區。'}]})]);}
 const store=require('../lib/property-image-store').createPropertyImageStore({db,publicBaseUrl:'https://media.example.test'});
 const {sessionTokenHash}=require('../lib/admin-auth');
 const sessions=new Map(['http_a','http_b'].map(id=>[sessionTokenHash(id),{propertyId:id,properties:[{propertyId:id}]}]));
 sessions.set(sessionTokenHash('no-member'),{propertyId:'http_a',properties:[{propertyId:'http_b'}]});
 const route=require(file).createPropertyImageRoutes({getStore:async()=>store,persistence:{getAdminSession:async key=>sessions.get(key)},publicBaseUrl:'https://media.example.test',sendData:(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({data}));}});
 const server=http.createServer(async(req,res)=>{try{if(!await route(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status||500);res.end(e.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const call=(url,{actor='http_a',method='GET',body,headers={}}={})=>fetch(base+url,{method,headers:{...(actor?{cookie:'nephi_admin_session='+actor}:{}),...headers},body});
 try{
  assert.equal((await call('/api/property-images',{actor:''})).status,401);
  assert.equal((await call('/api/property-images',{actor:'no-member'})).status,403);
  assert.equal((await call('/api/property-images?propertyId=http_b')).status,403);
  assert.equal((await call('/api/property-images/parking',{method:'PUT',body:PNG,headers:{origin:'https://evil.example','content-type':'image/png'}})).status,403);
  assert.equal((await call('/api/property-images/parking',{method:'PUT',body:PNG,headers:{'content-type':'image/png'}})).status,403,'writes need explicit same origin');
  const upload=()=>call('/api/property-images/parking',{method:'PUT',body:PNG,headers:{origin:'https://media.example.test','content-type':'image/png'}});
  const created=await upload();assert.equal(created.status,201);const image=(await created.json()).data;
  assert.equal((await (await call('/api/property-images',{actor:'http_b'})).json()).data.items.length,0);
  const publicPath=new URL(image.previewImageUrl).pathname;
  const publicResponse=await call(publicPath,{actor:''});assert.equal(publicResponse.status,200);assert.equal(publicResponse.headers.get('content-type'),'image/jpeg');assert.equal(publicResponse.headers.get('x-content-type-options'),'nosniff');assert.equal(new Uint8Array(await publicResponse.arrayBuffer())[0],255);
  assert.equal((await call('/api/property-images/parking',{actor:'http_b',method:'DELETE',headers:{origin:'https://media.example.test'}})).status,200);
  assert.equal((await call(publicPath,{actor:''})).status,200,'other property delete cannot affect owner');
  const changed=await upload();assert.equal(changed.status,201);assert.equal((await call(publicPath,{actor:''})).status,404);
  assert.equal((await call('/api/property-images/parking',{method:'DELETE',headers:{origin:'https://media.example.test'}})).status,200);
  assert.equal((await (await call('/api/property-images')).json()).data.items.length,0);
  console.log('PASS authenticated image CRUD, cross-property isolation, same-origin writes, public JPEG-only reads/revocation; FAKE_INTEGRATION; OPENAI_CALLS=0');
 }finally{await new Promise(resolve=>server.close(resolve));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
