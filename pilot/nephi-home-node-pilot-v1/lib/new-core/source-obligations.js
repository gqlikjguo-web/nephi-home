"use strict";

const { isDeepStrictEqual: equal } = require("node:util");
const { validateAndNormalizeSourceEvidence } = require("./source-evidence-validator");
const { PURPOSES, CAPABILITIES, SLOT_NAMES } = require("./contracts/semantic-unit-candidate");
const { RELATION_KINDS } = require("./contracts/context-link-candidate");

const FIELDS = Object.freeze(["subject", "temporalCandidate", "temporalCandidate.checkInCandidate",
  "temporalCandidate.checkOutCandidate", "temporalCandidate.nightsCandidate", "temporalCandidate.relativeSemantics",
  "quantityCandidate", ...[...SLOT_NAMES].map(slot => `slot:${slot}`)]);
const keys = (value, names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key));
const text = value => typeof value === "string" && value.length > 0 && value.length <= 160;
const historyKey = ref => JSON.stringify([ref.eventId, ref.messageRef]);
const sameRefs = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every(ref => b.some(other => equal(ref, other)));
const owned = (ref, owners) => owners.some(owner => ref.eventId === owner.eventId && ref.messageRef === owner.messageRef
  && ref.startOffset >= owner.startOffset && ref.endOffset <= owner.endOffset);

function carriedFields(unit) {
  const fields = unit.subject?.kind !== null ? ["subject"] : [];
  if (unit.temporalCandidate) {
    fields.push("temporalCandidate");
    for (const field of ["checkInCandidate", "checkOutCandidate", "nightsCandidate", "relativeSemantics"]) {
      if (unit.temporalCandidate[field] != null) fields.push(`temporalCandidate.${field}`);
    }
  }
  if (unit.quantityCandidate) fields.push("quantityCandidate");
  for (const slot of unit.slotCandidates) fields.push(`slot:${slot.slot}`);
  return [...new Set(fields)];
}

function sourceObligationSchema(input, schema) {
  const { objectSchema: object, arraySchema: array, stringSchema: string, enumSchema: choice, evidenceSchema } = schema;
  const history = object({ eventId: string(), messageRef: string() });
  const requirement = object({ obligationId: string(), unitId: string(), purpose: choice(PURPOSES), capability: choice(CAPABILITIES),
    sourceEvidenceRefs: array(evidenceSchema(input), { minItems: 1, maxItems: 20 }),
    requiredFields: { ...array(choice(FIELDS), { maxItems: FIELDS.length }), description: "Fields carrying source-provided values or explicit SET/CLEAR operations. Not execution prerequisites: absent, unknown or undecided values do not create field obligations. Preserve every explicit source condition; never invent a value to satisfy the ledger." }, relationKind: choice(RELATION_KINDS),
    referencedHistoryEventRefs: array(history, { maxItems: 20 }), referencedCurrentUnitId: { type: ["string", "null"], maxLength: 160 } });
  return object({ coverage: array(object({ source: evidenceSchema(input), disposition: choice(["required", "background"]),
    obligationIds: array(string(), { maxItems: 100 }) }), { maxItems: 400 }),
  requirements: array(requirement, { maxItems: 100 }) },
  "Source-bound obligation correspondence only, not facts or execution. Account for every current-source character; Use exactly one requirement per semantic unit, aggregating all of that unit's explicit conditions and its relation; never create a second requirement for another field on the same unit. Enumerate every requested unit independently before projecting it into units. Background is your attribution and must not conceal a request.");
}

function ledgerShape(ledger) {
  if (!keys(ledger, ["coverage", "requirements"]) || !Array.isArray(ledger.coverage) || ledger.coverage.length > 400
    || !Array.isArray(ledger.requirements) || ledger.requirements.length > 100) return false;
  return ledger.coverage.every(row => keys(row, ["source", "disposition", "obligationIds"])
    && ["required", "background"].includes(row.disposition) && Array.isArray(row.obligationIds)
    && row.obligationIds.length <= 100 && row.obligationIds.every(text)
    && new Set(row.obligationIds).size === row.obligationIds.length
    && (row.disposition === "required" ? row.obligationIds.length > 0 : row.obligationIds.length === 0))
    && ledger.requirements.every(req => keys(req, ["obligationId", "unitId", "purpose", "capability", "sourceEvidenceRefs",
      "requiredFields", "relationKind", "referencedHistoryEventRefs", "referencedCurrentUnitId"])
      && text(req.obligationId) && text(req.unitId) && PURPOSES.has(req.purpose) && CAPABILITIES.has(req.capability)
      && Array.isArray(req.sourceEvidenceRefs) && req.sourceEvidenceRefs.length > 0 && req.sourceEvidenceRefs.length <= 20
      && Array.isArray(req.requiredFields) && req.requiredFields.every(field => FIELDS.includes(field))
      && new Set(req.requiredFields).size === req.requiredFields.length && RELATION_KINDS.has(req.relationKind)
      && Array.isArray(req.referencedHistoryEventRefs) && req.referencedHistoryEventRefs.length <= 20
      && req.referencedHistoryEventRefs.every(ref => keys(ref, ["eventId", "messageRef"]) && text(ref.eventId) && text(ref.messageRef))
      && (req.referencedCurrentUnitId === null || text(req.referencedCurrentUnitId)));
}

