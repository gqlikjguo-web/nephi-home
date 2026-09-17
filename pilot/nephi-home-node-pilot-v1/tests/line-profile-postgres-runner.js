"use strict";
// REAL_POSTGRESQL_PROVIDER: independent connections in an isolated local schema only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg'),{profileOperation}=require('../lib/providers/line-profile-store');
const {credentialVersion,channelForBinding}=require('../lib/line-profile-source');
(async()=>{
  const url=new URL(process.argv[2]);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/junzan_commercial_atomicity');assert.equal(url.search,'');
  const clients=[0,1,2].map(()=>new Client({connectionString:url.href,ssl:false})),schema='profile_'+crypto.randomUUID().replaceAll('-','');let created=false,providers;
  const wrap=c=>({transaction:async fn=>{await c.query('BEGIN');try{const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}}});
  try{
    await Promise.all(clients.map(c=>c.connect()));await clients[0].query(`CREATE SCHEMA ${schema}`);created=true;
    await Promise.all(clients.map(c=>c.query(`SET search_path TO ${schema}`)));
    for(const file of fs.readdirSync(path.join(__dirname,'../migrations')).filter(f=>f.endsWith('.sql')).sort())await clients[0].query(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
    const binding={propertyId:'synthetic',webhookKey:'local-webhook',channelSecretEncrypted:{iv:'s'},channelAccessTokenEncrypted:{iv:'t'}};
    await clients[0].query("INSERT INTO properties(property_id,display_name) VALUES('synthetic','Synthetic')");
    await clients[0].query("INSERT INTO property_line_bindings(property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled) VALUES('synthetic',$1,$2,$3,true)",[binding.webhookKey,JSON.stringify(binding.channelSecretEncrypted),JSON.stringify(binding.channelAccessTokenEncrypted)]);
    const input={propertyId:'synthetic',channelId:channelForBinding(binding),userId:'synthetic-user',credentialVersion:credentialVersion(binding),destination:'synthetic-bot',eventId:'event'};
    await clients[0].query("INSERT INTO message_logs(property_id,channel_id,line_user_id,event_id,review_id,payload) VALUES($1,$2,$3,'event','event','{}')",[input.propertyId,input.channelId,input.userId]);
    await profileOperation(wrap(clients[0]),'observe',input);
    const claims=await Promise.all(clients.map(c=>profileOperation(wrap(c),'claim',input)));
    assert.equal(claims.filter(Boolean).length,1,'independent PostgreSQL connections must grant exactly one lookup');
    const claim=claims.find(Boolean);
    await clients[0].query("UPDATE property_line_bindings SET channel_access_token_encrypted='{}'");
    assert.equal(await profileOperation(wrap(clients[1]),'finish',{...input,...claim,result:'success',displayName:'stale'}),null);
    assert.equal((await clients[0].query('SELECT display_name FROM line_guest_profiles')).rows[0].display_name,null);
    await clients[0].query('UPDATE property_line_bindings SET channel_access_token_encrypted=$1',[JSON.stringify(binding.channelAccessTokenEncrypted)]);
    await clients[0].query('BEGIN');await clients[0].query('LOCK TABLE line_guest_profiles IN ACCESS EXCLUSIVE MODE');
    const start=Date.now();await assert.rejects(()=>profileOperation(wrap(clients[1]),'claim',input),e=>e.code==='55P03');assert.ok(Date.now()-start<1500,'optional table lock must fail within a bounded wait');
    const workerUrl=new URL(url.href);workerUrl.searchParams.set('options',`-csearch_path=${schema}`);
    providers=require('../lib/providers/postgres-providers').createPostgresProviders({kind:'pg',databaseUrl:workerUrl.href,ssl:false});
    const before=Date.now(),pending=providers.lineProfiles.claim(input);assert.ok(pending instanceof Promise);assert.ok(Date.now()-before<100,'profile RPC must not synchronously wait for the table lock');
    assert.equal(providers.customerSettings.listProperties().length,1,'unrelated synchronous data remains available during profile lock');
    await assert.rejects(()=>pending,/PROFILE_STORAGE_UNAVAILABLE/);
    await clients[0].query('ROLLBACK');
    console.log('PASS independent PostgreSQL lease atomicity, stale credential fence, lock timeout, nonblocking RPC and unaffected normal reads (REAL_POSTGRESQL_PROVIDER: isolated localhost)');
  }finally{if(providers)await providers.close();try{await clients[0].query('ROLLBACK');if(created)await clients[0].query(`DROP SCHEMA ${schema} CASCADE`);}finally{await Promise.all(clients.map(c=>c.end()));}}
})().catch(e=>{console.error(e);process.exitCode=1;});
