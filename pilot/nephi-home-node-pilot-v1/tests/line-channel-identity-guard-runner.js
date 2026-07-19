"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { runtimeConfig } = require("../config/runtime");
const {
  validateLineChannelConfiguration,
  validateLineWebhookDestination
} = require("../lib/line-channel-identity-guard");

const TEST_ROUTE = "/api/test-line/webhook";
const PRODUCTION_ROUTE = "/api/line/webhook";
const TEST_SECRET = "test-channel-secret";
const TEST_CHANNEL_ID = "2010000000";
const TEST_DESTINATION_ID = "U0123456789abcdef0123456789abcdef";
const secretSha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function configuration(overrides = {}) {
  return {
    environment: "test-only",
    channelId: TEST_CHANNEL_ID,
    destinationId: TEST_DESTINATION_ID,
    webhookRoute: TEST_ROUTE,
    channelSecret: TEST_SECRET,
    channelSecretSha256: secretSha256(TEST_SECRET),
    channelAccessToken: "test-channel-access-token",
    actualWebhookRoute: TEST_ROUTE,
    ...overrides
  };
}

function productionConfiguration(overrides = {}) {
  return configuration({
    environment: "production",
    webhookRoute: PRODUCTION_ROUTE,
    actualWebhookRoute: PRODUCTION_ROUTE,
    ...overrides
  });
}

async function postWebhook(url, destination, events = []) {
  const rawBody = JSON.stringify({ destination, events });
  const signature = crypto.createHmac("sha256", TEST_SECRET).update(rawBody).digest("base64");
  const response = await fetch(`${url}${TEST_ROUTE}?customerId=demo_homestay_a`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": signature },
    body: rawBody
  });
  return { status: response.status, body: await response.json() };
}

function rejects(code, input) {
  assert.throws(
    () => validateLineChannelConfiguration(input),
    (error) => error && error.code === code,
    `expected ${code}`
  );
}

