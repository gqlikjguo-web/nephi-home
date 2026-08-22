"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { seedDemoPostgres } = require("./helpers/demo-postgres-seed");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { upsertAdminUser, sessionTokenHash } = require("../lib/admin-auth");
const { createApp } = require("../server");

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body };
}

function intakePayload(name, suffix) {
  return {
    propertyName: name,
    contactName: `測試聯絡人 ${suffix}`,
    phone: `09000000${suffix === "Alpha" ? "01" : "02"}`,
    email: `${suffix.toLowerCase()}@example.test`,
    address: `測試地址 ${suffix}`,
    googleMapsUrl: "",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    line: { hasOfficialAccount: false, contactLink: "" },
    rooms: [{
      key: `${suffix.toLowerCase()}_room`,
      displayName: `${suffix} 雙人房`,
      type: "雙人房",
      capacity: 2,
      highlights: ["安靜"],
      mondayThursdayPrice: 1000,
      fridayPrice: 1200,
      saturdayHolidayPrice: 1500,
      sundayPrice: 1100,
      enabled: true
    }],
    bundles: [],
    knowledge: [
      { key: "parking", label: "停車方式", status: "fixed", answer: `${suffix} 專用測試停車說明` },
      { key: "bbq", label: "烤肉規則", status: "unavailable", answer: "" }
    ]
  };
}

