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
  rejects("LINE_ENVIRONMENT_ROUTE_MISMATCH", configuration({
    environment: "production",
    channelId: "production-channel-id"
  }));

  rejects("LINE_ENVIRONMENT_ROUTE_MISMATCH", configuration({
    webhookRoute: PRODUCTION_ROUTE,
    actualWebhookRoute: PRODUCTION_ROUTE
  }));

  rejects("LINE_CHANNEL_SECRET_IDENTITY_MISMATCH", configuration({
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

  rejects("LINE_CHANNEL_IDENTITY_INCOMPLETE", configuration({ channelId: "" }));
  rejects("LINE_CHANNEL_IDENTITY_INCOMPLETE", configuration({ destinationId: "" }));
  rejects("LINE_DESTINATION_ID_INVALID", configuration({ destinationId: TEST_CHANNEL_ID }));
  rejects("LINE_CHANNEL_IDENTITY_INCOMPLETE", configuration({ channelSecretSha256: "" }));
  assert.throws(
    () => validateLineChannelConfiguration(configuration({ environment: "" })),
    (error) => error && error.code === "LINE_CHANNEL_IDENTITY_INCOMPLETE" &&
      Array.isArray(error.invalidFields) && error.invalidFields.includes("environment"),
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
    lineReplyFetch: async () => ({ ok: true, status: 200, text: async () => "{}" }),
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
  await validApp.stop();
  fs.rmSync(temp, { recursive: true, force: true });

  console.log(JSON.stringify({ caseCount: 19, passCount: 19, failCount: 0 }));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