async function main() {
  const minimalTestOnlyIdentity = validateLineChannelConfiguration({
    environment: "test-only",
    webhookRoute: TEST_ROUTE,
    actualWebhookRoute: TEST_ROUTE,
    channelSecret: TEST_SECRET,
    channelAccessToken: "test-channel-access-token"
  });
  assert.deepEqual(minimalTestOnlyIdentity, {
    environment: "test-only",
    channelId: "",
    destinationId: "",
    webhookRoute: TEST_ROUTE
  });
  const staleTestOnlyIdentity = validateLineChannelConfiguration({
    environment: "test-only",
    webhookRoute: TEST_ROUTE,
    actualWebhookRoute: TEST_ROUTE,
    channelSecret: TEST_SECRET,
    channelSecretSha256: "0".repeat(64),
    channelAccessToken: "test-channel-access-token"
  });
  assert.deepEqual(staleTestOnlyIdentity, minimalTestOnlyIdentity);

  rejects("LINE_ENVIRONMENT_ROUTE_MISMATCH", configuration({
    environment: "production",
    channelId: "production-channel-id"
  }));

  rejects("LINE_ENVIRONMENT_ROUTE_MISMATCH", configuration({
    webhookRoute: PRODUCTION_ROUTE,
    actualWebhookRoute: PRODUCTION_ROUTE
  }));

  rejects("LINE_CHANNEL_SECRET_IDENTITY_MISMATCH", productionConfiguration({
    channelSecret: "different-secret"
  }));

  const identity = validateLineChannelConfiguration(configuration());
  assert.deepEqual(identity, {
    environment: "test-only",
    channelId: TEST_CHANNEL_ID,
    destinationId: TEST_DESTINATION_ID,
    webhookRoute: TEST_ROUTE
  });

  assert.doesNotThrow(() => validateLineWebhookDestination(identity, TEST_DESTINATION_ID));
  assert.throws(
    () => validateLineWebhookDestination(identity, "Uwrongdestinationidentity"),
    (error) => error && error.code === "LINE_CHANNEL_IDENTITY_MISMATCH" && error.status === 400
  );
  assert.throws(
    () => validateLineWebhookDestination(identity, TEST_CHANNEL_ID),
    (error) => error && error.code === "LINE_CHANNEL_IDENTITY_MISMATCH",
    "numeric Channel ID must not be accepted as webhook destination identity"
  );

  rejects("LINE_CHANNEL_IDENTITY_INCOMPLETE", productionConfiguration({ channelId: "" }));
  rejects("LINE_CHANNEL_IDENTITY_INCOMPLETE", productionConfiguration({ destinationId: "" }));
  rejects("LINE_DESTINATION_ID_INVALID", productionConfiguration({ destinationId: TEST_CHANNEL_ID }));
  rejects("LINE_CHANNEL_IDENTITY_INCOMPLETE", productionConfiguration({ channelSecretSha256: "" }));
  assert.throws(
    () => validateLineChannelConfiguration(configuration({ environment: "" })),
    (error) => error && error.code === "LINE_CHANNEL_IDENTITY_INCOMPLETE" &&
      Array.isArray(error.invalidFields) && error.invalidFields.includes("environment") &&
      error.message.includes("environment"),
    "incomplete configuration must name the invalid non-secret field without exposing values"
  );

  assert.equal(runtimeConfig({ NEPHI_PILOT_LINE_DESTINATION_ID: TEST_DESTINATION_ID }).lineDestinationId, TEST_DESTINATION_ID);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-identity-guard-"));
  const appOptions = {
    dataFile: path.join(temp, "store.json"),
    seedFile: path.resolve(__dirname, "../fixtures/seed.json"),
    structuredClassifier: null,
    lineChannelSecret: TEST_SECRET,
    lineChannelAccessToken: "test-channel-access-token",
    conversationDebounceMs: 5,
    lineReplyClientFactory: () => ({
      replyMessageWithHttpInfo: async () => { const error = new Error("test reply rejection"); error.status = 400; throw error; },
      pushMessageWithHttpInfo: async () => { const error = new Error("test push rejection"); error.status = 400; throw error; }
    }),
    lineChannelIdentityGuardRequired: true
  };
  const invalidApp = createApp({
    ...appOptions,
    lineChannelIdentity: configuration({ environment: "production" })
  });
  assert.throws(
    () => invalidApp.start(0, "127.0.0.1"),
    (error) => error && error.code === "LINE_ENVIRONMENT_ROUTE_MISMATCH"
  );
  await invalidApp.stop();

  const validApp = createApp({ ...appOptions, lineChannelIdentity: configuration() });
  const running = await validApp.start(0, "127.0.0.1");
  assert.match(running.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const invalidSignature = await fetch(`${running.url}${TEST_ROUTE}?customerId=demo_homestay_a`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": "invalid" },
    body: JSON.stringify({ destination: TEST_DESTINATION_ID, events: [] })
  });
  assert.equal(invalidSignature.status, 401);
  assert.equal((await invalidSignature.json()).error.code, "INVALID_LINE_SIGNATURE");
  const mismatch = await postWebhook(running.url, "Uwrongdestinationidentity");
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.error.code, "LINE_CHANNEL_IDENTITY_MISMATCH");

  const eventId = `identity-pass-${Date.now()}`;
  const accepted = await postWebhook(running.url, TEST_DESTINATION_ID, [{
    type: "message",
    webhookEventId: eventId,
    timestamp: Date.now(),
    replyToken: "test-reply-token",
    source: { type: "user", userId: "Utestuser" },
    message: { id: "test-message-id", type: "text", text: "test message" }
  }]);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.accepted, true);
  assert.ok(validApp.providers.persistence.findMessageByEventId("demo_homestay_a", eventId), "webhook should enter the coordinator after guard validation");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const failedReply = validApp.providers.persistence.findMessageByEventId("demo_homestay_a", eventId);
  assert.equal(failedReply.deliveryErrorCode, "line_reply_http_error_400");
  await validApp.stop();

  const missingCredentialsApp = createApp({
    ...appOptions,
    lineChannelSecret: "",
    lineChannelAccessToken: "",
    lineChannelIdentityGuardRequired: false,
    lineChannelIdentity: configuration()
  });
  const missingCredentialsRunning = await missingCredentialsApp.start(0, "127.0.0.1");
  const missingCredentials = await postWebhook(missingCredentialsRunning.url, TEST_DESTINATION_ID);
  assert.equal(missingCredentials.status, 503);
  assert.equal(missingCredentials.body.error.code, "TEST_LINE_WEBHOOK_NOT_CONFIGURED");
  await missingCredentialsApp.stop();
  fs.rmSync(temp, { recursive: true, force: true });

  console.log(JSON.stringify({ caseCount: 23, passCount: 23, failCount: 0 }));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
