"use strict";
const { isDeepStrictEqual } = require("node:util");
const { validateAndNormalizeSourceEvidence } = require("../new-core/source-evidence-validator");
const LODGING_CAPABILITIES = new Set(["availability", "bundle_availability", "available_dates", "price", "total_price", "capacity"]);

// Project C01's existing bindings, without choosing a target or granting a
// relation. Ordinary history remains visible; C05 still owns target admission.
function targetHistoryBindings(input, now = Math.max(...input.sourceEvents.map(event => Date.parse(event.timestamp)))) {
  const cycles = new Map(input.referenceableCycles.filter(cycle =>
    ["active", "pending", "answered"].includes(cycle.status) && Date.parse(cycle.expiresAt) > now
  ).map(cycle => [cycle.requestCycleId, cycle]));
  return input.recentConversation.map(event => ({ event,
    cycles: event.referenceableCycleIds.map(id => cycles.get(id)).filter(Boolean) }));
}

function targetReferenceRepairFor(failure, output, input, detail, now) {
  if (failure.boundary !== "C05" || failure.failureCode !== "CONTEXT_TARGET_UNAVAILABLE"
    || !detail?.validationErrors?.includes("referencedHistoryEventRefs.target")) return null;
  const links = output.contextLinkCandidates.filter(link => link.unitId === failure.unitId);
  if (links.length !== 1 || !links[0].referencedHistoryEventRefs.length) return null;
  const link = links[0];
  const unbound = link.referencedHistoryEventRefs.every(ref => input.recentConversation.some(event =>
    event.eventId === ref.eventId && event.messageRef === ref.messageRef && event.referenceableCycleIds.length === 0));
  const allowedHistoryEventRefs = targetHistoryBindings(input, now).filter(item => item.cycles.length)
    .map(({ event: { eventId, messageRef } }) => ({ eventId, messageRef }));
  if (!unbound || !allowedHistoryEventRefs.length) return null;
  return { contextLinkCandidateId: link.contextLinkCandidateId, relationKind: link.relationKind,
    rejectedHistoryEventRefs: link.referencedHistoryEventRefs, allowedHistoryEventRefs,
    rule: "Only repair these unbound history references and their matching sourceObligations references. Ordinary history with no referenceableRequestSummaries cannot target a cycle. Use the unchanged source meaning and listed bound history; never select by recency or invent an internal cycle ID. Preserve the relation, current source evidence, unit meanings and all other source obligations. Admission must still prove one compatible target; if no unique reference is supported, do not guess." };
}

function targetReferenceRepairPreserved(previous, next, failure) {
  const repair = failure.targetReferenceRepair;
  if (!repair) return true;
  const before = previous.contextLinkCandidates.find(link => link.contextLinkCandidateId === repair.contextLinkCandidateId);
  const after = next.contextLinkCandidates.find(link => link.contextLinkCandidateId === repair.contextLinkCandidateId);
  if (!before || !after || !after.referencedHistoryEventRefs.length
    || !after.referencedHistoryEventRefs.every(ref => repair.allowedHistoryEventRefs.some(allowed => isDeepStrictEqual(ref, allowed)))) return false;
  const refs = after.referencedHistoryEventRefs;
  if (!isDeepStrictEqual({ ...before, referencedHistoryEventRefs: refs }, after)) return false;
  const expected = { ...previous.sourceObligations, requirements: previous.sourceObligations.requirements.map(requirement =>
    requirement.unitId === failure.unitId ? { ...requirement, referencedHistoryEventRefs: refs } : requirement) };
  return isDeepStrictEqual(expected, next.sourceObligations);
}

// The rejected binding is not permission to erase a source-grounded operation.
// This receipt constrains model repair; it never builds a unit or selects a target.
function incompatibleRelationFailure(unit, link, cycles, input, index, now) {
  const violation = { validationErrorCode:"UNDERSTANDING_SCHEMA_INVALID",
    fieldPath:`contextLinkCandidates.${index}.referencedHistoryEventRefs`,
    expected:"target bound to capability/subject-compatible referenceable cycle",
    actual:"relation_target:identity_incompatible" };
  const cycle = cycles.length === 1 ? cycles[0] : null;
  const knownRefs = cycle && link.referencedHistoryEventRefs.every(ref => input.recentConversation.some(event =>
    event.eventId === ref.eventId && event.messageRef === ref.messageRef
      && event.referenceableCycleIds.includes(cycle.requestCycleId)));
  const grounded = validateAndNormalizeSourceEvidence(unit.evidenceRefs,input.sourceEvents).ok
    && validateAndNormalizeSourceEvidence(link.currentSourceEvidenceRefs,input.sourceEvents).ok;
  const repair = link.relationKind === "MODIFICATION" && grounded && knownRefs
    && ["active","pending","answered"].includes(cycle.status) && Date.parse(cycle.expiresAt) > now
    && LODGING_CAPABILITIES.has(unit.capability) && LODGING_CAPABILITIES.has(cycle.capability)
    && unit.capability !== cycle.capability;
  const relationRepair = repair ? { relationKind:link.relationKind,
    referencedHistoryEventRefs:link.referencedHistoryEventRefs, targetCapability:cycle.capability,
    rule:"Preserve the evidenced modification, history refs and all preserved unit fields. Keep this query unit's identity and capability; make it RELATED_UNIT to a source-grounded same-turn prerequisite with targetCapability and the original MODIFICATION/history. The prerequisite may carry only the original unit's validated conditions/product/evidence. Do not replace the operation with NEW_REQUEST or fabricate independence." } : null;
  if (repair) violation.expected += "; preserve the modification via the required same-turn source unit described by relationRepair";
  return {code:"UNDERSTANDING_SCHEMA_INVALID",violation,
    unitViolations:[{unitId:unit.unitId,violation,...(relationRepair?{relationRepair}:{})}]};
}

