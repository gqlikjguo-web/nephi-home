"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cleanInput } = require("../lib/onboarding-service");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { executeTasks } = require("../lib/conversation-engine-v2/capability-executor");
const { PRESET_AMENITIES, ROOM_TYPES, normalizeEntertainmentAmenities } = require("../lib/bundle-entertainment");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const base = {
  propertyName: "測試旅宿", contactName: "王小姐", phone: "0900000000", email: "owner@example.test",
  address: "測試地址", googleMapsUrl: "", checkInTime: "15:00", checkOutTime: "11:00",
  line: { hasOfficialAccount: false, channelId: "legacy-channel", contactLink: "" },
  rooms: [{ key: "room-a", displayName: "家庭套房", type: "家庭房", capacity: 4, mondayThursdayPrice: 2000, fridayPrice: 2200, saturdayHolidayPrice: 2600, sundayPrice: 2100, enabled: true }],
  bundles: [{ key: "bundle-a", name: "歡樂包棟", memberRoomKeys: ["room-a"], capacity: 8, mondayThursdayPrice: 6000, fridayPrice: 7000, saturdayHolidayPrice: 8000, sundayPrice: 6500, enabled: true, entertainmentAmenities: [
    { key: "singing", displayName: "KTV／歡唱設備", provided: true, note: "使用至 22:00", source: "preset", position: 0 },
    { key: "bbq", displayName: "烤肉區／烤肉設備", provided: false, note: "舊備註不可保存", source: "preset", position: 10 },
    { key: "custom_rooftop", displayName: "屋頂星空區", provided: true, note: "需預約", source: "custom", position: 21 },
    { key: "custom_duplicate", displayName: " 屋頂星空區 ", provided: true, note: "", source: "custom", position: 22 }
  ] }], knowledge: []
};

