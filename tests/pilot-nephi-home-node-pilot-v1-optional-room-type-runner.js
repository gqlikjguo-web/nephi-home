"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { importFriendlyProperty } = require(path.join(ROOT, "lib/friendly-property-import"));
const { createJsonProviders } = require(path.join(ROOT, "lib/providers/json-providers"));
const { createApp } = require(path.join(ROOT, "server"));
const SECRET = "optional-room-type-test-secret";
const CHANNEL = "optional-room-type-channel";
function availability(fields, missingFields = []) { return { intent: "availability", route: missingFields.length ? "clarification_needed" : "auto_reply_allowed", confidence: 0.99, reason: "optional_room_type_test", extractedFields: fields, missingFields, shouldIgnore: false, needsHuman: false }; }
class Classifier { async classify(input) {
  if (input.currentMessage === "7/20 兩位有空房嗎") return { ...availability({ checkInDate: "2026-07-20", guestCount: 2 }, ["nights", "roomType"]), stayDurationMode: "needs_nights" };
  if (input.currentMessage === "住一晚") return availability({ nights: 1 }, ["checkOutDate", "roomType"]);
  if (input.currentMessage === "雙人房") return availability({ roomType: "雙人房" });
  throw new Error(`unexpected test message: ${input.currentMessage}`);
} }
async function resolve(url, userId, eventId, messageText) { const response = await fetch(`${url}/api/test-line/resolve`, { method: "POST", headers: { "content-type": "application/json", "x-test-line-secret": SECRET }, body: JSON.stringify({ customerId: "nephi_home", channelId: CHANNEL, lineUserId: userId, eventId, messageText }) }); assert.equal(response.status, 200); return (await response.json()).data; }
(async () => {
  const temp = fs.mkdtempSync(path.join(__dirname, ".tmp-optional-room-type-")); const dataFile = path.join(temp, "store.json"); const now = () => new Date("2026-07-15T00:00:00.000Z"); let app;
  try {
    importFriendlyProperty(JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/nephi-home-property.json"), "utf8")), { dataFile, seedFile: path.join(ROOT, "fixtures/seed.json"), now });
    const providers = createJsonProviders({ dataFile, seedFile: path.join(ROOT, "fixtures/seed.json"), now });
    for (const roomId of ["room301", "room302", "room401", "room402"]) providers.availability.setDay("nephi_home", "2026-07-20", roomId, "available");
    app = createApp({ providers, now, structuredClassifier: new Classifier(), conversationDebounceMs: 10, testLineSecret: SECRET }); const running = await app.start(0, "127.0.0.1");
    const user = "U_optional_room"; const first = await resolve(running.url, user, "optional-1", "7/20 兩位有空房嗎"); assert.equal(first.replyText, "請問預計住幾晚呢？");
    const second = await resolve(running.url, user, "optional-2", "住一晚"); assert.doesNotMatch(second.replyText, /哪一種房型/); assert.match(second.replyText, /2026-07-20/); assert.match(second.replyText, /2026-07-21/);
    const state = providers.persistence.getConversationState("nephi_home", CHANNEL, user); assert.equal(state.checkInDate, "2026-07-20"); assert.equal(state.guestCount, 2); assert.equal(state.nights, 1); assert.equal(state.checkOutDate, "2026-07-21"); assert.equal(state.awaitingField, null);
    const secondLogs = providers.persistence.listMessageLogs("nephi_home").filter((item) => item.eventId === "optional-2"); assert.equal(secondLogs.filter((item) => item.shouldReply).length, 1);
    const filtered = await resolve(running.url, user, "optional-3", "雙人房"); assert.match(filtered.replyText, /301 雙人房/); assert.match(filtered.replyText, /401 雙人房/); assert.doesNotMatch(filtered.replyText, /302 四人房|402 四人房/);
  } finally { if (app) await app.stop(); fs.rmSync(temp, { recursive: true, force: true }); }
  console.log(JSON.stringify({ caseCount: 14, passCount: 14, failCount: 0 }));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
