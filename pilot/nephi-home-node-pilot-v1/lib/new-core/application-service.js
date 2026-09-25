"use strict";
const { monotonicNow, emitPreparationLatency } = require("./understanding-latency");

const { CAPABILITY_REGISTRY } = require("../conversation-engine-v2/capability-registry");
const { buildPropertyCatalog } = require("../conversation-engine-v2/property-catalog");
const { buildContextSnapshotV3, executionConditionsV3, reduceConversationStateV3 } = require("../conversation-engine-v2/conversation-state-v3-reducer");
const { buildCanonicalFormalRequest, buildCanonicalQueryPlan, resultForNotReady } = require("../conversation-engine-v2/formal-request");
const {
  executeCanonicalQueryPlans,
  applyCanonicalReplyRules,
  canonicalExecutionProvenanceFor
} = require("../conversation-engine-v2/capability-executor");
const { buildResponsePlan } = require("../conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../conversation-engine-v2/controlled-composer");
const { validateClaims, unknownProvenanceFor, isValidatedFinalResponse } = require("../conversation-engine-v2/claim-validator");
const { buildFinalDecision, executionReplyDisposition } = require("../conversation-engine-v2/final-decision");
const { buildFinalResponse, assembleFinalResponse } = require("../conversation-engine-v2/final-response-renderer");
const {
  buildC01PublicCatalog,
  buildC01TrustedCanonicalizerCatalog,
  buildUnderstandingTurnInput,
  buildPublicCatalogIdentityProjection,
  catalogCategoryToSubjectKind
} = require("./turn-input-adapter");
const { contextRelationEvidenceForValidatedLink } = require("./context-link-validator");
const { projectCapabilityRegistry } = require("./semantic-unit-validator");
const { createLifecycleDecision, isValidatedLifecycleDecision, contextSourceForValidatedLifecycleDecision } = require("./lifecycle-manager");
const { createUnitReplyRoutingRegistry, createUnitReadiness, createTrustedOperatorSafetyPolicy, createUnitRoutingDecision, createPropertySuppressedNoReplyDecision } = require("./unit-reply-router");
const { createCanonicalizerInputItem, executeCanonicalizerInputItem } = require("./canonical-execution-adapter");
const { aggregateUnitOutcomes } = require("./unit-aggregator");
const { adaptLifecycleDecisionsToStateV3 } = require("./state-v3-lifecycle-adapter");
const { callOpenAIUnderstandingV1, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC } = require("../providers/openai-understanding-v1");
const { NEW_CORE_OPENAI_MODEL } = require("./openai-model-authority");
const { publicAvailabilityUrlForProperty } = require("../public-property-routing");

const { createTerminalContext } = require("./terminal-failure");

const HANDOFF_CAPABILITIES = new Set(["booking_operator_request", "high_risk"]);
const AVAILABILITY_AUTO_REPLY_POLICY_KEYS = Object.freeze(["availability", "available_dates"]);

function isAvailabilityAutoReplyCapability(capability) {
  const registry = projectCapabilityRegistry(CAPABILITY_REGISTRY);
  return AVAILABILITY_AUTO_REPLY_POLICY_KEYS.some((key) => key === capability
    || registry[key].registryCapabilities.includes(capability));
}

function availabilityAutoReplySuppressed(unit, property) {
  return property.availabilityAutoReplyEnabled === false && isAvailabilityAutoReplyCapability(unit && unit.capability);
}

