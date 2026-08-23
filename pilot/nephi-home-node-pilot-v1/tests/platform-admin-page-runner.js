"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { sessionTokenHash } = require("../lib/admin-auth");
const { createJsonProviders } = require("../lib/providers/json-providers");

const PLATFORM_TOKEN = "platform-admin-session";
const PROPERTY_TOKEN = "property-admin-session";

async function request(url, route, token = "") {
  return fetch(`${url}${route}`, { headers: token ? { cookie: `nephi_admin_session=${token}` } : {} });
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "platform-admin-page-"));
  const seedFile = path.join(temp, "seed.json");
  const dataFile = path.join(temp, "data.json");
  fs.writeFileSync(seedFile, JSON.stringify({
    testOnly: true,
    seedDays: 2,
    homestays: [
      { customerId: "property_alpha", name: "Alpha Stay", rooms: [{ id: "alpha-room", name: "Alpha Room", capacity: 2 }] },
      { customerId: "property_beta", name: "Beta Stay", rooms: [{ id: "beta-room", name: "Beta Room", capacity: 4 }] }
    ]
  }));

  const providers = { kind: "json", ...createJsonProviders({ dataFile, seedFile }) };
  providers.persistence.getAdminSession = async (hash) => {
    if (hash === sessionTokenHash(PLATFORM_TOKEN)) return { propertyId: "property_alpha", username: "platform", userId: "platform-user" };
    if (hash === sessionTokenHash(PROPERTY_TOKEN)) return { propertyId: "property_alpha", username: "owner", userId: "property-user" };
    return null;
  };
  providers.onboarding = {};
  providers.onboarding.isPlatformAdmin = (_propertyId, _username, userId) => userId === "platform-user";
  providers.onboarding.listOnboardingProperties = ({ all }) => all ? [
    { propertyId: "property_alpha", propertyName: "Alpha Stay", rooms: [{ id: "alpha-room", name: "Alpha Room" }], bundles: [{ id: "alpha-bundle", name: "Alpha Bundle", memberRoomIds: ["alpha-room"] }] },
    { propertyId: "property_beta", propertyName: "Beta Stay", rooms: [{ id: "beta-room", name: "Beta Room" }], bundles: [] }
  ] : [];

  const app = createApp({ providers, adminAuthRequired: true });
  const running = await app.start(0, "127.0.0.1");
  try {
    const denied = await request(running.url, "/admin/platform", PROPERTY_TOKEN);
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).error.code, "PLATFORM_ADMIN_REQUIRED");

    const page = await request(running.url, "/admin/platform", PLATFORM_TOKEN);
    assert.equal(page.status, 200);
    const pageText = await page.text();
    assert.match(pageText, /平台總後台/);
    assert.match(pageText, /\/assets\/admin-platform\.js/);
    assert.doesNotMatch(pageText, /password|credential|channel[_ -]?(?:secret|token)|access[_ -]?token/i);

    const properties = await request(running.url, "/api/admin/onboarding/properties", PLATFORM_TOKEN);
    assert.equal(properties.status, 200);
    const propertyData = await properties.json();
    assert.deepEqual(propertyData.data.items.map((item) => item.propertyId), ["property_alpha", "property_beta"]);
    assert.equal(propertyData.data.items[0].rooms[0].name, "Alpha Room");
    assert.equal(propertyData.data.items[0].bundles[0].name, "Alpha Bundle");

    const operatorApi = await request(running.url, "/api/admin/onboarding/properties", PROPERTY_TOKEN);
    assert.equal(operatorApi.status, 401);
    assert.equal((await operatorApi.json()).error.code, "PLATFORM_ADMIN_REQUIRED");

    const operatorAdmin = await request(running.url, "/admin", PROPERTY_TOKEN);
    assert.equal(operatorAdmin.status, 200);
  } finally {
    await app.stop();
  }

  const client = fs.readFileSync(path.join(__dirname, "../public/assets/admin-platform.js"), "utf8");
  assert.match(client, /\/api\/admin\/onboarding\/properties/);
  assert.match(client, /textContent/);
  assert.doesNotMatch(client, /password|credential|channel[_ -]?(?:secret|token)|access[_ -]?token/i);
  const onboardingPage = fs.readFileSync(path.join(__dirname, "../public/admin-onboarding.html"), "utf8");
  assert.match(onboardingPage, /href="\/admin\/platform"/);

  console.log("platform admin page contract: PASS");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
