"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { createApp } = require(path.join(PILOT_ROOT, "server"));
const { createJsonProviders } = require(path.join(PILOT_ROOT, "lib/providers/json-providers"));
const { StructuredClassifierProvider } = require(path.join(PILOT_ROOT, "lib/providers/contracts"));

const SECRET = "pilot-event-lifecycle-test-secret";
const TOKEN = "pilot-event-lifecycle-test-token";
const PROPERTY_ID = "demo_homestay_a";
const CHANNEL_ID = "line-channel-lifecycle";

function lineEvent(eventId, replyToken, lineUserId, text) {
  return {
    type: "message",
    webhookEventId: eventId,
    timestamp: Date.now(),
    replyToken,
    source: { type: "user", userId: lineUserId },
    message: { id: `message-${eventId}`, type: "text", text }
  };
}

async function sendLine(url, event) {
  const raw = JSON.stringify({ destination: CHANNEL_ID, events: [event] });
  const signature = crypto.createHmac("sha256", SECRET).update(raw).digest("base64");
  const response = await fetch(`${url}/api/test-line/webhook?customerId=${PROPERTY_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": signature },
    body: raw
  });
  return { status: response.status, payload: await response.json() };
}

async function waitFor(predicate, message, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out: ${message}`);
}

function validDecision(overrides = {}) {
  return {
    intent: "parking",
    route: "auto_reply_allowed",
    confidence: 0.98,
    reason: "deterministic_lifecycle_test",
    extractedFields: {},
    missingFields: [],
    shouldIgnore: false,
    needsHuman: false,
    ...overrides
  };
}

class LifecycleClassifier extends StructuredClassifierProvider {
  constructor() {
    super();
    this.inputs = [];
    this.blocked = new Set();
  }

  async classify(input) {
    this.inputs.push(structuredClone(input));
    if (String(input.currentMessage).startsWith("BLOCK_")) {
      this.blocked.add(input.currentMessage);
      return new Promise(() => {});
    }
    if (input.currentMessage === "SILENT") {
      return validDecision({
        intent: "acknowledgement",
        route: "no_reply_silent_ignore",
        reason: "silent_test",
        shouldIgnore: true
      });
    }
    return validDecision();
  }
}

