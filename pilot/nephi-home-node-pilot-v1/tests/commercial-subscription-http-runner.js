"use strict";
// FAKE_INTEGRATION: real HTTP login/grants, signed webhook, PostgreSQL-compatible
// persistence and controlled core; only LINE/OpenAI network transports are doubles.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {attachPropertyScopedLineBinding,waitFor}=require('./helpers/property-scoped-line-webhook');
(async()=>{
 const connection={kind:'pglite',dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'subscription-http-'))};
 await require('../lib/providers/postgres-migrate').migratePostgres(connection);
 let db=await require('../lib/providers/postgres-client').openPostgres(connection);
 for(const id of ['a','b']){await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$1)',[id]);await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)",[id,JSON.stringify({commonAnswers:{checkInTime:id==='a'?'15:00':'16:00'}})]);}
 await db.close();
 for(const [id,user] of [['a','admin'],['a','operator'],['b','other']])await require('../lib/admin-auth').upsertAdminUser(connection,{propertyId:id,username:user,email:user+'@example.test',password:'FixturePass2026'});
 db=await require('../lib/providers/postgres-client').openPostgres(connection);await db.exec("INSERT INTO platform_admin_grants(property_id,username) VALUES('a','admin')");await db.close();
 const providers=require('../lib/providers/postgres-providers').createPostgresProviders(connection);
 const binding=attachPropertyScopedLineBinding({providers,propertyId:'a'}),sent=[];
 let network=0,entered=0;
 const app=require('../server').createApp({providers,adminAuthRequired:true,structuredClassifier:null,enableProductionLineEngine:true,
  runtimeEnv:{OPENAI_API_KEY:crypto.randomBytes(24).toString('hex')},openAiTestEnv:{},lineBindingEnv:binding.lineBindingEnv,conversationDebounceMs:0,
  newCoreProductionExecuteTurn:async args=>{entered++;return require('../lib/new-core/application-service').executeNewCoreTurn({...args,understandingProvider:(input,options)=>require('../lib/providers/openai-understanding-v1').callOpenAIUnderstandingV1(input,{...options,fetchImpl:async()=>{
   network++;const event=input.sourceEvents[0],unit={unitId:'unit',evidenceRefs:[{eventId:event.eventId,messageRef:event.messageRef,startOffset:0,endOffset:event.messageText.length,quote:event.messageText}],purpose:'lodging_question',capability:'policy',subject:{kind:'policy',catalogIdentity:'check_in'},stayDependent:false,temporalCandidate:null,contextLinkCandidateId:'link',safetyCandidate:null,slotCandidates:[],confidenceBand:'high'};
   const output={understandingOutput:{schemaVersion:1,turnId:input.turnId,units:[unit]},contextLinkCandidates:[{contextLinkCandidateId:'link',unitId:'unit',relationKind:'NEW_REQUEST',currentSourceEvidenceRefs:unit.evidenceRefs,referencedHistoryEventRefs:[]}]};
   return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({model:'gpt-5.6-luna',status:'completed',usage:{input_tokens:10,output_tokens:2,total_tokens:12},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]})};
  }})});},lineReplyClientFactory:()=>({replyMessageWithHttpInfo:async body=>{sent.push(body);return {httpResponse:{status:200}};}})});
 const running=await app.start(0,'127.0.0.1');let browser;
 try{
  const request=async(p,method='GET',body,cookie)=>{const r=await fetch(running.url+p,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const login=async user=>{const r=await request('/api/admin/login','POST',{email:user+'@example.test',password:'FixturePass2026'});assert.equal(r.status,200);return r.cookie;};
  const admin=await login('admin'),operator=await login('operator'),other=await login('other');
  const contract={propertyId:'a',status:'active',contractStart:'2020-01-01',contractEnd:'2100-12-31',monthlyLimit:1000};
  assert.equal((await request('/api/platform/ai-subscriptions','PUT',contract)).status,401);
  assert.equal((await request('/api/platform/ai-subscriptions','PUT',contract,operator)).status,403);
  assert.equal((await request('/api/ai-subscription','PUT',contract,operator)).status,403);
  assert.equal((await request('/api/platform/ai-controls','PUT',{propertyId:'a',monthlyLimit:1000},operator)).status,403);
  assert.equal((await request('/api/ai-subscription?propertyId=b','GET',null,operator)).status,403);
  assert.equal((await request('/api/ai-subscription?propertyId=a','GET',null,other)).status,403);
  const post=async id=>{const body={events:[{type:'message',webhookEventId:id,replyToken:'fixture-'+id,timestamp:Date.now(),source:{type:'user',userId:'guest'},message:{type:'text',id:'message-'+id,text:'請問入住時間？'}}]};assert.equal((await binding.post(running.url,JSON.stringify(body))).status,200);await waitFor(()=>['no_reply','reply_succeeded','processing_failed'].includes(providers.persistence.findMessageByEventId('a',id)?.processingStatus),8000);return providers.persistence.findMessageByEventId('a',id);};
  assert.equal((await post('unset')).processingStatus,'no_reply');assert.equal(entered,0);assert.equal(network,0);assert.equal(sent.length,0);
  for(const [id,patch] of [['future',{contractStart:'2100-01-01'}],['expired',{contractStart:'2000-01-01',contractEnd:'2000-12-31'}],['disabled',{status:'disabled'}]]){
   assert.equal((await request('/api/platform/ai-subscriptions','PUT',{...contract,...patch},admin)).status,200);
   const record=await post(id);assert.equal(record.guestMessage,'請問入住時間？');assert.equal(record.processingStatus,'no_reply');assert.equal(entered,0);assert.equal(network,0);assert.equal(sent.length,0);assert.equal(providers.commercial.getStatus('a').used,0);
  }
  assert.equal((await request('/api/platform/ai-subscriptions','PUT',contract,admin)).status,200);
  assert.equal((await post('active')).processingStatus,'reply_succeeded');assert.equal(network,1);assert.equal(sent.length,1);assert.equal(providers.commercial.getStatus('a').used,1);
  assert.equal((await request('/api/platform/ai-subscriptions','PUT',{...contract,contractEnd:'2020-01-01'},admin)).status,200);
  assert.equal((await post('expired-after-use')).processingStatus,'no_reply');assert.equal(network,1);assert.equal(providers.commercial.getStatus('a').used,1);
  assert.equal((await request('/api/platform/ai-subscriptions','PUT',contract,admin)).status,200);
  assert.equal((await post('renewed')).processingStatus,'reply_succeeded');assert.equal(network,2);assert.equal(sent.length,2);assert.equal(providers.commercial.getStatus('a').used,2);
  assert.equal((await request('/api/platform/ai-subscriptions','PUT',{...contract,propertyId:'b'},admin)).status,200,'platform grant may manage another property');
  const b=await request('/api/ai-subscription','GET',null,other);assert.equal(b.body.data.propertyId,'b');
  const history=await request('/api/ai-controls/conversations','GET',null,operator);assert.equal(history.body.data.items.length,1);
  assert.equal((await request('/api/ai-controls/conversations','GET',null,other)).body.data.items.length,0);
  if(process.env.JUNZAN_BROWSER_MODULE){
   const {chromium}=require(process.env.JUNZAN_BROWSER_MODULE);browser=await chromium.launch({headless:true,args:['--no-sandbox']});
   for(const [width,height] of [[1440,1000],[390,844]]){
    const context=await browser.newContext({viewport:{width,height}});await context.route('**/*',r=>new URL(r.request().url()).origin===running.url?r.continue():r.abort());
    await context.addCookies([{name:'nephi_admin_session',value:admin.split('=')[1],url:running.url}]);
    const page=await context.newPage();await page.goto(running.url+'/admin/platform');
    await page.locator('#platformAiControls [data-field=property]').selectOption('a');
    await page.locator('#platformAiControls [data-field=contractEnd]').waitFor();
    await page.waitForFunction(()=>document.querySelector('#platformAiControls [data-field=contractEnd]').value==='2100-12-31');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.goto(running.url+'/admin');await page.locator('#workspace').waitFor({state:'visible'});
    if(width<600)await page.locator('#adminTabSelect').selectOption('ai');else await page.locator('[data-admin-tab=ai]').click();
    await page.locator('#aiControls [data-field=subscriptionStatus]').filter({hasText:'方案有效至 2100/12/31'}).waitFor();
    assert.equal(await page.locator('#aiControls [data-field=contractEnd]').count(),0);await context.close();
   }
  }
  console.log('PASS HTTP real login/grant/operator denial/property isolation/signed webhook persistence/0 paid calls when stopped/renewal/unchanged quota; '+(browser?'desktop+mobile Chromium':'browser not requested')+' (FAKE_INTEGRATION; REAL OpenAI/LINE=0)');
 }finally{if(browser)await browser.close();await app.stop();fs.rmSync(connection.dataDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
