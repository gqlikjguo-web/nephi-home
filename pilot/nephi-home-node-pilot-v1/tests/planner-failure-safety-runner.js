"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ConversationEngineV2, normalizePlannerOutput } = require("../lib/conversation-engine-v2/engine");
const { plannerJsonSchema, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { SAFE_HANDOFF_TEXT } = require("../lib/conversation-engine-v2/final-response-renderer");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");
const { createApp, formatSafeTestOnlyConversationTrace } = require("../server");

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
  return {
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
  };
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

function invalidRelationOutput() {
  return {
    ...validPlannerOutput(),
    tasks: [{ candidateIndex: 0, taskId: "availability", type: "availability", sourceText: "availability", detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, confidence: 1 }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "supplement_existing", candidateRequestCycleRefs: ["not-in-snapshot"], evidenceRefs: [{ eventId: "invalid-relation-event", startOffset: 0, endOffset: 7, quote: "invalid" }] }]
  };
}

async function sendWebhook(url, secret, eventId, text) {
  const payload = JSON.stringify({ destination: "line", events: [{ type: "message", webhookEventId: eventId, replyToken: `token-${eventId}`, timestamp: 1, source: { userId: "guest" }, message: { type: "text", id: `m-${eventId}`, text } }] });
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64");
  const response = await fetch(`${url}/api/test-line/webhook?customerId=demo_homestay_a`, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": signature }, body: payload });
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
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "errorCategory",
    "errorCode",
    "errorName",
    "httpStatus",
    "model",
    "propertyId",
    "provider",
    "providerErrorCode",
    "providerErrorParam",
    "providerErrorType",
    "scope",
    "stage",
    "timeout",
    "traceId"
  ].sort(), `${name} diagnostic must contain only the safe schema`);
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
  const serialized = JSON.stringify(diagnostic);
  for (const forbidden of Object.values(sensitive)) {
    assert.equal(serialized.includes(forbidden), false, `${name} diagnostic leaked ${forbidden}`);
  }
}

function openAiPlanner(fetchImpl) {
  return new TestOnlyOpenAiConversationPlanner({
    apiKey: sensitive.apiKey,
    model,
    fetchImpl,
    timeoutMs: 10
  });
}

