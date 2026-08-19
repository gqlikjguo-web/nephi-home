"use strict";

const { CONTEXT_RELATION_KINDS } = require("./contracts");

const ACTION_BY_KIND = {
  new_request: "start",
  supplement_existing: "continue",
  modify_existing: "replace",
  end_existing: "end",
  relation_uncertain: "none"
};
const FIELD_PROVENANCE_KEYS = Object.freeze([
  "checkIn",
  "checkOut",
  "guestCount",
  "product",
  "searchRange"
]);

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

function currentTaskProvidesField(task, field) {
  const stay = task && task.stayCandidate || {};
  const entity = task && task.entity || {};
  if (field === "checkIn") return Boolean(stay.checkInCandidate || stay.dateExpression && stay.dateExpression.rawText);
  if (field === "checkOut") return Boolean(stay.checkOutCandidate || Number.isInteger(stay.nightsCandidate));
  if (field === "guestCount") return Number.isInteger(stay.guestCountCandidate);
  if (field === "product") return Boolean(entity.canonicalCandidate && ["room", "bundle"].includes(entity.category));
  return field === "searchRange" && Boolean(stay.dateExpression && stay.dateExpression.kind === "range");
}

function cycleProvidesField(cycle, field) {
  const confirmed = cycle && cycle.confirmedInputs || {};
  const stay = confirmed.stay || {};
  const inventory = confirmed.inventory || {};
  if (field === "checkIn") return Boolean(stay.checkIn);
  if (field === "checkOut") return Boolean(stay.checkOut);
  if (field === "guestCount") return Number.isInteger(stay.guests);
  if (field === "product") return Boolean(inventory.entityId && ["room_only", "bundle_only"].includes(inventory.mode));
  return field === "searchRange" && Boolean(stay.searchRange && stay.searchRange.from && stay.searchRange.to);
}

function validateFieldProvenance(candidate, task, cycles, path, errors) {
  if (!Object.hasOwn(candidate, "fieldProvenance")) return null;
  const input = candidate.fieldProvenance;
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).length !== FIELD_PROVENANCE_KEYS.length
    || !FIELD_PROVENANCE_KEYS.every((field) => Object.hasOwn(input, field))) {
    errors.push(`${path}.fieldProvenance`);
    return null;
  }
  const validated = {};
  const contextCycleIds = new Set();
  for (const field of FIELD_PROVENANCE_KEYS) {
    const source = input[field];
    const fieldPath = `${path}.fieldProvenance.${field}`;
    if (!source || typeof source !== "object" || Array.isArray(source)
      || ![null, "explicit", "context"].includes(source.provenance)
      || !Array.isArray(source.sourceHistoryTurnRefs)
      || !Array.isArray(source.candidateRequestCycleRefs)) {
      errors.push(fieldPath);
      continue;
    }
    const historyTurns = [...new Set(source.sourceHistoryTurnRefs)];
    const cycleRefs = [...new Set(source.candidateRequestCycleRefs.map(String))];
    if (source.provenance === null) {
      if (historyTurns.length || cycleRefs.length) errors.push(fieldPath);
      validated[field] = { provenance: null, requestCycleId: null };
      continue;
    }
    if (source.provenance === "explicit") {
      if (historyTurns.length || cycleRefs.length || !currentTaskProvidesField(task, field)) errors.push(fieldPath);
      validated[field] = { provenance: "explicit", requestCycleId: null };
      continue;
    }
    if (currentTaskProvidesField(task, field)
      || historyTurns.length !== 1
      || source.historyTurnBound !== true) {
      errors.push(fieldPath);
      continue;
    }
    const matchingCycles = cycleRefs
      .map((requestCycleId) => cycles.get(requestCycleId))
      .filter((cycle) => cycle && cycleProvidesField(cycle, field));
    if (matchingCycles.length !== 1) {
      errors.push(fieldPath);
      continue;
    }
    const requestCycleId = String(matchingCycles[0].requestCycleId);
    contextCycleIds.add(requestCycleId);
    validated[field] = { provenance: "context", requestCycleId };
  }
  if (contextCycleIds.size > 1) errors.push(`${path}.fieldProvenance.requestCycle`);
  return FIELD_PROVENANCE_KEYS.every((field) => Object.hasOwn(validated, field))
    ? validated
    : null;
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
    const task = (plannerOutput.tasks || []).find((item) => item && item.candidateIndex === candidate.candidateIndex);
    const fieldProvenance = validateFieldProvenance(candidate, task, cycles, path, errors);
    if (fieldProvenance && uniqueRefs[0]) {
      const contextCycleIds = [...new Set(Object.values(fieldProvenance)
        .filter((source) => source.provenance === "context")
        .map((source) => source.requestCycleId))];
      if (contextCycleIds.some((requestCycleId) => requestCycleId !== uniqueRefs[0])) {
        errors.push(`${path}.fieldProvenance.relationCycle`);
      }
    }
    relatedCandidateIndexes.add(candidate.candidateIndex);
    relations.push({
      candidateIndex: candidate.candidateIndex,
      kind: candidate.kind,
      requestCycleId: uniqueRefs[0] || null,
      stateAction: ACTION_BY_KIND[candidate.kind],
      evidenceRefs: candidate.evidenceRefs,
      ...(fieldProvenance ? { fieldProvenance } : {})
    });
  });
  for (const candidateIndex of requestCandidates.indexes) {
    if (!relatedCandidateIndexes.has(candidateIndex)) errors.push(`tasks.${candidateIndex}.contextRelationCandidate`);
  }
  return { ok: errors.length === 0, errors, relations };
}

module.exports = { validateUnderstandingContext, validEvidenceRef, sourceEventMaps, evidenceMatchesSource, evidenceRefFailureCodes, evidenceRefsFailureCodes };
