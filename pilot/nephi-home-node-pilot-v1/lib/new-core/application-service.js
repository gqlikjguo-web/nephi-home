"use strict";

const { CAPABILITY_REGISTRY } = require("../conversation-engine-v2/capability-registry");
const { buildPropertyCatalog } = require("../conversation-engine-v2/property-catalog");
const { buildContextSnapshotV3, executionConditionsV3, reduceConversationStateV3 } = require("../conversation-engine-v2/conversation-state-v3-reducer");
const { buildCanonicalFormalRequest, buildCanonicalQueryPlan, resultForNotReady } = require("../conversation-engine-v2/formal-request");
const { executeCanonicalQueryPlans } = require("../conversation-engine-v2/capability-executor");
const { buildResponsePlan } = require("../conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../conversation-engine-v2/controlled-composer");
const { validateClaims } = require("../conversation-engine-v2/claim-validator");
const { buildFinalDecision } = require("../conversation-engine-v2/final-decision");
const { buildFinalResponse } = require("../conversation-engine-v2/final-response-renderer");
const { applyControlledReplyRules } = require("../custom-reply-rules");
const {
  buildC01PublicCatalog,
  buildC01TrustedCanonicalizerCatalog,
  buildUnderstandingTurnInput,
  buildPublicCatalogIdentityProjection,
  catalogCategoryToSubjectKind
} = require("./turn-input-adapter");
const { contextRelationEvidenceForValidatedLink } = require("./context-link-validator");
const { projectCapabilityRegistry } = require("./semantic-unit-validator");
const { createLifecycleDecision } = require("./lifecycle-manager");
const { createUnitReplyRoutingRegistry, createUnitReadiness, createTrustedOperatorSafetyPolicy, createUnitRoutingDecision } = require("./unit-reply-router");
const { createCanonicalizerInputItem, executeCanonicalizerInputItem } = require("./canonical-execution-adapter");
const { aggregateUnitOutcomes } = require("./unit-aggregator");
const { adaptLifecycleDecisionsToStateV3 } = require("./state-v3-lifecycle-adapter");
const { callOpenAIUnderstandingV1, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC } = require("../providers/openai-understanding-v1");
const { NEW_CORE_OPENAI_MODEL } = require("./openai-model-authority");
const { publicAvailabilityUrlForProperty } = require("../public-property-routing");

const HANDOFF_CAPABILITIES = new Set(["booking_operator_request", "high_risk"]);

function normalizeFailureRefs(values = []) {
  const refs = values
    .filter((item, index) => (
      item && typeof item.unitId === "string" && item.unitId.length > 0 && item.unitId.length <= 160
      && typeof item.failureCode === "string" && item.failureCode.length > 0 && item.failureCode.length <= 160
      && values.findIndex((candidate) => candidate && candidate.unitId === item.unitId) === index
    ))
    .map((item) => ({ unitId: item.unitId, failureCode: item.failureCode }));
  refs.forEach(Object.freeze);
  return Object.freeze(refs);
}

function buildPublicCatalog(property, catalog) {
  return buildC01PublicCatalog(property, catalog, Object.keys(CAPABILITY_REGISTRY));
}

function turnStateSnapshot(state, scope, now) {
  const context = buildContextSnapshotV3(state, { ...scope, now });
  const tasks = new Map((state.tasks || []).map((task) => [task.taskId, task]));
  return { scope, referenceableCycles: context.cycles.slice(-5).map((cycle) => {
    const task = tasks.get(cycle.requestCycleId);
    const topic = cycle.confirmedInputs.topic;
    const inventory = cycle.confirmedInputs.inventory;
    const requestKind = cycle.requestKind;
    const definition = CAPABILITY_REGISTRY[requestKind];
    const capability = requestKind === "pricing" ? "price"
      : requestKind === "location" ? "property_fact"
        : definition && definition.acceptedCandidateTypes.includes(requestKind)
          ? requestKind
          : definition && definition.acceptedCandidateTypes[0];
    const subjectKind = catalogCategoryToSubjectKind(topic.category)
      || (inventory.mode === "any" ? "property" : null);
    return {
      requestCycleId: cycle.requestCycleId,
      requestKind,
      capability,
      status: cycle.status === "needs_clarification" ? "pending" : cycle.status,
      expiresAt: cycle.contextReuseExpiresAt,
      subject: { kind: subjectKind, catalogIdentity: topic.canonicalId || inventory.entityId || null },
      missingFields: [...new Set(task && task.missingFields || [])],
      confirmedValues: {
        checkIn: cycle.confirmedInputs.stay.checkIn,
        checkOut: cycle.confirmedInputs.stay.checkOut,
        guestCount: cycle.confirmedInputs.stay.guests,
        searchFrom: cycle.confirmedInputs.stay.searchRange && cycle.confirmedInputs.stay.searchRange.from || null,
        searchTo: cycle.confirmedInputs.stay.searchRange && cycle.confirmedInputs.stay.searchRange.to || null
      },
      slotRefs: [...new Set(task && task.knownFields || [])]
    };
  }) };
}

