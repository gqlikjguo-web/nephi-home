'use strict';
// FAKE_INTEGRATION: actual admin/guest pages, gallery HTTP routes, PGlite and image sanitizer.
// Sessions, unrelated page APIs and R2 transport are doubles. No external service calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { fixture } = require('./room-gallery-runner');
const { sessionTokenHash } = require('../lib/admin-auth');
const { createRoomGalleryRoutes } = require('../lib/room-gallery-routes');
const origin = 'https://gallery-browser.example.test';
const publicDir = path.resolve(__dirname, '../public');
const room = { id: 'double', name: '雙人房', displayName: '雙人房', capacity: 2, roomCode: 'D1', highlights: ['採光明亮'], enabled: true, mondayThursdayPrice: 2000, fridayPrice: 2200, saturdayHolidayPrice: 2600, sundayPrice: 2000 };
const emptyRoom = { ...room, id: 'empty', name: '無照片房型', displayName: '無照片房型', roomCode: 'E1' };

async function run() {
  const f = await fixture(); let store = f.make();
  await f.db.query('INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,$2,$3,2,$4,$5,1)', ['gallery_a', 'empty', emptyRoom.name, 'room', '']);
  const sessions = new Map(['gallery_a', 'gallery_b'].map(id => [sessionTokenHash(id), { propertyId: id, properties: [{ propertyId: id }] }]));
  const properties = ['gallery_a', 'gallery_b'].map((id, index) => ({ propertyId: id, businessProfile: { publicSlug: 'lodge' + index }, onboarding: { isReady: true } }));
  const actualRequests = [];
  const route = createRoomGalleryRoutes({ getStore: async () => store, persistence: { getAdminSession: async hash => sessions.get(hash) }, customerSettings: { listProperties: () => properties }, publicBaseUrl: origin, sendData: (res, data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data })); } });
  const server = http.createServer(async (req, res) => {
    actualRequests.push({ method: req.method, path: new URL(req.url, origin).pathname });
    try { if (!await route(req, res, new URL(req.url, origin))) { res.writeHead(404); res.end(); } }
    catch (error) { res.writeHead(error.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  let browser;
  const errors = [], results = [];
  const png = await require('sharp')({ create: { width: 480, height: 320, channels: 3, background: '#789783' } }).png().toBuffer();
  async function openPage(actor, width, guest = false) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    if (!guest) await context.addCookies([{ name: 'nephi_admin_session', value: actor, url: origin }]);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async intercepted => {
      const request = intercepted.request(), url = new URL(request.url()), pathname = url.pathname;
      if (url.origin === 'https://photos.example.test') {
        const bytes = f.objects.get(pathname.slice(1));
        return intercepted.fulfill({ status: bytes ? 200 : 404, contentType: 'image/jpeg', body: bytes || '' });
      }
      assert.equal(url.origin, origin, 'browser may only use isolated test transports');
      if (pathname.startsWith('/api/room-gallery/') || pathname === '/api/public/room-gallery') {
        const headers = await request.allHeaders(); delete headers.host; delete headers['content-length'];
        const response = await fetch(base + pathname + url.search, { method: request.method(), headers, body: ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postDataBuffer() });
        return intercepted.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      let data;
      const rooms = actor === 'gallery_a' ? [room, emptyRoom] : [room];
      if (pathname === '/api/admin/session') data = { propertyId: actor, properties: [{ propertyId: actor }], role: 'operator' };
      else if (pathname === '/api/availability/month') data = { propertyId: actor, rooms, rows: [], notesByDate: {} };
      else if (pathname === '/api/room-pricing') data = { rooms, overrides: [] };
      else if (pathname === '/api/bundles') data = { bundles: [] };
      else if (pathname === '/api/room-composition') data = { propertyId: actor, composition: null };
      else if (pathname === '/api/property-profile') data = { propertyName: '照片測試旅宿', checkInTime: '15:00', checkOutTime: '11:00' };
      else if (pathname === '/api/property-facts') data = { facts: [] };
      else if (pathname === '/api/custom-replies') data = { rules: [] };
      else if (pathname === '/api/public/property') data = { propertyName: '照片測試旅宿', inventoryOptions: rooms.map(item => ({ ...item, inventoryType: 'room' })) };
      else if (pathname === '/api/public/availability') data = { propertyName: '照片測試旅宿', checkInDate: url.searchParams.get('checkIn'), checkOutDate: url.searchParams.get('checkOut'), rooms: rooms.map(item => ({ ...item, nightlyPrices: [{ date: url.searchParams.get('checkIn'), price: 2000 }] })), bundles: [], lineUrl: '', empty: false };
      else if (pathname.startsWith('/api/')) data = { propertyId: actor, items: [], conversations: [], aiEnabled: true };
      if (data) return intercepted.fulfill({ json: { data } });
      const filename = path.join(publicDir, pathname === '/admin' ? 'admin.html' : pathname.startsWith('/lodge') ? 'guest.html' : pathname);
      assert.ok(filename.startsWith(publicDir + path.sep));
      if (!fs.existsSync(filename)) return intercepted.fulfill({ status: 404, body: '' });
      return intercepted.fulfill({ contentType: pathname.endsWith('.js') ? 'application/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(filename) });
    });
    await page.goto(origin + (guest ? actor === 'gallery_a' ? '/lodge0' : '/lodge1' : '/admin'));
    if (guest) {
      await page.waitForFunction(() => !document.querySelector('#inventoryChoice').disabled);
      await page.locator('#checkIn').fill('2026-10-01'); await page.locator('#checkOut').fill('2026-10-02');
      await page.locator('#searchForm button').click(); await page.locator('#results').waitFor({ state: 'visible' });
    } else {
      await page.locator('#roomDetails [data-room-detail-id="double"]').waitFor({ state: 'attached' });
      if (width < 640) await page.locator('#adminTabSelect').selectOption('pricing');
      else await page.locator('[data-admin-tab="pricing"]').click();
      await page.locator('#roomDetails [data-room-detail-id="double"] .room-gallery-upload').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('[data-room-detail-id="double"] .room-gallery-upload').disabled);
    }
    return { page, context };
  }
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    for (const width of [1280, 390, 360]) {
      const admin = await openPage('gallery_a', width), other = await openPage('gallery_b', width);
      const card = admin.page.locator('[data-room-detail-id="double"]');
      assert.equal(await card.locator('.room-gallery-heading h4').textContent(), '房間照片');
      await card.locator('input[data-room-field="displayName"]').fill('');
      await card.locator('input[type=file]').setInputFiles([{ name: 'room-one.png', mimeType: 'image/png', buffer: png }, { name: 'room-two.png', mimeType: 'image/png', buffer: png }]);
      await card.getByText('2/10', { exact: true }).waitFor();
      assert.equal(await card.locator('input[data-room-field="displayName"]').inputValue(), '', 'photo upload leaves pricing draft untouched');
      assert.equal(await admin.page.locator('#pricingStatus').textContent(), '有未儲存變更');
      let photos = await store.list('gallery_a', 'double'); assert.equal(photos.length, 2);
      const firstId = photos[0].id;
      for (const bytes of f.objects.values()) { assert.equal(bytes[0], 255); assert.equal(bytes[1], 216); assert.equal((await require('sharp')(bytes).metadata()).format, 'jpeg'); }
      assert.deepEqual(await store.list('gallery_b', 'double'), []);
      assert.equal(await other.page.locator('.room-gallery-preview').count(), 0);
      const denied = await other.page.evaluate(async id => (await fetch('/api/room-gallery/double/' + id + '?propertyId=gallery_b', { method: 'DELETE' })).status, firstId);
      assert.equal(denied, 404);
      const mismatch = await other.page.evaluate(async () => (await fetch('/api/room-gallery/double?propertyId=gallery_a')).status); assert.equal(mismatch, 403);
      store = f.make(); await admin.page.reload();
      if (width < 640) await admin.page.locator('#adminTabSelect').selectOption('pricing'); else await admin.page.locator('[data-admin-tab="pricing"]').click();
      await card.getByText('2/10', { exact: true }).waitFor();
      assert.equal(await card.locator('.room-gallery-preview').first().getAttribute('src'), photos[0].previewUrl, 'reload reads persisted preview');
      await card.getByRole('button', { name: '將第 1 張照片往後移' }).click();
      await admin.page.waitForFunction(id => document.querySelector('[data-room-detail-id="double"] .room-gallery-tile:last-child').dataset.photoId === id, firstId);
      photos = await store.list('gallery_a', 'double'); assert.equal(photos[1].id, firstId);
      const guest = await openPage('gallery_a', width, true), guestOther = await openPage('gallery_b', width, true);
      const guestCard = guest.page.locator('.result-card').filter({ has: guest.page.getByText('雙人房', { exact: true }) });
      await guestCard.locator('.room-gallery-main').waitFor({ state: 'visible' });
      assert.equal(await guestCard.locator('.room-gallery-main').getAttribute('src'), photos[0].originalUrl, 'public primary follows persisted order');
      assert.equal(await guestCard.locator('.room-gallery-thumb').first().locator('img').getAttribute('src'), photos[0].previewUrl);
      await guestCard.locator('.room-gallery-main').evaluate(image => image.decode());
      const empty = guest.page.locator('.result-card').filter({ has: guest.page.getByText('無照片房型', { exact: true }) });
      assert.equal(await empty.locator('.room-gallery').count(), 0); assert.ok((await empty.textContent()).includes('2,000'));
      assert.equal(await guestOther.page.locator('.room-gallery').count(), 0);
      for (const page of [admin.page, other.page, guest.page, guestOther.page]) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      for (const button of await card.locator('.room-gallery button:visible').all()) assert.ok((await button.boundingBox()).height >= 44);
      if (process.env.ROOM_GALLERY_EVIDENCE) {
        await card.screenshot({ path: path.join(process.env.ROOM_GALLERY_EVIDENCE, 'actual-admin-' + width + '.png') });
        await guest.page.locator('#results').screenshot({ path: path.join(process.env.ROOM_GALLERY_EVIDENCE, 'actual-guest-' + width + '.png') });
      }
      await card.getByRole('button', { name: '刪除第 1 張照片' }).click(); await card.getByText('1/10', { exact: true }).waitFor();
      await card.getByRole('button', { name: '刪除第 1 張照片' }).click(); await card.getByText('0/10', { exact: true }).waitFor();
      assert.deepEqual(await store.list('gallery_a', 'double'), []); assert.equal(f.objects.size, 0);
      await guest.page.locator('#searchForm button').click();
      await guest.page.waitForFunction(() => !document.querySelector('#results .room-gallery'));
      assert.ok((await guest.page.locator('#roomResults').textContent()).includes('雙人房'));
      results.push({ width, passed: true, sanitizedJpeg: true, persistedReload: true, scopedIsolation: true, orderedPublicPhotos: true, deletionFallback: true });
      for (const value of [admin, other, guest, guestOther]) await value.context.close();
    }
    assert.deepEqual(errors, []);
    assert.ok(actualRequests.some(value => value.method === 'POST'));
    assert.ok(actualRequests.some(value => value.method === 'PUT'));
    assert.ok(actualRequests.some(value => value.method === 'DELETE'));
    if (process.env.ROOM_GALLERY_EVIDENCE) fs.writeFileSync(path.join(process.env.ROOM_GALLERY_EVIDENCE, 'actual-browser-results.json'), JSON.stringify({ classification: 'FAKE_INTEGRATION', results, actualRequests }, null, 2));
    console.log('PASS FAKE_INTEGRATION actual HTML/JS hooks + actual gallery HTTP/PGlite/sanitizer, desktop/390/360, upload/reload/public/order/delete/isolation/no-photo fallback; R2/session/other page APIs doubled; external calls=0');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); await f.db.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
