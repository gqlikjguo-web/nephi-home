"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createApp } = require("../server");
const { upsertAdminUser } = require("../lib/admin-auth");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");

function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function tokenFromSetupUrl(setupUrl) {
  const parsed = new URL(setupUrl);
  return new URLSearchParams(parsed.hash.slice(1)).get("token");
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

async function resolveSetup(baseUrl, token) {
  return request(`${baseUrl}/api/public/line-setup/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token })
  });
}

(async () => {
  const runtime = "C:\\tmp";
  const temp = fs.mkdtempSync(path.join(runtime, "line-setup-red-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "db") };
  const lineBindingEnv = {
    JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64")
  };
  let currentNow = new Date("2026-07-29T02:00:00.000Z");
  const observedLogs = [];
  const observedErrors = [];
  const originalLog = console.log;
  const originalError = console.error;
  let app;
  try {
    const workerSource = fs.readFileSync(path.join(__dirname, "..", "lib", "providers", "postgres-worker.js"), "utf8");
    const redemptionTransaction = workerSource.slice(workerSource.indexOf('if(name==="redeemLineSetupToken")'));
    assert.ok(
      redemptionTransaction.indexOf('client.query("BEGIN")') <
      redemptionTransaction.indexOf("FOR UPDATE") &&
      redemptionTransaction.indexOf("FOR UPDATE") <
      redemptionTransaction.indexOf("INSERT INTO property_line_bindings") &&
      redemptionTransaction.indexOf("INSERT INTO property_line_bindings") <
      redemptionTransaction.indexOf("UPDATE property_line_setup_tokens SET used_at") &&
      redemptionTransaction.indexOf("UPDATE property_line_setup_tokens SET used_at") <
      redemptionTransaction.indexOf('client.query("COMMIT")'),
      "redemption transaction locks the token before binding upsert and commits only after used_at"
    );
    await migratePostgres(connection);
    let db = await openPostgres(connection);
    await db.query(
      "INSERT INTO properties(property_id,display_name) VALUES($1,$2),($3,$4),($5,$6)",
      ["line_setup_platform", "LINE Setup Platform", "line_setup_alpha", "Alpha 測試旅宿", "line_setup_beta", "Beta 測試旅宿"]
    );
    await db.query(
      "INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb),($2,'{}'::jsonb),($3,'{}'::jsonb)",
      ["line_setup_platform", "line_setup_alpha", "line_setup_beta"]
    );
    await db.query(
      "ALTER TABLE property_line_setup_tokens ADD CONSTRAINT property_line_setup_tokens_test_rollback CHECK (created_by_username <> 'rollback-after-upsert' OR used_at IS NULL)"
    );
    await db.close();
    await upsertAdminUser(connection, {
      propertyId: "line_setup_platform",
      username: "platform",
      password: "platform-password-123"
    });
    await upsertAdminUser(connection, {
      propertyId: "line_setup_alpha",
      username: "alpha-owner",
      password: "alpha-owner-password-123"
    });
    db = await openPostgres(connection);
    await db.query(
      "INSERT INTO platform_admin_grants(property_id,username) VALUES($1,$2)",
      ["line_setup_platform", "platform"]
    );
    await db.close();

    const providers = createPostgresProviders(connection);
    app = createApp({
      providers,
      adminAuthRequired: true,
      lineBindingEnv,
      now: () => new Date(currentNow),
      publicBrand: {
        name: "JunZan AI",
        publicBaseUrl: "https://test-only.example.test"
      }
    });
    const running = await app.start(0, "127.0.0.1");
    console.log = (...args) => observedLogs.push(args.map(String).join(" "));
    console.error = (...args) => observedErrors.push(args.map(String).join(" "));
    const unauthenticated = await request(`${running.url}/api/admin/line-setup-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyId: "line_setup_alpha" })
    });
    assert.equal(unauthenticated.response.status, 401, "unauthenticated users cannot create setup links");

    const ordinaryLogin = await request(`${running.url}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyId: "line_setup_alpha",
        username: "alpha-owner",
        password: "alpha-owner-password-123"
      })
    });
    const ordinaryCookie = ordinaryLogin.response.headers.get("set-cookie").split(";")[0];
    const ordinaryCreate = await request(`${running.url}/api/admin/line-setup-links`, {
      method: "POST",
      headers: { cookie: ordinaryCookie, "content-type": "application/json" },
      body: JSON.stringify({ propertyId: "line_setup_alpha" })
    });
    assert.equal(ordinaryCreate.response.status, 401, "property administrators cannot create setup links");

    const login = await request(`${running.url}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyId: "line_setup_platform",
        username: "platform",
        password: "platform-password-123"
      })
    });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    const created = await request(`${running.url}/api/admin/line-setup-links`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ propertyId: "line_setup_alpha", expiresInMinutes: 30 })
    });
    assert.equal(created.response.status, 201, "platform admin creates a property-scoped LINE setup link");
    assert.equal(created.body.data.propertyId, "line_setup_alpha");
    assert.match(created.body.data.setupUrl, /^https:\/\/test-only\.example\.test\/line\/setup#token=/);
    assert.equal(Object.hasOwn(created.body.data, "tokenHash"), false);
    const setupUrl = new URL(created.body.data.setupUrl);
    assert.equal(setupUrl.search, "", "setup bearer token never enters a request query string");
    const setupToken = tokenFromSetupUrl(created.body.data.setupUrl);
    assert.ok(setupToken);

    let rawToken = providers.lineBindings.getLineSetupTokenByHash(tokenHash(setupToken));
    assert.equal(rawToken.tokenHash, tokenHash(setupToken), "database stores only the token hash");
    assert.equal(rawToken.propertyId, "line_setup_alpha", "token is bound to one property");
    assert.notEqual(rawToken.tokenHash, setupToken);
    assert.ok(new Date(rawToken.expiresAt).getTime() > currentNow.getTime(), "token has a future expiry");

    const listed = await request(`${running.url}/api/admin/line-setup-links?propertyId=line_setup_alpha`, {
      headers: { cookie }
    });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.data.items[0].propertyId, "line_setup_alpha");
    assert.doesNotMatch(JSON.stringify(listed.body), new RegExp(setupToken));
    assert.equal(Object.hasOwn(listed.body.data.items[0], "tokenHash"), false);

    const resolved = await resolveSetup(running.url, setupToken);
    assert.equal(resolved.response.status, 200, "valid token resolves");
    assert.equal(resolved.body.data.propertyId, undefined, "public setup data does not expose propertyId");
    assert.equal(resolved.body.data.propertyName, "Alpha 測試旅宿");
    assert.doesNotMatch(JSON.stringify(resolved.body), new RegExp(setupToken));
    const legacyQueryResolve = await request(`${running.url}/api/public/line-setup?token=${encodeURIComponent(setupToken)}`);
    assert.equal(legacyQueryResolve.response.status, 404, "query-string token transport is not accepted");

    const invalid = await resolveSetup(running.url, "invalid-token");
    assert.equal(invalid.response.status, 404, "invalid token is rejected");
    assert.equal(invalid.body.error.code, "LINE_SETUP_LINK_INVALID");

    async function createLink(propertyId = "line_setup_alpha") {
      const result = await request(`${running.url}/api/admin/line-setup-links`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ propertyId, expiresInMinutes: 30 })
      });
      assert.equal(result.response.status, 201);
      return {
        ...result.body.data,
        token: tokenFromSetupUrl(result.body.data.setupUrl)
      };
    }

    const expired = await createLink();
    currentNow = new Date(currentNow.getTime() + 31 * 60000);
    const expiredResult = await resolveSetup(running.url, expired.token);
    assert.equal(expiredResult.response.status, 410, "expired token is rejected");
    assert.equal(expiredResult.body.error.code, "LINE_SETUP_LINK_EXPIRED");
    currentNow = new Date("2026-07-29T02:00:00.000Z");

    const revoked = await createLink();
    const revokedByAdmin = await request(`${running.url}/api/admin/line-setup-links/${encodeURIComponent(revoked.setupId)}/revoke`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(revokedByAdmin.response.status, 200, "platform admin revokes an unused setup link");
    const revokedResult = await resolveSetup(running.url, revoked.token);
    assert.equal(revokedResult.response.status, 410, "revoked token is rejected");
    assert.equal(revokedResult.body.error.code, "LINE_SETUP_LINK_REVOKED");

    const invalidCredentials = await createLink();
    const invalidCredentialsResult = await request(`${running.url}/api/public/line-setup/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: invalidCredentials.token,
        channelSecret: "x",
        channelAccessToken: "y"
      })
    });
    assert.equal(invalidCredentialsResult.response.status, 400, "invalid credential formats are rejected");
    assert.equal(invalidCredentialsResult.body.error.code, "LINE_CHANNEL_SECRET_INVALID");
    assert.equal(providers.lineBindings.getLineSetupTokenByHash(tokenHash(invalidCredentials.token)).usedAt, null);

    const noKey = await createLink();
    delete lineBindingEnv.JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY;
    const noKeyResult = await request(`${running.url}/api/public/line-setup/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: noKey.token,
        channelSecret: crypto.randomBytes(24).toString("base64url"),
        channelAccessToken: crypto.randomBytes(48).toString("base64url")
      })
    });
    assert.equal(noKeyResult.response.status, 503, "missing encryption key rejects credential storage");
    assert.equal(noKeyResult.body.error.code, "LINE_BINDING_ENCRYPTION_KEY_MISSING");
    lineBindingEnv.JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    rawToken = providers.lineBindings.getLineSetupTokenByHash(tokenHash(noKey.token));
    assert.equal(rawToken.usedAt, null, "missing encryption key does not consume the token");

    const rollbackToken = crypto.randomBytes(32).toString("base64url");
    const inertEnvelope = { version: 1, algorithm: "aes-256-gcm", iv: "test", tag: "test", ciphertext: "test" };
    providers.lineBindings.createLineSetupToken({
      setupId: crypto.randomUUID(),
      tokenHash: tokenHash(rollbackToken),
      propertyId: "line_setup_alpha",
      expiresAt: new Date(currentNow.getTime() + 30 * 60000).toISOString(),
      createdByPropertyId: "line_setup_platform",
      createdByUsername: "rollback-after-upsert"
    });
    providers.lineBindings.upsertLineBinding({
      propertyId: "line_setup_beta",
      webhookKey: crypto.randomBytes(32).toString("base64url"),
      channelSecretEncrypted: inertEnvelope,
      channelAccessTokenEncrypted: inertEnvelope,
      enabled: false
    });
    assert.throws(() => providers.lineBindings.redeemLineSetupToken(
      tokenHash(rollbackToken),
      {
        propertyId: "line_setup_alpha",
        webhookKey: crypto.randomBytes(32).toString("base64url"),
        channelSecretEncrypted: inertEnvelope,
        channelAccessTokenEncrypted: inertEnvelope,
        enabled: false
      },
      currentNow.toISOString()
    ), /property_line_setup_tokens_test_rollback|check constraint/i, "failure after binding upsert rolls back the transaction");
    rawToken = providers.lineBindings.getLineSetupTokenByHash(tokenHash(rollbackToken));
    const rolledBackBinding = providers.lineBindings.getLineBindingByPropertyId("line_setup_alpha");
    assert.equal(rawToken.usedAt, null, "post-upsert transaction failure does not consume token");
    assert.equal(rolledBackBinding, null, "post-upsert transaction failure rolls back the half binding");

    const concurrent = await createLink();
    const concurrentBodies = [0, 1].map(() => ({
      token: concurrent.token,
      channelSecret: crypto.randomBytes(24).toString("base64url"),
      channelAccessToken: crypto.randomBytes(48).toString("base64url")
    }));
    const concurrentResults = await Promise.all(concurrentBodies.map((body) => request(
      `${running.url}/api/public/line-setup/redeem`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    )));
    assert.deepEqual(
      concurrentResults.map((item) => item.response.status).sort((a, b) => a - b),
      [200, 410],
      "duplicate redemption requests permit exactly one success"
    );
    assert.equal(
      concurrentResults.find((item) => item.response.status === 410).body.error.code,
      "LINE_SETUP_LINK_USED"
    );
    assert.ok(
      providers.lineBindings.getLineSetupTokenByHash(tokenHash(concurrent.token)).usedAt,
      "winning duplicate request consumes the token exactly once"
    );

    const secret = crypto.randomBytes(24).toString("base64url");
    const accessToken = crypto.randomBytes(48).toString("base64url");
    const redeemed = await request(`${running.url}/api/public/line-setup/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: setupToken,
        propertyId: "line_setup_beta",
        channelSecret: secret,
        channelAccessToken: accessToken
      })
    });
    assert.equal(redeemed.response.status, 200, "valid token saves credentials once");
    assert.equal(redeemed.body.data.propertyName, "Alpha 測試旅宿");
    assert.match(redeemed.body.data.webhookUrl, /^https:\/\/test-only\.example\.test\/api\/line\/webhooks\//);
    assert.equal(redeemed.body.data.hasChannelSecret, true);
    assert.equal(redeemed.body.data.hasChannelAccessToken, true);
    assert.equal(Object.hasOwn(redeemed.body.data, "channelSecret"), false);
    assert.equal(Object.hasOwn(redeemed.body.data, "channelAccessToken"), false);
    assert.doesNotMatch(JSON.stringify(redeemed.body), new RegExp(`${secret}|${accessToken}`));

    const usedAgain = await request(`${running.url}/api/public/line-setup/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: setupToken,
        channelSecret: crypto.randomBytes(24).toString("base64url"),
        channelAccessToken: crypto.randomBytes(48).toString("base64url")
      })
    });
    assert.equal(usedAgain.response.status, 410, "used token cannot be submitted twice");
    assert.equal(usedAgain.body.error.code, "LINE_SETUP_LINK_USED");

    const alphaBinding = providers.lineBindings.getLineBindingByPropertyId("line_setup_alpha");
    const betaBinding = providers.lineBindings.getLineBindingByPropertyId("line_setup_beta");
    rawToken = providers.lineBindings.getLineSetupTokenByHash(tokenHash(setupToken));
    assert.equal(alphaBinding.propertyId, "line_setup_alpha", "Alpha token creates only Alpha binding");
    assert.equal(betaBinding.propertyId, "line_setup_beta", "request propertyId cannot redirect or replace Beta scope");
    assert.ok(rawToken.usedAt, "successful transaction consumes token");
    assert.equal(alphaBinding.channelSecretEncrypted.algorithm, "aes-256-gcm");
    assert.equal(alphaBinding.channelAccessTokenEncrypted.algorithm, "aes-256-gcm");
    assert.doesNotMatch(JSON.stringify(alphaBinding), new RegExp(`${secret}|${accessToken}`));
    assert.doesNotMatch(observedLogs.join("\n"), new RegExp(`${secret}|${accessToken}`));

    const usedResolve = await resolveSetup(running.url, setupToken);
    assert.equal(usedResolve.response.status, 410, "used token cannot resolve again");
    assert.equal(usedResolve.body.error.code, "LINE_SETUP_LINK_USED");

    const adminPage = await request(`${running.url}/admin/line-connections`, { headers: { cookie } });
    const setupPage = await request(`${running.url}/line/setup`);
    const setupScript = await request(`${running.url}/assets/line-setup.js`);
    const adminStatus = await request(`${running.url}/api/admin/line-connections`, { headers: { cookie } });
    assert.equal(adminPage.response.status, 200, "platform LINE connection page is served");
    assert.equal(setupPage.response.status, 200, "operator one-time setup page is served");
    assert.match(String(adminPage.body), /建立一次性設定連結/);
    assert.match(String(setupPage.body), /Channel Secret/);
    assert.match(String(setupPage.body), /Channel Access Token/);
    assert.match(String(setupPage.body), /LINE Developers 設定步驟/);
    assert.equal(setupPage.response.headers.get("referrer-policy"), "no-referrer");
    assert.match(String(setupPage.body), /name="referrer" content="no-referrer"/);
    assert.match(String(setupScript.body), /location\.hash/);
    assert.match(String(setupScript.body), /history\.replaceState/);
    assert.doesNotMatch(String(setupScript.body), /location\.search/);
    assert.doesNotMatch(String(setupScript.body), /localStorage/);
    assert.equal(adminStatus.response.status, 200, JSON.stringify(adminStatus.body));
    const alphaStatus = adminStatus.body.data.items.find((item) => item.propertyId === "line_setup_alpha");
    assert.equal(alphaStatus.hasChannelSecret, true);
    assert.equal(alphaStatus.hasChannelAccessToken, true);
    assert.equal(alphaStatus.webhookObserved, false);
    assert.match(alphaStatus.webhookUrl, /\/api\/line\/webhooks\//);

    const enabled = await request(`${running.url}/api/admin/line-bindings/line_setup_alpha/enabled`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ enabled: true })
    });
    assert.equal(enabled.response.status, 200);
    const malformedPayload = "{";
    const malformedSignature = crypto.createHmac("sha256", secret).update(malformedPayload).digest("base64");
    const malformedWebhook = await fetch(`${running.url}/api/line/webhooks/${alphaBinding.webhookKey}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": malformedSignature },
      body: malformedPayload
    });
    assert.equal(malformedWebhook.status, 400);
    let observedStatus = await request(`${running.url}/api/admin/line-connections`, { headers: { cookie } });
    assert.equal(observedStatus.body.data.items.find((item) => item.propertyId === "line_setup_alpha").webhookObserved, false, "signed malformed data is not an observed LINE event");
    const validPayload = JSON.stringify({ destination: "test", events: [] });
    const validSignature = crypto.createHmac("sha256", secret).update(validPayload).digest("base64");
    const originalObservationUpdate = providers.lineBindings.markLineBindingWebhookObserved;
    providers.lineBindings.markLineBindingWebhookObserved = () => {
      throw new Error("injected observation storage failure");
    };
    const observationFailureWebhook = await fetch(`${running.url}/api/line/webhooks/${alphaBinding.webhookKey}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": validSignature },
      body: validPayload
    });
    assert.equal(observationFailureWebhook.status, 200, "observation storage failure does not fail a valid LINE webhook");
    assert.match(observedErrors.join("\n"), /LINE webhook observation update failed/);
    providers.lineBindings.markLineBindingWebhookObserved = originalObservationUpdate;
    observedStatus = await request(`${running.url}/api/admin/line-connections`, { headers: { cookie } });
    assert.equal(observedStatus.body.data.items.find((item) => item.propertyId === "line_setup_alpha").webhookObserved, false);
    const validWebhook = await fetch(`${running.url}/api/line/webhooks/${alphaBinding.webhookKey}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": validSignature },
      body: validPayload
    });
    assert.equal(validWebhook.status, 200);
    observedStatus = await request(`${running.url}/api/admin/line-connections`, { headers: { cookie } });
    assert.equal(observedStatus.body.data.items.find((item) => item.propertyId === "line_setup_alpha").webhookObserved, true, "valid signed LINE payload marks webhook observed");
    originalLog("property-scoped LINE setup: PASS");
  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (app) await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
