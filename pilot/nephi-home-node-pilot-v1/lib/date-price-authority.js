"use strict";

const PRICE_TYPES = Object.freeze({
  MONDAY_THURSDAY: "monday_thursday",
  FRIDAY: "friday",
  SATURDAY_HOLIDAY: "saturday_holiday",
  SUNDAY: "sunday"
});

const PRICE_KEYS = Object.freeze({
  [PRICE_TYPES.MONDAY_THURSDAY]: "mondayThursdayPrice",
  [PRICE_TYPES.FRIDAY]: "fridayPrice",
  [PRICE_TYPES.SATURDAY_HOLIDAY]: "saturdayHolidayPrice",
  [PRICE_TYPES.SUNDAY]: "sundayPrice"
});

const OFFICIAL_CONTINUOUS_HOLIDAY_RANGES = Object.freeze([
  ["2026-02-14", "2026-02-22"],
  ["2026-02-27", "2026-03-01"],
  ["2026-04-03", "2026-04-06"],
  ["2026-05-01", "2026-05-03"],
  ["2026-06-19", "2026-06-21"],
  ["2026-09-25", "2026-09-28"],
  ["2026-10-09", "2026-10-11"],
  ["2026-10-24", "2026-10-26"],
  ["2026-12-25", "2026-12-27"],
  ["2027-01-01", "2027-01-03"],
  ["2027-02-04", "2027-02-10"],
  ["2027-02-27", "2027-03-01"],
  ["2027-04-03", "2027-04-06"],
  ["2027-04-30", "2027-05-02"],
  ["2027-10-09", "2027-10-11"],
  ["2027-10-23", "2027-10-25"],
  ["2027-12-24", "2027-12-26"],
  ["2027-12-31", "2028-01-02"]
]);

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isPriceType(value) {
  return Object.hasOwn(PRICE_KEYS, String(value || ""));
}

function weekdayPriceType(date) {
  if (!isDateKey(date)) return null;
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  if (weekday === 0) return PRICE_TYPES.SUNDAY;
  if (weekday === 5) return PRICE_TYPES.FRIDAY;
  if (weekday === 6) return PRICE_TYPES.SATURDAY_HOLIDAY;
  return PRICE_TYPES.MONDAY_THURSDAY;
}

function isOfficialContinuousHoliday(date) {
  return isDateKey(date) && OFFICIAL_CONTINUOUS_HOLIDAY_RANGES.some(([start, end]) => date >= start && date <= end);
}

function inventoryType(inventory) {
  return inventory && inventory.inventoryType === "bundle" ? "bundle" : "room";
}

function overrideInventoryId(override) {
  if (!override) return "";
  return String(override.inventoryId || override.bundleId || override.roomId || "");
}

function matchesInventory(override, inventory, date) {
  if (!override || override.date !== date || overrideInventoryId(override) !== String(inventory.id || "")) return false;
  const kind = inventoryType(inventory);
  if (override.inventoryType && override.inventoryType !== kind) return false;
  if (!override.inventoryType && override.bundleId && kind !== "bundle") return false;
  if (!override.inventoryType && override.roomId && kind !== "room") return false;
  return true;
}

function priceForType(inventory, priceType) {
  if (!isPriceType(priceType)) return null;
  const price = Number(inventory && inventory[PRICE_KEYS[priceType]]);
  return Number.isInteger(price) && price > 0 ? price : null;
}

function resolveDatePrice({ inventory, date, priceOverrides = [], datePriceClassifications = [] }) {
  if (!inventory || !isDateKey(date)) return { price: null, source: "invalid_price_request", priceType: null };

  const override = priceOverrides.find((item) => matchesInventory(item, inventory, date));
  if (override) {
    if (override.price !== undefined && override.price !== null) {
      const price = Number(override.price);
      return { price: Number.isInteger(price) && price > 0 ? price : null, source: "price_override", priceType: null };
    }
    const priceType = isPriceType(override.priceType) ? override.priceType : null;
    return { price: priceForType(inventory, priceType), source: "inventory_price_type_override", priceType };
  }

  const classification = datePriceClassifications.find((item) => item && item.date === date);
  if (classification) {
    const priceType = isPriceType(classification.priceType) ? classification.priceType : null;
    return { price: priceForType(inventory, priceType), source: "property_date_classification", priceType };
  }

  if (isOfficialContinuousHoliday(date)) {
    const priceType = PRICE_TYPES.SATURDAY_HOLIDAY;
    return { price: priceForType(inventory, priceType), source: "official_continuous_holiday", priceType };
  }

  const priceType = weekdayPriceType(date);
  return { price: priceForType(inventory, priceType), source: "room_pricing", priceType };
}

module.exports = {
  PRICE_TYPES,
  PRICE_KEYS,
  isDateKey,
  isPriceType,
  weekdayPriceType,
  priceForType,
  resolveDatePrice
};
