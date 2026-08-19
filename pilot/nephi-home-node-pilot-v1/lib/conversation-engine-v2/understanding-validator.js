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
      messageText: String(sourceEvent.messageText || ""),
      sourceKind: String(sourceEvent.sourceKind || "current_user"),
      createdAt: String(sourceEvent.createdAt || ""),
      requestCycleRefs: [...new Set((Array.isArray(sourceEvent.requestCycleRefs) ? sourceEvent.requestCycleRefs : [])
        .map((value) => String(value || "").trim()).filter(Boolean))],
      propertyId: String(sourceEvent.propertyId || ""),
      channelId: String(sourceEvent.channelId || ""),
      lineUserId: String(sourceEvent.lineUserId || "")
    };
    if (normalized.eventId) byEventId.set(normalized.eventId, byEventId.has(normalized.eventId) ? null : normalized);
    if (normalized.messageRef) byMessageRef.set(normalized.messageRef, byMessageRef.has(normalized.messageRef) ? null : normalized);
  }
  return { byEventId, byMessageRef };
}

function boundedHistoricalUserSources(recentConversation, snapshot, scope = {}) {
  if (!sameSnapshotScope(snapshot && snapshot.scope, scope)) return [];
  const generatedAt = Date.parse(snapshot && snapshot.generatedAt || "");
  if (!Number.isFinite(generatedAt)) return [];
  return (Array.isArray(recentConversation) ? recentConversation : []).flatMap((item) => {
    const createdAt = Date.parse(item && item.createdAt || "");
    const propertyId = String(item && item.propertyId || "");
    const channelId = String(item && item.channelId || "");
    const lineUserId = String(item && item.lineUserId || "");
    const eventId = String(item && item.eventId || "").trim();
    const messageRef = String(item && item.messageRef || "").trim();
    const messageText = String(item && item.guestMessage || "");
    if ((!eventId && !messageRef) || !messageText || !Number.isFinite(createdAt)
      || createdAt > generatedAt || generatedAt - createdAt > 24 * 60 * 60 * 1000
      || propertyId !== String(scope.propertyId || "")
      || channelId !== String(scope.channelId || "")
      || lineUserId !== String(scope.lineUserId || "")) return [];
    return [{
      eventId,
      messageRef,
      messageText,
      sourceKind: "historical_user",
      createdAt: new Date(createdAt).toISOString(),
      requestCycleRefs: [...new Set((Array.isArray(item.requestCycleRefs) ? item.requestCycleRefs : [])
        .map((value) => String(value || "").trim()).filter(Boolean))],
      propertyId,
      channelId,
      lineUserId
    }];
  });
}

function validateHistoricalUserEvidence(refs, { recentConversation = [], contextSnapshot = {}, scope = {} } = {}) {
  const sources = boundedHistoricalUserSources(recentConversation, contextSnapshot, scope);
  const maps = sourceEventMaps(sources);
  if (!Array.isArray(refs) || refs.length < 1 || !refs.every((ref) => evidenceMatchesSource(ref, maps))) {
    return { ok: false, reasonCode: "historical_evidence_invalid", source: null, cycle: null };
  }
  const matched = refs.map((ref) => maps.byEventId.get(String(ref.eventId || "").trim())
    || maps.byMessageRef.get(String(ref.messageRef || "").trim()));
  const uniqueSources = [...new Set(matched)];
  if (uniqueSources.length !== 1) return { ok: false, reasonCode: "historical_source_not_unique", source: null, cycle: null };
  const source = uniqueSources[0];
  const cycles = (contextSnapshot.cycles || []).filter((cycle) => (
    source.requestCycleRefs.includes(String(cycle && cycle.requestCycleId || ""))
    && referenceableCycle(cycle, contextSnapshot.generatedAt)
  ));
  if (cycles.length !== 1) return { ok: false, reasonCode: "historical_cycle_not_unique", source, cycle: null };
  return { ok: true, reasonCode: "historical_user_evidence_verified", source, cycle: cycles[0] };
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

function evidenceRefFailureCodes(evidenceRef, sourceMaps) {
  if (!evidenceRef || typeof evidenceRef !== "object" || Array.isArray(evidenceRef)) return ["invalid_evidence_ref"];
  const eventId = String(evidenceRef.eventId || "").trim();
  const messageRef = String(evidenceRef.messageRef || "").trim();
  const codes = [];
  if (!eventId && !messageRef) codes.push("missing_source_identity");
  if (!Number.isInteger(evidenceRef.startOffset) || !Number.isInteger(evidenceRef.endOffset)
    || evidenceRef.startOffset < 0 || evidenceRef.endOffset <= evidenceRef.startOffset) codes.push("invalid_offset");
  if (typeof evidenceRef.quote !== "string" || evidenceRef.quote.length < 1) codes.push("invalid_quote");
  if (codes.length) return codes;
  const byEvent = eventId ? sourceMaps.byEventId.get(eventId) : undefined;
  const byMessage = messageRef ? sourceMaps.byMessageRef.get(messageRef) : undefined;
  if (eventId && !byEvent) codes.push("unknown_event_id");
  if (messageRef && !byMessage) codes.push("unknown_message_ref");
  if (eventId && messageRef && byEvent && byMessage && byEvent !== byMessage) codes.push("identity_conflict");
  const source = byEvent || byMessage;
  if (!codes.length && source && evidenceRef.endOffset > source.messageText.length) codes.push("out_of_bounds");
  if (!codes.length && source && source.messageText.slice(evidenceRef.startOffset, evidenceRef.endOffset) !== evidenceRef.quote) codes.push("quote_slice_mismatch");
  return codes;
}

function evidenceRefsFailureCodes(refs, sourceEvents) {
  if (!Array.isArray(refs) || refs.length < 1) return ["missing_refs"];
  if (refs.length > 12) return ["too_many_refs"];
  const sourceMaps = sourceEventMaps(sourceEvents);
  return [...new Set(refs.flatMap((ref) => evidenceRefFailureCodes(ref, sourceMaps)))].sort();
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

module.exports = {
  validateUnderstandingContext,
  validEvidenceRef,
  sourceEventMaps,
  evidenceMatchesSource,
  evidenceRefFailureCodes,
  evidenceRefsFailureCodes,
  boundedHistoricalUserSources,
  validateHistoricalUserEvidence
};