function appOptions(dataFile, classifier, lineReplyFetch, providers) {
  return {
    dataFile,
    seedFile: path.join(PILOT_ROOT, "fixtures/seed.json"),
    providers,
    structuredClassifier: classifier,
    classifierTimeoutMs: 300,
    conversationDebounceMs: 5,
    lineChannelSecret: SECRET,
    lineChannelAccessToken: TOKEN,
    lineReplyFetch
  };
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-pilot-event-lifecycle-"));
  const seedFile = path.join(PILOT_ROOT, "fixtures/seed.json");
  const apps = [];
  try {
    // 1. A duplicate arriving while the first classifier call is blocked cannot classify again.
    const inFlightFile = path.join(tempDir, "in-flight.json");
    const inFlightProviders = createJsonProviders({ dataFile: inFlightFile, seedFile });
    const inFlightClassifier = new LifecycleClassifier();
    const inFlightOptions = appOptions(inFlightFile, inFlightClassifier, async () => ({ ok: true, status: 200, text: async () => "{}" }), inFlightProviders);
    const inFlightA = createApp(inFlightOptions);
    const inFlightB = createApp(inFlightOptions);
    apps.push(inFlightA, inFlightB);
    const inFlightRunningA = await inFlightA.start(0, "127.0.0.1");
    const inFlightRunningB = await inFlightB.start(0, "127.0.0.1");
    await sendLine(inFlightRunningA.url, lineEvent("claim-in-flight", "reply-a", "U_claim", "BLOCK_IN_FLIGHT"));
    await waitFor(() => inFlightClassifier.inputs.length === 1, "first classifier call to start");
    await sendLine(inFlightRunningB.url, lineEvent("claim-in-flight", "reply-b", "U_claim", "BLOCK_IN_FLIGHT"));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(inFlightClassifier.inputs.length, 1, "duplicate must be rejected by persistence while classifier is running");

    // 2. A restart after claim but before decision cannot classify the event again.
    const restartFile = path.join(tempDir, "restart.json");
    const restartClassifierA = new LifecycleClassifier();
    const restartA = createApp(appOptions(restartFile, restartClassifierA, async () => ({ ok: true, status: 200, text: async () => "{}" })));
    apps.push(restartA);
    const restartRunningA = await restartA.start(0, "127.0.0.1");
    await sendLine(restartRunningA.url, lineEvent("claim-restart", "restart-a", "U_restart", "BLOCK_RESTART"));
    await waitFor(() => restartClassifierA.inputs.length === 1, "restart classifier call to start");
    await restartA.stop();
    const restartClassifierB = new LifecycleClassifier();
    const restartB = createApp(appOptions(restartFile, restartClassifierB, async () => ({ ok: true, status: 200, text: async () => "{}" })));
    apps.push(restartB);
    const restartRunningB = await restartB.start(0, "127.0.0.1");
    await sendLine(restartRunningB.url, lineEvent("claim-restart", "restart-b", "U_restart", "BLOCK_RESTART"));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(restartClassifierB.inputs.length, 0, "persisted processing claim must survive app restart");

    // 3-4. Two app instances racing on one store produce one classifier call and one event record.
    const raceFile = path.join(tempDir, "race.json");
    const raceClassifier = new LifecycleClassifier();
    const raceA = createApp(appOptions(raceFile, raceClassifier, async () => ({ ok: true, status: 200, text: async () => "{}" })));
    const raceB = createApp(appOptions(raceFile, raceClassifier, async () => ({ ok: true, status: 200, text: async () => "{}" })));
    apps.push(raceA, raceB);
    const raceRunningA = await raceA.start(0, "127.0.0.1");
    const raceRunningB = await raceB.start(0, "127.0.0.1");
    await Promise.all([
      sendLine(raceRunningA.url, lineEvent("claim-race", "race-a", "U_race", "PARKING")),
      sendLine(raceRunningB.url, lineEvent("claim-race", "race-b", "U_race", "PARKING"))
    ]);
    await waitFor(() => raceClassifier.inputs.length >= 1, "race classifier call");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(raceClassifier.inputs.length, 1, "atomic claim must allow one classifier call across app instances");
    const raceProviders = createJsonProviders({ dataFile: raceFile, seedFile });
    assert.equal(raceProviders.persistence.listMessageLogs(PROPERTY_ID).filter((item) => item.eventId === "claim-race").length, 1);

    // 5-6. Silent decisions become no_reply; successful delivery becomes reply_succeeded.
    const statusFile = path.join(tempDir, "statuses.json");
    const statusClassifier = new LifecycleClassifier();
    const statusApp = createApp(appOptions(statusFile, statusClassifier, async () => ({ ok: true, status: 200, text: async () => "{}" })));
    apps.push(statusApp);
    const statusRunning = await statusApp.start(0, "127.0.0.1");
    await sendLine(statusRunning.url, lineEvent("status-silent", "silent-token", "U_silent", "SILENT"));
    await waitFor(() => {
      const item = statusApp.providers.persistence.findMessageByEventId(PROPERTY_ID, "status-silent");
      return item && item.processingStatus === "no_reply";
    }, "silent no_reply status");
    await sendLine(statusRunning.url, lineEvent("status-success", "success-token", "U_success", "PARKING"));
    await waitFor(() => {
      const item = statusApp.providers.persistence.findMessageByEventId(PROPERTY_ID, "status-success");
      return item && item.processingStatus === "reply_succeeded";
    }, "reply_succeeded status");
    const successRecord = statusApp.providers.persistence.findMessageByEventId(PROPERTY_ID, "status-success");
    assert.ok(successRecord.replySucceededAt);
    assert.equal(JSON.stringify(successRecord).includes("success-token"), false, "reply token must never be persisted");

    // 7. Non-2xx and exceptions become reply_failed, enter review, and duplicates never re-run AI.
    for (const failure of [
      { id: "status-http-failed", fetch: async () => ({ ok: false, status: 500, text: async () => "external payload" }), code: "line_reply_http_error_500" },
      { id: "status-exception", fetch: async () => { throw new Error("external sensitive exception"); }, code: "line_reply_exception" }
    ]) {
      const failureFile = path.join(tempDir, `${failure.id}.json`);
      const failureClassifier = new LifecycleClassifier();
      const failureApp = createApp(appOptions(failureFile, failureClassifier, failure.fetch));
      apps.push(failureApp);
      const failureRunning = await failureApp.start(0, "127.0.0.1");
      await sendLine(failureRunning.url, lineEvent(failure.id, `${failure.id}-token`, `U_${failure.id}`, "PARKING"));
      await waitFor(() => {
        const item = failureApp.providers.persistence.findMessageByEventId(PROPERTY_ID, failure.id);
        return item && item.processingStatus === "reply_failed";
      }, `${failure.id} reply_failed status`);
      const failedRecord = failureApp.providers.persistence.findMessageByEventId(PROPERTY_ID, failure.id);
      assert.equal(failedRecord.needsReview, true);
      assert.equal(failedRecord.deliveryErrorCode, failure.code);
      assert.equal(JSON.stringify(failedRecord).includes("external payload"), false);
      assert.equal(JSON.stringify(failedRecord).includes("external sensitive exception"), false);
      const callsBeforeDuplicate = failureClassifier.inputs.length;
      await sendLine(failureRunning.url, lineEvent(failure.id, `${failure.id}-duplicate-token`, `U_${failure.id}`, "PARKING"));
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(failureClassifier.inputs.length, callsBeforeDuplicate, "reply failure duplicate must not re-run AI");
      assert.ok(failureApp.service.listReviews(PROPERTY_ID, "pending").some((item) => item.reviewId === failedRecord.reviewId));
    }

    console.log(JSON.stringify({ caseCount: 8, passCount: 8, failCount: 0 }));
  } finally {
    for (const app of apps.reverse()) await app.stop().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
