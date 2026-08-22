"use strict";

const assert = require("node:assert/strict");
const { buildPricingFacts } = require("../lib/conversation-engine-v2/capability-executor");

const room = {
  id: "room-a",
  name: "A 房",
  capacity: 2,
  enabled: true,
  mondayThursdayPrice: 1000,
  fridayPrice: 1200,
  saturdayHolidayPrice: 1600,
  sundayPrice: 1100
};
const bundle = {
  id: "bundle-a",
  name: "A 包棟",
  inventoryType: "bundle",
  capacity: 8,
  enabled: true,
  mondayThursdayPrice: 5000,
  fridayPrice: 6000,
  saturdayHolidayPrice: 8000,
  sundayPrice: 5500
};
const property = { propertyId: "property-a", currency: "TWD", rooms: [room, bundle] };

function addDay(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function nightly(inventory, date, options = {}) {
  const result = buildPricingFacts({
    property,
    availableInventory: [{ canonicalId: inventory.id }],
    checkIn: date,
    checkOut: addDay(date),
    priceOverrides: options.priceOverrides || [],
    datePriceClassifications: options.datePriceClassifications || []
  });
  return result.prices[0].daily[0];
}

assert.deepEqual(nightly(room, "2026-09-21"), { date: "2026-09-21", price: 1000, source: "room_pricing" }, "Monday must retain the Monday-Thursday base price");
assert.deepEqual(nightly(room, "2026-09-18"), { date: "2026-09-18", price: 1200, source: "room_pricing" }, "an ordinary Friday must retain the Friday base price");
assert.deepEqual(nightly(room, "2026-09-19"), { date: "2026-09-19", price: 1600, source: "room_pricing" }, "an ordinary Saturday must retain the Saturday/holiday base price");
assert.deepEqual(nightly(room, "2026-09-20"), { date: "2026-09-20", price: 1100, source: "room_pricing" }, "an ordinary Sunday must retain the Sunday base price");

assert.deepEqual(
  nightly(room, "2026-02-16"),
  { date: "2026-02-16", price: 1600, source: "official_continuous_holiday" },
  "a weekday inside an official 2026 continuous holiday must use the Saturday/holiday price"
);
assert.deepEqual(
  nightly(bundle, "2027-02-08"),
  { date: "2027-02-08", price: 8000, source: "official_continuous_holiday" },
  "a bundle weekday inside an official 2027 continuous holiday must use the Saturday/holiday price"
);
assert.deepEqual(
  nightly(room, "2027-12-31"),
  { date: "2027-12-31", price: 1600, source: "official_continuous_holiday" },
  "the first day of the official cross-year holiday must use the Saturday/holiday price"
);
assert.deepEqual(
  nightly(room, "2028-01-02"),
  { date: "2028-01-02", price: 1600, source: "official_continuous_holiday" },
  "the final day of the official cross-year holiday must remain in the same official range"
);

assert.deepEqual(
  nightly(room, "2026-09-21", { datePriceClassifications: [{ date: "2026-09-21", priceType: "saturday_holiday" }] }),
  { date: "2026-09-21", price: 1600, source: "property_date_classification" },
  "a formal property holiday classification must beat the weekday base"
);

assert.deepEqual(
  nightly(room, "2026-02-16", { datePriceClassifications: [{ date: "2026-02-16", priceType: "friday" }] }),
  { date: "2026-02-16", price: 1200, source: "property_date_classification" },
  "a property date classification must beat the official continuous holiday"
);

assert.deepEqual(
  nightly(bundle, "2026-09-21", { priceOverrides: [{ inventoryType: "bundle", inventoryId: "bundle-a", date: "2026-09-21", priceType: "friday" }] }),
  { date: "2026-09-21", price: 6000, source: "inventory_price_type_override" },
  "a bundle date price-type override must beat property classification and weekday base"
);

assert.deepEqual(
  nightly(room, "2026-09-21", {
    priceOverrides: [{ inventoryType: "room", inventoryId: "room-a", roomId: "room-a", date: "2026-09-21", price: 2345 }],
    datePriceClassifications: [{ date: "2026-09-21", priceType: "saturday_holiday" }]
  }),
  { date: "2026-09-21", price: 2345, source: "price_override" },
  "a direct inventory special price must have the highest priority"
);

assert.deepEqual(
  nightly(room, "2026-02-16", {
    priceOverrides: [{ inventoryType: "room", inventoryId: "room-a", roomId: "room-a", date: "2026-02-16", price: 2468 }]
  }),
  { date: "2026-02-16", price: 2468, source: "price_override" },
  "a direct single-day price must beat the official continuous holiday"
);

console.log("date price authority: PASS");
