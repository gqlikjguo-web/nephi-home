"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { createLineBindingService } = require("../lib/line-binding-service");
const { sessionTokenHash } = require("../lib/admin-auth");

const encryptionKey = crypto.randomBytes(32).toString("base64");
const secretA = "channel-a-signing-secret";
const secretB = "channel-b-signing-secret";
const tokenA = "channel-a-access-token";
const tokenB = "channel-b-access-token";

function memoryBindingProvider() {
  const rowsByProperty = new Map();
  const rowsByKey = new Map();
  return {
    rawRows: rowsByProperty,
    getLineBindingByPropertyId(propertyId) { return rowsByProperty.get(propertyId) || null; },
    getLineBindingByWebhookKey(webhookKey) { return rowsByKey.get(webhookKey) || null; },
    upsertLineBinding(row) {
      const previous = rowsByProperty.get(row.propertyId);
      if (previous) rowsByKey.delete(previous.webhookKey);
      const saved = { ...row, createdAt: previous && previous.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      rowsByProperty.set(saved.propertyId, saved);
      rowsByKey.set(saved.webhookKey, saved);
      return saved;
    },
    setLineBindingEnabled(propertyId, enabled) {
      const current = rowsByProperty.get(propertyId);
      if (!current) return null;
      return this.upsertLineBinding({ ...current, enabled: Boolean(enabled) });
    }
  };
}

function planParking() {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{
      taskId: "parking",
      type: "amenity",
      sourceText: "parking availability",
      detailIntent: "general",
      requestedOutputs: ["answer"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: { category: "amenity", rawText: "parking", canonicalCandidate: "parking", confidence: 0.99 },
      confidence: 0.99
    }],
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "line_binding_test"
  };
}

function signed(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64");
}

