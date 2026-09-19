"use strict";
// RUNTIME_COMPONENT_TEST / FAKE_INTEGRATION: real browser, authenticated HTTP,
// formal writer and Resolver, isolated PGlite. No external calls.
const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
test("missing dates are not displayed as closed and can be explicitly closed without opening first", async () => {
  const connection = { kind: "pglite", dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "availability-missing-ui-")) };
  await require("../lib/providers/postgres-migrate").migratePostgres(connection);
  const db = await require("../lib/providers/postgres-client").openPostgres(connection);
  try {
    for (const id of ["closure-a", "closure-b"]) {
      await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,$1)", [id]);
      await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb)", [id]);
      await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,position) VALUES($1,'suite','測試套房',2,0)", [id]);
    }
  } finally { await db.close(); }
  await require("../lib/admin-auth").upsertAdminUser(connection, { propertyId: "closure-a", username: "closure-owner", email: "closure-owner@example.test", password: "Fixture9Pass" });
  const providers = require("../lib/providers/postgres-providers").createPostgresProviders(connection);
  const app = require("../server").createApp({ providers, structuredClassifier: null });
  const started = await app.start(0, "127.0.0.1");
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Taipei" });
    await context.route("**/*", route => new URL(route.request().url()).origin === started.url ? route.continue() : route.abort());
    const login = await context.request.post(started.url + "/api/admin/login", { data: { email: "closure-owner@example.test", password: "Fixture9Pass" } });
    assert.equal(login.status(), 200);
    const cookie = login.headers()["set-cookie"].split(";")[0], split = cookie.indexOf("=");
    await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: started.url }]);
    const page = await context.newPage(), errors = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/availability/day") writes.push(request.postDataJSON()); });
    await page.clock.setFixedTime(new Date("2026-09-19T03:00:00Z"));
    await page.goto(started.url + "/admin");
    await page.locator("#status").getByText("房況已載入", { exact: true }).waitFor();
    const service = require("../lib/mvp-service").createMvpService(providers);
    for (const [date, month, label] of [
      ["2026-09-28", "2026-09", "9/28"], ["2026-11-25", "2026-11", "11/25"],
      ["2026-12-25", "2026-12", "12/25"], ["2027-01-02", "2027-01", "1/2"],
      ["2026-11-26", "2026-11", "11/26"]
    ]) {
      const checkout = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
      await page.locator('[data-view="calendar"]').click();
      await page.locator("#month").fill(month); await page.locator("#month").dispatchEvent("change");
      await page.locator(`#calendarGrid [data-date="${date}"]`).waitFor();
      await page.locator('[data-view="daily"]').click();
      const card = page.locator("#dailyAvailability .availability-day-card").filter({ has: page.locator("h3", { hasText: label + "（" }) });
      assert.equal(await card.locator(".status-toggle").count(), 0, "missing must not look like a closed toggle");
      assert.equal(await card.locator(".status-text").count(), 0, "missing is not a third business status");
      assert.equal(await card.locator(".room-status-control").getByRole("button").allTextContents().then(x=>x.sort()).then(x=>x.join("/")), "開放/關閉");
      for (const forbidden of ["尚未設定", "無資料", "無房況資料", "missing", "unknown", "inventory"]) {
        assert.ok(!(await card.locator(".room-status-control").innerText()).includes(forbidden));
      }
      assert.ok((await card.locator(".day-summary").textContent()).includes("0 關閉"));
      assert.deepEqual(providers.availability.getRows("closure-a", date, checkout), []);
      const before = writes.length;
      await card.getByRole("button", { name: "關閉", exact: true }).click();
      await card.getByText("已儲存", { exact: true }).waitFor();
      assert.equal(writes.length, before + 1); assert.equal(writes.at(-1).status, "closed");
      assert.equal(await card.locator(".status-text").textContent(), "關閉");
      assert.equal(providers.availability.getRows("closure-a", date, checkout)[0].suite, "closed");
      assert.equal(service.searchAvailability({ customerId: "closure-a", checkIn: date, checkOut: checkout }).feasibility.inventoryStatus, "closed");
      await card.locator(".status-toggle").check();
      await card.getByText("已儲存", { exact: true }).waitFor();
      assert.equal(writes.length, before + 2); assert.equal(writes.at(-1).status, "available");
      assert.equal(await card.locator(".status-text").textContent(), "開放");
      assert.equal(providers.availability.getRows("closure-a", date, checkout)[0].suite, "available");
      assert.equal(service.searchAvailability({ customerId: "closure-a", checkIn: date, checkOut: checkout }).rooms.length, 1);
      assert.deepEqual(providers.availability.getRows("closure-b", date, checkout), []);
      await page.reload(); await page.locator("#status").getByText("房況已載入", { exact: true }).waitFor();
      await page.locator('[data-view="calendar"]').click();
      await page.locator("#month").fill(month); await page.locator("#month").dispatchEvent("change");
      await page.locator(`#calendarGrid [data-date="${date}"]`).waitFor();
      await page.locator('[data-view="daily"]').click();
      assert.equal(await card.locator(".status-text").textContent(), "開放");
      assert.equal(await card.locator(".status-toggle").isChecked(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    // Opening must also create a formal row directly, without closing first.
    await page.locator('[data-view="calendar"]').click();
    await page.locator("#month").fill("2027-01"); await page.locator("#month").dispatchEvent("change");
    await page.locator('#calendarGrid [data-date="2027-01-03"]').click();
    const detail = page.locator("#dayDetails");
    assert.deepEqual(providers.availability.getRows("closure-a", "2027-01-03", "2027-01-04"), []);
    await detail.getByRole("button", { name: "開放", exact: true }).click();
    await detail.getByText("已儲存", { exact: true }).waitFor();
    assert.equal(writes.at(-1).status, "available");
    assert.equal(providers.availability.getRows("closure-a", "2027-01-03", "2027-01-04")[0].suite, "available");
    assert.equal(service.searchAvailability({ customerId: "closure-a", checkIn: "2027-01-03", checkOut: "2027-01-04" }).rooms.length, 1);
    assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); await app.stop(); fs.rmSync(connection.dataDir, { recursive: true, force: true }); }
});
