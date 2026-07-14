"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { importFriendlyProperty } = require(path.join(PILOT_ROOT, "lib/friendly-property-import"));
const { createJsonProviders } = require(path.join(PILOT_ROOT, "lib/providers/json-providers"));
const { createApp } = require(path.join(PILOT_ROOT, "server"));
const { ConversationCoordinator } = require(path.join(PILOT_ROOT, "lib/conversation-coordinator"));

const SECRET = "trailing-flush-test-secret";
const CHANNEL = "trailing-flush-channel";
const USER = "U_trailing_flush";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function availabilityDecision(fields, missingFields = []) {
  return {
    intent: "availability",
    route: missingFields.length ? "clarification_needed" : "auto_reply_allowed",
    confidence: 0.99,
    reason: "availability_test_decision",
    extractedFields: fields,
    missingFields,
    shouldIgnore: false,
    needsHuman: false
  };
}

class SlowTrailingClassifier {
  constructor() {
    this.calls = [];
  }

  async classify(input) {
    const messages = [...input.currentMessages];
    this.calls.push(messages);
    await delay(70);
    if (messages.length === 1) {
      return availabilityDecision({}, ["checkInDate", "nights", "guestCount", "roomType"]);
    }
    return availabilityDecision({
      checkInDate: "2026-07-25",
      nights: 2,
      guestCount: 2,
      roomType: "301"
    });
  }
}

async function resolve(url, eventId, messageText) {
  const response = await fetch(`${url}/api/test-line/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-line-secret": SECRET },
    body: JSON.stringify({
      customerId: "nephi_home",
      channelId: CHANNEL,
      lineUserId: USER,
      eventId,
      messageText
    })
  });
  const body = await response.json();
  if (response.status !== 200) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body.data;
}

(async () => {
  const diagnostics = [];
  const diagnosticCoordinator = new ConversationCoordinator({
    persistence: {
      getConversationState: () => null,
      listRecentMessages: () => []
    },
    debounceMs: 1,
    decisionPipeline: {
      decide: async () => availabilityDecision({})
    },
    getProperty: () => ({ rooms: [] }),
    resolveMerged: async () => {
      const error = new Error("diagnostic-probe");
      error.name = "DiagnosticProbeError";
      throw error;
    },
    onDiagnostic: (entry) => diagnostics.push(entry)
  });
  await assert.rejects(diagnosticCoordinator.enqueue({
    customerId: "nephi_home",
    channelId: CHANNEL,
    lineUserId: USER,
    eventId: "diagnostic-event",
    messageText: "probe"
  }), /diagnostic-probe/);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].stage, "resolve_merged");
  assert.equal(diagnostics[0].exceptionName, "DiagnosticProbeError");
  assert.equal(diagnostics[0].exceptionMessage, "diagnostic-probe");
  assert.match(diagnostics[0].stackTrace, /diagnostic-probe/);
  assert.equal(diagnostics[0].eventId, "diagnostic-event");
  assert.equal(diagnostics[0].propertyId, "nephi_home");
  assert.equal(diagnostics[0].channelId, CHANNEL);
  assert.equal(Object.hasOwn(diagnostics[0], "lineUserId"), false);

  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-trailing-flush-"));
  const dataFile = path.join(tempDir, "store.json");
  const seedFile = path.join(PILOT_ROOT, "fixtures/seed.json");
  const now = () => new Date();
  let app;
  try {
    const property = JSON.parse(fs.readFileSync(path.join(PILOT_ROOT, "fixtures/nephi-home-property.json"), "utf8"));
    importFriendlyProperty(property, { dataFile, seedFile, now });
    const providers = createJsonProviders({ dataFile, seedFile, now });
    providers.persistence.setConversationState("nephi_home", CHANNEL, USER, {
      checkInDate: "2026-07-19",
      checkOutDate: "2026-07-20",
      nights: 1,
      guestCount: 2,
      roomType: "room301",
      bookingType: null,
      awaitingField: null,
      lastIntent: "availability",
      updatedAt: now().toISOString(),
      lastMessageFingerprint: "住一晚",
      lastReplyAt: now().toISOString()
    });
    for (const date of ["2026-07-25", "2026-07-26"]) {
      for (const room of property.rooms) providers.availability.setDay("nephi_home", date, room.id, "closed");
    }
    const classifier = new SlowTrailingClassifier();
    app = createApp({
      providers,
      now,
      structuredClassifier: classifier,
      classifierTimeoutMs: 1000,
      conversationDebounceMs: 20,
      testLineSecret: SECRET
    });
    const running = await app.start(0, "127.0.0.1");

    const pending = [resolve(running.url, "trailing-1", "有空房嗎")];
    while (classifier.calls.length === 0) await delay(2);
    for (const [index, message] of ["7/25", "兩個人", "住兩晚"].entries()) {
      pending.push(resolve(running.url, `trailing-${index + 2}`, message));
      await delay(10);
    }
    const results = await Promise.all(pending);
    assert.equal(results.filter((item) => item.shouldReply).length, 1);
    const reply = results.find((item) => item.shouldReply);
    assert.equal(reply.replyText, "2026-07-25 至 2026-07-27 目前沒有符合條件的可訂房型，請由真人協助確認。");
    assert.equal(results.some((item) => item.silent), false);

    const state = providers.persistence.getConversationState("nephi_home", CHANNEL, USER);
    assert.equal(state.checkInDate, "2026-07-25");
    assert.equal(state.checkOutDate, "2026-07-27");
    assert.equal(state.nights, 2);
    assert.equal(state.guestCount, 2);

    const logs = providers.persistence.listMessageLogs("nephi_home")
      .filter((item) => String(item.eventId).startsWith("trailing-"));
    assert.equal(logs.length, 4);
    assert.equal(logs.filter((item) => item.shouldReply).length, 1);
    assert.equal(logs.filter((item) => item.processingStatus === "processing_failed").length, 0);
    assert.equal(classifier.calls.length >= 2, true);
  } finally {
    if (app) await app.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 19, passCount: 19, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
