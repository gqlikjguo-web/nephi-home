"use strict";

const crypto = require("node:crypto");
const { CAPABILITY_REGISTRY } = require("../conversation-engine-v2/capability-registry");
const { buildPropertyCatalog } = require("../conversation-engine-v2/property-catalog");
const { createConversationStateV3 } = require("../conversation-contracts/conversation-state-v3");
const { buildContextSnapshotV3, executionConditionsV3, reduceConversationStateV3 } = require("../conversation-engine-v2/conversation-state-v3-reducer");
const { buildCanonicalFormalRequest, buildCanonicalQueryPlan, resultForNotReady } = require("../conversation-engine-v2/formal-request");
const { executeCanonicalQueryPlans } = require("../conversation-engine-v2/capability-executor");
const { buildResponsePlan } = require("../conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../conversation-engine-v2/controlled-composer");
const { validateClaims } = require("../conversation-engine-v2/claim-validator");
const { buildFinalDecision } = require("../conversation-engine-v2/final-decision");
const { buildFinalResponse } = require("../conversation-engine-v2/final-response-renderer");
const { applyControlledReplyRules } = require("../custom-reply-rules");
const { buildUnderstandingTurnInput, buildPublicCatalogIdentityProjection } = require("./turn-input-adapter");
const { projectCapabilityRegistry } = require("./semantic-unit-validator");
const { createLifecycleDecision } = require("./lifecycle-manager");
const { createUnitReplyRoutingRegistry, createUnitReadiness, createTrustedOperatorSafetyPolicy, createUnitRoutingDecision } = require("./unit-reply-router");
const { createCanonicalizerInputItem, executeCanonicalizerInputItem } = require("./canonical-execution-adapter");
const { aggregateUnitOutcomes } = require("./unit-aggregator");
const { adaptLifecycleDecisionsToStateV3 } = require("./state-v3-lifecycle-adapter");
const { callOpenAIUnderstandingV1, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC } = require("../providers/openai-understanding-v1");
const { NEW_CORE_OPENAI_MODEL } = require("./openai-model-authority");
const { NewCoreManualTestRepository } = require("./manual-test-repository");

