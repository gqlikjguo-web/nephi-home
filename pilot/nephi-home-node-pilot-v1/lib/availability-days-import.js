"use strict";

const PROPERTY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const INVENTORY_ALIAS_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const TOP_LEVEL_FIELDS = new Set(["propertyId", "days"]);
const STATUS_MAP = Object.freeze({ open: "available", closed: "closed" });

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function assertNoAdditionalProperties(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is an additional property`);
  }
}

function validDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeInventoryAliases(value) {
  if (value instanceof Map) return new Map(value);
  if (Array.isArray(value)) return new Map(value.map((inventoryId) => [String(inventoryId), String(inventoryId)]));
  return new Map();
}

function validateAvailabilityDays(input, { inventoryAliases } = {}) {
  if (!objectValue(input)) throw new Error("availability import must be a JSON object");
  assertNoAdditionalProperties(input, TOP_LEVEL_FIELDS, "$");
  const propertyId = String(input.propertyId || "").trim();
  if (!PROPERTY_ID_PATTERN.test(propertyId)) throw new Error("propertyId is required and must use lowercase letters, numbers, underscore or hyphen");
  if (!Array.isArray(input.days) || input.days.length < 1 || input.days.length > 1000) {
    throw new Error("days must contain 1 to 1000 items");
  }
  let aliases = normalizeInventoryAliases(inventoryAliases);
  const days = input.days.map((day, index) => {
    const path = `days[${index}]`;
    if (!objectValue(day)) throw new Error(`${path} must be an object`);
    if (!validDateKey(day.date)) throw new Error(`${path}.date must be a valid YYYY-MM-DD date`);
    const suppliedAliases = Object.keys(day).filter((key) => key !== "date");
    if (!aliases.size) {
      if (!suppliedAliases.length) throw new Error(`${path} must contain inventory statuses`);
      aliases = new Map(suppliedAliases.map((key) => [key, key]));
    }
    const inventory = {};
    for (const key of suppliedAliases) {
      if (!INVENTORY_ALIAS_PATTERN.test(key) || !aliases.has(key)) throw new Error(`${path}.${key} is an additional property`);
      const inventoryId = aliases.get(key);
      if (Object.hasOwn(inventory, inventoryId)) throw new Error(`${path}.${key} duplicates inventory ${inventoryId}`);
      if (!Object.hasOwn(STATUS_MAP, day[key])) throw new Error(`${path}.${key} must be open or closed`);
      inventory[inventoryId] = STATUS_MAP[day[key]];
    }
    const requiredInventoryIds = new Set(aliases.values());
    for (const inventoryId of requiredInventoryIds) {
      if (!Object.hasOwn(inventory, inventoryId)) throw new Error(`${path}.${inventoryId} is required`);
    }
    return { date: day.date, inventory };
  });
  return { propertyId, days };
}

function inventoryAliasesForProperty(property) {
  const aliases = new Map();
  for (const room of property.rooms || []) {
    const roomId = String(room && room.id || "").trim();
    if (!INVENTORY_ALIAS_PATTERN.test(roomId)) throw new Error("Configured property has an invalid room id");
    const candidates = new Set([roomId]);
    const leadingNameCode = String(room.name || "").trim().match(/^[a-zA-Z0-9][a-zA-Z0-9_-]*/)?.[0];
    if (leadingNameCode) candidates.add(leadingNameCode);
    if (roomId.startsWith("room") && roomId.length > 4) candidates.add(roomId.slice(4));
    for (const alias of candidates) {
      if (!INVENTORY_ALIAS_PATTERN.test(alias)) continue;
      if (aliases.has(alias) && aliases.get(alias) !== roomId) throw new Error(`Configured property has ambiguous room alias: ${alias}`);
      aliases.set(alias, roomId);
    }
  }
  return aliases;
}

function importAvailabilityDays(input, { providers } = {}) {
  if (!providers || !providers.customerSettings || !providers.availability) {
    throw new Error("CustomerSettingsProvider and AvailabilityProvider are required");
  }
  const propertyId = String(input && input.propertyId || "").trim();
  if (!PROPERTY_ID_PATTERN.test(propertyId)) throw new Error("propertyId is required and must use lowercase letters, numbers, underscore or hyphen");
  const property = providers.customerSettings.getProperty(propertyId);
  if (!property) throw new Error(`Unknown propertyId: ${propertyId}`);
  const normalized = validateAvailabilityDays(input, {
    inventoryAliases: inventoryAliasesForProperty(property)
  });

  for (const day of normalized.days) {
    for (const [inventoryId, status] of Object.entries(day.inventory)) {
      providers.availability.setDay(normalized.propertyId, day.date, inventoryId, status);
    }
  }
  const dates = [...new Set(normalized.days.map((day) => day.date))];
  return { propertyId: normalized.propertyId, importedDays: dates.length, dates };
}

module.exports = {
  importAvailabilityDays,
  validateAvailabilityDays,
  inventoryAliasesForProperty,
  STATUS_MAP
};
