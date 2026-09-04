"use strict";

const crypto = require("node:crypto");

const STAGES = new Set([
  "line_inbound", "state_before", "new_core_c01", "new_core_understanding",
  "new_core_c03", "new_core_context_filter", "new_core_context", "new_core_c07", "new_core_c08", "new_core_canonical_request",
  "new_core_resolver", "new_core_final", "state_after", "new_core_failure", "line_transport"
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
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu, "[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED]")
    .replace(/(?:\+?886[- ]?|0)9\d{2}[- ]?\d{3}[- ]?\d{3}/gu, "[REDACTED]");
}

function list(value, mapper, limit = 40) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map((item) => mapper(item)).filter(Boolean);
}

function evidence(value) {
  return list(value, (ref) => ({
    eventRef: hash(ref && (ref.eventRef || ref.eventId)),
    messageRef: hash(ref && ref.messageRef),
    startOffset: Number.isInteger(ref && ref.startOffset) ? ref.startOffset : null,
    endOffset: Number.isInteger(ref && ref.endOffset) ? ref.endOffset : null,
    quote: diagnosticText(ref && ref.quote),
    sourceExcerpt: diagnosticText(ref && ref.sourceExcerpt)
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
      subject: subject(task && task.subject),
      values: task && task.values ? {
        productType: token(task.values.productType), productId: token(task.values.productId),
        roomTypeId: token(task.values.roomTypeId), bundleId: token(task.values.bundleId),
        checkIn: token(task.values.checkIn), checkOut: token(task.values.checkOut),
        guestCount: Number.isInteger(task.values.guestCount) ? task.values.guestCount : null,
        searchFrom: token(task.values.searchFrom), searchTo: token(task.values.searchTo)
      } : null
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

function c08SourceItem(value) {
  return value && typeof value === "object" ? {
    capability: token(value.capability),
    subject: subject(value.subject),
    temporal: temporal(value.temporalCandidate),
    canonicalSet: list(value.canonicalSet, token),
    verifiedSlotInputs: list(value.verifiedSlotInputs, (slot) => ({
      slot: token(slot && slot.slot), operation: token(slot && slot.operation),
      value: Number.isInteger(slot && slot.value) ? slot.value : hash(slot && slot.value)
    }), 20)
  } : null;
}

function c08Validation(value) {
  const errors = list(value && value.errors, (error) => token(error), 40);
  const failedPredicate = errors[0] || "";
  const semanticValidationErrors = list(value && value.diagnostic && value.diagnostic.semanticValidationErrors, (error) => token(error), 40);
  const slotValidationErrors = list(value && value.diagnostic && value.diagnostic.slotValidationErrors, (error) => token(error), 40);
  return value && typeof value === "object" ? {
    semanticFields: !errors.includes("semanticFields"),
    verifiedSlotInputs: !errors.includes("verifiedSlotInputs"),
    provenance: !errors.includes("provenance"),
    catalogProvenance: !errors.includes("catalogProvenance"),
    validationErrors: errors,
    failedPredicate,
    fieldPath: semanticValidationErrors[0] || slotValidationErrors[0] || failedPredicate,
    semanticValidationErrors,
    slotValidationErrors,
    failureCode: token(value.code || value.failureCode)
  } : null;
}

function canonicalSubject(value) {
  return value && typeof value === "object" ? {
    status: token(value.status), category: token(value.category),
    canonicalId: token(value.canonicalId), canonicalSet: list(value.canonicalSet, token, 40)
  } : null;
}

function compatibilityMapping(value) {
  if (!value || typeof value !== "object") return null;
  const approved = value.approvedProduct || {};
  const mappedTemporal = value.temporal || {};
  const stay = mappedTemporal.stayCandidate || {};
  return {
    contextAvailable: Boolean(value.context && value.context.ok),
    entity: value.entity ? {
      category: token(value.entity.category), canonicalCandidate: token(value.entity.canonicalCandidate),
      confidence: Number.isFinite(value.entity.confidence) ? value.entity.confidence : null
    } : null,
    approvedProduct: {
      productType: token(approved.productType), productId: token(approved.productId),
      roomTypeId: token(approved.roomTypeId), bundleId: token(approved.bundleId)
    },
    sourceEvents: list(value.sources, (source) => ({
      eventRef: hash(source && source.eventId), messageRef: hash(source && source.messageRef),
      timestamp: token(source && source.timestamp), messageExcerpt: diagnosticText(source && source.messageText)
    }), 20),
    temporal: value.temporal ? {
      eventTimestamp: token(mappedTemporal.eventTimestamp),
      kind: token(stay.dateExpression && stay.dateExpression.kind),
      rawText: diagnosticText(stay.dateExpression && stay.dateExpression.rawText),
      checkIn: token(stay.checkInCandidate), checkOut: token(stay.checkOutCandidate),
      nights: Number.isInteger(stay.nightsCandidate) ? stay.nightsCandidate : null
    } : null,
    guestOperation: value.guestOperation ? {
      slot: token(value.guestOperation.slot), operation: token(value.guestOperation.operation),
      value: Number.isInteger(value.guestOperation.value) ? value.guestOperation.value : hash(value.guestOperation.value)
    } : null
  };
}

function c08Execution(value) {
  return value && typeof value === "object" ? {
    compatibilityMapping: compatibilityMapping(value.compatibilityMapping),
    canonicalizerCalled: Boolean(value.canonicalizerCalled),
    canonicalizerResult: canonical(value.canonicalizerResult),
    canonicalSubject: canonicalSubject(value.canonicalSubject),
    canonicalSet: list(value.canonicalSet, token, 40),
    requiredFields: list(value.requiredFields, token, 40), missingFields: list(value.missingFields, token, 40),
    errors: list(value.errors, token, 40), failureCode: token(value.failureCode),
    exactCondition: token(value.exactCondition), valueOriginFunction: token(value.valueOriginFunction || "executeCanonicalizerInputItem")
  } : null;
}

function inventory(value) {
  return value && typeof value === "object" ? {
    mode: token(value.mode), entityId: token(value.entityId), entityIds: list(value.entityIds, token, 40)
  } : null;
}

function resolverTask(value) {
  return value && typeof value === "object" ? {
    propertyId: token(value.propertyId), taskType: token(value.taskType),
    productType: token(value.productType), productId: token(value.productId),
    checkIn: token(value.checkIn), checkOut: token(value.checkOut),
    guestCount: Number.isInteger(value.guestCount) ? value.guestCount : null,
    searchFrom: token(value.searchFrom), searchTo: token(value.searchTo),
    nights: Number.isInteger(value.nights) ? value.nights : null,
    roomTypeSet: list(value.roomTypeSet, token, 40)
  } : null;
}

function safePrice(value) {
  return value && typeof value === "object" ? {
    canonicalId: token(value.canonicalId || value.productId || value.roomTypeId || value.bundleId),
    price: Number.isFinite(value.price) ? value.price : null,
    nightlyPrice: Number.isFinite(value.nightlyPrice) ? value.nightlyPrice : null,
    totalPrice: Number.isFinite(value.totalPrice) ? value.totalPrice : null
  } : null;
}

function outcomeFacts(value) {
  const facts = value && value.facts || {};
  return {
    source: token(facts.source), propertyId: token(facts.propertyId || facts.customerId),
    availability: token(facts.availability), checkIn: token(facts.checkIn), checkOut: token(facts.checkOut),
    availableRoomIds: list(facts.availableRoomIds, token, 40),
    availableBundleIds: list(facts.availableBundleIds, token, 40),
    availableDates: list(facts.availableDates, token, 40),
    prices: list(facts.prices, safePrice, 40)
  };
}

function outcome(value) {
  return {
    taskId: hash(value && value.taskId), type: token(value && value.type),
    outcome: token(value && (value.outcome || value.status)), reason: token(value && value.reason),
    factSource: token(value && value.facts && value.facts.source),
    factIdentity: token(value && value.facts && (value.facts.factIdentity || value.facts.canonicalId)),
    propertyId: token(value && value.facts && (value.facts.propertyId || value.facts.customerId)),
    resolverAttempted: Boolean(value && value.resolverAttempted), facts: outcomeFacts(value)
  };
}

function resolverRequest(value) {
  return {
    formalRequestId: hash(value && value.formalRequestId), taskId: hash(value && value.taskId),
    capability: token(value && value.capability), operation: token(value && value.operation),
    propertyId: token(value && value.propertyId), subject: subject(value && (value.subject || value.entity)),
    temporal: temporal(value && (value.temporal || value.stay || value.query || value.conditions && value.conditions.stay)),
    roomTypeSet: list(value && (value.roomTypeSet || value.query && value.query.roomTypeSet || value.resolverTask && value.resolverTask.roomTypeSet), token, 40),
    resolverTask: resolverTask(value && value.resolverTask),
    inventory: inventory(value && value.conditions && value.conditions.inventory),
    canonicalEntity: canonicalSubject(value && value.entity)
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
  if (stage === "line_inbound") return { ...base, propertyId: token(details.propertyId), channelHash: hash(details.channelHash), userHash: hash(details.userHash), eventHash: hash(details.eventHash), guestMessage: diagnosticText(details.guestMessage, 5000) };
  if (stage === "state_before") return { ...base, state: state(details.state), referenceableCycles: list(details.snapshot && details.snapshot.referenceableCycles, cycle, 20) };
  if (stage === "state_after") return { ...base, state: state(details.state) };
  if (stage === "new_core_c01") {
    const input = details.input || {};
    return { ...base, propertyId: token(input.propertyScope && input.propertyScope.propertyId),
      capabilityCatalog: list(input.capabilityCatalog, token, 100),
      publicSubjectCatalog: list(input.publicSubjectCatalog, (item) => ({ catalogIdentity: token(item && item.catalogIdentity), kind: token(item && item.kind) }), 100),
      sourceEvents: list(input.sourceEvents, (item) => ({ eventRef: hash(item && item.eventId), messageRef: hash(item && item.messageRef), timestamp: token(item && item.timestamp), messageKind: token(item && item.messageKind), messageExcerpt: diagnosticText(item && item.messageText, 5000) }), 20),
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
  if (stage === "new_core_c08") return { ...base, items: list(details.items, (item) => ({
    unitId: hash(item && item.unitId), sourceItem: c08SourceItem(item && item.sourceItem),
    validation: c08Validation(item && item.creationResult), input: canonical(item && item.input),
    output: canonical(item && item.result && item.result.value),
    execution: c08Execution(item && item.executionDiagnostic),
    failure: failure(item && item.failure ? item.failure : item && item.result && !item.result.ok ? item.result : null)
  }), 20) };
  if (stage === "new_core_canonical_request") return { ...base, canonicalRequests: list(details.items, canonical, 20), formalRequests: list(details.formalRequests, canonical, 20) };
  if (stage === "new_core_resolver") return { ...base, requests: list(details.requests, resolverRequest, 20), formalRequests: list(details.formalRequests, canonical, 20), results: list(details.results, outcome, 20) };
  if (stage === "new_core_final") return { ...base,
    earliestFailure: failure(details.earliestFailure),
    finalDecision: details.finalDecision ? { action: token(details.finalDecision.action), reasonCode: token(details.finalDecision.reasonCode), taskIds: list(details.finalDecision.taskIds, hash, 20), missingFields: list(details.finalDecision.missingFields, token), reviewRequired: Boolean(details.finalDecision.reviewRequired) } : null,
    finalResponse: details.finalResponse ? { action: token(details.finalResponse.action), shouldReply: Boolean(details.finalResponse.shouldReply), replyLength: String(details.finalResponse.replyText || "").length, replySha256: hash(details.finalResponse.replyText), replyText: diagnosticText(details.finalResponse.replyText, 5000) } : null };
  if (stage === "new_core_failure") return { ...base, failureCode: token(details.failureCode), validationErrors: list(details.validationErrors, token, 40), schemaViolation: details.schemaViolation ? { validationErrorCode: token(details.schemaViolation.validationErrorCode), fieldPath: token(details.schemaViolation.fieldPath), expected: token(details.schemaViolation.expected), actual: token(details.schemaViolation.actual) } : null, rejectedEvidence: rejectedEvidence(details.rejectedEvidence), valueOriginFunction: token(details.valueOriginFunction) };
  if (stage === "line_transport") return { ...base, propertyId: token(details.propertyId), decision: token(details.decision), reasonCode: token(details.reasonCode), attempted: Boolean(details.attempted), delivered: Boolean(details.delivered), deliveryErrorCode: token(details.deliveryErrorCode), replyText: diagnosticText(details.replyText, 5000) };
  return null;
}

module.exports = { formatNewCoreProductionTrace };
