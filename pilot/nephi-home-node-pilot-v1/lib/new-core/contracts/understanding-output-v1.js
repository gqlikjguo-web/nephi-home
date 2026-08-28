"use strict";

const { validateSemanticUnitCandidate } = require("./semantic-unit-candidate");

const UNDERSTANDING_OUTPUT_SCHEMA_VERSION = 1;
const MAX_UNITS = 100;
const MAX_ID_LENGTH = 160;
const ROOT_FIELDS = Object.freeze(["schemaVersion", "turnId", "units"]);

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

function validateUnderstandingOutputV1(value) {
  const errors = [];
  let unknownWireField = false;
  if (!exactKeys(value, ROOT_FIELDS)) {
    errors.push("keys");
    unknownWireField ||= isPlainObject(value)
      && Object.keys(value).some((key) => !ROOT_FIELDS.includes(key));
  }
  if (!value || value.schemaVersion !== UNDERSTANDING_OUTPUT_SCHEMA_VERSION) errors.push("schemaVersion");
  if (!boundedText(value && value.turnId)) errors.push("turnId");
  if (!Array.isArray(value && value.units)) {
    errors.push("units");
  } else if (value.units.length > MAX_UNITS) {
    errors.push("units.cardinality");
  } else {
    const unitIds = new Set();
    const slotCandidateIds = new Set();
    const contextLinkCandidateIds = new Set();
    value.units.forEach((unit, index) => {
      const result = validateSemanticUnitCandidate(unit);
      if (!result.ok) errors.push(...result.errors.map((error) => `units.${index}.${error}`));
      unknownWireField ||= result.unknownWireField;
      if (unitIds.has(unit && unit.unitId)) errors.push("units.duplicate");
      unitIds.add(unit && unit.unitId);
      if (contextLinkCandidateIds.has(unit && unit.contextLinkCandidateId)) {
        errors.push("units.contextLinkCandidateId.duplicate");
      }
      contextLinkCandidateIds.add(unit && unit.contextLinkCandidateId);
      (Array.isArray(unit && unit.slotCandidates) ? unit.slotCandidates : []).forEach((slot) => {
        if (slotCandidateIds.has(slot && slot.slotCandidateId)) errors.push("units.slotCandidateId.duplicate");
        slotCandidateIds.add(slot && slot.slotCandidateId);
      });
    });
  }
  const uniqueErrors = [...new Set(errors)];
  let code = null;
  if (uniqueErrors.length) {
    if (unknownWireField) code = "UNKNOWN_WIRE_FIELD";
    else if (uniqueErrors.includes("units.duplicate")) code = "UNIT_ID_DUPLICATE";
    else if (uniqueErrors.includes("units.cardinality")) code = "UNDERSTANDING_CARDINALITY_INVALID";
    else code = "UNDERSTANDING_SCHEMA_INVALID";
  }
  return uniqueErrors.length
    ? { ok: false, code, errors: uniqueErrors }
    : { ok: true, code: null, errors: [], value };
}

module.exports = {
  UNDERSTANDING_OUTPUT_SCHEMA_VERSION,
  MAX_UNITS,
  ROOT_FIELDS,
  validateUnderstandingOutputV1
};
