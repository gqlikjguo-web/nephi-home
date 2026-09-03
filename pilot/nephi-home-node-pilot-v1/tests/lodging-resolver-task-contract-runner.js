"use strict";

const assert = require("node:assert/strict");
const {
  availabilityRequestFromResolverTask,
  availableDatesRequestFromResolverTask
} = require("../lib/conversation-engine-v2/resolver-adapter");

const base = {
  propertyId: "property-alpha",
  taskType: "availability",
  productType: "any",
  productId: null,
  checkIn: "2026-07-30",
  checkOut: "2026-07-31",
  guestCount: 2
};

assert.deepEqual(
  availabilityRequestFromResolverTask(base),
  {
    customerId: "property-alpha",
    checkIn: "2026-07-30",
    checkOut: "2026-07-31",
    guests: 2,
    roomType: "all",
    queryMode: "any"
  }
);
assert.deepEqual(
  availabilityRequestFromResolverTask({
    ...base,
    productType: "room_type",
    productId: "alpha-double"
  }),
  {
    customerId: "property-alpha",
    checkIn: "2026-07-30",
    checkOut: "2026-07-31",
    guests: 2,
    roomType: "alpha-double",
    queryMode: "room_only"
  }
);
assert.deepEqual(
  availabilityRequestFromResolverTask({
    ...base,
    roomTypeSet: ["alpha-double-a", "alpha-double-b"]
  }),
  {
    customerId: "property-alpha",
    checkIn: "2026-07-30",
    checkOut: "2026-07-31",
    guests: 2,
    roomType: "all",
    roomTypeSet: ["alpha-double-a", "alpha-double-b"],
    queryMode: "any"
  }
);
assert.deepEqual(
  availabilityRequestFromResolverTask({
    ...base,
    productType: "bundle",
    productId: "alpha-whole-house"
  }),
  {
    customerId: "property-alpha",
    checkIn: "2026-07-30",
    checkOut: "2026-07-31",
    guests: 2,
    roomType: "alpha-whole-house",
    queryMode: "bundle_only"
  }
);
assert.throws(
  () => availabilityRequestFromResolverTask({
    ...base,
    productType: "bundle",
    productId: null
  }),
  /resolver_task_product_invalid/
);
assert.equal(
  Object.hasOwn(
    availabilityRequestFromResolverTask({
      ...base,
      sourceText: "must never reach resolver"
    }),
    "sourceText"
  ),
  false
);
assert.deepEqual(
  availableDatesRequestFromResolverTask({
    ...base,
    taskType: "available_dates",
    checkIn: null,
    checkOut: null,
    searchFrom: "2026-07-30",
    searchTo: "2026-08-13",
    productType: "bundle",
    productId: "alpha-whole-house"
  }),
  {
    customerId: "property-alpha",
    dateFrom: "2026-07-30",
    dateTo: "2026-08-13",
    nights: 1,
    guests: 2,
    roomType: "alpha-whole-house",
    queryMode: "bundle_only"
  }
);

console.log(JSON.stringify({
  suite: "lodging-resolver-task-contract",
  caseCount: 6,
  passCount: 6,
  failCount: 0
}));
