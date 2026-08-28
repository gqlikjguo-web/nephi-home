"use strict";

const { evidenceMatchesSource, sourceEventMaps } = require("./understanding-validator");

function sourceIdentifierCounts(sourceEvents) {
  const eventIds = new Map();
  const messageRefs = new Map();
  for (const sourceEvent of Array.isArray(sourceEvents) ? sourceEvents : []) {
    if (!sourceEvent || typeof sourceEvent !== "object") continue;
    const eventId = String(sourceEvent.eventId || "").trim();
    const messageRef = String(sourceEvent.messageRef || "").trim();
    if (eventId) eventIds.set(eventId, (eventIds.get(eventId) || 0) + 1);
    if (messageRef) messageRefs.set(messageRef, (messageRefs.get(messageRef) || 0) + 1);
  }
  return { eventIds, messageRefs };
}

function uniqueExactSourceMatch(sourceText, sourceEvents, identifierCounts) {
  if (typeof sourceText !== "string" || sourceText.length === 0) return null;
  const matches = [];
  for (const sourceEvent of Array.isArray(sourceEvents) ? sourceEvents : []) {
    if (!sourceEvent || typeof sourceEvent !== "object") continue;
    const messageText = String(sourceEvent.messageText || "");
    let searchFrom = 0;
    while (searchFrom <= messageText.length - sourceText.length) {
      const startOffset = messageText.indexOf(sourceText, searchFrom);
      if (startOffset < 0) break;
      matches.push({ sourceEvent, startOffset });
      if (matches.length > 1) return null;
      searchFrom = startOffset + 1;
    }
  }
  if (matches.length !== 1) return null;
  const match = matches[0];
  const eventId = String(match.sourceEvent.eventId || "").trim();
  const messageRef = String(match.sourceEvent.messageRef || "").trim();
  if ((!eventId && !messageRef)
    || (eventId && identifierCounts.eventIds.get(eventId) !== 1)
    || (messageRef && identifierCounts.messageRefs.get(messageRef) !== 1)) return null;
  return {
    eventId,
    messageRef,
    startOffset: match.startOffset,
    endOffset: match.startOffset + sourceText.length,
    quote: sourceText
  };
}

function uniqueIdentifiedSourceMatch(sourceText, evidenceRef, sourceEvents, identifierCounts) {
  const eventId = String(evidenceRef && evidenceRef.eventId || "").trim();
  const messageRef = String(evidenceRef && evidenceRef.messageRef || "").trim();
  if ((!eventId && !messageRef)
    || (eventId && identifierCounts.eventIds.get(eventId) !== 1)
    || (messageRef && identifierCounts.messageRefs.get(messageRef) !== 1)) return null;
  const identified = (Array.isArray(sourceEvents) ? sourceEvents : []).filter((sourceEvent) => {
    if (!sourceEvent || typeof sourceEvent !== "object") return false;
    return (!eventId || String(sourceEvent.eventId || "").trim() === eventId)
      && (!messageRef || String(sourceEvent.messageRef || "").trim() === messageRef);
  });
  if (identified.length !== 1) return null;
  return uniqueExactSourceMatch(sourceText, identified, sourceIdentifierCounts(identified));
}

function uniqueIdentifiedSourceEvidence(evidenceRef, sourceEvents, identifierCounts) {
  const eventId = String(evidenceRef && evidenceRef.eventId || "").trim();
  const messageRef = String(evidenceRef && evidenceRef.messageRef || "").trim();
  if ((!eventId && !messageRef)
    || (eventId && identifierCounts.eventIds.get(eventId) !== 1)
    || (messageRef && identifierCounts.messageRefs.get(messageRef) !== 1)) return null;
  const identified = (Array.isArray(sourceEvents) ? sourceEvents : []).filter((sourceEvent) => {
    if (!sourceEvent || typeof sourceEvent !== "object") return false;
    return (!eventId || String(sourceEvent.eventId || "").trim() === eventId)
      && (!messageRef || String(sourceEvent.messageRef || "").trim() === messageRef);
  });
  if (identified.length !== 1) return null;
  const sourceEvent = identified[0];
  const messageText = String(sourceEvent.messageText || "");
  if (!messageText) return null;
  const endOffset = Math.min(messageText.length, 500);
  return {
    eventId: String(sourceEvent.eventId || "").trim(),
    messageRef: String(sourceEvent.messageRef || "").trim(),
    startOffset: 0,
    endOffset,
    quote: messageText.slice(0, endOffset)
  };
}

