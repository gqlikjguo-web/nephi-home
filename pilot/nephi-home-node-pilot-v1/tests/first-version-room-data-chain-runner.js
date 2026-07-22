"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cleanInput } = require("../lib/onboarding-service");
const { normalizeRoomRecord } = require("../lib/room-data");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function onboarding(overrides = {}) {
  return {
    propertyName: "示範旅宿", contactName: "王小姐", phone: "0900000000",
    email: "owner@example.test", address: "測試地址", googleMapsUrl: "",
    checkInTime: "15:00", checkOutTime: "11:00",
    line: { hasOfficialAccount: false, channelId: "", contactLink: "" },
    rooms: [{ key: "room-a", roomCode: " A2 ", displayName: " 景觀客房 ", capacity: 2, highlights: [" 陽台 ", "", "陽台", "浴缸"], mondayThursdayPrice: 2000, fridayPrice: 2200, saturdayHolidayPrice: 2800, sundayPrice: 2100, enabled: true }],
    bundles: [], knowledge: [], ...overrides
  };
}

(() => {
  const normalized = normalizeRoomRecord({ id: "room-a", name: "舊名稱", roomCode: " 2F ", highlights: [" 山景 ", "", "山景", "陽台"] });
  assert.equal(normalized.displayName, "舊名稱");
  assert.equal(normalized.roomCode, "2F");
  assert.deepEqual(normalized.highlights, ["山景", "陽台"]);

  const cleaned = cleanInput(onboarding());
  assert.equal(cleaned.rooms[0].displayName, "景觀客房");
  assert.equal(cleaned.rooms[0].name, "景觀客房");
  assert.equal(cleaned.rooms[0].roomCode, "A2");
  assert.deepEqual(cleaned.rooms[0].highlights, ["陽台", "浴缸"]);
  assert.throws(() => cleanInput(onboarding({ rooms: [{ ...onboarding().rooms[0], displayName: "   " }] })), /房型顯示名稱/);
  assert.throws(() => cleanInput(onboarding({ rooms: [{ ...onboarding().rooms[0], capacity: 0 }] })), (error) => error && error.code === "INVALID_NUMBER");
  assert.throws(() => cleanInput(onboarding({ rooms: [{ ...onboarding().rooms[0], highlights: ["一", "二", "三", "四"] }] })), /房型亮點/);
  assert.throws(() => cleanInput(onboarding({ rooms: [{ ...onboarding().rooms[0], highlights: ["超過十五個中文字的房型亮點不可以被保存"] }] })), /房型亮點/);
  assert.throws(() => cleanInput(onboarding({ line: { hasOfficialAccount: true, channelId: "", contactLink: "" } })), /LINE/);
  assert.throws(() => cleanInput(onboarding({ line: { hasOfficialAccount: true, channelId: "", contactLink: "https://example.com/line" } })), /LINE/);
  assert.equal(cleanInput(onboarding({ line: { hasOfficialAccount: true, channelId: "", contactLink: "https://lin.ee/example" } })).line.contactLink, "https://lin.ee/example");

  const migration = read("migrations/013_room_presentation_fields.sql");
  for (const token of ["room_code", "display_name", "highlights", "IF NOT EXISTS"]) assert.match(migration, new RegExp(token, "i"));

  const onboardingHtml = read("public/onboarding.html");
  const onboardingJs = read("public/assets/onboarding.js");
  for (const label of ["房型代號／房號", "房型名稱", "房型亮點", "已有正式資料", "不提供／不適用", "需要人工說明", "尚未確認"]) assert.ok(onboardingJs.includes(label), `onboarding must include ${label}`);
  assert.ok(onboardingHtml.includes("Google Maps"));
  for (const field of ["propertyName", "contactName", "phone", "email", "address", "rooms", "bundles", "knowledge"]) assert.ok(onboardingJs.includes(field));
  assert.equal(onboardingHtml.includes("Channel Secret"), false);
  assert.equal(onboardingHtml.includes("Access Token"), false);

  const adminHtml = read("public/admin.html");
  const adminJs = read("public/assets/admin.js");
  assert.ok(adminHtml.includes("房型資料與價格"));
  for (const field of ["roomCode", "displayName", "capacity", "highlights", "enabled"]) assert.ok(adminJs.includes(field), `admin must edit ${field}`);
  assert.ok(adminJs.includes("輸入內容仍保留"));

  const guestHtml = read("public/guest.html");
  const guestJs = read("public/assets/guest.js");
  const guestCss = read("public/assets/guest.css");
  assert.ok(guestHtml.includes("想查什麼？"));
  assert.ok(guestHtml.includes('name="checkOut" type="date"'));
  assert.equal(guestHtml.includes('name="queryMode"'), false);
  assert.equal(guestHtml.includes('name="roomType"'), false);
  assert.ok(guestJs.includes("checkInDate") && guestJs.includes("checkOutDate"));
  for (const text of ["詢問此房型", "詢問此包棟方案", "最多入住", "roomCode", "highlights"]) assert.ok(guestJs.includes(text));
  assert.equal(guestJs.includes("propertyId"), false);
  assert.match(guestCss, /@media\s*\(min-width:\s*768px\)/);

  const server = read("server.js");
  const availabilityBody = server.slice(server.indexOf("function publicAvailabilityResult"), server.indexOf("function publicPropertyMetadata"));
  assert.equal(/propertyId\s*:/.test(availabilityBody), false);
  console.log("first-version room data chain: PASS");
})()
