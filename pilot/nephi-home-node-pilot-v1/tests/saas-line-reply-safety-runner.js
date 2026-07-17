"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { createMvpService } = require("../lib/mvp-service");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "saas-line-safety-"));
const seedFile = path.join(tempDir, "seed.json");
const dataFile = path.join(tempDir, "store.json");
const fourPrices = {
  mondayThursdayPrice: 1500,
  fridayPrice: 1700,
  saturdayHolidayPrice: 2200,
  sundayPrice: 1600
};

fs.writeFileSync(seedFile, JSON.stringify({
  testOnly: true,
  seedDays: 30,
  messageLogs: { property_alpha: [], property_beta: [] },
  homestays: [
    {
      customerId: "property_alpha",
      name: "甲旅宿",
      safeFacts: {
        equipment: "公共空間提供 Netflix 與投影機。",
        priceRule: "七月平日價格：不應出現在回覆中。"
      },
      rooms: [
        { id: "room301", name: "301", type: "雙人房", description: "有浴缸", capacity: 2, ...fourPrices },
        { id: "room302", name: "家庭四人房", type: "四人房", description: "管理用：清潔後檢查窗戶", capacity: 4, ...fourPrices },
        { id: "room401", name: "海景雙人房", type: "雙人房", description: "海景", capacity: 2, ...fourPrices },
        { id: "room402", name: "庭園四人房", type: "四人房", description: "這是一段超過公開短特色長度上限而且不應該被帶入對客回覆的房型說明文字", capacity: 4, ...fourPrices },
        { id: "wholeHouse", name: "十二人包棟", type: "包棟", description: "組合型可售方案", capacity: 12, inventoryType: "bundle", ...fourPrices }
      ]
    },
    {
      customerId: "property_beta",
      name: "乙旅宿",
      safeFacts: { equipment: "備有電動麻將桌。", priceRule: "八月價格不得直接採用。" },
      rooms: [
        { id: "room301", name: "森林小屋", type: "雙人房", description: "", capacity: 2, mondayThursdayPrice: 3100, fridayPrice: 3300, saturdayHolidayPrice: 3900, sundayPrice: 3200 },
        { id: "room302", name: "團體房", type: "四人房", description: "", capacity: 4, ...fourPrices },
        { id: "room401", name: "備用房一", type: "雙人房", description: "", capacity: 2, ...fourPrices },
        { id: "room402", name: "備用房二", type: "四人房", description: "", capacity: 4, ...fourPrices },
        { id: "wholeHouse", name: "全館包棟", type: "包棟", description: "", capacity: 12, inventoryType: "bundle", ...fourPrices }
      ]
    }
  ]
}, null, 2));

function route(intent, extractedFields = {}) {
  return {
    intent,
    route: "auto_reply_allowed",
    confidence: 0.99,
    reason: "saas_line_safety_test",
    extractedFields,
    missingFields: [],
    shouldIgnore: false,
    needsHuman: false
  };
}

let eventNumber = 0;
function resolve(service, propertyId, messageText, intent, extractedFields = {}) {
  eventNumber += 1;
  return service.resolveTestLine({
    customerId: propertyId,
    channelId: "test-only",
    lineUserId: `user_${eventNumber}`,
    eventId: `event_${eventNumber}`,
    messageText,
    route: route(intent, extractedFields)
  });
}

try {
  const providers = createJsonProviders({ dataFile, seedFile, now: () => new Date("2026-08-01T00:00:00Z") });
  const service = createMvpService(providers, { now: () => new Date("2026-08-01T00:00:00Z") });
  const dates = { checkInDate: "2026-08-03", checkOutDate: "2026-08-04", guestCount: 2 };

  const doubleReply = resolve(service, "property_alpha", "8/3 有雙人房嗎？", "availability", { ...dates, roomType: "雙人房", queryMode: "room_only" });
  assert.match(doubleReply.replyText, /301 雙人房（有浴缸）/);
  assert.match(doubleReply.replyText, /海景雙人房/);
  assert.doesNotMatch(doubleReply.replyText, /家庭四人房|庭園四人房|十二人包棟|room301/);

  const noNumberReply = resolve(service, "property_beta", "8/3 有雙人房嗎？", "availability", { ...dates, roomType: "雙人房", queryMode: "room_only" });
  assert.match(noNumberReply.replyText, /森林小屋/);
  assert.doesNotMatch(noNumberReply.replyText, /room301|property_beta/);

  const quadReply = resolve(service, "property_alpha", "8/3 有四人房嗎？", "availability", { ...dates, guestCount: 4, roomType: "四人房", queryMode: "room_only" });
  assert.match(quadReply.replyText, /家庭四人房/);
  assert.doesNotMatch(quadReply.replyText, /管理用|雙人房|包棟|超過公開短特色/);

  const bundleReply = resolve(service, "property_alpha", "8/3 可以包棟嗎？", "availability", { ...dates, guestCount: 12, roomType: "all", queryMode: "bundle_only" });
  assert.match(bundleReply.replyText, /十二人包棟/);
  assert.doesNotMatch(bundleReply.replyText, /301|家庭四人房|海景雙人房|庭園四人房|組合型可售方案/);

  for (const question of ["有 KTV 嗎？", "有麻將桌嗎？", "有 Switch 嗎？", "有咖啡機嗎？"]) {
    const unknown = resolve(service, "property_alpha", question, "equipment");
    assert.equal(unknown.replyType, "human_handoff");
    assert.equal(unknown.humanHandoff, true);
    assert.equal(unknown.needsReview, true);
    assert.doesNotMatch(unknown.replyText, /Netflix|投影機/);
  }
  assert.ok(service.listReviews("property_alpha", "pending").length >= 4);

  const overview = resolve(service, "property_alpha", "有哪些設備？", "equipment");
  assert.equal(overview.replyType, "fixed_reply");
  assert.match(overview.replyText, /Netflix|投影機/);
  const known = resolve(service, "property_beta", "有電動麻將桌嗎？", "equipment");
  assert.equal(known.replyType, "fixed_reply");
  assert.match(known.replyText, /電動麻將桌/);

  const price = resolve(service, "property_alpha", "8/3 雙人房一晚多少？", "price", { checkInDate: "2026-08-03", roomType: "雙人房", queryMode: "room_only" });
  for (const label of ["週一至週四", "週五", "週六及連續假期", "週日"]) assert.match(price.replyText, new RegExp(label));
  assert.doesNotMatch(price.replyText, /[一二三四五六七八九十]+月|七月|八月/);
  assert.match(price.replyText, /301 雙人房|海景雙人房/);
  assert.doesNotMatch(price.replyText, /家庭四人房|十二人包棟/);

  const betaPrice = resolve(service, "property_beta", "房價多少？", "price", { roomType: "雙人房", queryMode: "room_only" });
  assert.match(betaPrice.replyText, /3100/);
  assert.doesNotMatch(betaPrice.replyText, /301 雙人房|海景雙人房|property_alpha|八月/);

  const silent = service.resolveTestLine({ customerId: "property_alpha", channelId: "test-only", lineUserId: "dedupe", eventId: "silent-event", messageText: "有哪些設備？", route: { ...route("equipment"), route: "no_reply_silent_ignore", shouldIgnore: true } });
  assert.equal(silent.shouldReply, false);
  assert.doesNotMatch(JSON.stringify([doubleReply, quadReply, bundleReply, price]), /清潔後檢查窗戶|管理用/);

  console.log(JSON.stringify({ caseCount: 24, passCount: 24, failCount: 0 }));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
