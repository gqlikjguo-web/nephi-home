"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ConversationEngineV2, normalizePlannerOutput } = require("../lib/conversation-engine-v2/engine");
const { plannerJsonSchema, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { SAFE_HANDOFF_TEXT } = require("../lib/conversation-engine-v2/final-response-renderer");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");
const { createApp, formatSafeTestOnlyConversationTrace } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { attachPropertyScopedLineBinding } = require("./helpers/property-scoped-line-webhook");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const property = { propertyId: "demo_homestay_a", timezone: "Asia/Taipei", rooms: [], commonAnswers: { checkInTime: "15:00" } };
const sensitive = {
  apiKey: "sk-planner-diagnostic-secret",
  guestMessage: "SECRET_GUEST_MESSAGE",
  prompt: "SECRET_PLANNER_PROMPT",
  responseBody: "SECRET_PROVIDER_RESPONSE_BODY",
  providerMessage: "sensitive raw message"
};
const model = "gpt-4.1-mini";

function validPlannerOutput() {
  return migrateFakePlannerOutput({
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 1 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{ candidateIndex: 0, taskId: "t", type: "policy", sourceText: "check in", detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: false, entity: { category: "policy", rawText: "check in", canonicalCandidate: "check_in", confidence: 1 }, stayCandidate: null, confidence: 1 }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "test-event", startOffset: 0, endOffset: 4, quote: "test" }] }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "test"
  });
}

async function engineResult(output) {
  const logs = [];
  const engine = new ConversationEngineV2({
    planner: { classify: async () => output },
    persistence: { getConversationState: () => null, setConversationState: () => {}, appendMessageLog: (_propertyId, item) => { logs.push(item); return { reviewId: "r" }; } },
    getProperty: () => property,
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => []
  });
  const result = await engine.process({ customerId: property.propertyId, channelId: "test", lineUserId: "guest", eventId: String(output), eventTimestamp: 1, messageText: "test" });
  assert.equal(result.shouldReply, true);
  assert.ok(result.replyText.length > 0);
  assert.equal(logs.at(-1).decisionReason, "planner_empty_output");
}

async function duplicateTaskIdsContinueThroughEngine() {
  const output = validPlannerOutput();
  const baseTask = output.tasks[0];
  output.tasks = [
    baseTask,
    { ...baseTask, candidateIndex: 1, taskId: "policy" },
    { ...baseTask, candidateIndex: 2, taskId: "policy" }
  ];
  output.contextRelationCandidates = output.tasks.map((task) => ({
    candidateIndex: task.candidateIndex,
    kind: "new_request",
    candidateRequestCycleRefs: [],
    evidenceRefs: [{ eventId: "test-event", messageRef: "", startOffset: 0, endOffset: 4, quote: "test" }]
  }));
  migrateFakePlannerOutput(output);
  const diagnostics = [];
  const engine = new ConversationEngineV2({
    planner: { classify: async () => output },
    persistence: plannerPersistence(),
    getProperty: () => property,
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => [],
    onDiagnostic: (entry) => diagnostics.push(entry)
  });
  const result = await engine.process({
    customerId: property.propertyId,
    channelId: "test",
    lineUserId: "guest",
    eventId: "test-event",
    eventTimestamp: 1,
    messageText: "test"
  });
  assert.equal(result.finalDecision.action, "reply", "duplicate task IDs must not force the whole request into Planner fallback");
  assert.notEqual(result.replyText, SAFE_HANDOFF_TEXT);
  assert.equal(result.taskResults.length, 3, "every otherwise valid task must continue to execution");
  assert.equal(new Set(result.taskResults.map((item) => item.taskId)).size, 3, "engine execution must receive unique normalized task IDs");
  const semantic = diagnostics.find((entry) => entry.stage === "semantic_contract");
  assert.equal(semantic.validationPassed, true);
  assert.equal(semantic.semanticValidation.repairedTasks.filter((item) => item.reason === "duplicate_task_id_normalization").length, 1);
}

function invalidRelationOutput() {
  return {
    ...validPlannerOutput(),
    tasks: [{ candidateIndex: 0, taskId: "availability", type: "availability", sourceText: "availability", detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, confidence: 1 }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "supplement_existing", candidateRequestCycleRefs: ["not-in-snapshot"], evidenceRefs: [{ eventId: "invalid-relation-event", startOffset: 0, endOffset: 7, quote: "invalid" }] }]
  };
}

async function sendWebhook(binding, url, eventId, text) {
  const payload = JSON.stringify({ destination: "line", events: [{ type: "message", webhookEventId: eventId, replyToken: `token-${eventId}`, timestamp: 1, source: { userId: "guest" }, message: { type: "text", id: `m-${eventId}`, text } }] });
  const response = await binding.post(url, payload);
  assert.equal(response.status, 200);
}

function plannerPersistence() {
  return {
    getConversationState: () => null,
    setConversationState: () => {},
    appendMessageLog: () => ({ reviewId: "planner-review" })
  };
}

