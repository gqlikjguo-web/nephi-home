'use strict';
// FAKE_INTEGRATION: real HTTP, PGlite, image validation; session and R2 doubles.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {fixture,PNG}=require('./room-gallery-runner');
async function run(){
  assert.ok(fs.existsSync(path.resolve(__dirname,'../lib/room-gallery-routes.js')),'room gallery routes required');
  const f=await fixture(),store=f.make(),sessions=new Map();
  const {sessionTokenHash}=require('../lib/admin-auth');
  for(const id of ['gallery_a','gallery_b'])sessions.set(sessionTokenHash(id),{propertyId:id,properties:[{propertyId:id}]});
  sessions.set(sessionTokenHash('foreign-membership'),{propertyId:'gallery_a',properties:[{propertyId:'gallery_b'}]});
  const properties=['gallery_a','gallery_b'].map((id,i)=>({propertyId:id,businessProfile:{publicSlug:'lodge'+i},onboarding:{isReady:true}}));
  let available=true;
  const route=require('../lib/room-gallery-routes').createRoomGalleryRoutes({getStore:async()=>{if(!available){const e=Error('unconfigured');e.status=503;throw e;}return store;},persistence:{getAdminSession:async hash=>sessions.get(hash)},customerSettings:{listProperties:()=>properties},publicBaseUrl:'https://app.example.test',sendData:(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({data}));}});
  const server=http.createServer(async(req,res)=>{try{if(!await route(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status||500);res.end(JSON.stringify({error:{message:e.message}}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const call=(p,{actor='gallery_a',method='GET',body,headers={}}={})=>fetch(base+p,{method,body,headers:{...(actor?{cookie:'nephi_admin_session='+actor}:{}),...headers}});
  const write={origin:'https://app.example.test','content-type':'image/png'};
  try{
    assert.equal((await call('/api/room-gallery/double',{actor:''})).status,401);
    assert.equal((await call('/api/room-gallery/double',{actor:'foreign-membership'})).status,403);
    assert.equal((await call('/api/room-gallery/double?propertyId=gallery_b')).status,403);
    assert.equal((await call('/api/room-gallery/double',{method:'POST',body:PNG,headers:{...write,origin:'https://evil.example'}})).status,403);
    assert.equal((await call('/api/room-gallery/double',{method:'POST',body:PNG,headers:{'content-type':'image/png'}})).status,403);
    assert.equal((await call('/api/room-gallery/double',{method:'POST',body:PNG,headers:{...write,'content-type':'image/svg+xml'}})).status,415);
    assert.equal((await call('/api/room-gallery/not-formal',{method:'POST',body:PNG,headers:write})).status,404);
    const uploaded=await call('/api/room-gallery/double?propertyId=gallery_a',{method:'POST',body:PNG,headers:write});assert.equal(uploaded.status,201);
    const a=(await uploaded.json()).data.items[0];
    assert.deepEqual((await (await call('/api/room-gallery/double',{actor:'gallery_b'})).json()).data.items,[]);
    assert.equal((await call('/api/room-gallery/double/'+a.id,{actor:'gallery_b',method:'DELETE',headers:write})).status,404);
    assert.deepEqual((await (await call('/api/public/room-gallery?slug=lodge1&roomId=double',{actor:''})).json()).data.items,[]);
    const pub=await call('/api/public/room-gallery?slug=lodge0&roomId=double',{actor:''});assert.equal(pub.status,200);assert.equal(pub.headers.get('cache-control'),'no-store');
    assert.deepEqual((await pub.json()).data.items,[a]);
    assert.equal((await call('/api/public/room-gallery?propertyId=gallery_a&roomId=double',{actor:''})).status,404,'property ID never substitutes for slug');
    properties[0].onboarding.isReady=false;assert.equal((await call('/api/public/room-gallery?slug=lodge0&roomId=double',{actor:''})).status,404);properties[0].onboarding.isReady=true;
    assert.equal((await call('/api/room-gallery/double/order',{method:'PUT',headers:{...write,'content-type':'application/json'},body:JSON.stringify({photoIds:[a.id,a.id]})})).status,400);
    assert.equal((await call('/api/room-gallery/double/order',{method:'PUT',headers:{...write,'content-type':'application/json'},body:'{'})).status,400);
    assert.equal((await call('/api/room-gallery/double/order',{method:'PUT',headers:{...write,'content-type':'application/json'},body:' '.repeat(9000)})).status,413);
    available=false;assert.equal((await call('/api/room-gallery/double')).status,503);
    console.log('PASS scoped room-gallery HTTP, membership/CSRF, formal public slug, content/body validation, direct image URLs; FAKE_INTEGRATION; OPENAI_CALLS=0');
  }finally{await new Promise(resolve=>server.close(resolve));await f.db.close();}
  // Exercise the production error envelope, not only the route harness mapper.
  const os=require('node:os');
  const providers=require('../lib/providers/json-providers').createJsonProviders({dataFile:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gallery-app-')),'store.json'),seedFile:path.resolve(__dirname,'../fixtures/seed.json')});
  providers.customerSettings.listProperties=()=>properties;
  const app=require('../server').createApp({providers,adminAuthRequired:false,runtimeEnv:{TEST_ONLY_ENVIRONMENT:'false'},getRoomGalleryStore:async()=>require('../lib/room-gallery-store').fail(503,'房間照片尚未啟用')});
  try{
    const {url}=await app.start(0,'127.0.0.1');
    const response=await fetch(url+'/api/public/room-gallery?slug=lodge0&roomId=double');
    assert.equal(response.status,503,'production envelope preserves actionable gallery unavailability');
    assert.equal((await response.json()).error.message,'房間照片尚未啟用');
    console.log('PASS production createApp gallery error envelope');
  }finally{await app.stop();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
