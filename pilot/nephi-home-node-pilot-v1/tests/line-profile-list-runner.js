"use strict";
// RUNTIME_COMPONENT_TEST: real signed webhook/API/controller, PGlite and fake LINE Profile; AI gate OFF.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup}=require('./helpers/burst-production-fixture');
class Node{constructor(tag,ownerDocument){Object.assign(this,{tagName:tag,ownerDocument,children:[],dataset:{},textContent:'',hidden:false});}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}setAttribute(k,v){this[k]=v}querySelectorAll(){return this.children.flatMap(n=>[n,...n.querySelectorAll()])}}
(async()=>{
 const fetchOriginal=globalThis.fetch;let profileCalls=0,x;
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://api.line.me/')){profileCalls++;return {ok:true,status:200,json:async()=>String(url).endsWith('/info')?{userId:'official-new-bot'}:{userId:'audit-user',displayName:'New official LINE name',pictureUrl:'discard'}};}
  return fetchOriginal(url,options);
 };
 try{
  x=await setup('new-profile-list',{pg:true,debounce:0});x.providers.commercial.setAiEnabled('audit_a',false);
  const ack=await x.binding.post(x.server.url,JSON.stringify({destination:'official-new-bot',events:[x.event('first-new-guest')]}));assert.equal(ack.status,200);await x.done('first-new-guest');
  const identity=x.record('first-new-guest');assert.equal(x.calls.length,0);assert.equal(x.sent.length,0);
  x.providers.persistence.getAdminSession=()=>({propertyId:'audit_a',properties:[{propertyId:'audit_a'}]});
  const api=async(url,options={})=>fetch(x.server.url+url,{...options,headers:{...options.headers,cookie:'nephi_admin_session=isolated-session'}});
  const lookup=await api('/api/ai-controls/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({channelId:identity.channelId,userId:'audit-user'})});assert.equal(lookup.status,200);assert.equal((await lookup.json()).data.displayName,'New official LINE name');assert.equal(profileCalls,2);
  const list=async()=>{const r=await api('/api/ai-controls/conversations?propertyId=audit_a');assert.equal(r.status,200);return (await r.json()).data.items;};
  assert.equal((await list())[0].displayName,'New official LINE name','refresh must return the verified persisted name, not lose it');
  assert.equal(profileCalls,2,'list refresh never calls LINE');
  const doc={createElement:t=>new Node(t,doc)},host=new Node('section',doc),ctx=vm.createContext({URLSearchParams,fetch:api});
  vm.runInContext(fs.readFileSync(__dirname+'/../public/assets/admin-ai-controls.js','utf8'),ctx);const ui=vm.runInContext('AiControls',ctx).createOperator(host,{getPropertyId:()=> 'audit_a'}),field=n=>host.querySelectorAll().find(v=>v.dataset.field===n);
  await ui.load();assert.ok(field('guestOpen').textContent.startsWith('New official LINE name'));
  await field('guestOpen').onclick();assert.ok(field('guestTitle').textContent.startsWith('New official LINE name'));assert.equal(field('history').children.length,1);assert.equal(field('handoff').textContent,'轉人工');
  await ui.load();assert.ok(field('guestOpen').textContent.startsWith('New official LINE name'));
  assert.equal((await api('/api/ai-controls/conversations?propertyId=audit_b')).status,403,'query cannot select another property');
  const readNames=x.providers.lineProfiles.readNames;x.providers.lineProfiles.readNames=async()=>{throw Error('optional profile storage unavailable')};
  assert.ok(!(await list())[0].displayName,'profile storage failure preserves the original conversation list');x.providers.lineProfiles.readNames=readNames;
  const {createLineBindingService}=require('../lib/line-binding-service');const bindings=createLineBindingService({provider:x.providers.lineBindings,env:x.binding.lineBindingEnv});
  bindings.upsert('audit_a',{channelAccessToken:'synthetic-rotated-profile-token'});
  assert.ok(!(await list())[0].displayName,'credential rotation must hide old cached names');
  assert.equal(profileCalls,2);assert.equal(x.calls.length,0);assert.equal(x.sent.length,0);assert.equal(x.providers.commercial.getStatus('audit_a').used,0);assert.equal(x.providers.commercial.getHandoff('audit_a',identity.channelId,'audit-user').humanControlled,false);
  console.log('PASS new signed guest, verified cached name survives API/UI refresh, header/list identity, optional failure and credential isolation; zero Understanding/quota/replies (RUNTIME_COMPONENT_TEST)');
 }finally{if(x)await x.app.stop();globalThis.fetch=fetchOriginal;}
 // FAKE_INTEGRATION: deterministic cache expiry and three-key isolation in actual SQL.
 const {PGlite}=await import('@electric-sql/pglite'),db=new PGlite();
 try{
  for(const file of ['001_initial.sql','015_property_line_bindings.sql','027_line_guest_profiles.sql'])await db.exec(fs.readFileSync(__dirname+'/../migrations/'+file,'utf8'));
  const {credentialVersion,channelForBinding}=require('../lib/line-profile-source'),{profileOperation}=require('../lib/providers/line-profile-store');
  const a={propertyId:'a',webhookKey:'a',channelSecretEncrypted:{iv:'a'},channelAccessTokenEncrypted:{iv:'a'}},b={...a,propertyId:'b',webhookKey:'b'};
  for(const binding of [a,b]){await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$1)',[binding.propertyId]);await db.query('INSERT INTO property_line_bindings(property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled) VALUES($1,$2,$3,$4,true)',[binding.propertyId,binding.webhookKey,JSON.stringify(binding.channelSecretEncrypted),JSON.stringify(binding.channelAccessTokenEncrypted)]);}
  const ca=channelForBinding(a),cb=channelForBinding(b),va=credentialVersion(a),vb=credentialVersion(b);
  for(const [property,channel,user,name,version,interval] of [['a',ca,'u','Name A',va,'1 hour'],['a','wrong-channel','u','Wrong channel',va,'1 hour'],['a',ca,'expired','Expired',va,'-1 second'],['b',cb,'u','Other property',vb,'1 hour'],['a',ca,'old-credential','Old credential','obsolete','1 hour']])await db.query("INSERT INTO line_guest_profiles(property_id,channel_id,line_user_id,display_name,credential_version,source_destination,source_event_id,last_result,next_refresh_at) VALUES($1,$2,$3,$4,$5,'bot','event','success',now()+$6::interval)",[property,channel,user,name,version,interval]);
  const snapshot=async()=>JSON.stringify((await db.query('SELECT * FROM line_guest_profiles ORDER BY property_id,channel_id,line_user_id')).rows),before=await snapshot();
  assert.deepEqual(await profileOperation(db,'readNames',{propertyId:'a'}),[{channelId:ca,userId:'u',displayName:'Name A'}]);
  assert.equal(await snapshot(),before,'name projection does not write profile, quota or other state');
  const items=[{channelId:ca,userId:'u'},{channelId:ca,userId:'unknown'},{channelId:'wrong',userId:'u'}];
  const service=require('../lib/line-profile-service').createLineProfileService({store:{readNames:i=>profileOperation(db,'readNames',i)},fetchImpl:()=>{throw Error('cache projection must never call LINE')}});
  assert.deepEqual(await service.decorateConversations('a',items),[{...items[0],displayName:'Name A'},items[1],items[2]]);
  await db.query("UPDATE property_line_bindings SET enabled=false WHERE property_id='a'");assert.deepEqual(await service.decorateConversations('a',items),items);
  console.log('PASS valid TTL/current credential/property/channel/user-only name projection with zero writes (FAKE_INTEGRATION)');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
