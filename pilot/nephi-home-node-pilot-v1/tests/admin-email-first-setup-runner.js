"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { sessionTokenHash, upsertAdminUser } = require("../lib/admin-auth");
const { createApp } = require("../server");

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  const payload = await response.json();
  return { response, body: payload.data || payload };
}

function setupTokensFromEmail(message) {
  const matches = [...String(message.html || "").matchAll(/\/admin\/setup\?token=([^"&<]+)/g)];
  return matches.map((match) => decodeURIComponent(match[1]));
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-admin-first-setup-"));
  const connection = { kind: "pglite", dataDir };
  await migratePostgres(connection);
  let db = await openPostgres(connection);
  try {
    for (const [propertyId, displayName] of [["first_setup_b", "首次設定 B"], ["expired_setup", "過期設定"], ["used_setup", "已使用設定"], ["existing_origin", "既有帳號原旅宿"], ["existing_setup", "既有帳號新增旅宿"]]) {
      await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [propertyId, displayName]);
      await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb)", [propertyId]);
    }
    const invitations = [
      ["old-b", "first_setup_b", "onboarding_b", "NEW-OWNER@example.test", "1 day", null],
      ["expired", "expired_setup", "onboarding_expired", "expired@example.test", "-1 day", null],
      ["used", "used_setup", "onboarding_used", "used@example.test", "1 day", new Date().toISOString()],
      ["existing", "existing_setup", "onboarding_existing", "existing@example.test", "1 day", null]
    ];
    for (const [token, propertyId, username, email, interval, usedAt] of invitations) {
      await db.query(`INSERT INTO property_admin_invitations(token_hash,property_id,username,email,expires_at,used_at) VALUES($1,$2,$3,$4,now()+$5::interval,$6)`, [sessionTokenHash(token), propertyId, username, email, interval, usedAt]);
    }
    const room = { key: "room_a", displayName: "首次設定房型", name: "首次設定房型", type: "double", capacity: 2, mondayThursdayPrice: 1000, fridayPrice: 1200, saturdayHolidayPrice: 1500, sundayPrice: 1100, enabled: true };
    const submitted = { propertyName: "首次設定 A", contactName: "新業者", phone: "0900000000", email: "new-owner@example.test", address: "測試地址", checkInTime: "15:00", latestArrivalTime: "", checkOutTime: "11:00", line: { hasOfficialAccount: false, contactLink: "" }, rooms: [room], bundles: [], propertyFacts: [], knowledge: [] };
    await db.query("INSERT INTO onboarding_applications(application_id,draft_token_hash,status,core_data,submitted_snapshot,submitted_at) VALUES('first_setup_application',$1,'submitted',$2::jsonb,$2::jsonb,now())", [sessionTokenHash("draft-first-setup"), JSON.stringify(submitted)]);
  } finally {
    await db.close();
  }
  await upsertAdminUser(connection, { propertyId: "existing_origin", username: "existing_member", email: "existing@example.test", password: "existing-password-123" });

  const deliveries = [];
  const providers = createPostgresProviders(connection);
  providers.onboarding.approveOnboarding("first_setup_application", "first_setup_a", "onboarding_a", sessionTokenHash("old-a"), new Date(Date.now() + 86400000).toISOString(), "platform", "reviewer");
  db = await openPostgres(connection);
  try {
    const invitation = await db.query("SELECT email FROM property_admin_invitations WHERE property_id='first_setup_a'");
    assert.equal(invitation.rows[0].email, "new-owner@example.test", "onboarding approval writes the submitted Email into the formal admin invitation");
  } finally {
    await db.close();
  }
  const app = createApp({
    providers,
    adminAuthRequired: true,
    onboardingEmailEnv: { RESEND_API_KEY: "test-only-key", ONBOARDING_EMAIL_FROM: "test@example.test" },
    onboardingEmailFetch: async (_url, options) => {
      deliveries.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ id: `message-${deliveries.length}` }) };
    }
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    const adminHtml = await (await fetch(`${running.url}/admin`)).text();
    assert.match(adminHtml, /id="firstSetupForm"/);
    assert.match(adminHtml, /第一次登入／設定密碼/);

    const send = (email) => request(running.url, "/api/admin/setup-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    const requested = await send("new-owner@example.test");
    assert.equal(requested.response.status, 200);
    assert.deepEqual(requested.body, { accepted: true });
    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0].to, ["new-owner@example.test"]);
    const setupTokens = setupTokensFromEmail(deliveries[0]);
    assert.equal(setupTokens.length, 2, "one Email receives one property-scoped setup link per pending membership");

    const oldToken = await request(running.url, "/api/admin/setup-invitation?token=old-a");
    assert.equal(oldToken.response.status, 400, "issuing an emailed link invalidates the undisclosed old token");
    const firstInvitation = await request(running.url, `/api/admin/setup-invitation?token=${encodeURIComponent(setupTokens[0])}`);
    const secondInvitation = await request(running.url, `/api/admin/setup-invitation?token=${encodeURIComponent(setupTokens[1])}`);
    assert.deepEqual(new Set([firstInvitation.body.propertyId, secondInvitation.body.propertyId]), new Set(["first_setup_a", "first_setup_b"]));

    let result = await request(running.url, "/api/admin/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: setupTokens[0], password: "new-owner-password-123" }) });
    assert.equal(result.response.status, 200);
    result = await request(running.url, "/api/admin/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: setupTokens[1] }) });
    assert.equal(result.response.status, 200);
    result = await request(running.url, "/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "new-owner@example.test", password: "new-owner-password-123" }) });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.requiresPropertySelection, true);
    assert.deepEqual(new Set(result.body.properties.map((item) => item.propertyId)), new Set(["first_setup_a", "first_setup_b"]));

    const existingDelivery = await send("existing@example.test");
    assert.equal(existingDelivery.response.status, 200);
    assert.equal(deliveries.length, 2);
    const existingSetupTokens = setupTokensFromEmail(deliveries[1]);
    assert.equal(existingSetupTokens.length, 1);
    const existingSetup = await request(running.url, "/api/admin/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: existingSetupTokens[0] }) });
    assert.equal(existingSetup.response.status, 200);
    assert.equal(existingSetup.body.existingIdentity, true);

    const beforeNeutralRequests = deliveries.length;
    for (const email of ["missing@example.test", "expired@example.test", "used@example.test", "not-an-email"]) {
      const neutral = await send(email);
      assert.equal(neutral.response.status, 200);
      assert.deepEqual(neutral.body, { accepted: true });
    }
    assert.equal(deliveries.length, beforeNeutralRequests, "ineligible Email states never receive a setup link");
    const existingLogin = await request(running.url, "/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "existing@example.test", password: "existing-password-123" }) });
    assert.equal(existingLogin.response.status, 200, "existing Email identity login remains unchanged");
    assert.equal(existingLogin.body.requiresPropertySelection, true);
    assert.deepEqual(new Set(existingLogin.body.properties.map((item) => item.propertyId)), new Set(["existing_origin", "existing_setup"]), "existing password retains the original property and adds only the invited property");
  } finally {
    await app.stop();
    if (providers.close) await providers.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log("admin Email first setup: PASS");
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
