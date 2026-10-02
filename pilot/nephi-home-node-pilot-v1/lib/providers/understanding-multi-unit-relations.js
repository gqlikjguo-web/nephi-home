"use strict";

const { isDeepStrictEqual } = require("node:util");
const { cycleIdentityCompatible } = require("../new-core/context-link-validator");
const { incompatibleRelationFailure } = require("./understanding-correction-scope");

// These receipts describe rejected model edges, never a replacement relation,
// target selection or execution authority. C05 must still admit every pair.
function relationDependencyRepair(link) {
  return { contextLinkCandidateId: link.contextLinkCandidateId,
    rule: "Repair only this rejected relationKind/referencedHistoryEventRefs/referencedCurrentUnitId and its matching sourceObligations relation references; independentRequestEvidence may change only as required by the repaired relation. Preserve unit IDs, purpose, capability, subject, values, source evidence, all other obligations and all unaffected sibling links. Topic association is not a lodging-condition dependency. Re-read the unchanged source and use a legal relation; never invent a target, inherited conditions or new meaning." };
}

function sameTurnIdentityFailure(unit, link, units, index) {
  if (link.relationKind !== "RELATED_UNIT") return null;
  const sources = units.filter(source => source.unitId === link.referencedCurrentUnitId);
  if (sources.length !== 1 || cycleIdentityCompatible(unit, sources[0], "RELATED_REQUEST")) return null;
  return { unitId: unit.unitId, violation: { validationErrorCode: "UNDERSTANDING_SCHEMA_INVALID",
    fieldPath: `contextLinkCandidates.${index}.referencedCurrentUnitId`,
    expected: "a compatible same-stay condition source under C05 RELATED_UNIT admission; unrelated request responsibilities remain independent",
    actual: "relation_dependency:identity_incompatible" }, relationDependencyRepair: relationDependencyRepair(link) };
}

function incompatibleCurrentRelations(output) {
  const units = output.understandingOutput.units;
  return output.contextLinkCandidates.flatMap((link, index) => {
    const unit = units.find(item => item.unitId === link.unitId && item.contextLinkCandidateId === link.contextLinkCandidateId);
    const failure = unit && sameTurnIdentityFailure(unit, link, units, index);
    return failure ? [failure] : [];
  });
}

function historicalRelationFailure(output, input, now) {
  const violations = [];
  for (const [index, link] of output.contextLinkCandidates.entries()) {
    if (!["RELATED_REQUEST", "SUPPLEMENT", "MODIFICATION", "TERMINATION"].includes(link.relationKind)) continue;
    const unit = output.understandingOutput.units.find(item => item.unitId === link.unitId && item.contextLinkCandidateId === link.contextLinkCandidateId);
    if (!unit) continue;
    const bound = new Set(input.recentConversation.filter(event => link.referencedHistoryEventRefs.some(ref =>
      ref.eventId === event.eventId && ref.messageRef === event.messageRef)).flatMap(event => event.referenceableCycleIds));
    const cycles = input.referenceableCycles.filter(cycle => bound.has(cycle.requestCycleId));
    if (!cycles.length || cycles.some(cycle => cycleIdentityCompatible(unit, cycle, link.relationKind))) continue;
    const rejected = incompatibleRelationFailure(unit, link, cycles, input, index, now).unitViolations[0];
    if (link.relationKind === "RELATED_REQUEST") rejected.relationDependencyRepair = relationDependencyRepair(link);
    violations.push(rejected);
  }
  if (!violations.length) return null;
  // An earlier envelope rejection must not conceal another demonstrably bad
  // edge from the sole correction. This is evidence only, not partial admission.
  violations.push(...incompatibleCurrentRelations(output));
  return { code: "UNDERSTANDING_SCHEMA_INVALID", violation: violations[0].violation, unitViolations: violations };
}

function currentRelationCorrectionFailure(failure, output, detail) {
  if (failure.boundary !== "C05" || failure.failureCode !== "CONTEXT_TARGET_SCOPE_CONFLICT"
    || !detail?.validationErrors?.includes("referencedCurrentUnitId.source")) return null;
  // An absent/untrusted source or real scope failure is not enough to blame
  // model output. Require the supplied edge to contradict C05's identity rule.
  return incompatibleCurrentRelations(output).find(item => item.unitId === failure.unitId) || null;
}

function relationCorrectionPreserved(previous, next, failures) {
  const repairs = failures.filter(failure => failure.relationDependencyRepair);
  if (!repairs.length) return true;
  if (!Array.isArray(next?.contextLinkCandidates) || !Array.isArray(previous?.contextLinkCandidates)
    || !Array.isArray(next.sourceObligations?.requirements) || !Array.isArray(previous.sourceObligations?.requirements)) return false;
  const repairIds = new Set(repairs.map(failure => failure.relationDependencyRepair.contextLinkCandidateId));
  const unitIds = new Set(repairs.map(failure => failure.unitId));
  const links = output => output.contextLinkCandidates.map(link => {
    if (!repairIds.has(link.contextLinkCandidateId)) return link;
    const { relationKind, referencedHistoryEventRefs, referencedCurrentUnitId, independentRequestEvidence, ...preserved } = link;
    return preserved;
  }).sort((a, b) => a.contextLinkCandidateId.localeCompare(b.contextLinkCandidateId));
  const obligations = output => ({ ...output.sourceObligations,
    requirements: output.sourceObligations.requirements.map(requirement => {
      if (!unitIds.has(requirement.unitId)) return requirement;
      const { relationKind, referencedHistoryEventRefs, referencedCurrentUnitId, ...preserved } = requirement;
      return preserved;
    }).sort((a, b) => a.obligationId.localeCompare(b.obligationId)) });
  return isDeepStrictEqual(links(previous), links(next))
    && isDeepStrictEqual(obligations(previous), obligations(next));
}

function canRetainCorrectedIndependentUnits(firstResult, value, correction, remainingFailures) {
  if (firstResult || !value?.validatedUnits.length || !value.failedUnits.length || !remainingFailures.length) return false;
  const original = correction.failures.filter(failure => failure.unitValidationFailed !== false);
  if (!original.length || original.some(failure => failure.boundary !== "C02" || !failure.relationDependencyRepair)) return false;
  // Only the already-rejected edge may remain failed. New semantic, evidence,
  // schema or scope failures cannot qualify a partial replacement. Every retained
  // unit/link already passed full C02-C05; all G3 checks are still mandatory.
  return remainingFailures.every(failure => failure.boundary === "C05" && failure.relationDependencyRepair
    && original.some(before => before.unitId === failure.unitId
      && before.relationDependencyRepair.contextLinkCandidateId === failure.relationDependencyRepair.contextLinkCandidateId));
}

module.exports = { historicalRelationFailure, currentRelationCorrectionFailure, relationCorrectionPreserved,
  canRetainCorrectedIndependentUnits };