function bindRecentConversationToCycles(history, state, referenceableCycles) {
  const allowed = new Set(referenceableCycles.map((cycle) => cycle.requestCycleId));
  const cycleIdsByTimestamp = new Map();
  for (const task of state.tasks || []) {
    if (!allowed.has(task.taskId)) continue;
    for (const timestamp of new Set([task.createdAt, task.updatedAt])) {
      const ids = cycleIdsByTimestamp.get(timestamp) || [];
      ids.push(task.taskId);
      cycleIdsByTimestamp.set(timestamp, ids);
    }
  }
  return history.map((turn) => ({
    eventId: turn.turnId,
    messageRef: turn.turnId,
    role: "guest",
    timestamp: turn.timestamp,
    messageKind: "text",
    messageText: turn.input,
    referenceableCycleIds: [...new Set(cycleIdsByTimestamp.get(turn.timestamp) || [])]
  }));
}

function taskResultForExecution(execution) {
  const base = { taskId: execution.taskId, type: execution.type, facts: execution.facts || {} };
  if (["answered", "no_availability"].includes(execution.outcome)) return { ...base, status: "answered" };
  if (execution.outcome === "not_ready") return { ...base, status: "needs_clarification", missingInputs: execution.missingFields || [] };
  return { ...base, status: "needs_human", reason: execution.reason || execution.outcome, review: true };
}

function routeAction(dispositions) {
  if (dispositions.includes("HANDOFF")) return "handoff";
  if (dispositions.includes("CLARIFY")) return "clarification";
  return dispositions.includes("ANSWER") ? "reply" : "no_reply";
}

function noExecutionDecision(outcomes, dispositions, missingFields, failedUnits = []) {
  const action = routeAction(dispositions);
  if (dispositions.length === 0 && failedUnits.length > 0) {
    return buildFinalDecision({ plannerFailure: failedUnits[0].failureCode });
  }
  if (action === "no_reply") return buildFinalDecision({ executionOutcomes: [], noReplyReason: "new_core_no_reply" });
  if (action === "handoff") return buildFinalDecision({ executionOutcomes: [{ taskId: "new-core-handoff", type: "human_help", outcome: "unknown", reason: "human_help" }] });
  if (action === "clarification") return buildFinalDecision({ executionOutcomes: [{ taskId: "new-core-clarify", type: "price", outcome: "not_ready", readinessStatus: "missing_information", missingFields }] });
  return buildFinalDecision({ executionOutcomes: outcomes });
}

