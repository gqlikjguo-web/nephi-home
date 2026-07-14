"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const PROPERTY_FILE = path.join(PILOT_ROOT, "fixtures/nephi-home-property.json");
assert.ok(fs.existsSync(PROPERTY_FILE), "Nephi Pilot property JSON must exist");

const { importFriendlyProperty } = require(path.join(PILOT_ROOT, "lib/friendly-property-import"));
const { createJsonProviders } = require(path.join(PILOT_ROOT, "lib/providers/json-providers"));
const { createApp } = require(path.join(PILOT_ROOT, "server"));

const SECRET = "nephi-property-test-secret";

function decision(intent, overrides = {}) {
  return {
    intent,
    route: "auto_reply_allowed",
    confidence: 0.99,
    reason: `${intent}_test_case`,
    extractedFields: {},
    missingFields: [],
    shouldIgnore: false,
    needsHuman: false,
    ...overrides
  };
}

class NephiMockClassifier {
  async classify(input) {
    const cases = {
      "入住時間": decision("checkin_rule"),
      "停車": decision("parking"),
      "烤肉": decision("bbq"),
      "301 平日價格": decision("price"),
      "402 平日價格": decision("price"),
      "未知房況": decision("availability", {
        extractedFields: {
          checkInDate: "2026-08-01",
          checkOutDate: "2026-08-02",
          nights: 1,
          guestCount: 2,
          roomType: "room301"
        }
      }),
      "今天可以提早入住嗎？": decision("early_checkin_late_checkout_request")
    };
    return cases[input.currentMessage] || decision("unknown", { confidence: 0.2 });
  }
}

async function resolve(url, eventId, messageText) {
  const response = await fetch(`${url}/api/test-line/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-line-secret": SECRET },
    body: JSON.stringify({
      customerId: "nephi_home",
      channelId: "nephi-local-test",
      lineUserId: `U_${eventId.replace(/[^A-Za-z0-9_-]/g, "_")}`,
      eventId,
      messageText
    })
  });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

(async () => {
  const input = JSON.parse(fs.readFileSync(PROPERTY_FILE, "utf8"));
  assert.equal(input.propertyId, "nephi_home");
  assert.equal(input.propertyName, "尼腓的家");
  assert.equal(input.checkInTime, "15:00");
  assert.equal(input.checkOutTime, "11:00");
  assert.deepEqual(input.rooms, [
    { name: "301 雙人房", capacity: 2 },
    { name: "302 四人房", capacity: 4 },
    { name: "401 雙人房", capacity: 2 },
    { name: "402 四人房", capacity: 4 }
  ]);
  assert.match(input.pricing.weekday, /301[^0-9]*1500/);
  assert.match(input.pricing.weekday, /302[^0-9]*2200/);
  assert.match(input.pricing.weekday, /401[^0-9]*1700/);
  assert.match(input.pricing.weekday, /402[^0-9]*2600/);
  assert.match(input.pricing.weekday, /週五.*週日.*平日/);
  assert.match(input.pricing.weekday, /包棟[^0-9]*13000/);
  assert.match(input.pricing.holiday, /包棟[^0-9]*18000/);
  assert.match(input.pricing.holiday, /未確認.*真人/);
  assert.equal(input.selfCheckIn, true);
  assert.ok(input.faqs.length >= 10 && input.faqs.length <= 20);

  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-nephi-property-"));
  const dataFile = path.join(tempDir, "store.json");
  const seedFile = path.join(PILOT_ROOT, "fixtures/seed.json");
  const now = () => new Date("2026-07-14T00:00:00.000Z");
  let app;
  try {
    const first = importFriendlyProperty(input, { dataFile, seedFile, now });
    assert.deepEqual(first, { propertyId: "nephi_home", created: true });
    let providers = createJsonProviders({ dataFile, seedFile, now });
    const property = providers.customerSettings.getProperty("nephi_home");
    assert.deepEqual(property.rooms.map((room) => [room.id, room.name, room.capacity]), [
      ["room301", "301 雙人房", 2],
      ["room302", "302 四人房", 4],
      ["room401", "401 雙人房", 2],
      ["room402", "402 四人房", 4]
    ]);
    assert.match(property.commonAnswers.priceRule, /301[^0-9]*1500/);
    assert.match(property.commonAnswers.priceRule, /402[^0-9]*2600/);
    assert.equal(property.commonAnswers.checkOutTime, "11:00");
    assert.equal(providers.customerSettings.getProperty("demo_homestay_a").displayName, "山嵐示範民宿");

    providers.persistence.appendMessageLog("nephi_home", {
      eventId: "nephi-preserve-log",
      guestMessage: "需要保留的紀錄",
      needsReview: true,
      status: "pending",
      createdAt: now().toISOString()
    });
    providers.availability.setDay("nephi_home", "2026-07-20", "room301", "available");
    const second = importFriendlyProperty(input, { dataFile, seedFile, now });
    assert.deepEqual(second, { propertyId: "nephi_home", created: false });

    providers = createJsonProviders({ dataFile, seedFile, now });
    assert.equal(providers.persistence.findMessageByEventId("nephi_home", "nephi-preserve-log").needsReview, true);
    assert.equal(providers.availability.getRows("nephi_home", "2026-07-20", "2026-07-21")[0].room301, "available");

    const state = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    delete state.availability.nephi_home["2026-08-01"];
    fs.writeFileSync(dataFile, JSON.stringify(state, null, 2) + "\n", "utf8");

    app = createApp({
      providers,
      now,
      structuredClassifier: new NephiMockClassifier(),
      testLineSecret: SECRET,
      conversationDebounceMs: 1
    });
    const running = await app.start(0, "127.0.0.1");
    const checkin = await resolve(running.url, "nephi-checkin", "入住時間");
    const parking = await resolve(running.url, "nephi-parking", "停車");
    const bbq = await resolve(running.url, "nephi-bbq", "烤肉");
    const price301 = await resolve(running.url, "nephi-price-301", "301 平日價格");
    const price402 = await resolve(running.url, "nephi-price-402", "402 平日價格");
    const unavailable = await resolve(running.url, "nephi-unknown-availability", "未知房況");
    const early = await resolve(running.url, "nephi-early-request", "今天可以提早入住嗎？");

    assert.match(checkin.replyText, /15:00/);
    assert.match(parking.replyText, /車庫有 1 個車位/);
    assert.match(bbq.replyText, /只有包棟/);
    assert.match(bbq.replyText, /1000 元/);
    assert.match(price301.replyText, /301[^0-9]*1500/);
    assert.match(price402.replyText, /402[^0-9]*2600/);
    assert.equal(unavailable.humanHandoff, true);
    assert.equal(unavailable.needsReview, true);
    assert.doesNotMatch(unavailable.replyText, /可詢問房型/);
    assert.equal(early.detectedIntent, "early_checkin_late_checkout_request");
    assert.equal(early.humanHandoff, true);
    assert.equal(early.needsReview, true);
  } finally {
    if (app) await app.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 14, passCount: 14, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
