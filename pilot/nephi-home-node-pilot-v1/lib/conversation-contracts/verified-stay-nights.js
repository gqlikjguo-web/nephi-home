"use strict";
// Storage/projection only. Temporal remains the sole duration calculator.
const { validateSourceEvidence } = require("../new-core/contracts/source-evidence");
const NIGHTS_FIELDS = Object.freeze(["nights", "nightsEvidence"]);
const EVIDENCE_FIELDS = ["value", "valueStatus", "provenance", "sourceEvidenceRefs", "ruleRef", "derivedFromFieldRefs"];
function validateVerifiedNights(value = {}) {
  if (!NIGHTS_FIELDS.some(key => Object.hasOwn(value, key))) return true;
  const e = value.nightsEvidence;
  return Number.isInteger(value.nights) && value.nights > 0
    && e && Object.keys(e).length === EVIDENCE_FIELDS.length
    && EVIDENCE_FIELDS.every(key => Object.hasOwn(e, key))
    && e.value === value.nights && e.valueStatus === "confirmed"
    && ["explicit", "context", "derived"].includes(e.provenance)
    && validateSourceEvidence(e.sourceEvidenceRefs).ok && e.sourceEvidenceRefs.length > 0
    && (e.ruleRef === null || typeof e.ruleRef === "string" && e.ruleRef.length > 0)
    && Array.isArray(e.derivedFromFieldRefs) && e.derivedFromFieldRefs.every(ref => typeof ref === "string" && ref.length > 0);
}
function projectVerifiedNights(value = {}) {
  return Object.hasOwn(value, "nightsEvidence")
    ? { nights: value.nights, nightsEvidence: structuredClone(value.nightsEvidence) } : {};
}
function nightsFromTemporalField(field) {
  const value = { nights: field?.value, nightsEvidence: field };
  return validateVerifiedNights(value) ? projectVerifiedNights(value) : {};
}
module.exports = { NIGHTS_FIELDS, validateVerifiedNights, projectVerifiedNights, nightsFromTemporalField };
