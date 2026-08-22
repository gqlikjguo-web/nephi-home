"use strict";

const assert = require("node:assert/strict");
const { executeQueryPlan, executeQueryPlans } = require("../lib/conversation-engine-v2/capability-executor");
const { composeSection } = require("../lib/conversation-engine-v2/controlled-composer");

const property = { propertyId: "property-a", rooms: [{ id: "room-a", capacity: 2, enabled: true }] };
const catalog = { amenities: [], policies: [], faqs: [] };
const plan = {
  formalRequestId: "cycle-a:availability", taskId: "availability", candidateIndex: 0, requestCycleId: "cycle-a",
  propertyId: "property-a", capability: "availability", operation: "availability", expectedOutputs: ["answer"],
  resolverTask: { propertyId: "property-a", taskType: "availability", productType: "room_type", productId: "room-a", checkIn: "2026-08-06", checkOut: "2026-08-07", guestCount: 2 },
  entity: { status: "resolved", category: "room", canonicalId: "room-a", canonicalSet: [] },
  conditions: { stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, guests: 2, searchRange: null }, inventory: { mode: "room_only", entityId: "room-a", entityIds: [], features: [] }, topic: {} }
};
let calls = 0;
const answered = executeQueryPlan({ property, catalog, queryPlan: plan, availabilityResolver: (request) => { calls += 1; assert.equal(request.customerId, "property-a"); assert.equal(request.roomType, "room-a"); return { ...request, availabilityReliable: true, rooms: property.rooms }; } });
assert.equal(calls, 1);
assert.equal(answered.outcome, "answered");
assert.equal(answered.formalRequestId, plan.formalRequestId);
assert.equal(Object.hasOwn(answered.facts, "prices"), false);

const mismatch = executeQueryPlan({ property, catalog, queryPlan: { ...plan, propertyId: "property-b" }, availabilityResolver: () => { throw new Error("must_not_call"); } });
assert.equal(mismatch.outcome, "invalid_query_plan");
assert.equal(mismatch.resolverAttempted, false);

const missingRange = executeQueryPlan({ property, catalog, queryPlan: { ...plan, capability: "available_dates", operation: "available_dates", conditions: { ...plan.conditions, stay: { ...plan.conditions.stay, searchRange: null } } }, availableDatesResolver: () => { throw new Error("must_not_call"); } });
assert.equal(missingRange.outcome, "invalid_query_plan");
assert.equal(missingRange.resolverAttempted, false);

const propertyCatalog = {
  amenities: [],
  faqs: [],
  policies: [
    { canonicalId: "check_in", category: "policy", publicName: "Check-in", status: "confirmed_yes", answer: "15:00" },
    { canonicalId: "early_checkin", category: "policy", publicName: "Early check-in", status: "confirmed_yes", answer: "Early arrival must be confirmed." }
  ]
};
const propertyFactPlan = {
  formalRequestId: "cycle-policy:detail", taskId: "policy-detail", candidateIndex: 1, requestCycleId: "cycle-policy",
  propertyId: "property-a", capability: "policy", operation: "policy", detailIntent: "early_arrival_policy",
  expectedOutputs: ["early_arrival_policy"],
  entity: { status: "resolved", category: "policy", canonicalId: "check_in", canonicalSet: [] },
  resolvedEntity: { status: "resolved", entity: propertyCatalog.policies[0] },
  conditions: { stay: {}, inventory: {}, topic: { detailIntent: "general" } }
};
const detail = executeQueryPlan({ property, catalog: propertyCatalog, queryPlan: propertyFactPlan, availabilityResolver: () => { throw new Error("property_fact_must_not_call_availability"); } });
assert.equal(detail.outcome, "answered");
assert.equal(detail.facts.detailIntent, "early_arrival_policy");
assert.equal(detail.facts.answer, "Early arrival must be confirmed.");

const generalFact = executeQueryPlan({ property, catalog: propertyCatalog, queryPlan: { ...propertyFactPlan, formalRequestId: "cycle-policy:general", taskId: "policy-general", candidateIndex: 2, detailIntent: "general", expectedOutputs: ["answer"] }, availabilityResolver: () => { throw new Error("property_fact_must_not_call_availability"); } });
assert.equal(generalFact.facts.detailIntent, "general");
assert.equal(generalFact.facts.answer, "15:00");

