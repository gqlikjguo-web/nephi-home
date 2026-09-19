"use strict";
// FAKE_INTEGRATION / RUNTIME_COMPONENT_TEST: real admin browser and authenticated
// production HTTP handlers backed by an isolated PGlite database. No external calls.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..');
async function run() {
  const html = fs.readFileSync(root + '/public/admin.html', 'utf8');
  assert.ok(html.includes('id="adminBackToTop"'), 'one shared TOP control must exist');
  assert.ok(html.includes('data-view="calendar"'), 'calendar must be reachable');
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const connection = {kind:'pglite', dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'calendar-ui-'))};
  await require('../lib/providers/postgres-migrate').migratePostgres(connection);
  const db = await require('../lib/providers/postgres-client').openPostgres(connection);
  try {
    for (const id of ['calendar_a','calendar_b']) {
      await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$1)',[id]);
      await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb)",[id]);
      for (const [room,name] of [['suite_x','湖景套房'],['loft_y','閣樓雙人房']]) {
        await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,$2,$3,2,'double','',0)",[id,room,id==='calendar_b'?'B_PRIVATE_ROOM':name]);
        for (const date of ['2026-09-17','2026-09-23']) await db.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,$2,$3,$4,$5)",[id,room,date,room==='suite_x'?'available':'closed',room==='suite_x'?1:0]);
      }
    }
  } finally { await db.close(); }
  await require('../lib/admin-auth').upsertAdminUser(connection,{propertyId:'calendar_a',username:'calendar-owner',email:'calendar-owner@example.test',password:'Fixture9Pass'});
  const providers = require('../lib/providers/postgres-providers').createPostgresProviders(connection);
  const app = require('../server').createApp({providers,structuredClassifier:null});
  const started = await app.start(0,'127.0.0.1');
  let browser;
  try {
    browser = await chromium.launch({headless:true,args:['--no-sandbox']});
    for (const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
      const context = await browser.newContext({viewport:{width,height},timezoneId:'Asia/Taipei'});
      await context.route('**/*', route => new URL(route.request().url()).origin===started.url ? route.continue() : route.abort());
      const login = await context.request.post(started.url+'/api/admin/login',{data:{email:'calendar-owner@example.test',password:'Fixture9Pass'}});
      assert.equal(login.status(),200);
      // Production cookies are Secure. Carry the real login session into this
      // localhost-only HTTP fixture, as the existing API acceptance runners do.
      const cookie=login.headers()['set-cookie'].split(';')[0], split=cookie.indexOf('=');
      await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:started.url}]);
      for (const resource of ['month?propertyId=calendar_b&year=2026&month=9','day-note?propertyId=calendar_b']) {
        const response = await context.request.get(started.url+'/api/availability/'+resource);
        assert.equal(response.status(),403,'session must reject another property');
      }
      const crossWrite = await context.request.post(started.url+'/api/availability/day',{data:{propertyId:'calendar_b',date:'2026-09-23',roomTypeId:'suite_x',status:'closed'}});
      assert.equal(crossWrite.status(),403);
      await context.request.post(started.url+'/api/availability/day',{data:{propertyId:'calendar_a',date:'2026-09-23',roomTypeId:'suite_x',status:'available'}});
      const page = await context.newPage(), errors=[], writes=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('request',request=>{if(request.method()!=='GET')writes.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});});
      await page.clock.setFixedTime(new Date('2026-09-17T04:00:00Z'));
      await page.goto(started.url+'/admin');
      await page.locator('#workspace').waitFor({state:'visible'});
      await page.locator('#status').getByText('房況已載入',{exact:true}).waitFor();
      await page.locator('[data-view=calendar]').click();
      await page.waitForFunction(()=>document.querySelector('#calendarGrid [data-date="2026-09-23"]'));
      assert.equal(await page.locator('#calendarGrid button[data-date]').count(),30);
      assert.deepEqual(await page.locator('.calendar-weekday').allTextContents(),['日','一','二','三','四','五','六']);
      assert.equal(await page.locator('#calendarGrid [data-date="2026-09-01"]').getAttribute('aria-label').then(s=>s.includes('請設定房況')),true);
      assert.ok(!(await page.locator('#calendarGrid').textContent()).includes('B_PRIVATE_ROOM'));
      const day=page.locator('#calendarGrid [data-date="2026-09-23"]');
      await day.click();
      const detail=page.locator('#dayDetails');
      assert.ok((await detail.textContent()).includes('湖景套房'));
      const room=detail.locator('.availability-room-row').filter({hasText:'湖景套房'});
      await room.locator('.status-toggle').uncheck();
      await page.waitForFunction(()=>document.querySelector('#calendarGrid [data-date="2026-09-23"]').textContent.includes('0 開放'));
      assert.equal(writes.at(-1).path,'/api/availability/day');
      assert.equal(writes.at(-1).body.roomTypeId,'suite_x');
      await page.locator('[data-view=daily]').click();
      const listDay=page.locator('#dailyAvailability .availability-day-card').filter({has:page.locator('h3',{hasText:'9/23'})});
      const listRoom=listDay.locator('.availability-room-row').filter({hasText:'湖景套房'});
      assert.equal(await listRoom.locator('.status-toggle').isChecked(),false);
      await listRoom.locator('.status-toggle').check();
      await page.waitForFunction(()=>document.querySelector('#calendarGrid [data-date="2026-09-23"]').textContent.includes('1 開放'));
      await page.locator('[data-view=calendar]').click();await day.click();
      await room.locator('.note-button').click();await page.locator('#noteText').fill('測試備註 '+label);await page.locator('#noteSave').click();
      await page.locator('#noteStatus').getByText('已儲存內部備註',{exact:true}).waitFor();
      assert.equal(writes.at(-1).path,'/api/availability/day-note');
      assert.ok((await detail.textContent()).includes('測試備註 '+label));
      await page.locator('#noteClose').click();
      await page.locator('#calendarRoomFilter').selectOption('loft_y');await page.locator('#calendarStatusFilter').selectOption('available');
      assert.equal(await page.locator('#calendarGrid button[data-date]:not([disabled])').count(),0);
      await page.locator('#calendarRoomFilter').selectOption('suite_x');await page.locator('#calendarStatusFilter').selectOption('notes');
      assert.equal(await page.locator('#calendarGrid button[data-date]:not([disabled])').count(),1);
      await page.locator('#calendarStatusFilter').selectOption('all');await page.locator('#calendarRoomFilter').selectOption('all');
      await page.locator('#calendarNext').click();await page.waitForFunction(()=>document.querySelector('#calendarGrid [data-date="2026-10-01"]'));
      assert.equal(await page.locator('#month').inputValue(),'2026-10');
      await page.locator('#calendarPrevious').click();await page.waitForFunction(()=>document.querySelector('#calendarGrid [data-date="2026-09-01"]'));
      await page.locator('#month').fill('2028-02');await page.locator('#month').dispatchEvent('change');
      await page.waitForFunction(()=>document.querySelector('#calendarGrid [data-date="2028-02-29"]'));
      assert.equal(await page.locator('#calendarGrid button[data-date]').count(),29);
      await page.locator('#calendarToday').click();await page.waitForFunction(()=>document.querySelector('#calendarGrid [data-date="2026-09-17"].is-selected'));
      assert.equal(await page.locator('#month').inputValue(),'2026-09');
      const monthResponse=await context.request.get(started.url+'/api/availability/month?year=2026&month=9&propertyId=calendar_a');
      const data=(await monthResponse.json()).data;assert.equal(data.notesByDate['2026-09-23']['room:suite_x'].note,'測試備註 '+label);
      assert.equal(data.rows.find(row=>row.date==='2026-09-23').suite_x,'available');
      assert.ok(!(await page.locator('#availabilityCalendar').textContent()).includes('已訂房'));
      for (const tab of ['availability','pricing','bundles','ai','other']) {
        if(label==='mobile')await page.locator('#adminTabSelect').selectOption(tab);else await page.locator('[data-admin-tab='+tab+']').click();
        // A UI-only spacer models long content without changing any business data.
        await page.evaluate(()=>{const spacer=document.createElement('div');spacer.id='testSpacer';spacer.style.height='1800px';document.querySelector('#workspace').append(spacer);window.scrollTo(0,0);});
        await page.waitForFunction(()=>document.getElementById('adminBackToTop').hidden);
        await page.evaluate(()=>window.scrollTo(0,900));await page.locator('#adminBackToTop').waitFor({state:'visible'});
        const box=await page.locator('#adminBackToTop').boundingBox();assert.ok(box.width>=44&&box.height>=44&&box.x>=0&&box.x+box.width<=width&&box.y+box.height<height);
        await page.locator('#adminBackToTop').click();await page.waitForFunction(()=>window.scrollY===0);
        await page.locator('#testSpacer').evaluate(node=>node.remove());
      }
      assert.equal(await page.locator('#adminBackToTop').count(),1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
      assert.deepEqual(errors,[]);
      if(process.env.CALENDAR_EVIDENCE_DIR){if(label==='mobile')await page.locator('#adminTabSelect').selectOption('availability');else await page.locator('[data-admin-tab=availability]').click();await page.screenshot({path:path.join(process.env.CALENDAR_EVIDENCE_DIR,label+'.png'),fullPage:true});}
      await context.close();console.log('PASS '+label+': same persisted availability/notes, bidirectional edits, navigation/filter/unknown, session isolation, TOP in five pages');
    }
  } finally {if(browser)await browser.close();await app.stop();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
