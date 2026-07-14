"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const PROPERTY_FILE = path.join(PILOT_ROOT, "fixtures/nephi-home-property.json");
const { importFriendlyProperty } = require(path.join(PILOT_ROOT, "lib/friendly-property-import"));
const { createJsonProviders } = require(path.join(PILOT_ROOT, "lib/providers/json-providers"));
const { createApp } = require(path.join(PILOT_ROOT, "server"));

const SECRET = "nephi-faq-runtime-test-secret";
const KNOWLEDGE_KEYS = new Map([
  ["幾點可以入住與退房？", "self_checkin"],
  ["可以帶寵物嗎？", "pet_rule"],
  ["有提供早餐嗎？", "breakfast"],
  ["有飲水機嗎？", "drinking_water"],
  ["可以使用洗衣機與烘衣機嗎？", "laundry"],
  ["有電梯嗎？", "elevator"],
  ["有嬰兒用品嗎？", "baby_supplies"],
  ["包棟有哪些設備？", "equipment"]
]);

function decision(intent, overrides = {}) {
  return {
    intent,
    route: "auto_reply_allowed",
    confidence: 0.99,
    reason: `${intent}_fixture_test`,
    extractedFields: {},
    missingFields: [],
    shouldIgnore: false,
    needsHuman: false,
    ...overrides
  };
}

class NephiFaqMockClassifier {
  async classify(input) {
    const intents = {
      早餐: "breakfast",
      飲水: "drinking_water",
      洗衣: "laundry",
      電梯: "elevator",
      嬰兒用品: "baby_supplies",
      寵物: "pet_rule",
      自助入住: "self_checkin",
      包棟設備: "equipment",
      付款: "payment",
      取消: "cancellation",
      密碼: "door_access"
    };
    if (input.currentMessage === "自由文案輸出") {
      return { ...decision("breakfast"), suggestedReply: "這段模型自由文案不得送出" };
    }
    return decision(intents[input.currentMessage] || "unknown", intents[input.currentMessage] ? {} : { confidence: 0.2 });
  }
}

async function resolve(url, customerId, eventId, messageText) {
  const response = await fetch(`${url}/api/test-line/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-line-secret": SECRET },
    body: JSON.stringify({
      customerId,
      channelId: "nephi-faq-test-channel",
      lineUserId: `U_${eventId}`,
      eventId,
      messageText
    })
  });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

(async () => {
  const input = JSON.parse(fs.readFileSync(PROPERTY_FILE, "utf8"));
  input.faqs = input.faqs.map((faq) => ({
    ...faq,
    ...(KNOWLEDGE_KEYS.has(faq.question) ? { knowledgeKey: KNOWLEDGE_KEYS.get(faq.question) } : {})
  }));
  assert.equal(input.faqs.filter((faq) => faq.knowledgeKey).length, 8);

  const expected = Object.fromEntries(input.faqs.filter((faq) => faq.knowledgeKey).map((faq) => [faq.knowledgeKey, faq.answer]));
  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-nephi-faq-"));
  const dataFile = path.join(tempDir, "store.json");
  const seedFile = path.join(PILOT_ROOT, "fixtures/seed.json");
  const now = () => new Date("2026-07-14T00:00:00.000Z");
  let app;
  try {
    importFriendlyProperty(input, { dataFile, seedFile, now });
    const providers = createJsonProviders({ dataFile, seedFile, now });
    const property = providers.customerSettings.getProperty("nephi_home");
    assert.equal(property.commonAnswers.breakfastRule, expected.breakfast);
    assert.equal(property.commonAnswers.drinkingWaterRule, expected.drinking_water);
    assert.equal(property.commonAnswers.laundryRule, expected.laundry);
    assert.equal(property.commonAnswers.elevatorRule, expected.elevator);
    assert.equal(property.commonAnswers.babySuppliesRule, expected.baby_supplies);
    assert.equal(property.commonAnswers.petRule, expected.pet_rule);
    assert.equal(property.commonAnswers.selfCheckInRule, expected.self_checkin);
    assert.equal(property.commonAnswers.equipment, expected.equipment);

    app = createApp({
      providers,
      now,
      structuredClassifier: new NephiFaqMockClassifier(),
      testLineSecret: SECRET,
      conversationDebounceMs: 1
    });
    const running = await app.start(0, "127.0.0.1");
    const cases = [
      ["breakfast", "早餐"],
      ["drinking_water", "飲水"],
      ["laundry", "洗衣"],
      ["elevator", "電梯"],
      ["baby_supplies", "嬰兒用品"],
      ["pet_rule", "寵物"],
      ["self_checkin", "自助入住"],
      ["equipment", "包棟設備"]
    ];
    for (const [knowledgeKey, message] of cases) {
      const result = await resolve(running.url, "nephi_home", `faq-${knowledgeKey}`, message);
      assert.equal(result.replyText, expected[knowledgeKey]);
      assert.equal(result.humanHandoff, false);
      assert.equal(result.needsReview, false);
    }

    const isolated = await resolve(running.url, "demo_homestay_a", "faq-isolation", "早餐");
    assert.equal(isolated.humanHandoff, true);
    assert.equal(isolated.needsReview, true);
    assert.notEqual(isolated.replyText, expected.breakfast);

    for (const [eventId, message] of [["risk-payment", "付款"], ["risk-cancel", "取消"], ["risk-door", "密碼"]]) {
      const result = await resolve(running.url, "nephi_home", eventId, message);
      assert.equal(result.humanHandoff, true);
      assert.equal(result.needsReview, true);
    }

    const invalid = await resolve(running.url, "nephi_home", "faq-free-prose", "自由文案輸出");
    assert.equal(invalid.humanHandoff, true);
    assert.equal(invalid.needsReview, true);
    assert.notEqual(invalid.replyText, "這段模型自由文案不得送出");
  } finally {
    if (app) await app.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 20, passCount: 20, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
