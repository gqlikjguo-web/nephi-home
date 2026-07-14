"use strict";

const PROPERTY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const ROOM_FIELDS = Object.freeze(["301", "302", "401", "402"]);
const DAY_FIELDS = new Set(["date", ...ROOM_FIELDS]);
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

function validateAvailabilityDays(input) {
  if (!objectValue(input)) throw new Error("availability import must be a JSON object");
  assertNoAdditionalProperties(input, TOP_LEVEL_FIELDS, "$");
  const propertyId = String(input.propertyId || "").trim();
  if (!PROPERTY_ID_PATTERN.test(propertyId)) throw new Error("propertyId is required and must use lowercase letters, numbers, underscore or hyphen");
  if (!Array.isArray(input.days) || input.days.length < 1 || input.days.length > 1000) {
    throw new Error("days must contain 1 to 1000 items");
  }
  const days = input.days.map((day, index) => {
    const path = `days[${index}]`;
    if (!objectValue(day)) throw new Error(`${path} must be an object`);
    assertNoAdditionalProperties(day, DAY_FIELDS, path);
    if (!validDateKey(day.date)) throw new Error(`${path}.date must be a valid YYYY-MM-DD date`);
    const normalized = { date: day.date };
    for (const room of ROOM_FIELDS) {
      if (!Object.hasOwn(day, room)) throw new Error(`${path}.${room} is required`);
      if (!Object.hasOwn(STATUS_MAP, day[room])) throw new Error(`${path}.${room} must be open or closed`);
      normalized[room] = day[room];
    }
    return normalized;
  });
  return { propertyId, days };
}

function importAvailabilityDays(input, { providers } = {}) {
  const normalized = validateAvailabilityDays(input);
  if (!providers || !providers.customerSettings || !providers.availability) {
    throw new Error("CustomerSettingsProvider and AvailabilityProvider are required");
  }
  const property = providers.customerSettings.getProperty(normalized.propertyId);
  if (!property) throw new Error(`Unknown propertyId: ${normalized.propertyId}`);
  const configuredRooms = new Set((property.rooms || []).map((room) => room.id));
  for (const room of ROOM_FIELDS) {
    const roomId = `room${room}`;
    if (!configuredRooms.has(roomId)) throw new Error(`Configured property is missing room: ${roomId}`);
  }

  for (const day of normalized.days) {
    for (const room of ROOM_FIELDS) {
      providers.availability.setDay(normalized.propertyId, day.date, `room${room}`, STATUS_MAP[day[room]]);
    }
  }
  const dates = [...new Set(normalized.days.map((day) => day.date))];
  return { propertyId: normalized.propertyId, importedDays: dates.length, dates };
}

module.exports = {
  importAvailabilityDays,
  validateAvailabilityDays,
  ROOM_FIELDS,
  STATUS_MAP
};
