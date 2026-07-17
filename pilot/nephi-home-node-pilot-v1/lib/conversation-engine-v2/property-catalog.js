"use strict";

function clean(value, limit = 120) { return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, limit); }
function aliasesFor(property, id) { const map = property.semanticCatalog && property.semanticCatalog.aliases || {}; return Array.isArray(map[id]) ? map[id].map((x) => clean(x, 80)).filter(Boolean) : []; }

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
  const policies = [
    ["parking", "停車", "parkingRule", "amenity"], ["bbq", "烤肉", "bbqRule", "policy"], ["check_in", "入住", "checkInTime", "policy"], ["check_out", "退房", "checkOutTime", "policy"], ["payment", "付款", "paymentRule", "policy"], ["cancellation", "取消", "cancellationRule", "policy"]
  ].map(([id, name, key, category]) => ({ canonicalId: id, category, publicName: name, aliases: aliasesFor(property, id), status: answers[key] ? "confirmed_yes" : "unknown", answer: clean(answers[key], 800) }));
  const faqs = (property.faqs || []).filter((item) => item && item.question && item.answer).map((item) => ({ canonicalId: clean(item.knowledgeId || item.id || item.knowledgeKey, 120), question: clean(item.question, 200), answer: clean(item.answer, 800), category: clean(item.knowledgeKey || "property_fact", 80) })).slice(0, 50);
  return { propertyId: clean(property.propertyId), displayName: clean(property.displayName, 100), timezone: clean(property.timezone || "Asia/Taipei", 80), currency: clean(property.currency || "TWD", 10), rooms, amenities, policies, faqs };
}

module.exports = { buildPropertyCatalog };
