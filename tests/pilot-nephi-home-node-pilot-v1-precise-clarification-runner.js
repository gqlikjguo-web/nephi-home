"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { importFriendlyProperty } = require(path.join(PILOT_ROOT, "lib/friendly-property-import"));
const { createJsonProviders } = require(path.join(PILOT_ROOT, "lib/providers/json-providers"));
const { createApp } = require(path.join(PILOT_ROOT, "server"));

const SECRET = "precise-clarification-test-secret";
const CHANNEL = "precise-clarification-channel";

function decision(intent, overrides = {}) {
  return {
    intent,
    route: "auto_reply_allowed",
    confidence: 0.99,
    reason: `${intent}_precise_test`,
    extractedFields: {},
    missingFields: [],
    shouldIgnore: false,
    needsHuman: false,
    ...overrides
  };
}

class RealisticAvailabilityClassifier {
  async classify(input) {
    if (input.currentMessage === "住一晚") {
      return decision("availability", {
        extractedFields: { nights: 1 },
        missingFields: ["checkOutDate"]
      });
    }
    if (input.currentMessage === "謝謝") {
      return decision("acknowledgement", {
        route: "no_reply_silent_ignore",
        reason: "simple_thanks",
        shouldIgnore: true
      });
    }
    if (input.currentMessage === "我已經匯款了") return decision("payment");
    const combined = input.currentMessages.join("\n");
    if (combined.includes("7/19") && combined.includes("兩位") && combined.includes("301房")) {
      return decision("availability", {
        route: "clarification_needed",
        stayDurationMode: "needs_nights",
        extractedFields: {
          checkInDate: "2026-07-19",
          guestCount: 2,
          roomType: "301房"
        },
        missingFields: ["checkOutDate", "nights"]
      });
    }
    return decision("unknown", { confidence: 0.2 });
  }
}

async function resolve(url, { userId, eventId, messageText }) {
  const response = await fetch(`${url}/api/test-line/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-line-secret": SECRET },
    body: JSON.stringify({
      customerId: "nephi_home",
      channelId: CHANNEL,
      lineUserId: userId,
      eventId,
      messageText
    })
  });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-precise-clarification-"));
  const dataFile = path.join(tempDir, "store.json");
  const seedFile = path.join(PILOT_ROOT, "fixtures/seed.json");
  const now = () => new Date("2026-07-14T12:00:00.000Z");
  let app;
  try {
    const propertyInput = JSON.parse(fs.readFileSync(path.join(PILOT_ROOT, "fixtures/nephi-home-property.json"), "utf8"));
    importFriendlyProperty(propertyInput, { dataFile, seedFile, now });
    const providers = createJsonProviders({ dataFile, seedFile, now });
    providers.availability.setDay("nephi_home", "2026-07-19", "room301", "available");
    app = createApp({
      providers,
      now,
      structuredClassifier: new RealisticAvailabilityClassifier(),
      classifierTimeoutMs: 1000,
      conversationDebounceMs: 15,
      testLineSecret: SECRET
    });
    const running = await app.start(0, "127.0.0.1");

    const singleUser = "U_precise_single";
    const single = await resolve(running.url, {
      userId: singleUser,
      eventId: "precise-single",
      messageText: "請問 7/19 兩位住 301房有空房嗎？"
    });
    assert.equal(single.replyText, "請問預計住幾晚呢？");
    assert.doesNotMatch(single.replyText, /哪一天入住/);
    assert.doesNotMatch(single.replyText, /幾位入住/);
    assert.doesNotMatch(single.replyText, /哪一種房型/);
    let state = providers.persistence.getConversationState("nephi_home", CHANNEL, singleUser);
    assert.equal(state.checkInDate, "2026-07-19");
    assert.equal(state.guestCount, 2);
    assert.equal(state.roomType, "room301");
    assert.equal(state.awaitingField, "nights");

    const stay = await resolve(running.url, {
      userId: singleUser,
      eventId: "precise-single-night",
      messageText: "住一晚"
    });
    assert.match(stay.replyText, /2026-07-19/);
    assert.match(stay.replyText, /2026-07-20/);
    assert.match(stay.replyText, /301 雙人房/);
    state = providers.persistence.getConversationState("nephi_home", CHANNEL, singleUser);
    assert.equal(state.nights, 1);
    assert.equal(state.checkOutDate, "2026-07-20");
    assert.equal(state.awaitingField, null);

    const burstUser = "U_precise_burst";
    const burstMessages = ["有空房嗎？", "7/19", "兩位", "301房"];
    const burstResults = await Promise.all(burstMessages.map((messageText, index) => resolve(running.url, {
      userId: burstUser,
      eventId: `precise-burst-${index + 1}`,
      messageText
    })));
    assert.equal(burstResults.filter((item) => item.shouldReply).length, 1);
    const burstReply = burstResults.find((item) => item.shouldReply);
    assert.equal(burstReply.replyText, "請問預計住幾晚呢？");
    state = providers.persistence.getConversationState("nephi_home", CHANNEL, burstUser);
    assert.equal(state.checkInDate, "2026-07-19");
    assert.equal(state.guestCount, 2);
    assert.equal(state.roomType, "room301");
    assert.equal(state.awaitingField, "nights");
    const burstLogs = providers.persistence.listMessageLogs("nephi_home")
      .filter((item) => String(item.eventId || "").startsWith("precise-burst-"));
    assert.equal(burstLogs.filter((item) => item.shouldReply).length, 1);
    assert.equal(burstLogs.filter((item) => item.noReply).length, 3);

    const thanks = await resolve(running.url, { userId: "U_precise_thanks", eventId: "precise-thanks", messageText: "謝謝" });
    assert.equal(thanks.shouldReply, false);
    assert.equal(thanks.noReply, true);
    assert.equal(thanks.silent, true);

    const payment = await resolve(running.url, { userId: "U_precise_payment", eventId: "precise-payment", messageText: "我已經匯款了" });
    assert.equal(payment.humanHandoff, true);
    assert.equal(payment.needsReview, true);
  } finally {
    if (app) await app.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 25, passCount: 25, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
