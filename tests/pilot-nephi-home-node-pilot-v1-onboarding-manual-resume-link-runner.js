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

const payload = {
  propertyName: "補件連結測試旅宿", contactName: "測試業者", phone: "0911222333",
  email: "owner@example.com", address: "測試地址", checkInTime: "15:00", checkOutTime: "11:00",
  line: { hasOfficialAccount: false, channelId: "", contactLink: "" },
  rooms: [{ key: "room1", name: "雙人房", type: "double", capacity: 2, mondayThursdayPrice: 1800, fridayPrice: 2000, saturdayHolidayPrice: 2400, sundayPrice: 1900, enabled: true }],
  bundles: [], knowledge: []
};

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body, text };
}

async function createSubmitted(base) {
  let result = await request(`${base}/api/public/onboarding/drafts`, { method: "POST" });
  const { applicationId, draftToken } = result.body.data;
  const headers = { "content-type": "application/json", "x-onboarding-draft-token": draftToken };
  await request(`${base}/api/public/onboarding/drafts/${applicationId}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
  await request(`${base}/api/public/onboarding/drafts/${applicationId}/submit`, { method: "POST", headers: { "x-onboarding-draft-token": draftToken } });
  return { applicationId, draftToken };
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-manual-resume-"));
  const connection = { kind: "pglite", dataDir: temp };
  await migratePostgres(connection);
  await seedPostgres(connection);
  await upsertAdminUser(connection, { propertyId: "nephi_home", username: "platform", password: "platform-password-123" });
  let db = await openPostgres(connection);
  await db.query("INSERT INTO platform_admin_grants(property_id,username) VALUES($1,$2)", ["nephi_home", "platform"]);
  await db.close();
  const providers = createPostgresProviders(connection);
  const app = createApp({ providers, structuredClassifier: null, adminAuthRequired: true, onboardingEmailEnv: { PUBLIC_BASE_URL: "https://app.junzanai.com" } });
  const running = await app.start(0, "127.0.0.1");
  const base = running.url;
  try {
    const first = await createSubmitted(base);
    const second = await createSubmitted(base);
    let result = await request(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "nephi_home", username: "platform", password: "platform-password-123" }) });
    const cookie = result.response.headers.get("set-cookie").split(";")[0];
    result = await request(`${base}/api/admin/onboarding/applications/${first.applicationId}/request-changes`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "請補充入住說明" }) });
    assert.equal(result.response.status, 200);

    result = await request(`${base}/api/admin/onboarding/applications/${first.applicationId}/resume-link`, { method: "POST" });
    assert.equal(result.response.status, 401, "未登入不可取得補件連結");

    result = await request(`${base}/api/admin/onboarding/applications/${second.applicationId}/resume-link`, { method: "POST", headers: { cookie } });
    assert.equal(result.response.status, 409, "非待補件案件不可取得補件連結");

    result = await request(`${base}/api/admin/onboarding/applications/${first.applicationId}/resume-link`, { method: "POST", headers: { cookie } });
    assert.equal(result.response.status, 200);
    const firstUrl = result.body.data.resumeUrl;
    assert.match(firstUrl, /^https:\/\/app\.junzanai\.com\/onboarding\?resume=[A-Za-z0-9_-]+$/);
    assert.doesNotMatch(result.text, new RegExp(first.applicationId));
    assert.doesNotMatch(result.text, /tokenHash|token_hash|password|secret/i);

    const firstToken = new URL(firstUrl).searchParams.get("resume");
    result = await request(`${base}/api/public/onboarding/resume`);
    assert.equal(result.response.status, 400, "缺少 token 不可讀取案件");
    result = await request(`${base}/api/public/onboarding/resume?token=wrong-token`);
    assert.equal(result.response.status, 400, "錯誤 token 不可讀取案件");
    result = await request(`${base}/api/public/onboarding/resume?token=${encodeURIComponent(firstToken)}`);
    assert.equal(result.body.data.applicationId, first.applicationId, "連結只解析至正確案件");
    result = await request(`${base}/api/public/onboarding/drafts/${second.applicationId}`, { headers: { "x-onboarding-draft-token": firstToken } });
    assert.equal(result.response.status, 401, "補件 token 不可跨案件使用");

    result = await request(`${base}/api/admin/onboarding/applications/${first.applicationId}/resume-link`, { method: "POST", headers: { cookie } });
    const rotatedUrl = result.body.data.resumeUrl;
    const rotatedToken = new URL(rotatedUrl).searchParams.get("resume");
    assert.notEqual(rotatedToken, firstToken, "每次產生皆輪替不可猜測 token");
    result = await request(`${base}/api/public/onboarding/resume?token=${encodeURIComponent(firstToken)}`);
    assert.equal(result.response.status, 400, "輪替後舊連結失效");

    result = await request(`${base}/api/public/onboarding/resume?token=${encodeURIComponent(rotatedToken)}`);
    assert.equal(result.body.data.applicationId, first.applicationId);
    result = await request(`${base}/api/public/onboarding/drafts/${first.applicationId}`, { headers: { "x-onboarding-draft-token": rotatedToken } });
    assert.equal(result.body.data.status, "changes_requested");
    assert.equal(result.body.data.latestChangeRequest.reason, "請補充入住說明");
    result = await request(`${base}/api/public/onboarding/drafts/${first.applicationId}`, { method: "PATCH", headers: { "content-type": "application/json", "x-onboarding-draft-token": rotatedToken }, body: JSON.stringify({ ...payload, address: "補件後地址" }) });
    assert.equal(result.response.status, 200);
    result = await request(`${base}/api/public/onboarding/drafts/${first.applicationId}/submit`, { method: "POST", headers: { "x-onboarding-draft-token": rotatedToken } });
    assert.equal(result.body.data.status, "resubmitted", "補件後可重新送審");

    db = await openPostgres(connection);
    const rows = await db.query("SELECT token_hash FROM onboarding_resume_tokens WHERE application_id=$1", [first.applicationId]);
    await db.close();
    assert.equal(rows.rows.length, 1);
    assert.notEqual(rows.rows[0].token_hash, rotatedToken, "資料庫不保存明文 token");

    result = await request(`${base}/assets/admin-onboarding.js`);
    assert.match(result.text, /複製補件連結/);
    assert.match(result.text, /補件連結已複製/);
    assert.match(result.text, /navigator\.clipboard/);
    assert.doesNotMatch(result.text, /token_hash|password_hash/);
  } finally {
    await app.stop();
    if (providers.close) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("16/16 PASS");
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
