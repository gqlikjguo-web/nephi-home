"use strict";

const assert = require("node:assert/strict");
const {
  HIGH_FREQUENCY_EQUIPMENT,
  equipmentByCanonicalId
} = require("../public/assets/high-frequency-equipment");
const { PRESET_AMENITIES } = require("../lib/bundle-entertainment");
const { normalizePropertyFacts } = require("../lib/property-facts");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { executeTasks, executeQueryPlan } = require("../lib/conversation-engine-v2/capability-executor");
const { buildHighFrequencyEquipmentDrafts, equipmentFieldPolicy } = require("../public/assets/property-facts-form");

const EXPECTED = [
  ["parking", "停車"],
  ["wifi", "Wi-Fi"],
  ["tv", "電視"],
  ["refrigerator", "冰箱"],
  ["water_dispenser", "飲水機"],
  ["elevator", "電梯"],
  ["washing_machine", "洗衣機"],
  ["clothes_dryer", "烘衣機"],
  ["stove", "爐具"],
  ["cookware", "鍋具"],
  ["tableware", "餐具"],
  ["baby_crib", "嬰兒床"],
  ["baby_bathtub", "嬰兒澡盆"],
  ["baby_bottle_sterilizer", "消毒鍋"],
  ["baby_bottle_cleaning_equipment", "奶瓶清潔設備"]
];

function draft(canonicalId, status, publicText, publicName = "偽造名稱") {
  return {
    canonicalId,
    publicName,
    category: "amenity",
    status,
    appliesTo: arguments[4] || "whole_property",
    publicText,
    fees: [],
    advanceNoticeRequired: null,
    reservationRequired: null,
    conditions: [],
    restrictions: [],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-08-13T00:00:00.000Z"
  };
}

assert.deepEqual(HIGH_FREQUENCY_EQUIPMENT.map((item) => [item.canonicalId, item.publicName]), EXPECTED);
assert.equal(new Set(HIGH_FREQUENCY_EQUIPMENT.map((item) => item.canonicalId)).size, EXPECTED.length);
const bundleIds = new Set(PRESET_AMENITIES.map((item) => item.key));
assert.deepEqual(HIGH_FREQUENCY_EQUIPMENT.filter((item) => bundleIds.has(item.canonicalId)), []);
assert.equal(equipmentByCanonicalId("wifi").publicName, "Wi-Fi");

assert.deepEqual(equipmentFieldPolicy("unknown"), {
  showScope: false,
  showPublicText: false,
  showNotes: false,
  publicTextRequired: false
});
assert.deepEqual(equipmentFieldPolicy("allowed"), {
  showScope: true,
  showPublicText: true,
  showNotes: true,
  publicTextRequired: true
});
assert.deepEqual(equipmentFieldPolicy("not_allowed"), {
  showScope: false,
  showPublicText: true,
  showNotes: true,
  publicTextRequired: false
});

assert.throws(
  () => normalizePropertyFacts([draft("wifi", "allowed", "")]),
  /invalid_property_fact:facts\.0\.publicText/
);

const normalized = normalizePropertyFacts([
  draft("wifi", "allowed", "全館提供免費 Wi-Fi。"),
  draft("clothes_dryer", "not_allowed", ""),
  draft("baby_crib", "unknown", "這段不得成為答案")
]);
assert.equal(normalized[0].publicName, "Wi-Fi", "system public name must override submitted text");
assert.equal(normalized[1].publicName, "烘衣機");
assert.equal(normalized[1].publicText, "", "formal negative facts may omit public text");
assert.equal(normalized[2].publicText, "", "unknown facts must not expose an answer");
const legacyParking = draft("parking", "allowed", "Parking is available.");
delete legacyParking.publicName;
const legacyNormalized = normalizePropertyFacts([legacyParking])[0];
assert.equal(Object.hasOwn(legacyNormalized, "publicName"), false, "legacy propertyFacts without publicName must preserve their stored shape");

