"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const equipmentRegistry = require("../public/assets/high-frequency-equipment");
const formData = require("../public/assets/property-facts-form");
const { normalizePropertyFacts } = require("../lib/property-facts");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { resolveEntity } = require("../lib/conversation-engine-v2/entity-resolver");

const toiletries = equipmentRegistry.equipmentByCanonicalId("toiletries");
assert.deepEqual(toiletries, {
  canonicalId: "toiletries",
  publicName: "盥洗用品",
  group: "hygiene"
}, "the controlled equipment registry must own amenity:toiletries");

assert.equal(typeof formData.buildAdminPropertyFactCardGroups, "function", "the admin must consume one shared card-group contract");
const groups = formData.buildAdminPropertyFactCardGroups([]);
assert.deepEqual(groups.map((group) => [group.key, group.publicName, group.cards.map((card) => card.canonicalId)]), [
  ["basic", "住宿基本設備", ["parking", "wifi", "tv", "refrigerator", "water_dispenser", "elevator", "washing_machine", "clothes_dryer"]],
  ["cooking", "廚房／餐飲", ["stove", "cookware", "tableware", "breakfast"]],
  ["hygiene", "衛浴／盥洗", ["toiletries"]],
  ["infant", "嬰幼兒設備", ["baby_crib", "baby_bathtub", "baby_bottle_sterilizer", "baby_bottle_cleaning_equipment"]],
  ["special_policy", "政策／特殊服務", ["pets", "travel_subsidy", "add_person_bed"]]
]);

const drafts = formData.buildHighFrequencyEquipmentDrafts([{
  canonicalId: "toiletries",
  publicName: "不可覆寫名稱",
  category: "amenity",
  status: "allowed",
  appliesTo: "whole_property",
  publicText: "提供毛巾、浴巾、洗髮乳與沐浴乳；牙刷請自備。",
  fees: [],
  advanceNoticeRequired: null,
  reservationRequired: null,
  conditions: [],
  restrictions: [],
  operatingHours: [],
  availablePeriods: [],
  notes: "庫存由房務確認",
  source: "operator_form",
  updatedAt: "2026-08-22T00:00:00.000Z"
}]);
assert.equal(drafts.filter((item) => item.canonicalId === "toiletries").length, 1);
const payload = formData.buildPropertyFactsPayload("property_alpha", drafts, () => new Date("2026-08-22T01:00:00.000Z"));
const stored = normalizePropertyFacts(payload.facts);
const storedToiletries = stored.find((item) => item.canonicalId === "toiletries");
assert.equal(storedToiletries.publicName, "盥洗用品");
assert.equal(storedToiletries.category, "amenity");
assert.equal(storedToiletries.publicText, "提供毛巾、浴巾、洗髮乳與沐浴乳；牙刷請自備。");
assert.equal(stored.filter((item) => item.canonicalId === "toiletries").length, 1, "editing must update the one controlled row");

const catalog = buildPropertyCatalog({ propertyId: "property_alpha", rooms: [], propertyFacts: stored });
const resolved = resolveEntity(catalog, { category: "amenity", rawText: "盥洗用品", canonicalCandidate: "toiletries" });
assert.equal(resolved.status, "resolved");
assert.equal(resolved.entity.answer, "提供毛巾、浴巾、洗髮乳與沐浴乳；牙刷請自備。");
assert.equal(resolved.entity.propertyFact.canonicalId, "toiletries");

const policyDrafts = formData.buildControlledPolicyFactDrafts([{
  canonicalId: "add_person_bed",
  publicName: "不可覆寫名稱",
  category: "policy",
  status: "conditional",
  appliesTo: "whole_property",
  publicText: "加人或加床須事先聯絡業者確認。",
  notes: "內部備註不得成為正式回答"
}]);
const policyPayload = formData.buildPropertyFactsPayload("property_alpha", policyDrafts, () => new Date("2026-08-23T00:00:00.000Z"));
const storedPolicies = normalizePropertyFacts(policyPayload.facts);
assert.equal(storedPolicies.filter((item) => item.canonicalId === "add_person_bed").length, 1, "the controlled policy payload must preserve one add-person/bed identity");
const policyCatalog = buildPropertyCatalog({ propertyId: "property_alpha", rooms: [], propertyFacts: storedPolicies });
const resolvedPolicy = resolveEntity(policyCatalog, { category: "policy", rawText: "加人／加床", canonicalCandidate: "add_person_bed" });
assert.equal(resolvedPolicy.status, "resolved");
assert.equal(resolvedPolicy.entity.answer, "加人或加床須事先聯絡業者確認。");
assert.equal(resolvedPolicy.entity.propertyFact.canonicalId, "add_person_bed");

const css = fs.readFileSync(path.join(__dirname, "../public/assets/equipment-facts.css"), "utf8");
assert.match(css, /\.equipment-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(css, /@media\s*\(max-width:\s*640px\)\s*\{[^}]*\.equipment-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);

console.log("toiletries admin layout: PASS");
