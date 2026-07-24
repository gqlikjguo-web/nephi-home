"use strict";

const { CONTEXT_RELATION_KINDS } = require("./contracts");

const ACTION_BY_KIND = {
  new_request: "start",
  supplement_existing: "continue",
  modify_existing: "replace",
  end_existing: "end",
  relation_uncertain: "none"
};

function validEvidenceRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hasMessage = Boolean(String(value.eventId || "").trim()) || Boolean(String(value.messageRef || "").trim());
  return hasMessage && Number.isInteger(value.startOffset) && Number.isInteger(value.endOffset)
    && value.startOffset >= 0 && value.endOffset > value.startOffset && typeof value.quote === "string" && value.quote.length > 0;
}

function sourceEventMaps(sourceEvents) {
  const byEventId = new Map();
  const byMessageRef = new Map();
  for (const sourceEvent of Array.isArray(sourceEvents) ? sourceEvents : []) {
    if (!sourceEvent || typeof sourceEvent !== "object") continue;
    const normalized = {
      eventId: String(sourceEvent.eventId || "").trim(),
      messageRef: String(sourceEvent.messageRef || "").trim(),
      messageText: String(sourceEvent.messageText || "")
    };
    if (normalized.eventId) byEventId.set(normalized.eventId, byEventId.has(normalized.eventId) ? null : normalized);
    if (normalized.messageRef) byMessageRef.set(normalized.messageRef, byMessageRef.has(normalized.messageRef) ? null : normalized);
  }
  return { byEventId, byMessageRef };
}

function evidenceMatchesSource(evidenceRef, sourceMaps) {
  if (!validEvidenceRef(evidenceRef)) return false;
  const eventId = String(evidenceRef.eventId || "").trim();
  const messageRef = String(evidenceRef.messageRef || "").trim();
  const byEvent = eventId ? sourceMaps.byEventId.get(eventId) : undefined;
  const byMessage = messageRef ? sourceMaps.byMessageRef.get(messageRef) : undefined;
  if ((eventId && !byEvent) || (messageRef && !byMessage) || (eventId && messageRef && byEvent !== byMessage)) return false;
  const source = byEvent || byMessage;
  if (!source) return false;
  return evidenceRef.endOffset <= source.messageText.length
    && source.messageText.slice(evidenceRef.startOffset, evidenceRef.endOffset) === evidenceRef.quote;
}

function requestCandidateIndexes(plannerOutput) {
  const indexes = new Set();
  const errors = [];
  for (const [index, task] of (Array.isArray(plannerOutput && plannerOutput.tasks) ? plannerOutput.tasks : []).entries()) {
    if (!task || !Number.isInteger(task.candidateIndex) || task.candidateIndex < 0 || indexes.has(task.candidateIndex)) errors.push(`tasks.${index}.candidateIndex`);
    else indexes.add(task.candidateIndex);
  }
  return { indexes, errors };
}

function sameSnapshotScope(snapshotScope = {}, scope = {}) {
  return snapshotScope.propertyId === scope.propertyId
    && snapshotScope.channelId === scope.channelId
    && snapshotScope.userId === scope.lineUserId;
}

function referenceableCycle(cycle, generatedAt) {
  if (!cycle || !cycle.requestCycleId || cycle.status === "ended" || cycle.status === "expired") return false;
  if (!cycle.contextReuseExpiresAt) return true;
  const expiresAt = Date.parse(cycle.contextReuseExpiresAt);
  const now = Date.parse(generatedAt || "");
  return Number.isFinite(expiresAt) && Number.isFinite(now) && expiresAt > now;
}

function validateUnderstandingContext(plannerOutput, snapshot, { sourceEvents = [], scope = null } = {}) {
  const errors = [];
  const snapshotScopeValid = !scope || sameSnapshotScope(snapshot && snapshot.scope, scope);
  const cycles = new Map((snapshot && snapshot.cycles || [])
    .filter((cycle) => snapshotScopeValid && referenceableCycle(cycle, snapshot && snapshot.generatedAt))
    .map((cycle) => [cycle.requestCycleId, cycle]));
  const candidates = plannerOutput && plannerOutput.contextRelationCandidates;
  const requestCandidates = requestCandidateIndexes(plannerOutput);
  errors.push(...requestCandidates.errors);
  if (!Array.isArray(candidates)) return { ok: false, errors: [...errors, "contextRelationCandidates"], relations: [] };
  const sourceMaps = sourceEventMaps(sourceEvents);
  const relations = [];
  const relatedCandidateIndexes = new Set();
  candidates.forEach((candidate, index) => {
    const path = `contextRelationCandidates.${index}`;
    if (!candidate || typeof candidate !== "object" || !Number.isInteger(candidate.candidateIndex) || candidate.candidateIndex < 0
      || !CONTEXT_RELATION_KINDS.has(candidate.kind) || !Array.isArray(candidate.candidateRequestCycleRefs) || !Array.isArray(candidate.evidenceRefs)
      || !candidate.evidenceRefs.length || !candidate.evidenceRefs.every((evidenceRef) => evidenceMatchesSource(evidenceRef, sourceMaps))) {
      errors.push(path);
      return;
    }
    if (!requestCandidates.indexes.has(candidate.candidateIndex) || relatedCandidateIndexes.has(candidate.candidateIndex)) {
      errors.push(`${path}.candidateIndex`);
      return;
    }
    const refs = candidate.candidateRequestCycleRefs.map(String);
    const uniqueRefs = [...new Set(refs)];
    const expectedRefCount = ["supplement_existing", "modify_existing", "end_existing"].includes(candidate.kind) ? 1 : candidate.kind === "new_request" ? 0 : null;
    if ((expectedRefCount !== null && uniqueRefs.length !== expectedRefCount) || uniqueRefs.some((ref) => !cycles.has(ref))) {
      errors.push(`${path}.candidateRequestCycleRefs`);
      return;
    }
    relatedCandidateIndexes.add(candidate.candidateIndex);
    relations.push({ candidateIndex: candidate.candidateIndex, kind: candidate.kind, requestCycleId: uniqueRefs[0] || null, stateAction: ACTION_BY_KIND[candidate.kind], evidenceRefs: candidate.evidenceRefs });
  });
  for (const candidateIndex of requestCandidates.indexes) {
    if (!relatedCandidateIndexes.has(candidateIndex)) errors.push(`tasks.${candidateIndex}.contextRelationCandidate`);
  }
  return { ok: errors.length === 0, errors, relations };
}

module.exports = { validateUnderstandingContext, validEvidenceRef, evidenceMatchesSource };
