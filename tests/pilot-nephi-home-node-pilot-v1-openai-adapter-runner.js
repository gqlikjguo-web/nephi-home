"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const {
  TestOnlyOpenAiStructuredClassifier,
  createTestOnlyOpenAiStructuredClassifierFromEnv
} = require(path.join(PILOT_ROOT, "lib/providers/test-only-openai-structured-classifier"));
const { StructuredClassifierProvider } = require(path.join(PILOT_ROOT, "lib/providers/contracts"));
const {
  createAiFirstDecisionPipeline,
  validateDecisionDetailed,
  DEFAULT_INTENTS,
  DEFAULT_ROUTES
} = require(path.join(PILOT_ROOT, "lib/ai-first-decision-pipeline"));
const {
  fixedReplySourceFor,
  formatSafeResult
} = require(path.join(PILOT_ROOT, "scripts/test-openai-structured-classifier"));
const { createApp } = require(path.join(PILOT_ROOT, "server"));
const { createJsonProviders } = require(path.join(PILOT_ROOT, "lib/providers/json-providers"));
const { attachPropertyScopedLineBinding } = require(path.join(PILOT_ROOT, "tests/helpers/property-scoped-line-webhook"));

const input = {
  propertyId: "demo_homestay_a",
  channelId: "line-channel-a",
  lineUserId: "U_test",
  currentMessage: "7/19 兩位，想詢問 301 房",
  currentMessages: ["7/19 兩位，想詢問 301 房"],
  recentMessages: [{ guestMessage: "請問有空房嗎？", createdAt: "2026-07-14T00:00:00.000Z" }],
  conversationState: { checkInDate: null, guestCount: null, roomType: null },
  accumulatedFields: { checkInDate: null, guestCount: null, roomType: null },
  currentDate: "2026-07-14",
  timeZone: "Asia/Taipei",
  availableIntents: DEFAULT_INTENTS,
  availableRoutes: DEFAULT_ROUTES,
  property: { rooms: [] }
};

function validDecision(overrides = {}) {
  return {
    intent: "availability",
    route: "auto_reply_allowed",
    confidence: 0.96,
    reason: "availability_complete",
    extractedFields: {
      checkInDate: "2026-07-19",
      checkOutDate: "2026-07-20",
      nights: 1,
      guestCount: 2,
      roomType: "room301",
      bookingType: null
    },
    missingFields: [],
    shouldIgnore: false,
    needsHuman: false,
    ...overrides
  };
}

function responseWith(decision) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "resp_test_only",
      object: "response",
      created_at: 1783987200,
      status: "completed",
      error: null,
      incomplete_details: null,
      model: "gpt-4.1-mini",
      output: [{
        id: "msg_test_only",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          annotations: [],
          logprobs: [],
          text: JSON.stringify(decision)
        }]
      }],
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 150
      }
    })
  };
}

function pipelineFor(classifier, timeoutMs = 100) {
  return createAiFirstDecisionPipeline({ classifier, timeoutMs, minConfidence: 0.7 });
}

function invalidField(validation, pathName) {
  return validation.invalidFields.find((item) => item.path === pathName);
}