const twoFacts = executeQueryPlans({
  property,
  catalog: propertyCatalog,
  queryPlans: [
    propertyFactPlan,
    { ...propertyFactPlan, formalRequestId: "cycle-policy:general-two", taskId: "policy-general-two", candidateIndex: 2, detailIntent: "general", expectedOutputs: ["answer"] }
  ],
  availabilityResolver: () => { throw new Error("property_fact_must_not_call_availability"); }
});
assert.deepEqual(twoFacts.map((result) => [result.taskId, result.requestCycleId, result.facts.detailIntent, result.facts.answer]), [
  ["policy-detail", "cycle-policy", "early_arrival_policy", "Early arrival must be confirmed."],
  ["policy-general-two", "cycle-policy", "general", "15:00"]
]);

const pricingProperty = { propertyId: "pricing-property", currency: "TWD", rooms: [{ id: "room-price", publicDisplayName: "Price room", capacity: 2, enabled: true, mondayThursdayPrice: 1000, fridayPrice: 1200, saturdayHolidayPrice: 1500, sundayPrice: 1100 }] };
const pricingPlan = { ...plan, formalRequestId: "cycle-price:price", taskId: "price", candidateIndex: 3, requestCycleId: "cycle-price", propertyId: "pricing-property", capability: "price", operation: "price", resolverTask: { propertyId: "pricing-property", taskType: "pricing", productType: "room_type", productId: "room-price", checkIn: "2026-08-06", checkOut: "2026-08-08", guestCount: 2 }, entity: { status: "resolved", category: "room", canonicalId: "room-price", canonicalSet: [] }, conditions: { ...plan.conditions, stay: { ...plan.conditions.stay, checkOut: "2026-08-08", nights: 2 } } };
const priced = executeQueryPlan({ property: pricingProperty, catalog, queryPlan: pricingPlan, availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: true, rooms: pricingProperty.rooms }), priceOverrides: [{ roomId: "room-price", date: "2026-08-07", price: 1300 }] });
assert.equal(priced.outcome, "answered");
assert.deepEqual(priced.facts.prices[0].daily.map((item) => [item.date, item.price, item.source]), [["2026-08-06", 1000, "room_pricing"], ["2026-08-07", 1300, "price_override"]]);
assert.equal(priced.facts.prices[0].total, 2300);

const noPrice = executeQueryPlan({ property: pricingProperty, catalog, queryPlan: { ...pricingPlan, capability: "total_price", operation: "total_price" }, availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: true, rooms: [] }) });
assert.equal(noPrice.outcome, "no_availability");
assert.deepEqual(noPrice.facts.prices, []);
const totalPriceAvailable = executeQueryPlan({ property: pricingProperty, catalog, queryPlan: { ...pricingPlan, capability: "total_price", operation: "total_price" }, availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: true, rooms: pricingProperty.rooms }) });
assert.equal(totalPriceAvailable.outcome, "answered");
assert.deepEqual(totalPriceAvailable.facts.prices[0].daily, [
  { date: "2026-08-06", price: 1000, source: "room_pricing" },
  { date: "2026-08-07", price: 1200, source: "room_pricing" }
]);
assert.equal(totalPriceAvailable.facts.prices[0].total, 2200);

const roomAvailabilityPlan = {
  ...pricingPlan,
  formalRequestId: "cycle-price:room-availability",
  taskId: "room-availability",
  capability: "availability",
  operation: "availability",
  resolverTask: { ...pricingPlan.resolverTask, taskType: "availability" }
};
const roomAvailability = executeQueryPlan({ property: pricingProperty, catalog, queryPlan: roomAvailabilityPlan, availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: true, rooms: pricingProperty.rooms }) });
assert.equal(roomAvailability.outcome, "answered");
assert.equal(roomAvailability.facts.availableInventory[0].canonicalId, "room-price");
assert.equal(Array.isArray(roomAvailability.facts.prices), true);
assert.equal(roomAvailability.facts.prices[0].total, 2200);
assert.match(composeSection({ status: "answered", facts: roomAvailability.facts }), /可預訂.*2,200 TWD/u);

