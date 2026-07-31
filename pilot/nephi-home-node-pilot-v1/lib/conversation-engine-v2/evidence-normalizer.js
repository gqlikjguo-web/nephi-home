"use strict";

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

function normalizePlannerEvidenceCoordinates(plannerOutput, sourceEvents) {
  if (!plannerOutput || typeof plannerOutput !== "object" || Array.isArray(plannerOutput)
    || !Array.isArray(plannerOutput.tasks) || !Array.isArray(plannerOutput.contextRelationCandidates)) return plannerOutput;
  const tasksByCandidateIndex = new Map();
  for (const task of plannerOutput.tasks) {
    if (!task || !Number.isInteger(task.candidateIndex) || task.candidateIndex < 0) continue;
    tasksByCandidateIndex.set(task.candidateIndex, tasksByCandidateIndex.has(task.candidateIndex) ? null : task);
  }
  const identifierCounts = sourceIdentifierCounts(sourceEvents);
  let changed = false;
  const contextRelationCandidates = plannerOutput.contextRelationCandidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || !Number.isInteger(candidate.candidateIndex)) return candidate;
    const task = tasksByCandidateIndex.get(candidate.candidateIndex);
    if (!task) return candidate;
    const canonicalEvidence = uniqueExactSourceMatch(task.sourceText, sourceEvents, identifierCounts);
    if (!canonicalEvidence) return candidate;
    changed = true;
    return { ...candidate, evidenceRefs: [canonicalEvidence] };
  });
  return changed ? { ...plannerOutput, contextRelationCandidates } : plannerOutput;
}

module.exports = { normalizePlannerEvidenceCoordinates };