function violation(path, actual, unitId = null, repairFields = []) {
  const detail = { validationErrorCode: "UNDERSTANDING_SCHEMA_INVALID", fieldPath: `sourceObligations.${path}`,
    expected: "complete source-bound unit/condition/relation correspondence", actual: `admission_obligation:${actual}` };
  return { code: "UNDERSTANDING_SCHEMA_INVALID", violation: detail,
    ...(unitId ? { unitViolations: [{ unitId, violation: detail, repairFields }] } : {}) };
}

function validateCoverage(ledger, input) {
  const spans = [];
  for (const [i, row] of ledger.coverage.entries()) {
    const checked = validateAndNormalizeSourceEvidence([row.source], input.sourceEvents);
    if (!checked.ok) return violation(`coverage.${i}.source`, checked.code);
    if (row.obligationIds.some(id => !ledger.requirements.some(req => req.obligationId === id))) {
      return violation(`coverage.${i}.obligationIds`, "unknown_obligation");
    }
    spans.push({ ...row, source: checked.value[0] });
  }
  for (const source of input.sourceEvents) {
    let end = 0;
    const ranges = spans.filter(row => row.source.eventId === source.eventId && row.source.messageRef === source.messageRef)
      .map(row => row.source).sort((a, b) => a.startOffset - b.startOffset);
    for (const range of ranges) {
      if (range.startOffset > end) return violation("coverage", "source_gap");
      end = Math.max(end, range.endOffset);
    }
    if (end !== source.messageText.length) return violation("coverage", "source_gap");
  }
  return { spans };
}

function validateRequirement(req, output, input, coverage, index) {
  const prefix = `requirements.${index}`;
  const unit = output.understandingOutput.units.find(unit => unit.unitId === req.unitId);
  const evidence = validateAndNormalizeSourceEvidence(req.sourceEvidenceRefs, input.sourceEvents);
  if (!evidence.ok) return violation(`${prefix}.sourceEvidenceRefs`, evidence.code, req.unitId);
  if (!evidence.value.every(ref => coverage.some(row => row.obligationIds.includes(req.obligationId) && owned(ref, [row.source])))) {
    return violation(prefix, "uncovered_obligation", req.unitId);
  }
  if (!unit) return violation(`${prefix}.unitId`, "unit_missing", req.unitId);
  const owners = validateAndNormalizeSourceEvidence(unit.evidenceRefs, input.sourceEvents);
  // Existing C04 owns rejected unit refs. Do not turn its evidence-only repair
  // into permission to change meaning or to guess a replacement source ID.
  if (!owners.ok) return null;
  if (!evidence.value.every(ref => owned(ref, owners.value))) {
    const failure = violation(prefix, "unit_source_mismatch", req.unitId, ["evidenceRefs"]);
    failure.violation.expected = "Every obligation sourceEvidenceRef must be fully contained in one corresponding unit.evidenceRefs span with the same eventId/messageRef. Re-read the unchanged source and repair that unit evidence boundary, keeping exact offsets/quotes, all valid meaning and the original obligation. Small slot evidence spans do not by themselves cover a larger obligation span.";
    return failure;
  }
  for (const field of ["purpose", "capability"]) {
    if (unit[field] !== req[field]) return violation(`${prefix}.${field}`, "unit_meaning_mismatch", req.unitId, [field]);
  }
  const carried = carriedFields(unit);
  const missing = req.requiredFields.filter(field => !carried.includes(field));
  const unaccounted = carried.filter(field => !req.requiredFields.includes(field));
  if (missing.length) {
    const failure = violation(`${prefix}.requiredFields`, "field_missing", req.unitId, missing);
    failure.violation.expected = `Source-provided conditions must correspond to carried fields. Declared but not carried: ${missing.join(", ")}. Re-read unchanged source: supply genuinely omitted values, or correct only unsupported field declarations. Do not invent undecided values or erase explicit conditions; missing execution inputs belong to lifecycle clarification. Also account for emitted but undeclared fields: ${unaccounted.join(", ") || "none"}.`;
    return failure;
  }
  if (unaccounted.length) {
    const failure = violation(`${prefix}.requiredFields`, "field_unaccounted", req.unitId);
    failure.violation.expected = `Account for emitted fields omitted from requiredFields: ${unaccounted.join(", ")}. Preserve the already validated unit values; add only their corresponding declarations. Do not add absent temporal values or execution prerequisites.`;
    return failure;
  }
  const link = output.contextLinkCandidates.find(link => link.unitId === unit.unitId && link.contextLinkCandidateId === unit.contextLinkCandidateId);
  if (!link || link.relationKind !== req.relationKind
    || (link.referencedCurrentUnitId ?? null) !== req.referencedCurrentUnitId
    || !sameRefs(link.referencedHistoryEventRefs, req.referencedHistoryEventRefs)) {
    return violation(`${prefix}.relationKind`, "relation_mismatch", req.unitId);
  }
  return null;
}

