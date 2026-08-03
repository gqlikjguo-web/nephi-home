"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const {
  CustomerSettingsProvider,
  AvailabilityProvider,
  PersistenceProvider,
  StructuredClassifierProvider
} = require(path.join(PILOT_ROOT, "lib/providers/contracts"));
const { createJsonProviders } = require(path.join(PILOT_ROOT, "lib/providers/json-providers"));
const { createMvpService } = require(path.join(PILOT_ROOT, "lib/mvp-service"));
const { runtimeConfig } = require(path.join(PILOT_ROOT, "config/runtime"));

(async () => {
  assert.equal(typeof CustomerSettingsProvider, "function");
  assert.equal(typeof AvailabilityProvider, "function");
  assert.equal(typeof PersistenceProvider, "function");
  assert.equal(typeof StructuredClassifierProvider, "function");
  assert.equal(runtimeConfig({}).dataFile, path.join(PILOT_ROOT, ".runtime", "store.json"));

  for (const relativePath of ["lib/mvp-service.js", "lib/conversation-coordinator.js"]) {
    const source = fs.readFileSync(path.join(PILOT_ROOT, relativePath), "utf8");
    assert.doesNotMatch(source, /JsonFileRepository|seed\.json|json-repository/);
  }
  const serverSource = fs.readFileSync(path.join(PILOT_ROOT, "server.js"), "utf8");
  assert.equal(fs.existsSync(path.join(PILOT_ROOT, "lib/test-line-webhook.js")), false);
  assert.doesNotMatch(serverSource, /TEST_LINE_WEBHOOK_ROUTE|\/api\/test-line\/webhook|\blineWebhookHandler\b|legacy runtime kept|pushToTestLine/);
  assert.equal(serverSource.includes("const sharedLineWebhookMatch = /^\\/api\\/line\\/webhooks\\/"), true);
  assert.doesNotMatch(serverSource, /JsonFileRepository/);
  assert.doesNotMatch(serverSource, /classifyTestLineText/);

  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-pilot-contract-"));
  try {
    const providers = createJsonProviders({
      dataFile: path.join(tempDir, "store.json"),
      seedFile: path.join(PILOT_ROOT, "fixtures/seed.json"),
      now: () => new Date("2026-07-12T00:00:00.000Z")
    });

    assert.ok(providers.customerSettings instanceof CustomerSettingsProvider);
    assert.ok(providers.availability instanceof AvailabilityProvider);
    assert.ok(providers.persistence instanceof PersistenceProvider);
    assert.equal(typeof providers.persistence.claimMessageEvent, "function");
    assert.equal(typeof providers.persistence.updateMessageEvent, "function");

    const properties = providers.customerSettings.listProperties();
    assert.equal(properties.length, 2);
    assert.ok(properties.every((item) => item.propertyId && item.displayName));
    assert.ok(properties.every((item) => !Object.hasOwn(item, "customerId")));

    const service = createMvpService(providers, { now: () => new Date("2026-07-12T00:00:00.000Z") });
    service.writeMessage({
      customerId: "demo_homestay_a",
      channelId: "contract-test",
      eventId: "contract-review-event",
      guestMessage: "contract review fixture",
      detectedIntent: "special_request",
      humanHandoff: true,
      needsReview: true
    });
    const reviews = service.listReviews("demo_homestay_a", "pending");
    assert.ok(reviews.length > 0);
    assert.ok(reviews.every((item) => item.reviewReason && Array.isArray(item.availableActions)));
    assert.ok(reviews.every((item) => !Object.hasOwn(item, "detectedIntent") && !Object.hasOwn(item, "customerId")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 7, passCount: 7, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