const PROPERTY_ID = "nephi_home";
const CHANNEL = "new-core-manual-test";
const REVIEW_STATUSES = new Set(["CORRECT", "PROBLEM"]);
const PROBLEM_CATEGORIES = new Set(["Luna理解錯", "回覆內容錯", "不該回卻回了", "該回卻沒回", "應該追問", "不該轉人工", "應該轉人工", "Context承接錯", "日期錯", "房型/包棟錯", "房價錯", "房況錯", "設備/政策資料錯", "其他"]);
const SIDE_EFFECT_COUNTERS = Object.freeze({ LINE_SEND: 0, PRODUCTION_STATE_WRITE: 0, PRODUCTION_MESSAGE_WRITE: 0, PRODUCTION_REVIEW_WRITE: 0, BOOKING_MUTATION: 0, FACTS_PROPERTY_MUTATION: 0 });
const HANDOFF_CAPABILITIES = new Set(["booking_operator_request", "high_risk"]);
const DENIED_KEYS = /(?:api.?key|authorization|cookie|credential|token|secret|headers?|prompt|reasoning|raw|database.?url|private.?notes?)/iu;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function failure(code, status, message) { const error = new Error(message); error.code = code; error.status = status; return error; }
function emptyConversationStateV3(scope, now) { return createConversationStateV3({ ...scope, tasks: [], createdAt: now, updatedAt: now, expiresAt: now }); }
function ownerId(session) { return String(session.userId || `${session.propertyId}:${session.username}` || "").slice(0, 200); }
function userIdFor(testSessionId) { return `manual-test:${crypto.createHash("sha256").update(testSessionId).digest("hex").slice(0, 40)}`; }
function assertScope(propertyId) { if (propertyId && propertyId !== PROPERTY_ID) throw failure("PROPERTY_ACCESS_DENIED", 403, "無權存取其他旅宿"); }
function assertSafe(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key !== "rawText" && DENIED_KEYS.test(key)) { const error = new Error("unsafe_diagnostic_key"); error.code = "TEST_DIAGNOSTIC_UNSAFE"; throw error; }
    assertSafe(item);
  }
}
function bounded(value, limit = 500) { return String(value == null ? "" : value).slice(0, limit); }
function normalizeManualTestFailureRefs(values = []) {
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
function projectFailureUnit(unit) {
  if (!unit || typeof unit !== "object") return null;
  const temporal = unit.temporalCandidate;
  return {
    unitId: bounded(unit.unitId, 160),
    purpose: bounded(unit.purpose, 80),
    capability: unit.capability == null ? null : bounded(unit.capability, 80),
    subject: {
      kind: unit.subject && unit.subject.kind == null ? null : bounded(unit.subject && unit.subject.kind, 80),
      catalogIdentity: unit.subject && unit.subject.catalogIdentity == null ? null : bounded(unit.subject.catalogIdentity, 160)
    },
    temporalCandidate: temporal == null ? null : {
      rawText: bounded(temporal.rawText, 200), kind: bounded(temporal.kind, 80),
      checkInCandidate: temporal.checkInCandidate || null, checkOutCandidate: temporal.checkOutCandidate || null,
      nightsCandidate: Number.isInteger(temporal.nightsCandidate) ? temporal.nightsCandidate : null
    },
    replyCandidate: unit.replyCandidate ? {
      disposition: bounded(unit.replyCandidate.disposition, 40),
      reasonClass: bounded(unit.replyCandidate.reasonClass, 80)
    } : null
  };
}
function buildManualTestFailureDiagnostics({ understanding, outcomes } = {}) {
  const rawUnits = Array.isArray(understanding && understanding.understandingOutput && understanding.understandingOutput.units)
    ? understanding.understandingOutput.units : [];
  const providerFailures = Array.isArray(understanding && understanding.failedUnits) ? understanding.failedUnits : [];
  const outcomeFailures = (Array.isArray(outcomes) ? outcomes : []).filter((item) => item && item.failure);
  const unitIds = [...new Set([
    ...providerFailures.map((item) => item.unitId),
    ...outcomeFailures.map((item) => item.unit && item.unit.unitId)
  ].filter(Boolean))];
  return unitIds.map((unitId) => {
    const providerFailure = providerFailures.find((item) => item.unitId === unitId) || null;
    const outcome = outcomeFailures.find((item) => item.unit && item.unit.unitId === unitId) || null;
    const failure = providerFailure
      ? { layer: providerFailure.boundary || "C03-C05", failureCode: providerFailure.failureCode }
      : outcome.failure;
    const unit = outcome && outcome.unit || rawUnits.find((item) => item.unitId === unitId);
    const projected = projectFailureUnit(unit) || { unitId: bounded(unitId, 160), purpose: "", capability: null, subject: { kind: null, catalogIdentity: null }, temporalCandidate: null, replyCandidate: null };
    return {
      ...projected,
      readiness: outcome && outcome.readiness ? {
        status: bounded(outcome.readiness.status, 40),
        missingGuestFields: (outcome.readiness.missingGuestFields || []).slice(0, 20).map((item) => bounded(item, 80))
      } : null,
      failureCodes: {
        C03: failure.layer === "C03" ? bounded(failure.failureCode, 80) : null,
        C06: failure.layer === "C06" ? bounded(failure.failureCode, 80) : null,
        C07: failure.layer === "C07" ? bounded(failure.failureCode, 80) : null
      },
      earliestFailure: { layer: bounded(failure.layer, 80), failureCode: bounded(failure.failureCode, 80) }
    };
  });
}
function projectDiagnostic(result, traceId, counters) {
  const units = Array.isArray(result.understanding && result.understanding.units) ? result.understanding.units : [];
  const decision = result.finalDecision || {}, response = result.finalResponse || {}, resolver = result.resolver || {}, earliest = result.earliestFailure || null;
  const projected = {
    lunaUnderstanding: { summary: bounded(result.understanding && result.understanding.summary, 1000), units: units.slice(0, 8).map((unit) => ({ purpose: bounded(unit.purpose, 80), capability: bounded(unit.capability, 80), subject: { kind: bounded(unit.subject && unit.subject.kind, 80), catalogIdentity: unit.subject && unit.subject.catalogIdentity == null ? null : bounded(unit.subject.catalogIdentity, 160) }, temporal: unit.temporal == null ? null : { rawText: bounded(unit.temporal.rawText, 200), kind: bounded(unit.temporal.kind, 80), checkInCandidate: unit.temporal.checkInCandidate || null, checkOutCandidate: unit.temporal.checkOutCandidate || null, nightsCandidate: Number.isInteger(unit.temporal.nightsCandidate) ? unit.temporal.nightsCandidate : null }, guestCount: Number.isInteger(unit.guestCount) ? unit.guestCount : null })) },
    junzanAction: (result.routing || []).slice(0, 8).map((item) => bounded(item, 40)), context: (result.lifecycle || []).slice(0, 8).map((item) => bounded(item, 40)),
    resolver: { name: bounded(resolver.name, 120), foundOfficialData: resolver.foundOfficialData === true, status: bounded(resolver.status, 160) },
    finalDecision: { action: bounded(decision.action, 40), reasonCode: bounded(decision.reasonCode, 120), taskIds: (decision.taskIds || []).slice(0, 20).map((item) => bounded(item, 160)), missingFields: (decision.missingFields || []).slice(0, 20).map((item) => bounded(item, 80)), reviewRequired: decision.reviewRequired === true },
    finalResponse: { action: bounded(response.action, 40), shouldReply: response.shouldReply === true, replyText: bounded(response.replyText, 1200) }, earliestFailure: earliest ? { layer: bounded(earliest.layer, 80), failureCode: bounded(earliest.failureCode, 80) } : null,
    failureCode: earliest ? bounded(earliest.failureCode, 80) : null,
    failedUnits: (result.failedUnitDiagnostics || []).slice(0, 8).map(clone),
    traceId, requestedModel: bounded(result.requestedModel, 160), resolvedModel: bounded(result.resolvedModel, 160), sideEffectCounters: clone(counters)
  };
  assertSafe(projected); return projected;
}
function createSideEffectGuard() {
  const counters = { ...SIDE_EFFECT_COUNTERS }, blocked = (code) => { throw failure(code, 409, "人工測試隔離阻擋了正式副作用"); };
  return { counters,
    lineSend: () => { counters.LINE_SEND += 1; blocked("TEST_LINE_SEND_FORBIDDEN"); },
    productionStateWrite: () => { counters.PRODUCTION_STATE_WRITE += 1; blocked("TEST_PRODUCTION_STATE_WRITE_FORBIDDEN"); },
    productionMessageWrite: () => { counters.PRODUCTION_MESSAGE_WRITE += 1; blocked("TEST_PRODUCTION_MESSAGE_WRITE_FORBIDDEN"); },
    productionReviewWrite: () => { counters.PRODUCTION_REVIEW_WRITE += 1; blocked("TEST_PRODUCTION_REVIEW_WRITE_FORBIDDEN"); },
    bookingMutation: () => { counters.BOOKING_MUTATION += 1; blocked("TEST_BOOKING_MUTATION_FORBIDDEN"); },
    factsPropertyMutation: () => { counters.FACTS_PROPERTY_MUTATION += 1; blocked("TEST_FACTS_PROPERTY_MUTATION_FORBIDDEN"); }
  };
}
function publicCatalog(property, catalog) {
  const subjects = [...catalog.rooms, ...catalog.amenities, ...catalog.policies].map((item) => ({ catalogIdentity: item.canonicalId, kind: item.category === "room" ? "room" : item.category === "bundle" ? "bundle" : catalog.amenities.includes(item) ? "amenity" : "policy", propertyId: property.propertyId, publicName: item.publicName }));
  return { propertyId: property.propertyId, timezone: catalog.timezone, capabilityCatalog: Object.keys(CAPABILITY_REGISTRY), publicSubjectCatalog: subjects };
}
function turnStateSnapshot(state, scope, now) {
  const context = buildContextSnapshotV3(state, { ...scope, now });
  const tasks = new Map((state.tasks || []).map((task) => [task.taskId, task]));
  return { scope, referenceableCycles: context.cycles.map((cycle) => {
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
    const subjectKind = topic.category || (inventory.mode === "any" ? "property" : null);
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
function canonicalizerCatalog(input) {
  const project = (subject) => ({ canonicalId: subject.catalogIdentity, category: subject.kind, publicName: subject.publicName });
  return { propertyId: input.propertyScope.propertyId, timezone: input.propertyTimezone, rooms: input.publicSubjectCatalog.filter((x) => ["room", "bundle"].includes(x.kind)).map(project), amenities: input.publicSubjectCatalog.filter((x) => x.kind === "amenity").map(project), policies: input.publicSubjectCatalog.filter((x) => x.kind === "policy").map(project) };
}
function legacyTaskResult(execution) {
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
function noExecutionDecision(outcomes, dispositions, missingFields) {
  const action = routeAction(dispositions);
  if (action === "no_reply") return buildFinalDecision({ executionOutcomes: [], noReplyReason: "new_core_no_reply" });
  if (action === "handoff") return buildFinalDecision({ executionOutcomes: [{ taskId: "new-core-handoff", type: "human_help", outcome: "unknown", reason: "human_help" }] });
  if (action === "clarification") return buildFinalDecision({ executionOutcomes: [{ taskId: "new-core-clarify", type: "price", outcome: "not_ready", readinessStatus: "missing_information", missingFields }] });
  return buildFinalDecision({ executionOutcomes: outcomes });
}

async function executeNewCoreManualTurn({ input, state, property, resolver, providerConfig, sideEffectGuard, now }) {
  if (!sideEffectGuard || ["lineSend", "productionStateWrite", "productionMessageWrite", "productionReviewWrite", "bookingMutation", "factsPropertyMutation"].some((method) => typeof sideEffectGuard[method] !== "function")) throw failure("TEST_SIDE_EFFECT_GUARD_REQUIRED", 500, "人工測試副作用隔離未配置");
  const scope = state.scope;
  const catalog = buildPropertyCatalog(property);
  const c01 = buildUnderstandingTurnInput({ coreVersion: "new-core-v1", traceId: input.traceId, turnId: input.turnId, verifiedPropertyBinding: { propertyId: PROPERTY_ID, channel: CHANNEL }, verifiedConversationScope: { channel: CHANNEL, userId: scope.userId }, sourceEvents: [{ eventId: input.turnId, messageRef: input.turnId, role: "guest", timestamp: now, messageKind: "text", messageText: input.message }], recentConversation: input.recentConversation, stateV3Snapshot: turnStateSnapshot(state, scope, now), publicCatalog: publicCatalog(property, catalog) });
  const understanding = await callOpenAIUnderstandingV1(c01, { apiKey: providerConfig.apiKey });
  const registry = createUnitReplyRoutingRegistry(projectCapabilityRegistry(CAPABILITY_REGISTRY));
  const c08Catalog = canonicalizerCatalog(c01);
  const projection = buildPublicCatalogIdentityProjection(c01);
  const outcomes = [];
  for (const [index, unit] of understanding.validatedUnits.entries()) {
    const link = understanding.validatedContextLinks.find((item) => item.unitId === unit.unitId);
    const lifecycle = createLifecycleDecision({ lifecycleDecisionId: `manual-${input.turnId}-${index}`, unit, validatedContextLink: link });
    if (!lifecycle.ok) { outcomes.push({ unit, failure: { layer: "C06", failureCode: lifecycle.code } }); continue; }
    const readiness = createUnitReadiness({ unit, lifecycleDecision: lifecycle.value, routingRegistry: registry });
    if (!readiness.ok) { outcomes.push({ unit, lifecycleDecision: lifecycle.value, failure: { layer: "C07", failureCode: readiness.code } }); continue; }
    const safety = HANDOFF_CAPABILITIES.has(unit.capability) ? createTrustedOperatorSafetyPolicy({ unit, lifecycleDecision: lifecycle.value, routingRegistry: registry }) : null;
    const routing = createUnitRoutingDecision({ unit, lifecycleDecision: lifecycle.value, routingRegistry: registry, readiness: readiness.value, operatorSafetyPolicy: safety && safety.ok ? safety.value : null });
    if (!routing.ok) { outcomes.push({ unit, lifecycleDecision: lifecycle.value, readiness: readiness.value, failure: { layer: "C07", failureCode: routing.code } }); continue; }
    const c08 = routing.value.disposition === "ANSWER" ? createCanonicalizerInputItem({ unit, lifecycleDecision: lifecycle.value, routingDecision: routing.value, understandingTurnInput: c01, canonicalizerCatalog: c08Catalog, publicCatalogIdentityProjection: projection }) : { ok: true, value: null };
    outcomes.push({ unit, lifecycleDecision: lifecycle.value, readiness: readiness.value, routingDecision: routing.value, canonicalItem: c08.ok ? c08.value : null, failure: c08.ok ? null : { layer: "C08", failureCode: c08.code } });
  }
  const successful = outcomes.filter((item) => item.routingDecision);
  const failedUnits = normalizeManualTestFailureRefs([
    ...understanding.failedUnits,
    ...outcomes.filter((x) => x.failure).map((x) => ({ unitId: x.unit.unitId, failureCode: x.failure.failureCode }))
  ]);
  const aggregation = aggregateUnitOutcomes({ turnId: input.turnId, validatedUnits: successful.map((x) => x.unit), lifecycleDecisions: successful.map((x) => x.lifecycleDecision), routingDecisions: successful.map((x) => x.routingDecision), canonicalItems: successful.map((x) => x.canonicalItem).filter(Boolean), failedUnits });
  if (!aggregation.ok) { const error = new Error(aggregation.code); error.code = aggregation.code; throw error; }
  const adapted = adaptLifecycleDecisionsToStateV3({ decisions: successful.map((x) => x.lifecycleDecision), aggregationResult: aggregation.value, previous: state });
  if (!adapted.ok) { const error = new Error(adapted.code); error.code = adapted.code; throw error; }
  const contextSnapshot = buildContextSnapshotV3(state, { ...scope, now });
  const canonicalItems = [];
  for (const outcome of successful.filter((x) => x.canonicalItem)) {
    const result = executeCanonicalizerInputItem({ canonicalizerInputItem: outcome.canonicalItem, catalog: c08Catalog, publicCatalogIdentityProjection: projection, contextSnapshot });
    if (!result.ok) { outcome.failure = { layer: "C08", failureCode: result.code }; continue; }
    canonicalItems.push({ ...result.value, requestCycleId: outcome.lifecycleDecision.targetRequestCycleId || outcome.unit.unitId });
  }
  const formalRequests = canonicalItems.map((item) => buildCanonicalFormalRequest({ property, canonicalRequest: item.canonicalRequest, requestCycleId: item.requestCycleId, confirmedInputs: executionConditionsV3(state, item) }));
  const queryPlans = formalRequests.map(buildCanonicalQueryPlan).filter(Boolean);
  const rawExecutionOutcomes = [...formalRequests.filter((x) => x.readiness.status !== "ready").map(resultForNotReady), ...executeCanonicalQueryPlans({ property, catalog, queryPlans, availabilityResolver: resolver.availability, availableDatesResolver: resolver.availableDates, priceOverrides: resolver.priceOverrides(), datePriceClassifications: resolver.dateClassifications() })];
  const executionOutcomes = applyControlledReplyRules({ rules: resolver.customReplies(), property, canonicalItems, executionOutcomes: rawExecutionOutcomes, now });
  const taskResults = executionOutcomes.map(legacyTaskResult);
  const responsePlan = buildResponsePlan({ propertyId: PROPERTY_ID, taskResults, inputTaskIds: canonicalItems.map((x) => x.canonicalRequest.taskId), canonicalRequests: canonicalItems.map((x) => x.canonicalRequest), reviewActions: [] });
  const replyText = composeControlledReply(responsePlan);
  const claimValidation = validateClaims(replyText, responsePlan, canonicalItems.map((x) => x.canonicalRequest.taskId));
  const dispositions = successful.map((x) => x.routingDecision.disposition);
  const missingFields = successful.flatMap((x) => x.routingDecision.missingGuestFields);
  const finalDecision = executionOutcomes.length ? buildFinalDecision({ executionOutcomes, claimValidation }) : noExecutionDecision(executionOutcomes, dispositions, missingFields);
  const finalResponse = buildFinalResponse({ finalDecision, responsePlan, validatedReplyText: replyText, claimValidation });
  const nextState = reduceConversationStateV3({ previous: state, canonicalItems, formalRequests, executionOutcomes, clarificationTaskIds: finalDecision.action === "clarification" ? finalDecision.executionSummary.notReadyTaskIds : [], lifecycleOperations: adapted.lifecycleOperations, taskCreations: adapted.taskCreations, canonicalTaskBindings: adapted.canonicalTaskBindings, scope: { ...scope, now } });
  const provider = understanding[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC] || {};
  const failure = outcomes.find((x) => x.failure) && outcomes.find((x) => x.failure).failure || understanding.failedUnits[0] && { layer: understanding.failedUnits[0].boundary || "C03-C05", failureCode: understanding.failedUnits[0].failureCode } || null;
  return { state: nextState, understanding: { summary: understanding.validatedUnits.map((x) => `${x.purpose}/${x.capability}/${x.subject.kind}`).join("；"), units: understanding.validatedUnits.map((x) => ({ purpose: x.purpose, capability: x.capability, subject: x.subject, temporal: x.temporalCandidate, guestCount: x.slotCandidates.find((slot) => slot.slot === "guest_count")?.value || null })) }, lifecycle: successful.map((x) => x.lifecycleDecision.action), routing: dispositions, resolver: { name: "existing canonical Resolver", foundOfficialData: executionOutcomes.some((x) => x.outcome === "answered"), status: executionOutcomes.map((x) => x.outcome).join(",") || "NOT_APPLICABLE" }, finalDecision, finalResponse, earliestFailure: failure, failedUnitDiagnostics: buildManualTestFailureDiagnostics({ understanding, outcomes }), requestedModel: provider.requestedModel || NEW_CORE_OPENAI_MODEL, resolvedModel: provider.resolvedModel || "" };
}

function createNewCoreManualTestService({ persistence, providers, service, factsProviders = providers, factsService = service, apiKey, now = () => new Date(), executeTurn = executeNewCoreManualTurn } = {}) {
  const repository = new NewCoreManualTestRepository({ persistence, now });
  const resolver = { availability: (query) => factsService.searchAvailability(query), availableDates: (query) => factsService.searchAvailableDates(query), priceOverrides: () => factsProviders.customerSettings.listInventoryPriceOverrides(PROPERTY_ID), dateClassifications: () => factsProviders.customerSettings.listDatePriceClassifications(PROPERTY_ID), customReplies: () => factsProviders.customReplies ? factsProviders.customReplies.list(PROPERTY_ID) : [] };
  function scopeFor(id) { return { propertyId: PROPERTY_ID, channel: CHANNEL, userId: userIdFor(id) }; }
  async function createSession(session, claimedPropertyId) { assertScope(claimedPropertyId); const timestamp = now().toISOString(), testSessionId = crypto.randomUUID(); return repository.createSession({ testSessionId, ownerId: ownerId(session), propertyId: PROPERTY_ID, state: emptyConversationStateV3(scopeFor(testSessionId), timestamp) }); }
  async function requireSession(id, session) { const row = await repository.getSession(id, ownerId(session), PROPERTY_ID); if (!row) throw failure("TEST_SESSION_NOT_FOUND", 404, "找不到測試對話"); return row; }
  async function runTurn(id, session, body = {}) {
    assertScope(body.propertyId); if (Object.hasOwn(body, "state") || Object.hasOwn(body, "model")) throw failure("TEST_CLIENT_AUTHORITY_FORBIDDEN", 400, "測試 state 與 model 只能由伺服器決定");
    const message = String(body.input || "").trim().slice(0, 1000); if (!message) throw failure("TEST_INPUT_REQUIRED", 400, "請輸入客人訊息");
    const current = await requireSession(id, session); const turnId = crypto.randomUUID(), traceId = crypto.randomUUID(), timestamp = now().toISOString();
    const history = await repository.listTurns(id, ownerId(session), PROPERTY_ID);
    const generationHistory = history.filter((turn) => turn.generation === current.generation).slice(-10);
    const snapshot = turnStateSnapshot(current.state, scopeFor(id), timestamp);
    const recentConversation = bindRecentConversationToCycles(generationHistory, current.state, snapshot.referenceableCycles);
    const property = factsProviders.customerSettings.getProperty(PROPERTY_ID); if (!property) { const error = new Error("property_not_found"); error.code = "PROPERTY_NOT_FOUND"; throw error; }
    let result; const sideEffectGuard = createSideEffectGuard();
    try {
      result = await executeTurn({ input: { turnId, traceId, message, recentConversation }, state: current.state, property, resolver, providerConfig: { apiKey }, sideEffectGuard, now: timestamp });
    } catch (error) {
      const failureCode = /^[A-Z][A-Z0-9_]{1,79}$/.test(String(error && error.code || "")) ? error.code : "NEW_CORE_RUNTIME_FAILURE";
      const finalDecision = buildFinalDecision({ plannerFailure: failureCode });
      result = { state: current.state, understanding: { summary: "新版核心未完成可信理解", units: [] }, lifecycle: [], routing: ["HANDOFF"], resolver: { name: "existing canonical Resolver", foundOfficialData: false, status: "NOT_EXECUTED" }, finalDecision, finalResponse: buildFinalResponse({ finalDecision, responsePlan: null, validatedReplyText: "", claimValidation: null }), earliestFailure: { layer: String(error && error.boundary || "new-core-runtime").slice(0, 80), failureCode }, requestedModel: String(error && error.requestedModel || NEW_CORE_OPENAI_MODEL), resolvedModel: String(error && error.resolvedModel || "") };
    }
    const diagnostic = projectDiagnostic(result, traceId, sideEffectGuard.counters);
    const turn = { turnId, traceId, testSessionId: id, ownerId: ownerId(session), propertyId: PROPERTY_ID, generation: current.generation, timestamp, input: message, predictedResponse: result.finalResponse.shouldReply ? result.finalResponse.replyText : "系統判定：不需要回覆", diagnostic, manualReview: { status: "UNMARKED", problemCategory: "", note: "" } };
    await repository.saveTurn({ session: current, state: result.state, turn }); return clone(turn);
  }
  return {
    createSession, runTurn,
    async newConversation(id, session, body = {}) { assertScope(body.propertyId); const current = await requireSession(id, session); return repository.newConversation(current, emptyConversationStateV3(scopeFor(id), now().toISOString())); },
    async listTurns(id, session) { await requireSession(id, session); return repository.listTurns(id, ownerId(session), PROPERTY_ID); },
    async review(turnId, session, body = {}) { const status = String(body.status || ""); const category = String(body.problemCategory || ""); const note = String(body.note || "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 500); if (!REVIEW_STATUSES.has(status) || status === "PROBLEM" && !PROBLEM_CATEGORIES.has(category) || status === "CORRECT" && category) throw failure("TEST_REVIEW_INVALID", 400, "人工判定格式錯誤"); return repository.reviewTurn({ turnId, ownerId: ownerId(session), propertyId: PROPERTY_ID, reviewStatus: status, problemCategory: category, note }); },
    async records(session, filter = "all") { if (!["all", "problem", "unmarked"].includes(filter)) { const error = new Error("filter_invalid"); error.code = "TEST_FILTER_INVALID"; throw error; } return repository.listRecords(ownerId(session), PROPERTY_ID, filter); },
    async trace(traceId, session) { return repository.findByTraceId(traceId, ownerId(session), PROPERTY_ID); }
  };
}

module.exports = { PROPERTY_ID, CHANNEL, SIDE_EFFECT_COUNTERS, bindRecentConversationToCycles, buildManualTestFailureDiagnostics, createNewCoreManualTestService, executeNewCoreManualTurn, normalizeManualTestFailureRefs, turnStateSnapshot };