function combineFailures(failures) {
  if (!failures.length) return null;
  const byUnit = new Map();
  for (const failure of failures) for (const local of failure.unitViolations || []) {
    if (!byUnit.has(local.unitId)) byUnit.set(local.unitId,{...local,repairFields:[],additionalViolations:[]});
    const combined=byUnit.get(local.unitId);
    combined.repairFields.push(...(local.repairFields||[]));
    if (combined.violation !== local.violation) combined.additionalViolations.push(local.violation);
  }
  return {...failures[0],...(byUnit.size?{unitViolations:[...byUnit.values()]}:{})};
}

function sourceObligationFailure(output, input) {
  const ledger = output.sourceObligations;
  if (!ledgerShape(ledger)) return violation("$", "shape_invalid");
  const failures=[];
  for (const req of ledger.requirements) {
    if (ledger.requirements.filter(other=>other.obligationId===req.obligationId||other.unitId===req.unitId).length<2) continue;
    const failure=violation("requirements","duplicate_obligation",req.unitId);
    failure.violation.expected="Exactly one requirement per unit and unique obligation IDs. Consolidate only identical unit/source/relation declarations; preserve all valid conditions and fix every accompanying field-correspondence failure in the same correction. Distinct meanings must not be deleted.";
    failures.push(failure);
  }
  const coverage = validateCoverage(ledger, input);
  if (coverage.code) return combineFailures([...failures,coverage]);
  for (const [index, req] of ledger.requirements.entries()) {
    const failed = validateRequirement(req, output, input, coverage.spans, index);
    if (failed) failures.push(failed);
  }
  for (const unit of output.understandingOutput.units) {
    if (!ledger.requirements.some(req => req.unitId === unit.unitId)) failures.push(violation("requirements", "unit_unaccounted", unit.unitId));
  }
  return combineFailures(failures);
}

// Correspondence repair is limited to formally rejected field declarations.
// It never supplies a value or interprets source language.
function repairableFields(previous, input, req, coverage) {
  if (coverage.code) return [];
  const index=previous.sourceObligations.requirements.indexOf(req);
  const failure=validateRequirement(req,previous,input,coverage.spans,index);
  if (!["admission_obligation:field_missing","admission_obligation:field_unaccounted"].includes(failure?.violation.actual)) return [];
  const unit=previous.understandingOutput.units.find(item=>item.unitId===req.unitId);
  const carried=carriedFields(unit);
  return [...req.requiredFields.filter(field=>!carried.includes(field)),...carried.filter(field=>!req.requiredFields.includes(field))];
}

function obligationGroupPreserved(group, candidate, previous, input, coverage) {
  if (!candidate || !group.some(req=>req.obligationId===candidate.obligationId)) return false;
  const identity=({obligationId,requiredFields,...rest})=>rest;
  if (!group.every(req=>equal(identity(req),identity(candidate)))) return false;
  const allowed=new Set(group.flatMap(req=>repairableFields(previous,input,req,coverage)));
  // A duplicate with an empty field list cannot make another declaration's
  // already valid condition mutable. Preserve the union of proven conditions.
  const unit=previous.understandingOutput.units.find(item=>item.unitId===group[0].unitId);
  const carried=unit?carriedFields(unit):[];
  for (const req of group) for (const field of req.requiredFields) if (carried.includes(field)) allowed.delete(field);
  const stable=fields=>[...new Set(fields.filter(field=>!allowed.has(field)))].sort();
  return equal(stable(group.flatMap(req=>req.requiredFields)),stable(candidate.requiredFields));
}

// Duplicate structural declarations may be coalesced only when they identify
// exactly the same unit/source/relation. Independent obligations stay immutable.
function obligationsPreserved(previous, next, input) {
  if (!ledgerShape(previous?.sourceObligations)) return true;
  if (!ledgerShape(next?.sourceObligations)) return false;
  const coverage=validateCoverage(previous.sourceObligations,input),groups=new Map();
  for (const req of previous.sourceObligations.requirements) {
    if (!validateAndNormalizeSourceEvidence(req.sourceEvidenceRefs,input.sourceEvents).ok) continue;
    if (!groups.has(req.unitId)) groups.set(req.unitId,[]);
    groups.get(req.unitId).push(req);
  }
  return [...groups.entries()].every(([unitId,group])=>{
    const candidates=next.sourceObligations.requirements.filter(req=>req.unitId===unitId);
    return candidates.length===1 && obligationGroupPreserved(group,candidates[0],previous,input,coverage);
  });
}

module.exports = { FIELDS, carriedFields, ledgerShape, sourceObligationSchema, sourceObligationFailure, obligationsPreserved };
