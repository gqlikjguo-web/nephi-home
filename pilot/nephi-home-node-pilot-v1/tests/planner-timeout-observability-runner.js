"use strict";

const assert = require("node:assert/strict");
const {
  TestOnlyOpenAiConversationPlanner,
  createTestOnlyOpenAiConversationPlannerFromEnv
} = require("../lib/providers/test-only-openai-conversation-planner");

const PROVIDER_DIAGNOSTIC = Symbol.for("junzan.plannerProviderDiagnostic");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sensitive = {
  apiKey: "sk-timeout-observability-secret",
  guestMessage: "SECRET_GUEST_MESSAGE",
  propertyData: "SECRET_PROPERTY_DATA",
  rawBody: "SECRET_RAW_RESPONSE"
};

function validPlannerOutput() {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 1 },
    stateOperations: [],
    stay: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    },
    tasks: [],
    contextRelationCandidates: [],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: true,
    reason: "test"
  };
}

function response(status, body, requestId = "") {
  const text = String(body || "");
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "x-request-id" ? requestId : null;
      }
    },
    text: async () => text
  };
}

function successResponse(requestId = "") {
  return response(200, JSON.stringify({
    output_text: JSON.stringify(validPlannerOutput())
  }), requestId);
}

function coverageCriticSuccessResponse(requestId = "") {
  return response(200, JSON.stringify({
    output_text: JSON.stringify({ missingRequests: [] })
  }), requestId);
}

function planner(fetchImpl, overrides = {}) {
  return new TestOnlyOpenAiConversationPlanner({
    apiKey: sensitive.apiKey,
    model: "gpt-4.1-mini",
    fetchImpl,
    timeoutMs: overrides.timeoutMs === undefined ? 15000 : overrides.timeoutMs,
    retryDelayMs: overrides.retryDelayMs,
    waitImpl: overrides.waitImpl,
    nowMs: overrides.nowMs,
    requestIdFactory: overrides.requestIdFactory
  });
}

function classifyInput() {
  return {
    currentMessage: sensitive.guestMessage,
    currentMessages: [sensitive.guestMessage],
    sourceEvents: [],
    eventTimestamp: 1,
    catalog: { propertyId: "property_a", marker: sensitive.propertyData },
    contextSnapshot: { scope: {}, cycles: [] }
  };
}

async function capturePlannerError(targetPlanner) {
  try {
    await targetPlanner.classify(classifyInput());
  } catch (error) {
    return error;
  }
  assert.fail("expected Planner failure");
}

