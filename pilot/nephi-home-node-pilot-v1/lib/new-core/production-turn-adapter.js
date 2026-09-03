"use strict";

const crypto = require("node:crypto");

const { readConversationStateV3 } = require("../conversation-contracts/conversation-state-v3");
const { buildFinalDecision } = require("../conversation-engine-v2/final-decision");
const { buildFinalResponse } = require("../conversation-engine-v2/final-response-renderer");
const { executeNewCoreTurn, turnStateSnapshot } = require("./application-service");

const HISTORY_LIMIT = 20;

function text(value) {
  return String(value || "").trim();
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
      let previous = null;
      try {
        previous = readConversationStateV3(getConversationState(propertyId, channel, userId), scope, timestamp);
        const snapshot = turnStateSnapshot(previous, scope, timestamp);
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
        });
        setConversationState(propertyId, channel, userId, result.state);
        return {
          ...result,
          taskResults: coordinatorTaskResults(result),
          requestCycleRefs: requestCycleRefsForResult(result)
        };
      } catch (error) {
        return runtimeFailureResult(error, previous, traceId);
      }
    }
  });
}

module.exports = {
  bindProductionHistoryToCycles,
  createNewCoreProductionTurnAdapter,
  requestCycleRefsForResult
};