const bundlePricingProperty = { propertyId: "bundle-pricing-property", currency: "TWD", rooms: [{ id: "bundle-price", publicDisplayName: "Whole property", inventoryType: "bundle", capacity: 8, enabled: true, mondayThursdayPrice: 8000, fridayPrice: 9000, saturdayHolidayPrice: 10000, sundayPrice: 8500 }] };
const bundleAvailabilityPlan = {
  ...roomAvailabilityPlan,
  formalRequestId: "cycle-price:bundle-availability",
  taskId: "bundle-availability",
  requestCycleId: "cycle-bundle",
  propertyId: "bundle-pricing-property",
  capability: "bundle_availability",
  operation: "bundle_availability",
  resolverTask: { propertyId: "bundle-pricing-property", taskType: "bundle_availability", productType: "bundle", productId: "bundle-price", checkIn: "2026-08-06", checkOut: "2026-08-07", guestCount: 2 },
  entity: { status: "resolved", category: "bundle", canonicalId: "bundle-price", canonicalSet: [] },
  conditions: { ...roomAvailabilityPlan.conditions, stay: { ...roomAvailabilityPlan.conditions.stay, checkOut: "2026-08-07", nights: 1 }, inventory: { mode: "bundle_only", entityId: "bundle-price", entityIds: [], features: [] } }
};
const bundleAvailability = executeQueryPlan({ property: bundlePricingProperty, catalog, queryPlan: bundleAvailabilityPlan, availabilityResolver: () => ({ customerId: "bundle-pricing-property", availabilityReliable: true, rooms: bundlePricingProperty.rooms }) });
assert.equal(bundleAvailability.outcome, "answered");
assert.equal(bundleAvailability.facts.availableInventory[0].canonicalId, "bundle-price");
assert.equal(bundleAvailability.facts.prices[0].inventory.category, "bundle");
assert.equal(bundleAvailability.facts.prices[0].total, 8000);

const bundleWithoutPrice = executeQueryPlan({ property: { ...bundlePricingProperty, rooms: [{ ...bundlePricingProperty.rooms[0], mondayThursdayPrice: 0 }] }, catalog, queryPlan: bundleAvailabilityPlan, availabilityResolver: () => ({ customerId: "bundle-pricing-property", availabilityReliable: true, rooms: bundlePricingProperty.rooms }) });
assert.equal(bundleWithoutPrice.outcome, "answered");
assert.equal(bundleWithoutPrice.facts.availableInventory[0].canonicalId, "bundle-price");
assert.equal(Object.hasOwn(bundleWithoutPrice.facts, "prices"), false);

for (const [queryPlan, scopedProperty] of [[roomAvailabilityPlan, pricingProperty], [bundleAvailabilityPlan, bundlePricingProperty]]) {
  const unavailable = executeQueryPlan({ property: scopedProperty, catalog, queryPlan, availabilityResolver: () => ({ customerId: scopedProperty.propertyId, availabilityReliable: true, rooms: [] }) });
  assert.equal(unavailable.outcome, "no_availability");
  assert.equal(Object.hasOwn(unavailable.facts, "prices"), false);
}

const genericAvailabilityPlan = {
  ...roomAvailabilityPlan,
  formalRequestId: "cycle-price:generic-availability",
  taskId: "generic-availability",
  resolverTask: { ...roomAvailabilityPlan.resolverTask, productType: "any", productId: null },
  entity: { status: "not_found", category: "other", canonicalId: null, canonicalSet: [] },
  conditions: { ...roomAvailabilityPlan.conditions, inventory: { mode: "any", entityId: null, entityIds: [], features: [] } }
};
const genericAvailability = executeQueryPlan({ property: pricingProperty, catalog, queryPlan: genericAvailabilityPlan, availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: true, rooms: pricingProperty.rooms }) });
assert.equal(genericAvailability.outcome, "answered");
assert.deepEqual(genericAvailability.facts.prices.map((item) => [item.inventory.canonicalId, item.total]), [["room-price", 2200]]);
assert.match(composeSection({ status: "answered", facts: genericAvailability.facts }), /Price room.*2,200 TWD/u);

