"use strict";

const CONTEXT_RELATION_KINDS = new Set([
  "new_request",
  "supplement_existing",
  "modify_existing",
  "end_existing",
  "relation_uncertain"
]);
const TEMPORAL_RESULT_STATUSES = new Set(["absent", "resolved", "unresolved"]);
const TEMPORAL_PROVENANCE = new Set(["explicit", "context", "defaulted", "derived"]);
const TEMPORAL_VALUE_STATUSES = new Set(["missing", "uncertain", "confirmed"]);

function sameScope(stateScope = {}, scope = {}) {
  return stateScope.propertyId === scope.propertyId
    && stateScope.channelId === scope.channelId
    && stateScope.lineUserId === scope.lineUserId;
}

function pendingExpiry(pending = {}) {
  return pending.metadata && pending.metadata.expiresAt || null;
}

function isCurrentPending(pending, now) {
  if (!pending || pending.status === "ended" || pending.status === "expired") return false;
  const expiresAt = pendingExpiry(pending);
  return !expiresAt || new Date(expiresAt).getTime() > new Date(now).getTime();
}

function legacyCycleId(pending) {
  if (!pending) return null;
  if (pending.requestCycleId) return String(pending.requestCycleId);
  const eventId = pending.metadata && pending.metadata.sourceEventId;
  return eventId ? `pending:${eventId}` : null;
}

function buildContextSnapshot(state, scope = {}) {
  const now = scope.now || new Date().toISOString();
  const snapshot = {
    scope: { propertyId: scope.propertyId || "", channelId: scope.channelId || "", userId: scope.lineUserId || "" },
    generatedAt: now,
    cycles: []
  };
  if (!state || !sameScope(state.scope, scope)) return snapshot;
  // Old states are read only through this mechanical compatibility view.  New
  // states are always written as collections by the reducer.
  const cycles = Array.isArray(state.requestCycles) && state.requestCycles.length
    ? state.requestCycles
    : state.contextCycle ? [state.contextCycle] : [];
  const pendingRequests = Array.isArray(state.pendingRequests) && state.pendingRequests.length
    ? state.pendingRequests
    : state.pendingRequest ? [state.pendingRequest] : [];
  const pendingByCycle = new Map();
  for (const pending of pendingRequests) {
    if (!isCurrentPending(pending, now)) continue;
    const requestCycleId = legacyCycleId(pending);
    if (requestCycleId && !pendingByCycle.has(requestCycleId)) pendingByCycle.set(requestCycleId, pending);
  }
  const knownCycleIds = new Set();
  for (const cycle of cycles) {
    if (!cycle || !cycle.requestCycleId || knownCycleIds.has(cycle.requestCycleId)) continue;
    if (cycle.status === "ended" || cycle.status === "expired") continue;
    if (cycle.contextReuseExpiresAt && new Date(cycle.contextReuseExpiresAt).getTime() <= new Date(now).getTime()) continue;
    knownCycleIds.add(cycle.requestCycleId);
    const pending = pendingByCycle.get(String(cycle.requestCycleId));
    snapshot.cycles.push({
      requestCycleId: String(cycle.requestCycleId),
      requestKind: String(cycle.requestKind || ""),
      status: String(cycle.status || "active"),
      confirmedInputs: cycle.confirmedInputs || {},
      temporalResult: cycle.temporalResult || null,
      sourceEvidenceRefs: Array.isArray(cycle.sourceEvidenceRefs) ? cycle.sourceEvidenceRefs : [],
      contextReuseExpiresAt: cycle.contextReuseExpiresAt || null,
      pendingRequestId: pending && pending.pendingRequestId || null
    });
  }
  // A legacy pending without a contextCycle remains readable only as its
  // mechanical event-derived cycle; no semantic matching is involved.
  for (const [requestCycleId, pending] of pendingByCycle) {
    if (knownCycleIds.has(requestCycleId)) continue;
    snapshot.cycles.push({ requestCycleId, requestKind: String(pending.capability || ""), status: "active", confirmedInputs: pending.conditions || {}, temporalResult: null, sourceEvidenceRefs: [], contextReuseExpiresAt: pendingExpiry(pending), pendingRequestId: pending.pendingRequestId || null });
  }
  return snapshot;
}

module.exports = { CONTEXT_RELATION_KINDS, TEMPORAL_RESULT_STATUSES, TEMPORAL_PROVENANCE, TEMPORAL_VALUE_STATUSES, buildContextSnapshot, isCurrentPending, legacyCycleId };