function normalizePendingEvidenceRefs(evidenceRefs, sourceEvents, identifierCounts, sourceMaps) {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) return null;
  if (evidenceRefs.every((evidenceRef) => evidenceMatchesSource(evidenceRef, sourceMaps))) return evidenceRefs;
  const normalized = evidenceRefs.map((evidenceRef) => {
    if (evidenceMatchesSource(evidenceRef, sourceMaps)) return evidenceRef;
    const quote = evidenceRef && evidenceRef.quote;
    return uniqueIdentifiedSourceMatch(quote, evidenceRef, sourceEvents, identifierCounts)
      || uniqueExactSourceMatch(quote, sourceEvents, identifierCounts);
  });
  return normalized.every(Boolean) && normalized.every((evidenceRef) => evidenceMatchesSource(evidenceRef, sourceMaps))
    ? normalized
    : null;
}

function normalizePlannerEvidenceCoordinates(plannerOutput, sourceEvents) {
  if (!plannerOutput || typeof plannerOutput !== "object" || Array.isArray(plannerOutput)
    || !Array.isArray(plannerOutput.tasks) || !Array.isArray(plannerOutput.contextRelationCandidates)) return plannerOutput;
  const tasksByCandidateIndex = new Map();
  for (const task of plannerOutput.tasks) {
    if (!task || !Number.isInteger(task.candidateIndex) || task.candidateIndex < 0) continue;
    tasksByCandidateIndex.set(task.candidateIndex, tasksByCandidateIndex.has(task.candidateIndex) ? null : task);
  }
  const identifierCounts = sourceIdentifierCounts(sourceEvents);
  const sourceMaps = sourceEventMaps(sourceEvents);
  let changed = false;
  const contextRelationCandidates = plannerOutput.contextRelationCandidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || !Number.isInteger(candidate.candidateIndex)) return candidate;
    const task = tasksByCandidateIndex.get(candidate.candidateIndex);
    if (!task) return candidate;
    const plannerEvidence = Array.isArray(candidate.evidenceRefs) ? candidate.evidenceRefs : [];
    if (plannerEvidence.length > 0 && plannerEvidence.every((evidenceRef) => evidenceMatchesSource(evidenceRef, sourceMaps))) return candidate;
    const canonicalQuotedEvidence = candidate.kind === "new_request"
      ? plannerEvidence.map((evidenceRef) => uniqueIdentifiedSourceMatch(
          evidenceRef && evidenceRef.quote,
          evidenceRef,
          sourceEvents,
          identifierCounts
        ) || uniqueIdentifiedSourceEvidence(evidenceRef, sourceEvents, identifierCounts))
      : [];
    const canonicalEvidence = canonicalQuotedEvidence.length > 0 && canonicalQuotedEvidence.every(Boolean)
      ? canonicalQuotedEvidence
      : [uniqueExactSourceMatch(task.sourceText, sourceEvents, identifierCounts)].filter(Boolean);
    if (!canonicalEvidence.length) return candidate;
    changed = true;
    return { ...candidate, evidenceRefs: canonicalEvidence };
  });
  const relationsByCandidateIndex = new Map();
  for (const candidate of contextRelationCandidates) {
    if (!candidate || !Number.isInteger(candidate.candidateIndex)) continue;
    relationsByCandidateIndex.set(candidate.candidateIndex,
      relationsByCandidateIndex.has(candidate.candidateIndex) ? null : candidate);
  }
  const taskCandidateIndexCounts = new Map();
  for (const task of plannerOutput.tasks) {
    const candidateIndex = task && task.candidateIndex;
    taskCandidateIndexCounts.set(candidateIndex, (taskCandidateIndexCounts.get(candidateIndex) || 0) + 1);
  }
  const groundingIdCounts = new Map();
  const groundingCandidateIndexCounts = new Map();
  for (const grounding of Array.isArray(plannerOutput.semanticGroundings) ? plannerOutput.semanticGroundings : []) {
    const groundingId = String(grounding && grounding.groundingId || "");
    groundingIdCounts.set(groundingId, (groundingIdCounts.get(groundingId) || 0) + 1);
    const candidateIndex = grounding && grounding.provenanceRelationCandidateIndexes
      && grounding.provenanceRelationCandidateIndexes[0];
    groundingCandidateIndexCounts.set(candidateIndex, (groundingCandidateIndexCounts.get(candidateIndex) || 0) + 1);
  }
  let semanticGroundingsChanged = false;
  const semanticGroundings = Array.isArray(plannerOutput.semanticGroundings)
    ? plannerOutput.semanticGroundings.map((grounding) => {
      if (!grounding || typeof grounding !== "object" || Array.isArray(grounding)) return grounding;
      const groundingId = String(grounding.groundingId || "");
      const owningTasks = plannerOutput.tasks.filter((task) => String(task && task.groundingId || "") === groundingId);
      const provenanceIndexes = Array.isArray(grounding.provenanceRelationCandidateIndexes)
        ? grounding.provenanceRelationCandidateIndexes
        : [];
      if (!groundingId || owningTasks.length !== 1 || provenanceIndexes.length !== 1
        || owningTasks[0].candidateIndex !== provenanceIndexes[0]
        || groundingIdCounts.get(groundingId) !== 1
        || taskCandidateIndexCounts.get(provenanceIndexes[0]) !== 1
        || groundingCandidateIndexCounts.get(provenanceIndexes[0]) !== 1) return grounding;
      const relationCandidate = relationsByCandidateIndex.get(provenanceIndexes[0]);
      if (!relationCandidate) return grounding;
      const normalizedEvidence = normalizePendingEvidenceRefs(grounding.evidenceRefs, sourceEvents, identifierCounts, sourceMaps);
      const relationEvidence = Array.isArray(relationCandidate.evidenceRefs) ? relationCandidate.evidenceRefs : [];
      const sameEvidence = normalizedEvidence && normalizedEvidence.length === relationEvidence.length
        && normalizedEvidence.every((evidenceRef, index) => {
          const relationRef = relationEvidence[index];
          return String(evidenceRef && evidenceRef.eventId || "") === String(relationRef && relationRef.eventId || "")
            && String(evidenceRef && evidenceRef.messageRef || "") === String(relationRef && relationRef.messageRef || "")
            && evidenceRef && evidenceRef.startOffset === relationRef.startOffset
            && evidenceRef.endOffset === relationRef.endOffset
            && evidenceRef.quote === relationRef.quote;
        });
      if (!sameEvidence
        || normalizedEvidence === grounding.evidenceRefs) return grounding;
      changed = true;
      semanticGroundingsChanged = true;
      return { ...grounding, evidenceRefs: relationCandidate.evidenceRefs };
    })
    : plannerOutput.semanticGroundings;
  let semanticCandidatesChanged = false;
  const semanticCandidates = Array.isArray(plannerOutput.semanticCandidates)
    ? plannerOutput.semanticCandidates.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
        || candidate.coverageStatus !== "pending_task"
        || !Array.isArray(candidate.provenanceRelationCandidateIndexes)
        || candidate.provenanceRelationCandidateIndexes.length !== 0) return candidate;
      const normalizedEvidence = normalizePendingEvidenceRefs(candidate.evidenceRefs, sourceEvents, identifierCounts, sourceMaps);
      if (!normalizedEvidence || normalizedEvidence === candidate.evidenceRefs) return candidate;
      changed = true;
      semanticCandidatesChanged = true;
      return { ...candidate, evidenceRefs: normalizedEvidence };
    })
    : plannerOutput.semanticCandidates;
  if (!changed) return plannerOutput;
  return {
    ...plannerOutput,
    contextRelationCandidates,
    ...(semanticGroundingsChanged ? { semanticGroundings } : {}),
    ...(semanticCandidatesChanged ? { semanticCandidates } : {})
  };
}

module.exports = { normalizePlannerEvidenceCoordinates };
