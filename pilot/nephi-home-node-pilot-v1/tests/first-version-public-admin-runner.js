"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createMvpService } = require("../lib/mvp-service");
const { createJsonProviders } = require("../lib/providers/json-providers");

async function json(url) {
  const response = await fetch(url);
  return { response, body: await response.json() };
}

function property(propertyId, name, lineUrl) {
  return {
    propertyId,
    displayName: name,
    contactLink: lineUrl,
    businessProfile: { googleMapsUrl: "https://maps.app.goo.gl/example" },
    commonAnswers: { checkInTime: "15:00", checkOutTime: "11:00" },
    rooms: [
      { id: "double", name: "雙人房", type: "double", capacity: 2, enabled: true, mondayThursdayPrice: 2000 },
      { id: "family", name: "家庭房", type: "family", capacity: 4, enabled: true, mondayThursdayPrice: 3000 },
      { id: "bundle", name: "包棟", type: "bundle", capacity: 6, enabled: true, inventoryType: "bundle", memberRoomIds: ["double", "family"], mondayThursdayPrice: 5000 }
    ],
    onboarding: { isReady: true }
  };
}

const SEED_BASE_NOW = "2035-04-21T00:00:01.000Z";
const seedNow = () => new Date(SEED_BASE_NOW);
function seedDate(offsetDays) {
  const date = seedNow();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

(async () => {
  const guestScript = fs.readFileSync(path.join(__dirname, "../public/assets/guest.js"), "utf8");
  const adminScript = fs.readFileSync(path.join(__dirname, "../public/assets/admin.js"), "utf8");
  const adminHtml = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
  const guestCss = fs.readFileSync(path.join(__dirname, "../public/assets/guest.css"), "utf8");
  const adminCss = fs.readFileSync(path.join(__dirname, "../public/assets/styles.css"), "utf8");
  assert.equal(guestScript.includes("propertyId"), false, "guest code must not accept or expose propertyId");
  assert.match(guestScript, /inventoryOptions/, "guest room choices must be supplied by public property data");
  assert.match(guestScript, /lineDisclaimer/, "guest results must include the LINE booking disclaimer");
  assert.doesNotMatch(guestScript, /✓ 可入住/, "public cards must not repeat the redundant availability label");
  assert.match(guestScript, /\\u4e00\\u9375\\u8907\\u88fd\\u8a62\\u554f\\u5167\\u5bb9/, "public cards must expose the approved one-click inquiry action");
  assert.match(guestScript, /\\u524d\\u5f80 LINE \\u5b98\\u65b9\\u5e33\\u865f/, "public cards must expose the approved official LINE entry");
  assert.match(guestScript, /Intl\.NumberFormat\("zh-TW"/, "public prices must use a locale-safe currency formatter");
  assert.match(adminScript, /status-toggle/, "admin availability must use a single controlled toggle");
  assert.match(adminScript, /＋備註/, "admin must expose an explicit add-note action");
  assert.match(adminScript, /編輯備註/, "admin must expose an explicit edit-note action");
  assert.match(adminScript, /bundle-members/, "bundle cards must render member room names as structured content");
  assert.match(adminScript, /已有特殊價格，確定覆蓋/, "overwriting a special price must require confirmation");
  assert.match(adminScript, /bundleStatus/, "bundle writes must expose explicit success or failure feedback");
  const checkInIndex = adminHtml.indexOf('id="profileCheckInTime"');
  const latestArrivalIndex = adminHtml.indexOf('id="profileLatestArrivalTime"');
  const checkOutIndex = adminHtml.indexOf('id="profileCheckOutTime"');
  assert.equal(checkInIndex >= 0 && latestArrivalIndex > checkInIndex && checkOutIndex > latestArrivalIndex, true, "the optional latest-arrival time input must appear between check-in and check-out");
  assert.match(adminHtml, /id="profileLatestArrivalTime" type="time"/, "latest arrival must use the browser time input contract");
  assert.match(adminScript, /profileLatestArrivalTime/, "the admin profile client must load and save latestArrivalTime");
  assert.match(guestCss, /max-width: 390px/, "guest mobile layout must include a narrow-screen rule");
  assert.match(adminCss, /status-toggle/, "the admin toggle must have an explicit mobile-safe presentation");
  assert.match(adminCss, /max-width:\s*640px/, "the admin workspace must include a mobile layout rule");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-public-admin-"));
  const seedFile = path.join(temp, "seed.json");
  const dataFile = path.join(temp, "data.json");
  const firstMondayOffset = (8 - seedNow().getUTCDay()) % 7;
  const checkInDate = seedDate(firstMondayOffset);
  const checkOutDate = seedDate(firstMondayOffset + 1);
  const multiNightCheckOutDate = seedDate(firstMondayOffset + 2);
  fs.writeFileSync(seedFile, JSON.stringify({
    testOnly: true,
    homestays: [{
      customerId: "nephi_home",
      name: "尼腓的家",
      lineUrl: "https://lin.ee/nephiOfficial",
      businessProfile: { googleMapsUrl: "https://maps.app.goo.gl/nephi" },
      safeFacts: { checkInTime: "15:00", latestArrivalTime: "21:30", checkOutTime: "11:00" },
      rooms: [
        { id: "room301", roomCode: "R-A", displayName: "陽光客房", name: "陽光客房", highlights: ["採光佳", "安靜"], type: "double", capacity: 2, enabled: true, mondayThursdayPrice: 2000 },
        { id: "room302", name: "家庭房", type: "family", capacity: 4, enabled: true, mondayThursdayPrice: 3000 },
        { id: "room401", name: "景觀雙人房", type: "double", capacity: 2, enabled: true, mondayThursdayPrice: 2200 },
        { id: "room402", name: "景觀家庭房", type: "family", capacity: 4, enabled: true, mondayThursdayPrice: 3200 }
      ]
    }, {
      customerId: "other_home",
      name: "另一間旅宿",
      lineUrl: "https://lin.ee/otherOfficial",
      safeFacts: { checkInTime: "14:00", latestArrivalTime: "20:00", checkOutTime: "10:00" },
      rooms: [{ id: "other", name: "另一間房", type: "other", capacity: 2, enabled: true, mondayThursdayPrice: 1000 }],
      availability: { [checkInDate]: { other: "available" } }
    }, {
      customerId: "bundle_home",
      name: "包棟測試旅宿",
      rooms: [
        { id: "a", name: "A 房", type: "double", capacity: 2, enabled: true, mondayThursdayPrice: 1800 },
        { id: "all-house", name: "六人包棟", type: "bundle", capacity: 6, enabled: true, inventoryType: "bundle", memberRoomIds: ["a"], mondayThursdayPrice: 4800 }
      ]
    }],
    messageLogs: { nephi_home: [], other_home: [] }
  }));
  const app = createApp({ providers: createJsonProviders({ dataFile, seedFile, now: seedNow }), adminAuthRequired: false });
  const running = await app.start(0, "127.0.0.1");
  try {
    const metadata = await json(`${running.url}/api/public/property?slug=nephihome`);
    assert.equal(metadata.response.status, 200, "a generic public slug must resolve without exposing propertyId");
    assert.equal(metadata.body.data.propertyName, "尼腓的家");
    assert.equal(Object.hasOwn(metadata.body.data, "propertyId"), false);
    assert.deepEqual(metadata.body.data.inventoryOptions.map((item) => item.id), ["all", "room301", "room302", "room401", "room402"], "guest options must come from the current property data");
    assert.equal(metadata.body.data.inventoryOptions[0].name, "全部房型", "a property without bundles must label the all option as all rooms");
    assert.equal(metadata.body.data.lineUrl, "https://lin.ee/nephiOfficial");

    const bundleMetadata = await json(`${running.url}/api/public/property?slug=bundlehome`);
    assert.equal(bundleMetadata.body.data.inventoryOptions[0].name, "全部房型與包棟", "a property with bundles must identify both inventory types");

    const guestPage = await fetch(`${running.url}/nephihome`);
    const adminPage = await fetch(`${running.url}/nephihome/admin`);
    assert.equal(guestPage.status, 200, "a generic slug route must serve the guest page");
    assert.equal(adminPage.status, 200, "a generic slug route must serve the admin page");

    const invalid = await json(`${running.url}/api/public/property?slug=missing-property`);
    assert.equal(invalid.response.status, 404);
    assert.equal(invalid.body.error.message, "此查房連結無效，請重新由民宿官方連結進入。");

    app.providers.customerSettings.listRoomPriceOverrides = () => [{ roomId: "room301", date: checkInDate, price: 2500, currency: "TWD" }];
    const availability = await json(`${running.url}/api/public/availability?slug=nephihome&checkIn=${checkInDate}&checkOut=${checkOutDate}&guests=2`);
    assert.equal(availability.response.status, 200);
    assert.equal(availability.body.data.propertyName, "尼腓的家");
    assert.equal(Object.hasOwn(availability.body.data, "propertyId"), false, "public availability must not expose internal propertyId");
    assert.deepEqual(availability.body.data.rooms.map((item) => item.id), ["room301", "room302", "room401", "room402"], "public availability must use the slug-resolved property only");
    assert.equal(availability.body.data.rooms.find((item) => item.id === "room301").price, 2500, "a date-specific price must override the base weekday price");
    assert.deepEqual(availability.body.data.rooms.find((item) => item.id === "room301").nightlyPrices, [{ date: checkInDate, price: 2500 }], "public result must expose the formal nightly price used for the stay");
    assert.equal(availability.body.data.rooms.find((item) => item.id === "room302").price, 3000, "the matching weekday base price must be used when there is no date override");
    assert.equal(availability.body.data.rooms.find((item) => item.id === "room302").name, "家庭房", "public results must retain the formal property room name");
    assert.deepEqual(availability.body.data.rooms.find((item) => item.id === "room301"), { id: "room301", displayName: "陽光客房", name: "陽光客房", roomCode: "R-A", capacity: 2, highlights: ["採光佳", "安靜"], price: 2500, nightlyPrices: [{ date: checkInDate, price: 2500 }], currency: "TWD" }, "public cards must use the complete formal room presentation data");
    assert.equal(availability.body.data.lineUrl, "https://lin.ee/nephiOfficial", "public results must retain the current property's validated LINE URL");
    assert.equal(JSON.stringify(availability.body).includes("note"), false, "admin notes must never be public data");

    app.service.setDay({ customerId: "nephi_home", date: checkOutDate, roomId: "room301", status: "closed" });
    const multiNight = await json(`${running.url}/api/public/availability?slug=nephihome&checkIn=${checkInDate}&checkOut=${multiNightCheckOutDate}&guests=2`);
    assert.equal(multiNight.response.status, 200);
    assert.equal(multiNight.body.data.rooms.some((item) => item.id === "room301"), false, "a room closed on any night must not be shown for the full stay");
    assert.equal(multiNight.body.data.checkInDate, checkInDate);
    assert.equal(multiNight.body.data.checkOutDate, multiNightCheckOutDate);

    const roomUpdate = await fetch(`${running.url}/api/room-pricing`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "nephi_home", rooms: [{ roomTypeId: "room301", roomCode: "A-01", displayName: "更新客房", capacity: 3, highlights: [" 陽台 ", "陽台", "浴缸"], enabled: true, mondayThursdayPrice: 2100, fridayPrice: 2300, saturdayHolidayPrice: 2900, sundayPrice: 2200 }] }) });
    assert.equal(roomUpdate.status, 200, "admin must save complete room data through the existing property-scoped route");
    const savedRooms = (await json(`${running.url}/api/room-pricing?customerId=nephi_home`)).body.data.rooms;
    const savedRoom = savedRooms.find((room) => room.id === "room301");
    assert.equal(savedRoom.roomCode, "A-01");
    assert.equal(savedRoom.displayName, "更新客房");
    assert.equal(savedRoom.capacity, 3);
    assert.deepEqual(savedRoom.highlights, ["陽台", "浴缸"]);
    assert.equal((await json(`${running.url}/api/room-pricing?customerId=other_home`)).body.data.rooms[0].displayName, "另一間房", "room writes must remain property-scoped");

    const initialProfile = await json(`${running.url}/api/property-profile?propertyId=nephi_home`);
    assert.equal(initialProfile.body.data.latestArrivalTime, "21:30", "the profile API must load the property's existing optional latest-arrival time");
    const profileResponse = await fetch(`${running.url}/api/property-profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "nephi_home", propertyName: "更新後旅宿", googleMapsUrl: "https://maps.app.goo.gl/nephi", lineUrl: "https://lin.ee/nephiOfficial", contactInfo: "0900-000-000", checkInTime: "15:00", latestArrivalTime: "22:00", checkOutTime: "11:00" }) });
    const profile = await profileResponse.json();
    assert.equal(profileResponse.status, 200, "the minimal profile must update property-scoped data");
    assert.equal(profile.data.propertyName, "更新後旅宿");
    assert.equal(profile.data.checkInTime, "15:00");
    assert.equal(profile.data.latestArrivalTime, "22:00");
    assert.equal(profile.data.checkOutTime, "11:00");
    assert.equal(app.providers.customerSettings.getProperty("nephi_home").commonAnswers.latestArrivalTime, "22:00", "the JSON provider must round-trip the operator value");
    assert.equal(app.providers.customerSettings.getProperty("other_home").commonAnswers.latestArrivalTime, "20:00", "updating one property must not change another property");
    assert.equal((await json(`${running.url}/api/public/property?slug=nephihome`)).body.data.propertyName, "更新後旅宿", "public metadata must read the same property data");
    const invalidLine = await fetch(`${running.url}/api/property-profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "nephi_home", propertyName: "更新後旅宿", googleMapsUrl: "https://maps.app.goo.gl/nephi", lineUrl: "https://example.com/not-line", contactInfo: "", checkInTime: "15:00", checkOutTime: "11:00" }) });
    assert.equal(invalidLine.status, 400, "the profile must reject a non-LINE contact URL");
    const invalidLatestArrival = await fetch(`${running.url}/api/property-profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "nephi_home", propertyName: "更新後旅宿", googleMapsUrl: "https://maps.app.goo.gl/nephi", lineUrl: "https://lin.ee/nephiOfficial", contactInfo: "", checkInTime: "15:00", latestArrivalTime: "24:00", checkOutTime: "11:00" }) });
    assert.equal(invalidLatestArrival.status, 400, "the optional latest-arrival time must reject values outside HH:MM");
    assert.equal(app.providers.customerSettings.getProperty("nephi_home").commonAnswers.latestArrivalTime, "22:00", "an invalid update must not mutate the stored value");
    const clearLatestArrival = await fetch(`${running.url}/api/property-profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "nephi_home", propertyName: "更新後旅宿", googleMapsUrl: "https://maps.app.goo.gl/nephi", lineUrl: "https://lin.ee/nephiOfficial", contactInfo: "", checkInTime: "15:00", latestArrivalTime: "", checkOutTime: "11:00" }) });
    const clearedProfile = await clearLatestArrival.json();
    assert.equal(clearLatestArrival.status, 200);
    assert.equal(clearedProfile.data.latestArrivalTime, "");
    assert.equal(Object.hasOwn(app.providers.customerSettings.getProperty("nephi_home").commonAnswers, "latestArrivalTime"), false, "clearing the optional value must delete its JSON key");
    assert.equal(app.providers.customerSettings.getProperty("nephi_home").commonAnswers.checkInTime, "15:00");
    assert.equal(app.providers.customerSettings.getProperty("nephi_home").commonAnswers.checkOutTime, "11:00");
    assert.equal(app.providers.customerSettings.getProperty("other_home").commonAnswers.latestArrivalTime, "20:00", "clearing one property must not change another property");
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const alpha = property("alpha_home", "Alpha", "https://lin.ee/alpha");
  const beta = property("beta_home", "Beta", "https://lin.ee/beta");
  const rows = new Map([
    ["alpha_home", { date: checkInDate, double: "available", family: "available", bundle: "available" }],
    ["beta_home", { date: checkInDate, double: "available", family: "available", bundle: "closed" }]
  ]);
  const service = createMvpService({
    customerSettings: { getProperty: (id) => id === "alpha_home" ? alpha : id === "beta_home" ? beta : null, listProperties: () => [alpha, beta] },
    availability: {
      getRows: (id) => [rows.get(id)],
      setDay: (id, _date, roomId, status) => { const row = rows.get(id); row[roomId] = status; return row; },
      getDayNotes: () => [], setDayNote: () => null
    },
    persistence: {}
  });
  const search = (queryMode = "bundle_only") => service.searchAvailability({ customerId: "alpha_home", checkIn: checkInDate, checkOut: checkOutDate, queryMode });
  assert.deepEqual(search().rooms.map((room) => room.id), ["bundle"], "manual bundle availability plus all member rooms must make the bundle available");
  service.setDay({ customerId: "alpha_home", date: checkInDate, roomId: "bundle", status: "closed" });
  assert.equal(rows.get("alpha_home").double, "available", "closing a bundle must not close member rooms");
  assert.deepEqual(search().rooms.map((room) => room.id), [], "manual bundle close must hide only that bundle");
  service.setDay({ customerId: "alpha_home", date: checkInDate, roomId: "bundle", status: "available" });
  service.setDay({ customerId: "alpha_home", date: checkInDate, roomId: "double", status: "closed" });
  assert.deepEqual(search().rooms.map((room) => room.id), ["bundle"], "an explicitly available bundle must remain sellable when a member room is closed");
  assert.deepEqual(search("room_only").rooms.map((room) => room.id), ["family"], "a closed member room must not be offered as an individual room");
  service.setDay({ customerId: "alpha_home", date: checkInDate, roomId: "double", status: "available" });
  assert.deepEqual(search().rooms.map((room) => room.id), ["bundle"], "a manually-open bundle must recover once every member is available");
  assert.equal(service.searchAvailability({ customerId: "beta_home", checkIn: checkInDate, checkOut: checkOutDate, queryMode: "bundle_only" }).rooms.length, 0, "bundle availability must remain property-scoped");
  console.log("first version public admin: PASS");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