async function executeNewCoreTurn({ input, state, property, resolver, providerConfig, publicBaseUrl, now, scope = state && state.scope, understandingProvider = callOpenAIUnderstandingV1, lifecycleDecisionIdPrefix = "new-core", onDiagnostic = null }) {
  if (!scope || !property || property.propertyId !== scope.propertyId) {
    const error = new Error("property_scope_invalid"); error.code = "PROPERTY_SCOPE_INVALID"; throw error;
  }
  const catalog = buildPropertyCatalog(property);
  const c01 = buildUnderstandingTurnInput({
    coreVersion: "new-core-v1", traceId: input.traceId, turnId: input.turnId,
    verifiedPropertyBinding: { propertyId: scope.propertyId, channel: scope.channel },
    verifiedConversationScope: { channel: scope.channel, userId: scope.userId },
    sourceEvents: input.sourceEvents || [{ eventId: input.turnId, messageRef: input.turnId, role: "guest", timestamp: now, messageKind: "text", messageText: input.message }],
    recentConversation: input.recentConversation,
    stateV3Snapshot: turnStateSnapshot(state, scope, now),
    publicCatalog: buildPublicCatalog(property, catalog)
  });
  const providerOperationalDiagnostics = [];
  const understanding = await understandingProvider(c01, {
    apiKey: providerConfig.apiKey,
    onDiagnostic,
    onOperationalDiagnostic: (entry) => { providerOperationalDiagnostics.push(entry); }
  });
  if (typeof onDiagnostic === "function") {
    for (const stage of ["new_core_c03", "new_core_context_filter"]) {
      try { onDiagnostic({ traceId: input.traceId, stage, items: providerOperationalDiagnostics.filter((entry) => entry.stage === stage) }); }
      catch { /* diagnostics must never affect execution */ }
    }
  }
  const registry = createUnitReplyRoutingRegistry(projectCapabilityRegistry(CAPABILITY_REGISTRY));
  const c08Catalog = buildC01TrustedCanonicalizerCatalog(c01, catalog);
  const projection = buildPublicCatalogIdentityProjection(c01);
  const outcomes = [];
  for (const [index, unit] of understanding.validatedUnits.entries()) {
    const link = understanding.validatedContextLinks.find((item) => item.unitId === unit.unitId);
    const lifecycle = createLifecycleDecision({ lifecycleDecisionId: `${lifecycleDecisionIdPrefix}-${input.turnId}-${index}`, unit, validatedContextLink: link });
    if (!lifecycle.ok) { outcomes.push({ unit, failure: { layer: "C06", failureCode: lifecycle.code } }); continue; }
    const readiness = createUnitReadiness({ unit, lifecycleDecision: lifecycle.value, routingRegistry: registry });
    if (!readiness.ok) { outcomes.push({ unit, lifecycleDecision: lifecycle.value, failure: { layer: "C07", failureCode: readiness.code } }); continue; }
    const safety = HANDOFF_CAPABILITIES.has(unit.capability) ? createTrustedOperatorSafetyPolicy({ unit, lifecycleDecision: lifecycle.value, routingRegistry: registry }) : null;
    const routing = createUnitRoutingDecision({ unit, lifecycleDecision: lifecycle.value, routingRegistry: registry, readiness: readiness.value, operatorSafetyPolicy: safety && safety.ok ? safety.value : null });
    if (!routing.ok) { outcomes.push({ unit, lifecycleDecision: lifecycle.value, readiness: readiness.value, failure: { layer: "C07", failureCode: routing.code } }); continue; }
    const c08 = routing.value.disposition === "ANSWER" ? createCanonicalizerInputItem({ unit, lifecycleDecision: lifecycle.value, routingDecision: routing.value, understandingTurnInput: c01, canonicalizerCatalog: c08Catalog, publicCatalogIdentityProjection: projection }) : { ok: true, value: null };
    outcomes.push({ unit, lifecycleDecision: lifecycle.value, readiness: readiness.value, routingDecision: routing.value, canonicalItem: c08.ok ? c08.value : null, failure: c08.ok ? null : { layer: "C08", failureCode: c08.code } });
  }
  const contextSnapshot = buildContextSnapshotV3(state, { ...scope, now });
  const canonicalItems = [];
  const successful = outcomes.filter((item) => item.routingDecision);
  for (const outcome of successful.filter((item) => item.canonicalItem)) {
    outcome.c08Input = outcome.canonicalItem;
    const result = executeCanonicalizerInputItem({ canonicalizerInputItem: outcome.canonicalItem, catalog: c08Catalog, publicCatalogIdentityProjection: projection, contextSnapshot });
    outcome.c08ExecutionResult = result;
    if (!result.ok) { outcome.canonicalItem = null; outcome.failure = { layer: "C08", failureCode: result.code }; continue; }
    outcome.canonicalItem = result.value;
    canonicalItems.push(result.value);
  }
  const failedUnits = normalizeFailureRefs([
    ...understanding.failedUnits,
    ...outcomes.filter((item) => item.failure).map((item) => ({ unitId: item.unit.unitId, failureCode: item.failure.failureCode }))
  ]);
  const aggregation = aggregateUnitOutcomes({ turnId: input.turnId, validatedUnits: successful.map((item) => item.unit), lifecycleDecisions: successful.map((item) => item.lifecycleDecision), routingDecisions: successful.map((item) => item.routingDecision), canonicalItems, failedUnits });
  if (!aggregation.ok) { const error = new Error(aggregation.code); error.code = aggregation.code; throw error; }
  const adapted = adaptLifecycleDecisionsToStateV3({ decisions: successful.map((item) => item.lifecycleDecision), aggregationResult: aggregation.value, previous: state });
  if (!adapted.ok) { const error = new Error(adapted.code); error.code = adapted.code; throw error; }
  const formalRequests = canonicalItems.map((item) => {
    const outcome = successful.find((candidate) => candidate.unit.unitId === item.unitId);
    return buildCanonicalFormalRequest({ property, canonicalRequest: item.canonicalRequest, requestCycleId: outcome.lifecycleDecision.targetRequestCycleId || outcome.unit.unitId, confirmedInputs: executionConditionsV3(state, item) });
  });
  const queryPlans = formalRequests.map(buildCanonicalQueryPlan).filter(Boolean);
  const routedClarifications = successful
    .filter((item) => item.routingDecision.disposition === "CLARIFY")
    .map((item) => ({
      taskId: item.unit.unitId,
      type: item.unit.capability,
      outcome: "not_ready",
      readinessStatus: "missing_information",
      missingFields: item.routingDecision.missingGuestFields
    }));
  const rawExecutionOutcomes = [
    ...routedClarifications,
    ...formalRequests.filter((item) => item.readiness.status !== "ready").map(resultForNotReady),
    ...executeCanonicalQueryPlans({ property, catalog, queryPlans, availabilityResolver: resolver.availability, availableDatesResolver: resolver.availableDates, priceOverrides: resolver.priceOverrides(), datePriceClassifications: resolver.dateClassifications() })
  ];
  const executionOutcomes = applyControlledReplyRules({ rules: resolver.customReplies(), property, canonicalItems, executionOutcomes: rawExecutionOutcomes, now });
  const taskResults = executionOutcomes.map(taskResultForExecution);
  const publicAvailabilityUrl = publicAvailabilityUrlForProperty(publicBaseUrl, property);
  const responsePlan = buildResponsePlan({ propertyId: scope.propertyId, taskResults, inputTaskIds: [...canonicalItems.map((item) => item.canonicalRequest.taskId), ...routedClarifications.map((item) => item.taskId)], canonicalRequests: canonicalItems.map((item) => item.canonicalRequest), reviewActions: [], publicAvailabilityUrl });
  const replyText = composeControlledReply(responsePlan);
  const claimValidation = validateClaims(replyText, responsePlan, canonicalItems.map((item) => item.canonicalRequest.taskId));
  const dispositions = successful.map((item) => item.routingDecision.disposition);
  const missingFields = successful.flatMap((item) => item.routingDecision.missingGuestFields);
  const finalDecision = executionOutcomes.length ? buildFinalDecision({ executionOutcomes, claimValidation }) : noExecutionDecision(executionOutcomes, dispositions, missingFields, failedUnits);
  const finalResponse = buildFinalResponse({ finalDecision, responsePlan, validatedReplyText: replyText, claimValidation, publicAvailabilityUrl });
  const nextState = reduceConversationStateV3({ previous: state, canonicalItems, formalRequests, executionOutcomes, clarificationTaskIds: finalDecision.action === "clarification" ? finalDecision.executionSummary.notReadyTaskIds : [], lifecycleOperations: adapted.value.lifecycleOperations, taskCreations: adapted.value.taskCreations, canonicalTaskBindings: adapted.value.canonicalTaskBindings, scope: { ...scope, now } });
  const provider = understanding[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC] || {};
  const earliestFailure = outcomes.find((item) => item.failure)?.failure || understanding.failedUnits[0] && { layer: understanding.failedUnits[0].boundary || "C03-C05", failureCode: understanding.failedUnits[0].failureCode } || null;
  const contextCandidates = understanding.validatedContextLinks.map((link) => {
    const unit = understanding.validatedUnits.find((candidate) => candidate.unitId === link.unitId);
    const relation = unit ? contextRelationEvidenceForValidatedLink(link, unit) : null;
    return { ...link, resolvedTargetRequestCycleId: relation && relation.resolvedTargetRequestCycleId };
  });
  return {
    state: nextState,
    understanding: { summary: understanding.validatedUnits.map((item) => `${item.purpose}/${item.capability}/${item.subject.kind}`).join("；"), units: understanding.validatedUnits.map((item) => ({ purpose: item.purpose, capability: item.capability, subject: item.subject, temporal: item.temporalCandidate, guestCount: item.slotCandidates.find((slot) => slot.slot === "guest_count")?.value || null })) },
    lifecycle: successful.map((item) => item.lifecycleDecision.action), routing: dispositions,
    resolver: { name: "existing canonical Resolver", foundOfficialData: executionOutcomes.some((item) => item.outcome === "answered"), status: executionOutcomes.map((item) => item.outcome).join(",") || "NOT_APPLICABLE" },
    finalDecision, finalResponse, earliestFailure,
    requestedModel: provider.requestedModel || NEW_CORE_OPENAI_MODEL,
    resolvedModel: provider.resolvedModel || "",
    artifacts: { understanding, outcomes, successful, c01, aggregation: aggregation.value, adapted: adapted.value, previousState: state, canonicalItems, formalRequests, queryPlans, executionOutcomes, contextCandidates }
  };
}

module.exports = {
  bindRecentConversationToCycles,
  buildPublicCatalog,
  executeNewCoreTurn,
  noExecutionDecision,
  normalizeFailureRefs,
  turnStateSnapshot
};
