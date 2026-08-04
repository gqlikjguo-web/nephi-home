"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ACCEPTANCE_MATRIX,
  pollForDeployment,
  requestGithubOidcToken,
  validateAcceptanceResult,
  runAcceptanceMatrix,
  TEST_ONLY_ACCEPTANCE_AUDIENCE
} = require("../scripts/run-deployed-conversation-acceptance");

const root = path.resolve(__dirname, "../../..");
const expectedCommit = "c56c7df564fed841a65c851b94adc7fa820841f5";

(async () => {
  const caseNumbers = ACCEPTANCE_MATRIX.map((item) => item.id.slice(3, 6));
  assert.equal(ACCEPTANCE_MATRIX.length, 53, "the deployed matrix must retain all fixed real-guest cases");
  assert.deepEqual(caseNumbers, Array.from({ length: 53 }, (_, index) => String(index + 1).padStart(3, "0")), "fixed case ordering and identity must remain complete");
  assert.equal(ACCEPTANCE_MATRIX.reduce((sum, item) => sum + item.turns.length, 0), 61, "the source matrix must retain all 61 turns before channel exclusions");
  assert.ok(ACCEPTANCE_MATRIX.every((item) => Array.isArray(item.turns) && item.turns.length > 0));

  let healthCalls = 0;
  const health = await pollForDeployment({
    baseUrl: "https://test-only.example",
    expectedCommit,
    timeoutMs: 100,
    intervalMs: 0,
    fetchImpl: async () => {
      healthCalls += 1;
      const data = healthCalls === 1
        ? { status: "ready", testOnly: true, commit: "0000000000000000000000000000000000000000" }
        : { status: "ready", testOnly: true, commit: expectedCommit };
      return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
    }
  });
  assert.equal(health.commit, expectedCommit);
  assert.equal(healthCalls, 2, "health may be polled, but acceptance cases must not be retried");

  let oidcRequest = null;
  const oidcToken = await requestGithubOidcToken({
    requestUrl: "https://actions.example/id-token?existing=1",
    requestToken: "actions-request-secret",
    fetchImpl: async (url, options) => { oidcRequest = { url: String(url), options }; return { ok: true, status: 200, json: async () => ({ value: "short-lived-oidc-secret" }) }; }
  });
  assert.equal(oidcToken, "short-lived-oidc-secret");
  assert.equal(new URL(oidcRequest.url).searchParams.get("audience"), TEST_ONLY_ACCEPTANCE_AUDIENCE);
  assert.equal(oidcRequest.options.headers.authorization, "Bearer actions-request-secret");

  const safeResult = {
    traceId: "trace-1",
    eventId: "event-1",
    finalDecision: { action: "reply", reasonCode: "execution_answered" },
    claimValidation: { ok: true, errors: [] },
    finalResponse: { action: "reply", shouldReply: true, replyText: "民宿旁可停車。" },
    taskResults: [{ taskId: "parking", capability: "parking", type: "parking", status: "answered", reason: "", dataSource: "property_catalog", facts: { subject: "停車", status: "confirmed_yes", answer: "民宿旁可停車。" } }],
    trace: [
      { stage: "property_catalog", providerType: "postgres" },
      { stage: "planner", parserSucceeded: true }, { stage: "validation" }, { stage: "semantic_contract", validationPassed: true },
      { stage: "canonical_request" }, { stage: "formal_request" }, { stage: "query_plan" },
      { stage: "executor" }, { stage: "claim_validator" }, { stage: "final_decision" }
    ]
  };
  assert.equal(validateAcceptanceResult(safeResult, { expectedActions: ["reply"], expectedCapabilities: ["parking"] }).action, "reply");
  const multiCapabilityResult = { ...safeResult, taskResults: [...safeResult.taskResults, { taskId: "bbq", capability: "policy", type: "policy", status: "answered", reason: "", dataSource: "property_catalog", facts: { subject: "烤肉", answer: "依規範使用。" } }] };
  assert.equal(validateAcceptanceResult(multiCapabilityResult, { expectedActions: ["reply"], expectedCapabilities: [["parking", "amenity"], ["bbq", "policy"]] }).action, "reply");
  assert.throws(() => validateAcceptanceResult(safeResult, { expectedActions: ["reply"], expectedCapabilities: [["parking", "amenity"], ["bbq", "policy"]] }), /expected_capability_missing/);
  assert.throws(() => validateAcceptanceResult({ ...safeResult, finalResponse: { ...safeResult.finalResponse, replyText: "一定有房，已完成訂房" } }, { expectedActions: ["reply"] }), /unsafe_final_response/);
  assert.throws(() => validateAcceptanceResult({ ...safeResult, finalResponse: null }, { expectedActions: ["reply"] }), /final_response_required/);
  assert.throws(() => validateAcceptanceResult({ ...safeResult, taskResults: [{ ...safeResult.taskResults[0], facts: { ...safeResult.taskResults[0].facts, propertyId: "secret-scope" } }] }, { expectedActions: ["reply"] }), /unsafe_fact_key/);
  assert.throws(() => validateAcceptanceResult({ ...safeResult, taskResults: [{ ...safeResult.taskResults[0], facts: { availableInventory: [{ publicName: "401 雙人房", category: "room", capacity: 2, canonicalId: "room401" }] } }] }, { expectedActions: ["reply"] }), /unsafe_nested_fact_key/);

  async function capturePublicCaseLog(mode) {
    const originalMatrix = ACCEPTANCE_MATRIX.splice(0);
    const writes = [];
    let postCount = 0;
    ACCEPTANCE_MATRIX.push({ id: `public-log-${mode}`, mode, turns: [{ messageText: "parking", expectedActions: ["reply"], expectedCapabilities: ["parking"] }] });
    try {
      await runAcceptanceMatrix({
        baseUrl: "https://test-only.example",
        propertyId: "property-a",
        oidcToken: "not-logged",
        commit: expectedCommit,
        fetchImpl: async (_url, options) => {
          const body = JSON.parse(options.body);
          if (options.method === "DELETE") return { ok: true, status: 200, json: async () => ({ ok: true, data: { cleared: true } }) };
          postCount += 1;
          if (mode === "duplicate" && postCount === 2) return { ok: true, status: 200, json: async () => ({ ok: true, data: { duplicate: true, eventId: body.eventId } }) };
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, data: { ...safeResult, traceId: `trace-${mode}`, eventId: body.eventId } })
          };
        },
        write: (value) => writes.push(value)
      });
    } finally {
      ACCEPTANCE_MATRIX.splice(0, ACCEPTANCE_MATRIX.length, ...originalMatrix);
    }
    return writes;
  }

  for (const mode of ["duplicate", "clear"]) {
    const writes = await capturePublicCaseLog(mode);
    assert.equal(writes.length, 1, `${mode} must emit one bounded case record only`);
    assert.deepEqual(
      Object.keys(writes[0]).sort(),
      ["case", "claimValidationOk", "finalDecisionAction", "status", "traceId"].sort(),
      "public case logs must contain only the approved evidence summary"
    );
    const serializedLog = JSON.stringify(writes);
    for (const forbidden of ["民宿旁可停車。", "\"taskResults\":", "\"facts\":", "\"trace\":", "\"finalResponse\":", "\"eventId\":", "not-logged"]) {
      assert.equal(serializedLog.includes(forbidden), false, `public case logs must not expose ${forbidden}`);
    }
  }

  const originalMatrix = ACCEPTANCE_MATRIX.splice(0);
  const continuedRequests = [];
  const continuedWrites = [];
  let matrixFailure = null;
  ACCEPTANCE_MATRIX.push(
    { id: "collect-first-pass", turns: [{ messageText: "first", expectedActions: ["reply"], expectedCapabilities: ["parking"] }] },
    { id: "collect-middle-fail", turns: [{ messageText: "middle", expectedActions: ["clarification"], expectedCapabilities: ["parking"] }] },
    { id: "collect-last-pass", turns: [{ messageText: "last", expectedActions: ["reply"], expectedCapabilities: ["parking"] }] }
  );
  try {
    await runAcceptanceMatrix({
      baseUrl: "https://test-only.example",
      propertyId: "property-a",
      oidcToken: "PRIVATE_OIDC_TOKEN",
      commit: expectedCommit,
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        continuedRequests.push(body.messageText);
        const result = body.messageText === "middle"
          ? {
              ...safeResult,
              traceId: "trace-middle",
              eventId: body.eventId,
              finalDecision: { action: "reply", reasonCode: "PRIVATE_DECISION_REASON" },
              finalResponse: { action: "reply", shouldReply: true, replyText: "PRIVATE_FINAL_RESPONSE" },
              taskResults: [{
                ...safeResult.taskResults[0],
                reason: "PRIVATE_TASK_REASON",
                facts: { subject: "PRIVATE_FACT_SUBJECT", answer: "PRIVATE_FACT_ANSWER" }
              }],
              trace: safeResult.trace.map((entry) => ({ ...entry, privateDetail: "PRIVATE_TRACE_DETAIL" }))
            }
          : { ...safeResult, traceId: `trace-${body.messageText}`, eventId: body.eventId };
        return { ok: true, status: 200, json: async () => ({ ok: true, data: result }) };
      },
      write: (value) => continuedWrites.push(value)
    });
  } catch (error) {
    matrixFailure = error;
  } finally {
    ACCEPTANCE_MATRIX.splice(0, ACCEPTANCE_MATRIX.length, ...originalMatrix);
  }
  assert.deepEqual(continuedRequests, ["first", "middle", "last"], "a failed middle case must not prevent later cases from running");
  assert.equal(matrixFailure && matrixFailure.code, "deployed_acceptance_matrix_failed", "the completed matrix must still report an aggregate failure");
  assert.equal(matrixFailure && matrixFailure.failCount, 1);
  assert.equal(continuedWrites[0].status, "PASS", "successful case output must remain unchanged");
  assert.equal(continuedWrites[2].status, "PASS", "a later successful case must still emit its PASS record");
  assert.deepEqual(
    continuedWrites[1],
    {
      case: "collect-middle-fail",
      turn: 1,
      errorCode: "unexpected_final_action",
      finalDecisionAction: "reply",
      finalDecisionReasonCode: "PRIVATE_DECISION_REASON",
      claimValidationOk: true,
      tasks: [{ capability: "parking", status: "answered", reason: "PRIVATE_TASK_REASON", dataSource: "property_catalog" }]
    },
    "failed cases must emit only the approved bounded evidence"
  );
  const serializedFailure = JSON.stringify(continuedWrites[1]);
  for (const forbidden of ["PRIVATE_FINAL_RESPONSE", "PRIVATE_FACT_SUBJECT", "PRIVATE_FACT_ANSWER", "PRIVATE_TRACE_DETAIL", "PRIVATE_OIDC_TOKEN", "traceId", "eventId", "finalResponse", "facts", "trace"]) {
    assert.equal(serializedFailure.includes(forbidden), false, `failed case logs must not expose ${forbidden}`);
  }

  assert.throws(
    () => validateAcceptanceResult({ ...safeResult, taskResults: [{ ...safeResult.taskResults[0], dataSource: "   " }] }, { expectedActions: ["reply"] }),
    /answered_task_data_source_required/,
    "an answered task with a blank system source must fail deployed acceptance"
  );

  const render = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  const testService = render.split("  - type: web").find((block) => block.includes("name: nephi-home-node-pilot-test-only"));
  const gatewayService = render.split("  - type: web").find((block) => block.includes("name: nephi-home-junzan-line-gateway-test"));
  assert.match(testService, /TEST_ONLY_ACCEPTANCE_ENABLED\s*\r?\n\s*value: "true"/);
  assert.doesNotMatch(gatewayService, /TEST_ONLY_ACCEPTANCE_ENABLED/);

  const workflow = fs.readFileSync(path.join(root, ".github/workflows/test-only-ci.yml"), "utf8");
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /run-deployed-conversation-acceptance\.js/);
  assert.match(workflow, /needs:\s*verify/);
  assert.doesNotMatch(workflow, /continue-on-error|forced success/i);

  const deployedRunnerSource = fs.readFileSync(path.join(__dirname, "../scripts/run-deployed-conversation-acceptance.js"), "utf8");
  assert.doesNotMatch(deployedRunnerSource, /require\([^)]*pglite|createPglite|fake planner/i);
  assert.match(deployedRunnerSource, /FORBIDDEN_PROVIDER_MARKERS/, "deployed evidence must explicitly reject fake or local provider markers");
  assert.doesNotMatch(deployedRunnerSource, /console\.(?:log|error)\([^\n]*(?:oidcToken|requestToken)/, "OIDC tokens must never be passed to output calls");

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.equal(packageJson.scripts["test:deployed-acceptance-contract"], "node tests/test-only-acceptance-oidc-runner.js && node tests/deployed-conversation-acceptance-contract-runner.js && node tests/real-guest-deployed-acceptance-matrix-runner.js && node tests/test-only-conversation-acceptance-api-runner.js");
  assert.equal(packageJson.scripts.posttest, "node tests/test-only-acceptance-oidc-runner.js && node tests/deployed-conversation-acceptance-contract-runner.js && node tests/real-guest-deployed-acceptance-matrix-runner.js");

  console.log(JSON.stringify({ suite: "deployed-conversation-acceptance-contract", caseCount: 18, passCount: 18, failCount: 0 }));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
