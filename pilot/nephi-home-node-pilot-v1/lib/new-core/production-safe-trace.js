"use strict";

const crypto = require("node:crypto");

const STAGES = new Set([
  "line_inbound", "state_before", "new_core_c01", "new_core_understanding",
  "new_core_c03", "new_core_context_filter", "new_core_context", "new_core_c07", "new_core_c08", "new_core_canonical_request",
  "new_core_resolver", "new_core_final", "state_after", "new_core_failure"
]);

function token(value, limit = 160) {
  const text = String(value === undefined || value === null ? "" : value);
  return /^[A-Za-z0-9_:.\-/]{0,160}$/u.test(text) ? text.slice(0, limit) : "";
}

function hash(value) {
  const text = String(value || "");
  if (/^h:[a-f0-9]{64}$/u.test(text)) return text;
  return `h:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function diagnosticText(value, limit = 500) {
  return String(value === undefined || value === null ? "" : value).slice(0, limit)
    .replace(/\bBearer\s+\S+/giu, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu, "[REDACTED]");
}

function list(value, mapper, limit = 40) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map(mapper).filter(Boolean);
}

function evidence(value) {
  return list(value, (ref) => ({
    eventRef: hash(ref && (ref.eventRef || ref.eventId)),
    messageRef: hash(ref && ref.messageRef)
  }), 20);
}

function subject(value) {
  return value && typeof value === "object" ? {
    kind: token(value.kind), catalogIdentity: token(value.catalogIdentity || value.canonicalId)
  } : null;
}

function temporal(value) {
  return value && typeof value === "object" ? {
    kind: token(value.kind || value.expressionType),
    resolutionStatus: token(value.resolutionStatus),
    checkIn: token(value.checkIn || value.checkInCandidate),
    checkOut: token(value.checkOut || value.checkOutCandidate),
    searchFrom: token(value.searchFrom || value.from),
    searchTo: token(value.searchTo || value.to),
    nights: Number.isInteger(value.nights || value.nightsCandidate) ? Number(value.nights || value.nightsCandidate) : null,
    timezone: token(value.timezone)
  } : null;
}

function state(value) {
  const source = value && value.state || value || {};
  return {
    revision: Number.isInteger(source.revision) ? source.revision : 0,
    tasks: list(source.tasks, (task) => ({
      taskId: hash(task && task.taskId), type: token(task && task.type), status: token(task && task.status),
      missingFields: list(task && task.missingFields, token), knownFields: list(task && task.knownFields, token),
      subject: subject(task && task.subject)
    }), 20)
  };
}

function cycle(value) {
  return {
    requestCycleId: hash(value && value.requestCycleId), requestKind: token(value && value.requestKind),
    capability: token(value && value.capability), status: token(value && value.status),
    expiresAt: token(value && value.expiresAt), subject: subject(value && value.subject),
    missingFields: list(value && value.missingFields, token), slotRefs: list(value && value.slotRefs, token),
    confirmedValues: value && value.confirmedValues ? {
      checkIn: token(value.confirmedValues.checkIn), checkOut: token(value.confirmedValues.checkOut),
      guestCount: Number.isInteger(value.confirmedValues.guestCount) ? value.confirmedValues.guestCount : null,
      searchFrom: token(value.confirmedValues.searchFrom), searchTo: token(value.confirmedValues.searchTo)
    } : null
  };
}

function unit(value) {
  return {
    unitId: hash(value && value.unitId), purpose: token(value && value.purpose),
    capability: token(value && value.capability), subject: subject(value && value.subject),
    temporalCandidate: temporal(value && value.temporalCandidate), confidenceBand: token(value && value.confidenceBand),
    evidenceRefs: evidence(value && value.evidenceRefs),
    slotCandidates: list(value && value.slotCandidates, (slot) => ({
      slot: token(slot && slot.slot),
      value: Number.isInteger(slot && slot.value) ? slot.value : token(slot && slot.value),
      evidenceRefs: evidence(slot && slot.evidenceRefs)
    }), 20),
    safetyCandidate: value && value.safetyCandidate ? {
      operatorActionClass: token(value.safetyCandidate.operatorActionClass),
      riskClass: token(value.safetyCandidate.riskClass)
    } : null
  };
}

function failure(value) {
  return value && typeof value === "object" ? {
    layer: token(value.layer || value.boundary), failureCode: token(value.failureCode || value.code),
    errors: list(value.errors || value.validationErrors, token)
  } : null;
}

function canonical(value) {
  const request = value && (value.canonicalRequest || value);
  return request && typeof request === "object" ? {
    taskId: hash(request.taskId), capability: token(request.capability),
    subject: subject(request.subject || request.canonicalEntity || request.entity),
    canonicalSet: list(request.canonicalSet || request.entity && request.entity.canonicalSet, token),
    temporal: temporal(request.temporal || request.temporalState || request.stay),
    requiredFields: list(request.requiredFields, token), missingFields: list(request.missingFields, token),
    resolverId: token(request.resolverId), detailIntent: token(request.detailIntent)
  } : null;
}

function outcome(value) {
  return {
    taskId: hash(value && value.taskId), type: token(value && value.type),
    outcome: token(value && (value.outcome || value.status)), reason: token(value && value.reason),
    factSource: token(value && value.facts && value.facts.source),
    factIdentity: token(value && value.facts && (value.facts.factIdentity || value.facts.canonicalId)),
    propertyId: token(value && value.facts && (value.facts.propertyId || value.facts.customerId))
  };
}

function resolverRequest(value) {
  return {
    formalRequestId: hash(value && value.formalRequestId), taskId: hash(value && value.taskId),
    capability: token(value && value.capability), operation: token(value && value.operation),
    propertyId: token(value && value.propertyId), subject: subject(value && (value.subject || value.entity)),
    temporal: temporal(value && (value.temporal || value.stay || value.query)),
    roomTypeSet: list(value && (value.roomTypeSet || value.query && value.query.roomTypeSet), token, 40)
  };
}

function rejectedEvidence(value) {
  if (!value || typeof value !== "object") return null;
  return {
    fieldPath: token(value.fieldPath),
    validationReason: token(value.validationReason),
    rejectedUnitIndex: Number.isInteger(value.rejectedUnitIndex) ? value.rejectedUnitIndex : null,
    semantic: value.semantic ? {
      purpose: token(value.semantic.purpose), capability: token(value.semantic.capability),
      subject: subject(value.semantic.subject), confidenceBand: token(value.semantic.confidenceBand)
    } : null,
    temporalCandidate: value.temporalCandidate ? {
      rawText: diagnosticText(value.temporalCandidate.rawText), kind: token(value.temporalCandidate.kind),
      checkInCandidate: token(value.temporalCandidate.checkInCandidate),
      checkOutCandidate: token(value.temporalCandidate.checkOutCandidate),
      nightsCandidate: Number.isInteger(value.temporalCandidate.nightsCandidate) ? value.temporalCandidate.nightsCandidate : null
    } : null,
    evidenceRefs: list(value.evidenceRefs, (reference) => ({
      eventRef: hash(reference && reference.eventId), messageRef: hash(reference && reference.messageRef),
      startOffset: Number.isInteger(reference && reference.startOffset) ? reference.startOffset : null,
      endOffset: Number.isInteger(reference && reference.endOffset) ? reference.endOffset : null,
      quote: diagnosticText(reference && reference.quote),
      sourceExcerpt: diagnosticText(reference && reference.sourceExcerpt),
      quoteMatchesSource: Boolean(reference && reference.quoteMatchesSource)
    }), 20),
    rawTextInSource: Boolean(value.rawTextInSource),
    rawTextInEvidenceQuote: Boolean(value.rawTextInEvidenceQuote)
  };
}

function formatNewCoreProductionTrace(details = {}) {
  const stage = token(details.stage);
  if (!STAGES.has(stage)) return null;
  const base = { scope: "new-core-production", traceId: token(details.traceId), stage };
  if (stage === "line_inbound") return { ...base, propertyId: token(details.propertyId), channelHash: hash(details.channelHash), userHash: hash(details.userHash), eventHash: hash(details.eventHash) };
  if (stage === "state_before") return { ...base, state: state(details.state), referenceableCycles: list(details.snapshot && details.snapshot.referenceableCycles, cycle, 20) };
  if (stage === "state_after") return { ...base, state: state(details.state) };
  if (stage === "new_core_c01") {
    const input = details.input || {};
    return { ...base, propertyId: token(input.propertyScope && input.propertyScope.propertyId),
      capabilityCatalog: list(input.capabilityCatalog, token, 100),
      publicSubjectCatalog: list(input.publicSubjectCatalog, (item) => ({ catalogIdentity: token(item && item.catalogIdentity), kind: token(item && item.kind) }), 100),
      sourceEvents: list(input.sourceEvents, (item) => ({ eventRef: hash(item && item.eventId), messageRef: hash(item && item.messageRef), timestamp: token(item && item.timestamp), messageKind: token(item && item.messageKind) }), 20),
      recentConversation: list(input.recentConversation, (item) => ({ eventRef: hash(item && item.eventId), messageRef: hash(item && item.messageRef), referenceableCycleIds: list(item && item.referenceableCycleIds, hash, 20) }), 20),
      referenceableCycles: list(input.referenceableCycles, cycle, 20) };
  }
  if (stage === "new_core_understanding") return { ...base,
    rawUnits: list(details.rawUnits, unit, 20),
    rawContextLinks: list(details.rawContextLinks, (link) => ({ unitId: hash(link && link.unitId), relationKind: token(link && link.relationKind), currentSourceEvidenceRefs: evidence(link && link.currentSourceEvidenceRefs), referencedHistoryEventRefs: evidence(link && link.referencedHistoryEventRefs) }), 20),
    validatedUnits: list(details.validatedUnits, unit, 20),
    failedUnits: list(details.failedUnits, failure, 20),
    contextLinks: list(details.contextLinks, (link) => ({ unitId: hash(link && link.unitId), relationKind: token(link && link.relationKind), currentSourceEvidenceRefs: evidence(link && link.currentSourceEvidenceRefs), referencedHistoryEventRefs: evidence(link && link.referencedHistoryEventRefs) }), 20) };
  if (stage === "new_core_c03") return { ...base, items: list(details.items, (item) => ({ status: token(item.status), unit: unit(item.unit), failureCode: token(item.failureCode), validationErrors: list(item.validationErrors, token, 40), valueOriginFunction: token(item.valueOriginFunction) }), 20) };
  if (stage === "new_core_context_filter") return { ...base, items: list(details.items, (item) => ({ status: token(item.status), unit: unit(item.unit),
    relationKind: token(item.linkCandidate && item.linkCandidate.relationKind),
    referencedHistoryEventRefs: evidence(item.linkCandidate && item.linkCandidate.referencedHistoryEventRefs),
    referenceableCycles: list(item.referenceableCycles, cycle, 20), failureCode: token(item.failureCode),
    validationErrors: list(item.validationErrors, token, 40), valueOriginFunction: token(item.valueOriginFunction),
    targetFilterResult: list(item.filterDiagnostic && item.filterDiagnostic.targetFilterResult, (candidate) => ({ requestCycleId: hash(candidate.requestCycleId), historyBound: Boolean(candidate.historyBound), statusAllowed: Boolean(candidate.statusAllowed), notExpired: Boolean(candidate.notExpired), identityCompatible: Boolean(candidate.identityCompatible), selected: Boolean(candidate.selected) }), 20), result: item.result ? {
      relationKind: token(item.result.relationKind), resolvedTargetRequestCycleId: hash(item.result.resolvedTargetRequestCycleId),
      compatibleExistingTargetIds: list(item.result.compatibleExistingTargetIds, hash, 20),
      compatiblePendingTargetIds: list(item.result.compatiblePendingTargetIds, hash, 20)
    } : null }), 20) };
  if (stage === "new_core_context") return { ...base,
    candidates: list(details.candidates, (item) => ({ unitId: hash(item && item.unitId), relationKind: token(item && item.relationKind), resolvedTargetRequestCycleId: hash(item && item.resolvedTargetRequestCycleId), compatibleExistingTargetIds: list(item && item.compatibleExistingTargetIds, hash, 20), compatiblePendingTargetIds: list(item && item.compatiblePendingTargetIds, hash, 20) }), 20),
    taskCreations: list(details.adapted && details.adapted.taskCreations, (item) => ({ taskId: hash(item && item.taskIdCandidate), action: token(item && item.action) }), 20),
    lifecycleOperations: list(details.adapted && details.adapted.lifecycleOperations, (item) => ({ requestCycleId: hash(item && item.requestCycleId), operation: token(item && item.operation) }), 20) };
  if (stage === "new_core_c07") return { ...base, outcomes: list(details.outcomes, (item) => ({ unitId: hash(item && item.unitId), lifecycleAction: token(item && item.lifecycle && item.lifecycle.action), targetRequestCycleId: hash(item && item.lifecycle && item.lifecycle.targetRequestCycleId), readinessStatus: token(item && item.readiness && item.readiness.status), missingGuestFields: list(item && item.readiness && item.readiness.missingGuestFields, token), disposition: token(item && item.routing && item.routing.disposition), failure: failure(item && item.failure) }), 20) };
  if (stage === "new_core_c08") return { ...base, items: list(details.items, (item) => ({ unitId: hash(item && item.unitId), input: canonical(item && item.input), output: canonical(item && item.result && item.result.value), failure: failure(item && item.failure ? item.failure : item && item.result && !item.result.ok ? item.result : null) }), 20) };
  if (stage === "new_core_canonical_request") return { ...base, canonicalRequests: list(details.items, canonical, 20), formalRequests: list(details.formalRequests, canonical, 20) };
  if (stage === "new_core_resolver") return { ...base, requests: list(details.requests, resolverRequest, 20), formalRequests: list(details.formalRequests, canonical, 20), results: list(details.results, outcome, 20) };
  if (stage === "new_core_final") return { ...base,
    earliestFailure: failure(details.earliestFailure),
    finalDecision: details.finalDecision ? { action: token(details.finalDecision.action), reasonCode: token(details.finalDecision.reasonCode), taskIds: list(details.finalDecision.taskIds, hash, 20), missingFields: list(details.finalDecision.missingFields, token), reviewRequired: Boolean(details.finalDecision.reviewRequired) } : null,
    finalResponse: details.finalResponse ? { action: token(details.finalResponse.action), shouldReply: Boolean(details.finalResponse.shouldReply), replyLength: String(details.finalResponse.replyText || "").length, replySha256: hash(details.finalResponse.replyText) } : null };
  if (stage === "new_core_failure") return { ...base, failureCode: token(details.failureCode), validationErrors: list(details.validationErrors, token, 40), schemaViolation: details.schemaViolation ? { validationErrorCode: token(details.schemaViolation.validationErrorCode), fieldPath: token(details.schemaViolation.fieldPath), expected: token(details.schemaViolation.expected), actual: token(details.schemaViolation.actual) } : null, rejectedEvidence: rejectedEvidence(details.rejectedEvidence), valueOriginFunction: token(details.valueOriginFunction) };
  return null;
}

module.exports = { formatNewCoreProductionTrace };
