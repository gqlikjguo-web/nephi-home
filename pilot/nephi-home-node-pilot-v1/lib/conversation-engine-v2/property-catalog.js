"use strict";

const { normalizeGoogleMapsUrl, extractGoogleMapsUrl } = require("../google-maps-url");
const { PRESET_AMENITIES, normalizeEntertainmentAmenities } = require("../bundle-entertainment");
const { equipmentByCanonicalId } = require("../../public/assets/high-frequency-equipment");

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
  ["latestArrivalTime", "check_in__latest_arrival_policy", "最晚入住時間", "policy"],
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

function structuredPropertyFacts(property) {
  return (property.propertyFacts || []).map((fact) => {
    const category = ["amenity", "room_amenity"].includes(fact.category)
      ? "amenity"
      : fact.category === "location"
        ? "transport"
        : "policy";
    let status = fact.status === "unknown"
      ? "unknown"
      : fact.status === "not_allowed"
        ? "confirmed_no"
        : "confirmed_yes";
    let answer = fact.canonicalId === "location"
      ? normalizeGoogleMapsUrl(fact.publicText)
      : clean(fact.publicText, 1000);
    const equipment = equipmentByCanonicalId(fact.canonicalId);
    let appliesTo = fact.appliesTo || "whole_property";
    if (equipment && appliesTo === "both") appliesTo = "whole_property";
    if (equipment && appliesTo === "room_only") {
      status = "unknown";
      appliesTo = "whole_property";
    }
    if (equipment && status !== "confirmed_yes") appliesTo = "whole_property";
    if (equipment && appliesTo === "bundle_only" && status === "confirmed_yes" && answer) answer = `\u50c5\u5305\u68df\u5ba2\u9069\u7528\uff1a${answer}`;

    return {
      canonicalId: clean(fact.canonicalId, 120),
      category,
      publicName: clean(fact.publicName || fact.canonicalId, 120),
      aliases: mergedAliases(property, fact.canonicalId),
      status: answer || status === "confirmed_no" ? status : "unknown",
      answer,
      propertyFact: fact,
      appliesTo,
    };
  }).filter((fact) => fact.canonicalId);
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
  const structuredFacts = structuredPropertyFacts(property);
  const structuredIds = new Set(structuredFacts.map((fact) => fact.canonicalId));
  const explicitAmenities = property.semanticCatalog && property.semanticCatalog.amenities;
  const confirmedEquipment = property.commonAnswers && property.commonAnswers.equipment;
  const legacyAmenities = Array.isArray(explicitAmenities) ? explicitAmenities.map((item) => ({
    canonicalId: clean(item.id), category: "amenity", publicName: clean(item.name, 80), aliases: (item.aliases || []).map((x) => clean(x, 80)), status: ["confirmed_yes", "confirmed_no", "unknown"].includes(item.status) ? item.status : "unknown", answer: clean(item.answer, 500)
  })) : (Array.isArray(confirmedEquipment) ? confirmedEquipment : []).map((name, index) => ({ canonicalId: `equipment_${index + 1}`, category: "amenity", publicName: clean(name, 80), aliases: [], status: "confirmed_yes", answer: "" }));
  const presetMap = new Map(PRESET_AMENITIES.map((item) => [item.key, item]));
  const normalizedFaqs = (property.faqs || []).filter((item) => item && item.question && item.answer).map((item) => { const canonicalId = clean(item.knowledgeKey || item.knowledgeId || item.id, 120); return { canonicalId, category: "amenity", sourceKind: "faq", publicName: clean(item.question, 200), aliases: mergedAliases(property, canonicalId), status: "confirmed_yes", answer: clean(item.answer, 800) }; }).slice(0, 50);
  const faqByCanonicalId = new Map(normalizedFaqs.map((item) => [item.canonicalId, item]));
  const enabledBundles = (property.rooms || []).filter((item) => item.inventoryType === "bundle" && item.enabled !== false);
  const bundleStates = new Map(PRESET_AMENITIES.map((item) => [item.key, []]));
  const bundleFacts = new Map();
  for (const room of enabledBundles) {
    for (const amenity of normalizeEntertainmentAmenities(room.entertainmentAmenities)) {
      if (amenity.source !== "preset") continue;
      bundleStates.get(amenity.key).push(amenity.provided);
      if (amenity.provided !== true) continue;
      const current = bundleFacts.get(amenity.key) || { canonicalId: amenity.key, category: "amenity", publicName: amenity.displayName, aliases: [...(presetMap.get(amenity.key)?.aliases || [])], status: "confirmed_yes", answer: "", appliesTo: "bundle_only", applicableBundles: [] };
      current.applicableBundles.push({ id: clean(room.id), name: clean(room.publicDisplayName || room.displayName || room.name, 80), note: clean(amenity.note, 100) });
      bundleFacts.set(amenity.key, current);
    }
  }
  const explicitBundleIds = new Set([...bundleStates].filter(([, states]) => states.some((state) => state !== null)).map(([canonicalId]) => canonicalId));
  for (const preset of PRESET_AMENITIES) {
    const states = bundleStates.get(preset.key);
    const explicitNo = states.length > 0 && states.every((state) => state === false);
    if (!bundleFacts.has(preset.key) && !explicitNo) continue;
    const fact = bundleFacts.get(preset.key) || { canonicalId: preset.key, category: "amenity", publicName: preset.displayName, aliases: [...preset.aliases], status: "confirmed_no", answer: "", appliesTo: "bundle_only", applicableBundles: [] };
    const bundleAnswer = fact.applicableBundles.map((bundle) => `${bundle.name}${bundle.note ? `：${bundle.note}` : ""}`).join("；");
    fact.answer = bundleAnswer;
    bundleFacts.set(preset.key, fact);
  }
  const amenityFacts = new Map();
  for (const item of legacyAmenities) amenityFacts.set(item.canonicalId, item);
  for (const item of structuredFacts.filter((fact) => fact.category === "amenity" && !explicitBundleIds.has(fact.canonicalId))) amenityFacts.set(item.canonicalId, item);
  for (const item of bundleFacts.values()) amenityFacts.set(item.canonicalId, item);
  for (const [canonicalId, fact] of amenityFacts) {
    const bundleFact = bundleFacts.get(canonicalId), hasAuthoritativeBundleDetail = bundleFact?.status === "confirmed_no" || bundleFact?.applicableBundles?.some((bundle) => bundle.note);
    const faqAnswer = hasAuthoritativeBundleDetail ? "" : faqByCanonicalId.get(canonicalId)?.answer || "";
    if (faqAnswer && !fact.answer.includes(faqAnswer)) fact.answer = [fact.answer, faqAnswer].filter(Boolean).join("；");
  }
  const amenities = [...amenityFacts.values()];
  const answers = property.commonAnswers || {};
  // `transport` is the existing property-scoped storage key used before the
  // dedicated business profile field was introduced.  It is accepted only
  // when its complete value is a validated Google Maps URL; arbitrary
  // transport prose can never become a location fact.
  const profileMapUrl = normalizeGoogleMapsUrl(property.businessProfile && property.businessProfile.googleMapsUrl);
  const profileAddress = clean(property.businessProfile && property.businessProfile.address, 500);
  const legacyTransportMapUrl = extractGoogleMapsUrl(answers.transport);
  const mapUrl = profileMapUrl || legacyTransportMapUrl;
  const locationDiagnostics = {
    source: profileMapUrl ? "businessProfile.googleMapsUrl" : legacyTransportMapUrl ? "commonAnswers.transport" : "none",
    profileValuePresent: Boolean(property.businessProfile && property.businessProfile.googleMapsUrl),
    transportValuePresent: Boolean(answers.transport),
    urlValidation: mapUrl ? "pass" : "fail"
  };
  const structuredLocation = structuredFacts.find((fact) => fact.canonicalId === "location");
  const policies = [
    ...structuredFacts.filter((fact) => fact.category !== "amenity"),
    ...propertySettingFacts(property, answers).filter((fact) => !structuredIds.has(fact.canonicalId)),
    ...(structuredLocation ? [] : [{ canonicalId: "location", category: "transport", publicName: "位置與導航", aliases: [...new Set([...LOCATION_ALIASES, ...aliasesFor(property, "location")])], status: mapUrl ? "confirmed_yes" : "unknown", answer: mapUrl }])
  ];
  if (!structuredLocation) {
    const location = policies.find((fact) => fact.canonicalId === "location");
    location.status = mapUrl || profileAddress ? "confirmed_yes" : "unknown";
    location.answer = mapUrl || profileAddress;
    location.address = profileAddress;
    location.mapUrl = mapUrl;
  }
  const faqs = normalizedFaqs.filter((item) => !presetMap.has(item.canonicalId) && !amenityFacts.has(item.canonicalId));
  return { propertyId: clean(property.propertyId), displayName: clean(property.displayName, 100), timezone: clean(property.timezone || "Asia/Taipei", 80), currency: clean(property.currency || "TWD", 10), rooms, amenities, policies, faqs, locationDiagnostics };
}

module.exports = { buildPropertyCatalog, PROPERTY_SETTING_CATALOG, CANONICAL_FACT_ALIASES };
