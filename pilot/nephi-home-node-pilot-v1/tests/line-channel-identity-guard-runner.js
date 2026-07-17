"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const {
  validateLineChannelConfiguration,
  validateLineWebhookDestination
} = require("../lib/line-channel-identity-guard");

const TEST_ROUTE = "/api/test-line/webhook";
const PRODUCTION_ROUTE = "/api/line/webhook";
const TEST_SECRET = "test-channel-secret";
const secretSha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function configuration(overrides = {}) {
  return {
    environment: "test-only",
    channelId: "test-channel-id",
    webhookRoute: TEST_ROUTE,
    channelSecret: TEST_SECRET,
    channelSecretSha256: secretSha256(TEST_SECRET),
    channelAccessToken: "test-channel-access-token",
    actualWebhookRoute: TEST_ROUTE,
    ...overrides
  };
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
    channelId: "test-channel-id",
    webhookRoute: TEST_ROUTE
  });

  assert.doesNotThrow(() => validateLineWebhookDestination(identity, "test-channel-id"));
  assert.throws(
    () => validateLineWebhookDestination(identity, "production-channel-id"),
    (error) => error && error.code === "LINE_CHANNEL_IDENTITY_MISMATCH"
  );

  rejects("LINE_CHANNEL_IDENTITY_INCOMPLETE", configuration({ channelId: "" }));
  rejects("LINE_CHANNEL_IDENTITY_INCOMPLETE", configuration({ channelSecretSha256: "" }));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-identity-guard-"));
  const appOptions = {
    dataFile: path.join(temp, "store.json"),
    seedFile: path.resolve(__dirname, "../fixtures/seed.json"),
    structuredClassifier: null,
    lineChannelSecret: TEST_SECRET,
    lineChannelAccessToken: "test-channel-access-token",
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
  await validApp.stop();
  fs.rmSync(temp, { recursive: true, force: true });

  console.log(JSON.stringify({ caseCount: 10, passCount: 10, failCount: 0 }));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
