"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { migratePostgres } = require(path.join(root, "lib/providers/postgres-migrate"));
const { seedPostgres } = require(path.join(root, "lib/providers/postgres-seed"));
const { openPostgres } = require(path.join(root, "lib/providers/postgres-client"));
const { createPostgresProviders } = require(path.join(root, "lib/providers/postgres-providers"));
const { upsertAdminUser } = require(path.join(root, "lib/admin-auth"));
const { createApp } = require(path.join(root, "server"));

const rooms = Array.from({ length: 5 }, (_, index) => ({
  key: `r${index + 1}`, name: `房型 ${index + 1}`, type: "自訂", capacity: index + 2,
  mondayThursdayPrice: 1800 + index * 100, fridayPrice: 2000 + index * 100,
  saturdayHolidayPrice: 2400 + index * 100, sundayPrice: 1900 + index * 100, enabled: true
}));
const bundlePrices = { mondayThursdayPrice: 9000, fridayPrice: 10000, saturdayHolidayPrice: 12000, sundayPrice: 9500 };
const payload = {
  propertyName: "五房型測試旅宿", contactName: "測試業者", phone: "0911222333", email: "owner@example.com",
  address: "測試地址", checkInTime: "15:00", checkOutTime: "11:00",
  line: { hasOfficialAccount: false, channelId: "", contactLink: "" }, rooms,
  bundles: [{ key: "all_rooms", name: "五房包棟", memberRoomKeys: rooms.map((room) => room.key), capacity: 15, ...bundlePrices, enabled: true }],
  knowledge: [{ key: "parking", label: "停車方式", status: "fixed", answer: "提供停車位" }]
};

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body, text };
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-bundle-pricing-state-"));
  const connection = { kind: "pglite", dataDir: temp };
  await migratePostgres(connection);
  await migratePostgres(connection);
  await seedPostgres(connection);
  await upsertAdminUser(connection, { propertyId: "nephi_home", username: "platform", password: "platform-password-123" });
  let db = await openPostgres(connection);
  await db.query("INSERT INTO platform_admin_grants(property_id,username) VALUES($1,$2)", ["nephi_home", "platform"]);
  await db.close();
  const providers = createPostgresProviders(connection);
  const app = createApp({ providers, structuredClassifier: null, adminAuthRequired: true });
  const running = await app.start(0, "127.0.0.1");
  const base = running.url;
  try {
    let result = await request(`${base}/api/public/onboarding/drafts`, { method: "POST" });
    const { applicationId, draftToken } = result.body.data;
    const draftHeaders = { "content-type": "application/json", "x-onboarding-draft-token": draftToken };
    result = await request(`${base}/api/public/onboarding/drafts/${applicationId}`, { method: "PATCH", headers: draftHeaders, body: JSON.stringify(payload) });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.rooms.length, 5);
    assert.deepEqual(result.body.data.bundles[0].memberRoomKeys, rooms.map((room) => room.key));
    for (const [key, price] of Object.entries(bundlePrices)) assert.equal(result.body.data.bundles[0][key], price, `草稿保存 ${key}`);

    result = await request(`${base}/api/public/onboarding/drafts/${applicationId}/submit`, { method: "POST", headers: { "x-onboarding-draft-token": draftToken } });
    assert.equal(result.body.data.status, "submitted");
    for (const [key, price] of Object.entries(bundlePrices)) assert.equal(result.body.data.bundles[0][key], price, `送審 snapshot 保存 ${key}`);

    result = await request(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "nephi_home", username: "platform", password: "platform-password-123" }) });
    const platformCookie = result.response.headers.get("set-cookie").split(";")[0];
    result = await request(`${base}/api/admin/onboarding/applications`, { headers: { cookie: platformCookie } });
    const reviewed = result.body.data.items.find((item) => item.applicationId === applicationId);
    for (const [key, price] of Object.entries(bundlePrices)) assert.equal(reviewed.bundles[0][key], price, `審核 API 顯示 ${key}`);

    result = await request(`${base}/api/admin/onboarding/applications/${applicationId}/request-changes`, { method: "POST", headers: { cookie: platformCookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "請確認週六價格" }) });
    assert.equal(result.body.data.status, "changes_requested");
    result = await request(`${base}/api/public/onboarding/drafts/${applicationId}`, { method: "PATCH", headers: draftHeaders, body: JSON.stringify({ ...payload, bundles: [{ ...payload.bundles[0], sundayPrice: 9600 }] }) });
    assert.equal(result.body.data.status, "changes_requested", "補件保存後仍為待補件");
    result = await request(`${base}/api/public/onboarding/drafts/${applicationId}/submit`, { method: "POST", headers: { "x-onboarding-draft-token": draftToken } });
    assert.equal(result.body.data.status, "resubmitted");

    result = await request(`${base}/api/admin/onboarding/applications/${applicationId}/approve`, { method: "POST", headers: { cookie: platformCookie, "content-type": "application/json" }, body: JSON.stringify({ mode: "new", propertyId: "bundle_pricing_test" }) });
    assert.equal(result.response.status, 200);
    const setupToken = result.body.data.adminSetupToken;
    const approvedBundle = providers.customerSettings.listBundles("bundle_pricing_test")[0];
    assert.equal(approvedBundle.memberRoomIds.length, 5);
    assert.equal(approvedBundle.capacity, 15);
    assert.equal(approvedBundle.mondayThursdayPrice, 9000);
    assert.equal(approvedBundle.fridayPrice, 10000);
    assert.equal(approvedBundle.saturdayHolidayPrice, 12000);
    assert.equal(approvedBundle.sundayPrice, 9600);

    await request(`${base}/api/admin/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: setupToken, password: "owner-password-123" }) });
    result = await request(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: payload.email, password: "owner-password-123" }) });
    const ownerCookie = result.response.headers.get("set-cookie").split(";")[0];
    result = await request(`${base}/api/bundles/${encodeURIComponent(approvedBundle.id)}`, { method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ customerId: "bundle_pricing_test", name: approvedBundle.name, capacity: 15, memberRoomIds: approvedBundle.memberRoomIds, enabled: true, mondayThursdayPrice: 9100, fridayPrice: 10100, saturdayHolidayPrice: 12100, sundayPrice: 9700 }) });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.bundle.sundayPrice, 9700, "核准後後台可修改包棟四價");

    result = await request(`${base}/assets/onboarding.js`);
    assert.match(result.text, /rooms\.filter\(r=>r\.enabled!==false\)/);
    assert.match(result.text, /mondayThursdayPrice/);
    assert.match(result.text, /function renderPreview/);
    assert.match(result.text, /週六及連續假期/);
    assert.match(result.text, /等待審核/);
    assert.match(result.text, /已儲存/);
    assert.doesNotMatch(result.text, /草稿：\$\{(?:data|x)\.status\}/);
    assert.doesNotMatch(result.text, />301<|>302<|>401<|>402</);

    result = await request(`${base}/assets/admin-onboarding.js`);
    assert.match(result.text, /週六及連續假期/);
    assert.match(result.text, /draft:"草稿"/);
    assert.match(result.text, /submitted:"等待審核"/);
    assert.match(result.text, /changes_requested:"待補件"/);
    assert.match(result.text, /rejected:"未通過"/);
    assert.doesNotMatch(result.text, /undefined 元|null 元/);

    result = await request(`${base}/assets/onboarding.css`);
    assert.match(result.text, /\.topic-title/);
    assert.match(result.text, /\.save-feedback/);
    assert.match(result.text, /input:not\(\[type=checkbox\]\),select,textarea,button\{width:100%;min-width:0\}/);
    assert.match(result.text, /@media\(max-width:390px\)[\s\S]*\.actions\{grid-template-columns:1fr 1fr/);
    result = await request(`${base}/admin`);
    assert.match(result.text, /bundleMondayThursdayPrice/);
    assert.match(result.text, /bundleSaturdayHolidayPrice/);
  } finally {
    await app.stop();
    if (providers.close) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("30/30 PASS");
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
