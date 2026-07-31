"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { migratePostgres } = require(path.join(root, "lib/providers/postgres-migrate"));
const { seedNephiPostgres } = require(path.join(root, "tests/helpers/nephi-postgres-seed"));
const { openPostgres } = require(path.join(root, "lib/providers/postgres-client"));
const { createPostgresProviders } = require(path.join(root, "lib/providers/postgres-providers"));
const { upsertAdminUser, sessionTokenHash } = require(path.join(root, "lib/admin-auth"));
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

async function createSubmitted(base, providers) {
  const applicationId = crypto.randomUUID();
  const draftToken = crypto.randomBytes(32).toString("base64url");
  providers.onboarding.createOnboardingInvitation(
    applicationId,
    sessionTokenHash(draftToken),
    new Date(Date.now() + 86400000).toISOString(),
    "nephi_home",
    "platform"
  );
  const headers = { "content-type": "application/json", "x-onboarding-draft-token": draftToken };
  await request(`${base}/api/public/onboarding/drafts/${applicationId}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
  await request(`${base}/api/public/onboarding/drafts/${applicationId}/submit`, { method: "POST", headers: { "x-onboarding-draft-token": draftToken } });
  return { applicationId, draftToken };
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-manual-resume-"));
  const connection = { kind: "pglite", dataDir: temp };
  await migratePostgres(connection);
  await seedNephiPostgres(connection);
  await upsertAdminUser(connection, { propertyId: "nephi_home", username: "platform", password: "platform-password-123" });
  let db = await openPostgres(connection);
  await db.query("INSERT INTO platform_admin_grants(property_id,username) VALUES($1,$2)", ["nephi_home", "platform"]);
  await db.close();
  let providers, app, base;
  async function startRuntime() {
    providers = createPostgresProviders(connection);
    app = createApp({ providers, structuredClassifier: null, adminAuthRequired: true, onboardingEmailEnv: { PUBLIC_BASE_URL: "https://app.junzanai.com", RESEND_API_KEY: "test-only-key", ONBOARDING_FROM_EMAIL: "test@example.test" }, onboardingEmailFetch: async () => ({ ok: false, status: 503, text: async () => "provider unavailable" }) });
    const running = await app.start(0, "127.0.0.1");
    base = running.url;
  }
  async function stopRuntime() {
    if (app) { await app.stop(); app = null; }
    if (providers) { await providers.close(); providers = null; }
  }
  await startRuntime();
  try {
    const first = await createSubmitted(base, providers);
    const second = await createSubmitted(base, providers);
    const rejected = await createSubmitted(base, providers);
    const rollbackRejected = await createSubmitted(base, providers);
    let result = await request(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "nephi_home", username: "platform", password: "platform-password-123" }) });
    const cookie = result.response.headers.get("set-cookie").split(";")[0];

    result = await request(`${base}/api/admin/onboarding/applications/${rejected.applicationId}/reject`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "先前誤判為不通過" }) });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.status, "rejected", "案件先進入 rejected");
    result = await request(`${base}/api/admin/onboarding/applications/${rollbackRejected.applicationId}/reject`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "建立交易回滾測試案件" }) });
    assert.equal(result.response.status, 200);
    await stopRuntime();
    db = await openPostgres(connection);
    const rejectedNote = await db.query("SELECT note_id FROM onboarding_review_notes WHERE application_id=$1 AND action='rejected'", [rejected.applicationId]);
    await db.query("INSERT INTO onboarding_resume_tokens(token_hash,application_id,review_note_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [sessionTokenHash("obsolete-rejected-token"), rejected.applicationId, rejectedNote.rows[0].note_id]);
    const rollbackNote = await db.query("SELECT note_id FROM onboarding_review_notes WHERE application_id=$1 AND action='rejected'", [rollbackRejected.applicationId]);
    await db.query("INSERT INTO onboarding_resume_tokens(token_hash,application_id,review_note_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [sessionTokenHash("rollback-sentinel-token"), rollbackRejected.applicationId, rollbackNote.rows[0].note_id]);
    assert.match(rollbackRejected.applicationId, /^[0-9a-f-]+$/i);
    await db.query(`ALTER TABLE onboarding_review_notes ADD CONSTRAINT onboarding_reopen_rollback_test CHECK (application_id <> '${rollbackRejected.applicationId}' OR action <> 'reopened_changes_requested')`);
    await db.close();
    await startRuntime();

    result = await request(`${base}/api/admin/onboarding/applications/${rejected.applicationId}/reopen-for-changes`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "   " }) });
    assert.equal(result.response.status, 400, "重新開放補件必須填寫原因");
    assert.equal(result.body.error.code, "MISSING_REOPEN_REASON");
    result = await request(`${base}/api/public/onboarding/drafts/${rejected.applicationId}/submit`, { method: "POST", headers: { "x-onboarding-draft-token": rejected.draftToken } });
    assert.equal(result.response.status, 409, "rejected 不得由業者直接重新送審");
    result = await request(`${base}/api/admin/onboarding/applications/${rejected.applicationId}/approve`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ mode: "existing", propertyId: "nephi_home" }) });
    assert.equal(result.response.status, 409, "rejected 不得直接核准舊快照");
    result = await request(`${base}/api/admin/onboarding/applications/${rejected.applicationId}/reopen-for-changes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "請重新確認後送審" }) });
    assert.equal(result.response.status, 401, "未登入不可重新開放補件");

    result = await request(`${base}/api/admin/onboarding/applications/${rollbackRejected.applicationId}/reopen-for-changes`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "此操作必須完整回滾" }) });
    assert.equal(result.response.status, 500, "交易中途失敗回 500");
    await stopRuntime();
    db = await openPostgres(connection);
    const rollbackApplication = (await db.query("SELECT status FROM onboarding_applications WHERE application_id=$1", [rollbackRejected.applicationId])).rows[0];
    const rollbackTokens = await db.query("SELECT token_hash FROM onboarding_resume_tokens WHERE application_id=$1", [rollbackRejected.applicationId]);
    const rollbackAudits = await db.query("SELECT action FROM onboarding_review_notes WHERE application_id=$1 AND action='reopened_changes_requested'", [rollbackRejected.applicationId]);
    await db.query("ALTER TABLE onboarding_review_notes DROP CONSTRAINT onboarding_reopen_rollback_test");
    await db.close();
    assert.equal(rollbackApplication.status, "rejected", "交易失敗保留 rejected 狀態");
    assert.equal(rollbackTokens.rows.length, 1, "交易失敗還原既有 token");
    assert.equal(rollbackAudits.rows.length, 0, "交易失敗不留下重新開放稽核紀錄");
    await startRuntime();

    result = await request(`${base}/api/admin/onboarding/applications/${rejected.applicationId}/reopen-for-changes`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "請重新確認資料後送審" }) });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.application.status, "changes_requested", "rejected 只能先轉為 changes_requested");
    assert.equal(result.body.data.application.latestChangeRequest.reason, "請重新確認資料後送審");
    assert.equal(result.body.data.emailStatus, "failed", "Email 失敗不推翻重新開放補件");
    const reopenedUrl = result.body.data.resumeUrl;
    const reopenedToken = new URL(reopenedUrl).searchParams.get("resume");
    assert.ok(reopenedToken);
    assert.doesNotMatch(result.text, /tokenHash|token_hash|password|secret/i);
    result = await request(`${base}/api/public/onboarding/resume?token=obsolete-rejected-token`);
    assert.equal(result.response.status, 400, "重新開放後所有舊補件 token 失效");

    await stopRuntime();
    db = await openPostgres(connection);
    const reopenedTokens = await db.query("SELECT token_hash FROM onboarding_resume_tokens WHERE application_id=$1", [rejected.applicationId]);
    const reopenAudit = await db.query("SELECT action,note,reviewer_property_id,reviewer_username FROM onboarding_review_notes WHERE application_id=$1", [rejected.applicationId]);
    await db.close();
    assert.equal(reopenedTokens.rows.length, 1, "只保留一個最新補件 token");
    assert.notEqual(reopenedTokens.rows[0].token_hash, reopenedToken, "資料庫只保存 token hash");
    const reopenedAuditRow = reopenAudit.rows.find((row) => row.action === "reopened_changes_requested");
    assert.deepEqual(reopenedAuditRow, { action: "reopened_changes_requested", note: "請重新確認資料後送審", reviewer_property_id: "nephi_home", reviewer_username: "platform" }, JSON.stringify(reopenAudit.rows));
    await startRuntime();
    result = await request(`${base}/api/admin/onboarding/applications/${rejected.applicationId}/reopen-for-changes`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "不得重複重新開放" }) });
    assert.equal(result.response.status, 409, "只有 rejected 可以重新開放補件");
    result = await request(`${base}/api/public/onboarding/resume?token=${encodeURIComponent(reopenedToken)}`);
    assert.equal(result.body.data.applicationId, rejected.applicationId);
    result = await request(`${base}/api/public/onboarding/drafts/${rejected.applicationId}/submit`, { method: "POST", headers: { "x-onboarding-draft-token": reopenedToken } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.status, "resubmitted", "業者重新送審後才成為 resubmitted");

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

    await stopRuntime();
    db = await openPostgres(connection);
    const rows = await db.query("SELECT token_hash FROM onboarding_resume_tokens WHERE application_id=$1", [first.applicationId]);
    await db.close();
    assert.equal(rows.rows.length, 0, "重新送審後補件 token 立即失效");
    await startRuntime();

    result = await request(`${base}/assets/admin-onboarding.js`);
    assert.match(result.text, /複製補件連結/);
    assert.match(result.text, /重新開放補件/);
    assert.match(result.text, /reopen-for-changes/);
    assert.match(result.text, /showReopenCompletion/);
    assert.match(result.text, /reopen\.disabled=false;reason\.focus\(\)/);
    assert.match(result.text, /業者重新送審後才能核准/);
    assert.match(result.text, /補件連結已複製/);
    assert.match(result.text, /navigator\.clipboard/);
    assert.doesNotMatch(result.text, /token_hash|password_hash/);
    result = await request(`${base}/assets/admin-onboarding.css`);
    assert.match(result.text, /\.reopen-panel/);
    assert.match(result.text, /@media\(max-width:390px\)/);
    assert.match(result.text, /input,.admin-review select,.admin-review textarea,.admin-review button\{min-height:48px\}/);
    assert.match(result.text, /\.admin-review main\{width:100%;padding:10px\}/);
    result = await request(`${base}/assets/onboarding.css`);
    assert.match(result.text, /\*\{box-sizing:border-box\}/);
    assert.match(result.text, /input:not\(\[type=checkbox\]\),select,textarea,button\{width:100%;min-width:0\}/);
    result = await request(`${base}/admin/onboarding`, { headers: { cookie } });
    assert.match(result.text, /name="viewport" content="width=device-width,initial-scale=1"/);
  } finally {
    await stopRuntime();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("rejected reopen + manual resume PASS");
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
