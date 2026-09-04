"use strict";

const crypto = require("node:crypto");

const { readConversationStateV3 } = require("../conversation-contracts/conversation-state-v3");
const { buildFinalDecision } = require("../conversation-engine-v2/final-decision");
const { buildFinalResponse } = require("../conversation-engine-v2/final-response-renderer");
const { executeNewCoreTurn, turnStateSnapshot } = require("./application-service");
const { c08ExecutionDiagnosticFor } = require("./canonical-execution-adapter");

const HISTORY_LIMIT = 20;

function text(value) {
  return String(value || "").trim();
}

function hash(value) {
  return `h:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function emitDiagnostic(sink, entry) {
  if (typeof sink !== "function") return;
  try { sink(entry); } catch { /* diagnostics must never affect the turn */ }
}

function stateDiagnostic(state) {
  return {
    revision: Number(state && state.revision || 0),
    tasks: (state && Array.isArray(state.tasks) ? state.tasks : []).slice(0, 20).map((task) => ({
      taskId: hash(task && task.taskId),
      type: text(task && task.type),
      status: text(task && task.status),
      missingFields: uniqueText(task && task.missingFields),
      knownFields: uniqueText(task && task.knownFields),
      values: {
        productType: text(task && task.productType), productId: text(task && task.productId),
        roomTypeId: text(task && task.roomTypeId), bundleId: text(task && task.bundleId),
        checkIn: text(task && task.checkIn), checkOut: text(task && task.checkOut),
        guestCount: Number.isInteger(task && task.guestCount) ? task.guestCount : null,
        searchFrom: text(task && task.searchFrom), searchTo: text(task && task.searchTo)
      },
      subject: task && task.subject ? {
        kind: text(task.subject.kind),
        catalogIdentity: text(task.subject.catalogIdentity)
      } : null
    }))
  };
}

function evidenceDiagnostic(values) {
  return (Array.isArray(values) ? values : []).slice(0, 20);
}

function unitDiagnostic(unit) {
  return {
    unitId: hash(unit && unit.unitId),
    purpose: text(unit && unit.purpose),
    capability: text(unit && unit.capability),
    subject: unit && unit.subject ? {
      kind: text(unit.subject.kind),
      catalogIdentity: text(unit.subject.catalogIdentity)
    } : null,
    temporalCandidate: unit && unit.temporalCandidate || null,
    slotCandidates: (unit && Array.isArray(unit.slotCandidates) ? unit.slotCandidates : []).map((slot) => ({
      slot: text(slot.slot), value: slot.value, evidenceRefs: evidenceDiagnostic(slot.evidenceRefs)
    })),
    safetyCandidate: unit && unit.safetyCandidate || null,
    evidenceRefs: evidenceDiagnostic(unit && unit.evidenceRefs),
    confidenceBand: text(unit && unit.confidenceBand)
  };
}

function emitResultDiagnostics(sink, traceId, result) {
  const artifacts = result && result.artifacts || {};
  const understanding = artifacts.understanding || {};
  emitDiagnostic(sink, { traceId, stage: "new_core_c01", input: artifacts.c01 || null });
  emitDiagnostic(sink, { traceId, stage: "new_core_understanding",
    rawUnits: (understanding.understandingOutput && understanding.understandingOutput.units || []).map(unitDiagnostic),
    rawContextLinks: (understanding.contextLinkCandidates || []).map((link) => ({
      unitId: hash(link.unitId), relationKind: text(link.relationKind),
      currentSourceEvidenceRefs: evidenceDiagnostic(link.currentSourceEvidenceRefs),
      referencedHistoryEventRefs: evidenceDiagnostic(link.referencedHistoryEventRefs)
    })),
    validatedUnits: (understanding.validatedUnits || []).map(unitDiagnostic),
    failedUnits: understanding.failedUnits || [],
    contextLinks: (understanding.validatedContextLinks || []).map((link) => ({
      unitId: hash(link.unitId), relationKind: text(link.relationKind),
      currentSourceEvidenceRefs: evidenceDiagnostic(link.currentSourceEvidenceRefs),
      referencedHistoryEventRefs: evidenceDiagnostic(link.referencedHistoryEventRefs)
    })) });
  emitDiagnostic(sink, { traceId, stage: "new_core_context", candidates: artifacts.contextCandidates || [], adapted: artifacts.adapted || null });
  emitDiagnostic(sink, { traceId, stage: "new_core_c07", outcomes: (artifacts.outcomes || []).map((item) => ({
    unitId: hash(item && item.unit && item.unit.unitId),
    lifecycle: item && item.lifecycleDecision || null,
    readiness: item && item.readiness || null,
    routing: item && item.routingDecision || null,
    failure: item && item.failure || null
  })) });
  emitDiagnostic(sink, { traceId, stage: "new_core_c08", items: (artifacts.outcomes || []).map((item) => ({
    unitId: hash(item && item.unit && item.unit.unitId),
    sourceItem: item && item.unit ? {
      capability: item.unit.capability,
      subject: item.unit.subject,
      temporalCandidate: item.unit.temporalCandidate,
      verifiedSlotInputs: item.lifecycleDecision && item.lifecycleDecision.verifiedSlotOperations,
      canonicalSet: []
    } : null,
    creationResult: item && item.c08CreationResult || null,
    input: item && item.c08Input || null,
    result: item && item.c08ExecutionResult || null,
    executionDiagnostic: item && item.c08ExecutionResult
      ? c08ExecutionDiagnosticFor(item.c08ExecutionResult) : null,
    failure: item && item.failure || null
  })) });
  emitDiagnostic(sink, { traceId, stage: "new_core_canonical_request", items: artifacts.canonicalItems || [], formalRequests: artifacts.formalRequests || [] });
  emitDiagnostic(sink, { traceId, stage: "new_core_resolver", requests: artifacts.queryPlans || [], formalRequests: artifacts.formalRequests || [], results: artifacts.executionOutcomes || [] });
  emitDiagnostic(sink, { traceId, stage: "new_core_final", finalDecision: result.finalDecision, finalResponse: result.finalResponse, earliestFailure: result.earliestFailure || null });
  emitDiagnostic(sink, { traceId, stage: "state_after", state: stateDiagnostic(result.state) });
}

function uniqueText(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function timestampText(value, fallback = "") {
  const numeric = typeof value === "number" ? value : NaN;
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text(fallback);
}

function bindProductionHistoryToCycles(history = [], referenceableCycles = []) {
  const allowedCycles = new Set(referenceableCycles.map((cycle) => text(cycle && cycle.requestCycleId)).filter(Boolean));
  return (Array.isArray(history) ? history : [])
    .map((turn) => {
      const eventId = text(turn && (turn.eventId || turn.turnId));
      const messageText = text(turn && (turn.guestMessage || turn.input));
      const timestamp = timestampText(turn && (turn.eventTimestamp || turn.createdAt || turn.timestamp));
      if (!eventId || !messageText || !timestamp) return null;
      return {
        eventId,
        messageRef: eventId,
        role: "guest",
        timestamp,
        messageKind: "text",
        messageText,
        referenceableCycleIds: uniqueText(turn && turn.requestCycleRefs).filter((cycleId) => allowedCycles.has(cycleId))
      };
    })
    .filter(Boolean)
    .slice(-HISTORY_LIMIT);
}

function productionSourceEvents(input, timestamp) {
  const supplied = Array.isArray(input.sourceEvents) ? input.sourceEvents : [];
  const events = supplied.length ? supplied : [input];
  return events.map((event) => ({
    eventId: text(event.eventId || input.eventId),
    messageRef: text(event.messageRef || event.eventId || input.eventId),
    role: "guest",
    timestamp: timestampText(event.eventTimestamp || event.timestamp || input.eventTimestamp, timestamp),
    messageKind: "text",
    messageText: String(event.messageText === undefined ? input.messageText || "" : event.messageText)
  }));
}

function requiredFunction(value, name) {
  if (!value || typeof value[name] !== "function") throw new TypeError(`${name}_required`);
  return value[name].bind(value);
}

function safeFailureCode(error) {
  const code = text(error && error.code);
  return /^[A-Z][A-Z0-9_]{0,159}$/.test(code) ? code : "NEW_CORE_RUNTIME_FAILURE";
}

function runtimeFailureResult(error, state, traceId) {
  const finalDecision = buildFinalDecision({ plannerFailure: safeFailureCode(error) });
  const finalResponse = buildFinalResponse({
    finalDecision,
    responsePlan: null,
    validatedReplyText: "",
    claimValidation: null
  });
  return {
    state,
    finalDecision,
    finalResponse,
    taskResults: [],
    traceId,
    earliestFailure: { layer: "APPLICATION_SERVICE", failureCode: finalDecision.reasonCode }
  };
}

function coordinatorTaskResults(result) {
  const outcomes = result && result.artifacts && Array.isArray(result.artifacts.executionOutcomes)
    ? result.artifacts.executionOutcomes
    : [];
  return outcomes.map((item) => ({
    taskId: item.taskId,
    type: item.type,
    status: ["answered", "no_availability"].includes(item.outcome)
      ? "answered"
      : item.outcome === "not_ready" ? "needs_clarification" : "needs_human",
    facts: item.facts || {},
    ...(item.reason ? { reason: item.reason } : {})
  }));
}

function requestCycleRefsForResult(result) {
  const artifacts = result && result.artifacts || {};
  return uniqueText([
    ...(Array.isArray(artifacts.canonicalItems) ? artifacts.canonicalItems.map((item) => item && item.requestCycleId) : []),
    ...(artifacts.adapted && Array.isArray(artifacts.adapted.taskCreations)
      ? artifacts.adapted.taskCreations.map((item) => item && item.taskIdCandidate)
      : []),
    ...(artifacts.adapted && Array.isArray(artifacts.adapted.canonicalTaskBindings)
      ? artifacts.adapted.canonicalTaskBindings.map((item) => item && item.requestCycleId)
      : [])
  ]).slice(0, HISTORY_LIMIT);
}

function createNewCoreProductionTurnAdapter({
  persistence,
  customerSettings,
  service,
  customReplies,
  providerConfig,
  publicBaseUrl = "",
  now = () => new Date(),
  executeTurn,
  onDiagnostic,
  recentMessageLimit = 10
} = {}) {
  const getConversationState = requiredFunction(persistence, "getConversationState");
  const setConversationState = requiredFunction(persistence, "setConversationState");
  const getProperty = requiredFunction(customerSettings, "getProperty");
  const searchAvailability = requiredFunction(service, "searchAvailability");
  const searchAvailableDates = requiredFunction(service, "searchAvailableDates");
  const listPriceOverrides = requiredFunction(customerSettings, "listInventoryPriceOverrides");
  const listDateClassifications = requiredFunction(customerSettings, "listDatePriceClassifications");
  const listCustomReplies = requiredFunction(customReplies, "list");
  const turnExecutor = executeTurn === undefined ? executeNewCoreTurn : executeTurn;
  if (typeof turnExecutor !== "function") throw new TypeError("execute_turn_required");
  if (turnExecutor === executeNewCoreTurn && (!providerConfig || !text(providerConfig.apiKey))) {
    throw new TypeError("provider_api_key_required");
  }
  const historyLimit = Math.max(1, Math.min(HISTORY_LIMIT, Number(recentMessageLimit) || 10));

  return Object.freeze({
    async process(input = {}) {
      const propertyId = text(input.customerId);
      const channel = text(input.channelId);
      const userId = text(input.lineUserId);
      const eventId = text(input.eventId);
      if (!propertyId || !channel || !userId || !eventId) throw new TypeError("production_turn_scope_required");
      const property = getProperty(propertyId);
      if (!property || property.propertyId !== propertyId) {
        const error = new Error("property_not_found");
        error.code = "PROPERTY_NOT_FOUND";
        throw error;
      }
      const timestamp = now().toISOString();
      const scope = { propertyId, channel, userId };
      const traceId = crypto.randomUUID();
      emitDiagnostic(onDiagnostic, { traceId, stage: "line_inbound", propertyId,
        channelHash: hash(channel), userHash: hash(userId), eventHash: hash(eventId),
        guestMessage: String(input.messageText || "") });
      let previous = null;
      try {
        previous = readConversationStateV3(getConversationState(propertyId, channel, userId), scope, timestamp);
        const snapshot = turnStateSnapshot(previous, scope, timestamp);
        emitDiagnostic(onDiagnostic, { traceId, stage: "state_before", state: stateDiagnostic(previous), snapshot });
        let recentConversation = [];
        if (typeof persistence.listRecentMessages === "function") {
          const since = new Date(Date.parse(timestamp) - 24 * 60 * 60 * 1000).toISOString();
          recentConversation = bindProductionHistoryToCycles(
            persistence.listRecentMessages(propertyId, channel, userId, { limit: historyLimit, since }),
            snapshot.referenceableCycles
          ).slice(-historyLimit);
        }
        const result = await turnExecutor({
          input: {
            turnId: eventId,
            traceId,
            message: String(input.messageText || ""),
            sourceEvents: productionSourceEvents(input, timestamp),
            recentConversation
          },
          state: previous,
          property,
          resolver: {
            availability: (query) => searchAvailability({ ...query, customerId: propertyId }),
            availableDates: (query) => searchAvailableDates({ ...query, customerId: propertyId }),
            priceOverrides: () => listPriceOverrides(propertyId),
            dateClassifications: () => listDateClassifications(propertyId),
            customReplies: () => listCustomReplies(propertyId)
          },
          providerConfig,
          publicBaseUrl,
          now: timestamp,
          scope,
          lifecycleDecisionIdPrefix: "line"
          , onDiagnostic
        });
        emitResultDiagnostics(onDiagnostic, traceId, result);
        setConversationState(propertyId, channel, userId, result.state);
        return {
          ...result,
          traceId,
          taskResults: coordinatorTaskResults(result),
          requestCycleRefs: requestCycleRefsForResult(result)
        };
      } catch (error) {
        emitDiagnostic(onDiagnostic, { traceId, stage: "new_core_failure",
          failureCode: safeFailureCode(error), validationErrors: uniqueText(error && error.validationErrors),
          schemaViolation: error && error.schemaViolation || null,
          rejectedEvidence: error && error.rejectedEvidence || null,
          valueOriginFunction: text(error && error.valueOriginFunction) });
        const failed = runtimeFailureResult(error, previous, traceId);
        emitDiagnostic(onDiagnostic, { traceId, stage: "new_core_final", finalDecision: failed.finalDecision, finalResponse: failed.finalResponse, earliestFailure: failed.earliestFailure });
        emitDiagnostic(onDiagnostic, { traceId, stage: "state_after", state: stateDiagnostic(previous) });
        return failed;
      }
    }
  });
}

module.exports = {
  bindProductionHistoryToCycles,
  createNewCoreProductionTurnAdapter,
  requestCycleRefsForResult
};
