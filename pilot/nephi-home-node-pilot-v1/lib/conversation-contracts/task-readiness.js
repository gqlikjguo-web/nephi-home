"use strict";

const {
  createLodgingProduct,
  validateLodgingProduct
} = require("./lodging-product");

const TASK_READINESS_REQUIREMENTS = Object.freeze({
  availability: Object.freeze(["checkIn", "checkOut"]),
  pricing: Object.freeze(["checkIn", "checkOut"]),
  available_dates: Object.freeze(["searchFrom", "searchTo"]),
  room_options: Object.freeze(["checkIn", "checkOut"]),
  capacity: Object.freeze(["checkIn", "checkOut", "guestCount"]),
  parking: Object.freeze([]),
  location: Object.freeze([]),
  bbq: Object.freeze([]),
  pool: Object.freeze([]),
  property_fact: Object.freeze([]),
  amenity: Object.freeze([]),
  policy: Object.freeze([]),
  amenity_list: Object.freeze([]),
  booking_request: Object.freeze([]),
  human_help: Object.freeze([]),
  high_risk: Object.freeze([]),
  unknown: Object.freeze([])
});

const KNOWN_FIELD_ORDER = Object.freeze([
  "productType",
  "productId",
  "roomTypeId",
  "bundleId",
  "checkIn",
  "checkOut",
  "guestCount",
  "searchFrom",
  "searchTo"
]);

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeInput(value = {}) {
  return {
    taskType: String(value.taskType || "").trim(),
    productType: String(value.productType || "").trim(),
    productId: textOrNull(value.productId),
    roomTypeId: textOrNull(value.roomTypeId),
    bundleId: textOrNull(value.bundleId),
    checkIn: textOrNull(value.checkIn),
    checkOut: textOrNull(value.checkOut),
    guestCount: value.guestCount === null || value.guestCount === undefined
      ? null
      : Number(value.guestCount),
    searchFrom: textOrNull(value.searchFrom),
    searchTo: textOrNull(value.searchTo)
  };
}

function provided(value) {
  return value !== null && value !== undefined && value !== "";
}

function knownFields(input) {
  return KNOWN_FIELD_ORDER.filter((field) => provided(input[field]));
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function evaluateTaskReadiness(value) {
  const input = normalizeInput(value);
  const known = knownFields(input);
  const requirements = TASK_READINESS_REQUIREMENTS[input.taskType];
  if (!requirements) {
    return {
      status: "unsupported",
      knownFields: known,
      missingFields: [],
      invalidFields: ["taskType"]
    };
  }

  const productValidation = validateLodgingProduct(input);
  const missingFields = requirements.filter((field) => !provided(input[field]));
  const invalidFields = [];

  if (!productValidation.ok) invalidFields.push("product");
  for (const field of ["checkIn", "checkOut", "searchFrom", "searchTo"]) {
    if (provided(input[field]) && !validIsoDate(input[field])) {
      invalidFields.push(field);
    }
  }
  if (provided(input.guestCount)
    && (!Number.isInteger(input.guestCount) || input.guestCount < 1)) {
    invalidFields.push("guestCount");
  }
  if (validIsoDate(input.checkIn)
    && validIsoDate(input.checkOut)
    && input.checkOut <= input.checkIn) {
    invalidFields.push("dateRange");
  }
  if (validIsoDate(input.searchFrom)
    && validIsoDate(input.searchTo)
    && input.searchTo < input.searchFrom) {
    invalidFields.push("searchRange");
  }

  if (invalidFields.length) {
    return {
      status: "invalid",
      knownFields: known,
      missingFields,
      invalidFields: [...new Set(invalidFields)]
    };
  }
  if (missingFields.length) {
    return {
      status: "missing",
      knownFields: known,
      missingFields,
      invalidFields: []
    };
  }

  createLodgingProduct(input);
  return {
    status: "ready",
    knownFields: known,
    missingFields: [],
    invalidFields: []
  };
}

module.exports = {
  TASK_READINESS_REQUIREMENTS,
  evaluateTaskReadiness
};
