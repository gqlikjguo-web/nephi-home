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
    await page.locator("#month").fill("2026-11");
    await page.locator("#month").dispatchEvent("change");
    await page.locator('#calendarGrid [data-date="2026-11-25"]').waitFor();
    await page.locator('[data-view="daily"]').click();
    const card = page.locator("#dailyAvailability .availability-day-card").filter({ has: page.locator("h3", { hasText: "11/25" }) });
    assert.equal(await card.locator(".status-text").textContent(), "尚未設定");
    assert.ok(!(await card.locator(".day-summary").textContent()).includes("1 不可售"));
    assert.deepEqual(providers.availability.getRows("closure-a", "2026-11-25", "2026-11-26"), []);
    assert.equal(writes.length, 0, "viewing missing dates must not create availability facts");
    await card.getByRole("button", { name: "設為關閉", exact: true }).click();
    await card.getByText("已儲存", { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].status, "closed");
    assert.equal(providers.availability.getRows("closure-a", "2026-11-25", "2026-11-26")[0].suite, "closed");
    assert.deepEqual(providers.availability.getRows("closure-b", "2026-11-25", "2026-11-26"), []);
    const service = require("../lib/mvp-service").createMvpService(providers);
    assert.equal(service.searchAvailability({ customerId: "closure-a", checkIn: "2026-11-25", checkOut: "2026-11-26" }).feasibility.inventoryStatus, "closed");
    await page.reload();
    await page.locator("#status").getByText("房況已載入", { exact: true }).waitFor();
    const stored = await context.request.get(started.url + "/api/availability/month?propertyId=closure-a&year=2026&month=11");
    assert.equal((await stored.json()).data.rows.find(row => row.date === "2026-11-25").suite, "closed");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); await app.stop(); fs.rmSync(connection.dataDir, { recursive: true, force: true }); }
});
