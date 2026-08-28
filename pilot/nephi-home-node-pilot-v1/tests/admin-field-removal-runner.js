"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const registry = require("../public/assets/high-frequency-equipment");
const formData = require("../public/assets/property-facts-form");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
const onboardingHtml = fs.readFileSync(path.join(root, "public/onboarding.html"), "utf8");
const adminScript = fs.readFileSync(path.join(root, "public/assets/admin.js"), "utf8");
const onboardingScript = fs.readFileSync(path.join(root, "public/assets/onboarding-equipment-facts.js"), "utf8");

assert.equal(registry.equipmentByCanonicalId("baby_bottle_cleaning_equipment"), null, "the operator equipment preset must not expose bottle-cleaning equipment");
assert.equal(registry.equipmentByCanonicalId("baby_bottle_sterilizer").publicName, "消毒鍋", "the sterilizer preset must remain available");

for (const [name, source] of [["admin HTML", adminHtml], ["onboarding HTML", onboardingHtml], ["admin UI", adminScript], ["onboarding equipment UI", onboardingScript]]) {
  assert.doesNotMatch(source, /適用範圍|data-equipment-scope/, `${name} must not expose a manual appliesTo control`);
}

const existing = formData.buildHighFrequencyEquipmentDrafts([{ canonicalId: "wifi", status: "allowed", appliesTo: "bundle_only", publicText: "僅包棟提供。" }]);
assert.equal(existing.find((fact) => fact.canonicalId === "wifi").appliesTo, "bundle_only", "existing formal scope must remain unchanged when the UI hides it");
const fresh = formData.buildHighFrequencyEquipmentDrafts([]);
assert.equal(fresh.find((fact) => fact.canonicalId === "wifi").appliesTo, "whole_property", "new equipment must keep the formal whole-property default");
const historicalBottleFact = { canonicalId: "baby_bottle_cleaning_equipment", category: "amenity", status: "allowed", appliesTo: "bundle_only", publicText: "歷史資料", fees: [] };
assert.deepEqual(formData.operatorHiddenFacts([historicalBottleFact]), [historicalBottleFact], "a retired UI field must remain available for byte-preserving form submission");

console.log("admin field removal: PASS");