const catalog = buildPropertyCatalog({
  propertyId: "equipment_property",
  displayName: "Equipment Property",
  rooms: [],
  commonAnswers: {},
  propertyFacts: normalized,
  faqs: []
});
const byId = new Map(catalog.amenities.map((item) => [item.canonicalId, item]));
assert.deepEqual(
  ["wifi", "clothes_dryer", "baby_crib"].map((id) => ({
    id,
    publicName: byId.get(id).publicName,
    status: byId.get(id).status,
    answer: byId.get(id).answer
  })),
  [
    { id: "wifi", publicName: "Wi-Fi", status: "confirmed_yes", answer: "全館提供免費 Wi-Fi。" },
    { id: "clothes_dryer", publicName: "烘衣機", status: "confirmed_no", answer: "" },
    { id: "baby_crib", publicName: "嬰兒床", status: "unknown", answer: "" }
  ]
);

const resolvedTasks = ["wifi", "clothes_dryer", "baby_crib"].map((canonicalId, index) => ({
  taskId: `equipment-${index + 1}`,
  type: "amenity",
  detailIntent: "general",
  entity: { rawText: byId.get(canonicalId).publicName },
  _resolvedEntity: { status: "resolved", entity: byId.get(canonicalId) }
}));
const outcomes = executeTasks({
  property: { propertyId: "equipment_property", rooms: [] },
  catalog,
  tasks: resolvedTasks,
  request: { stay: {}, inventory: {} }
});
assert.deepEqual(
  outcomes.map((item) => ({ status: item.status, factStatus: item.facts.status, answer: item.facts.answer || "", subject: item.facts.subject })),
  [
    { status: "answered", factStatus: "confirmed_yes", answer: "全館提供免費 Wi-Fi。", subject: "Wi-Fi" },
    { status: "answered", factStatus: "confirmed_no", answer: "", subject: "烘衣機" },
    { status: "needs_human", factStatus: undefined, answer: "", subject: "嬰兒床" }
  ]
);

const scopeNormalized = normalizePropertyFacts([
  draft("wifi", "allowed", "Bundle Wi-Fi.", undefined, "bundle_only"),
  draft("tv", "allowed", "Every guest can use the TV.", undefined, "both"),
  draft("refrigerator", "allowed", "Legacy room-only refrigerator.", undefined, "room_only")
]);
assert.equal(scopeNormalized[0].appliesTo, "bundle_only");
assert.equal(scopeNormalized[1].appliesTo, "whole_property");
assert.equal(scopeNormalized[2].status, "unknown");
assert.equal(scopeNormalized[2].appliesTo, "whole_property");
assert.equal(scopeNormalized[2].publicText, "");
const legacyDrafts = buildHighFrequencyEquipmentDrafts([
  draft("wifi", "allowed", "Legacy room Wi-Fi.", undefined, "room_only"),
  draft("tv", "allowed", "Every guest can use the TV.", undefined, "both")
]);
assert.equal(legacyDrafts.find((item) => item.canonicalId === "wifi").status, "unknown");
assert.equal(legacyDrafts.find((item) => item.canonicalId === "tv").appliesTo, "whole_property");

const scopeCatalog = buildPropertyCatalog({
  propertyId: "equipment_scope_property",
  displayName: "Equipment Scope Property",
  rooms: [],
  commonAnswers: {},
  propertyFacts: scopeNormalized,
  faqs: []
});
const scopedWifi = scopeCatalog.amenities.find((item) => item.canonicalId === "wifi");
assert.equal(scopedWifi.appliesTo, "bundle_only");
assert.equal(scopedWifi.answer, "\u50c5\u5305\u68df\u5ba2\u9069\u7528\uff1aBundle Wi-Fi.");

function scopedQuery(mode) {
  return executeQueryPlan({
    property: { propertyId: "equipment_scope_property", rooms: [] },
    catalog: scopeCatalog,
    queryPlan: {
      propertyId: "equipment_scope_property",
      taskId: `wifi-${mode}`,
      capability: "amenity",
      resolverId: "property_catalog",
      detailIntent: "general",
      conditions: { stay: {}, inventory: { mode } },
      entity: { status: "resolved", canonicalId: "wifi", category: "amenity" },
      resolvedEntity: { status: "resolved", entity: scopedWifi }
    }
  });
}
assert.equal(scopedQuery("bundle_only").facts.status, "confirmed_yes");
assert.equal(scopedQuery("any").facts.answer, "\u50c5\u5305\u68df\u5ba2\u9069\u7528\uff1aBundle Wi-Fi.");
assert.equal(scopedQuery("room_only").facts.status, "confirmed_no");

console.log("high-frequency equipment: PASS");
