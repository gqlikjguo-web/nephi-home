"use strict";

const { normalizeGoogleMapsUrl } = require("../google-maps-url");
const { PRESET_AMENITIES, normalizeEntertainmentAmenities } = require("../bundle-entertainment");
const { equipmentByCanonicalId } = require("../../public/assets/high-frequency-equipment");
const { normalizeMultilineText } = require("../multiline-text");

function clean(value, limit = 120) { return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, limit); }
// Canonical IDs describe shared hospitality capabilities, never a property's
// answer.  A capability appears in a catalog only when that property supplied
// a fact carrying the ID; aliases therefore cannot create facts by themselves.
const CANONICAL_FACT_ALIASES = Object.freeze({
  singing: Object.freeze(["唱歌", "卡拉 OK", "卡拉OK", "KTV"]),
  cancellation: Object.freeze(["取消", "退費", "退訂", "延期", "改日期"])
});
function canonicalAliases(id) { return CANONICAL_FACT_ALIASES[id] || []; }
function mergedAliases(_property, id) { return [...canonicalAliases(id)]; }
const LOCATION_ALIASES = Object.freeze(["location", "navigation", "directions", "google maps"]);

// These are the only commonAnswers keys written by the current operator
// profile form. All other property facts must come from propertyFacts.
const PROPERTY_SETTING_CATALOG = Object.freeze([
  ["checkInTime", "check_in", "入住", "policy"],
  ["earlyCheckInPolicy", "check_in__early_arrival_policy", "提前入住規則", "policy"],
  ["latestArrivalTime", "check_in__latest_arrival_policy", "最晚入住時間", "policy"],
  ["checkOutTime", "check_out", "退房", "policy"]
]);

function propertySettingFacts(property, answers) {
  return PROPERTY_SETTING_CATALOG.map(([settingKey, canonicalId, publicName, category]) => {
    const answer = answers[settingKey];
    return { canonicalId, category, publicName,
      aliases: mergedAliases(property, canonicalId),
      status: answer ? "confirmed_yes" : "unknown",
      answer: clean(answer, 800) };
  });
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
      : normalizeMultilineText(String(fact.publicText || ""), 1000);
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
      aliases: [...new Set([
        ...canonicalAliases(fact.canonicalId),
        ...(Array.isArray(fact.aliases) ? fact.aliases.map((alias) => clean(alias, 80)).filter(Boolean) : [])
      ])],
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
    aliases: Array.isArray(room.aliases) ? room.aliases.map((alias) => clean(alias, 80)).filter(Boolean) : [], memberRoomIds: room.inventoryType === "bundle" ? (room.memberRoomIds || []).map(String) : []
  }));
  const structuredFacts = structuredPropertyFacts(property);
  const structuredIds = new Set(structuredFacts.map((fact) => fact.canonicalId));
  const presetMap = new Map(PRESET_AMENITIES.map((item) => [item.key, item]));
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
    const bundleAnswer = fact.applicableBundles.map((bundle) => bundle.note).filter(Boolean).join("；");
    fact.answer = bundleAnswer;
    bundleFacts.set(preset.key, fact);
  }
  const amenityFacts = new Map();
  for (const item of structuredFacts.filter((fact) => fact.category === "amenity" && !explicitBundleIds.has(fact.canonicalId))) amenityFacts.set(item.canonicalId, item);
  for (const item of bundleFacts.values()) amenityFacts.set(item.canonicalId, item);
  const amenities = [...amenityFacts.values()];
  const answers = property.commonAnswers || {};
  // Location authority comes only from current operator-managed profile or
  // structured propertyFacts data. Legacy commonAnswers transport is ignored.
  const profileMapUrl = normalizeGoogleMapsUrl(property.businessProfile && property.businessProfile.googleMapsUrl);
  const profileAddress = clean(property.businessProfile && property.businessProfile.address, 500);
  const mapUrl = profileMapUrl;
  const locationDiagnostics = {
    source: profileMapUrl ? "businessProfile.googleMapsUrl" : "none",
    profileValuePresent: Boolean(property.businessProfile && property.businessProfile.googleMapsUrl),
    transportValuePresent: false,
    urlValidation: mapUrl ? "pass" : "fail"
  };
  const structuredLocation = structuredFacts.find((fact) => fact.canonicalId === "location");
  const policies = [
    ...structuredFacts.filter((fact) => fact.category !== "amenity"),
    ...propertySettingFacts(property, answers).filter((fact) => !structuredIds.has(fact.canonicalId)),
    ...(structuredLocation ? [] : [{ canonicalId: "location", category: "transport", publicName: "位置與導航", aliases: [...LOCATION_ALIASES], status: mapUrl ? "confirmed_yes" : "unknown", answer: mapUrl }])
  ];
  if (!structuredLocation) {
    const location = policies.find((fact) => fact.canonicalId === "location");
    location.status = mapUrl || profileAddress ? "confirmed_yes" : "unknown";
    location.answer = mapUrl || profileAddress;
    location.address = profileAddress;
    location.mapUrl = mapUrl;
  }
  return { propertyId: clean(property.propertyId), displayName: clean(property.displayName, 100), timezone: clean(property.timezone || "Asia/Taipei", 80), currency: clean(property.currency || "TWD", 10), rooms, amenities, policies, faqs: [], locationDiagnostics };
}

module.exports = { buildPropertyCatalog, PROPERTY_SETTING_CATALOG, CANONICAL_FACT_ALIASES };
