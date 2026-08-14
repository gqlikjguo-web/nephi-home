"use strict";

const { equipmentByCanonicalId } = require("../public/assets/high-frequency-equipment");

const FACT_CATEGORIES = new Set([
  "amenity",
  "policy",
  "property_fact",
  "location",
  "room_fact",
  "room_amenity",
  "contact"
]);
const FACT_STATUSES = new Set(["allowed", "conditional", "not_allowed", "unknown"]);
const APPLIES_TO = new Set(["whole_property", "bundle_only", "room_only", "both"]);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CANONICAL_ID_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const UNIT_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const SOURCE_PATTERN = /^[a-z][a-z0-9_:-]{0,79}$/;
const FACT_KEYS = new Set([
  "canonicalId",
  "publicName",
  "category",
  "status",
  "appliesTo",
  "publicText",
  "fees",
  "advanceNoticeRequired",
  "reservationRequired",
  "conditions",
  "restrictions",
  "operatingHours",
  "availablePeriods",
  "notes",
  "source",
  "updatedAt"
]);

function invalid(path) {
  const error = new Error(`invalid_property_fact:${path}`);
  error.code = "INVALID_PROPERTY_FACT";
  return error;
}

function clean(value, limit) {
  if (typeof value !== "string") throw invalid("string");
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, limit);
}

function booleanOrNull(value, path) {
  if (value === null || typeof value === "boolean") return value;
  throw invalid(path);
}

function stringList(value, path, maxItems = 20, maxLength = 300) {
  if (!Array.isArray(value) || value.length > maxItems) throw invalid(path);
  return value.map((item, index) => {
    const normalized = clean(item, maxLength);
    if (!normalized) throw invalid(`${path}.${index}`);
    return normalized;
  });
}

function normalizeFees(value, path) {
  if (!Array.isArray(value) || value.length > 20) throw invalid(path);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw invalid(`${path}.${index}`);
    const keys = Object.keys(item);
    if (keys.some((key) => !["label", "amount", "currency", "unit"].includes(key))) throw invalid(`${path}.${index}`);
    const label = clean(item.label, 80);
    const amount = Number(item.amount);
    const currency = clean(item.currency, 3).toUpperCase();
    const unit = clean(item.unit, 40).toLowerCase();
    if (!label || !Number.isFinite(amount) || amount < 0 || !CURRENCY_PATTERN.test(currency) || !UNIT_PATTERN.test(unit)) throw invalid(`${path}.${index}`);
    return { label, amount, currency, unit };
  });
}

function normalizeOperatingHours(value, path) {
  if (!Array.isArray(value) || value.length > 20) throw invalid(path);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw invalid(`${path}.${index}`);
    if (Object.keys(item).some((key) => !["label", "start", "end"].includes(key))) throw invalid(`${path}.${index}`);
    const label = clean(item.label, 80);
    const start = clean(item.start, 5);
    const end = clean(item.end, 5);
    if (!label || !TIME_PATTERN.test(start) || !TIME_PATTERN.test(end) || start === end) throw invalid(`${path}.${index}`);
    return { label, start, end };
  });
}

function normalizeAvailablePeriods(value, path) {
  if (!Array.isArray(value) || value.length > 20) throw invalid(path);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw invalid(`${path}.${index}`);
    if (Object.keys(item).some((key) => !["label", "startDate", "endDate"].includes(key))) throw invalid(`${path}.${index}`);
    const label = clean(item.label, 80);
    const startDate = clean(item.startDate, 10);
    const endDate = clean(item.endDate, 10);
    if (!label || !DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate) || startDate > endDate) throw invalid(`${path}.${index}`);
    return { label, startDate, endDate };
  });
}

function normalizePropertyFact(value, index) {
  const path = `facts.${index}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(path);
  if (Object.keys(value).some((key) => !FACT_KEYS.has(key))) throw invalid(path);
  const canonicalId = clean(value.canonicalId, 80).toLowerCase();
  const equipment = equipmentByCanonicalId(canonicalId);
  const hasPublicName = Object.hasOwn(value, "publicName");
  const publicName = hasPublicName ? (equipment ? equipment.publicName : clean(value.publicName, 120)) : "";
  const category = clean(value.category, 40).toLowerCase();
  let status = clean(value.status, 40).toLowerCase();
  let appliesTo = clean(value.appliesTo, 40).toLowerCase();
  const submittedPublicText = clean(value.publicText, 1000);
  const source = clean(value.source, 80).toLowerCase();
  const updatedAt = clean(value.updatedAt, 40);
  if (!CANONICAL_ID_PATTERN.test(canonicalId)) throw invalid(`${path}.canonicalId`);
  if (!FACT_CATEGORIES.has(category)) throw invalid(`${path}.category`);
  if (!FACT_STATUSES.has(status)) throw invalid(`${path}.status`);
  if (!APPLIES_TO.has(appliesTo)) throw invalid(`${path}.appliesTo`);
  if (equipment) {
    if (appliesTo === "both") appliesTo = "whole_property";
    else if (appliesTo === "room_only") {
      status = "unknown";
      appliesTo = "whole_property";
    }
    if (!["allowed", "conditional"].includes(status)) appliesTo = "whole_property";
  }
  if (!SOURCE_PATTERN.test(source)) throw invalid(`${path}.source`);
  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) throw invalid(`${path}.updatedAt`);
  const publicText = status === "unknown" ? "" : submittedPublicText;
  if (["allowed", "conditional"].includes(status) && !publicText) throw invalid(`${path}.publicText`);
  return {
    canonicalId,
    ...(publicName ? { publicName } : {}),
    category,
    status,
    appliesTo,
    publicText,
    fees: normalizeFees(value.fees, `${path}.fees`),
    advanceNoticeRequired: booleanOrNull(value.advanceNoticeRequired, `${path}.advanceNoticeRequired`),
    reservationRequired: booleanOrNull(value.reservationRequired, `${path}.reservationRequired`),
    conditions: stringList(value.conditions, `${path}.conditions`),
    restrictions: stringList(value.restrictions, `${path}.restrictions`),
    operatingHours: normalizeOperatingHours(value.operatingHours, `${path}.operatingHours`),
    availablePeriods: normalizeAvailablePeriods(value.availablePeriods, `${path}.availablePeriods`),
    notes: clean(value.notes, 1000),
    source,
    updatedAt: new Date(updatedAt).toISOString()
  };
}

function normalizePropertyFacts(value) {
  if (!Array.isArray(value) || value.length > 100) throw invalid("facts");
  const normalized = value.map(normalizePropertyFact);
  const ids = normalized.map((item) => item.canonicalId);
  if (new Set(ids).size !== ids.length) throw invalid("facts.duplicateCanonicalId");
  return normalized;
}

module.exports = {
  FACT_CATEGORIES,
  FACT_STATUSES,
  APPLIES_TO,
  normalizePropertyFacts
};