async function post(url, route, payload, signature) {
  return fetch(`${url}${route}`, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": signature }, body: payload });
}

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for LINE background reply");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

(async () => {
  const originalLog = console.log;
  const observedLogs = [];
  console.log = (...args) => observedLogs.push(args.map(String).join(" "));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "property-line-binding-"));
  const seedFile = path.join(temp, "seed.json");
  const dataFile = path.join(temp, "store.json");
  fs.writeFileSync(seedFile, JSON.stringify({
    testOnly: true,
    seedDays: 5,
    messageLogs: { property_a: [], property_b: [] },
    homestays: [
      { customerId: "property_a", name: "Property A", safeFacts: { parkingRule: "Parking A" }, rooms: [{ id: "a-room", name: "A Room", type: "double", capacity: 2 }] },
      { customerId: "property_b", name: "Property B", safeFacts: { parkingRule: "Parking B" }, rooms: [{ id: "b-room", name: "B Room", type: "double", capacity: 2 }] }
    ]
  }));

  const bindingProvider = memoryBindingProvider();
  const bindingService = createLineBindingService({ provider: bindingProvider, env: { JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY: encryptionKey } });
  const bindingA = bindingService.upsert("property_a", { channelSecret: secretA, channelAccessToken: tokenA, enabled: true });
  const bindingB = bindingService.upsert("property_b", { channelSecret: secretB, channelAccessToken: tokenB, enabled: true });
  assert.notEqual(bindingA.webhookKey, bindingB.webhookKey);
  assert.equal(bindingA.hasChannelSecret, true);
  assert.equal(bindingA.hasChannelAccessToken, true);
  assert.equal(Object.hasOwn(bindingA, "channelSecret"), false);
  assert.equal(Object.hasOwn(bindingA, "channelAccessToken"), false);
  const rawStorage = JSON.stringify([...bindingProvider.rawRows.values()]);
  assert.doesNotMatch(rawStorage, new RegExp([secretA, secretB, tokenA, tokenB].join("|")));

  const providers = { kind: "json", ...createJsonProviders({ dataFile, seedFile }) };
  providers.lineBindings = bindingProvider;
  providers.persistence.getAdminSession = async (hash) => {
    if (hash === sessionTokenHash("platform-session")) return { propertyId: "platform", username: "admin", userId: "platform-user" };
    if (hash === sessionTokenHash("property-admin-session")) return { propertyId: "property_a", username: "owner", userId: "property-user" };
    return null;
  };
  providers.onboarding = { isPlatformAdmin: (_propertyId, _username, userId) => userId === "platform-user" };

  const plannerProperties = [];
  const replies = [];
  const app = createApp({
    providers,
    adminAuthRequired: true,
    lineBindingEnv: { JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY: encryptionKey },
    conversationDebounceMs: 1,
    conversationPlannerV2: { classify: async ({ catalog }) => { plannerProperties.push(catalog.propertyId); return planParking(); } },
    lineReplyClientFactory: ({ channelAccessToken }) => ({ replyMessageWithHttpInfo: async (body) => { replies.push({ channelAccessToken, body }); return { httpResponse: { status: 200 } }; } })
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    const event = (id, userId) => JSON.stringify({ destination: "untrusted-destination", propertyId: "property_b", customerId: "property_b", events: [{ type: "message", webhookEventId: id, replyToken: `reply-${id}`, timestamp: 1, source: { userId }, message: { type: "text", id: `message-${id}`, text: "Parking?" } }] });
    const payloadA = event("event-a", "same-user");
    const payloadB = event("event-b", "same-user");
    const routeA = `/api/line/webhooks/${bindingA.webhookKey}?customerId=property_b&propertyId=property_b`;
    const routeB = `/api/line/webhooks/${bindingB.webhookKey}?customerId=property_a&propertyId=property_a`;

    assert.equal((await post(running.url, routeA, payloadA, signed(secretA, payloadA))).status, 200);
    assert.equal((await post(running.url, routeB, payloadB, signed(secretB, payloadB))).status, 200);
    await waitFor(() => replies.length === 2);
    assert.deepEqual(plannerProperties, ["property_a", "property_b"]);
    assert.deepEqual(replies.map((item) => item.channelAccessToken).sort(), [tokenA, tokenB].sort());
    assert.match(replies.find((item) => item.channelAccessToken === tokenA).body.messages[0].text, /Parking A/);
    assert.match(replies.find((item) => item.channelAccessToken === tokenB).body.messages[0].text, /Parking B/);

    const callsBeforeFailures = plannerProperties.length;
    assert.equal((await post(running.url, `/api/line/webhooks/${bindingB.webhookKey}`, payloadA, signed(secretA, payloadA))).status, 401);
    assert.equal((await post(running.url, "/api/line/webhooks/unknown-binding-key", payloadA, signed(secretA, payloadA))).status, 404);
    bindingService.setEnabled("property_b", false);
    assert.equal((await post(running.url, `/api/line/webhooks/${bindingB.webhookKey}`, payloadB, signed(secretB, payloadB))).status, 404);
    assert.equal(plannerProperties.length, callsBeforeFailures);

    const unauthenticated = await fetch(`${running.url}/api/admin/line-bindings/property_a`);
    assert.equal(unauthenticated.status, 401);
    const propertyAdmin = await fetch(`${running.url}/api/admin/line-bindings/property_a`, { headers: { cookie: "nephi_admin_session=property-admin-session" } });
    assert.equal(propertyAdmin.status, 401);
    const authenticated = await fetch(`${running.url}/api/admin/line-bindings/property_a`, { headers: { cookie: "nephi_admin_session=platform-session" } });
    assert.equal(authenticated.status, 200);
    const statusBody = await authenticated.json();
    assert.deepEqual(Object.keys(statusBody.data).sort(), ["enabled", "hasChannelAccessToken", "hasChannelSecret", "propertyId", "webhookKey"].sort());
    assert.doesNotMatch(JSON.stringify(statusBody), new RegExp([secretA, tokenA].join("|")));
    const disabledByAdmin = await fetch(`${running.url}/api/admin/line-bindings/property_a/enabled`, { method: "PATCH", headers: { cookie: "nephi_admin_session=platform-session", "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    assert.equal(disabledByAdmin.status, 200);
    assert.equal((await disabledByAdmin.json()).data.enabled, false);
    const rotatedByAdmin = await fetch(`${running.url}/api/admin/line-bindings/property_a`, { method: "PUT", headers: { cookie: "nephi_admin_session=platform-session", "content-type": "application/json" }, body: JSON.stringify({ channelSecret: "rotated-test-secret", channelAccessToken: "rotated-test-token", enabled: true }) });
    assert.equal(rotatedByAdmin.status, 200);
    const rotatedBody = await rotatedByAdmin.json();
    assert.equal(rotatedBody.data.webhookKey, bindingA.webhookKey);
    assert.equal(rotatedBody.data.enabled, true);
    assert.doesNotMatch(JSON.stringify(rotatedBody), /rotated-test-secret|rotated-test-token/);

    const noKeyService = createLineBindingService({ provider: memoryBindingProvider(), env: {} });
    assert.throws(() => noKeyService.upsert("property_a", { channelSecret: secretA, channelAccessToken: tokenA, enabled: true }), /encryption key/i);

    assert.doesNotMatch(observedLogs.join("\n"), new RegExp([secretA, secretB, tokenA, tokenB, "rotated-test-secret", "rotated-test-token"].join("|")));
    originalLog("property-scoped LINE binding: PASS");
  } finally {
    console.log = originalLog;
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