async function plannerFailureDiagnostic({ name, planner, expected }) {
  const diagnostics = [];
  const engine = new ConversationEngineV2({
    planner,
    persistence: plannerPersistence(),
    getProperty: () => property,
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => [],
    onDiagnostic: (entry) => diagnostics.push(entry)
  });
  const result = await engine.process({
    customerId: property.propertyId,
    channelId: "test",
    lineUserId: "guest",
    eventId: `planner-error-${name}`,
    eventTimestamp: 1,
    messageText: sensitive.guestMessage,
    sourceEvents: [{
      eventId: `planner-error-${name}`,
      messageText: sensitive.guestMessage
    }]
  });
  assert.equal(result.finalDecision.action, "handoff", `${name} must retain handoff`);
  assert.equal(result.finalDecision.reasonCode, "planner_parse_failed", `${name} must retain planner_parse_failed`);
  assert.equal(result.replyText, SAFE_HANDOFF_TEXT, `${name} must retain the safe fallback`);

  const rawDiagnostic = diagnostics.find((entry) => entry.stage === "planner_error");
  assert.ok(rawDiagnostic, `${name} must emit planner_error`);
  const diagnostic = formatSafeTestOnlyConversationTrace(rawDiagnostic);
  const expectedDiagnosticKeys = [
    "errorCategory",
    "errorCode",
    "errorName",
    "finalErrorCategory",
    "firstAttemptErrorCategory",
    "httpStatus",
    "model",
    "parsedOutputPresent",
    "propertyId",
    "provider",
    "providerAttemptCount",
    "providerAttempts",
    "providerErrorCode",
    "providerErrorParam",
    "providerErrorType",
    "responseBodyPresent",
    "retryPerformed",
    "retrySucceeded",
    "retryable",
    "scope",
    "stage",
    "timeout",
    "traceId"
  ];
  if (expected.coverageCriticResultStatus) expectedDiagnosticKeys.push(
    "coverageCriticResultStatus",
    "coverageCriticErrorCategory",
    "coverageCriticFailureCode",
    "repairRequired",
    "repairAllowed",
    "understandingCallLimit",
    "understandingCallsUsed"
  );
  assert.deepEqual(Object.keys(diagnostic).sort(), expectedDiagnosticKeys.sort(), `${name} diagnostic must contain only the safe schema`);
  assert.equal(diagnostic.errorName, expected.errorName, `${name} errorName`);
  assert.equal(diagnostic.errorCode, expected.errorCode, `${name} errorCode`);
  assert.equal(diagnostic.httpStatus, expected.httpStatus, `${name} httpStatus`);
  assert.equal(diagnostic.timeout, expected.timeout, `${name} timeout`);
  assert.equal(diagnostic.errorCategory, expected.errorCategory, `${name} errorCategory`);
  assert.equal(diagnostic.model, expected.model);
  assert.equal(diagnostic.provider, expected.provider);
  assert.equal(diagnostic.providerErrorType, expected.providerErrorType || "");
  assert.equal(diagnostic.providerErrorCode, expected.providerErrorCode || "");
  assert.equal(diagnostic.providerErrorParam, expected.providerErrorParam || "");
  assert.equal(diagnostic.providerAttemptCount, expected.providerAttemptCount === undefined ? 1 : expected.providerAttemptCount);
  assert.equal(diagnostic.firstAttemptErrorCategory, expected.firstAttemptErrorCategory || expected.errorCategory);
  assert.equal(diagnostic.finalErrorCategory, expected.finalErrorCategory || expected.errorCategory);
  assert.equal(diagnostic.retryPerformed, Boolean(expected.retryPerformed));
  assert.equal(diagnostic.retrySucceeded, false);
  assert.equal(diagnostic.retryable, Boolean(expected.retryable));
  assert.equal(diagnostic.responseBodyPresent, Boolean(expected.responseBodyPresent));
  assert.equal(diagnostic.parsedOutputPresent, Boolean(expected.parsedOutputPresent));
  if (expected.coverageCriticResultStatus) {
    assert.equal(diagnostic.coverageCriticResultStatus, expected.coverageCriticResultStatus);
    assert.equal(diagnostic.coverageCriticErrorCategory, expected.coverageCriticErrorCategory);
    assert.equal(diagnostic.coverageCriticFailureCode, expected.coverageCriticFailureCode || "");
    assert.equal(diagnostic.repairRequired, expected.repairRequired);
    assert.equal(diagnostic.repairAllowed, expected.repairAllowed);
    assert.equal(diagnostic.understandingCallLimit, expected.understandingCallLimit);
    assert.equal(diagnostic.understandingCallsUsed, expected.understandingCallsUsed);
  }
  assert.equal(diagnostic.providerAttempts.length, diagnostic.providerAttemptCount);
  diagnostic.providerAttempts.forEach((attempt, index) => {
    assert.equal(attempt.attemptNumber, index + 1);
    assert.equal(Number.isInteger(attempt.durationMs), true);
    assert.equal(attempt.durationMs >= 0, true);
    assert.equal(attempt.timeoutMs, 10);
    assert.match(attempt.clientRequestId, /^[0-9a-f-]{36}$/i);
  });
  const serialized = JSON.stringify(diagnostic);
  for (const forbidden of Object.values(sensitive)) {
    assert.equal(serialized.includes(forbidden), false, `${name} diagnostic leaked ${forbidden}`);
  }
}

function openAiPlanner(fetchImpl, options = {}) {
  return new TestOnlyOpenAiConversationPlanner({
    apiKey: sensitive.apiKey,
    model,
    fetchImpl,
    timeoutMs: 10,
    retryDelayMs: options.retryDelayMs === undefined ? 0 : options.retryDelayMs
  });
}

