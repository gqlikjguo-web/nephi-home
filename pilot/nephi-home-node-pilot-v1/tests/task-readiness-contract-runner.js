"use strict";

const assert = require("node:assert/strict");
const {
  evaluateTaskReadiness,
  TASK_READINESS_REQUIREMENTS
} = require("../lib/conversation-contracts/task-readiness");

function readiness(input) {
  return evaluateTaskReadiness({
    taskType: input.taskType,
    productType: input.productType || "any",
    productId: input.productId || null,
    roomTypeId: input.roomTypeId || null,
    bundleId: input.bundleId || null,
    checkIn: input.checkIn || null,
    checkOut: input.checkOut || null,
    guestCount: input.guestCount === undefined ? null : input.guestCount,
    searchFrom: input.searchFrom || null,
    searchTo: input.searchTo || null
  });
}

assert.deepEqual(TASK_READINESS_REQUIREMENTS.availability, [
  "checkIn",
  "checkOut"
]);
assert.deepEqual(TASK_READINESS_REQUIREMENTS.pricing, [
  "checkIn",
  "checkOut"
]);
assert.deepEqual(TASK_READINESS_REQUIREMENTS.available_dates, [
  "searchFrom",
  "searchTo"
]);
assert.deepEqual(TASK_READINESS_REQUIREMENTS.capacity, []);

for (const product of [
  {
    productType: "any"
  },
  {
    productType: "room_type",
    productId: "alpha-double",
    roomTypeId: "alpha-double"
  },
  {
    productType: "bundle",
    productId: "alpha-whole-house",
    bundleId: "alpha-whole-house"
  }
]) {
  assert.deepEqual(
    readiness({
      taskType: "availability",
      ...product,
      checkIn: "2026-07-30",
      checkOut: "2026-07-31"
    }),
    {
      status: "ready",
      knownFields: [
        "productType",
        ...(product.productId ? ["productId"] : []),
        ...(product.roomTypeId ? ["roomTypeId"] : []),
        ...(product.bundleId ? ["bundleId"] : []),
        "checkIn",
        "checkOut"
      ],
      missingFields: [],
      invalidFields: []
    },
    "room_type and bundle availability must use the same readiness contract"
  );
  assert.deepEqual(
    readiness({
      taskType: "capacity",
      ...product
    }),
    {
      status: "ready",
      knownFields: [
        "productType",
        ...(product.productId ? ["productId"] : []),
        ...(product.roomTypeId ? ["roomTypeId"] : []),
        ...(product.bundleId ? ["bundleId"] : [])
      ],
      missingFields: [],
      invalidFields: []
    },
    "room and bundle capacity must be a date-free catalog fact"
  );
}

assert.deepEqual(
  readiness({
    taskType: "pricing",
    productType: "any"
  }),
  {
    status: "missing",
    knownFields: ["productType"],
    missingFields: ["checkIn", "checkOut"],
    invalidFields: []
  }
);

assert.deepEqual(
  readiness({
    taskType: "available_dates",
    productType: "room_type",
    productId: "alpha-double",
    roomTypeId: "alpha-double",
    searchFrom: "2026-07-30",
    searchTo: "2026-08-30"
  }),
  {
    status: "ready",
    knownFields: [
      "productType",
      "productId",
      "roomTypeId",
      "searchFrom",
      "searchTo"
    ],
    missingFields: [],
    invalidFields: []
  }
);

for (const taskType of [
  "parking",
  "location",
  "bbq",
  "pool",
  "property_fact",
  "amenity",
  "policy",
  "amenity_list",
  "booking_request",
  "human_help",
  "high_risk",
  "unknown"
]) {
  assert.deepEqual(
    readiness({ taskType, productType: "any" }),
    {
      status: "ready",
      knownFields: ["productType"],
      missingFields: [],
      invalidFields: []
    },
    `${taskType} must not require lodging dates`
  );
}

assert.deepEqual(
  readiness({
    taskType: "availability",
    checkIn: "2026-07-31",
    checkOut: "2026-07-30"
  }),
  {
    status: "invalid",
    knownFields: ["productType", "checkIn", "checkOut"],
    missingFields: [],
    invalidFields: ["dateRange"]
  }
);

assert.deepEqual(
  readiness({
    taskType: "availability",
    checkIn: "2026-07-30",
    checkOut: "2026-07-31",
    guestCount: 0
  }),
  {
    status: "invalid",
    knownFields: ["productType", "checkIn", "checkOut", "guestCount"],
    missingFields: [],
    invalidFields: ["guestCount"]
  }
);

assert.deepEqual(
  readiness({
    taskType: "not_registered",
    checkIn: "2026-07-30",
    checkOut: "2026-07-31"
  }),
  {
    status: "unsupported",
    knownFields: ["productType", "checkIn", "checkOut"],
    missingFields: [],
    invalidFields: ["taskType"]
  }
);

console.log(JSON.stringify({
  suite: "task-readiness-contract",
  caseCount: 18,
  passCount: 18,
  failCount: 0
}));
