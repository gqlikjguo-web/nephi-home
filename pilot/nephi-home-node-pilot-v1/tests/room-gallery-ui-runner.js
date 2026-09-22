'use strict';
// FAKE_INTEGRATION: real Chromium renders production gallery modules; HTTP API doubles only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const asset = name => path.join(root, 'public/assets', name);
const origin = 'https://gallery.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=', 'base64');

async function main() {
  assert.ok(fs.existsSync(asset('admin-room-gallery.js')), 'admin room gallery module is required');
  assert.ok(fs.existsSync(asset('guest-room-gallery.js')), 'guest room gallery module is required');
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [1280, 390, 360]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let items = [], serial = 0, writes = 0, fail = false, switchOnUpload = false, incompleteUpload = false;
      const makeItem = () => { const id = 'photo-' + (++serial); return { id, previewUrl: origin + '/' + id + '.png', originalUrl: origin + '/' + id + '.png', position: serial }; };
      await page.route(origin + '/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.includes('/api/')) {
          if (url.pathname.startsWith('/api/room-gallery/')) assert.equal(url.searchParams.get('propertyId'), 'gallery-a');
          if (fail) return route.fulfill({ status: 503, json: { error: { message: '照片服務暫時無法使用' } } });
          if (request.method() === 'POST') {
            assert.equal(request.headers()['content-type'], 'image/png'); writes++;
            if (incompleteUpload) { items.push({ ...makeItem(), ready: false, previewUrl: null, originalUrl: null }); return route.fulfill({ status: 503, json: { error: { message: '照片上傳未完成，請刪除後重新上傳。' } } }); }
            items.push(makeItem()); if (switchOnUpload) await page.evaluate(() => { window.currentProperty = 'gallery-b'; });
          }
          if (request.method() === 'DELETE') { writes++; items = items.filter(item => item.id !== url.pathname.split('/').pop()); }
          if (request.method() === 'PUT') { writes++; const ids = request.postDataJSON().photoIds; items = ids.map(id => items.find(item => item.id === id)); }
          return route.fulfill({ json: { data: { items } } });
        }
        if (url.pathname.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: PNG });
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main style="max-width:700px;margin:auto;padding:16px"><form id="pricing"><input required id="required-price"><article id="admin"></article></form><article id="guest" class="result-card"><strong>雙人房</strong><span>NT$2,000</span></article></main></body></html>' });
      });
      await page.goto(origin);
      await page.addStyleTag({ path: asset('styles.css') });
      await page.addStyleTag({ path: asset('room-gallery.css') });
      await page.addScriptTag({ path: asset('admin-room-gallery.js') });
      await page.addScriptTag({ path: asset('guest-room-gallery.js') });
      await page.evaluate(() => { window.currentProperty = 'gallery-a'; window.submits = 0; document.querySelector('#pricing').onsubmit = event => { event.preventDefault(); window.submits++; }; document.querySelector('#admin').append(AdminRoomGallery.create('room-a', 'gallery-a', () => window.currentProperty)); });
      const admin = page.locator('#admin');
      await admin.getByText('0/10', { exact: true }).waitFor();
      const upload = name => ({ name, mimeType: 'image/png', buffer: PNG });
      await admin.locator('input[type=file]').setInputFiles([upload('one.png'), upload('two.png')]);
      await admin.getByText('2/10', { exact: true }).waitFor();
      assert.equal(writes, 2); assert.equal(await page.evaluate(() => window.submits), 0);
      assert.equal(await admin.locator('button:not([type="button"])').count(), 0);
      const firstId = items[0].id;
      await admin.getByRole('button', { name: '將第 1 張照片往後移' }).click();
      await page.waitForFunction(id => document.querySelector('.room-gallery-admin-list > :last-child').dataset.photoId === id, firstId);
      assert.equal(items[1].id, firstId);
      await admin.getByRole('button', { name: '刪除第 2 張照片' }).click();
      await admin.getByText('1/10', { exact: true }).waitFor();
      await admin.locator('input[type=file]').setInputFiles({ name: 'bad.gif', mimeType: 'image/gif', buffer: PNG });
      await admin.getByText(/僅支援 JPG/).last().waitFor(); assert.equal(writes, 4);
      await admin.locator('input[type=file]').setInputFiles(Array.from({ length: 9 }, (_, i) => upload('more-' + i + '.png')));
      await admin.getByText('10/10', { exact: true }).waitFor();
      assert.equal(await admin.getByRole('button', { name: '上傳房型照片' }).isDisabled(), true);
      await page.evaluate(() => GuestRoomGallery.attach(document.querySelector('#guest'), { roomId: 'room-a', slug: 'gallery', name: '雙人房' }));
      await page.locator('.room-gallery-main').waitFor({ state: 'visible' });
      await page.locator('.room-gallery-thumb').nth(1).click();
      assert.equal(await page.locator('.room-gallery-thumb').nth(1).getAttribute('aria-pressed'), 'true');
      await page.locator('.room-gallery-main').evaluate(target => {
        const start = new Touch({ identifier: 1, target, clientX: 180, clientY: 100 });
        const end = new Touch({ identifier: 1, target, clientX: 50, clientY: 100 });
        target.dispatchEvent(new TouchEvent('touchstart', { touches: [start] }));
        target.dispatchEvent(new TouchEvent('touchend', { changedTouches: [end] }));
      });
      assert.equal(await page.locator('.room-gallery-thumb').nth(2).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      for (const button of await page.locator('.room-gallery button:visible').all()) assert.ok((await button.boundingBox()).height >= 44);
      if (process.env.ROOM_GALLERY_EVIDENCE) await page.screenshot({ path: path.join(process.env.ROOM_GALLERY_EVIDENCE, 'gallery-' + width + '.png'), fullPage: true });
      const currentWrites = writes;
      await page.evaluate(() => { window.currentProperty = 'gallery-b'; });
      await admin.getByRole('button', { name: '刪除第 1 張照片' }).click();
      await admin.getByText(/旅宿已切換/).waitFor(); assert.equal(writes, currentWrites);
      items = []; await page.evaluate(() => { document.querySelector('#guest').innerHTML = '<strong>原有房型</strong>'; return GuestRoomGallery.attach(document.querySelector('#guest'), { roomId: 'empty', slug: 'gallery', name: '空房型' }); });
      assert.equal(await page.locator('#guest').innerHTML(), '<strong>原有房型</strong>');
      fail = true; await page.evaluate(() => GuestRoomGallery.attach(document.querySelector('#guest'), { roomId: 'error', slug: 'gallery', name: '空房型' }));
      assert.equal(await page.locator('#guest').innerHTML(), '<strong>原有房型</strong>');
      fail = false; switchOnUpload = true;
      await page.evaluate(() => { window.currentProperty = 'gallery-a'; document.querySelector('#admin').replaceChildren(AdminRoomGallery.create('room-a', 'gallery-a', () => window.currentProperty)); });
      await admin.getByText('0/10', { exact: true }).waitFor();
      await admin.locator('input[type=file]').setInputFiles([upload('switch-one.png'), upload('switch-two.png')]);
      await admin.getByText(/旅宿已切換/).waitFor(); assert.equal(writes, currentWrites + 1, 'switch cancels remaining upload queue');
      switchOnUpload = false; incompleteUpload = true; items = [];
      await page.evaluate(() => { window.currentProperty = 'gallery-a'; document.querySelector('#admin').replaceChildren(AdminRoomGallery.create('room-a', 'gallery-a', () => window.currentProperty)); });
      await page.waitForFunction(() => !document.querySelector('.room-gallery-upload').disabled);
      await admin.locator('input[type=file]').setInputFiles([upload('incomplete.png'), upload('not-retried.png')]);
      await admin.getByText('上傳未完成', { exact: true }).waitFor();
      assert.equal(await admin.locator('img').count(), 0);
      assert.equal(writes, currentWrites + 2, 'failed upload does not retry or continue the queue');
      await admin.getByText('1/10', { exact: true }).waitFor();
      await admin.getByRole('button', { name: '刪除第 1 張照片' }).click();
      await admin.getByText('0/10', { exact: true }).waitFor();
      fail = true;
      await page.evaluate(() => document.querySelector('#admin').replaceChildren(AdminRoomGallery.create('room-a', 'gallery-a', () => window.currentProperty)));
      await admin.getByText('照片服務暫時無法使用', { exact: true }).waitFor();
      assert.equal(await admin.getByRole('button', { name: '上傳房型照片' }).isDisabled(), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS FAKE_INTEGRATION room gallery browser desktop/390/360: upload, max10, reorder, delete, form isolation, stale property queue, incomplete upload recovery, unavailable service, thumbnails/swipe, empty/error fallback; external calls=0');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