function providerResponse(status, body, providerRequestId = "") {
  const text = String(body || "");
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => String(name || "").toLowerCase() === "x-request-id" ? providerRequestId : null
    },
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

function successfulProviderResponse(providerRequestId = "") {
  const output = validPlannerOutput();
  output.tasks = output.tasks.map(({ semanticCandidateIds, lodgingScopeId, ...task }) => task);
  output.semanticCandidates = output.semanticCandidates.map(({ candidateId, evidenceRefs, ...candidate }) => ({
    ...candidate,
    provenanceRelationCandidateIndexes: [0]
  }));
  output.tasks[0] = {
    ...output.tasks[0],
    sourceText: "入住",
    entity: { ...output.tasks[0].entity, rawText: "入住" }
  };
  output.contextRelationCandidates[0].evidenceRefs = [{
    eventId: "test-event",
    messageRef: "",
    startOffset: 0,
    endOffset: 2,
    quote: "入住"
  }];
  return providerResponse(200, JSON.stringify({
    output_text: JSON.stringify(output)
  }), providerRequestId);
}

async function plannerRetrySuccess({ name, firstFailure, expectedCategory }) {
  let fetchCount = 0;
  const diagnostics = [];
  const planner = openAiPlanner(async () => {
    fetchCount += 1;
    if (fetchCount === 1) return firstFailure();
    return successfulProviderResponse(`req_retry_${name}`);
  });
  const engine = new ConversationEngineV2({
    planner,
    persistence: plannerPersistence(),
    getProperty: () => property,
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => [],
    onDiagnostic: (entry) => diagnostics.push(entry)
  });
  const result = await engine.process({
    customerId: property.propertyId,
    channelId: "test",
    lineUserId: "guest",
    eventId: `planner-retry-${name}`,
    eventTimestamp: 1,
    messageText: "入住",
    sourceEvents: [{ eventId: "test-event", messageText: "入住" }]
  });
  assert.equal(fetchCount, 2, `${name} must make exactly one retry`);
  assert.equal(result.finalDecision.action, "reply", `${name} retry success must continue to a reply`);
  assert.notEqual(result.finalDecision.reasonCode, "planner_parse_failed", `${name} retry success must not use Planner fallback`);
  const plannerDiagnostic = diagnostics.find((entry) => entry.stage === "planner");
  assert.ok(plannerDiagnostic, `${name} must emit the successful Planner diagnostic`);
  const safeDiagnostic = formatSafeTestOnlyConversationTrace(plannerDiagnostic);
  assert.equal(safeDiagnostic.providerAttemptCount, 2);
  assert.equal(safeDiagnostic.firstAttemptErrorCategory, expectedCategory);
  assert.equal(safeDiagnostic.finalErrorCategory, "");
  assert.equal(safeDiagnostic.retryPerformed, true);
  assert.equal(safeDiagnostic.retrySucceeded, true);
  assert.equal(safeDiagnostic.providerAttempts.length, 2);
  assert.notEqual(safeDiagnostic.providerAttempts[0].clientRequestId, safeDiagnostic.providerAttempts[1].clientRequestId);
  assert.equal(safeDiagnostic.providerAttempts[1].providerRequestId, `req_retry_${name}`);
  const serialized = JSON.stringify(safeDiagnostic);
  for (const forbidden of Object.values(sensitive)) {
    assert.equal(serialized.includes(forbidden), false, `${name} diagnostic leaked ${forbidden}`);
  }
}

async function plannerContractFailureDoesNotRetry() {
  let fetchCount = 0;
  const diagnostics = [];
  const planner = openAiPlanner(async () => {
    fetchCount += 1;
    return providerResponse(200, JSON.stringify({
      output_text: JSON.stringify({ schemaVersion: 2 })
    }));
  });
  const engine = new ConversationEngineV2({
    planner,
    persistence: plannerPersistence(),
    getProperty: () => property,
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => [],
    onDiagnostic: (entry) => diagnostics.push(entry)
  });
  const result = await engine.process({
    customerId: property.propertyId,
    channelId: "test",
    lineUserId: "guest",
    eventId: "planner-local-contract-failure",
    eventTimestamp: 1,
    messageText: "test",
    sourceEvents: [{ eventId: "planner-local-contract-failure", messageText: "test" }]
  });
  assert.equal(fetchCount, 1, "a local Planner output contract failure must not retry the provider request");
  assert.equal(result.finalDecision.action, "handoff");
  assert.equal(result.finalDecision.reasonCode, "planner_parse_failed");
  const plannerDiagnostic = diagnostics.find((entry) => entry.stage === "planner_error");
  assert.equal(plannerDiagnostic.errorCategory, "local_contract_failure");
}

