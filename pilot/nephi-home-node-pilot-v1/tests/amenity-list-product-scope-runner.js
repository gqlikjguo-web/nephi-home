"use strict";

const assert = require("node:assert/strict");
const { executeQueryPlan } = require("../lib/conversation-engine-v2/capability-executor");

const property = { propertyId: "property-a", rooms: [] };
const catalog = {
  amenities: [
    { canonicalId: "shared", publicName: "Shared", status: "confirmed_yes", appliesTo: "whole_property", applicableBundles: [] },
    { canonicalId: "first-only", publicName: "First only", status: "confirmed_yes", appliesTo: "bundle_only", applicableBundles: [{ id: "first-bundle", name: "First", note: "" }] },
    { canonicalId: "second-only", publicName: "Second only", status: "confirmed_yes", appliesTo: "bundle_only", applicableBundles: [{ id: "second-bundle", name: "Second", note: "" }] }
  ],
  policies: [],
  faqs: []
};

function amenityListPlan(entityId, propertyId = property.propertyId) {
  return {
    formalRequestId: `cycle:${entityId}`,
    taskId: `amenities:${entityId}`,
    candidateIndex: 0,
    requestCycleId: "cycle",
    propertyId,
    capability: "amenity_list",
    operation: "amenity_list",
    expectedOutputs: ["amenities"],
    resolverId: "property_catalog",
    entity: { status: "resolved", category: "bundle", canonicalId: entityId, canonicalSet: [] },
    conditions: {
      stay: {},
      inventory: { mode: "bundle_only", entityId, entityIds: [], features: [] },
      topic: {}
    }
  };
}

function execute(entityId, propertyId) {
  return executeQueryPlan({
    property,
    catalog,
    queryPlan: amenityListPlan(entityId, propertyId),
    availabilityResolver: () => { throw new Error("amenity_list_must_not_call_availability"); }
  });
}

assert.deepEqual(execute("first-bundle").facts.amenities, ["First only"]);
assert.deepEqual(execute("second-bundle").facts.amenities, ["Second only"]);
assert.equal(execute("first-bundle", "property-b").outcome, "invalid_query_plan");

console.log("amenity list product scope: PASS");
