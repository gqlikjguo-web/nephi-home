'use strict';
// FAKE_INTEGRATION: isolated native PostgreSQL + production HTTP/session/feedback
// paths + Chromium. This is not production provider evidence. No OpenAI/LINE calls.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
(async()=>{
 const databaseUrl=process.env.FEEDBACK_TEST_DATABASE_URL;
 assert.ok(databaseUrl&&new URL(databaseUrl).hostname==='127.0.0.1','isolated localhost database required');
 const root=process.env.FEEDBACK_TEST_ROOT||require('node:path').resolve(__dirname,'..');
 const connection={kind:'pg',databaseUrl,ssl:false};
 await require(root+'/lib/providers/postgres-migrate').migratePostgres(connection);
 const db=await require(root+'/lib/providers/postgres-client').openPostgres(connection),suffix=crypto.randomBytes(4).toString('hex'),a='feedback_a_'+suffix,b='feedback_b_'+suffix;
 for(const [id,name] of [[a,'湖畔旅宿'],[b,'山林旅宿']]){await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$2)',[id,name]);await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,'{}')",[id]);for(const [room,enabled] of [['suite',true],['disabled',false]])await db.query('INSERT INTO room_types(property_id,room_id,name,display_name,capacity,position,enabled) VALUES($1,$2,$3,$3,2,0,$4)',[id,id+'_'+room,name+' '+room,enabled]);}
 for(const id of [a,b])await require(root+'/lib/admin-auth').upsertAdminUser(connection,{propertyId:id,username:id,email:id+'@example.test',password:'Fixture9Pass'});
 const providers=require(root+'/lib/providers/postgres-providers').createPostgresProviders(connection);
 const brand={brandName:'JunZan',publicBaseUrl:'http://127.0.0.1:55440'};
 const app=require(root+'/server').createApp({providers,structuredClassifier:null,adminAuthRequired:true,runtimeEnv:{DATABASE_URL:databaseUrl},publicBrand:brand});
 let browser;const started=await app.start(55440,'127.0.0.1');
 try{
 const call=async(path,method='GET',body,cookie,headers={})=>{const r=await fetch(started.url+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const login=async id=>{const r=await call('/api/admin/login','POST',{email:id+'@example.test',password:'Fixture9Pass'});assert.equal(r.status,200);return r.cookie;};
 let ca=await login(a);const cb=await login(b);
 assert.equal((await call('/api/feedback/share')).status,401);
 const shareA=await call('/api/feedback/share','GET',undefined,ca),shareB=await call('/api/feedback/share','GET',undefined,cb);
 assert.equal(shareA.status,200);assert.equal(shareB.status,200);assert.notEqual(shareA.body.data.url,shareB.body.data.url);
 assert.equal((await call('/api/feedback/share','GET',undefined,ca)).body.data.url,shareA.body.data.url);
 if(process.env.FEEDBACK_QR_DECODER){const png=require('pngjs').PNG.sync.read(Buffer.from(shareA.body.data.qr.split(',')[1],'base64'));const decoded=require(process.env.FEEDBACK_QR_DECODER)(new Uint8ClampedArray(png.data),png.width,png.height);assert.equal(decoded.data,shareA.body.data.url);}
 const pa='/api/public/feedback/'+shareA.body.data.url.split('/').pop(),pb='/api/public/feedback/'+shareB.body.data.url.split('/').pop();
 const metadata=await call(pa);assert.deepEqual(Object.keys(metadata.body.data).sort(),['propertyName','rooms']);assert.equal(metadata.body.data.rooms.length,1);assert.equal(metadata.body.data.rooms[0].id,a+'_suite');
 assert.equal((await call(pa,'POST',{overall:5,propertyId:b})).status,400);
 assert.equal((await call(pa,'POST',{overall:5,roomId:b+'_suite'})).status,400);
 assert.equal((await call(pa,'POST',{overall:5,roomId:a+'_disabled'})).status,400);
 assert.equal((await call(pa,'POST',{overall:5},undefined,{origin:'https://evil.example'})).status,403);
 assert.equal((await call(pa,'POST',{overall:5})).status,201);
 assert.equal((await call(pb,'POST',{overall:1})).status,201);
 const list=await call('/api/feedback','GET',undefined,ca);assert.equal(list.body.data.items.length,1);assert.equal(list.body.data.items[0].overall,5);const id=list.body.data.items[0].id;
 for(const p of ['/api/feedback','/api/feedback/summary','/api/feedback/share'])assert.equal((await call(p+'?propertyId='+b,'GET',undefined,ca)).status,403);
 assert.equal((await call('/api/feedback/'+id,'PATCH',{status:'improved',internalNote:'B leak'},cb)).status,404);
 assert.equal((await call('/api/feedback/'+id,'PATCH',{status:'needs_improvement',internalNote:'PRIVATE_NOTE'},ca)).status,200);
 assert.equal(JSON.stringify((await call(pa)).body).includes('PRIVATE_NOTE'),false);
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',360,780]]){
  ca=await login(a);const context=await browser.newContext({viewport:{width,height},timezoneId:'Asia/Taipei'});await context.route('**/*',r=>new URL(r.request().url()).origin===started.url?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const start=Date.now();await page.goto(shareA.body.data.url);await page.locator('#feedbackForm').waitFor({state:'visible'});
  if(process.env.FEEDBACK_EVIDENCE_DIR)await page.screenshot({path:process.env.FEEDBACK_EVIDENCE_DIR+'/public-'+label+'.png',fullPage:true});assert.equal(await page.title(),'湖畔旅宿｜住宿回饋');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.locator('input[type=email],input[type=tel],input[name=name]').count(),0);
  await page.locator('input[name=overall][value="5"]').check();
  if(label==='mobile'){await page.locator('[name=stayDate]').fill('2026-09-17');await page.locator('[name=roomId]').selectOption(a+'_suite');await page.locator('[name=comment]').fill('<img src=x onerror=alert(1)>');await page.locator('[name=cleanliness][value="5"]').check();await page.locator('[name=positives][value=clean]').check();await page.locator('[name=improvements][value=none]').check();await page.locator('[name=improvements][value=noise]').check();assert.equal(await page.locator('[name=improvements][value=none]').isChecked(),false);}
  await page.getByRole('button',{name:'送出回饋',exact:true}).click();await page.locator('#feedbackComplete').waitFor({state:'visible'});assert.ok(Date.now()-start<60000,'mobile flow under one minute by automated interaction');
  await context.addCookies([{name:'nephi_admin_session',value:ca.split('=')[1],url:started.url}]);await page.goto(started.url+'/admin');await page.locator('#workspace').waitFor({state:'visible'});
  const tab=async name=>{if(width<=640)await page.locator('#adminTabSelect').selectOption(name);else await page.locator('[data-admin-tab='+name+']').click();};await tab('feedback');await page.locator('[data-feedback=url]').filter({hasText:'/feedback/'}).waitFor();await page.locator('.feedback-entry').first().waitFor();
  assert.equal(await page.locator('[data-feedback=url]').textContent(),shareA.body.data.url);assert.equal(await page.locator('[data-feedback=qr]').getAttribute('src'),shareA.body.data.qr);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok((await page.locator('#guestFeedback').innerText()).includes('匿名回饋'));
  assert.equal(await page.locator('#guestFeedback img[src=x]').count(),0);
  const entry=page.locator('.feedback-entry').first();await entry.locator('select').selectOption('improved');await entry.locator('textarea').fill('9/25 已增加置物架');await entry.getByRole('button',{name:'儲存處理狀態'}).click();await entry.getByText('已儲存',{exact:true}).waitFor();
  await page.locator('#guestFeedback h2').click();await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.locator('#adminBackToTop').waitFor({state:'visible'});await page.locator('#adminBackToTop').click();await page.waitForFunction(()=>scrollY<5);assert.equal(await page.locator('#adminBackToTop').count(),1);
  if(process.env.FEEDBACK_EVIDENCE_DIR)await page.screenshot({path:process.env.FEEDBACK_EVIDENCE_DIR+'/'+label+'.png',fullPage:true});
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await tab('feedback');await page.locator('.feedback-entry').first().waitFor();assert.equal(await page.locator('[data-feedback=url]').textContent(),shareA.body.data.url);
  await page.getByRole('button',{name:'登出',exact:true}).click();await page.locator('#login').waitFor({state:'visible'});const again=await login(a);ca=again;await context.addCookies([{name:'nephi_admin_session',value:again.split('=')[1],url:started.url}]);await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await tab('feedback');await page.locator('.feedback-entry').first().waitFor();assert.ok((await page.locator('#guestFeedback').innerText()).includes('已改善'));
  assert.deepEqual(errors,[]);await context.close();console.log('PASS '+label+' anonymous/stay info/form/QR/fixed link/history/relogin/status/TOP/no overflow/XSS (FAKE_INTEGRATION)');
 }
 const after=await call('/api/feedback','GET',undefined,ca);assert.equal(after.body.data.items.length,4);assert.equal((await call('/api/feedback','GET',undefined,cb)).body.data.items.length,1);
 const quota=await db.query('SELECT count(*)::int n FROM commercial_ai_attempt_ledger WHERE property_id=ANY($1::text[])',[[a,b]]);assert.equal(quota.rows[0].n,0);
 const store=require(root+'/lib/guest-feedback-store').createFeedbackStore({db});
 for(let i=0;i<25;i++)await store.submit(shareA.body.data.url.split('/').pop(),{overall:4},'pagination-'+i);
 const paging=await browser.newContext({viewport:{width:390,height:844}});await paging.addCookies([{name:'nephi_admin_session',value:ca.split('=')[1],url:started.url}]);
 const p=await paging.newPage();await p.goto(started.url+'/admin');await p.locator('#workspace').waitFor({state:'visible'});await p.locator('#adminTabSelect').selectOption('feedback');await p.waitForFunction(()=>document.querySelectorAll('.feedback-entry').length===20);
 await p.locator('[data-feedback=rating]').selectOption('5');await p.getByRole('button',{name:'載入更多',exact:true}).click();await p.waitForFunction(()=>document.querySelector('[data-feedback=message]').textContent==='');assert.equal(await p.locator('.feedback-entry').count(),29,'unapplied controls must not change paginated query');
 await p.getByRole('button',{name:'套用篩選',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.feedback-entry').length===4);assert.equal(await p.locator('[data-feedback=more]').isVisible(),false);
 await p.locator('[data-feedback=status]').selectOption('needs_improvement');await p.getByRole('button',{name:'套用篩選',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.feedback-entry').length===1);
 await p.locator('[data-feedback=period]').selectOption('previous');await p.getByRole('button',{name:'套用篩選',exact:true}).click();await p.locator('.feedback-empty').waitFor();await paging.close();
 console.log('PASS browser filters and applied-query pagination (FAKE_INTEGRATION)');
 const oldRender=process.env.RENDER;process.env.RENDER='true';
 for(let i=0;i<600;i++)await call('/api/public/feedback/invalid','GET',undefined,undefined,{'x-forwarded-for':'192.0.2.11'});
 assert.equal((await call('/api/public/feedback/invalid','GET',undefined,undefined,{'x-forwarded-for':'192.0.2.11'})).status,429);
 assert.equal((await call(pa,'GET',undefined,undefined,{'x-forwarded-for':'192.0.2.12'})).status,200,'one proxy visitor must not block another');
 assert.equal((await call('/api/feedback/summary','GET',undefined,ca,{'x-forwarded-for':'192.0.2.12'})).status,200);
 if(oldRender===undefined)delete process.env.RENDER;else process.env.RENDER=oldRender;
 console.log('PASS native PostgreSQL HTTP/session/membership/room/property isolation/private note boundary; REAL_OPENAI_CALLS=0');
 }finally{if(browser)await browser.close();await app.stop();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