async function main() {
  for (const output of [null, undefined, "not-an-object", { schemaVersion: 2 }]) await engineResult(output);

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

  const httpFailure = (status) => openAiPlanner(async () => ({
    ok: false,
    status,
    json: async () => ({ output_text: sensitive.responseBody })
  }));
  await plannerFailureDiagnostic({
    name: "http-401",
    planner: httpFailure(401),
    expected: { errorName: "Error", errorCode: "planner_authentication_error", httpStatus: 401, timeout: false, errorCategory: "authentication", model, provider: "openai" }
  });
  await plannerFailureDiagnostic({
    name: "http-404",
    planner: httpFailure(404),
    expected: { errorName: "Error", errorCode: "planner_model_not_found", httpStatus: 404, timeout: false, errorCategory: "provider", model, provider: "openai" }
  });
  await plannerFailureDiagnostic({
    name: "http-429",
    planner: httpFailure(429),
    expected: { errorName: "Error", errorCode: "planner_rate_limit", httpStatus: 429, timeout: false, errorCategory: "rate_limit", model, provider: "openai" }
  });
  await plannerFailureDiagnostic({
    name: "http-503",
    planner: httpFailure(503),
    expected: { errorName: "Error", errorCode: "planner_provider_error", httpStatus: 503, timeout: false, errorCategory: "provider", model, provider: "openai" }
  });
  await plannerFailureDiagnostic({
    name: "http-400-invalid-schema",
    planner: openAiPlanner(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: sensitive.providerMessage,
          type: "invalid_request_error",
          code: "invalid_json_schema",
          param: "text.format.schema"
        },
        raw: sensitive.responseBody
      })
    })),
    expected: {
      errorName: "Error",
      errorCode: "planner_http_error",
      httpStatus: 400,
      timeout: false,
      errorCategory: "provider",
      model,
      provider: "openai",
      providerErrorType: "invalid_request_error",
      providerErrorCode: "invalid_json_schema",
      providerErrorParam: "text.format.schema"
    }
  });
  await plannerFailureDiagnostic({
    name: "http-400-non-json",
    planner: openAiPlanner(async () => ({
      ok: false,
      status: 400,
      json: async () => { throw new SyntaxError(sensitive.responseBody); }
    })),
    expected: { errorName: "Error", errorCode: "planner_http_error", httpStatus: 400, timeout: false, errorCategory: "provider", model, provider: "openai" }
  });
  const longProviderType = "a".repeat(160);
  const longProviderParam = "text.format.schema.".repeat(20);
  await plannerFailureDiagnostic({
    name: "http-400-provider-field-sanitization",
    planner: openAiPlanner(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          type: longProviderType,
          code: "invalid json schema!",
          param: longProviderParam
        }
      })
    })),
    expected: {
      errorName: "Error",
      errorCode: "planner_http_error",
      httpStatus: 400,
      timeout: false,
      errorCategory: "provider",
      model,
      provider: "openai",
      providerErrorType: longProviderType.slice(0, 120),
      providerErrorCode: "",
      providerErrorParam: longProviderParam.slice(0, 200)
    }
  });
  await plannerFailureDiagnostic({
    name: "timeout",
    planner: openAiPlanner(async () => {
      const error = new Error(`${sensitive.apiKey} ${sensitive.prompt}`);
      error.name = "AbortError";
      throw error;
    }),
    expected: { errorName: "AbortError", errorCode: "planner_timeout", httpStatus: 0, timeout: true, errorCategory: "timeout", model, provider: "openai" }
  });
  await plannerFailureDiagnostic({
    name: "empty-response",
    planner: openAiPlanner(async () => ({ ok: true, status: 200, json: async () => ({ output_text: "" }) })),
    expected: { errorName: "Error", errorCode: "planner_empty_response", httpStatus: 0, timeout: false, errorCategory: "empty_response", model, provider: "openai" }
  });
  await plannerFailureDiagnostic({
    name: "parse",
    planner: openAiPlanner(async () => ({ ok: true, status: 200, json: async () => ({ output_text: `{${sensitive.responseBody}` }) })),
    expected: { errorName: "SyntaxError", errorCode: "planner_parse_error", httpStatus: 0, timeout: false, errorCategory: "parse", model, provider: "openai" }
  });
  await plannerFailureDiagnostic({
    name: "generic",
    planner: openAiPlanner(async () => { throw new Error(`${sensitive.responseBody} ${sensitive.guestMessage}`); }),
    expected: { errorName: "Error", errorCode: "planner_unknown_error", httpStatus: 0, timeout: false, errorCategory: "unknown", model, provider: "openai" }
  });
  await plannerFailureDiagnostic({
    name: "configuration",
    planner: null,
    expected: { errorName: "TypeError", errorCode: "planner_configuration_error", httpStatus: 0, timeout: false, errorCategory: "configuration", model: "", provider: "unknown" }
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

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planner-failure-safety-"));
  const dataFile = path.join(temp, "store.json");
  const secret = "planner-failure-secret";
  const replies = [];
  const diagnostics = [];
  const app = createApp({
    dataFile,
    seedFile: path.resolve(__dirname, "../fixtures/seed.json"),
    lineChannelSecret: secret,
    lineChannelAccessToken: "token",
    conversationDebounceMs: 1,
    lineChannelIdentityGuardRequired: false,
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
    await sendWebhook(running.url, secret, "planner-null-event", "test");
    await sendWebhook(running.url, secret, "invalid-relation-event", "invalid relation");
    await sendWebhook(running.url, secret, "planner-throw-event", "planner throws");
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
