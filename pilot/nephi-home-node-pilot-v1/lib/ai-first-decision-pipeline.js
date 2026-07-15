"use strict";

const DECISION_KEYS = new Set([
  "intent", "route", "confidence", "reason", "extractedFields",
  "missingFields", "shouldIgnore", "needsHuman"
]);
const FIELD_KEYS = new Set([
  "checkInDate", "checkOutDate", "nights", "guestCount", "roomType", "bookingType"
]);
const HIGH_RISK_INTENTS = new Set([
  "payment", "refund", "cancellation", "reschedule", "platform_order",
  "door_access", "complaint", "special_request", "early_checkin_late_checkout_request"
]);
const DEFAULT_INTENTS = [
  "availability", "price", "parking", "bbq", "checkin_rule", "pet_rule",
  "equipment", "breakfast", "drinking_water", "laundry", "elevator",
  "baby_supplies", "self_checkin", "greeting", "room_type_capacity", "acknowledgement", "meaningless",
  "payment", "refund", "cancellation", "reschedule", "platform_order", "door_access",
  "complaint", "special_request", "early_checkin_late_checkout_request", "unknown"
];
const DEFAULT_ROUTES = [
  "auto_reply_allowed", "clarification_needed", "human_handoff_required",
  "no_reply_silent_ignore"
];

function handoff(reason) {
  return {
    intent: "unknown",
    route: "human_handoff_required",
    confidence: 0,
    reason,
    extractedFields: {},
    missingFields: [],
    shouldIgnore: false,
    needsHuman: true
  };
}

function isReasonCode(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.-]{0,119}$/.test(value);
}

function receivedType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function addInvalid(invalidFields, path, expected, value, missing = false) {
  invalidFields.push({
    path,
    expected,
    receivedType: missing ? "missing" : receivedType(value)
  });
}

function validateExtractedFields(value, invalidFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addInvalid(invalidFields, "extractedFields", "object", value);
    return {};
  }
  const result = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    const path = `extractedFields.${key}`;
    if (!FIELD_KEYS.has(key)) {
      addInvalid(invalidFields, path, "no additional property", fieldValue);
      continue;
    }
    if (fieldValue === null) continue;
    if (key === "checkInDate" || key === "checkOutDate") {
      if (typeof fieldValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fieldValue)) {
        addInvalid(invalidFields, path, "YYYY-MM-DD string or null", fieldValue);
      } else {
        result[key] = fieldValue;
      }
    } else if (key === "nights" || key === "guestCount") {
      if (!Number.isInteger(fieldValue) || fieldValue < 1 || fieldValue > 50) {
        addInvalid(invalidFields, path, "integer between 1 and 50 or null", fieldValue);
      } else {
        result[key] = fieldValue;
      }
    } else {
      if (typeof fieldValue !== "string" || !fieldValue.trim() || fieldValue.length > 80) {
        addInvalid(invalidFields, path, "non-empty string up to 80 characters or null", fieldValue);
      } else {
        result[key] = fieldValue.trim();
      }
    }
  }
  return result;
}

function validateDecisionDetailed(value, input) {
  const invalidFields = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addInvalid(invalidFields, "$", "object with eight required fields", value);
    return { decision: null, invalidFields };
  }
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!DECISION_KEYS.has(key)) addInvalid(invalidFields, key, "no additional property", fieldValue);
  }
  for (const key of DECISION_KEYS) {
    if (!Object.hasOwn(value, key)) addInvalid(invalidFields, key, "required", undefined, true);
  }
  const availableIntents = new Set(input.availableIntents || []);
  const availableRoutes = new Set(input.availableRoutes || []);
  if (Object.hasOwn(value, "intent") && (typeof value.intent !== "string" || !availableIntents.has(value.intent))) {
    addInvalid(invalidFields, "intent", "allowed intent enum", value.intent);
  }
  if (Object.hasOwn(value, "route") && (typeof value.route !== "string" || !availableRoutes.has(value.route))) {
    addInvalid(invalidFields, "route", "allowed route enum", value.route);
  }
  if (Object.hasOwn(value, "confidence") && (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) {
    addInvalid(invalidFields, "confidence", "number between 0 and 1", value.confidence);
  }
  if (Object.hasOwn(value, "reason") && !isReasonCode(value.reason)) {
    addInvalid(invalidFields, "reason", "lowercase reason code", value.reason);
  }
  const extractedFields = Object.hasOwn(value, "extractedFields")
    ? validateExtractedFields(value.extractedFields, invalidFields)
    : {};
  if (Object.hasOwn(value, "missingFields")) {
    if (!Array.isArray(value.missingFields)) {
      addInvalid(invalidFields, "missingFields", "array of allowed field names", value.missingFields);
    } else {
      value.missingFields.forEach((key, index) => {
        if (typeof key !== "string" || !FIELD_KEYS.has(key)) {
          addInvalid(invalidFields, `missingFields[${index}]`, "allowed field name", key);
        }
      });
    }
  }
  for (const key of ["shouldIgnore", "needsHuman"]) {
    if (Object.hasOwn(value, key) && typeof value[key] !== "boolean") {
      addInvalid(invalidFields, key, "boolean", value[key]);
    }
  }
  if (invalidFields.length) return { decision: null, invalidFields };
  return { decision: {
    intent: value.intent,
    route: value.route,
    confidence: value.confidence,
    reason: value.reason,
    extractedFields,
    missingFields: [...new Set(value.missingFields)],
    shouldIgnore: value.shouldIgnore,
    needsHuman: value.needsHuman
  }, invalidFields };
}

