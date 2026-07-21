"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createMvpService } = require("../lib/mvp-service");

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

(async () => {
  const guestScript = fs.readFileSync(path.join(__dirname, "../public/assets/guest.js"), "utf8");
  const adminScript = fs.readFileSync(path.join(__dirname, "../public/assets/admin.js"), "utf8");
  const guestCss = fs.readFileSync(path.join(__dirname, "../public/assets/guest.css"), "utf8");
  const adminCss = fs.readFileSync(path.join(__dirname, "../public/assets/styles.css"), "utf8");
  assert.equal(guestScript.includes("propertyId"), false, "guest code must not accept or expose propertyId");
  assert.match(guestScript, /inventoryOptions/, "guest room choices must be supplied by public property data");
  assert.match(guestScript, /lineDisclaimer/, "guest results must include the LINE booking disclaimer");
  assert.match(adminScript, /status-toggle/, "admin availability must use a single controlled toggle");
  assert.match(adminScript, /已備註/, "admin must distinguish existing notes from empty notes");
  assert.match(adminScript, /已有特殊價格，確定覆蓋/, "overwriting a special price must require confirmation");
  assert.match(adminScript, /bundleStatus/, "bundle writes must expose explicit success or failure feedback");
  assert.match(guestCss, /max-width: 390px/, "guest mobile layout must include a narrow-screen rule");
  assert.match(adminCss, /status-toggle/, "the admin toggle must have an explicit mobile-safe presentation");
  assert.match(adminCss, /max-width:\s*640px/, "the admin workspace must include a mobile layout rule");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-public-admin-"));
  const seedFile = path.join(temp, "seed.json");
  const dataFile = path.join(temp, "data.json");
  fs.writeFileSync(seedFile, JSON.stringify({
    testOnly: true,
    homestays: [{
      customerId: "nephi_home",
      name: "尼腓的家",
      lineUrl: "https://lin.ee/nephiOfficial",
      businessProfile: { googleMapsUrl: "https://maps.app.goo.gl/nephi" },
      safeFacts: { checkInTime: "15:00", checkOutTime: "11:00" },
      rooms: [
        { id: "room301", name: "雙人房", type: "double", capacity: 2, enabled: true, mondayThursdayPrice: 2000 },
        { id: "room302", name: "家庭房", type: "family", capacity: 4, enabled: true, mondayThursdayPrice: 3000 },
        { id: "room401", name: "景觀雙人房", type: "double", capacity: 2, enabled: true, mondayThursdayPrice: 2200 },
        { id: "room402", name: "景觀家庭房", type: "family", capacity: 4, enabled: true, mondayThursdayPrice: 3200 }
      ]
    }, {
      customerId: "other_home",
      name: "另一間旅宿",
      lineUrl: "https://lin.ee/otherOfficial",
      rooms: [{ id: "other", name: "另一間房", type: "other", capacity: 2, enabled: true, mondayThursdayPrice: 1000 }],
      availability: { "2026-08-06": { other: "available" } }
    }],
    messageLogs: { nephi_home: [], other_home: [] }
  }));
  const app = createApp({ dataFile, seedFile, lineChannelIdentityGuardRequired: false, adminAuthRequired: false });
  const running = await app.start(0, "127.0.0.1");
  try {
    const metadata = await json(`${running.url}/api/public/property?slug=nephihome`);
    assert.equal(metadata.response.status, 200, "a generic public slug must resolve without exposing propertyId");
    assert.equal(metadata.body.data.propertyName, "尼腓的家");
    assert.equal(Object.hasOwn(metadata.body.data, "propertyId"), false);
    assert.deepEqual(metadata.body.data.inventoryOptions.map((item) => item.id), ["all", "room301", "room302", "room401", "room402"], "guest options must come from the current property data");
    assert.equal(metadata.body.data.lineUrl, "https://lin.ee/nephiOfficial");

    const guestPage = await fetch(`${running.url}/nephihome`);
    const adminPage = await fetch(`${running.url}/nephihome/admin`);
    assert.equal(guestPage.status, 200, "a generic slug route must serve the guest page");
    assert.equal(adminPage.status, 200, "a generic slug route must serve the admin page");

    const invalid = await json(`${running.url}/api/public/property?slug=missing-property`);
    assert.equal(invalid.response.status, 404);
    assert.equal(invalid.body.error.message, "此查房連結無效，請重新由民宿官方連結進入。");

    const availability = await json(`${running.url}/api/public/availability?slug=nephihome&checkIn=2026-08-06&checkOut=2026-08-07&guests=2`);
    assert.equal(availability.response.status, 200);
    assert.equal(availability.body.data.propertyName, "尼腓的家");
    assert.deepEqual(availability.body.data.rooms.map((item) => item.id), ["room301", "room302", "room401", "room402"], "public availability must use the slug-resolved property only");
    assert.equal(JSON.stringify(availability.body).includes("note"), false, "admin notes must never be public data");

    const profileResponse = await fetch(`${running.url}/api/property-profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "nephi_home", propertyName: "更新後旅宿", googleMapsUrl: "https://maps.app.goo.gl/nephi", lineUrl: "https://lin.ee/nephiOfficial", contactInfo: "0900-000-000", checkInTime: "15:00", checkOutTime: "11:00" }) });
    const profile = await profileResponse.json();
    assert.equal(profileResponse.status, 200, "the minimal profile must update property-scoped data");
    assert.equal(profile.data.propertyName, "更新後旅宿");
    assert.equal((await json(`${running.url}/api/public/property?slug=nephihome`)).body.data.propertyName, "更新後旅宿", "public metadata must read the same property data");
    const invalidLine = await fetch(`${running.url}/api/property-profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "nephi_home", propertyName: "更新後旅宿", googleMapsUrl: "https://maps.app.goo.gl/nephi", lineUrl: "https://example.com/not-line", contactInfo: "", checkInTime: "15:00", checkOutTime: "11:00" }) });
    assert.equal(invalidLine.status, 400, "the profile must reject a non-LINE contact URL");
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const alpha = property("alpha_home", "Alpha", "https://lin.ee/alpha");
  const beta = property("beta_home", "Beta", "https://lin.ee/beta");
  const rows = new Map([
    ["alpha_home", { date: "2026-08-06", double: "available", family: "available", bundle: "available" }],
    ["beta_home", { date: "2026-08-06", double: "available", family: "available", bundle: "closed" }]
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
  const search = () => service.searchAvailability({ customerId: "alpha_home", checkIn: "2026-08-06", checkOut: "2026-08-07", queryMode: "bundle_only" });
  assert.deepEqual(search().rooms.map((room) => room.id), ["bundle"], "manual bundle availability plus all member rooms must make the bundle available");
  service.setDay({ customerId: "alpha_home", date: "2026-08-06", roomId: "bundle", status: "closed" });
  assert.equal(rows.get("alpha_home").double, "available", "closing a bundle must not close member rooms");
  assert.deepEqual(search().rooms.map((room) => room.id), [], "manual bundle close must hide only that bundle");
  service.setDay({ customerId: "alpha_home", date: "2026-08-06", roomId: "bundle", status: "available" });
  service.setDay({ customerId: "alpha_home", date: "2026-08-06", roomId: "double", status: "closed" });
  assert.deepEqual(search().rooms.map((room) => room.id), [], "a closed member room must make the bundle unavailable");
  service.setDay({ customerId: "alpha_home", date: "2026-08-06", roomId: "double", status: "available" });
  assert.deepEqual(search().rooms.map((room) => room.id), ["bundle"], "a manually-open bundle must recover once every member is available");
  assert.equal(service.searchAvailability({ customerId: "beta_home", checkIn: "2026-08-06", checkOut: "2026-08-07", queryMode: "bundle_only" }).rooms.length, 0, "bundle availability must remain property-scoped");
  console.log("first version public admin: PASS");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
