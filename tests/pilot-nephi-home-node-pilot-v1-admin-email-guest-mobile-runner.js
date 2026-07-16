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
const { upsertAdminUser, bindAdminEmail } = require(path.join(root, "lib/admin-auth"));
const { createApp } = require(path.join(root, "server"));

const checks = [];
function check(name, value) { assert.ok(value, name); checks.push(name); }
async function json(url, options = {}) { const response = await fetch(url, options); return { response, body: await response.json() }; }

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-admin-email-"));
  const connection = { kind: "pglite", dataDir };
  await migratePostgres(connection);
  await migratePostgres(connection);
  await seedPostgres(connection);
  const db = await openPostgres(connection);
  await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", ["other_home", "另一間旅宿"]);
  await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)", ["other_home", JSON.stringify({ onboarding: { isReady: true }, contactLink: "https://lin.ee/other-safe" })]);
  await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,$2,$3,2,'double','',0)", ["other_home", "room_a", "另一間雙人房"]);
  await db.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,$2,$3,'available',1)", ["other_home", "room_a", "2026-07-19"]);
  await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", ["unsafe_home", "未設定 LINE 旅宿"]);
  await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)", ["unsafe_home", JSON.stringify({ onboarding: { isReady: true }, contactLink: "https://example.com/not-line" })]);
  await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,$2,$3,2,'double','',0)", ["unsafe_home", "room_b", "未設定雙人房"]);
  await db.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,$2,$3,'available',1)", ["unsafe_home", "room_b", "2026-07-19"]);
  await db.close();

  await upsertAdminUser(connection, { propertyId: "nephi_home", username: "owner", email: "owner@example.test", password: "owner-password-123" });
  await upsertAdminUser(connection, { propertyId: "other_home", username: "owner_other", email: "OWNER@example.test", password: "owner-password-123" });
  await upsertAdminUser(connection, { propertyId: "nephi_home", username: "platform", email: "platform@example.test", password: "platform-password-123" });
  await upsertAdminUser(connection, { propertyId: "nephi_home", username: "nephi_admin", password: "legacy-password-123" });
  await bindAdminEmail(connection, { propertyId: "nephi_home", username: "nephi_admin", email: "legacy@example.test" });
  await upsertAdminUser(connection, { propertyId: "nephi_home", username: "reset_admin", password: "old-reset-password" });
  await bindAdminEmail(connection, { propertyId: "nephi_home", username: "reset_admin", email: "reset@example.test" });
  await upsertAdminUser(connection, { propertyId: "nephi_home", username: "reset_admin", password: "new-reset-password" });
  const grantDb = await openPostgres(connection);
  await grantDb.query("INSERT INTO platform_admin_grants(property_id,username) VALUES($1,$2)", ["nephi_home", "platform"]);
  const identityCount = await grantDb.query("SELECT count(*)::int count FROM admin_identities WHERE normalized_email='owner@example.test'");
  check("Email is globally unique and shared across memberships", Number(identityCount.rows[0].count) === 1);
  const ordinaryGrant = await grantDb.query("SELECT 1 FROM platform_admin_grants WHERE username='owner'");
  check("ordinary admin is not auto-promoted to platform admin", ordinaryGrant.rows.length === 0);
  await grantDb.close();

  let providers = createPostgresProviders(connection), persistentCookie = "";
  let app = createApp({ providers, structuredClassifier: null, adminAuthRequired: true });
  let running = await app.start(0, "127.0.0.1");
  let base = running.url;
  try {
    const adminPage = await fetch(`${base}/admin`);
    const adminHtml = await adminPage.text();
    check("login page asks for Email and password only", /name="email"/.test(adminHtml) && /name="password"/.test(adminHtml) && !/name="propertyId"|name="username"/.test(adminHtml));

    const wrongEmail = await json(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "missing@example.test", password: "wrong-password-123" }) });
    const wrongPassword = await json(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.test", password: "wrong-password-123" }) });
    check("login errors do not reveal whether Email exists", wrongEmail.response.status === 401 && wrongPassword.response.status === 401 && wrongEmail.body.error.code === wrongPassword.body.error.code && wrongEmail.body.error.message === "Email 或密碼錯誤" && wrongPassword.body.error.message === "Email 或密碼錯誤");

    const multi = await json(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "OWNER@EXAMPLE.TEST", password: "owner-password-123" }) });
    const multiCookie = multi.response.headers.get("set-cookie").split(";")[0];
    check("multi-property login requires property selection", multi.response.status === 200 && multi.body.data.requiresPropertySelection === true && multi.body.data.properties.length === 2 && !multi.body.data.propertyId);
    const selected = await json(`${base}/api/admin/select-property`, { method: "POST", headers: { cookie: multiCookie, "content-type": "application/json" }, body: JSON.stringify({ propertyId: "other_home" }) });
    check("authorized property can be selected", selected.response.status === 200 && selected.body.data.propertyId === "other_home");
    const forbidden = await json(`${base}/api/availability/month?customerId=nephi_home&year=2026&month=7`, { headers: { cookie: multiCookie } });
    check("selected session remains property isolated", forbidden.response.status === 403);

    const legacy = await json(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "legacy@example.test", password: "legacy-password-123" }) });
    persistentCookie = legacy.response.headers.get("set-cookie").split(";")[0];
    check("legacy password hash remains valid after safe Email binding", legacy.response.status === 200 && legacy.body.data.propertyId === "nephi_home" && legacy.body.data.requiresPropertySelection === false);
    const reset = await json(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "reset@example.test", password: "new-reset-password" }) });
    check("existing safe password reset updates bound Email identity", reset.response.status === 200 && reset.body.data.propertyId === "nephi_home");

    const platform = await json(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "platform@example.test", password: "platform-password-123" }) });
    const platformCookie = platform.response.headers.get("set-cookie").split(";")[0];
    const reviewPage = await fetch(`${base}/admin/onboarding`, { headers: { cookie: platformCookie } });
    check("platform admin grant remains effective", reviewPage.status === 200);

    const guestPage = await fetch(`${base}/guest?propertyId=other_home`);
    const guestHtml = await guestPage.text();
    const guestJs = fs.readFileSync(path.join(root, "public/assets/guest.js"), "utf8");
    const guestCss = fs.readFileSync(path.join(root, "public/assets/guest.css"), "utf8");
    check("guest page has LINE unavailable fallback", guestHtml.includes("lineUnavailable"));
    check("guest result scrolls into view", /results\.scrollIntoView/.test(guestJs));
    check("mobile date field is centered for Safari", /input\[type="date"\]/.test(guestCss) && /::-webkit-date-and-time-value/.test(guestCss) && /text-align:\s*center/.test(guestCss));
    check("390px layout prevents horizontal overflow", /max-width:\s*390px/.test(guestCss) && /min-width:\s*0/.test(guestCss));

    const otherAvailability = await json(`${base}/api/public/availability?propertyId=other_home&checkIn=2026-07-19`);
    check("property-specific safe LINE link is returned", otherAvailability.body.data.lineUrl === "https://lin.ee/other-safe");
    const unsafeAvailability = await json(`${base}/api/public/availability?propertyId=unsafe_home&checkIn=2026-07-19`);
    check("non-LINE contact link is not exposed", unsafeAvailability.body.data.lineUrl === "");
  } finally {
    await app.stop();
  }

  providers = createPostgresProviders(connection);
  app = createApp({ providers, structuredClassifier: null, adminAuthRequired: true });
  running = await app.start(0, "127.0.0.1");
  base = running.url;
  try {
    const session = await json(`${base}/api/admin/session`, { headers: { cookie: persistentCookie } });
    check("Email identity session persists in PostgreSQL", session.response.status === 200 && session.body.data.propertyId === "nephi_home" && !/password|hash/i.test(JSON.stringify(session.body.data)));
  } finally {
    await app.stop();
    if (providers.close) await providers.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`${checks.length}/${checks.length} PASS`);
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
