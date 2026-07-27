"use strict";

const assert = require("node:assert/strict");
const {
  CAPABILITY_REGISTRY,
  validateCapabilityRegistry
} = require("../lib/conversation-engine-v2/capability-registry");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectRejected(mutation, expectedError) {
  const mutant = clone(CAPABILITY_REGISTRY);
  mutation(mutant);
  const result = validateCapabilityRegistry(mutant);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes(expectedError), JSON.stringify(result));
}

function run() {
  expectRejected(
    (registry) => { registry.availability.resolverId = "property_catalog"; },
    "availability.resolverId"
  );
  expectRejected(
    (registry) => { registry.parking.propertyId = "nephi_home"; },
    "parking.keys"
  );
  expectRejected(
    (registry) => { registry.bbq.propertyName = "specific property"; },
    "bbq.keys"
  );
  expectRejected(
    (registry) => { registry.pool.keywords = ["戲水池"]; },
    "pool.keys"
  );
  expectRejected(
    (registry) => { registry.location.responseText = "hard-coded answer"; },
    "location.keys"
  );
  expectRejected(
    (registry) => { registry.high_risk.riskLevel = "low"; },
    "high_risk.riskLevel"
  );
  expectRejected(
    (registry) => { delete registry.amenity.requiredFields; },
    "amenity.keys"
  );
  expectRejected(
    (registry) => { registry.availability.acceptedCandidateTypes = []; },
    "availability.acceptedCandidateTypes"
  );
  expectRejected(
    (registry) => { registry.amenity.resolverId = "nephi_only_resolver"; },
    "amenity.resolverId"
  );

  console.log("capability registry mutations: PASS");
}

run();
