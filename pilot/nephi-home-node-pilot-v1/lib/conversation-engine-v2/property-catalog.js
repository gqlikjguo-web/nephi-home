"use strict";

const { normalizeGoogleMapsUrl, extractGoogleMapsUrl } = require("../google-maps-url");
const { PRESET_AMENITIES, providedAmenities } = require("../bundle-entertainment");

function clean(value, limit = 120) { return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, limit); }
function aliasesFor(property, id) { const map = property.semanticCatalog && property.semanticCatalog.aliases || {}; return Array.isArray(map[id]) ? map[id].map((x) => clean(x, 80)).filter(Boolean) : []; }

// Canonical IDs describe shared hospitality capabilities, never a property's
// answer.  A capability appears in a catalog only when that property supplied
// a fact carrying the ID; aliases therefore cannot create facts by themselves.
const CANONICAL_FACT_ALIASES = Object.freeze({
  singing: Object.freeze(["唱歌", "卡拉 OK", "卡拉OK", "KTV"]),
  cancellation: Object.freeze(["取消", "退費", "退訂", "延期", "改日期"])
});
function canonicalAliases(id) { return CANONICAL_FACT_ALIASES[id] || []; }
function mergedAliases(property, id) { return [...new Set([...canonicalAliases(id), ...aliasesFor(property, id)])]; }
const LOCATION_ALIASES = Object.freeze(["location", "navigation", "directions", "google maps"]);

// This is a registry of data keys, not question text.  A property may expose
// only a subset; any additional non-empty property-backed setting is retained
// below as a generic policy fact instead of silently becoming unanswerable.
const PROPERTY_SETTING_CATALOG = Object.freeze([
  ["parkingRule", "parking", "停車", "amenity"],
  ["bbqRule", "bbq", "烤肉", "policy"],
  ["checkInTime", "check_in", "入住", "policy"],
  ["checkOutTime", "check_out", "退房", "policy"],
  ["selfCheckInRule", "self_checkin", "自助入住", "policy"],
  ["breakfastRule", "breakfast", "早餐", "policy"],
  ["drinkingWaterRule", "drinking_water", "飲水", "amenity"],
  ["laundryRule", "laundry", "洗衣", "amenity"],
  ["elevatorRule", "elevator", "電梯", "amenity"],
  ["babySuppliesRule", "baby_supplies", "嬰兒用品", "amenity"],
  ["petRule", "pets", "寵物", "policy"],
  ["paymentRule", "payment", "付款", "policy"],
  ["cancellationRule", "cancellation", "取消", "policy"],
  ["lodgingRules", "lodging_rules", "住宿規則", "policy"],
  ["priceRule", "price", "價格", "policy"]
]);

function propertySettingFacts(property, answers) {
  const knownKeys = new Set(PROPERTY_SETTING_CATALOG.map(([key]) => key));
  const known = PROPERTY_SETTING_CATALOG.map(([settingKey, canonicalId, publicName, category]) => {
    // lodgingRules was the pre-V2 cancellation storage key.  It is read only
    // as the canonical cancellation fact when the new key is absent.
    const answer = settingKey === "cancellationRule" ? (answers.cancellationRule || answers.lodgingRules) : answers[settingKey];
    return { canonicalId, category, publicName,
      aliases: mergedAliases(property, canonicalId),
      status: answer ? "confirmed_yes" : "unknown",
      answer: clean(answer, 800) };
  });
  const additional = Object.entries(answers).flatMap(([settingKey, answer]) => {
    if (knownKeys.has(settingKey) || typeof answer !== "string" || !clean(answer, 800)) return [];
    return [{ canonicalId: clean(settingKey, 120), category: "policy", publicName: clean(settingKey, 120), aliases: mergedAliases(property, settingKey), status: "confirmed_yes", answer: clean(answer, 800) }];
  });
  return [...known, ...additional];
}

