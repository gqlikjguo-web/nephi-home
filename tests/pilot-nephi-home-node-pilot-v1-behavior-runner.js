"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createApp } = require("../pilot/nephi-home-node-pilot-v1/server");
const { ConversationCoordinator } = require("../pilot/nephi-home-node-pilot-v1/lib/conversation-coordinator");
const { createJsonProviders } = require("../pilot/nephi-home-node-pilot-v1/lib/providers/json-providers");
const { createMvpService } = require("../pilot/nephi-home-node-pilot-v1/lib/mvp-service");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const SECRET = "pilot-test-channel-secret";
const TOKEN = "pilot-test-channel-token";

function lineEvent(id, replyToken, userId, text) {
  return {
    type: "message", webhookEventId: id, timestamp: Date.now(), replyToken,
    source: { type: "user", userId },
    message: { id: `message-${id}`, type: "text", text }
  };
}

async function sendLine(url, customerId, event) {
  const raw = JSON.stringify({ destination: "pilot-test", events: [event] });
  const signature = crypto.createHmac("sha256", SECRET).update(raw).digest("base64");
  const suffix = customerId === undefined ? "" : `?customerId=${encodeURIComponent(customerId)}`;
  const response = await fetch(`${url}/api/test-line/webhook${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": signature },
    body: raw
  });
  return { status: response.status, payload: await response.json() };
}

function createCoordinatorHarness() {
  let timerId = 0;
  const timers = new Map();
  const states = new Map();
  const resolved = [];
  const persistence = {
    getConversationState(propertyId, channelId, lineUserId) { return states.get(`${propertyId}:${channelId}:${lineUserId}`) || null; },
    setConversationState(propertyId, channelId, lineUserId, state) { states.set(`${propertyId}:${channelId}:${lineUserId}`, structuredClone(state)); },
    deleteConversationState(propertyId, channelId, lineUserId) { states.delete(`${propertyId}:${channelId}:${lineUserId}`); },
    listRecentMessages() { return []; }
  };
  const coordinator = new ConversationCoordinator({
    persistence,
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    debounceMs: 2000,
    schedule(callback) { timerId += 1; timers.set(timerId, callback); return timerId; },
    cancel(id) { timers.delete(id); },
    decisionPipeline: {
      async decide(input) {
        const hasDate = input.currentMessages.includes("7/19");
        return {
          intent: "availability_missing_date",
          route: "clarification_needed",
          confidence: 0.96,
          reason: "deterministic_test_decision",
          extractedFields: hasDate ? { checkInDate: "2026-07-19" } : {},
          missingFields: hasDate ? [] : ["checkInDate"],
          shouldIgnore: false,
          needsHuman: false
        };
      }
    },
    async resolveMerged(input) { resolved.push(input); return { replyText: "固定回覆", needsReview: false }; }
  });
  return {
    coordinator, states, resolved,
    async flush() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) await callback();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

function message(overrides = {}) {
  return {
    customerId: "demo_homestay_a", channelId: "pilot-channel", lineUserId: "pilot-user", eventId: "event-1",
    replyToken: "token-1", messageText: "有空房嗎",
    route: { intent: "availability_missing_date", extractedFields: {}, confidence: 0.95, route: "clarification_needed", reason: "missing date" },
    ...overrides
  };
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-pilot-behavior-"));
  const dataFile = path.join(tempDir, "pilot-store.json");
  const seedFile = path.join(PILOT_ROOT, "fixtures/seed.json");
  const providers = createJsonProviders({ dataFile, seedFile, now: () => new Date("2026-07-12T00:00:00.000Z") });
  const replies = [];
  const app = createApp({
    providers,
    lineChannelSecret: SECRET,
    lineChannelAccessToken: TOKEN,
    conversationDebounceMs: 80,
    lineReplyFetch: async (url, options) => {
      replies.push({ url, options });
      return { ok: true, status: 200, text: async () => "{}" };
    }
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    const missing = await sendLine(running.url, undefined, lineEvent("missing", "missing-token", "U_missing", "有空房嗎"));
    const unknown = await sendLine(running.url, "unknown", lineEvent("unknown", "unknown-token", "U_unknown", "有空房嗎"));
    assert.equal(missing.status, 400);
    assert.equal(missing.payload.error.code, "MISSING_CUSTOMER_ID");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.error.code, "UNKNOWN_CUSTOMER_ID");

    await Promise.all([
      sendLine(running.url, "demo_homestay_a", lineEvent("burst-1", "burst-token-1", "U_burst", "有空房嗎")),
      sendLine(running.url, "demo_homestay_a", lineEvent("burst-2", "burst-token-2", "U_burst", "7/19")),
      sendLine(running.url, "demo_homestay_a", lineEvent("burst-3", "burst-token-3", "U_burst", "六個人"))
    ]);
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal(replies.length, 1);
    assert.equal(JSON.parse(replies[0].options.body).replyToken, "burst-token-3");
    const log = providers.persistence.findMessageByEventId("demo_homestay_a", "burst-3");
    assert.equal(log.guestMessage, "有空房嗎\n7/19\n六個人");

    const h = createCoordinatorHarness();
    const first = h.coordinator.enqueue(message());
    await h.flush();
    await first;
    const second = h.coordinator.enqueue(message({
      eventId: "event-2", replyToken: "token-2", messageText: "7/19",
      route: { intent: "date_fragment", extractedFields: { checkInDate: "2026-07-19" }, confidence: 0.96, route: "clarification_needed", reason: "date supplied" }
    }));
    await h.flush();
    await second;
    assert.equal(h.resolved[1].route.intent, "availability_missing_date");
    assert.equal(h.resolved[1].route.extractedFields.checkInDate, "2026-07-19");

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let resolving = 0;
    let firstStarted;
    const started = new Promise((resolve) => { firstStarted = resolve; });
    const race = createCoordinatorHarness();
    race.coordinator.resolveMerged = async (input) => {
      race.resolved.push(input);
      resolving += 1;
      if (resolving === 1) { firstStarted(); await gate; }
      return { replyText: "固定回覆", needsReview: false };
    };
    const oldPrompt = race.coordinator.enqueue(message({ eventId: "race-1", replyToken: "race-token-1" }));
    const oldFlush = race.flush();
    await started;
    const date = race.coordinator.enqueue(message({ eventId: "race-2", replyToken: "race-token-2", messageText: "7/19", route: { intent: "date_fragment", extractedFields: { checkInDate: "2026-07-19" }, confidence: 0.96, route: "clarification_needed", reason: "date" } }));
    release();
    await oldFlush;
    await race.flush();
    const raceResults = await Promise.all([oldPrompt, date]);
    assert.equal(raceResults.filter((item) => item.shouldReply).length, 1);
    assert.equal(raceResults[1].replyToken, "race-token-2");

    providers.availability.setDay("demo_homestay_a", "2026-07-20", "room301", "closed");
    assert.equal(providers.availability.getRows("demo_homestay_a", "2026-07-20", "2026-07-21")[0].room301, "closed");
    assert.equal(providers.availability.getRows("demo_homestay_b", "2026-07-20", "2026-07-21")[0].room301, "available");

    const route = {
      intent: "parking",
      route: "auto_reply_allowed",
      confidence: 0.95,
      reason: "deterministic_test_decision",
      extractedFields: {}
    };
    assert.deepEqual(Object.keys(route).sort(), ["confidence", "extractedFields", "intent", "reason", "route"]);
    const service = createMvpService(providers, { now: () => new Date("2026-07-12T00:00:00.000Z") });
    const safeReply = service.writeMessage({
      customerId: "demo_homestay_a", eventId: "no-freeform", lineUserId: "U_safe",
      guestMessage: "停車方便嗎？", detectedIntent: "parking_basic", replyType: "fixed_reply",
      suggested_reply: "這段 AI 自由文案不得出現"
    });
    assert.doesNotMatch(safeReply.replyText, /AI 自由文案/);
  } finally {
    await app.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const restartDir = fs.mkdtempSync(path.join(__dirname, ".tmp-pilot-restart-duplicate-"));
  const restartDataFile = path.join(restartDir, "pilot-store.json");
  const restartReplies = [];
  const restartOptions = {
    dataFile: restartDataFile,
    seedFile,
    testLineSecret: "pilot-test-bridge-secret",
    lineChannelSecret: SECRET,
    lineChannelAccessToken: TOKEN,
    conversationDebounceMs: 80,
    lineReplyFetch: async (url, options) => {
      restartReplies.push({ url, options });
      return { ok: true, status: 200, text: async () => "{}" };
    }
  };
  let firstApp = createApp(restartOptions);
  let secondApp;
  try {
    const duplicateEvent = lineEvent("persistent-duplicate-event", "persistent-token-1", "U_persistent", "停車方便嗎？");
    const firstRunning = await firstApp.start(0, "127.0.0.1");
    assert.equal((await sendLine(firstRunning.url, "demo_homestay_a", duplicateEvent)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal(restartReplies.length, 1, "first delivery must call LINE Reply API once");
    await firstApp.stop();

    secondApp = createApp(restartOptions);
    let replayReachedCoordinator = false;
    const enqueuePersisted = secondApp.lineWebhookCoordinator.enqueue.bind(secondApp.lineWebhookCoordinator);
    secondApp.lineWebhookCoordinator.enqueue = (input) => {
      replayReachedCoordinator = true;
      return enqueuePersisted(input);
    };
    const secondRunning = await secondApp.start(0, "127.0.0.1");
    const replayedEvent = lineEvent("persistent-duplicate-event", "persistent-token-2", "U_persistent", "請問停車方便嗎？");
    assert.equal((await sendLine(secondRunning.url, "demo_homestay_a", replayedEvent)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 160));

    assert.equal(restartReplies.length, 1, "persisted duplicate after restart must not call LINE Reply API again");
    assert.equal(replayReachedCoordinator, false, "persisted duplicate must be rejected before semantic processing");

    const restartedProviders = createJsonProviders({ dataFile: restartDataFile, seedFile });
    assert.equal(
      restartedProviders.persistence.listMessageLogs("demo_homestay_a")
        .filter((item) => item.eventId === "persistent-duplicate-event").length,
      1,
      "persisted duplicate must not append Message Log or Review Queue"
    );

    const bridgeResponse = await fetch(`${secondRunning.url}/api/test-line/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-line-secret": "pilot-test-bridge-secret" },
      body: JSON.stringify({
        customerId: "demo_homestay_a", lineUserId: "U_persistent",
        eventId: "persistent-duplicate-event", replyToken: "bridge-duplicate-token",
        messageText: "停車方便嗎？",
        route: {
          intent: "parking",
          route: "auto_reply_allowed",
          confidence: 0.95,
          reason: "deterministic_test_decision",
          extractedFields: {}
        }
      })
    });
    const bridgePayload = await bridgeResponse.json();
    assert.equal(bridgeResponse.status, 200);
    assert.deepEqual(
      {
        duplicate: bridgePayload.data.duplicate,
        shouldReply: bridgePayload.data.shouldReply,
        noReply: bridgePayload.data.noReply,
        replyToken: bridgePayload.data.replyToken
      },
      { duplicate: true, shouldReply: false, noReply: true, replyToken: "" }
    );
  } finally {
    await firstApp.stop();
    if (secondApp) await secondApp.stop();
    fs.rmSync(restartDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 7, passCount: 7, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
