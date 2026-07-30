"use strict";

const LODGING_PRODUCT_TYPES = Object.freeze([
  "any",
  "room_type",
  "bundle"
]);
const LODGING_PRODUCT_TYPE_SET = new Set(LODGING_PRODUCT_TYPES);

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizedProduct(value = {}) {
  const productType = String(value.productType || "").trim();
  const productId = textOrNull(value.productId);
  const roomTypeId = textOrNull(value.roomTypeId);
  const bundleId = textOrNull(value.bundleId);
  return { productType, productId, roomTypeId, bundleId };
}

function validateLodgingProduct(value) {
  const product = normalizedProduct(value);
  const errors = [];
  if (!LODGING_PRODUCT_TYPE_SET.has(product.productType)) {
    errors.push("productType");
  } else if (product.productType === "any") {
    if (product.productId || product.roomTypeId || product.bundleId) {
      errors.push("any.identifiers");
    }
  } else if (product.productType === "room_type") {
    if (!product.productId || !product.roomTypeId) {
      errors.push("room_type.identifier");
    }
    if (product.productId !== product.roomTypeId) {
      errors.push("room_type.productId");
    }
    if (product.bundleId) {
      errors.push("room_type.bundleId");
    }
  } else if (product.productType === "bundle") {
    if (!product.productId || !product.bundleId) {
      errors.push("bundle.identifier");
    }
    if (product.productId !== product.bundleId) {
      errors.push("bundle.productId");
    }
    if (product.roomTypeId) {
      errors.push("bundle.roomTypeId");
    }
  }
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    value: product
  };
}

function createLodgingProduct(value) {
  const validation = validateLodgingProduct(value);
  if (!validation.ok) {
    const error = new TypeError(
      `invalid_lodging_product:${validation.errors.join(",")}`
    );
    error.code = "invalid_lodging_product";
    error.validationErrors = validation.errors;
    throw error;
  }
  return Object.freeze(validation.value);
}

function lodgingProductFromProviderInventory(inventory) {
  if (!inventory || typeof inventory !== "object") {
    throw new TypeError("provider_inventory_required");
  }
  const inventoryId = textOrNull(inventory.id);
  if (!inventoryId) {
    throw new TypeError("provider_inventory_id_required");
  }
  if (inventory.inventoryType === "bundle") {
    return createLodgingProduct({
      productType: "bundle",
      productId: inventoryId,
      bundleId: inventoryId
    });
  }
  return createLodgingProduct({
    productType: "room_type",
    productId: inventoryId,
    roomTypeId: inventoryId
  });
}

module.exports = {
  LODGING_PRODUCT_TYPES,
  createLodgingProduct,
  lodgingProductFromProviderInventory,
  validateLodgingProduct
};
