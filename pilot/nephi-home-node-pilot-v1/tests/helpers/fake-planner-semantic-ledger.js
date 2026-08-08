"use strict";

const FAKE_LEDGER_CAPABILITIES = new Set(["availability", "available_dates", "room_options", "bundle_availability", "capacity", "price", "total_price", "amenity", "amenity_list", "policy", "property_fact", "booking_request", "human_help", "high_risk", "unknown"]);

function opaqueCandidateId(index) {
  return `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function fallbackEvidence(task) {
  const quote = String(task && task.sourceText || "fixture").slice(0, 500) || "fixture";
  return [{ eventId: "fixture-event", messageRef: "", startOffset: 0, endOffset: quote.length, quote }];
}

function migrateFakePlannerOutput(output) {
  if (!output || typeof output !== "object" || !Array.isArray(output.tasks)) return output;
  const previousCandidates = Array.isArray(output.semanticCandidates) ? output.semanticCandidates : [];
  const previousById = new Map(previousCandidates.map((candidate) => [String(candidate && candidate.candidateId || ""), candidate]));
  const usedIds = new Set();
  const ownedIds = new Set();
  const ownedCandidates = [];
  output.tasks.forEach((task, index) => {
    let candidateId = Array.isArray(task && task.semanticCandidateIds) && task.semanticCandidateIds.length === 1
      ? String(task.semanticCandidateIds[0] || "")
      : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId) || usedIds.has(candidateId)) {
      candidateId = opaqueCandidateId(index);
      while (usedIds.has(candidateId)) candidateId = opaqueCandidateId(index + usedIds.size + 1);
    }
    usedIds.add(candidateId);
    ownedIds.add(candidateId);
    task.semanticCandidateIds = [candidateId];
    if (!Object.hasOwn(task, "lodgingScopeId")) task.lodgingScopeId = null;
    const relation = Array.isArray(output.contextRelationCandidates)
      ? output.contextRelationCandidates.find((candidate) => candidate && candidate.candidateIndex === task.candidateIndex)
      : null;
    const evidenceRefs = relation && Array.isArray(relation.evidenceRefs) && relation.evidenceRefs.length
      ? relation.evidenceRefs.map((ref) => ({ ...ref }))
      : fallbackEvidence(task);
    const previous = previousById.get(candidateId);
    const lodgingScopeCandidate = task.lodgingScopeId === null
      ? null
      : previous && previous.lodgingScopeCandidate && previous.lodgingScopeCandidate.scopeId === task.lodgingScopeId
        ? previous.lodgingScopeCandidate
        : null;
    ownedCandidates.push({
      candidateId,
      semanticKind: "capability",
      capability: FAKE_LEDGER_CAPABILITIES.has(task.type) ? task.type : "human_help",
      canonicalIdentityCandidate: task.entity && task.entity.canonicalCandidate || (FAKE_LEDGER_CAPABILITIES.has(task.type) ? task.type : "human_help"),
      evidenceRefs,
      lodgingScopeCandidate,
      temporalSemanticCandidate: null,
      propertyCatalogIdentity: null
    });
  });
  const missingCandidates = previousCandidates.filter((candidate) => candidate && !ownedIds.has(String(candidate.candidateId || "")));
  output.semanticCandidates = [...ownedCandidates, ...missingCandidates];
  return output;
}

function encodeFakePlannerOutput(output) {
  return JSON.stringify(output);
}

module.exports = { encodeFakePlannerOutput, migrateFakePlannerOutput, opaqueCandidateId };
