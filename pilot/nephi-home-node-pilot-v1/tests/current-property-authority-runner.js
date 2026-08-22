"use strict";

const assert = require("node:assert/strict");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { resolveEntity } = require("../lib/conversation-engine-v2/entity-resolver");

const mapUrl = "https://maps.google.com/?q=23.5,121.0";
const property = {
  propertyId: "authority-alpha",
  displayName: "Authority Alpha",
  businessProfile: { address: "正式地址", googleMapsUrl: mapUrl },
  commonAnswers: {
    checkInTime: "15:00",
    latestArrivalTime: "最晚 22:00，超過請提前聯絡",
    checkOutTime: "11:00",
    parkingRule: "LEGACY PARKING MUST NOT ANSWER",
    equipment: ["洗髮乳", "沐浴乳", "一次性備品"],
    transport: "https://maps.google.com/?q=legacy"
  },
  semanticCatalog: {
    aliases: { legacy_subject: ["舊主題"] },
    amenities: [{ id: "legacy_subject", name: "舊設備", aliases: [], status: "confirmed_yes", answer: "LEGACY SEMANTIC CATALOG MUST NOT ANSWER" }]
  },
  faqs: [{ knowledgeKey: "legacy_faq", question: "舊 FAQ", answer: "LEGACY FAQ MUST NOT ANSWER" }],
  propertyFacts: [
    { canonicalId: "parking", category: "amenity", publicName: "停車", status: "available", appliesTo: "whole_property", publicText: "目前後台正式停車說明" },
    { canonicalId: "bbq", category: "policy", publicName: "烤肉", status: "available", appliesTo: "whole_property", publicText: "目前後台正式烤肉說明" },
    { canonicalId: "splash_pool", category: "amenity", publicName: "泳池", status: "available", appliesTo: "whole_property", publicText: "目前後台正式泳池說明" },
    { canonicalId: "breakfast", category: "policy", publicName: "早餐", status: "available", appliesTo: "whole_property", publicText: "目前後台正式早餐說明" },
    { canonicalId: "pets", category: "policy", publicName: "寵物", status: "available", appliesTo: "whole_property", publicText: "目前後台正式寵物說明" },
    { canonicalId: "travel_subsidy", category: "policy", publicName: "國旅補助", status: "available", appliesTo: "whole_property", publicText: "目前後台正式國旅補助說明" }
  ],
  rooms: [
    { id: "room-alpha", name: "Alpha 房", capacity: 2, enabled: true, mondayThursdayPrice: 2000 },
    { id: "bundle-alpha", name: "Alpha 包棟", capacity: 8, enabled: true, inventoryType: "bundle", mondayThursdayPrice: 8000 }
  ]
};

const catalog = buildPropertyCatalog(property);
const allFacts = [...catalog.amenities, ...catalog.policies, ...catalog.faqs];
const byId = (id) => allFacts.find((fact) => fact.canonicalId === id);

assert.equal(byId("parking").answer, "目前後台正式停車說明");
assert.equal(byId("bbq").answer, "目前後台正式烤肉說明");
assert.equal(byId("splash_pool").answer, "目前後台正式泳池說明");
assert.equal(byId("breakfast").answer, "目前後台正式早餐說明");
assert.equal(byId("pets").answer, "目前後台正式寵物說明");
assert.equal(byId("travel_subsidy").answer, "目前後台正式國旅補助說明");

assert.equal(byId("check_in").answer, "15:00");
assert.equal(byId("check_in__latest_arrival_policy").answer, "最晚 22:00，超過請提前聯絡");
assert.equal(byId("check_out").answer, "11:00");
assert.equal(byId("location").answer, mapUrl);
assert.equal(byId("location").address, "正式地址");

for (const legacyId of ["legacy_subject", "legacy_faq", "equipment_1", "equipment_2", "equipment_3"]) {
  assert.equal(byId(legacyId), undefined, `${legacyId} must not have production catalog authority`);
}
assert.equal(resolveEntity(catalog, { category: "amenity", rawText: "洗髮乳", canonicalCandidate: null }).status, "not_found");
assert.equal(resolveEntity(catalog, { category: "amenity", rawText: "沐浴乳", canonicalCandidate: null }).status, "not_found");
assert.equal(resolveEntity(catalog, { category: "amenity", rawText: "一次性備品", canonicalCandidate: null }).status, "not_found");
assert.equal(catalog.locationDiagnostics.source, "businessProfile.googleMapsUrl");

const legacyOnly = buildPropertyCatalog({
  propertyId: "authority-legacy-only",
  displayName: "Legacy only",
  businessProfile: {},
  rooms: [],
  commonAnswers: { parkingRule: "legacy", equipment: ["legacy equipment"], transport: "https://maps.google.com/?q=legacy" },
  faqs: [{ knowledgeKey: "legacy_faq", question: "legacy", answer: "legacy" }],
  semanticCatalog: { aliases: { legacy_subject: ["legacy"] }, amenities: [{ id: "legacy_subject", name: "legacy", status: "confirmed_yes", answer: "legacy" }] }
});
assert.deepEqual(legacyOnly.amenities, []);
assert.deepEqual(legacyOnly.faqs, []);
assert.equal(legacyOnly.policies.some((fact) => fact.canonicalId === "parking" && fact.status !== "unknown"), false);
assert.equal(legacyOnly.policies.find((fact) => fact.canonicalId === "location").status, "unknown");

console.log("CURRENT_PROPERTY_AUTHORITY_PASS");
