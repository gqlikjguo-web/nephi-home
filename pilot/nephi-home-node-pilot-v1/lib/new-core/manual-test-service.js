"use strict";

const crypto = require("node:crypto");
const { createConversationStateV3 } = require("../conversation-contracts/conversation-state-v3");
const { buildFinalDecision } = require("../conversation-engine-v2/final-decision");
const { buildFinalResponse } = require("../conversation-engine-v2/final-response-renderer");
const { buildC01TrustedCanonicalizerCatalog } = require("./turn-input-adapter");
const { c08ExecutionDiagnosticFor } = require("./canonical-execution-adapter");
const { NEW_CORE_OPENAI_MODEL } = require("./openai-model-authority");
const { NewCoreManualTestRepository } = require("./manual-test-repository");

const PROPERTY_ID = "nephi_home";
const CHANNEL = "new-core-manual-test";
const REVIEW_STATUSES = new Set(["CORRECT", "PROBLEM"]);
const PROBLEM_CATEGORIES = new Set(["Luna理解錯", "回覆內容錯", "不該回卻回了", "該回卻沒回", "應該追問", "不該轉人工", "應該轉人工", "Context承接錯", "日期錯", "房型/包棟錯", "房價錯", "房況錯", "設備/政策資料錯", "其他"]);
const SIDE_EFFECT_COUNTERS = Object.freeze({ LINE_SEND: 0, PRODUCTION_STATE_WRITE: 0, PRODUCTION_MESSAGE_WRITE: 0, PRODUCTION_REVIEW_WRITE: 0, BOOKING_MUTATION: 0, FACTS_PROPERTY_MUTATION: 0 });
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
    safetyCandidate: unit.safetyCandidate ? {
      operatorActionClass: unit.safetyCandidate.operatorActionClass === null ? null : bounded(unit.safetyCandidate.operatorActionClass, 80),
      riskClass: unit.safetyCandidate.riskClass === null ? null : bounded(unit.safetyCandidate.riskClass, 80)
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
    const projected = projectFailureUnit(unit) || { unitId: bounded(unitId, 160), purpose: "", capability: null, subject: { kind: null, catalogIdentity: null }, temporalCandidate: null, safetyCandidate: null };
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
function projectStateTransitionDiagnostic(value, traceId) {
  if (!value || typeof value !== "object") return null;
  return {
    traceId: bounded(traceId, 160),
    c09Outcomes: (value.c09Outcomes || []).slice(0, 8).map((outcome) => ({
      unitId: bounded(outcome.unitId, 160),
      purpose: bounded(outcome.purpose, 80),
      capability: outcome.capability == null ? null : bounded(outcome.capability, 80),
      subject: {
        kind: outcome.subject && outcome.subject.kind == null ? null : bounded(outcome.subject && outcome.subject.kind, 80),
        catalogIdentity: outcome.subject && outcome.subject.catalogIdentity == null ? null : bounded(outcome.subject && outcome.subject.catalogIdentity, 160)
      },
      lifecycle: {
        action: bounded(outcome.lifecycle && outcome.lifecycle.action, 40),
        targetRequestCycleId: outcome.lifecycle && outcome.lifecycle.targetRequestCycleId == null ? null : bounded(outcome.lifecycle.targetRequestCycleId, 160)
      },
      routing: {
        disposition: bounded(outcome.routing && outcome.routing.disposition, 40),
        requiresCanonicalExecution: outcome.routing && outcome.routing.requiresCanonicalExecution === true,
        missingGuestFields: (outcome.routing && outcome.routing.missingGuestFields || []).slice(0, 20).map((item) => bounded(item, 80))
      },
      canonicalItemPresent: outcome.canonicalItemPresent === true,
      failureCode: outcome.failureCode == null ? null : bounded(outcome.failureCode, 80)
    })),
    taskCreations: (value.taskCreations || []).slice(0, 8).map((creation) => ({
      unitId: bounded(creation.unitId, 160),
      taskIdCandidate: bounded(creation.taskIdCandidate, 160),
      capability: bounded(creation.capability, 80),
      productType: bounded(creation.productType, 80),
      productId: creation.productId == null ? null : bounded(creation.productId, 160),
      expectedStatus: "needs_clarification",
      missingFields: (creation.missingFields || []).slice(0, 20).map((item) => bounded(item, 80))
    })),
    taskCreationCount: Number.isInteger(value.taskCreationCount) ? value.taskCreationCount : 0,
    reducerTaskCreationInputCount: Number.isInteger(value.reducerTaskCreationInputCount) ? value.reducerTaskCreationInputCount : 0,
    lifecycleOperationCount: Number.isInteger(value.lifecycleOperationCount) ? value.lifecycleOperationCount : 0,
    reducerInputTaskCount: Number.isInteger(value.reducerInputTaskCount) ? value.reducerInputTaskCount : 0,
    reducerOutputTaskCount: Number.isInteger(value.reducerOutputTaskCount) ? value.reducerOutputTaskCount : 0,
    zeroCreationReason: value.zeroCreationReason ? {
      reason: bounded(value.zeroCreationReason.reason, 120),
      failureCode: value.zeroCreationReason.failureCode == null ? null : bounded(value.zeroCreationReason.failureCode, 80)
    } : null
  };
}
function projectContextRelationDiagnostic(value, traceId) {
  if (!value || typeof value !== "object") return null;
  return {
    traceId: bounded(traceId, 160),
    candidates: (value.candidates || []).slice(0, 8).map((candidate) => ({
      contextLinkCandidateId: bounded(candidate.contextLinkCandidateId, 160),
      unitId: bounded(candidate.unitId, 160),
      relationKind: bounded(candidate.relationKind, 40),
      resolvedTargetRequestCycleId: candidate.resolvedTargetRequestCycleId == null
        ? null : bounded(candidate.resolvedTargetRequestCycleId, 160),
      currentSourceEvidenceRefs: (candidate.currentSourceEvidenceRefs || []).slice(0, 20).map(clone),
      referencedHistoryEventRefs: (candidate.referencedHistoryEventRefs || []).slice(0, 20).map(clone)
    })),
    referenceableCycles: (value.referenceableCycles || []).slice(0, 20).map((cycle) => ({
      requestCycleId: bounded(cycle.requestCycleId, 160),
      status: bounded(cycle.status, 40),
      capability: cycle.capability == null ? null : bounded(cycle.capability, 80),
      subject: {
        kind: cycle.subject && cycle.subject.kind == null ? null : bounded(cycle.subject && cycle.subject.kind, 80),
        catalogIdentity: cycle.subject && cycle.subject.catalogIdentity == null
          ? null : bounded(cycle.subject.catalogIdentity, 160)
      }
    }))
  };
}
function projectDiagnostic(result, traceId, counters) {
  const units = Array.isArray(result.understanding && result.understanding.units) ? result.understanding.units : [];
  const decision = result.finalDecision || {}, response = result.finalResponse || {}, resolver = result.resolver || {}, earliest = result.earliestFailure || null;
  const projected = {
    lunaUnderstanding: { summary: bounded(result.understanding && result.understanding.summary, 1000), units: units.slice(0, 8).map((unit) => ({ purpose: bounded(unit.purpose, 80), capability: bounded(unit.capability, 80), subject: { kind: bounded(unit.subject && unit.subject.kind, 80), catalogIdentity: unit.subject && unit.subject.catalogIdentity == null ? null : bounded(unit.subject.catalogIdentity, 160) }, temporal: unit.temporal == null ? null : { rawText: bounded(unit.temporal.rawText, 200), kind: bounded(unit.temporal.kind, 80), checkInCandidate: unit.temporal.checkInCandidate || null, checkOutCandidate: unit.temporal.checkOutCandidate || null, nightsCandidate: Number.isInteger(unit.temporal.nightsCandidate) ? unit.temporal.nightsCandidate : null }, guestCount: Number.isInteger(unit.guestCount) ? unit.guestCount : null })) },
    junzanAction: (result.routing || []).slice(0, 8).map((item) => bounded(item, 40)), context: (result.lifecycle || []).slice(0, 8).map((item) => bounded(item, 40)),
    resolver: { name: bounded(resolver.name, 120), foundOfficialData: resolver.foundOfficialData === true, status: bounded(resolver.status, 160) },
    finalDecision: { action: bounded(decision.action, 40), reasonCode: bounded(decision.reasonCode, 120), taskIds: (decision.taskIds || []).slice(0, 20).map((item) => bounded(item, 160)), missingFields: (decision.missingFields || []).slice(0, 20).map((item) => bounded(item, 80)), reviewRequired: decision.reviewRequired === true },
    finalResponse: { action: bounded(response.action, 40), shouldReply: response.shouldReply === true, replyText: bounded(response.replyText, 1200) }, earliestFailure: earliest ? { layer: bounded(earliest.layer, 80), failureCode: bounded(earliest.failureCode, 80), ...(earliest.schemaViolation ? { schemaViolation: { validationErrorCode: bounded(earliest.schemaViolation.validationErrorCode, 80), fieldPath: bounded(earliest.schemaViolation.fieldPath, 240), expected: bounded(earliest.schemaViolation.expected, 240), actual: bounded(earliest.schemaViolation.actual, 160) } } : {}) } : null,
    failureCode: earliest ? bounded(earliest.failureCode, 80) : null,
    failedUnits: (result.failedUnitDiagnostics || []).slice(0, 8).map(clone),
    c08: (result.c08Diagnostics || []).slice(0, 8).map(clone),
    contextRelations: projectContextRelationDiagnostic(result.contextRelationDiagnostics, traceId),
    stateTransition: projectStateTransitionDiagnostic(result.stateTransitionDiagnostics, traceId),
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
const {
  bindRecentConversationToCycles,
  buildPublicCatalog: buildManualTestPublicCatalog,
  executeNewCoreTurn,
  noExecutionDecision,
  normalizeFailureRefs,
  turnStateSnapshot
} = require("./application-service");
const normalizeManualTestFailureRefs = normalizeFailureRefs;
const buildManualTestCanonicalizerCatalog = buildC01TrustedCanonicalizerCatalog;

async function executeNewCoreManualTurn(args) {
  const { sideEffectGuard } = args;
  if (!sideEffectGuard || ["lineSend", "productionStateWrite", "productionMessageWrite", "productionReviewWrite", "bookingMutation", "factsPropertyMutation"].some((method) => typeof sideEffectGuard[method] !== "function")) {
    throw failure("TEST_SIDE_EFFECT_GUARD_REQUIRED", 500, "人工測試副作用隔離未配置");
  }
  const result = await executeNewCoreTurn({
    ...args,
    scope: args.state.scope,
    lifecycleDecisionIdPrefix: "manual"
  });
  const { artifacts, ...coreResult } = result;
  const { understanding, outcomes, aggregation, adapted, previousState, contextCandidates } = artifacts;
  const startClarifyOutcomes = aggregation.unitOutcomes.filter((outcome) => (
    outcome.lifecycleDecision.action === "START"
    && outcome.routingDecision.disposition === "CLARIFY"
    && outcome.routingDecision.requiresCanonicalExecution === false
    && outcome.canonicalItem === null
  ));
  const zeroCreationReason = adapted.taskCreations.length > 0 ? null
    : startClarifyOutcomes.length > 0
      ? { reason: "START_CLARIFY_MAPPING_EMPTY", failureCode: "START_CLARIFY_TASK_CREATION_MISSING" }
      : { reason: "NO_START_CLARIFY_OUTCOME", failureCode: null };
  const stateTransitionDiagnostics = {
    traceId: args.input.traceId,
    c09Outcomes: aggregation.unitOutcomes.map((outcome) => ({
      unitId: outcome.unitId,
      purpose: outcome.unit.purpose,
      capability: outcome.unit.capability,
      subject: outcome.unit.subject,
      lifecycle: { action: outcome.lifecycleDecision.action, targetRequestCycleId: outcome.lifecycleDecision.targetRequestCycleId },
      routing: { disposition: outcome.routingDecision.disposition, requiresCanonicalExecution: outcome.routingDecision.requiresCanonicalExecution, missingGuestFields: outcome.routingDecision.missingGuestFields },
      canonicalItemPresent: outcome.canonicalItem !== null,
      failureCode: outcome.failure && outcome.failure.failureCode || null
    })),
    taskCreations: adapted.taskCreations,
    taskCreationCount: adapted.taskCreations.length,
    reducerTaskCreationInputCount: adapted.taskCreations.length,
    lifecycleOperationCount: adapted.lifecycleOperations.length,
    reducerInputTaskCount: previousState.tasks.length,
    reducerOutputTaskCount: coreResult.state.tasks.length,
    zeroCreationReason
  };
  return {
    ...coreResult,
    failedUnitDiagnostics: buildManualTestFailureDiagnostics({ understanding, outcomes }),
    c08Diagnostics: outcomes.filter((outcome) => outcome.c08ExecutionResult).map((outcome) => ({
      unitId: outcome.unit.unitId,
      ...c08ExecutionDiagnosticFor(outcome.c08ExecutionResult)
    })),
    contextRelationDiagnostics: {
      traceId: args.input.traceId,
      candidates: contextCandidates,
      referenceableCycles: artifacts.c01.referenceableCycles
    },
    stateTransitionDiagnostics
  };
}

function createNewCoreManualTestService({ persistence, providers, service, factsProviders = providers, factsService = service, apiKey, publicBaseUrl = "", now = () => new Date(), executeTurn = executeNewCoreManualTurn } = {}) {
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
      result = await executeTurn({ input: { turnId, traceId, message, recentConversation }, state: current.state, property, resolver, providerConfig: { apiKey }, publicBaseUrl, sideEffectGuard, now: timestamp });
    } catch (error) {
      const failureCode = /^[A-Z][A-Z0-9_]{1,79}$/.test(String(error && error.code || "")) ? error.code : "NEW_CORE_RUNTIME_FAILURE";
      const finalDecision = buildFinalDecision({ plannerFailure: failureCode });
      result = { state: current.state, understanding: { summary: "新版核心未完成可信理解", units: [] }, lifecycle: [], routing: ["HANDOFF"], resolver: { name: "existing canonical Resolver", foundOfficialData: false, status: "NOT_EXECUTED" }, finalDecision, finalResponse: buildFinalResponse({ finalDecision, responsePlan: null, validatedReplyText: "", claimValidation: null }), earliestFailure: { layer: String(error && error.boundary || "new-core-runtime").slice(0, 80), failureCode, ...(error && error.schemaViolation ? { schemaViolation: error.schemaViolation } : {}) }, requestedModel: String(error && error.requestedModel || NEW_CORE_OPENAI_MODEL), resolvedModel: String(error && error.resolvedModel || "") };
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

module.exports = { PROPERTY_ID, CHANNEL, SIDE_EFFECT_COUNTERS, bindRecentConversationToCycles, buildManualTestCanonicalizerCatalog, buildManualTestFailureDiagnostics, buildManualTestPublicCatalog, createNewCoreManualTestService, executeNewCoreManualTurn, noExecutionDecision, normalizeManualTestFailureRefs, turnStateSnapshot };