const allInventoryProperty = {
  ...pricingProperty,
  rooms: [
    pricingProperty.rooms[0],
    { id: "bundle-all", publicDisplayName: "Whole property", inventoryType: "bundle", capacity: 8, enabled: true, mondayThursdayPrice: 8000, fridayPrice: 9000, saturdayHolidayPrice: 10000, sundayPrice: 8500 }
  ]
};
const allInventoryAvailability = executeQueryPlan({ property: allInventoryProperty, catalog, queryPlan: genericAvailabilityPlan, availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: true, rooms: allInventoryProperty.rooms }) });
assert.deepEqual(allInventoryAvailability.facts.prices.map((item) => [item.inventory.canonicalId, item.total]), [["room-price", 2200], ["bundle-all", 17000]]);
assert.match(composeSection({ status: "answered", facts: allInventoryAvailability.facts }), /Price room.*2,200 TWD.*Whole property.*17,000 TWD/u);

const genericWithoutPrice = executeQueryPlan({
  property: { ...pricingProperty, rooms: [{ ...pricingProperty.rooms[0], fridayPrice: 0 }] },
  catalog,
  queryPlan: genericAvailabilityPlan,
  availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: true, rooms: pricingProperty.rooms })
});
assert.equal(genericWithoutPrice.outcome, "answered");
assert.equal(Object.hasOwn(genericWithoutPrice.facts, "prices"), false);

for (const capability of ["room_options", "capacity"]) {
  const nonEnriched = executeQueryPlan({ property: pricingProperty, catalog, queryPlan: { ...roomAvailabilityPlan, formalRequestId: `cycle-price:${capability}`, taskId: capability, capability, operation: capability }, availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: true, rooms: pricingProperty.rooms }) });
  assert.equal(nonEnriched.outcome, "answered");
  assert.equal(Object.hasOwn(nonEnriched.facts, "prices"), false);
}

const amenityList = executeQueryPlan({ property, catalog: { amenities: [{ publicName: "BBQ", status: "confirmed_yes" }, { publicName: "Pool", status: "unknown" }], policies: [], faqs: [] }, queryPlan: { ...plan, formalRequestId: "cycle:amenities", taskId: "amenities", capability: "amenity_list", operation: "amenity_list" }, availabilityResolver: () => { throw new Error("must_not_call"); } });
assert.equal(amenityList.outcome, "answered");
assert.deepEqual(amenityList.facts.amenities, ["BBQ"]);

for (const [date, checkOut, expected] of [["2026-08-06", "2026-08-07", 1000], ["2026-08-07", "2026-08-08", 1200], ["2026-08-08", "2026-08-09", 1500], ["2026-08-09", "2026-08-10", 1100]]) {
  const weekday = executeQueryPlan({ property: pricingProperty, catalog, queryPlan: { ...pricingPlan, resolverTask: { ...pricingPlan.resolverTask, checkIn: date, checkOut }, conditions: { ...pricingPlan.conditions, stay: { ...pricingPlan.conditions.stay, checkIn: date, checkOut } } }, availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: true, rooms: pricingProperty.rooms }) });
  assert.deepEqual(weekday.facts.prices[0].daily, [{ date, price: expected, source: "room_pricing" }]);
  assert.equal(weekday.facts.prices[0].total, expected);
}
const missingPrice = executeQueryPlan({ property: { ...pricingProperty, rooms: [{ ...pricingProperty.rooms[0], fridayPrice: 0 }] }, catalog, queryPlan: pricingPlan, availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: true, rooms: pricingProperty.rooms }) });
assert.equal(missingPrice.outcome, "property_data_missing");
assert.equal(missingPrice.facts.prices[0].daily[1].price, null);
assert.equal(missingPrice.facts.prices[0].total, null);
const unreliable = executeQueryPlan({ property: pricingProperty, catalog, queryPlan: pricingPlan, availabilityResolver: () => ({ customerId: "pricing-property", availabilityReliable: false, rooms: [] }) });
assert.equal(unreliable.outcome, "technical_error");
assert.equal(unreliable.reason, "availability_unreliable");
const exception = executeQueryPlan({ property: pricingProperty, catalog, queryPlan: pricingPlan, availabilityResolver: () => { throw new Error("down"); } });
assert.equal(exception.outcome, "technical_error");
assert.equal(exception.reason, "resolver_exception");
let amenityResolverCalls = 0;
executeQueryPlan({ property, catalog: { amenities: [{ publicName: "BBQ", status: "confirmed_yes" }], policies: [], faqs: [] }, queryPlan: { ...plan, capability: "amenity_list", operation: "amenity_list" }, availabilityResolver: () => { amenityResolverCalls += 1; return null; } });
assert.equal(amenityResolverCalls, 0);

console.log("phase5 query plan execution: PASS");
