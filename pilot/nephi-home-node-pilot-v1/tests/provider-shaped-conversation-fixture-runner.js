"use strict";

const assert = require("node:assert/strict");
const fixture = require("./fixtures/conversation-contract-postgres-properties.json");

const PROPERTY_KEYS = [
  "propertyId",
  "displayName",
  "currency",
  "rooms",
  "commonAnswers",
  "propertyFacts",
  "pricing",
  "faqs",
  "humanHandoffSituations",
  "businessProfile",
  "contactLink",
  "onboarding"
];
const ROOM_KEYS = [
  "id",
  "roomCode",
  "displayName",
  "name",
  "capacity",
  "highlights",
  "type",
  "description",
  "mondayThursdayPrice",
  "fridayPrice",
  "saturdayHolidayPrice",
  "sundayPrice",
  "enabled"
];
const BUNDLE_KEYS = [
  "id",
  "name",
  "capacity",
  "type",
  "description",
  "memberRoomIds",
  "entertainmentAmenities",
  "basePrice",
  "mondayThursdayPrice",
  "fridayPrice",
  "saturdayHolidayPrice",
  "sundayPrice",
  "inventoryType"
];

assert.equal(
  fixture.sourceContract,
  "lib/providers/postgres-worker.js:getProperty"
);
assert.equal(fixture.properties.length, 2);

for (const property of fixture.properties) {
  assert.deepEqual(
    Object.keys(property),
    PROPERTY_KEYS,
    `${property.propertyId} must mirror the PostgreSQL getProperty projection`
  );
  assert.equal(
    Object.hasOwn(property, "semanticCatalog"),
    false,
    "the provider-shaped fixture must not invent semanticCatalog"
  );
  assert.equal(
    Object.hasOwn(property, "timezone"),
    false,
    "the PostgreSQL getProperty projection does not return timezone"
  );
  const rooms = property.rooms.filter(
    (inventory) => inventory.inventoryType !== "bundle"
  );
  const bundles = property.rooms.filter(
    (inventory) => inventory.inventoryType === "bundle"
  );
  assert.ok(rooms.length >= 1);
  assert.ok(bundles.length >= 1);
  rooms.forEach((room) => assert.deepEqual(Object.keys(room), ROOM_KEYS));
  bundles.forEach((bundle) => {
    assert.deepEqual(Object.keys(bundle), BUNDLE_KEYS);
    assert.ok(bundle.memberRoomIds.length >= 1);
    bundle.memberRoomIds.forEach((memberRoomId) => {
      assert.ok(
        rooms.some((room) => room.id === memberRoomId),
        `${bundle.id} must reference a room from the same property`
      );
    });
  });
}

const [alpha, beta] = fixture.properties;
const alphaInventoryIds = new Set(alpha.rooms.map((inventory) => inventory.id));
const betaInventoryIds = new Set(beta.rooms.map((inventory) => inventory.id));
assert.deepEqual(
  [...alphaInventoryIds].filter((inventoryId) => betaInventoryIds.has(inventoryId)),
  [],
  "Alpha and Beta provider inventory IDs must be isolated"
);
assert.notEqual(
  alpha.businessProfile.googleMapsUrl,
  beta.businessProfile.googleMapsUrl
);
assert.notEqual(
  alpha.commonAnswers.parking,
  beta.commonAnswers.parking
);

console.log(JSON.stringify({
  suite: "provider-shaped-conversation-fixture",
  propertyCount: 2,
  passCount: 8,
  failCount: 0
}));
