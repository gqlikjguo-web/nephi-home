"use strict";

const { JsonFileRepository } = require("./json-repository");

const MAX_ROOM_COUNT = 100;
const INVENTORY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const PROPERTY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const FAQ_KNOWLEDGE_SAFE_FACTS = Object.freeze({
  breakfast: "breakfastRule",
  drinking_water: "drinkingWaterRule",
  laundry: "laundryRule",
  elevator: "elevatorRule",
  baby_supplies: "babySuppliesRule",
  pet_rule: "petRule",
  self_checkin: "selfCheckInRule",
  equipment: "equipment",
  // `singing` is a canonical property knowledge identifier.  Unlike the
  // entries above it remains a FAQ fact, so it has no commonAnswers mirror.
  singing: null
});

function requiredText(value, field, maxLength = 1000) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > maxLength) throw new Error(`${field} is too long`);
  return text;
}

function roomIdFor(room, index) {
  const explicitId = String(room && room.id || "").trim();
  if (explicitId) {
    if (!INVENTORY_ID_PATTERN.test(explicitId)) throw new Error(`rooms[${index}].id is invalid`);
    return explicitId;
  }
  const name = requiredText(room && room.name, `rooms[${index}].name`, 80);
  const leadingCode = name.match(/^[a-zA-Z0-9][a-zA-Z0-9_-]*/)?.[0] || "";
  return leadingCode ? `room${leadingCode}` : `room_${index + 1}`;
}

function validateFriendlyProperty(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("property JSON object is required");
  const propertyId = requiredText(input.propertyId, "propertyId", 64);
  if (!PROPERTY_ID_PATTERN.test(propertyId)) throw new Error("propertyId must use lowercase letters, numbers, underscore or hyphen");
  const propertyName = requiredText(input.propertyName, "propertyName", 80);
  const checkInTime = requiredText(input.checkInTime, "checkInTime", 5);
  const checkOutTime = requiredText(input.checkOutTime, "checkOutTime", 5);
  if (!TIME_PATTERN.test(checkInTime)) throw new Error("checkInTime must use HH:MM");
  if (!TIME_PATTERN.test(checkOutTime)) throw new Error("checkOutTime must use HH:MM");

  if (!Array.isArray(input.rooms) || input.rooms.length < 1 || input.rooms.length > MAX_ROOM_COUNT) {
    throw new Error(`rooms must contain 1 to ${MAX_ROOM_COUNT} room types`);
  }
  const rooms = input.rooms.map((room, index) => {
    const capacity = Number(room && room.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) throw new Error(`rooms[${index}].capacity must be an integer from 1 to 50`);
    return {
      id: roomIdFor(room, index),
      name: requiredText(room && room.name, `rooms[${index}].name`, 80),
      capacity,
      type: "custom",
      description: ""
    };
  });
  if (new Set(rooms.map((room) => room.id)).size !== rooms.length) throw new Error("rooms.id must be unique");

  if (!input.pricing || typeof input.pricing !== "object" || Array.isArray(input.pricing)) throw new Error("pricing is required");
  const pricing = {
    weekday: requiredText(input.pricing.weekday, "pricing.weekday", 500),
    holiday: requiredText(input.pricing.holiday, "pricing.holiday", 500)
  };
  if (typeof input.selfCheckIn !== "boolean") throw new Error("selfCheckIn must be true or false");
  if (!Array.isArray(input.humanHandoffSituations) || !input.humanHandoffSituations.length) {
    throw new Error("humanHandoffSituations must contain at least one item");
  }
  const humanHandoffSituations = input.humanHandoffSituations.map((item, index) => requiredText(item, `humanHandoffSituations[${index}]`, 200));
  if (!Array.isArray(input.faqs) || input.faqs.length < 10 || input.faqs.length > 20) {
    throw new Error("faqs must contain 10 to 20 items");
  }
  const usedKnowledgeKeys = new Set();
  const faqs = input.faqs.map((faq, index) => {
    const knowledgeKey = String(faq && faq.knowledgeKey || "").trim();
    if (knowledgeKey && !Object.hasOwn(FAQ_KNOWLEDGE_SAFE_FACTS, knowledgeKey)) {
      throw new Error(`faqs[${index}].knowledgeKey is not allowed`);
    }
    if (knowledgeKey && usedKnowledgeKeys.has(knowledgeKey)) {
      throw new Error(`faqs[${index}].knowledgeKey must be unique`);
    }
    if (knowledgeKey) usedKnowledgeKeys.add(knowledgeKey);
    return {
      question: requiredText(faq && faq.question, `faqs[${index}].question`, 300),
      answer: requiredText(faq && faq.answer, `faqs[${index}].answer`, 1000),
      ...(knowledgeKey ? { knowledgeKey } : {})
    };
  });
  const faqSafeFacts = Object.fromEntries(faqs
    .filter((faq) => faq.knowledgeKey && FAQ_KNOWLEDGE_SAFE_FACTS[faq.knowledgeKey])
    .map((faq) => [FAQ_KNOWLEDGE_SAFE_FACTS[faq.knowledgeKey], faq.answer]));

  const parking = requiredText(input.parking, "parking", 1000);
  const bbq = requiredText(input.bbq, "bbq", 1000);
  const paymentMethod = requiredText(input.paymentMethod, "paymentMethod", 1000);
  const cancellationPolicy = requiredText(input.cancellationPolicy, "cancellationPolicy", 1000);
  return {
    propertyId,
    name: propertyName,
    rooms,
    pricing,
    faqs,
    humanHandoffSituations,
    safeFacts: {
      checkInTime,
      checkOutTime,
      parkingRule: parking,
      bbqRule: bbq,
      petRule: faqSafeFacts.petRule || "",
      equipment: faqSafeFacts.equipment || "",
      breakfastRule: faqSafeFacts.breakfastRule || "",
      drinkingWaterRule: faqSafeFacts.drinkingWaterRule || "",
      laundryRule: faqSafeFacts.laundryRule || "",
      elevatorRule: faqSafeFacts.elevatorRule || "",
      babySuppliesRule: faqSafeFacts.babySuppliesRule || "",
      selfCheckInRule: faqSafeFacts.selfCheckInRule || "",
      priceRule: `平日：${pricing.weekday}；假日：${pricing.holiday}`,
      paymentRule: paymentMethod,
      // All new materializations expose the V2 canonical cancellation fact.
      // property-catalog retains read compatibility for older lodgingRules.
      cancellationRule: cancellationPolicy,
      otherFacts: input.selfCheckIn ? "提供自助入住，實際方式由業者確認。" : "不提供自助入住。"
    },
    onboarding: { isReady: true, nextStepLabel: "設定房況月曆" }
  };
}

function importFriendlyProperty(input, { dataFile, seedFile, now = () => new Date(), seedDays = 240 } = {}) {
  const normalized = validateFriendlyProperty(input);
  const repository = new JsonFileRepository({ dataFile, seedFile, now });
  const { propertyId, ...propertyData } = normalized;
  const result = repository.upsertHomestay({ customerId: propertyId, ...propertyData }, { seedDays });
  return { propertyId: normalized.propertyId, created: result.created };
}

module.exports = {
  importFriendlyProperty,
  validateFriendlyProperty,
  MAX_ROOM_COUNT,
  FAQ_KNOWLEDGE_SAFE_FACTS
};
