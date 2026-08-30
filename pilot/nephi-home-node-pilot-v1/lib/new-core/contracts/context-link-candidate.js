"use strict";

const { MAX_EVIDENCE_REFS, validateSourceEvidence } = require("./source-evidence");

const MAX_CONTEXT_LINKS = 100;
const MAX_ID_LENGTH = 160;
const CONTEXT_LINK_FIELDS = Object.freeze([
  "contextLinkCandidateId",
  "unitId",
  "relationKind",
  "targetRequestCycleIdCandidate",
  "evidenceRefs"
]);
const RELATION_KINDS = new Set(["NEW_REQUEST", "SUPPLEMENT", "MODIFICATION", "TERMINATION", "NONE"]);

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

function validateContextLinkCandidate(value) {
  const errors = [];
  let unknownWireField = false;
  if (!exactKeys(value, CONTEXT_LINK_FIELDS)) {
    errors.push("keys");
    unknownWireField ||= isPlainObject(value)
      && Object.keys(value).some((key) => !CONTEXT_LINK_FIELDS.includes(key));
  }
  if (!boundedText(value && value.contextLinkCandidateId)) errors.push("contextLinkCandidateId");
  if (!boundedText(value && value.unitId)) errors.push("unitId");
  if (!RELATION_KINDS.has(value && value.relationKind)) errors.push("relationKind");
  if (value && value.targetRequestCycleIdCandidate !== null
    && !boundedText(value.targetRequestCycleIdCandidate)) {
    errors.push("targetRequestCycleIdCandidate");
  }
  const evidence = validateSourceEvidence(value && value.evidenceRefs);
  if (!evidence.ok) errors.push(...evidence.errors.map((error) => `evidenceRefs.${error}`));
  unknownWireField ||= evidence.unknownWireField;
  const uniqueErrors = [...new Set(errors)];
  return uniqueErrors.length
    ? { ok: false, code: "UNDERSTANDING_SCHEMA_INVALID", errors: uniqueErrors, unknownWireField }
    : { ok: true, code: null, errors: [], unknownWireField: false, value };
}

function validateContextLinkCandidates(value) {
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_LINKS) {
    return { ok: false, code: "UNDERSTANDING_CARDINALITY_INVALID", errors: ["contextLinks"] };
  }
  const errors = [];
  const identifiers = new Set();
  let unknownWireField = false;
  value.forEach((candidate, index) => {
    const result = validateContextLinkCandidate(candidate);
    if (!result.ok) errors.push(...result.errors.map((error) => `contextLinks.${index}.${error}`));
    unknownWireField ||= result.unknownWireField;
    if (identifiers.has(candidate && candidate.contextLinkCandidateId)) errors.push("contextLinks.duplicate");
    identifiers.add(candidate && candidate.contextLinkCandidateId);
  });
  const uniqueErrors = [...new Set(errors)];
  let code = null;
  if (uniqueErrors.length) {
    if (unknownWireField) code = "UNKNOWN_WIRE_FIELD";
    else if (uniqueErrors.includes("contextLinks.duplicate")) code = "CONTEXT_LINK_DUPLICATE";
    else code = "UNDERSTANDING_SCHEMA_INVALID";
  }
  return uniqueErrors.length
    ? { ok: false, code, errors: uniqueErrors }
    : { ok: true, code: null, errors: [], value };
}

module.exports = {
  MAX_EVIDENCE_REFS,
  MAX_CONTEXT_LINKS,
  CONTEXT_LINK_FIELDS,
  RELATION_KINDS,
  validateContextLinkCandidate,
  validateContextLinkCandidates
};
