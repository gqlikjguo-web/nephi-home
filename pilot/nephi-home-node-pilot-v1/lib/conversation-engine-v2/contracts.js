"use strict";

const CONTEXT_RELATION_KINDS = new Set([
  "new_request",
  "supplement_existing",
  "modify_existing",
  "end_existing",
  "relation_uncertain"
]);

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
  if (state.contextCycle && state.contextCycle.status !== "ended" && state.contextCycle.status !== "expired"
    && state.contextCycle.requestCycleId && (!state.contextCycle.contextReuseExpiresAt || new Date(state.contextCycle.contextReuseExpiresAt).getTime() > new Date(now).getTime())) {
    snapshot.cycles.push({
      requestCycleId: String(state.contextCycle.requestCycleId),
      requestKind: String(state.contextCycle.requestKind || ""),
      status: String(state.contextCycle.status || "active"),
      confirmedInputs: state.contextCycle.confirmedInputs || {},
      contextReuseExpiresAt: state.contextCycle.contextReuseExpiresAt || null,
      pendingRequestId: state.pendingRequest && state.pendingRequest.pendingRequestId || null
    });
    return snapshot;
  }
  if (!isCurrentPending(state.pendingRequest, now)) return snapshot;
  const pending = state.pendingRequest;
  const requestCycleId = legacyCycleId(pending);
  if (!requestCycleId) return snapshot;
  snapshot.cycles.push({
    requestCycleId,
    requestKind: String(pending.capability || ""),
    status: "active",
    confirmedInputs: pending.conditions || {},
    contextReuseExpiresAt: pendingExpiry(pending),
    pendingRequestId: pending.pendingRequestId || null
  });
  return snapshot;
}

module.exports = { CONTEXT_RELATION_KINDS, buildContextSnapshot, isCurrentPending, legacyCycleId };