(() => {
  const expectedKeys = ["singing", "electric_mahjong", "mahjong", "board_games", "game_console", "projector", "billiards", "darts", "table_football", "massage_chair", "bbq", "splash_pool", "swimming_pool", "children_play_area", "slide", "sandpit", "outdoor_yard", "shared_living_room", "kitchen", "hot_pot_equipment", "streaming_media"];
  assert.deepEqual(PRESET_AMENITIES.map((item) => item.key), expectedKeys);
  for (const type of ["單人房", "雙人房", "三人房", "四人房", "五人房", "六人房", "八人房", "家庭房", "親子房", "和室", "通鋪", "套房", "Villa", "其他"]) assert.ok(ROOM_TYPES.includes(type));
  const normalized = normalizeEntertainmentAmenities(base.bundles[0].entertainmentAmenities);
  assert.equal(normalized.find((item) => item.key === "bbq").provided, null, "legacy checkbox false is not an explicit operator denial");
  assert.equal(normalized.find((item) => item.key === "bbq").note, "");
  assert.equal(normalized.find((item) => item.key === "projector").provided, null, "missing preset data stays unknown");
  assert.equal(normalizeEntertainmentAmenities([{ key: "bbq", provided: false, statusSource: "operator", source: "preset" }]).find((item) => item.key === "bbq").provided, false, "new explicit operator denial is preserved");
  assert.equal(normalized.filter((item) => item.displayName === "屋頂星空區").length, 1);
  assert.throws(() => normalizeEntertainmentAmenities([{ key: "custom_x", displayName: "超過二十個中文字的自訂娛樂設備名稱不可被接受測試", provided: true, note: "", source: "custom", position: 1 }]), /20/);
  assert.throws(() => normalizeEntertainmentAmenities([{ key: "singing", displayName: "KTV／歡唱設備", provided: true, note: "甲".repeat(101), source: "preset", position: 0 }]), /100/);
  const cleaned = cleanInput(base);
  assert.equal(Object.hasOwn(cleaned.line, "channelId"), false);
  assert.equal(cleaned.bundles[0].entertainmentAmenities.find((item) => item.key === "singing").provided, true);
  const property = { propertyId: "property-a", displayName: "A", rooms: [
    { id: "bundle-a", name: "歡樂包棟", inventoryType: "bundle", enabled: true, entertainmentAmenities: cleaned.bundles[0].entertainmentAmenities },
    { id: "bundle-b", name: "安靜包棟", inventoryType: "bundle", enabled: true, entertainmentAmenities: [{ key: "bbq", displayName: "烤肉區／烤肉設備", provided: true, statusSource: "operator", note: "雨天不開放", source: "preset", position: 10 }] }
  ], commonAnswers: { bbqRule: "舊 FAQ 僅說明一般政策" }, faqs: [{ knowledgeKey: "bbq", question: "烤肉使用時間", answer: "使用至 21:00" }] };
  property.propertyFacts = [{
    canonicalId: "bbq",
    category: "amenity",
    status: "allowed",
    appliesTo: "whole_property",
    publicText: "Legacy propertyFacts BBQ description.",
    fees: [],
    advanceNoticeRequired: null,
    reservationRequired: null,
    conditions: [],
    restrictions: [],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-08-13T00:00:00.000Z"
  }];

  const catalog = buildPropertyCatalog(property);
  const singing = catalog.amenities.find((item) => item.canonicalId === "singing");
  assert.equal(singing.status, "confirmed_yes");
  assert.deepEqual(singing.applicableBundles.map((item) => item.name), ["歡樂包棟"]);
  assert.match(singing.answer, /22:00/);
  const bbq = catalog.amenities.find((item) => item.canonicalId === "bbq");
  assert.deepEqual(bbq.applicableBundles.map((item) => item.name), ["安靜包棟"]);
  assert.doesNotMatch(bbq.answer, /舊 FAQ/);
  assert.doesNotMatch(bbq.answer, /21:00/, "legacy FAQ must not supplement current bundle entertainment");
  assert.equal(catalog.faqs.some((item) => item.canonicalId === "bbq"), false, "the same canonical equipment ID is not emitted as a second fact");
  const unknownWithFaq = buildPropertyCatalog({ propertyId: "property-unknown", displayName: "U", rooms: [{ id: "bundle-u", name: "U 包棟", inventoryType: "bundle", enabled: true, entertainmentAmenities: [] }], commonAnswers: {}, faqs: [{ knowledgeKey: "singing", question: "歡唱時間", answer: "使用至 22:00" }] });
  assert.equal(unknownWithFaq.amenities.some((item) => item.canonicalId === "singing"), false, "unknown equipment has no answerable catalog fact");
  assert.equal(unknownWithFaq.faqs.some((item) => item.canonicalId === "singing"), false);
  const noWithFaq = buildPropertyCatalog({ propertyId: "property-no", displayName: "N", rooms: [{ id: "bundle-n", name: "N 包棟", inventoryType: "bundle", enabled: true, entertainmentAmenities: [{ key: "singing", provided: false, statusSource: "operator", source: "preset" }] }], commonAnswers: {}, faqs: [{ knowledgeKey: "singing", question: "歡唱時間", answer: "使用至 22:00" }] });
  assert.equal(noWithFaq.amenities.find((item) => item.canonicalId === "singing").status, "confirmed_no");
  assert.equal(noWithFaq.amenities.find((item) => item.canonicalId === "singing").answer, "", "FAQ cannot override an explicit no");
  const task = { taskId: "equipment", type: "property_fact", entity: { category: "amenity", canonicalCandidate: "singing", rawText: "KTV" }, detailIntent: "general" };
  const result = executeTasks({ property, catalog, tasks: [task], request: { inventory: { mode: "any" }, stay: {} } })[0];
  assert.equal(result.status, "answered");
  assert.deepEqual(result.facts.applicableBundles.map((item) => item.name), ["歡樂包棟"]);
  const detailResult = executeTasks({ property, catalog, tasks: [{ ...task, taskId: "singing-time", detailIntent: "end_time" }], request: { inventory: { mode: "any" }, stay: {} } })[0];
  assert.equal(detailResult.facts.detailProvided, true);
  assert.match(detailResult.facts.answer, /22:00/, "a detail question may only reuse the formal bundle note");
  const otherCatalog = buildPropertyCatalog({ propertyId: "property-b", displayName: "B", rooms: [{ id: "bundle-x", name: "B 包棟", inventoryType: "bundle", enabled: true, entertainmentAmenities: [] }], commonAnswers: {}, faqs: [] });
  assert.equal(otherCatalog.amenities.some((item) => item.canonicalId === "singing"), false);
  const onboardingHtml = read("public/onboarding.html"), onboardingJs = read("public/assets/onboarding.js"), adminHtml = read("public/admin.html"), adminJs = read("public/assets/admin.js"), guestJs = read("public/assets/guest.js");
  assert.equal(onboardingHtml.includes("Channel ID"), false);
  assert.ok(onboardingJs.includes("房型名稱") && onboardingJs.includes("entertainmentAmenities"));
  assert.ok(adminHtml.includes("bundleAmenities") && adminJs.includes("entertainmentAmenities"));
  assert.match(onboardingJs, /未知.*有.*沒有/s, "onboarding equipment must expose a tri-state choice");
  assert.match(adminJs, /未知.*有.*沒有/s, "admin equipment must expose a tri-state choice");
  assert.equal(onboardingJs.includes('pool:"是否有戲水池或游泳池"'), false, "onboarding FAQ must not duplicate equipment existence authority");
  assert.equal(onboardingJs.includes('equipment:"盥洗用品與設備"'), false, "onboarding FAQ must not duplicate structured equipment authority");
  assert.ok(guestJs.includes("entertainmentAmenities"));
  assert.equal(guestJs.includes("✓ 可入住"), false);
  assert.match(read("migrations/014_bundle_entertainment_amenities.sql"), /entertainment_amenities\s+jsonb/i);
  assert.doesNotMatch(bbq.answer, /Legacy propertyFacts/);
  assert.match(adminHtml, /id="bundleAmenityEditor"/);
  assert.match(onboardingHtml, /id="onboardingAmenityEditor"/);
  assert.match(adminJs, /openBundleAmenityEditor/);
  assert.match(onboardingJs, /openOnboardingAmenityEditor/);
  assert.doesNotMatch(adminHtml, /<details class="card other-settings"/);
  assert.match(onboardingHtml, /name="latestArrivalTime"/);
  assert.match(adminJs, /profileAddress/);
  assert.match(guestJs, /amenity\.note/);

  console.log("bundle entertainment contract: PASS");
})();
