"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createJsonProviders } = require("../lib/providers/json-providers"), { migratePostgres } = require("../lib/providers/postgres-migrate"), { openPostgres } = require("../lib/providers/postgres-client"), { createPostgresProviders } = require("../lib/providers/postgres-providers"), { sessionTokenHash, upsertAdminUser } = require("../lib/admin-auth"), { createApp } = require("../server");
const PLATFORM = "platform-property-session", OPERATOR = "operator-property-session";
async function request(base, pathname, token) { const response = await fetch(base + pathname, { headers: token ? { cookie: `nephi_admin_session=${token}` } : {} }), payload = await response.json(); return { response, body: payload.data || payload }; }
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "platform-property-management-")), seedFile = path.join(temp, "seed.json"), dataFile = path.join(temp, "data.json");
  fs.writeFileSync(seedFile, JSON.stringify({ testOnly: true, seedDays: 2, homestays: [{ customerId: "property_alpha", name: "Alpha Stay", businessProfile: { address: "Alpha Road" }, propertyFacts: [{ canonicalId: "parking", status: "yes", answer: "有停車位" }], rooms: [{ id: "alpha-room", name: "Alpha Room", capacity: 2, mondayThursdayPrice: 1000, fridayPrice: 1200, saturdayHolidayPrice: 1500, sundayPrice: 1100 }] }] }));
  const providers = { kind: "json", ...createJsonProviders({ dataFile, seedFile }) };
  providers.persistence.getAdminSession = hash => hash === sessionTokenHash(PLATFORM) ? { propertyId: "property_alpha", username: "platform", userId: "platform-user" } : hash === sessionTokenHash(OPERATOR) ? { propertyId: "property_alpha", username: "owner", userId: "operator-user" } : null;
  providers.persistence.listAdminPropertyAccounts = () => [{ propertyId: "property_alpha", emails: ["owner@example.test"], accountStatus: "active" }];
  providers.onboarding = { isPlatformAdmin: (_p, _u, id) => id === "platform-user", listOnboarding: () => [{ approvedPropertyId: "property_alpha", status: "approved" }] };
  providers.lineBindings = { getLineBindingByPropertyId: () => ({ propertyId: "property_alpha", webhookKey: "must-not-leak", channelSecretEncrypted: { ciphertext: "secret" }, channelAccessTokenEncrypted: { ciphertext: "token" }, enabled: true }) };
  const app = createApp({ providers, adminAuthRequired: true }), running = await app.start(0, "127.0.0.1");
  try {
    let result = await request(running.url, "/api/admin/platform/properties", PLATFORM);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.items[0], { propertyId: "property_alpha", propertyName: "Alpha Stay", emails: ["owner@example.test"], accountStatus: "active", onboardingStatus: "approved", enabled: true, lineEnabled: true, roomCount: 1, bundleCount: 0 });
    result = await request(running.url, "/api/admin/platform/properties/property_alpha", PLATFORM);
    assert.equal(result.response.status, 200);
    for (const key of ["property", "rooms", "pricing", "availability", "bundles", "propertyFacts", "customReplies", "line", "account", "otherSettings"]) assert.ok(Object.hasOwn(result.body, key), key);
    assert.equal(result.body.property.propertyId, "property_alpha"); assert.equal(result.body.account.emails[0], "owner@example.test"); assert.match(JSON.stringify(result.body), /Alpha Road/);
    assert.doesNotMatch(JSON.stringify(result.body), /password|hash|token|secret|ciphertext|webhookKey/i);
    const page = await (await fetch(running.url + "/admin/platform", { headers: { cookie: `nephi_admin_session=${PLATFORM}` } })).text(), asset = await (await fetch(running.url + "/assets/admin-platform.js")).text();
    assert.match(page, /業者管理/); assert.match(page, /所有正式業者/); assert.match(asset, /\/api\/admin\/platform\/properties/); assert.match(asset, /其他正式設定/);
    for (const endpoint of ["/api/admin/platform/properties", "/api/admin/platform/properties/property_alpha"]) { result = await request(running.url, endpoint, OPERATOR); assert.equal(result.response.status, 401); assert.equal(result.body.error.code, "PLATFORM_ADMIN_REQUIRED"); }
  } finally { await app.stop(); fs.rmSync(temp, { recursive: true, force: true }); }
  const pgRoot = fs.mkdtempSync(path.join(os.tmpdir(), "platform-property-accounts-")), connection = { kind: "pglite", dataDir: path.join(pgRoot, "db") };
  await migratePostgres(connection); const db = await openPostgres(connection); await db.query("INSERT INTO properties(property_id,display_name) VALUES('property_pg','Postgres Stay')"); await db.close();
  await upsertAdminUser(connection, { propertyId: "property_pg", username: "owner", email: "pg-owner@example.test", password: "postgres-owner-password" });
  const postgres = createPostgresProviders(connection); try { assert.deepEqual(postgres.persistence.listAdminPropertyAccounts(), [{ propertyId: "property_pg", emails: ["pg-owner@example.test"], accountStatus: "active" }]); } finally { await postgres.close(); fs.rmSync(pgRoot, { recursive: true, force: true }); }
  console.log("platform property management: PASS");
})().catch(error => { console.error(error.stack || error); process.exit(1); });