function assertSafeAttempt(attempt) {
  assert.deepEqual(Object.keys(attempt).sort(), [
    "attemptNumber",
    "clientRequestId",
    "completedAt",
    "durationMs",
    "errorCategory",
    "httpStatus",
    "parsedOutputPresent",
    "providerRequestId",
    "responseBodyPresent",
    "retryable",
    "startedAt",
    "timeout",
    "timeoutMs"
  ].sort());
  assert.equal(Number.isInteger(attempt.attemptNumber), true);
  assert.equal(Number.isInteger(attempt.durationMs), true);
  assert.equal(attempt.durationMs >= 0, true);
  assert.equal(attempt.timeoutMs, 15000);
  assert.match(attempt.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(attempt.completedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(attempt.clientRequestId, UUID_PATTERN);
}

async function main() {
  const defaultTimeoutSuccess = await new TestOnlyOpenAiConversationPlanner({
    apiKey: sensitive.apiKey,
    model: "gpt-4.1-mini",
    fetchImpl: async () => successResponse("req_provider_default_timeout")
  }).classify(classifyInput());
  assert.equal(defaultTimeoutSuccess[PROVIDER_DIAGNOSTIC].providerAttempts[0].timeoutMs, 30000,
    "the live Planner default must allow a bounded 30-second provider attempt");

  const envDefaultTimeoutBodies = [];
  const envDefaultTimeoutSuccess = await createTestOnlyOpenAiConversationPlannerFromEnv({
    env: {
      OPENAI_TEST_API_KEY: sensitive.apiKey,
      OPENAI_TEST_MODEL: "gpt-4.1-mini"
    },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      envDefaultTimeoutBodies.push(body);
      return body.text.format.name === "junzan_coverage_critic_v1"
        ? coverageCriticSuccessResponse("req_provider_env_default_timeout_critic")
        : successResponse("req_provider_env_default_timeout");
    }
  }).classify(classifyInput());
  assert.equal(envDefaultTimeoutSuccess[PROVIDER_DIAGNOSTIC].providerAttempts[0].timeoutMs, 30000,
    "the live Planner environment factory must retain the bounded 30-second default");
  assert.deepEqual(envDefaultTimeoutBodies.map((body) => body.text.format.name),
    ["junzan_conversation_plan_v2", "junzan_coverage_critic_v1"],
    "the environment factory must use one bounded Planner call and one bounded Critic call");

  const sentHeaders = [];
  const sentBodies = [];
  const success = await planner(async (_url, options) => {
    sentHeaders.push(options.headers);
    sentBodies.push(JSON.parse(options.body));
    return successResponse("req_provider_success");
  }).classify(classifyInput());

  assert.equal(sentHeaders.length, 1);
  assert.match(sentHeaders[0]["X-Client-Request-Id"], UUID_PATTERN,
    "each provider attempt must send an independent X-Client-Request-Id");
  assert.equal(Object.hasOwn(sentBodies[0], "temperature"), false,
    "the production Planner must not rely on an unproven sampling override for semantic correctness");
  assert.equal(Object.hasOwn(sentBodies[0], "top_p"), false,
    "the Planner must not combine temperature with nucleus sampling");
  const successDiagnostic = success[PROVIDER_DIAGNOSTIC];
  assert.ok(successDiagnostic, "a successful first attempt must retain safe attempt diagnostics");
  assert.equal(successDiagnostic.providerAttemptCount, 1);
  assert.equal(successDiagnostic.providerAttempts.length, 1);
  assertSafeAttempt(successDiagnostic.providerAttempts[0]);
  assert.equal(successDiagnostic.providerAttempts[0].providerRequestId, "req_provider_success");
  assert.equal(successDiagnostic.providerAttempts[0].errorCategory, "");
  assert.equal(successDiagnostic.providerAttempts[0].httpStatus, 200);
  assert.equal(successDiagnostic.providerAttempts[0].responseBodyPresent, true);
  assert.equal(successDiagnostic.providerAttempts[0].parsedOutputPresent, true);

  const delays = [];
  const requestIds = [];
  let transientCount = 0;
  const retrySuccess = await planner(async (_url, options) => {
    transientCount += 1;
    requestIds.push(options.headers["X-Client-Request-Id"]);
    if (transientCount === 1) {
      const error = new Error("temporary network failure");
      error.name = "TypeError";
      throw error;
    }
    return successResponse("req_provider_retry");
  }, {
    waitImpl: async (delayMs) => { delays.push(delayMs); }
  }).classify(classifyInput());
  const retryDiagnostic = retrySuccess[PROVIDER_DIAGNOSTIC];
  assert.deepEqual(delays, [750], "retry must use the bounded 750 ms backoff");
  assert.equal(new Set(requestIds).size, 2, "attempts must never reuse a client request ID");
  assert.equal(retryDiagnostic.providerAttemptCount, 2);
  assert.equal(retryDiagnostic.retryPerformed, true);
  assert.equal(retryDiagnostic.retrySucceeded, true);
  assert.equal(retryDiagnostic.providerAttempts.length, 2);
  assert.equal(retryDiagnostic.providerAttempts[0].errorCategory, "network");
  assert.equal(retryDiagnostic.providerAttempts[0].retryable, true);
  assert.equal(retryDiagnostic.providerAttempts[1].providerRequestId, "req_provider_retry");
  retryDiagnostic.providerAttempts.forEach(assertSafeAttempt);

  let exhaustedCount = 0;
  let exhaustedError;
  const timeoutClock = [
    Date.parse("2026-07-28T04:00:00.000Z"),
    Date.parse("2026-07-28T04:00:15.000Z"),
    Date.parse("2026-07-28T04:00:15.750Z"),
    Date.parse("2026-07-28T04:00:30.750Z")
  ];
  try {
    await planner(async () => {
      exhaustedCount += 1;
      const error = new Error("provider timeout");
      error.name = "AbortError";
      throw error;
    }, {
      waitImpl: async (delayMs) => { delays.push(delayMs); },
      nowMs: () => timeoutClock.shift()
    }).classify(classifyInput());
  } catch (error) {
    exhaustedError = error;
  }
  assert.ok(exhaustedError, "an exhausted timeout must fail");
  assert.equal(exhaustedCount, 2, "retry exhaustion must stop after attempt 2");
  assert.equal(exhaustedError.providerAttempts.length, 2);
  exhaustedError.providerAttempts.forEach((attempt, index) => {
    assertSafeAttempt(attempt);
    assert.equal(attempt.attemptNumber, index + 1);
    assert.equal(attempt.timeout, true);
    assert.equal(attempt.errorCategory, "timeout");
    assert.equal(attempt.retryable, true);
    assert.equal(attempt.durationMs, 15000);
  });
  assert.equal(exhaustedError.providerAttempts[0].startedAt, "2026-07-28T04:00:00.000Z");
  assert.equal(exhaustedError.providerAttempts[0].completedAt, "2026-07-28T04:00:15.000Z");
  assert.equal(exhaustedError.providerAttempts[1].startedAt, "2026-07-28T04:00:15.750Z");
  assert.equal(exhaustedError.providerAttempts[1].completedAt, "2026-07-28T04:00:30.750Z");

  let invalidRequestCount = 0;
  let invalidRequestError;
  try {
    await planner(async () => {
      invalidRequestCount += 1;
      return response(400, JSON.stringify({
        error: {
          message: sensitive.rawBody,
          type: "invalid_request_error",
          code: "invalid_json_schema",
          param: "text.format.schema"
        }
      }), "req_provider_400");
    }).classify(classifyInput());
  } catch (error) {
    invalidRequestError = error;
  }
  assert.ok(invalidRequestError);
  assert.equal(invalidRequestCount, 1, "provider 4xx must not retry");
  assert.equal(invalidRequestError.providerAttempts.length, 1);
  assert.equal(invalidRequestError.providerAttempts[0].errorCategory, "provider_4xx");

  const emptyError = await capturePlannerError(planner(async () => response(200, "")));
  assert.equal(emptyError.providerAttempts.length, 1);
  assert.equal(emptyError.providerAttempts[0].errorCategory, "empty_response");

  const responseParseError = await capturePlannerError(planner(async () =>
    response(200, sensitive.rawBody)));
  assert.equal(responseParseError.providerAttempts.length, 1);
  assert.equal(responseParseError.providerAttempts[0].errorCategory, "parse_failure");

  const structuredOutputError = await capturePlannerError(planner(async () =>
    response(200, JSON.stringify({
      status: "incomplete",
      output: [{ type: "message", content: [{ type: "refusal", refusal: sensitive.rawBody }] }]
    }))));
  assert.equal(structuredOutputError.providerAttempts.length, 1);
  assert.equal(structuredOutputError.providerAttempts[0].errorCategory, "structured_output_failure");

  let abortDrivenCount = 0;
  const abortDrivenError = await capturePlannerError(planner(async (_url, options) => {
    abortDrivenCount += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted by timeout");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  }, {
    timeoutMs: 5,
    retryDelayMs: 0,
    waitImpl: async () => {}
  }));
  assert.equal(abortDrivenCount, 2);
  assert.equal(abortDrivenError.providerAttempts.length, 2);
  abortDrivenError.providerAttempts.forEach((attempt) => {
    assert.equal(attempt.timeoutMs, 5);
    assert.equal(attempt.timeout, true);
    assert.equal(attempt.errorCategory, "timeout");
    assert.equal(attempt.durationMs >= 1, true);
  });

  const serialized = JSON.stringify({
    successDiagnostic,
    retryDiagnostic,
    exhaustedAttempts: exhaustedError.providerAttempts,
    invalidRequestAttempts: invalidRequestError.providerAttempts,
    emptyAttempts: emptyError.providerAttempts,
    responseParseAttempts: responseParseError.providerAttempts,
    structuredOutputAttempts: structuredOutputError.providerAttempts,
    abortDrivenAttempts: abortDrivenError.providerAttempts
  });
  for (const forbidden of Object.values(sensitive)) {
    assert.equal(serialized.includes(forbidden), false, `attempt diagnostics leaked ${forbidden}`);
  }
  assert.equal(serialized.includes("authorization"), false);
  assert.equal(serialized.includes("headers"), false);
  assert.equal(serialized.includes("stack"), false);

  console.log("planner timeout observability: PASS");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
