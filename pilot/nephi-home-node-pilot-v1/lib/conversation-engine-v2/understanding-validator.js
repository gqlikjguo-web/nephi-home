"use strict";

const { CONTEXT_RELATION_KINDS } = require("./contracts");

const LEGACY_RELATION_KIND = {
  new_request: "new_request",
  new_topic: "new_request",
  continue: "supplement_existing",
  answer_clarification: "supplement_existing",
  modify: "modify_existing"
};
const ACTION_BY_KIND = {
  new_request: "start",
  supplement_existing: "continue",
  modify_existing: "replace",
  end_existing: "end",
  relation_uncertain: "none"
};

function validEvidenceRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hasMessage = typeof value.eventId === "string" || typeof value.messageRef === "string";
  return hasMessage && Number.isInteger(value.startOffset) && Number.isInteger(value.endOffset)
    && value.startOffset >= 0 && value.endOffset >= value.startOffset && typeof value.quote === "string";
}

function normalizeLegacyRelation(plannerOutput, snapshot) {
  const relation = plannerOutput && plannerOutput.discourse && plannerOutput.discourse.relation;
  const kind = LEGACY_RELATION_KIND[relation];
  if (!kind) return [];
  if (kind !== "new_request" && snapshot.cycles.length !== 1) {
    return [{ candidateIndex: 0, kind: "relation_uncertain", candidateRequestCycleRefs: [], evidenceRefs: [] }];
  }
  const refs = kind === "new_request" ? [] : snapshot.cycles.length === 1 ? [snapshot.cycles[0].requestCycleId] : [];
  return [{ candidateIndex: 0, kind, candidateRequestCycleRefs: refs, evidenceRefs: [] }];
}

function relationCandidates(plannerOutput, snapshot) {
  if (Array.isArray(plannerOutput && plannerOutput.contextRelationCandidates)) return plannerOutput.contextRelationCandidates;
  return normalizeLegacyRelation(plannerOutput, snapshot);
}

function validateUnderstandingContext(plannerOutput, snapshot) {
  const errors = [];
  const cycles = new Map((snapshot && snapshot.cycles || []).map((cycle) => [cycle.requestCycleId, cycle]));
  const candidates = relationCandidates(plannerOutput, snapshot || { cycles: [] });
  const relations = [];
  candidates.forEach((candidate, index) => {
    const path = `contextRelationCandidates.${index}`;
    if (!candidate || typeof candidate !== "object" || !Number.isInteger(candidate.candidateIndex) || candidate.candidateIndex < 0
      || !CONTEXT_RELATION_KINDS.has(candidate.kind) || !Array.isArray(candidate.candidateRequestCycleRefs) || !Array.isArray(candidate.evidenceRefs)
      || !candidate.evidenceRefs.every(validEvidenceRef)) {
      errors.push(path);
      return;
    }
    const refs = candidate.candidateRequestCycleRefs.map(String);
    const uniqueRefs = [...new Set(refs)];
    const expectedRefCount = ["supplement_existing", "modify_existing", "end_existing"].includes(candidate.kind) ? 1 : candidate.kind === "new_request" ? 0 : null;
    if ((expectedRefCount !== null && uniqueRefs.length !== expectedRefCount) || uniqueRefs.some((ref) => !cycles.has(ref))) {
      errors.push(`${path}.candidateRequestCycleRefs`);
      return;
    }
    relations.push({ candidateIndex: candidate.candidateIndex, kind: candidate.kind, requestCycleId: uniqueRefs[0] || null, stateAction: ACTION_BY_KIND[candidate.kind], evidenceRefs: candidate.evidenceRefs });
  });
  return { ok: errors.length === 0, errors, relations };
}

module.exports = { validateUnderstandingContext, relationCandidates, validEvidenceRef };
