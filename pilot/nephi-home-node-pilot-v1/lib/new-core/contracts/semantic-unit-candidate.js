"use strict";

const { MAX_EVIDENCE_REFS, validateSourceEvidence } = require("./source-evidence");

const MAX_ID_LENGTH = 160;
const MAX_SLOT_CANDIDATES = 20;
const UNIT_FIELDS = Object.freeze([
  "unitId",
  "evidenceRefs",
  "purpose",
  "capability",
  "subject",
  "stayDependent",
  "temporalCandidate",
  "contextLinkCandidateId",
  "replyCandidate",
  "slotCandidates",
  "confidenceBand"
]);
const SUBJECT_FIELDS = Object.freeze(["kind", "catalogIdentity"]);
const REPLY_CANDIDATE_FIELDS = Object.freeze(["disposition", "reasonClass"]);
const TEMPORAL_CANDIDATE_FIELDS = Object.freeze([
  "rawText",
  "kind",
  "checkInCandidate",
  "checkOutCandidate",
  "nightsCandidate"
]);
const SLOT_CANDIDATE_FIELDS = Object.freeze([
  "slotCandidateId",
  "slot",
  "operation",
  "value",
  "evidenceRefs"
]);
const PURPOSES = new Set([
  "lodging_question",
  "operator_request",
  "sensitive_request",
  "acknowledgement",
  "correction",
  "supplement",
  "cancellation",
  "context_update",
  "social",
  "off_topic",
  "unknown"
]);
const CAPABILITIES = new Set([
  "availability",
  "available_dates",
  "price",
  "total_price",
  "capacity",
  "property_fact",
  "amenity",
  "policy",
  "location",
  "booking_operator_request",
  "high_risk",
  "unsupported",
  null
]);
const SUBJECT_KINDS = new Set([
  "property",
  "room",
  "bundle",
  "matched_room_set",
  "amenity",
  "policy",
  "external_place",
  "other_verified",
  null
]);
const REPLY_DISPOSITIONS = new Set(["ANSWER", "CLARIFY", "HANDOFF", "NO_REPLY"]);
const CONFIDENCE_BANDS = new Set(["low", "medium", "high"]);
const TEMPORAL_KINDS = new Set([
  "absolute_date",
  "date_range",
  "relative_date",
  "relative_range",
  "weekday",
  "month_weekday",
  "nights_only",
  "partial",
  "unknown"
]);
const SLOT_NAMES = new Set(["guest_count", "product", "transport", "other_supported"]);
const SLOT_OPERATIONS = new Set(["SET", "CLEAR"]);

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

function nullableBoundedText(value, limit = MAX_ID_LENGTH) {
  return value === null || boundedText(value, limit);
}

function hasUnknownFields(value, fields) {
  return isPlainObject(value) && Object.keys(value).some((key) => !fields.includes(key));
}

function fullIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return timestamp;
}

function validateTemporalCandidate(value, errors) {
  if (value === null) return false;
  let unknownWireField = false;
  if (!exactKeys(value, TEMPORAL_CANDIDATE_FIELDS)) {
    errors.push("temporalCandidate.keys");
    unknownWireField ||= hasUnknownFields(value, TEMPORAL_CANDIDATE_FIELDS);
  }
  if (!boundedText(value && value.rawText, 500)) errors.push("temporalCandidate.rawText");
  if (!TEMPORAL_KINDS.has(value && value.kind)) errors.push("temporalCandidate.kind");
  if (!nullableBoundedText(value && value.checkInCandidate, 80)) errors.push("temporalCandidate.checkInCandidate");
  if (!nullableBoundedText(value && value.checkOutCandidate, 80)) errors.push("temporalCandidate.checkOutCandidate");
  if (value && value.nightsCandidate !== null
    && (!Number.isInteger(value.nightsCandidate) || value.nightsCandidate < 1)) {
    errors.push("temporalCandidate.nightsCandidate");
  }
  const checkIn = fullIsoDate(value && value.checkInCandidate);
  const checkOut = fullIsoDate(value && value.checkOutCandidate);
  if (checkIn !== null && checkOut !== null && value && value.nightsCandidate !== null
    && (checkOut <= checkIn || (checkOut - checkIn) / 86400000 !== value.nightsCandidate)) {
    errors.push("temporalCandidate.contradiction");
  }
  return unknownWireField;
}

