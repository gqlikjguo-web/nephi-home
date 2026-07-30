"use strict";

const assert = require("node:assert/strict");
const providerFixture = require("./fixtures/conversation-contract-postgres-properties.json");
const {
  LODGING_PRODUCT_TYPES,
  createLodgingProduct,
  lodgingProductFromProviderInventory,
  validateLodgingProduct
} = require("../lib/conversation-contracts/lodging-product");

assert.deepEqual(
  [...LODGING_PRODUCT_TYPES],
  ["any", "room_type", "bundle"]
);

const anyProduct = createLodgingProduct({ productType: "any" });
assert.deepEqual(anyProduct, {
  productType: "any",
  productId: null,
  roomTypeId: null,
  bundleId: null
});

const roomProduct = createLodgingProduct({
  productType: "room_type",
  productId: "alpha-double",
  roomTypeId: "alpha-double"
});
assert.deepEqual(roomProduct, {
  productType: "room_type",
  productId: "alpha-double",
  roomTypeId: "alpha-double",
  bundleId: null
});

const bundleProduct = createLodgingProduct({
  productType: "bundle",
  productId: "alpha-whole-house",
  bundleId: "alpha-whole-house"
});
assert.deepEqual(bundleProduct, {
  productType: "bundle",
  productId: "alpha-whole-house",
  roomTypeId: null,
  bundleId: "alpha-whole-house"
});

const alpha = providerFixture.properties.find(
  (property) => property.propertyId === "property_alpha"
);
const providerRoom = alpha.rooms.find(
  (inventory) => inventory.id === "alpha-double"
);
const providerBundle = alpha.rooms.find(
  (inventory) => inventory.id === "alpha-whole-house"
);
assert.deepEqual(
  lodgingProductFromProviderInventory(providerRoom),
  roomProduct,
  "a PostgreSQL provider room row must map to room_type"
);
assert.deepEqual(
  lodgingProductFromProviderInventory(providerBundle),
  bundleProduct,
  "a PostgreSQL provider bundle row must map to bundle"
);

for (const invalid of [
  { productType: "room" },
  { productType: "room_type" },
  { productType: "bundle" },
  {
    productType: "room_type",
    productId: "alpha-double",
    roomTypeId: "alpha-double",
    bundleId: "alpha-whole-house"
  },
  {
    productType: "bundle",
    productId: "alpha-whole-house",
    roomTypeId: "alpha-double",
    bundleId: "alpha-whole-house"
  }
]) {
  assert.equal(validateLodgingProduct(invalid).ok, false);
  assert.throws(
    () => createLodgingProduct(invalid),
    /invalid_lodging_product/
  );
}

assert.equal(Object.isFrozen(anyProduct), true);
assert.equal(Object.isFrozen(roomProduct), true);
assert.equal(Object.isFrozen(bundleProduct), true);

console.log(JSON.stringify({
  suite: "lodging-product-contract",
  caseCount: 10,
  passCount: 10,
  failCount: 0
}));
