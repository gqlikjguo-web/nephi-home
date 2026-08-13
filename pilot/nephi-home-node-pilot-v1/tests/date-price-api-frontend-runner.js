"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");

async function request(url, options) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

async function write(base, pathname, method, body) {
  return request(`${base}${pathname}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function publicAvailability(base) {
  return (await request(`${base}/api/public/availability?slug=propertya&checkIn=2026-09-21&checkOut=2026-09-22&guests=2&queryMode=any&roomType=all`)).body.data;
}

async function run() {
  const adminHtml = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
  const adminScript = fs.readFileSync(path.join(__dirname, "../public/assets/admin.js"), "utf8");
  assert.doesNotMatch(adminHtml, /id="dateClassificationForm"/, "the pricing tab must not retain the duplicate date-classification form");
  assert.doesNotMatch(adminHtml, /id="overrideForm"/, "the pricing tab must not retain the duplicate inventory override form");
  assert.match(adminHtml, /id="priceEditor"/, "availability must expose one inventory price editor");
  assert.doesNotMatch(adminHtml, /id="priceEditorMode"/, "the cell editor must not expose price-type modes");
  assert.match(adminHtml, /id="priceEditorSpecialPrice"[^>]*required/, "the cell editor must expose one required direct-price input");
  assert.match(adminHtml, /id="priceEditorClear"/, "the cell editor must expose restoring automatic pricing");
  assert.match(adminScript, /openInventoryPriceEditor/, "each availability inventory cell must open the shared price editor");
  assert.doesNotMatch(adminScript, /openDatePriceEditor/, "availability date headings must not expose date-classification editing");
  assert.doesNotMatch(adminScript, /date-price-button/, "availability date headings must remain simple date summaries");
  assert.doesNotMatch(adminScript, /priceEditorMode/, "the inventory editor must not depend on a mode selector");
  assert.match(adminScript, /body\.price\s*=\s*Number\(\$\("priceEditorSpecialPrice"\)\.value\)/, "the inventory editor must submit the direct single-day price");
  assert.match(adminScript, /\/api\/inventory-price-overrides/, "admin must use the generic room/bundle override API");
  assert.doesNotMatch(adminScript, /\/api\/date-price-classifications/, "admin must not expose date-classification writes");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "date-price-api-"));
  const seedFile = path.join(temp, "seed.json");
  const dataFile = path.join(temp, "data.json");
  fs.writeFileSync(seedFile, JSON.stringify({
    testOnly: true,
    homestays: [{
      customerId: "property_a",
      name: "Property A",
      rooms: [
        { id: "room-a", name: "Room A", capacity: 2, enabled: true, mondayThursdayPrice: 1000, fridayPrice: 1200, saturdayHolidayPrice: 1600, sundayPrice: 1100 },
        { id: "bundle-a", name: "Bundle A", inventoryType: "bundle", memberRoomIds: ["room-a"], capacity: 8, enabled: true, mondayThursdayPrice: 5000, fridayPrice: 6000, saturdayHolidayPrice: 8000, sundayPrice: 5500 }
      ]
    }],
    messageLogs: { property_a: [] }
  }));
  const app = createApp({ providers: createJsonProviders({ dataFile, seedFile }), adminAuthRequired: false });
  const running = await app.start(0, "127.0.0.1");
  try {
    const classification = await write(running.url, "/api/date-price-classifications", "POST", { propertyId: "property_a", date: "2026-09-21", priceType: "saturday_holiday" });
    assert.equal(classification.response.status, 200);
    let publicData = await publicAvailability(running.url);
    assert.equal(publicData.rooms.find((item) => item.id === "room-a").price, 1600, "public room price must use the formal holiday classification");
    assert.equal(publicData.bundles.find((item) => item.id === "bundle-a").price, 8000, "public bundle price must use the same formal holiday classification");
    let adminPrices = await request(`${running.url}/api/room-pricing?customerId=property_a&date=2026-09-21`);
    assert.deepEqual(adminPrices.body.data.dailyPrices.map((item) => [item.inventoryType, item.inventoryId, item.price, item.source]), [
      ["room", "room-a", 1600, "property_date_classification"],
      ["bundle", "bundle-a", 8000, "property_date_classification"]
    ], "availability cells must receive room and bundle prices projected by the existing authority");

    const roomOverride = await write(running.url, "/api/inventory-price-overrides", "POST", { propertyId: "property_a", inventoryType: "room", inventoryId: "room-a", date: "2026-09-21", price: 2345 });
    assert.equal(roomOverride.response.status, 200);
    const bundleOverride = await write(running.url, "/api/inventory-price-overrides", "POST", { propertyId: "property_a", inventoryType: "bundle", inventoryId: "bundle-a", date: "2026-09-21", price: 6789 });
    assert.equal(bundleOverride.response.status, 200);
    publicData = await publicAvailability(running.url);
    assert.equal(publicData.rooms.find((item) => item.id === "room-a").price, 2345, "direct special price must beat the holiday");
    assert.equal(publicData.bundles.find((item) => item.id === "bundle-a").price, 6789, "direct bundle price must beat the holiday");
    adminPrices = await request(`${running.url}/api/room-pricing?customerId=property_a&date=2026-09-21`);
    assert.deepEqual(adminPrices.body.data.dailyPrices.map((item) => [item.inventoryType, item.inventoryId, item.price, item.source]), [
      ["room", "room-a", 2345, "price_override"],
      ["bundle", "bundle-a", 6789, "price_override"]
    ], "availability cells must refresh to the same saved room and bundle override authority");

    const pricing = await request(`${running.url}/api/room-pricing?customerId=property_a`);
    assert.deepEqual(pricing.body.data.inventories.map((item) => [item.inventoryType, item.id]), [["room","room-a"],["bundle","bundle-a"]]);
    assert.equal(pricing.body.data.overrides.length, 2);
    assert.deepEqual(pricing.body.data.datePriceClassifications, [{ date: "2026-09-21", priceType: "saturday_holiday" }]);

    const cleared = await write(running.url, "/api/inventory-price-overrides", "DELETE", { propertyId: "property_a", inventoryType: "room", inventoryId: "room-a", date: "2026-09-21" });
    assert.equal(cleared.response.status, 200);
    assert.equal((await publicAvailability(running.url)).rooms.find((item) => item.id === "room-a").price, 1600, "clearing an override must restore automatic holiday pricing");

    const clearedBundle = await write(running.url, "/api/inventory-price-overrides", "DELETE", { propertyId: "property_a", inventoryType: "bundle", inventoryId: "bundle-a", date: "2026-09-21" });
    assert.equal(clearedBundle.response.status, 200);
    assert.equal((await publicAvailability(running.url)).bundles.find((item) => item.id === "bundle-a").price, 8000, "clearing a bundle override must restore automatic holiday pricing");
    await write(running.url, "/api/date-price-classifications", "DELETE", { propertyId: "property_a", date: "2026-09-21" });
    assert.equal((await publicAvailability(running.url)).rooms.find((item) => item.id === "room-a").price, 1000, "clearing the date classification must restore weekday pricing");
    console.log("date price API/frontend: PASS");
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { run };
