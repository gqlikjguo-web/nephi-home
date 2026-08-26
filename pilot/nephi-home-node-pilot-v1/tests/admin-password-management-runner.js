"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { hashPassword, verifyPassword, sessionTokenHash, upsertAdminUser } = require("../lib/admin-auth");
const { createApp } = require("../server");

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  const payload = await response.json();
  return { response, body: payload.data || payload };
}

(async () => {
  assert.equal(await verifyPassword("12345678", await hashPassword("12345678")), true, "scrypt accepts an eight-character operator password");
  assert.equal(await verifyPassword("password-longer-than-twelve", await hashPassword("password-longer-than-twelve")), true, "scrypt keeps accepting existing long passwords");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-admin-password-"));
  const connection = { kind: "pglite", dataDir: path.join(root, "database") };
  await migratePostgres(connection);
  let db = await openPostgres(connection);
  try {
    for (const propertyId of ["password_a", "password_b", "other_identity", "setup_8", "setup_12", "setup_7", "setup_13", "setup_mismatch"]) {
      await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,$1)", [propertyId]);
      await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb)", [propertyId]);
    }
  } finally { await db.close(); }
  const owner = await upsertAdminUser(connection, { propertyId: "password_a", username: "owner_a", email: "owner@example.test", password: "existing-password-long" });
  await upsertAdminUser(connection, { propertyId: "password_b", username: "owner_b", email: "owner@example.test", password: "existing-password-long" });
  const other = await upsertAdminUser(connection, { propertyId: "other_identity", username: "other_owner", email: "other@example.test", password: "other-password-long" });
  db = await openPostgres(connection);
  try {
    for (const [token, propertyId] of [["token-8", "setup_8"], ["token-12", "setup_12"], ["token-7", "setup_7"], ["token-13", "setup_13"], ["token-mismatch", "setup_mismatch"]]) {
      await db.query("INSERT INTO property_admin_invitations(token_hash,property_id,username,email,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [sessionTokenHash(token), propertyId, `onboarding_${propertyId}`, `${propertyId}@example.test`]);
    }
  } finally { await db.close(); }

  const providers = createPostgresProviders(connection);
  const app = createApp({ providers, adminAuthRequired: true });
  const running = await app.start(0, "127.0.0.1");
  try {
    const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const login = async (email, password) => request(running.url, "/api/admin/login", json({ email, password }));
    let result = await login("owner@example.test", "existing-password-long");
    assert.equal(result.response.status, 200, "existing password longer than 12 still logs in");
    const cookie = result.response.headers.get("set-cookie").split(";")[0];
    const beforeIdentity = providers.persistence.getAdminIdentityByEmail("owner@example.test");
    const otherIdentity = providers.persistence.getAdminIdentityByEmail("other@example.test");
    const beforeHash = beforeIdentity.passwordHash, otherHash = otherIdentity.passwordHash;
    const memberships = beforeIdentity.properties;
    const change = (body) => request(running.url, "/api/admin/password", { ...json(body), headers: { ...json(body).headers, cookie } });

    for (const [body, code] of [
      [{ currentPassword: "wrong-password", newPassword: "newpass8", confirmPassword: "newpass8" }, "INVALID_CURRENT_PASSWORD"],
      [{ currentPassword: "existing-password-long", newPassword: "newpass8", confirmPassword: "different" }, "PASSWORD_CONFIRMATION_MISMATCH"],
      [{ currentPassword: "existing-password-long", newPassword: "1234567", confirmPassword: "1234567" }, "INVALID_ADMIN_PASSWORD"],
      [{ currentPassword: "existing-password-long", newPassword: "1234567890123", confirmPassword: "1234567890123" }, "INVALID_ADMIN_PASSWORD"]
    ]) {
      result = await change(body);
      assert.equal(result.response.status, 400);
      assert.equal(result.body.error.code, code);
      assert.equal(providers.persistence.getAdminIdentityByEmail("owner@example.test").passwordHash, beforeHash, "rejected change leaves identity hash unchanged");
    }
    result = await change({ currentPassword: "existing-password-long", newPassword: "newpass8", confirmPassword: "newpass8" });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { updated: true });
    assert.equal((await login("owner@example.test", "existing-password-long")).response.status, 401, "old password stops working");
    assert.equal((await login("owner@example.test", "newpass8")).response.status, 200, "new password works");
    assert.deepEqual(providers.persistence.getAdminIdentityByEmail("owner@example.test").properties, memberships, "all memberships remain unchanged");
    assert.equal(providers.persistence.getAdminIdentityByEmail("other@example.test").passwordHash, otherHash, "another identity remains unchanged");
    assert.equal((await login("other@example.test", "other-password-long")).response.status, 200);

    const legacy = await request(running.url, "/api/admin/login", json({ propertyId: "password_a", username: "owner_a", password: "existing-password-long" }));
    assert.equal(legacy.response.status, 200, "legacy username login remains compatible");
    const legacyCookie = legacy.response.headers.get("set-cookie").split(";")[0];
    result = await request(running.url, "/api/admin/password", { ...json({ currentPassword: "existing-password-long", newPassword: "another8", confirmPassword: "another8" }), headers: { "content-type": "application/json", cookie: legacyCookie } });
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error.code, "EMAIL_IDENTITY_REQUIRED");

    for (const [token, password] of [["token-7", "1234567"], ["token-13", "1234567890123"]]) {
      result = await request(running.url, "/api/admin/setup", json({ token, password, confirmPassword: password }));
      assert.equal(result.response.status, 400);
      assert.equal((await request(running.url, `/api/admin/setup-invitation?token=${token}`)).response.status, 200, "invalid setup password does not consume invitation");
    }
    result = await request(running.url, "/api/admin/setup", json({ token: "token-mismatch", password: "12345678", confirmPassword: "87654321" }));
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, "PASSWORD_CONFIRMATION_MISMATCH");
    assert.equal((await request(running.url, "/api/admin/setup-invitation?token=token-mismatch")).response.status, 200);
    for (const [token, email, password] of [["token-8", "setup_8@example.test", "12345678"], ["token-12", "setup_12@example.test", "123456789012"]]) {
      result = await request(running.url, "/api/admin/setup", json({ token, password, confirmPassword: password }));
      assert.equal(result.response.status, 200);
      assert.equal((await login(email, password)).response.status, 200);
    }

    const adminHtml = await (await fetch(`${running.url}/admin`)).text();
    const setupHtml = await (await fetch(`${running.url}/admin/setup`)).text();
    const adminJs = await (await fetch(`${running.url}/assets/admin.js`)).text();
    assert.match(adminHtml, /name="password" type="password" required autocomplete="current-password"/);
    assert.doesNotMatch(adminHtml, /name="password"[^>]*maxlength=/, "login keeps accepting passwords longer than 12");
    for (const id of ["setupPassword", "setupConfirmPassword"]) assert.match(setupHtml, new RegExp(`data-password-toggle="${id}"`));
    assert.match(setupHtml, /name="password"[^>]*minlength="8"[^>]*maxlength="12"[^>]*autocomplete="new-password"/);
    assert.match(setupHtml, /name="confirmPassword"[^>]*minlength="8"[^>]*maxlength="12"[^>]*autocomplete="new-password"/);
    assert.match(adminJs, /function initializePasswordToggles/);
    assert.match(adminJs, /#login input\[type=password\],#workspace input\[type=password\]/, "all current and future operator password inputs receive toggles");
    assert.match(adminJs, /input\.type=input\.type==="password"\?"text":"password"/);
    for (const id of ["passwordChangeForm", "currentPassword", "newPassword", "confirmPassword"]) assert.match(adminJs, new RegExp(id));
    assert.match(adminJs, /新密碼（8–12 字元）/);
  } finally {
    await app.stop();
    if (providers.close) await providers.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("admin password management: PASS");
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