function validateDecision(value, input) {
  return validateDecisionDetailed(value, input).decision;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  return Promise.race([
    Promise.resolve(promise).then((value) => ({ value }), (error) => ({ error })),
    timeout
  ]).finally(() => clearTimeout(timer));
}

function safetyHandoff(decision, reason) {
  return {
    ...decision,
    route: "human_handoff_required",
    reason,
    shouldIgnore: false,
    needsHuman: true
  };
}

function validDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function present(value) {
  return value !== undefined && value !== null && value !== "";
}

function completeStayDates(decision, input = {}) {
  const extractedFields = { ...decision.extractedFields };
  const accumulatedFields = input.accumulatedFields && typeof input.accumulatedFields === "object"
    ? input.accumulatedFields
    : {};
  const effectiveFields = { ...accumulatedFields };
  for (const [key, value] of Object.entries(extractedFields)) {
    if (present(value)) effectiveFields[key] = value;
  }
  const stayBasisChanged = present(extractedFields.checkInDate) || present(extractedFields.nights);
  const shouldDeriveCheckOut = !present(extractedFields.checkOutDate)
    && (stayBasisChanged || !present(effectiveFields.checkOutDate));
  if (validDateKey(effectiveFields.checkInDate)
      && Number.isInteger(effectiveFields.nights)
      && effectiveFields.nights > 0
      && shouldDeriveCheckOut) {
    extractedFields.checkOutDate = addDays(effectiveFields.checkInDate, effectiveFields.nights);
    effectiveFields.checkOutDate = extractedFields.checkOutDate;
  }
  let missingFields = decision.missingFields.filter((field) => !present(effectiveFields[field]));
  if (decision.intent === "availability") {
    missingFields = [];
    if (!present(effectiveFields.checkInDate)) missingFields.push("checkInDate");
    if (!present(effectiveFields.checkOutDate) && !present(effectiveFields.nights)) missingFields.push("nights");
    if (!present(effectiveFields.guestCount)) missingFields.push("guestCount");
  }
  return { ...decision, extractedFields, missingFields };
}

function applySafetyPolicy(decision, input, minConfidence) {
  if (decision.confidence < minConfidence) return handoff("classifier_low_confidence");
  if (decision.intent === "unknown") return handoff("unknown_intent");
  if (HIGH_RISK_INTENTS.has(decision.intent)) return safetyHandoff(decision, `high_risk_${decision.intent}`);

  const checkInDate = decision.extractedFields.checkInDate
    || input.accumulatedFields && input.accumulatedFields.checkInDate;
  if (checkInDate && !validDateKey(checkInDate)) return safetyHandoff(decision, "invalid_check_in_date");
  if (checkInDate && validDateKey(input.currentDate) && checkInDate < input.currentDate) {
    return safetyHandoff(decision, "past_check_in_date");
  }

  const roomType = decision.extractedFields.roomType || input.accumulatedFields && input.accumulatedFields.roomType;
  const guestCount = decision.extractedFields.guestCount || input.accumulatedFields && input.accumulatedFields.guestCount;
  const room = roomType && input.property && Array.isArray(input.property.rooms)
    ? input.property.rooms.find((item) => item.id === roomType)
    : null;
  if (room && guestCount && Number(guestCount) > Number(room.capacity || 0)) {
    return handoff("over_capacity");
  }

  if (decision.needsHuman || decision.route === "human_handoff_required") {
    return { ...decision, route: "human_handoff_required", shouldIgnore: false, needsHuman: true };
  }
  if (decision.shouldIgnore || decision.route === "no_reply_silent_ignore") {
    return { ...decision, route: "no_reply_silent_ignore", shouldIgnore: true, needsHuman: false };
  }
  return decision;
}

function createAiFirstDecisionPipeline({ classifier, timeoutMs = 15000, minConfidence = 0.7, onValidationDiagnostic } = {}) {
  return {
    async decide(input) {
      if (!classifier || typeof classifier.classify !== "function") return handoff("classifier_not_configured");
      const outcome = await withTimeout(classifier.classify({
        propertyId: input.propertyId,
        channelId: input.channelId,
        lineUserId: input.lineUserId,
        currentMessage: input.currentMessage,
        currentMessages: input.currentMessages,
        recentMessages: input.recentMessages,
        conversationState: input.conversationState,
        accumulatedFields: input.accumulatedFields,
        currentDate: input.currentDate,
        timeZone: input.timeZone,
        availableIntents: input.availableIntents,
        availableRoutes: input.availableRoutes
      }), Math.max(1, Number(timeoutMs || 15000)));
      if (outcome.timedOut) return handoff("classifier_timeout");
      if (outcome.error && outcome.error.code === "structured_classifier_timeout") return handoff("classifier_timeout");
      if (outcome.error) return handoff("classifier_exception");
      const validation = validateDecisionDetailed(outcome.value, input);
      if (!validation.decision) {
        if (typeof onValidationDiagnostic === "function") {
          try {
            onValidationDiagnostic({ code: "classifier_invalid_schema", invalidFields: validation.invalidFields });
          } catch {
            // Diagnostics must never change fail-closed behavior.
          }
        }
        return handoff("classifier_invalid_schema");
      }
      const decision = completeStayDates(validation.decision, input);
      return applySafetyPolicy(decision, input, Number(minConfidence || 0.7));
    }
  };
}

module.exports = {
  createAiFirstDecisionPipeline,
  validateDecision,
  validateDecisionDetailed,
  applySafetyPolicy,
  HIGH_RISK_INTENTS,
  DEFAULT_INTENTS,
  DEFAULT_ROUTES
};
