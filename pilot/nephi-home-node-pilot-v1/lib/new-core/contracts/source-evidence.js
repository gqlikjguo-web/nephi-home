"use strict";

const MAX_EVIDENCE_REFS = 20;
const MAX_ID_LENGTH = 160;
const MAX_QUOTE_LENGTH = 500;
const EVIDENCE_FIELDS = Object.freeze([
  "eventId",
  "messageRef",
  "startOffset",
  "endOffset",
  "quote"
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

function validateSourceEvidence(value) {
  const errors = [];
  let unknownWireField = false;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_REFS) {
    errors.push("evidenceRefs");
  } else {
    value.forEach((reference, index) => {
      if (!exactKeys(reference, EVIDENCE_FIELDS)) {
        errors.push(`evidenceRefs.${index}.keys`);
        unknownWireField ||= isPlainObject(reference)
          && Object.keys(reference).some((key) => !EVIDENCE_FIELDS.includes(key));
      }
      if (!boundedText(reference && reference.eventId)) errors.push(`evidenceRefs.${index}.eventId`);
      if (!boundedText(reference && reference.messageRef)) errors.push(`evidenceRefs.${index}.messageRef`);
      if (!Number.isInteger(reference && reference.startOffset) || reference.startOffset < 0) {
        errors.push(`evidenceRefs.${index}.startOffset`);
      }
      if (!Number.isInteger(reference && reference.endOffset)
        || reference.endOffset < 0
        || (Number.isInteger(reference && reference.startOffset)
          && reference.endOffset < reference.startOffset)) {
        errors.push(`evidenceRefs.${index}.endOffset`);
      }
      if (!boundedText(reference && reference.quote, MAX_QUOTE_LENGTH)) {
        errors.push(`evidenceRefs.${index}.quote`);
      }
    });
  }
  const uniqueErrors = [...new Set(errors)];
  return uniqueErrors.length
    ? { ok: false, code: "UNDERSTANDING_SCHEMA_INVALID", errors: uniqueErrors, unknownWireField }
    : { ok: true, code: null, errors: [], unknownWireField: false, value };
}

module.exports = {
  MAX_EVIDENCE_REFS,
  EVIDENCE_FIELDS,
  validateSourceEvidence
};
