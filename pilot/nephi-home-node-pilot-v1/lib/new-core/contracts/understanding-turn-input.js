"use strict";

const UNDERSTANDING_TURN_INPUT_SCHEMA_VERSION = 1;
const MAX_SOURCE_EVENTS = 20;
const MAX_RECENT_CONVERSATION = 20;
const MAX_REFERENCEABLE_CYCLES = 20;
const MAX_CATALOG_ITEMS = 100;
const MAX_MESSAGE_TEXT_LENGTH = 4000;
const MAX_ID_LENGTH = 160;

const ROOT_FIELDS = Object.freeze([
  "schemaVersion",
  "coreVersion",
  "traceId",
  "turnId",
  "propertyScope",
  "sourceEvents",
  "recentConversation",
  "referenceableCycles",
  "propertyTimezone",
  "capabilityCatalog",
  "publicSubjectCatalog"
]);
const PROPERTY_SCOPE_FIELDS = Object.freeze(["propertyId", "channel", "userId"]);
const SOURCE_EVENT_FIELDS = Object.freeze([
  "eventId",
  "messageRef",
  "role",
  "timestamp",
  "messageKind",
  "messageText"
]);
const RECENT_CONVERSATION_FIELDS = Object.freeze([
  ...SOURCE_EVENT_FIELDS,
  "referenceableCycleIds"
]);
const REFERENCEABLE_CYCLE_FIELDS = Object.freeze([
  "requestCycleId",
  "requestKind",
  "capability",
  "status",
  "expiresAt",
  "subject",
  "missingFields",
  "confirmedValues",
  "slotRefs"
]);
const REFERENCEABLE_SUBJECT_FIELDS = Object.freeze(["kind", "catalogIdentity"]);
const CONFIRMED_VALUE_FIELDS = Object.freeze([
  "checkIn",
  "checkOut",
  "guestCount",
  "searchFrom",
  "searchTo"
]);
const PUBLIC_SUBJECT_FIELDS = Object.freeze([
  "catalogIdentity",
  "kind",
  "publicName"
]);
const MESSAGE_KINDS = new Set(["text", "sticker", "image", "video", "file"]);
const ROLES = new Set(["guest", "assistant"]);
const REFERENCEABLE_STATUSES = new Set(["active", "pending", "answered"]);
const SUBJECT_KINDS = new Set([
  "property",
  "room",
  "bundle",
  "matched_room_set",
  "amenity",
  "policy",
  "external_place",
  "other_verified"
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, fields) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

function boundedText(value, limit = MAX_ID_LENGTH) {
  return typeof value === "string" && value.length > 0 && value.length <= limit;
}

function timestamp(value) {
  return boundedText(value, 80) && Number.isFinite(Date.parse(value));
}

function nullableBoundedText(value, limit = MAX_ID_LENGTH) {
  return value === null || boundedText(value, limit);
}

function nullableDate(value) {
  return value === null || typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function uniqueBoundedStrings(value, limit, itemLimit = MAX_ID_LENGTH) {
  return Array.isArray(value)
    && value.length <= limit
    && value.every((item) => boundedText(item, itemLimit))
    && new Set(value).size === value.length;
}

function validateEvent(value, fields, errors, prefix) {
  if (!exactKeys(value, fields)) errors.push(`${prefix}.keys`);
  if (!boundedText(value && value.eventId)) errors.push(`${prefix}.eventId`);
  if (!boundedText(value && value.messageRef)) errors.push(`${prefix}.messageRef`);
  if (!ROLES.has(value && value.role)) errors.push(`${prefix}.role`);
  if (!timestamp(value && value.timestamp)) errors.push(`${prefix}.timestamp`);
  if (!MESSAGE_KINDS.has(value && value.messageKind)) errors.push(`${prefix}.messageKind`);
  if (value && value.messageKind === "text") {
    if (!boundedText(value.messageText, MAX_MESSAGE_TEXT_LENGTH)) {
      errors.push(`${prefix}.messageText`);
    }
  } else if (value && value.messageText !== null) {
    errors.push(`${prefix}.messageText`);
  }
  if (fields.includes("referenceableCycleIds")
    && !uniqueBoundedStrings(value && value.referenceableCycleIds, MAX_REFERENCEABLE_CYCLES)) {
    errors.push(`${prefix}.referenceableCycleIds`);
  }
}

function failureCode(errors) {
  if (errors.some((error) => error.startsWith("propertyScope")
    || error.startsWith("referenceableCycles") && error.includes("property")
    || error.startsWith("publicSubjectCatalog") && error.includes("property"))) {
    return "PROPERTY_SCOPE_INVALID";
  }
  if (errors.includes("sourceEvents.duplicate")) return "SOURCE_EVENT_DUPLICATE";
  if (errors.some((error) => error.startsWith("recentConversation"))) {
    return "CONTEXT_WINDOW_INVALID";
  }
  return "TURN_INPUT_INVALID";
}

function validateUnderstandingTurnInput(value) {
  const errors = [];
  if (!exactKeys(value, ROOT_FIELDS)) errors.push("keys");
  if (!value || value.schemaVersion !== UNDERSTANDING_TURN_INPUT_SCHEMA_VERSION) {
    errors.push("schemaVersion");
  }
  for (const field of ["coreVersion", "traceId", "turnId", "propertyTimezone"]) {
    if (!boundedText(value && value[field])) errors.push(field);
  }
  if (!exactKeys(value && value.propertyScope, PROPERTY_SCOPE_FIELDS)) {
    errors.push("propertyScope.keys");
  }
  for (const field of PROPERTY_SCOPE_FIELDS) {
    if (!boundedText(value && value.propertyScope && value.propertyScope[field])) {
      errors.push(`propertyScope.${field}`);
    }
  }

  if (!Array.isArray(value && value.sourceEvents)
    || value.sourceEvents.length < 1
    || value.sourceEvents.length > MAX_SOURCE_EVENTS) {
    errors.push("sourceEvents");
  } else {
    const eventIds = new Set();
    const messageRefs = new Set();
    value.sourceEvents.forEach((event, index) => {
      validateEvent(event, SOURCE_EVENT_FIELDS, errors, `sourceEvents.${index}`);
      if (eventIds.has(event && event.eventId) || messageRefs.has(event && event.messageRef)) {
        errors.push("sourceEvents.duplicate");
      }
      eventIds.add(event && event.eventId);
      messageRefs.add(event && event.messageRef);
    });
  }

  if (!Array.isArray(value && value.recentConversation)
    || value.recentConversation.length > MAX_RECENT_CONVERSATION) {
    errors.push("recentConversation");
  } else {
    value.recentConversation.forEach((event, index) => {
      validateEvent(event, RECENT_CONVERSATION_FIELDS, errors, `recentConversation.${index}`);
    });
  }

  if (!Array.isArray(value && value.referenceableCycles)
    || value.referenceableCycles.length > MAX_REFERENCEABLE_CYCLES) {
    errors.push("referenceableCycles");
  } else {
    const cycleIds = new Set();
    value.referenceableCycles.forEach((cycle, index) => {
      if (!exactKeys(cycle, REFERENCEABLE_CYCLE_FIELDS)) {
        errors.push(`referenceableCycles.${index}.keys`);
      }
      if (!boundedText(cycle && cycle.requestCycleId)) {
        errors.push(`referenceableCycles.${index}.requestCycleId`);
      }
      if (!boundedText(cycle && cycle.requestKind)) {
        errors.push(`referenceableCycles.${index}.requestKind`);
      }
      if (!boundedText(cycle && cycle.capability)) {
        errors.push(`referenceableCycles.${index}.capability`);
      }
      if (!REFERENCEABLE_STATUSES.has(cycle && cycle.status)) {
        errors.push(`referenceableCycles.${index}.status`);
      }
      if (!timestamp(cycle && cycle.expiresAt)) {
        errors.push(`referenceableCycles.${index}.expiresAt`);
      }
      if (!exactKeys(cycle && cycle.subject, REFERENCEABLE_SUBJECT_FIELDS)
        || !SUBJECT_KINDS.has(cycle && cycle.subject && cycle.subject.kind)
        || !nullableBoundedText(cycle && cycle.subject && cycle.subject.catalogIdentity)) {
        errors.push(`referenceableCycles.${index}.subject`);
      }
      if (!uniqueBoundedStrings(cycle && cycle.missingFields, MAX_REFERENCEABLE_CYCLES)) {
        errors.push(`referenceableCycles.${index}.missingFields`);
      }
      if (!exactKeys(cycle && cycle.confirmedValues, CONFIRMED_VALUE_FIELDS)
        || !nullableDate(cycle && cycle.confirmedValues && cycle.confirmedValues.checkIn)
        || !nullableDate(cycle && cycle.confirmedValues && cycle.confirmedValues.checkOut)
        || !nullableDate(cycle && cycle.confirmedValues && cycle.confirmedValues.searchFrom)
        || !nullableDate(cycle && cycle.confirmedValues && cycle.confirmedValues.searchTo)
        || !(cycle && cycle.confirmedValues && cycle.confirmedValues.guestCount === null
          || Number.isInteger(cycle && cycle.confirmedValues && cycle.confirmedValues.guestCount)
            && cycle.confirmedValues.guestCount > 0)) {
        errors.push(`referenceableCycles.${index}.confirmedValues`);
      }
      if (!uniqueBoundedStrings(cycle && cycle.slotRefs, MAX_REFERENCEABLE_CYCLES)) {
        errors.push(`referenceableCycles.${index}.slotRefs`);
      }
      if (cycleIds.has(cycle && cycle.requestCycleId)) {
        errors.push("referenceableCycles.duplicate");
      }
      cycleIds.add(cycle && cycle.requestCycleId);
    });
  }

  if (!uniqueBoundedStrings(value && value.capabilityCatalog, MAX_CATALOG_ITEMS)) {
    errors.push("capabilityCatalog");
  }
  if (!Array.isArray(value && value.publicSubjectCatalog)
    || value.publicSubjectCatalog.length > MAX_CATALOG_ITEMS) {
    errors.push("publicSubjectCatalog");
  } else {
    const identities = new Set();
    value.publicSubjectCatalog.forEach((subject, index) => {
      if (!exactKeys(subject, PUBLIC_SUBJECT_FIELDS)) {
        errors.push(`publicSubjectCatalog.${index}.keys`);
      }
      if (!boundedText(subject && subject.catalogIdentity)) {
        errors.push(`publicSubjectCatalog.${index}.catalogIdentity`);
      }
      if (!SUBJECT_KINDS.has(subject && subject.kind)) {
        errors.push(`publicSubjectCatalog.${index}.kind`);
      }
      if (!boundedText(subject && subject.publicName, 240)) {
        errors.push(`publicSubjectCatalog.${index}.publicName`);
      }
      if (identities.has(subject && subject.catalogIdentity)) {
        errors.push("publicSubjectCatalog.duplicate");
      }
      identities.add(subject && subject.catalogIdentity);
    });
  }

  const uniqueErrors = [...new Set(errors)];
  return uniqueErrors.length
    ? { ok: false, code: failureCode(uniqueErrors), errors: uniqueErrors }
    : { ok: true, code: null, errors: [], value };
}

module.exports = {
  UNDERSTANDING_TURN_INPUT_SCHEMA_VERSION,
  MAX_SOURCE_EVENTS,
  MAX_RECENT_CONVERSATION,
  MAX_REFERENCEABLE_CYCLES,
  validateUnderstandingTurnInput
};