async function main() {
  for (const output of [null, undefined, "not-an-object", { schemaVersion: 2 }]) await engineResult(output);
  await duplicateTaskIdsContinueThroughEngine();

  const strict = plannerJsonSchema().properties.tasks.items;
  assert.ok(strict.required.includes("detailIntent"));
  assert.ok(strict.required.includes("eligibilityEvidence"));
  const valid = validPlannerOutput();
  assert.equal(validatePlannerOutput(valid).ok, true);
  valid.tasks[0].detailIntent = "free_text";
  assert.equal(validatePlannerOutput(valid).ok, false);
  const normalized = normalizePlannerOutput({ ...valid, tasks: [{ ...valid.tasks[0], detailIntent: "general" }, { ...valid.tasks[0], taskId: "t2", detailIntent: "free_text" }] });
  assert.equal(normalized.tasks.length, 2);
  assert.equal(normalized.tasks[1].detailIntent, "general");
  const missingPriceStayCandidate = validPlannerOutput();
  missingPriceStayCandidate.tasks[0] = {
    ...missingPriceStayCandidate.tasks[0],
    type: "price",
    requestedOutputs: ["price"],
    dependsOnStayContext: true,
    entity: { category: "policy", rawText: "lodging rate", canonicalCandidate: "price", confidence: 1 },
    stayCandidate: null
  };
  assert.equal(validatePlannerOutput(missingPriceStayCandidate).ok, false, "a stay-dependent task with a null candidate reproduces the deployed structural rejection");
  const normalizedMissingPriceStay = normalizePlannerOutput(missingPriceStayCandidate);
  assert.deepEqual(normalizedMissingPriceStay.tasks[0].stayCandidate, missingPriceStayCandidate.stay, "a sole stay-dependent task must receive the explicit empty top-level candidate before structural validation");
  assert.equal(validatePlannerOutput(normalizedMissingPriceStay).ok, true, "the controlled single-task repair must restore a valid fail-closed Planner contract");
  const statelessNullCandidate = normalizePlannerOutput(validPlannerOutput());
  assert.equal(statelessNullCandidate.tasks[0].stayCandidate, null, "a stateless task must retain its null stay candidate");
  const multipleMissingPriceStays = validPlannerOutput();
  multipleMissingPriceStays.tasks = [
    missingPriceStayCandidate.tasks[0],
    { ...missingPriceStayCandidate.tasks[0], candidateIndex: 1, taskId: "second-price" }
  ];
  const normalizedMultipleMissingPriceStays = normalizePlannerOutput(multipleMissingPriceStays);
  assert.equal(normalizedMultipleMissingPriceStays.tasks.every((task) => task.stayCandidate === null), true, "an empty top-level stay must not be projected across multiple request candidates");
  assert.equal(validatePlannerOutput(normalizedMultipleMissingPriceStays).ok, false, "ambiguous multi-task null candidates must remain fail closed");
  const successfulPlannerTrace = formatSafeTestOnlyConversationTrace({
    traceId: "successful-planner-trace",
    propertyId: property.propertyId,
    stage: "planner",
    parserSucceeded: true,
    taskCount: 1,
    tasks: valid.tasks,
    messageText: sensitive.guestMessage,
    prompt: sensitive.prompt,
    responseBody: sensitive.responseBody,
    apiKey: sensitive.apiKey
  });
  assert.equal(successfulPlannerTrace.parserSucceeded, true);
  assert.equal(successfulPlannerTrace.providerAttemptCount, undefined, "successful Planner traces must not add failure metadata");
  for (const forbidden of Object.values(sensitive)) {
    assert.equal(JSON.stringify(successfulPlannerTrace).includes(forbidden), false, `successful Planner trace leaked ${forbidden}`);
  }

  const successfulCriticTrace = formatSafeTestOnlyConversationTrace({
    traceId: "successful-critic-trace",
    propertyId: property.propertyId,
    stage: "planner",
    parserSucceeded: true,
    coverageCriticResultStatus: "complete",
    coverageCriticErrorCategory: "",
    coverageCriticFailureCode: "",
    repairRequired: false,
    repairAllowed: false,
    understandingCallsUsed: 2,
    understandingCallsLimit: 3
  });
  assert.equal(successfulCriticTrace.coverageCriticResultStatus, "complete", "successful Critic status must survive the safe trace projection");
  assert.equal(successfulCriticTrace.coverageCriticErrorCategory, "");
  assert.equal(successfulCriticTrace.coverageCriticFailureCode, "");
  assert.equal(successfulCriticTrace.repairRequired, false);
  assert.equal(successfulCriticTrace.repairAllowed, false);
  assert.equal(successfulCriticTrace.understandingCallsUsed, 2);
  assert.equal(successfulCriticTrace.understandingCallsLimit, 3);

  const coverageRepairTrace = formatSafeTestOnlyConversationTrace({
    traceId: "coverage-repair-trace",
    propertyId: property.propertyId,
    stage: "planner",
    parserSucceeded: true,
    taskCount: 2,
    tasks: valid.tasks,
    providerAttempts: [{ attemptNumber: 1 }, { attemptNumber: 2 }],
    coverageRepairPerformed: true,
    coverageRepairSucceeded: false,
    coverageRepairFallback: true,
    repairProvenance: [{
      kind: "coverage_repair",
      correlationId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
      taskId: "semantic-room-task",
      canonicalId: "inventory-room-secret",
      propertyId: property.propertyId,
      sourceText: sensitive.guestMessage
    }]
  });
  assert.equal(coverageRepairTrace.coverageRepairPerformed, true);
  assert.equal(coverageRepairTrace.coverageRepairSucceeded, false);
  assert.equal(coverageRepairTrace.coverageRepairFallback, true);
  assert.deepEqual(coverageRepairTrace.repairProvenance, [{ kind: "coverage_repair", correlationId: "abcdefab-cdef-4abc-8def-abcdefabcdef" }], "server safe Planner trace must retain only bounded opaque provenance");
  assert.equal(JSON.stringify(coverageRepairTrace.repairProvenance).includes("semantic-room-task"), false);
  assert.equal(JSON.stringify(coverageRepairTrace.repairProvenance).includes("inventory-room-secret"), false);
  assert.equal(JSON.stringify(coverageRepairTrace.repairProvenance).includes(property.propertyId), false);
  const semanticContractPrivacyTrace = formatSafeTestOnlyConversationTrace({
    traceId: "semantic-contract-privacy-trace",
    propertyId: property.propertyId,
    stage: "semantic_contract",
    inputTasks: [],
    outputTasks: [],
    validationPassed: true,
    semanticValidation: {
      repairedTasks: [{ taskId: "semantic-room-task", reason: "property_catalog_entity_grounding" }]
    },
    repairProvenance: [{ kind: "semantic_repair", correlationId: "abcdefab-cdef-4abc-8def-abcdefabcdef" }]
  });
  assert.equal(Object.hasOwn(semanticContractPrivacyTrace, "semanticValidation"), false, "server safe semantic-contract trace must not project internal repaired task IDs");
  assert.equal(Object.hasOwn(semanticContractPrivacyTrace, "repairProvenance"), false, "validation is the single authoritative safe stage for semantic repair provenance");
  assert.equal(JSON.stringify(semanticContractPrivacyTrace).includes("semantic-room-task"), false);
  const canonicalRepairTrace = formatSafeTestOnlyConversationTrace({
    traceId: "canonical-repair-trace",
    propertyId: property.propertyId,
    stage: "canonical_request",
    items: [{
      taskId: "semantic-room-task",
      repairCorrelationId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
      capability: "availability",
      canonicalEntity: { category: "room", canonicalId: "inventory-room-secret", status: "resolved" }
    }]
  });
  assert.equal(canonicalRepairTrace.items[0].repairCorrelationId, "abcdefab-cdef-4abc-8def-abcdefabcdef", "server safe canonical trace must preserve the opaque join ID");
  const inventoryPrivacyTrace = formatSafeTestOnlyConversationTrace({
    traceId: "inventory-privacy-trace",
    propertyId: property.propertyId,
    stage: "planner",
    parserSucceeded: true,
    taskCount: 1,
    tasks: valid.tasks,
    missingInformation: ["formal_subject:room_internal_secret", "formal_subject_coverage_overflow"]
  });
  assert.equal(JSON.stringify(inventoryPrivacyTrace).includes("room_internal_secret"), false, "safe diagnostics must not expose inventory canonical IDs");
  assert.equal(inventoryPrivacyTrace.missingInformation.includes("formal_subject_coverage_required"), true);

  await plannerRetrySuccess({
    name: "timeout-then-success",
    firstFailure: () => {
      const error = new Error("transient timeout");
      error.name = "AbortError";
      throw error;
    },
    expectedCategory: "timeout"
  });
  await plannerRetrySuccess({
    name: "network-then-success",
    firstFailure: () => { throw new Error("temporary network failure"); },
    expectedCategory: "network"
  });
  await plannerRetrySuccess({
    name: "rate-limit-then-success",
    firstFailure: () => providerResponse(429, JSON.stringify({ error: { type: "rate_limit_error", code: "rate_limit_exceeded", param: "requests" } })),
    expectedCategory: "rate_limit"
  });
  await plannerRetrySuccess({
    name: "provider-5xx-then-success",
    firstFailure: () => providerResponse(500, JSON.stringify({ error: { type: "server_error", code: "internal_error", param: "" } })),
    expectedCategory: "provider_5xx"
  });
  let firstSuccessAttemptCount = 0;
  const firstSuccessOutput = await openAiPlanner(async () => {
    firstSuccessAttemptCount += 1;
    return successfulProviderResponse();
  }).classify({ currentMessage: "入住", sourceEvents: [{ eventId: "test-event", messageRef: "", messageText: "入住" }], catalog: {}, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(firstSuccessAttemptCount, 1, "a successful first attempt must not issue a second request");
  assert.equal(firstSuccessOutput.schemaVersion, 2);
  assert.equal(openAiPlanner(async () => successfulProviderResponse(), { retryDelayMs: 999999 }).retryDelayMs, 1000, "retry delay must be bounded");
  await plannerContractFailureDoesNotRetry();

  const httpFailure = (status) => openAiPlanner(async () => providerResponse(status, JSON.stringify({
    raw: sensitive.responseBody
  })));
  await plannerFailureDiagnostic({
    name: "http-401",
    planner: httpFailure(401),
    expected: { errorName: "Error", errorCode: "planner_authentication_error", httpStatus: 401, timeout: false, errorCategory: "invalid_request", model, provider: "openai", responseBodyPresent: true }
  });
  await plannerFailureDiagnostic({
    name: "http-404",
    planner: httpFailure(404),
    expected: { errorName: "Error", errorCode: "planner_model_not_found", httpStatus: 404, timeout: false, errorCategory: "invalid_request", model, provider: "openai", responseBodyPresent: true }
  });
  await plannerFailureDiagnostic({
    name: "http-429",
    planner: httpFailure(429),
    expected: { errorName: "Error", errorCode: "planner_rate_limit", httpStatus: 429, timeout: false, errorCategory: "rate_limit", model, provider: "openai", providerAttemptCount: 2, retryPerformed: true, retryable: true, responseBodyPresent: true }
  });
  let provider5xxAttemptCount = 0;
  await plannerFailureDiagnostic({
    name: "http-503",
    planner: openAiPlanner(async () => {
      provider5xxAttemptCount += 1;
      return providerResponse(503, JSON.stringify({ raw: sensitive.responseBody }));
    }),
    expected: { errorName: "Error", errorCode: "planner_provider_error", httpStatus: 503, timeout: false, errorCategory: "provider_5xx", model, provider: "openai", providerAttemptCount: 2, retryPerformed: true, retryable: true, responseBodyPresent: true }
  });
  assert.equal(provider5xxAttemptCount, 2, "a persistent provider 5xx must stop after the one allowed retry");
  let http400AttemptCount = 0;
  await plannerFailureDiagnostic({
    name: "http-400-invalid-schema",
    planner: openAiPlanner(async () => {
      http400AttemptCount += 1;
      return providerResponse(400, JSON.stringify({
        error: {
          message: sensitive.providerMessage,
          type: "invalid_request_error",
          code: "invalid_json_schema",
          param: "text.format.schema"
        },
        raw: sensitive.responseBody
      }));
    }),
    expected: {
      errorName: "Error",
      errorCode: "planner_http_error",
      httpStatus: 400,
      timeout: false,
      errorCategory: "invalid_request",
      model,
      provider: "openai",
      providerErrorType: "invalid_request_error",
      providerErrorCode: "invalid_json_schema",
      providerErrorParam: "text.format.schema",
      responseBodyPresent: true
    }
  });
  assert.equal(http400AttemptCount, 1, "HTTP 400 must not be retried");
  await plannerFailureDiagnostic({
    name: "http-400-non-json",
    planner: openAiPlanner(async () => providerResponse(400, sensitive.responseBody)),
    expected: { errorName: "Error", errorCode: "planner_http_error", httpStatus: 400, timeout: false, errorCategory: "invalid_request", model, provider: "openai", responseBodyPresent: true }
  });
  const longProviderType = "a".repeat(160);
  const longProviderParam = "text.format.schema.".repeat(20);
  await plannerFailureDiagnostic({
    name: "http-400-provider-field-sanitization",
    planner: openAiPlanner(async () => providerResponse(400, JSON.stringify({
        error: {
          type: longProviderType,
          code: "invalid json schema!",
          param: longProviderParam
        }
      }))),
    expected: {
      errorName: "Error",
      errorCode: "planner_http_error",
      httpStatus: 400,
      timeout: false,
      errorCategory: "invalid_request",
      model,
      provider: "openai",
      providerErrorType: longProviderType.slice(0, 120),
      providerErrorCode: "",
      providerErrorParam: longProviderParam.slice(0, 200),
      responseBodyPresent: true
    }
  });
  let timeoutAttemptCount = 0;
  await plannerFailureDiagnostic({
    name: "timeout",
    planner: openAiPlanner(async () => {
      timeoutAttemptCount += 1;
      const error = new Error(`${sensitive.apiKey} ${sensitive.prompt}`);
      error.name = "AbortError";
      throw error;
    }),
    expected: { errorName: "AbortError", errorCode: "planner_timeout", httpStatus: 0, timeout: true, errorCategory: "timeout", model, provider: "openai", providerAttemptCount: 2, retryPerformed: true, retryable: true }
  });
  assert.equal(timeoutAttemptCount, 2, "a persistent timeout must stop after attempt 2");
  let emptyAttemptCount = 0;
  await plannerFailureDiagnostic({
    name: "empty-response",
    planner: openAiPlanner(async () => {
      emptyAttemptCount += 1;
      return providerResponse(200, "");
    }),
    expected: { errorName: "Error", errorCode: "planner_empty_response", httpStatus: 200, timeout: false, errorCategory: "empty_response", model, provider: "openai" }
  });
  assert.equal(emptyAttemptCount, 1, "empty responses must not be retried");
  let jsonParseAttemptCount = 0;
  await plannerFailureDiagnostic({
    name: "response-json-parse",
    planner: openAiPlanner(async () => {
      jsonParseAttemptCount += 1;
      return providerResponse(200, sensitive.responseBody);
    }),
    expected: { errorName: "SyntaxError", errorCode: "planner_parse_error", httpStatus: 200, timeout: false, errorCategory: "json_parse", model, provider: "openai", responseBodyPresent: true }
  });
  assert.equal(jsonParseAttemptCount, 1, "JSON parse failures must not be retried");
  await plannerFailureDiagnostic({
    name: "output-json-parse",
    planner: openAiPlanner(async () => providerResponse(200, JSON.stringify({ output_text: `{${sensitive.responseBody}` }))),
    expected: { errorName: "SyntaxError", errorCode: "planner_parse_error", httpStatus: 200, timeout: false, errorCategory: "json_parse", model, provider: "openai", responseBodyPresent: true, parsedOutputPresent: true }
  });
  let structuredOutputAttemptCount = 0;
  await plannerFailureDiagnostic({
    name: "structured-output-refusal",
    planner: openAiPlanner(async () => {
      structuredOutputAttemptCount += 1;
      return providerResponse(200, JSON.stringify({
        status: "incomplete",
        output: [{ type: "message", content: [{ type: "refusal", refusal: sensitive.providerMessage }] }]
      }));
    }),
    expected: { errorName: "Error", errorCode: "planner_structured_output_error", httpStatus: 200, timeout: false, errorCategory: "structured_output", model, provider: "openai", responseBodyPresent: true }
  });
  assert.equal(structuredOutputAttemptCount, 1, "structured output failures must not be retried");
  let networkAttemptCount = 0;
  await plannerFailureDiagnostic({
    name: "network",
    planner: openAiPlanner(async () => {
      networkAttemptCount += 1;
      throw new Error(`${sensitive.responseBody} ${sensitive.guestMessage}`);
    }),
    expected: { errorName: "Error", errorCode: "planner_network_error", httpStatus: 0, timeout: false, errorCategory: "network", model, provider: "openai", providerAttemptCount: 2, retryPerformed: true, retryable: true }
  });
  assert.equal(networkAttemptCount, 2, "a persistent network failure must stop after attempt 2");
  const criticBoundaryError = new Error(`${sensitive.guestMessage} ${sensitive.responseBody}`);
  Object.assign(criticBoundaryError, {
    code: "planner_local_contract_failure",
    errorCategory: "local_contract_failure",
    plannerModel: model,
    plannerProvider: "openai",
    providerAttemptCount: 1,
    firstAttemptErrorCategory: "local_contract_failure",
    finalErrorCategory: "local_contract_failure",
    coverageCriticResultStatus: "provider_failure",
    coverageCriticErrorCategory: "timeout",
    repairRequired: false,
    repairAllowed: false,
    understandingCallLimit: 3,
    understandingCallsUsed: 2,
    responseBodyPresent: true,
    parsedOutputPresent: true,
    providerAttempts: [{
      attemptNumber: 1,
      startedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:00:00.010Z",
      durationMs: 10,
      timeoutMs: 10,
      clientRequestId: "12345678-1234-4123-8123-123456789012",
      providerRequestId: "safe_request_id",
      errorCategory: "local_contract_failure",
      httpStatus: 0,
      responseBodyPresent: true,
      parsedOutputPresent: true
    }],
    criticOutput: { raw: sensitive.responseBody },
    sourceEvents: [{ messageText: sensitive.guestMessage }]
  });
  await plannerFailureDiagnostic({
    name: "coverage-critic-local-contract",
    planner: { model, provider: "openai", classify: async () => { throw criticBoundaryError; } },
    expected: {
      errorName: "Error",
      errorCode: "planner_local_contract_failure",
      httpStatus: 0,
      timeout: false,
      errorCategory: "local_contract_failure",
      model,
      provider: "openai",
      responseBodyPresent: true,
      parsedOutputPresent: true,
      coverageCriticResultStatus: "provider_failure",
      coverageCriticErrorCategory: "timeout",
      repairRequired: false,
      repairAllowed: false,
      understandingCallLimit: 3,
      understandingCallsUsed: 2
    }
  });
  await plannerFailureDiagnostic({
    name: "configuration",
    planner: null,
    expected: { errorName: "TypeError", errorCode: "planner_configuration_error", httpStatus: 0, timeout: false, errorCategory: "unknown", model: "", provider: "unknown", providerAttemptCount: 0 }
  });

  const throwingDiagnosticEngine = new ConversationEngineV2({
    planner: openAiPlanner(async () => { throw new Error("diagnostic callback test"); }),
    persistence: plannerPersistence(),
    getProperty: () => property,
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => [],
    onDiagnostic: (entry) => {
      if (entry.stage === "planner_error") throw new Error("diagnostic callback failed");
    }
  });
  const callbackFailureResult = await throwingDiagnosticEngine.process({
    customerId: property.propertyId,
    channelId: "test",
    lineUserId: "guest",
    eventId: "planner-error-callback",
    eventTimestamp: 1,
    messageText: "test"
  });
  assert.equal(callbackFailureResult.finalDecision.action, "handoff");
  assert.equal(callbackFailureResult.finalDecision.reasonCode, "planner_parse_failed");
  assert.equal(callbackFailureResult.replyText, SAFE_HANDOFF_TEXT);

  const logTemp = fs.mkdtempSync(path.join(os.tmpdir(), "planner-provider-log-"));
  const logSecret = "planner-provider-log-secret";
  const applicationLogs = [];
  const originalConsoleLog = console.log;
  const logProviders = { kind: "json", ...createJsonProviders({ dataFile: path.join(logTemp, "store.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json") }) };
  const logBinding = attachPropertyScopedLineBinding({ providers: logProviders, propertyId: "demo_homestay_a", channelSecret: logSecret, channelAccessToken: "planner-log-test-token" });
  const logApp = createApp({
    providers: logProviders,
    lineBindingEnv: logBinding.lineBindingEnv,
    conversationDebounceMs: 1,
    conversationPlannerV2: openAiPlanner(async () => providerResponse(429, JSON.stringify({
      error: {
        message: sensitive.providerMessage,
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
        param: "requests"
      },
      raw: sensitive.responseBody
    }))),
    lineReplyClientFactory: () => ({ replyMessageWithHttpInfo: async () => ({ httpResponse: { status: 200 } }) })
  });
  const logRunning = await logApp.start(0, "127.0.0.1");
  try {
    console.log = (...args) => applicationLogs.push(args.map(String).join(" "));
    await sendWebhook(logBinding, logRunning.url, "planner-provider-log-event", "test");
    await new Promise((resolve) => setTimeout(resolve, 120));
  } finally {
    console.log = originalConsoleLog;
    await logApp.stop();
    fs.rmSync(logTemp, { recursive: true, force: true });
  }
  const persistedPlannerLog = applicationLogs
    .map((line) => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .find((entry) => entry && entry.stage === "planner_error");
  assert.ok(persistedPlannerLog, "test-only application logs must persist planner_error");
  assert.ok(persistedPlannerLog.traceId, "persisted planner_error must be searchable by traceId");
  assert.equal(persistedPlannerLog.providerAttemptCount, 2);
  assert.equal(persistedPlannerLog.providerAttempts.length, 2);
  assert.equal(persistedPlannerLog.firstAttemptErrorCategory, "rate_limit");
  assert.equal(persistedPlannerLog.finalErrorCategory, "rate_limit");
  assert.equal(persistedPlannerLog.retryPerformed, true);
  assert.equal(persistedPlannerLog.retrySucceeded, false);
  assert.equal(persistedPlannerLog.errorCategory, "rate_limit");
  assert.equal(persistedPlannerLog.retryable, true);
  assert.equal(persistedPlannerLog.responseBodyPresent, true);
  assert.equal(persistedPlannerLog.parsedOutputPresent, false);
  assert.equal(persistedPlannerLog.providerErrorType, "rate_limit_error");
  assert.equal(persistedPlannerLog.providerErrorCode, "rate_limit_exceeded");
  assert.equal(persistedPlannerLog.providerErrorParam, "requests");
  const persistedSerialized = JSON.stringify(persistedPlannerLog);
  for (const forbidden of Object.values(sensitive)) {
    assert.equal(persistedSerialized.includes(forbidden), false, `application log leaked ${forbidden}`);
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planner-failure-safety-"));
  const dataFile = path.join(temp, "store.json");
  const secret = "planner-failure-secret";
  const replies = [];
  const diagnostics = [];
  const providers = { kind: "json", ...createJsonProviders({ dataFile, seedFile: path.resolve(__dirname, "../fixtures/seed.json") }) };
  const binding = attachPropertyScopedLineBinding({ providers, propertyId: "demo_homestay_a", channelSecret: secret, channelAccessToken: "planner-failure-token" });
  const app = createApp({
    providers,
    lineBindingEnv: binding.lineBindingEnv,
    conversationDebounceMs: 1,
    conversationPlannerV2: {
      classify: async ({ currentMessage }) => {
        if (currentMessage === "invalid relation") return invalidRelationOutput();
        if (currentMessage === "planner throws") throw new Error("planner webhook failure");
        return null;
      }
    },
    testOnlyOverrides: { onDiagnostic: (entry) => diagnostics.push(entry) },
    lineReplyClientFactory: () => ({ replyMessageWithHttpInfo: async (body) => { replies.push(body); return { httpResponse: { status: 200 } }; } })
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    await sendWebhook(binding, running.url, "planner-null-event", "test");
    await sendWebhook(binding, running.url, "invalid-relation-event", "invalid relation");
    await sendWebhook(binding, running.url, "planner-throw-event", "planner throws");
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(replies.length, 3);
    replies.forEach((body) => assert.ok(body.messages[0].text.length > 0, "contract failure must be delivered as a non-empty safe reply"));
    assert.ok(replies.every((body) => !body.messages[0].text.includes("SECRET_UNAUTHORIZED_FACT")), "unapproved facts must not enter the reply");
    assert.equal(replies[2].messages[0].text, SAFE_HANDOFF_TEXT, "Planner exception must retain the existing LINE fallback");
    const plannerFailureDecision = diagnostics.find((item) => item.stage === "final_decision" && item.reasonCode === "planner_parse_failed");
    assert.ok(plannerFailureDecision);
    assert.equal(plannerFailureDecision.decision, "handoff");

    const saved = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    const records = (saved.messageLogs.demo_homestay_a || []).filter((item) => String(item.eventId || "").startsWith("invalid-relation-event"));
    assert.ok(records.length > 0, "the invalid-relation event must have persisted records");
    assert.ok(records.every((item) => item.processingStatus !== "processing_failed"), "contract failure must not be persisted as processing_failed");
    const delivered = records.find((item) => item.eventId === "invalid-relation-event");
    assert.equal(delivered.processingStatus, "reply_succeeded", "the event must complete normal delivery");
    assert.equal(delivered.replyDelivered, true);
    const plannerFailureRecord = (saved.messageLogs.demo_homestay_a || []).find((item) => item.eventId === "planner-throw-event");
    assert.equal(plannerFailureRecord.decisionReason, "planner_parse_failed");
    assert.equal(plannerFailureRecord.humanHandoff, true);
    assert.equal(plannerFailureRecord.processingStatus, "reply_succeeded");
    assert.equal(plannerFailureRecord.replyDelivered, true);
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("planner failure safety: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
