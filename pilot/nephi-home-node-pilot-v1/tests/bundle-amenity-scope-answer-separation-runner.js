"use strict";

const assert = require("node:assert/strict");
const { PRESET_AMENITIES } = require("../lib/bundle-entertainment");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { executeQueryPlan } = require("../lib/conversation-engine-v2/capability-executor");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");

const amenity = PRESET_AMENITIES[0];

function bundle(id, name, note) {
  return {
    id,
    name,
    inventoryType: "bundle",
    enabled: true,
    entertainmentAmenities: [{
      key: amenity.key,
      provided: true,
      statusSource: "operator",
      note,
      source: "preset"
    }]
  };
}

function catalogFor(bundles) {
  return buildPropertyCatalog({
    propertyId: "scope-separation-property",
    displayName: "Scope Separation Property",
    rooms: bundles,
    commonAnswers: {}
  });
}

function query(catalog, mode, taskId = "specific-amenity") {
  return executeQueryPlan({
    property: { propertyId: catalog.propertyId, rooms: [] },
    catalog,
    queryPlan: {
      propertyId: catalog.propertyId,
      taskId,
      capability: "amenity",
      resolverId: "property_catalog",
      detailIntent: "general",
      conditions: { stay: {}, inventory: { mode } },
      entity: { status: "resolved", canonicalId: amenity.key, category: "amenity" }
    }
  });
}

function replyFor(catalog, taskId = "specific-amenity") {
  const outcome = query(catalog, "any", taskId);
  const taskResult = {
    taskId,
    type: outcome.type,
    status: outcome.outcome === "answered" ? "answered" : "needs_human",
    facts: outcome.facts
  };
  return composeControlledReply(buildResponsePlan({
    propertyId: catalog.propertyId,
    taskResults: [taskResult],
    inputTaskIds: [taskId]
  }));
}

const single = catalogFor([bundle("plan-alpha", "Plan Alpha", "Alpha note.")]);
const singleEntity = single.amenities.find((item) => item.canonicalId === amenity.key);
assert.equal(singleEntity.answer, "Alpha note.", "catalog answer must retain the operator note without a core-added bundle name");
assert.equal(singleEntity.appliesTo, "bundle_only");
assert.deepEqual(singleEntity.applicableBundles, [
  { id: "plan-alpha", name: "Plan Alpha", note: "Alpha note." }
]);
assert.equal(
  replyFor(single),
  `${amenity.displayName}於Plan Alpha提供。\nAlpha note.`,
  "a specific amenity reply must render scope once without an isolated plan-name prefix"
);

const emptyNote = catalogFor([bundle("plan-empty", "Plan Empty", "")]);
assert.equal(
  replyFor(emptyNote),
  `${amenity.displayName}於Plan Empty提供。`,
  "an empty note must retain bundle-only scope"
);

const multiple = catalogFor([
  bundle("plan-alpha", "Plan Alpha", "Alpha note."),
  bundle("plan-beta", "Plan Beta", "Beta note.")
]);
const multipleEntity = multiple.amenities.find((item) => item.canonicalId === amenity.key);
assert.equal(multipleEntity.answer, "Alpha note.；Beta note.");
assert.deepEqual(multipleEntity.applicableBundles, [
  { id: "plan-alpha", name: "Plan Alpha", note: "Alpha note." },
  { id: "plan-beta", name: "Plan Beta", note: "Beta note." }
]);
assert.equal(
  replyFor(multiple),
  `${amenity.displayName}於Plan Alpha、Plan Beta提供。\nPlan Alpha：Alpha note.\nPlan Beta：Beta note.`,
  "multiple bundles must retain each bundle's own name and note"
);

const roomOnly = query(single, "room_only", "room-only-specific-amenity");
assert.equal(roomOnly.outcome, "answered");
assert.equal(roomOnly.facts.status, "confirmed_no");
assert.equal(roomOnly.facts.answer, "");
assert.deepEqual(roomOnly.facts.applicableBundles, []);

console.log("bundle amenity scope/answer separation: PASS");
