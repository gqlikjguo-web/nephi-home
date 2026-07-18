"use strict";

function clean(value, limit = 120) { return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, limit); }
function aliasesFor(property, id) { const map = property.semanticCatalog && property.semanticCatalog.aliases || {}; return Array.isArray(map[id]) ? map[id].map((x) => clean(x, 80)).filter(Boolean) : []; }

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
  const known = PROPERTY_SETTING_CATALOG.map(([settingKey, canonicalId, publicName, category]) => ({
    canonicalId, category, publicName,
    aliases: aliasesFor(property, canonicalId),
    status: answers[settingKey] ? "confirmed_yes" : "unknown",
    answer: clean(answers[settingKey], 800)
  }));
  const additional = Object.entries(answers).flatMap(([settingKey, answer]) => {
    if (knownKeys.has(settingKey) || typeof answer !== "string" || !clean(answer, 800)) return [];
    return [{ canonicalId: clean(settingKey, 120), category: "policy", publicName: clean(settingKey, 120), aliases: aliasesFor(property, settingKey), status: "confirmed_yes", answer: clean(answer, 800) }];
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
  const amenities = Array.isArray(explicitAmenities) ? explicitAmenities.map((item) => ({
    canonicalId: clean(item.id), category: "amenity", publicName: clean(item.name, 80), aliases: (item.aliases || []).map((x) => clean(x, 80)), status: ["confirmed_yes", "confirmed_no", "unknown"].includes(item.status) ? item.status : "unknown", answer: clean(item.answer, 500)
  })) : (Array.isArray(confirmedEquipment) ? confirmedEquipment : []).map((name, index) => ({ canonicalId: `equipment_${index + 1}`, category: "amenity", publicName: clean(name, 80), aliases: [], status: "confirmed_yes", answer: "" }));
  const answers = property.commonAnswers || {};
  const policies = propertySettingFacts(property, answers);
  const faqs = (property.faqs || []).filter((item) => item && item.question && item.answer).map((item) => { const canonicalId = clean(item.knowledgeId || item.id || item.knowledgeKey, 120); return { canonicalId, category: "amenity", publicName: clean(item.question, 200), aliases: aliasesFor(property, canonicalId), status: "confirmed_yes", answer: clean(item.answer, 800) }; }).slice(0, 50);
  return { propertyId: clean(property.propertyId), displayName: clean(property.displayName, 100), timezone: clean(property.timezone || "Asia/Taipei", 80), currency: clean(property.currency || "TWD", 10), rooms, amenities, policies, faqs };
}

module.exports = { buildPropertyCatalog, PROPERTY_SETTING_CATALOG };