function dependencyRepairPreserved(previous, next, failure) {
  if (!failure.relationRepair) return true;
  const original = previous.understandingOutput.units.find(unit=>unit.unitId===failure.unitId);
  const link = next.contextLinkCandidates.find(item=>item.unitId===failure.unitId);
  if (!original || link?.relationKind !== "RELATED_UNIT") return false;
  const source = next.understandingOutput.units.find(unit=>unit.unitId===link.referencedCurrentUnitId);
  const sourceLink = next.contextLinkCandidates.find(item=>item.unitId===source?.unitId);
  const obligation = failure.relationRepair;
  if (!source || source.unitId === original.unitId || source.capability !== obligation.targetCapability
    || sourceLink?.relationKind !== obligation.relationKind
    || !isDeepStrictEqual(sourceLink.referencedHistoryEventRefs,obligation.referencedHistoryEventRefs)) return false;
  // Newly introduced nodes need fresh wire identities, never fresh semantics.
  const meaning = ({unitId,contextLinkCandidateId,capability,slotCandidates,...rest})=>({
    ...rest,slotCandidates:slotCandidates.map(({slotCandidateId,...slot})=>slot)
  });
  return isDeepStrictEqual(meaning(source),meaning(original));
}


// Correction may add a same-turn prerequisite only for a formally rejected
// relation. Admission still validates the source, dependency and target; this
// check never supplies a unit, chooses a cycle, or alters model output.
function correctionUnitSetPreserved(previous, next, failures) {
  if (!previous?.understandingOutput || !next?.understandingOutput) return false;
  const before = previous.understandingOutput.units;
  const after = next.understandingOutput.units;
  if (!Array.isArray(before) || !Array.isArray(after) || !Array.isArray(next.contextLinkCandidates)
    || before.some(unit => !unit || typeof unit.unitId !== "string")
    || after.some(unit => !unit || typeof unit.unitId !== "string")) return false;
  const oldIds = new Set(before.map(unit => unit.unitId));
  if (!before.every(unit => after.some(candidate => candidate.unitId === unit.unitId))) return false;
  const permitted = new Set(oldIds);
  if (!failures.every(failure=>dependencyRepairPreserved(previous,next,failure))) return false;
  for (const failure of failures) {
    if (failure.reason?.actual === "admission_obligation:unit_missing"
      && previous.sourceObligations?.requirements.some(req => req.unitId === failure.unitId)) {
      permitted.add(failure.unitId);
    }
    if (failure.unitValidationFailed === false
      || typeof failure.reason?.actual !== "string"
      || (!failure.reason.actual.startsWith("relation_completeness:") && !failure.relationRepair)) continue;
    const origin = before.find(unit => unit.unitId === failure.unitId);
    let unitId = origin?.unitId;
    const visited = new Set();
    while (unitId && !visited.has(unitId)) {
      visited.add(unitId);
      const links = next.contextLinkCandidates.filter(link => link.unitId === unitId);
      if (links.length !== 1 || links[0].relationKind !== "RELATED_UNIT") break;
      const source = after.find(unit => unit.unitId === links[0].referencedCurrentUnitId);
      if (!source || !source.evidenceRefs.every(ref => origin.evidenceRefs.some(owner =>
        ref.eventId === owner.eventId && ref.messageRef === owner.messageRef
        && ref.startOffset >= owner.startOffset && ref.endOffset <= owner.endOffset))) break;
      permitted.add(source.unitId);
      unitId = source.unitId;
    }
  }
  return after.every(unit => permitted.has(unit.unitId));
}

module.exports = { correctionUnitSetPreserved, incompatibleRelationFailure, targetHistoryBindings, targetReferenceRepairFor, targetReferenceRepairPreserved };
