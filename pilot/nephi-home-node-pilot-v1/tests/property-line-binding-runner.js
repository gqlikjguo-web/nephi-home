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
    },
    markLineBindingWebhookObserved(webhookKey, observedAt) {
      const current = rowsByKey.get(webhookKey);
      if (!current) return null;
      return this.upsertLineBinding({ ...current, lastWebhookObservedAt: observedAt });
    },
    recordValidLineWebhook(propertyId, observedAt) {
      const current = rowsByProperty.get(propertyId);
      if (!current || !current.enabled) return null;
      return this.upsertLineBinding({ ...current, lastValidWebhookAt: observedAt });
    }
  };
}

function planParking(sourceEvent = {}) {
  const sourceText = String(sourceEvent.messageText || "Parking?");
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{
      candidateIndex: 0,
      taskId: "parking",
      type: "amenity",
      sourceText,
      detailIntent: "general",
      requestedOutputs: ["answer"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: { category: "amenity", rawText: "parking", canonicalCandidate: "parking", confidence: 0.99 },
      confidence: 0.99
    }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: String(sourceEvent.eventId || ""), startOffset: 0, endOffset: sourceText.length, quote: sourceText }] }],
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
  const plannerStates = [];
  const replies = [];
  const transportDiagnostics = [];
  const scenarioResults = new Map();
  const finalResponseOverrides = new Map([
    ["property-transport-no-reply", { action: "no_reply", shouldReply: false, replyText: " \t " }],
    ["property-transport-blank", { action: "reply", shouldReply: true, replyText: " \t " }]
  ]);
  const app = createApp({
    providers,
    adminAuthRequired: true,
    lineBindingEnv: { JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY: encryptionKey },
    conversationDebounceMs: 1,
    conversationPlannerV2: { classify: async ({ catalog, sourceEvents }) => { plannerProperties.push(catalog.propertyId); return planParking(sourceEvents[0]); } },
    testOnlyTransportDiagnostic: (entry) => transportDiagnostics.push(entry),
    lineReplyClientFactory: ({ channelAccessToken }) => ({ replyMessageWithHttpInfo: async (body) => { replies.push({ channelAccessToken, body }); return { httpResponse: { status: 200 } }; } })
  });
  const processEngine = app.conversationEngineV2.process.bind(app.conversationEngineV2);
  app.conversationEngineV2.process = async (input) => {
    const result = await processEngine(input);
    const override = finalResponseOverrides.get(input.eventId);
    if (override) result.finalResponse = { ...result.finalResponse, ...override };
    scenarioResults.set(input.eventId, result);
    return result;
  };
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
    assert.ok(bindingService.status("property_a").lastWebhookObservedAt, "every admitted webhook must record its receipt time");
    assert.ok(bindingService.status("property_a").lastValidWebhookAt, "a valid enabled production webhook must record its valid receipt time");
    assert.deepEqual(plannerProperties, ["property_a", "property_b"]);
    assert.deepEqual(replies.map((item) => item.channelAccessToken).sort(), [tokenA, tokenB].sort());
    assert.match(replies.find((item) => item.channelAccessToken === tokenA).body.messages[0].text, /Parking A/);
    assert.match(replies.find((item) => item.channelAccessToken === tokenB).body.messages[0].text, /Parking B/);

    const statePayload = (id, text) => JSON.stringify({ events: [{ type: "message", webhookEventId: id, replyToken: `reply-${id}`, timestamp: 2, source: { userId: "same-user" }, message: { type: "text", id: `message-${id}`, text } }] });
    const stateA = statePayload("state-a", "remember-binding-a");
    assert.equal((await post(running.url, `/api/line/webhooks/${bindingA.webhookKey}`, stateA, signed(secretA, stateA))).status, 200);
    await waitFor(() => replies.length === 3);
    const stateB = statePayload("state-b", "read-binding-b");
    assert.equal((await post(running.url, `/api/line/webhooks/${bindingB.webhookKey}`, stateB, signed(secretB, stateB))).status, 200);
    await waitFor(() => replies.length === 4);
    const stateARead = statePayload("state-a-read", "read-binding-a");
    assert.equal((await post(running.url, `/api/line/webhooks/${bindingA.webhookKey}`, stateARead, signed(secretA, stateARead))).status, 200);
    await waitFor(() => replies.length === 5);
    const bindingChannel = (binding) => `line-binding:${crypto.createHash("sha256").update(binding.webhookKey).digest("hex").slice(0, 24)}`;
    const storedA = providers.persistence.getConversationState("property_a", bindingChannel(bindingA), "same-user");
    const storedB = providers.persistence.getConversationState("property_b", bindingChannel(bindingB), "same-user");
    assert.notEqual(JSON.stringify(storedA), JSON.stringify(storedB), "Binding A and B must persist independent state for the shared LINE user");

    const transportEvent = (id) => JSON.stringify({ events: [{ type: "message", webhookEventId: id, replyToken: `reply-${id}`, timestamp: 3, source: { userId: `user-${id}` }, message: { type: "text", id: `message-${id}`, text: "Parking?" } }] });
    const findTransportRecord = (eventId) => providers.persistence.listMessageLogs("property_a").find((entry) => entry.eventId === eventId);
    const normalEventId = "property-transport-normal";
    const normalPayload = transportEvent(normalEventId);
    const repliesBeforeTransportMatrix = replies.length;
    assert.equal((await post(running.url, `/api/line/webhooks/${bindingA.webhookKey}`, normalPayload, signed(secretA, normalPayload))).status, 200);
    await waitFor(() => findTransportRecord(normalEventId) && findTransportRecord(normalEventId).processingStatus === "reply_succeeded");
    assert.equal(scenarioResults.get(normalEventId).finalResponse.shouldReply, true);
    assert.notEqual(scenarioResults.get(normalEventId).finalResponse.replyText.trim(), "");
    assert.equal(replies.length, repliesBeforeTransportMatrix + 1);
    assert.equal(replies.at(-1).body.messages[0].text, scenarioResults.get(normalEventId).finalResponse.replyText);
    assert.equal(findTransportRecord(normalEventId).replyDelivered, true);

    const noReplyEventId = "property-transport-no-reply";
    const noReplyPayload = transportEvent(noReplyEventId);
    const repliesBeforeNoReply = replies.length;
    assert.equal((await post(running.url, `/api/line/webhooks/${bindingA.webhookKey}`, noReplyPayload, signed(secretA, noReplyPayload))).status, 200);
    await waitFor(() => findTransportRecord(noReplyEventId) && findTransportRecord(noReplyEventId).processingStatus !== "processing");
    assert.equal(replies.length, repliesBeforeNoReply);
    assert.deepEqual(Object.fromEntries(["processingStatus", "shouldReply", "noReply"].map((key) => [key, findTransportRecord(noReplyEventId)[key]])), {
      processingStatus: "no_reply", shouldReply: false, noReply: true
    });

    const blankEventId = "property-transport-blank";
    const blankPayload = transportEvent(blankEventId);
    const repliesBeforeBlank = replies.length;
    assert.equal((await post(running.url, `/api/line/webhooks/${bindingA.webhookKey}`, blankPayload, signed(secretA, blankPayload))).status, 200);
    await waitFor(() => findTransportRecord(blankEventId) && findTransportRecord(blankEventId).processingStatus !== "processing");
    const blankRecord = findTransportRecord(blankEventId);
    assert.equal(replies.length, repliesBeforeBlank, "a blank FinalResponse must not call the property LINE reply API");
    assert.equal(blankRecord.processingStatus, "final_response_contract_failed");
    assert.equal(blankRecord.needsReview, true);
    assert.equal(blankRecord.replyDelivered, false);
    assert.equal(blankRecord.noReply, false);
    assert.equal(blankRecord.deliveryErrorCode, "final_response_empty_reply");
    const blankDiagnostic = transportDiagnostics.find((entry) => entry.traceId === scenarioResults.get(blankEventId).traceId && entry.reasonCode === "final_response_empty_reply");
    assert.deepEqual(blankDiagnostic, { traceId: scenarioResults.get(blankEventId).traceId, propertyId: "property_a", stage: "line_transport", decision: "reply", reasonCode: "final_response_empty_reply", attempted: false, delivered: false });

    const callsBeforeFailures = plannerProperties.length;
    const bindingBWebhookBeforeRejectedRequests = bindingService.status("property_b").lastValidWebhookAt;
    assert.equal((await post(running.url, `/api/line/webhooks/${bindingB.webhookKey}`, payloadA, signed(secretA, payloadA))).status, 401);
    assert.equal((await post(running.url, "/api/line/webhooks/unknown-binding-key", payloadA, signed(secretA, payloadA))).status, 404);
    bindingService.setEnabled("property_b", false);
    assert.equal((await post(running.url, `/api/line/webhooks/${bindingB.webhookKey}`, payloadB, signed(secretB, payloadB))).status, 404);
    assert.equal(plannerProperties.length, callsBeforeFailures);
    assert.equal(bindingService.status("property_b").lastValidWebhookAt, bindingBWebhookBeforeRejectedRequests, "invalid or disabled requests must not update valid webhook receipt time");

    const unauthenticated = await fetch(`${running.url}/api/admin/line-bindings/property_a`);
    assert.equal(unauthenticated.status, 401);
    const propertyAdmin = await fetch(`${running.url}/api/admin/line-bindings/property_a`, { headers: { cookie: "nephi_admin_session=property-admin-session" } });
    assert.equal(propertyAdmin.status, 401);
    const authenticated = await fetch(`${running.url}/api/admin/line-bindings/property_a`, { headers: { cookie: "nephi_admin_session=platform-session" } });
    assert.equal(authenticated.status, 200);
    const statusBody = await authenticated.json();
    assert.deepEqual(Object.keys(statusBody.data).sort(), ["enabled", "hasChannelAccessToken", "hasChannelSecret", "lastWebhookObservedAt", "lastValidWebhookAt", "propertyId", "webhookKey"].sort());
    assert.doesNotMatch(JSON.stringify(statusBody), new RegExp([secretA, tokenA].join("|")));
    const blankUpdate = await fetch(`${running.url}/api/admin/line-bindings/property_a`, { method: "PUT", headers: { cookie: "nephi_admin_session=platform-session", "content-type": "application/json" }, body: JSON.stringify({ channelSecret: "", channelAccessToken: "" }) });
    assert.equal(blankUpdate.status, 200, "blank update fields must preserve existing credentials");
    assert.equal((await blankUpdate.json()).data.webhookKey, bindingA.webhookKey);
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