(async () => {
  const checks = [];
  const check = (name, condition) => {
    assert.ok(condition, name);
    checks.push(name);
  };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "onboarding-intake-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  await migratePostgres(connection);
  await seedDemoPostgres(connection);
  await upsertAdminUser(connection, {
    propertyId: "demo_fixture_property",
    username: "platform",
    password: "platform-password-123"
  });
  let db = await openPostgres(connection);
  await db.query(
    "INSERT INTO platform_admin_grants(property_id,username) VALUES($1,$2)",
    ["demo_fixture_property", "platform"]
  );
  await db.query(
    "ALTER TABLE onboarding_room_types ADD CONSTRAINT onboarding_intake_rollback_test CHECK (room_key <> 'rollback_room')"
  );
  await db.close();

  const providers = createPostgresProviders(connection);
  const demoBefore = JSON.stringify(providers.customerSettings.getProperty("demo_fixture_property"));
  const app = createApp({
    providers,
    structuredClassifier: null,
    adminAuthRequired: true
  });
  const running = await app.start(0, "127.0.0.1");
  const jsonHeaders = { "content-type": "application/json" };

  async function createInvite(cookie, expiresInDays = 7) {
    const result = await request(`${running.url}/api/admin/onboarding/invitations`, {
      method: "POST",
      headers: { cookie, ...jsonHeaders },
      body: JSON.stringify({ expiresInDays })
    });
    assert.equal(result.response.status, 201);
    const invite = new URL(result.body.data.inviteUrl).searchParams.get("invite");
    assert.ok(invite);
    return { ...result.body.data, invite };
  }

  async function resolveInvite(invite) {
    return request(`${running.url}/api/public/onboarding/invite?token=${encodeURIComponent(invite)}`);
  }

  async function saveDraft(entry, payload) {
    return request(`${running.url}/api/public/onboarding/drafts/${entry.applicationId}`, {
      method: "PATCH",
      headers: { ...jsonHeaders, "x-onboarding-draft-token": entry.draftToken },
      body: JSON.stringify(payload)
    });
  }

  try {
    let result = await request(`${running.url}/api/public/onboarding/drafts`, { method: "POST" });
    check("沒有邀請不得建立草稿", result.response.status === 401 && result.body.error.code === "ONBOARDING_INVITE_REQUIRED");

    result = await request(`${running.url}/api/admin/onboarding/invitations`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ expiresInDays: 7 })
    });
    check("非管理端不得建立邀請", result.response.status === 401);

    result = await request(`${running.url}/api/admin/login`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        propertyId: "demo_fixture_property",
        username: "platform",
        password: "platform-password-123"
      })
    });
    const cookie = result.response.headers.get("set-cookie").split(";")[0];

    const alphaInvite = await createInvite(cookie);
    result = await resolveInvite(alphaInvite.invite);
    check("有效邀請可開啟表單", result.response.status === 200 && result.body.data.applicationId === alphaInvite.applicationId);
    const alpha = result.body.data;

    result = await saveDraft(alpha, {
      propertyName: "friendly_property_alpha",
      contactName: "",
      phone: "",
      email: "",
      address: "",
      googleMapsUrl: "",
      checkInTime: "",
      checkOutTime: "",
      line: { hasOfficialAccount: false, contactLink: "" },
      rooms: [],
      bundles: [],
      knowledge: []
    });
    check("不完整內容可先存草稿", result.response.status === 200 && result.body.data.status === "draft");

    const alphaPayload = intakePayload("friendly_property_alpha", "Alpha");
    result = await saveDraft(alpha, alphaPayload);
    check("Alpha 草稿保存成功", result.response.status === 200 && result.body.data.propertyName === "friendly_property_alpha");
    result = await request(`${running.url}/api/public/onboarding/drafts/${alpha.applicationId}`, {
      headers: { "x-onboarding-draft-token": alpha.draftToken }
    });
    check("重新開啟可 read-back", result.response.status === 200 && result.body.data.rooms[0].displayName === "Alpha 雙人房");

    const betaInvite = await createInvite(cookie);
    result = await resolveInvite(betaInvite.invite);
    const beta = result.body.data;
    const betaPayload = intakePayload("friendly_property_beta", "Beta");
    result = await saveDraft(beta, betaPayload);
    check("Beta 草稿保存成功", result.response.status === 200 && result.body.data.propertyName === "friendly_property_beta");

    result = await request(`${running.url}/api/public/onboarding/drafts/${alpha.applicationId}`, {
      headers: { "x-onboarding-draft-token": beta.draftToken }
    });
    check("業者 B 不能讀取業者 A", result.response.status === 401 && result.body.error.code === "INVALID_DRAFT_TOKEN");
    result = await saveDraft({ ...alpha, draftToken: beta.draftToken }, betaPayload);
    check("業者 B 不能修改業者 A", result.response.status === 401 && result.body.error.code === "INVALID_DRAFT_TOKEN");

    result = await saveDraft(alpha, { ...alphaPayload, email: "not-an-email" });
    check("非法欄位回 400", result.response.status === 400 && result.body.error.code === "INVALID_EMAIL");
    result = await request(`${running.url}/api/public/onboarding/drafts/${alpha.applicationId}`, {
      headers: { "x-onboarding-draft-token": alpha.draftToken }
    });
    check("欄位錯誤不會清掉既有草稿", result.body.data.email === "alpha@example.test");

    const expiredToken = "expired-onboarding-intake-token";
    providers.onboarding.createOnboardingInvitation(
      "expired-onboarding-intake",
      sessionTokenHash(expiredToken),
      new Date(Date.now() - 60000).toISOString(),
      "demo_fixture_property",
      "platform"
    );
    result = await resolveInvite(expiredToken);
    check("過期邀請被拒絕", result.response.status === 401 && result.body.error.code === "INVALID_ONBOARDING_INVITE");

    const revokedInvite = await createInvite(cookie);
    result = await request(`${running.url}/api/admin/onboarding/applications/${revokedInvite.applicationId}/revoke-invite`, {
      method: "POST",
      headers: { cookie }
    });
    assert.equal(result.response.status, 200);
    result = await resolveInvite(revokedInvite.invite);
    check("已撤銷邀請被拒絕", result.response.status === 401 && result.body.error.code === "INVALID_ONBOARDING_INVITE");

    const rollbackPayload = {
      ...betaPayload,
      propertyName: "不應保存的名稱",
      rooms: [...betaPayload.rooms, {
        ...betaPayload.rooms[0],
        key: "rollback_room",
        displayName: "觸發回滾"
      }]
    };
    result = await saveDraft(beta, rollbackPayload);
    check("PostgreSQL transaction 錯誤回安全 500", result.response.status === 500 && result.body.error.code === "INTERNAL_ERROR");
    result = await request(`${running.url}/api/public/onboarding/drafts/${beta.applicationId}`, {
      headers: { "x-onboarding-draft-token": beta.draftToken }
    });
    check("transaction 不留下半套資料", result.body.data.propertyName === "friendly_property_beta" && result.body.data.rooms.length === 1);
    result = await request(`${running.url}/api/public/onboarding/drafts/${alpha.applicationId}/submit`, {
      method: "POST",
      headers: { "x-onboarding-draft-token": alpha.draftToken }
    });
    check("正式送出成功", result.response.status === 200 && result.body.data.status === "submitted");
    result = await request(`${running.url}/api/public/onboarding/drafts/${alpha.applicationId}/submit`, {
      method: "POST",
      headers: { "x-onboarding-draft-token": alpha.draftToken }
    });
    check("重複送出具 idempotency", result.response.status === 200 && result.body.data.status === "submitted");

    result = await request(`${running.url}/api/admin/onboarding/applications`, { headers: { cookie } });
    const reviewedAlpha = result.body.data.items.find((item) => item.applicationId === alpha.applicationId);
    const reviewedBeta = result.body.data.items.find((item) => item.applicationId === beta.applicationId);
    check("管理端可看到新 submission 及狀態", reviewedAlpha.status === "submitted" && reviewedBeta.status === "draft");
    check("Alpha／Beta submission 完全隔離", reviewedAlpha.propertyName === "friendly_property_alpha" && reviewedBeta.propertyName === "friendly_property_beta");

    const formalProperties = providers.customerSettings.listProperties().map((property) => property.propertyId);
    check("未核准 submission 不進正式 property facts", !formalProperties.includes("friendly_property_alpha") && !formalProperties.includes("friendly_property_beta"));
    check("示範既有資料完全未改變", JSON.stringify(providers.customerSettings.getProperty("demo_fixture_property")) === demoBefore);

    result = await request(`${running.url}/api/public/onboarding/invite?token=invalid-test-token`);
    check("無效 token 被拒絕", result.response.status === 401 && result.body.error.code === "INVALID_ONBOARDING_INVITE");

    const onboardingSource = fs.readFileSync(path.join(__dirname, "../public/assets/onboarding.js"), "utf8");
    check("前端網路或伺服器錯誤保留內容", onboardingSource.includes("已保留目前填寫內容") && !onboardingSource.includes("form.reset("));
    check("前端顯示草稿已儲存", onboardingSource.includes("草稿已儲存"));
  } finally {
    await app.stop();
    if (providers.close) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log(`onboarding intake submission: PASS (${checks.length} checks)`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
