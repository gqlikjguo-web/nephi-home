"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { runtimeConfig } = require(path.join(PILOT_ROOT, "config/runtime"));
const { createApp } = require(path.join(PILOT_ROOT, "server"));

function decision() {
  return {
    intent: "checkin_rule",
    route: "auto_reply_allowed",
    confidence: 0.99,
    reason: "checkin_time_question",
    extractedFields: {},
    missingFields: [],
    shouldIgnore: false,
    needsHuman: false
  };
}

class DelayedClassifier {
  async classify() {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return decision();
  }
}

(async () => {
  assert.equal(runtimeConfig({}).classifierTimeoutMs, 15000);
  assert.equal(runtimeConfig({ NEPHI_PILOT_CLASSIFIER_TIMEOUT_MS: "23000" }).classifierTimeoutMs, 23000);
  assert.equal(runtimeConfig({ NEPHI_PILOT_CLASSIFIER_TIMEOUT_MS: "invalid" }).classifierTimeoutMs, 15000);
  assert.equal(runtimeConfig({ NEPHI_PILOT_CLASSIFIER_TIMEOUT_MS: "0" }).classifierTimeoutMs, 15000);
  assert.equal(runtimeConfig({ NEPHI_PILOT_CLASSIFIER_TIMEOUT_MS: "-1" }).classifierTimeoutMs, 15000);

  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-timeout-"));
  const dataFile = path.join(tempDir, "store.json");
  const seedFile = path.join(PILOT_ROOT, "fixtures/seed.json");
  let app;
  try {
    app = createApp({
      dataFile,
      seedFile,
      structuredClassifier: new DelayedClassifier(),
      classifierTimeoutMs: 5,
      conversationDebounceMs: 1,
      testLineSecret: "timeout-test-secret"
    });
    const running = await app.start(0, "127.0.0.1");
    const response = await fetch(`${running.url}/api/test-line/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-line-secret": "timeout-test-secret" },
      body: JSON.stringify({
        customerId: "demo_homestay_a",
        channelId: "timeout-test-channel",
        lineUserId: "U_timeout_test",
        eventId: "timeout-fail-closed-event",
        messageText: "請問幾點入住？"
      })
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).data;
    assert.equal(result.humanHandoff, true);
    assert.equal(result.needsReview, true);
    assert.equal(result.detectedIntent, "unknown");
    const log = app.providers.persistence.findMessageByEventId("demo_homestay_a", "timeout-fail-closed-event");
    assert.equal(log.decisionReason, "classifier_timeout");
    assert.equal(log.route, "human_handoff_required");
    assert.equal(log.needsReview, true);
    assert.equal(log.status, "pending");
  } finally {
    if (app) await app.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 10, passCount: 10, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