function validateSlotCandidate(value, errors, index) {
  let unknownWireField = false;
  const prefix = `slotCandidates.${index}`;
  if (!exactKeys(value, SLOT_CANDIDATE_FIELDS)) {
    errors.push(`${prefix}.keys`);
    unknownWireField ||= hasUnknownFields(value, SLOT_CANDIDATE_FIELDS);
  }
  if (!boundedText(value && value.slotCandidateId)) errors.push(`${prefix}.slotCandidateId`);
  if (!SLOT_NAMES.has(value && value.slot)) errors.push(`${prefix}.slot`);
  if (!SLOT_OPERATIONS.has(value && value.operation)) errors.push(`${prefix}.operation`);
  const primitiveValue = value && (typeof value.value === "string"
    || typeof value.value === "boolean"
    || Number.isInteger(value.value)
    || value.value === null);
  if (!primitiveValue) errors.push(`${prefix}.value`);
  if (value && value.operation === "CLEAR" && value.value !== null) errors.push(`${prefix}.clearValue`);
  if (value && value.slot === "guest_count" && value.operation === "SET"
    && (!Number.isInteger(value.value) || value.value < 1)) {
    errors.push(`${prefix}.guestCount`);
  }
  const evidence = validateSourceEvidence(value && value.evidenceRefs);
  if (!evidence.ok) errors.push(...evidence.errors.map((error) => `${prefix}.${error}`));
  return unknownWireField || evidence.unknownWireField;
}

function validateSemanticUnitCandidate(value) {
  const errors = [];
  let unknownWireField = false;
  if (!exactKeys(value, UNIT_FIELDS)) {
    errors.push("keys");
    unknownWireField ||= hasUnknownFields(value, UNIT_FIELDS);
  }
  if (!boundedText(value && value.unitId)) errors.push("unitId");
  const evidence = validateSourceEvidence(value && value.evidenceRefs);
  if (!evidence.ok) errors.push(...evidence.errors.map((error) => `evidenceRefs.${error}`));
  unknownWireField ||= evidence.unknownWireField;
  if (!PURPOSES.has(value && value.purpose)) errors.push("purpose");
  if (!CAPABILITIES.has(value && value.capability)) errors.push("capability");
  if (!exactKeys(value && value.subject, SUBJECT_FIELDS)) {
    errors.push("subject.keys");
    unknownWireField ||= hasUnknownFields(value && value.subject, SUBJECT_FIELDS);
  }
  if (!SUBJECT_KINDS.has(value && value.subject && value.subject.kind)) errors.push("subject.kind");
  if (value && value.subject && value.subject.catalogIdentity !== null
    && !boundedText(value.subject.catalogIdentity)) {
    errors.push("subject.catalogIdentity");
  }
  if (typeof (value && value.stayDependent) !== "boolean") errors.push("stayDependent");
  unknownWireField ||= validateTemporalCandidate(value && value.temporalCandidate, errors);
  if (!boundedText(value && value.contextLinkCandidateId)) errors.push("contextLinkCandidateId");
  if (!exactKeys(value && value.replyCandidate, REPLY_CANDIDATE_FIELDS)) {
    errors.push("replyCandidate.keys");
    unknownWireField ||= hasUnknownFields(value && value.replyCandidate, REPLY_CANDIDATE_FIELDS);
  }
  if (!REPLY_DISPOSITIONS.has(value && value.replyCandidate && value.replyCandidate.disposition)) {
    errors.push("replyCandidate.disposition");
  }
  if (!boundedText(value && value.replyCandidate && value.replyCandidate.reasonClass)) {
    errors.push("replyCandidate.reasonClass");
  }
  if (!Array.isArray(value && value.slotCandidates) || value.slotCandidates.length > MAX_SLOT_CANDIDATES) {
    errors.push("slotCandidates");
  } else {
    value.slotCandidates.forEach((candidate, index) => {
      unknownWireField ||= validateSlotCandidate(candidate, errors, index);
    });
  }
  if (!CONFIDENCE_BANDS.has(value && value.confidenceBand)) errors.push("confidenceBand");
  const uniqueErrors = [...new Set(errors)];
  return uniqueErrors.length
    ? { ok: false, code: "SEMANTIC_UNIT_INVALID", errors: uniqueErrors, unknownWireField }
    : { ok: true, code: null, errors: [], unknownWireField: false, value };
}

module.exports = {
  MAX_EVIDENCE_REFS,
  MAX_SLOT_CANDIDATES,
  UNIT_FIELDS,
  TEMPORAL_CANDIDATE_FIELDS,
  SLOT_CANDIDATE_FIELDS,
  PURPOSES,
  CAPABILITIES,
  SUBJECT_KINDS,
  REPLY_DISPOSITIONS,
  CONFIDENCE_BANDS,
  TEMPORAL_KINDS,
  SLOT_NAMES,
  SLOT_OPERATIONS,
  validateSemanticUnitCandidate
};