async function resolveBridge(appOptions, eventId) {
  const app = createApp(appOptions);
  const running = await app.start(0, "127.0.0.1");
  try {
    const response = await fetch(`${running.url}/api/test-line/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-line-secret": "adapter-test-secret" },
      body: JSON.stringify({
        customerId: "demo_homestay_a",
        channelId: "local-test-channel",
        lineUserId: `U_${eventId}`,
        eventId,
        messageText: "需要協助"
      })
    });
    assert.equal(response.status, 200);
    return (await response.json()).data;
  } finally {
    await app.stop();
  }
}

async function sendSignedLineWebhook(binding, url, event) {
  const rawBody = JSON.stringify({ destination: "line-channel-a", events: [event] });
  const response = await binding.post(url, rawBody);
  return { status: response.status, body: await response.json() };
}

(async () => {
  let request;
  const adapter = new TestOnlyOpenAiStructuredClassifier({
    apiKey: "test-key-never-log",
    model: "test-structured-model",
    timeoutMs: 50,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return responseWith(validDecision());
    }
  });
  assert.ok(adapter instanceof StructuredClassifierProvider);
  const valid = await pipelineFor(adapter).decide(input);
  assert.equal(valid.intent, "availability");
  assert.equal(valid.extractedFields.roomType, "room301");
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "test-structured-model");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.equal(body.text.format.schema.properties.reason.pattern, "^[a-z0-9][a-z0-9_.-]{0,119}$");
  assert.equal(body.text.format.schema.properties.extractedFields.properties.checkInDate.pattern, "^\\d{4}-\\d{2}-\\d{2}$");
  assert.equal(body.text.format.schema.properties.extractedFields.properties.guestCount.minimum, 1);
  assert.equal(body.text.format.schema.properties.extractedFields.properties.guestCount.maximum, 50);
  assert.equal(body.text.format.schema.properties.extractedFields.properties.roomType.maxLength, 80);
  assert.equal(body.text.format.schema.properties.extractedFields.properties.roomType.pattern, ".*\\S.*");
  assert.equal(Object.hasOwn(body.text.format.schema.properties, "suggested_reply"), false);
  assert.equal(body.text.format.schema.properties.intent.enum.includes("availability"), true);
  const structuredContext = JSON.parse(body.input[1].content[0].text);
  assert.equal(structuredContext.currentDate, "2026-07-14");
  assert.equal(structuredContext.timeZone, "Asia/Taipei");
  assert.match(body.input[0].content[0].text, /nearest reasonable future date/i);
  assert.match(body.input[0].content[0].text, /today.*tomorrow.*day after tomorrow/i);
  assert.match(body.input[0].content[0].text, /early check-in.*actual request/i);
  assert.match(request.options.headers.authorization, /^Bearer /);

  assert.equal(typeof validateDecisionDetailed, "function");
  const completeValidation = validateDecisionDetailed(validDecision(), input);
  assert.ok(completeValidation.decision);
  assert.deepEqual(completeValidation.invalidFields, []);

  const missingRequired = validDecision();
  delete missingRequired.intent;
  assert.deepEqual(invalidField(validateDecisionDetailed(missingRequired, input), "intent"), {
    path: "intent", expected: "required", receivedType: "missing"
  });

  const wrongName = validDecision({ should_ignore: false });
  delete wrongName.shouldIgnore;
  const wrongNameValidation = validateDecisionDetailed(wrongName, input);
  assert.deepEqual(invalidField(wrongNameValidation, "should_ignore"), {
    path: "should_ignore", expected: "no additional property", receivedType: "boolean"
  });
  assert.equal(invalidField(wrongNameValidation, "shouldIgnore").receivedType, "missing");

  assert.deepEqual(invalidField(validateDecisionDetailed(validDecision({ confidence: "0.9" }), input), "confidence"), {
    path: "confidence", expected: "number between 0 and 1", receivedType: "string"
  });
  assert.deepEqual(invalidField(validateDecisionDetailed(validDecision({ confidence: 1.2 }), input), "confidence"), {
    path: "confidence", expected: "number between 0 and 1", receivedType: "number"
  });
  assert.deepEqual(invalidField(validateDecisionDetailed(validDecision({ reason: 123 }), input), "reason"), {
    path: "reason", expected: "lowercase reason code", receivedType: "number"
  });
  assert.deepEqual(invalidField(validateDecisionDetailed(validDecision({ extractedFields: "not-an-object" }), input), "extractedFields"), {
    path: "extractedFields", expected: "object", receivedType: "string"
  });
  assert.deepEqual(invalidField(validateDecisionDetailed(validDecision({ missingFields: { field: "guestCount" } }), input), "missingFields"), {
    path: "missingFields", expected: "array of allowed field names", receivedType: "object"
  });
  assert.equal(invalidField(validateDecisionDetailed(validDecision({ shouldIgnore: "false" }), input), "shouldIgnore").expected, "boolean");
  assert.equal(invalidField(validateDecisionDetailed(validDecision({ needsHuman: 0 }), input), "needsHuman").expected, "boolean");
  assert.deepEqual(invalidField(validateDecisionDetailed(validDecision({ unexpected: "sensitive-value" }), input), "unexpected"), {
    path: "unexpected", expected: "no additional property", receivedType: "string"
  });

  let localSchemaDiagnostic;
  const localSchemaPipeline = createAiFirstDecisionPipeline({
    classifier: { async classify() { return validDecision({ reason: "Availability needs dates" }); } },
    timeoutMs: 100,
    minConfidence: 0.7,
    onValidationDiagnostic: (value) => { localSchemaDiagnostic = value; }
  });
  const localSchemaFailure = await localSchemaPipeline.decide(input);
  assert.equal(localSchemaFailure.reason, "classifier_invalid_schema");
  assert.deepEqual(localSchemaDiagnostic.invalidFields, [{
    path: "reason",
    expected: "lowercase reason code",
    receivedType: "string"
  }]);
  assert.equal(JSON.stringify(localSchemaDiagnostic).includes("Availability needs dates"), false);

  const normalized = await adapter.classify(input);
  assert.equal(Object.hasOwn(normalized.extractedFields, "bookingType"), false);

  assert.equal(createTestOnlyOpenAiStructuredClassifierFromEnv({ env: {} }), null);
  assert.equal(createTestOnlyOpenAiStructuredClassifierFromEnv({
    env: { OPENAI_TEST_API_KEY: "x" }
  }), null);
  const notConfigured = await pipelineFor(null).decide(input);
  assert.equal(notConfigured.reason, "classifier_not_configured");
  assert.equal(notConfigured.needsHuman, true);

  const rawHttpError = "raw-upstream-body-with-sensitive-details";
  let httpDiagnostic;
  const httpAdapter = new TestOnlyOpenAiStructuredClassifier({
    apiKey: "test-key-never-log",
    model: "test-model",
    onDiagnostic: (value) => { httpDiagnostic = value; },
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => rawHttpError })
  });
  const httpFailure = await pipelineFor(httpAdapter).decide(input);
  assert.equal(httpFailure.reason, "classifier_exception");
  assert.equal(JSON.stringify(httpFailure).includes(rawHttpError), false);
  assert.deepEqual(httpDiagnostic, { code: "openai_http_error", httpStatus: 429 });

  const exceptionAdapter = new TestOnlyOpenAiStructuredClassifier({
    apiKey: "test-key-never-log",
    model: "test-model",
    fetchImpl: async () => { throw new Error("network details must stay private"); }
  });
  const exception = await pipelineFor(exceptionAdapter).decide(input);
  assert.equal(exception.reason, "classifier_exception");
  assert.equal(JSON.stringify(exception).includes("network details"), false);

  let timeoutDiagnostic;
  const timeoutAdapter = new TestOnlyOpenAiStructuredClassifier({
    apiKey: "test-key-never-log",
    model: "test-model",
    timeoutMs: 10,
    onDiagnostic: (value) => { timeoutDiagnostic = value; },
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })
  });
  const timeout = await pipelineFor(timeoutAdapter, 100).decide(input);
  assert.equal(timeout.reason, "classifier_timeout");
  assert.equal(timeout.needsHuman, true);
  assert.deepEqual(timeoutDiagnostic, { code: "openai_timeout", httpStatus: null });

  let parseDiagnostic;
  const parseAdapter = new TestOnlyOpenAiStructuredClassifier({
    apiKey: "test-key-never-log",
    model: "test-model",
    onDiagnostic: (value) => { parseDiagnostic = value; },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("raw parse details"); } })
  });
  const parseFailure = await pipelineFor(parseAdapter).decide(input);
  assert.equal(parseFailure.reason, "classifier_exception");
  assert.deepEqual(parseDiagnostic, { code: "openai_parse_error", httpStatus: 200 });

  let schemaDiagnostic;
  const schemaAdapter = new TestOnlyOpenAiStructuredClassifier({
    apiKey: "test-key-never-log",
    model: "test-model",
    onDiagnostic: (value) => { schemaDiagnostic = value; },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp_refusal",
        object: "response",
        status: "completed",
        output: [{
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "refusal", refusal: "sensitive refusal text" }]
        }]
      })
    })
  });
  const schemaFailure = await pipelineFor(schemaAdapter).decide(input);
  assert.equal(schemaFailure.reason, "classifier_exception");
  assert.deepEqual(schemaDiagnostic, { code: "openai_schema_error", httpStatus: 200 });

  let invalidDiagnostic;
  const invalidAdapter = new TestOnlyOpenAiStructuredClassifier({
    apiKey: "test-key-never-log",
    model: "test-model",
    onDiagnostic: (value) => { invalidDiagnostic = value; },
    fetchImpl: async () => responseWith(validDecision({ suggested_reply: "must never reach guest" }))
  });
  const invalid = await pipelineFor(invalidAdapter).decide(input);
  assert.equal(invalid.reason, "classifier_invalid_schema");
  assert.equal(JSON.stringify(invalid).includes("must never reach guest"), false);
  assert.deepEqual(formatSafeResult(invalid, invalidDiagnostic).diagnostic, {
    code: "openai_schema_error",
    httpStatus: 200
  });

  assert.equal(fixedReplySourceFor(valid), "availability_result_formatter");
  assert.equal(fixedReplySourceFor({ ...valid, route: "no_reply_silent_ignore", shouldIgnore: true }), "no_reply");
  assert.equal(fixedReplySourceFor({ ...valid, route: "human_handoff_required", needsHuman: true }), "fixed_human_handoff_template");
  assert.deepEqual(formatSafeResult(httpFailure, httpDiagnostic), {
    intent: "unknown",
    route: "human_handoff_required",
    confidence: 0,
    reason: "classifier_exception",
    extractedFields: {},
    missingFields: [],
    shouldIgnore: false,
    needsHuman: true,
    finalReplySource: "fixed_human_handoff_template",
    diagnostic: { code: "openai_http_error", httpStatus: 429 }
  });

  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-pilot-openai-adapter-"));
  try {
    const providers = createJsonProviders({
      dataFile: path.join(tempDir, "store.json"),
      seedFile: path.join(PILOT_ROOT, "fixtures/seed.json")
    });
    const binding = attachPropertyScopedLineBinding({ providers, propertyId: "demo_homestay_a", channelSecret: "adapter-line-secret", channelAccessToken: "adapter-line-token" });
    const common = {
      providers,
      testLineSecret: "adapter-test-secret",
      conversationDebounceMs: 1,
      classifierTimeoutMs: 20
    };
    const failureCases = [
      {
        eventId: "adapter-not-configured",
        options: { openAiTestEnv: {} },
        reason: "classifier_not_configured"
      },
      {
        eventId: "adapter-http-error",
        options: {
          openAiTestEnv: { OPENAI_TEST_API_KEY: "local-test-key", OPENAI_TEST_MODEL: "test-model" },
          openAiTestFetch: async () => ({ ok: false, status: 500 })
        },
        reason: "classifier_exception"
      },
      {
        eventId: "adapter-timeout",
        options: {
          openAiTestEnv: { OPENAI_TEST_API_KEY: "local-test-key", OPENAI_TEST_MODEL: "test-model" },
          openAiTestFetch: (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          })
        },
        reason: "classifier_timeout"
      },
      {
        eventId: "adapter-invalid-output",
        options: {
          openAiTestEnv: { OPENAI_TEST_API_KEY: "local-test-key", OPENAI_TEST_MODEL: "test-model" },
          openAiTestFetch: async () => responseWith(validDecision({ suggested_reply: "never persist this" }))
        },
        reason: "classifier_invalid_schema"
      }
    ];
    for (const item of failureCases) {
      const result = await resolveBridge({ ...common, ...item.options }, item.eventId);
      assert.equal(result.humanHandoff, true, item.eventId);
      assert.equal(result.needsReview, true, item.eventId);
      assert.equal(result.replyType, "human_handoff", item.eventId);
      const log = providers.persistence.findMessageByEventId("demo_homestay_a", item.eventId);
      assert.equal(log.needsReview, true, item.eventId);
      assert.equal(log.decisionReason, item.reason, item.eventId);
      assert.equal(JSON.stringify(log).includes("never persist this"), false, item.eventId);
    }

    let openAiRequest;
    const lineReplies = [];
    const lineApp = createApp({
      providers,
      now: () => new Date("2026-07-13T16:30:00.000Z"),
      openAiTestEnv: { OPENAI_TEST_API_KEY: "local-test-key", OPENAI_TEST_MODEL: "test-model" },
      openAiTestFetch: async (_url, options) => {
        openAiRequest = JSON.parse(options.body);
        return responseWith(validDecision());
      },
      conversationDebounceMs: 1,
      lineBindingEnv: binding.lineBindingEnv,
      lineReplyFetch: async (_url, options) => {
        lineReplies.push(JSON.parse(options.body));
        return { ok: true, status: 200, text: async () => "{}" };
      }
    });
    const running = await lineApp.start(0, "127.0.0.1");
    try {
      const accepted = await sendSignedLineWebhook(binding, running.url, {
        type: "message",
        webhookEventId: "adapter-real-line",
        timestamp: 1783987200000,
        replyToken: "adapter-reply-token",
        source: { type: "user", userId: "U_adapter_line" },
        message: { id: "message-adapter-real-line", type: "text", text: "請問 7/19 兩位住 301 房有空房嗎？" }
      });
      assert.equal(accepted.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(lineReplies.length, 1, "test-only LINE must use the real OpenAI adapter path once");
      const context = JSON.parse(openAiRequest.input[1].content[0].text);
      assert.equal(context.currentDate, "2026-07-14");
      assert.equal(context.timeZone, "Asia/Taipei");
      const log = providers.persistence.findMessageByEventId("demo_homestay_a", "adapter-real-line");
      assert.equal(log.processingStatus, "reply_succeeded");
      assert.equal(log.detectedIntent, "availability");
    } finally {
      await lineApp.stop();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 32, passCount: 32, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
