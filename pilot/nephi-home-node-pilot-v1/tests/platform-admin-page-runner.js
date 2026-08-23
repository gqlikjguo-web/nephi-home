"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createApp } = require("../server");
const { sessionTokenHash } = require("../lib/admin-auth");
const { createJsonProviders } = require("../lib/providers/json-providers");

const PLATFORM_TOKEN = "platform-admin-session";
const PROPERTY_TOKEN = "property-admin-session";

async function request(url, route, token = "") {
  return fetch(`${url}${route}`, { headers: token ? { cookie: `nephi_admin_session=${token}` } : {} });
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.className = "";
    this.open = false;
    this._text = "";
  }
  append(...nodes) { this.childNodes.push(...nodes.filter(Boolean)); }
  replaceChildren(...nodes) { this.childNodes = nodes.filter(Boolean); }
  set textContent(value) { this._text = String(value ?? ""); this.childNodes = []; }
  get textContent() { return this._text + this.childNodes.map((node) => node.textContent || "").join(""); }
  addEventListener() {}
}

function find(root, tagName) {
  if (root.tagName === tagName.toUpperCase()) return root;
  for (const child of root.childNodes || []) {
    const match = find(child, tagName);
    if (match) return match;
  }
  return null;
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
  providers.onboarding.listOnboarding = () => [
    { applicationId: "application-a", status: "submitted" },
    { applicationId: "application-b", status: "resubmitted" },
    { applicationId: "application-c", status: "approved" }
  ];
  providers.lineBindings = {
    createLineSetupToken() {},
    getLineSetupTokenByHash() { return null; },
    listLineSetupTokens() { return []; },
    getLineBindingByPropertyId(propertyId) {
      return propertyId === "property_alpha" ? {
        propertyId,
        webhookKey: "alpha-webhook-key",
        channelSecretEncrypted: {},
        channelAccessTokenEncrypted: {},
        enabled: true
      } : null;
    }
  };

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
    assert.match(pageText, /\/assets\/styles\.css/);
    assert.match(pageText, /\/assets\/admin-platform\.css/);
    assert.match(pageText, /id="platformSummary"/);
    assert.match(pageText, /平台總覽[\s\S]*業者導入[\s\S]*LINE 串接/);
    assert.doesNotMatch(pageText, /password|credential|channel[_ -]?(?:secret|token)|access[_ -]?token/i);

    const properties = await request(running.url, "/api/admin/onboarding/properties", PLATFORM_TOKEN);
    assert.equal(properties.status, 200);
    const propertyData = await properties.json();
    assert.deepEqual(propertyData.data.items.map((item) => item.propertyId), ["property_alpha", "property_beta"]);
    assert.equal(propertyData.data.items[0].rooms[0].name, "Alpha Room");
    assert.equal(propertyData.data.items[0].bundles[0].name, "Alpha Bundle");

    const applications = await request(running.url, "/api/admin/onboarding/applications", PLATFORM_TOKEN);
    assert.equal(applications.status, 200);
    assert.deepEqual((await applications.json()).data.items.map((item) => item.status), ["submitted", "resubmitted", "approved"]);

    const connections = await request(running.url, "/api/admin/line-connections", PLATFORM_TOKEN);
    assert.equal(connections.status, 200);
    assert.deepEqual((await connections.json()).data.items.map((item) => [item.propertyId, item.enabled]), [["property_alpha", true], ["property_beta", false]]);

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
  assert.match(client, /\/api\/admin\/onboarding\/applications/);
  assert.match(client, /\/api\/admin\/line-connections/);
  assert.match(client, /textContent/);
  assert.doesNotMatch(client, /password|credential|channel[_ -]?(?:secret|token)|access[_ -]?token/i);
  const elements = new Map([["#properties", new FakeElement("div")], ["#message", new FakeElement("p")], ["#platformSummary", new FakeElement("div")], ["#refresh", new FakeElement("button")]]);
  const context = vm.createContext({
    document: {
      querySelector(selector) { return elements.get(selector) || null; },
      createElement(tagName) { return new FakeElement(tagName); }
    },
    fetch: async () => { throw new Error("boot must not run in component contract"); },
    console
  });
  const bootMarker = 'document.querySelector("#refresh").addEventListener("click", load);';
  vm.runInContext(`${client.slice(0, client.indexOf(bootMarker))}\nthis.__summaryCounts=summaryCounts;this.__propertyCard=propertyCard;`, context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.__summaryCounts(
      [{ propertyId: "property_alpha" }, { propertyId: "property_beta" }],
      [{ status: "submitted" }, { status: "resubmitted" }, { status: "approved" }],
      [{ propertyId: "property_alpha", enabled: true }, { propertyId: "property_beta", enabled: false }]
    ))),
    { propertyCount: 2, pendingApplicationCount: 2, lineEnabledCount: 1, lineDisabledCount: 1 }
  );
  const card = context.__propertyCard(
    { propertyId: "property_alpha", propertyName: "Alpha Stay", rooms: [{ id: "alpha-room", name: "Alpha Room" }], bundles: [{ id: "alpha-bundle", name: "Alpha Bundle" }] },
    new Map([["property_alpha", { enabled: true }]])
  );
  assert.match(card.textContent, /Alpha Stay[\s\S]*房型 1[\s\S]*包棟 1[\s\S]*LINE 已啟用/);
  const details = find(card, "details");
  assert.ok(details, "property details must use a collapsed details control");
  assert.equal(details.open, false);
  assert.match(details.textContent, /展開詳細[\s\S]*Alpha Room[\s\S]*Alpha Bundle/);
  const onboardingPage = fs.readFileSync(path.join(__dirname, "../public/admin-onboarding.html"), "utf8");
  assert.match(onboardingPage, /href="\/admin\/platform"/);

  console.log("platform admin page contract: PASS");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