function applyAvailabilityAutoReplyGate(unit, lifecycleDecision, routingDecision, property) {
  if (!routingDecision || property.availabilityAutoReplyEnabled !== false
    || !isAvailabilityAutoReplyCapability(unit && unit.capability)) return routingDecision;
  const suppressed = createPropertySuppressedNoReplyDecision({ unit, lifecycleDecision, routingDecision });
  if (!suppressed.ok) { const error = new Error(suppressed.code); error.code = suppressed.code; throw error; }
  return suppressed.value;
}

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
      // C01 describes Context lifecycle, not the State execution phase.
      status: cycle.status === "needs_clarification" ? "pending"
        : ["ready", "in_progress", "unknown"].includes(cycle.status) ? "active" : cycle.status,
      expiresAt: cycle.contextReuseExpiresAt,
      subject: { kind: subjectKind, catalogIdentity: topic.canonicalId || inventory.entityId || null },
      missingFields: [...new Set(task && task.missingFields || [])],
      confirmedValues: {
        ...require("../conversation-contracts/resolver-quantity").resolverQuantityFields(task || {}),
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

function taskResultForExecution(execution, evidence) {
  const base = { taskId: execution.taskId, type: execution.type, facts: execution.facts || {},
    outcomeStatus: execution.outcome, readinessStatus: execution.readinessStatus || null, outcomeReason: execution.reason || null,
    executionProvenance: require("../conversation-engine-v2/capability-executor").canonicalExecutionProvenanceFor(execution),
    operatorActionClass: execution.operatorActionClass || null, riskClass: execution.riskClass || null,
    ...(execution.requestedQuantity !== undefined ? {requestedQuantity:execution.requestedQuantity,distinctRequirement:execution.distinctRequirement,matchedUniqueIdentities:execution.matchedUniqueIdentities,matchedCount:execution.matchedCount,unresolvedRemainder:execution.unresolvedRemainder,fulfillmentStatus:execution.fulfillmentStatus} : {}) };
  if (evidence && executionReplyDisposition(execution, evidence) === "reply_unknown") {
    if (base.executionProvenance?.knownFacts) return { ...base, status: "answered", claimType: "FACTUAL_ANSWER",
      facts: base.executionProvenance.knownFacts };
    return { ...base, status: "answered", claimType: "EPISTEMIC_UNKNOWN",
      unknownProvenance: unknownProvenanceFor(execution), facts: { subject: base.facts.subject } };
  }
  if (["answered", "no_availability"].includes(execution.outcome)) return { ...base, status: "answered" };
  if (execution.outcome === "not_ready") return { ...base, status: "needs_clarification", missingInputs: execution.missingFields || [],
    ...(execution.clarificationRequired === true ? { clarificationRequired: true } : {}) };
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

function finalizeTurnResponse({ scope, turnId, property, terminalContext, requestEvidence = [], executionOutcomes = [], taskResults = [], canonicalItems = [], publicAvailabilityUrl = "", responsePrefix = "", maxLength = 1200 }) {
  const context = terminalContext || createTerminalContext({ propertyId: scope.propertyId, turnId });
  const permission = id => {
    const evidence = requestEvidence.find(item => item.taskId === id);
    return evidence?.replyPermission || (property.availabilityAutoReplyEnabled === false ? "UNDETERMINED" : "ALLOWED");
  };
  const allowed = id => permission(id) === "ALLOWED" && requestEvidence.find(item => item.taskId === id)?.requestPresence !== "ABSENT";
  const statusTask = failure => ({ taskId: failure.scopeRef, type: "unknown", status: "answered", claimType: "PROCESSING_STATUS", facts: {}, terminalFailure: failure });
  const applicableFailures = context.failures.filter(failure => allowed(failure.scopeRef));
  const replacements = new Map(applicableFailures.map(failure => [failure.scopeRef, statusTask(failure)]));
  const tasks = taskResults.filter(task => allowed(task.taskId)).map(task => {
    const evidence = requestEvidence.find(item => item.taskId === task.taskId);
    const execution = executionOutcomes.find(item => item.taskId === task.taskId);
    // A processing notice never cancels an independently established human responsibility.
    return replacements.has(task.taskId) && (!execution || executionReplyDisposition(execution, evidence) !== "handoff")
      ? replacements.get(task.taskId) : task;
  });
  for (const [id, task] of replacements) if (!tasks.some(item => item.taskId === id)) tasks.push(task);
  let responsePlan = buildResponsePlan({ propertyId: scope.propertyId, turnId, taskResults: tasks, inputTaskIds: tasks.map(item => item.taskId), canonicalRequests: canonicalItems.map(item => item.canonicalRequest), reviewActions: [], publicAvailabilityUrl, executionOutcomes, requestEvidence });
  responsePlan.maxLength = maxLength;
  let rebuildCount = 0, initialClaimValidation = null, claimValidation = null, finalDecision, finalResponse;
  // Exactly one deterministic rebuild; no model or business execution occurs here.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = composeControlledReply(responsePlan);
    claimValidation = validateClaims(text, responsePlan, responsePlan.sections.flatMap(section => section.coveredTaskIds || [section.taskId]));
    const processing = responsePlan.sections.filter(section => section.claimType === "PROCESSING_STATUS");
    finalDecision = buildFinalDecision({ executionOutcomes, requestEvidence, terminalResults: processing, noReplyReason: "new_core_no_reply",
      responseValidation: claimValidation, responseSections: responsePlan.sections, propertyId: scope.propertyId, turnId });
    if (finalDecision.action === "no_reply") {
      finalResponse = buildFinalResponse({ finalDecision, responsePlan, validatedReplyText: "", claimValidation });
      break;
    }
    if (claimValidation.ok) {
      const options = { finalDecision, responsePlan, validatedReplyText: text, claimValidation, publicAvailabilityUrl, responsePrefix };
      const draft = assembleFinalResponse(options);
      claimValidation = validateClaims(draft.replyText, responsePlan, responsePlan.sections.flatMap(section => section.coveredTaskIds || [section.taskId]), null, options);
      if (claimValidation.ok) {
        finalResponse = buildFinalResponse({ ...options, preparedResponse: draft, finalValidation: claimValidation });
        if (isValidatedFinalResponse(finalResponse)) break;
      }
    }
    if (!initialClaimValidation) initialClaimValidation = claimValidation;
    if (attempt === 1) {
      finalDecision = buildFinalDecision({ executionOutcomes, requestEvidence, terminalResults: processing, safetyBlocked: true });
      finalResponse = buildFinalResponse({ finalDecision, responsePlan, validatedReplyText: "", claimValidation });
      break;
    }
    rebuildCount = 1;
    const global = claimValidation.globalErrors.length > 0;
    const failed = new Set(claimValidation.sectionResults.filter(item => !item.ok).flatMap(item => item.scopeRefs));
    // Shared coverage and declared dependencies cannot be treated as independent sections.
    let changed = true;
    while (changed) {
      changed = false;
      for (const section of responsePlan.sections) {
        const ids = section.coveredTaskIds || [section.taskId];
        if ([...ids, ...(section.dependsOnScopeRefs || [])].some(id => failed.has(id))) {
          for (const id of ids) if (!failed.has(id)) { failed.add(id); changed = true; }
        }
      }
    }
    const safe = global ? [] : tasks.filter(task => !failed.has(task.taskId));
    const rejectedIds = global ? ["turn-failure"] : [...failed];
    const replacementSections = rejectedIds.filter(allowed).map(id => {
      // Dependencies may be invalidated by another rejected scope. Global validation records
      // cover the whole turn; local records only mint for their actually rejected scope.
      const sourceId = claimValidation.sectionResults.some(item => !item.ok && item.scopeRefs.includes(id)) ? id
        : claimValidation.sectionResults.find(item => !item.ok)?.scopeRefs[0];
      if (!global && sourceId !== id) return null;
      const failure = context.fromClaimValidation(claimValidation, id);
      return { ...statusTask(failure), responseMode: "answer", coveredTaskIds: [id], allowedFacts: [] };
    }).filter(Boolean);
    responsePlan = buildResponsePlan({propertyId:scope.propertyId,turnId,taskResults:[...safe,...replacementSections],inputTaskIds:[...safe,...replacementSections].map(task=>task.taskId),canonicalRequests:canonicalItems.map(item=>item.canonicalRequest),executionOutcomes,publicAvailabilityUrl});
    responsePlan.maxLength = maxLength;
  }
  return { finalDecision, finalResponse, responsePlan, claimValidation, initialClaimValidation, rebuildCount, terminalFailures: context.failures };
}

async function executeNewCoreTurn({ input, state, property, resolver, providerConfig, publicBaseUrl, now, scope = state && state.scope, understandingProvider = callOpenAIUnderstandingV1, lifecycleDecisionIdPrefix = "new-core", onDiagnostic = null, responsePrefix = "", useConversationContext = true }) {
  const preparationStarted = monotonicNow();
  if (!scope || !property || property.propertyId !== scope.propertyId) {
    const error = new Error("property_scope_invalid"); error.code = "PROPERTY_SCOPE_INVALID"; throw error;
  }
  const catalog = buildPropertyCatalog(property);
  const c01 = buildUnderstandingTurnInput({
    coreVersion: "new-core-v1", traceId: input.traceId, turnId: input.turnId,
    verifiedPropertyBinding: { propertyId: scope.propertyId, channel: scope.channel },
    verifiedConversationScope: { channel: scope.channel, userId: scope.userId },
    sourceEvents: input.sourceEvents || [{ eventId: input.turnId, messageRef: input.turnId, role: "guest", timestamp: now, messageKind: "text", messageText: input.message }],
    // LINE event independence changes only the semantic view. State remains
    // authoritative for serialization, lifecycle writes and event ownership.
    recentConversation: useConversationContext ? input.recentConversation : [],
    stateV3Snapshot: useConversationContext ? turnStateSnapshot(state, scope, now) : { scope, referenceableCycles: [] },
    publicCatalog: buildPublicCatalog(property, catalog)
  });
  emitPreparationLatency(onDiagnostic, input.traceId, "c01_preparation", preparationStarted);
  const terminalContext = createTerminalContext({ propertyId: scope.propertyId, turnId: input.turnId });
  const providerOperationalDiagnostics = [];
  let understanding;
  try { understanding = await understandingProvider(c01, {
    apiKey: providerConfig.apiKey,
    onDiagnostic,
    onOperationalDiagnostic: (entry) => {
      providerOperationalDiagnostics.push(entry);
      if (entry.stage === "new_core_understanding_attempts" || entry.stage === "new_core_latency") {
        try { onDiagnostic?.(entry); } catch { /* trace isolation */ }
      }
    }
  });
  } catch (error) {
    terminalContext.fromException(error, "turn-failure", "UNDERSTANDING");
    const terminal = finalizeTurnResponse({ scope, turnId: input.turnId, property, terminalContext, responsePrefix });
    return { state, ...terminal, artifacts: { terminalFailures: terminal.terminalFailures, requestEvidence: [{ taskId: "turn-failure", requestPresence: "UNDETERMINED", activeRequest: false }], executionOutcomes: [], canonicalItems: [] }, earliestFailure: { layer: "UNDERSTANDING", failureCode: error.code || "UNDERSTANDING_FAILURE" } };
  }
  if (understanding.failedUnits.length && require("../providers/openai-understanding-v1").isTrustedUnderstandingResult(understanding)) terminalContext.fromUnderstanding(understanding);
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
  const contextSnapshot = buildContextSnapshotV3(state, { ...scope, now });
  const canonicalItems = [];
  for (const [index, unit] of understanding.validatedUnits.entries()) {
    const link = understanding.validatedContextLinks.find((item) => item.unitId === unit.unitId);
    const relation = contextRelationEvidenceForValidatedLink(link, unit);
    const lifecycle = createLifecycleDecision({ lifecycleDecisionId: `${lifecycleDecisionIdPrefix}-${input.turnId}-${index}`, unit, validatedContextLink: link,
      currentSourceOutcome: relation?.sourceUnitId ? outcomes.find(outcome => outcome.unit.unitId === relation.sourceUnitId) : null });
    if (!lifecycle.ok) { outcomes.push({ unit, failure: { layer: "C06", failureCode: lifecycle.code } }); continue; }
    const readiness = createUnitReadiness({ unit, lifecycleDecision: lifecycle.value, routingRegistry: registry });
    if (!readiness.ok) { outcomes.push({ unit, lifecycleDecision: lifecycle.value, failure: { layer: "C07", failureCode: readiness.code } }); continue; }
    const safety = HANDOFF_CAPABILITIES.has(unit.capability) ? createTrustedOperatorSafetyPolicy({ unit, lifecycleDecision: lifecycle.value, routingRegistry: registry }) : null;
    const routing = createUnitRoutingDecision({ unit, lifecycleDecision: lifecycle.value, routingRegistry: registry, readiness: readiness.value, operatorSafetyPolicy: safety && safety.ok ? safety.value : null });
    if (!routing.ok) { outcomes.push({ unit, lifecycleDecision: lifecycle.value, readiness: readiness.value, failure: { layer: "C07", failureCode: routing.code } }); continue; }
    const gatedRouting = applyAvailabilityAutoReplyGate(unit, lifecycle.value, routing.value, property);
    const c08 = gatedRouting.disposition === "ANSWER" ? createCanonicalizerInputItem({ unit, lifecycleDecision: lifecycle.value, routingDecision: gatedRouting, understandingTurnInput: c01, canonicalizerCatalog: c08Catalog, publicCatalogIdentityProjection: projection }) : { ok: true, value: null };
    outcomes.push({ unit, lifecycleDecision: lifecycle.value, readiness: readiness.value, routingDecision: gatedRouting,
      c08CreationResult: gatedRouting.disposition === "ANSWER" ? c08 : null,
      canonicalItem: c08.ok ? c08.value : null,
      failure: c08.ok ? null : { layer: "C08", failureCode: c08.code, errors: c08.errors || [] } });
    // C05 orders declared dependencies. A dependent sees only its source's
    // already validated C08 conditions, before any Resolver answers exist.
    const outcome = outcomes[outcomes.length - 1];
    if (!outcome.canonicalItem) continue;
    outcome.c08Input = outcome.canonicalItem;
    const result = executeCanonicalizerInputItem({ canonicalizerInputItem: outcome.canonicalItem, catalog: c08Catalog, publicCatalogIdentityProjection: projection, contextSnapshot });
    outcome.c08ExecutionResult = result;
    if (!result.ok) { outcome.canonicalItem = null; outcome.failure = { layer: "C08", failureCode: result.code }; continue; }
    outcome.canonicalItem = result.value;
    canonicalItems.push(result.value);
  }
  const successful = outcomes.filter((item) => item.routingDecision);
  const failedUnits = normalizeFailureRefs([
    ...understanding.failedUnits,
    ...outcomes.filter((item) => item.failure).map((item) => ({ unitId: item.unit.unitId, failureCode: item.failure.failureCode }))
  ]);
  const aggregation = aggregateUnitOutcomes({ turnId: input.turnId, validatedUnits: successful.map((item) => item.unit), lifecycleDecisions: successful.map((item) => item.lifecycleDecision), routingDecisions: successful.map((item) => item.routingDecision), canonicalItems, failedUnits });
  if (!aggregation.ok) { const error = new Error(aggregation.code); error.code = aggregation.code; throw error; }
  const adapted = adaptLifecycleDecisionsToStateV3({ decisions: successful.map((item) => item.lifecycleDecision), aggregationResult: aggregation.value, previous: state });
  if (!adapted.ok) { const error = new Error(adapted.code); error.code = adapted.code; throw error; }
  const formalRequests = canonicalItems.map((item) => {
    const binding = adapted.value.canonicalTaskBindings.find((candidate) => candidate.unitId === item.unitId);
    const decision = successful.find(outcome => outcome.canonicalItem === item).lifecycleDecision;
    const source = contextSourceForValidatedLifecycleDecision(decision);
    // C05/C06 alone authorize condition reuse. Keep the new request identity;
    // project existing State conditions and their original quantity evidence.
    const confirmedInputs = executionConditionsV3(state, item, source?.requestCycleId || binding.requestCycleId);
    if (source?.currentUnitId && !item.canonicalRequest.quantityCandidate) {
      Object.assign(confirmedInputs, require("../conversation-contracts/resolver-quantity").resolverQuantityFields(source.confirmedInputs),
        source.confirmedInputs.quantityEvidenceRefs ? {quantityEvidenceRefs:source.confirmedInputs.quantityEvidenceRefs} : {});
    }
    return buildCanonicalFormalRequest({ property, canonicalRequest: item.canonicalRequest, requestCycleId: binding.requestCycleId, confirmedInputs });
  });
  const queryPlans = formalRequests.map(buildCanonicalQueryPlan).filter(Boolean);
  const requestEvidence = outcomes.map(item => {
    const lifecycle = item.lifecycleDecision;
    const validatedLifecycle = isValidatedLifecycleDecision(lifecycle) && lifecycle.unitId === item.unit.unitId;
    // Request existence belongs to the validated lifecycle, not a second
    // interpretation of the Understanding relation candidate.
    const activeRequest = Boolean(item.unit.capability !== null && validatedLifecycle && lifecycle.action !== "NONE");
    const absent = Boolean(item.unit.capability === null && validatedLifecycle && lifecycle.action === "NONE");
    const route = item.routingDecision;
    return { taskId: item.canonicalItem?.canonicalRequest.taskId || item.unit.unitId,
      requestPresence: activeRequest ? "PRESENT" : absent ? "ABSENT" : "UNDETERMINED", activeRequest,
      replyPermission: availabilityAutoReplySuppressed(item.unit, property) ? "SUPPRESSED" : "ALLOWED",
      humanActionRequired: Boolean(route?.disposition === "HANDOFF" && route.operatorActionClass),
      humanJudgmentRequired: Boolean(route?.disposition === "HANDOFF" && route.riskClass),
      resolverUnresolvedRequiresHuman: false, existingOperatorResponsibility: false };
  });
  for (const failure of understanding.failedUnits) if (!requestEvidence.some(item => item.taskId === failure.unitId)) requestEvidence.push({ taskId: failure.unitId, requestPresence: "UNDETERMINED", activeRequest: false,
    replyPermission: property.availabilityAutoReplyEnabled === false ? "UNDETERMINED" : "ALLOWED" });
  for (const outcome of outcomes.filter(item => item.failure)) terminalContext.fromValidationFailure(outcome, c01);
  const routedClarifications = successful
    .filter((item) => item.routingDecision.disposition === "CLARIFY")
    .map((item) => ({
      taskId: item.unit.unitId,
      type: item.unit.capability,
      outcome: "not_ready",
      readinessStatus: "missing_information",
      clarificationRequired: true,
      missingFields: item.routingDecision.missingGuestFields
    }));
  const rawExecutionOutcomes = [
    ...routedClarifications,
    ...formalRequests.filter((item) => item.readiness.status !== "ready").map(resultForNotReady),
    ...executeCanonicalQueryPlans({ property, catalog, queryPlans, turnId: c01.turnId, availabilityResolver: resolver.availability, availableDatesResolver: resolver.availableDates, priceOverrides: resolver.priceOverrides, datePriceClassifications: resolver.dateClassifications, now })
  ];
  rawExecutionOutcomes.push(
    ...aggregation.value.unitOutcomes
      .filter(item => item.routingDecision.disposition === "HANDOFF" && !failedUnits.some(failure => failure.unitId === item.unitId) && !rawExecutionOutcomes.some(outcome => outcome.taskId === item.unitId))
      .map(item => ({ taskId: item.unitId, type: "human_help", outcome: "unknown", reason: "human_help", operatorActionClass: item.routingDecision.operatorActionClass, riskClass: item.routingDecision.riskClass }))
  );
  for (const execution of rawExecutionOutcomes) if (["technical_error", "invalid_query_plan", "property_data_missing"].includes(execution.outcome)) terminalContext.fromExecution(execution);
  const ruleTaskIds = new Set(canonicalItems.map(item => item.canonicalRequest.taskId));
  let rulesLoaded = false, rules, ruleFailure;
  const executionOutcomes = rawExecutionOutcomes.map(outcome => {
    if (!ruleTaskIds.has(outcome.taskId)) return outcome;
    // Controlled custom replies transform official execution outcomes only.
    // Formal not-ready and routed clarification results have no execution
    // provenance and must retain their structured failure semantics.
    if (!canonicalExecutionProvenanceFor(outcome)) return outcome;
    try {
      if (!rulesLoaded) {
        rulesLoaded = true;
        try { rules = resolver.customReplies(); } catch (error) { ruleFailure = error; }
      }
      if (ruleFailure) throw ruleFailure;
      return applyCanonicalReplyRules({ rules, property, canonicalItems, executionOutcomes: [outcome], now })[0];
    } catch (error) {
      terminalContext.fromException(error, outcome.taskId, "CUSTOM_REPLY_RULES");
      return { ...outcome, outcome: "technical_error", reason: "custom_reply_dependency_failure", facts: {} };
    }
  });
  const taskResults = executionOutcomes.map(item => taskResultForExecution(item, requestEvidence.find(evidence => evidence.taskId === item.taskId)));
  const publicAvailabilityUrl = publicAvailabilityUrlForProperty(publicBaseUrl, property);
  const terminal = finalizeTurnResponse({ scope, turnId: input.turnId, property, terminalContext, requestEvidence, executionOutcomes, taskResults, canonicalItems, publicAvailabilityUrl, responsePrefix });
  const { finalDecision, finalResponse } = terminal;
  const dispositions = successful.map(item => item.routingDecision.disposition);
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
    artifacts: { understanding, outcomes, successful, c01, aggregation: aggregation.value, adapted: adapted.value, previousState: state, canonicalItems, formalRequests, queryPlans, executionOutcomes, requestEvidence, contextCandidates, terminalFailures: terminal.terminalFailures, responsePlan: terminal.responsePlan, claimValidation: terminal.claimValidation, initialClaimValidation: terminal.initialClaimValidation, rebuildCount: terminal.rebuildCount }
  };
}

module.exports = {
  applyAvailabilityAutoReplyGate,
  availabilityAutoReplySuppressed,
  bindRecentConversationToCycles,
  buildPublicCatalog,
  executeNewCoreTurn,
  finalizeTurnResponse,
  noExecutionDecision,
  normalizeFailureRefs,
  turnStateSnapshot
};