function buildPropertyCatalog(property) {
  if (!property || !property.propertyId) throw new Error("property_required");
  const rooms = (property.rooms || []).filter((room) => room.enabled !== false).map((room) => ({
    canonicalId: clean(room.id), category: room.inventoryType === "bundle" ? "bundle" : "room",
    publicName: clean(room.publicDisplayName || room.displayName || room.publicName || room.name, 80),
    type: clean(room.type, 40), capacity: Number(room.capacity) || null,
    features: [room.publicShortFeature, room.shortFeature, room.description].map((x) => clean(x, 40)).filter(Boolean).slice(0, 1),
    aliases: aliasesFor(property, room.id), memberRoomIds: room.inventoryType === "bundle" ? (room.memberRoomIds || []).map(String) : []
  }));
  const explicitAmenities = property.semanticCatalog && property.semanticCatalog.amenities;
  const confirmedEquipment = property.commonAnswers && property.commonAnswers.equipment;
  const legacyAmenities = Array.isArray(explicitAmenities) ? explicitAmenities.map((item) => ({
    canonicalId: clean(item.id), category: "amenity", publicName: clean(item.name, 80), aliases: (item.aliases || []).map((x) => clean(x, 80)), status: ["confirmed_yes", "confirmed_no", "unknown"].includes(item.status) ? item.status : "unknown", answer: clean(item.answer, 500)
  })) : (Array.isArray(confirmedEquipment) ? confirmedEquipment : []).map((name, index) => ({ canonicalId: `equipment_${index + 1}`, category: "amenity", publicName: clean(name, 80), aliases: [], status: "confirmed_yes", answer: "" }));
  const presetMap = new Map(PRESET_AMENITIES.map((item) => [item.key, item]));
  const bundleFacts = new Map();
  for (const room of (property.rooms || []).filter((item) => item.inventoryType === "bundle" && item.enabled !== false)) {
    for (const amenity of providedAmenities(room.entertainmentAmenities)) {
      const current = bundleFacts.get(amenity.key) || { canonicalId: amenity.key, category: "amenity", publicName: amenity.displayName, aliases: [...(presetMap.get(amenity.key)?.aliases || [])], status: "confirmed_yes", answer: "", applicableBundles: [] };
      current.applicableBundles.push({ id: clean(room.id), name: clean(room.publicDisplayName || room.displayName || room.name, 80), note: clean(amenity.note, 100) });
      bundleFacts.set(amenity.key, current);
    }
  }
  for (const fact of bundleFacts.values()) {
    fact.answer = fact.applicableBundles.map((bundle) => `${bundle.name}${bundle.note ? `：${bundle.note}` : ""}`).join("；");
  }
  const structuredIds = new Set(bundleFacts.keys());
  const amenities = [...bundleFacts.values(), ...legacyAmenities.filter((item) => !structuredIds.has(item.canonicalId))];
  const answers = property.commonAnswers || {};
  // `transport` is the existing property-scoped storage key used before the
  // dedicated business profile field was introduced.  It is accepted only
  // when its complete value is a validated Google Maps URL; arbitrary
  // transport prose can never become a location fact.
  const profileMapUrl = normalizeGoogleMapsUrl(property.businessProfile && property.businessProfile.googleMapsUrl);
  const legacyTransportMapUrl = extractGoogleMapsUrl(answers.transport);
  const mapUrl = profileMapUrl || legacyTransportMapUrl;
  const locationDiagnostics = {
    source: profileMapUrl ? "businessProfile.googleMapsUrl" : legacyTransportMapUrl ? "commonAnswers.transport" : "none",
    profileValuePresent: Boolean(property.businessProfile && property.businessProfile.googleMapsUrl),
    transportValuePresent: Boolean(answers.transport),
    urlValidation: mapUrl ? "pass" : "fail"
  };
  const policies = [...propertySettingFacts(property, answers), { canonicalId: "location", category: "transport", publicName: "位置與導航", aliases: [...new Set([...LOCATION_ALIASES, ...aliasesFor(property, "location")])], status: mapUrl ? "confirmed_yes" : "unknown", answer: mapUrl }];
  const faqs = (property.faqs || []).filter((item) => item && item.question && item.answer).map((item) => { const canonicalId = clean(item.knowledgeKey || item.knowledgeId || item.id, 120); return { canonicalId, category: "amenity", publicName: clean(item.question, 200), aliases: mergedAliases(property, canonicalId), status: "confirmed_yes", answer: clean(item.answer, 800) }; }).slice(0, 50);
  return { propertyId: clean(property.propertyId), displayName: clean(property.displayName, 100), timezone: clean(property.timezone || "Asia/Taipei", 80), currency: clean(property.currency || "TWD", 10), rooms, amenities, policies, faqs, locationDiagnostics };
}

module.exports = { buildPropertyCatalog, PROPERTY_SETTING_CATALOG, CANONICAL_FACT_ALIASES };
