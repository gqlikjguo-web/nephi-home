"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ACCEPTANCE_MATRIX,
  DEPLOYED_ACCEPTANCE_MATRIX,
  pollForDeployment,
  requestGithubOidcToken,
  validateAcceptanceResult,
  assessFinalResponseEvidence,
  writeAcceptanceReport,
  runAcceptanceMatrix,
  selectAcceptanceMatrix,
  validateWorkflowIdentity,
  acceptanceMatrixForMode,
  validateTargetPreflightAttribution,
  TARGET_PREFLIGHT_TURNS,
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
    claimValidation: { ok: true, errors: [], coveredTaskIds: ["parking"], missingTaskIds: [], unexpectedTaskIds: [] },
    finalResponse: { action: "reply", shouldReply: true, replyText: "民宿旁可停車。" },
    taskResults: [{ taskId: "parking", capability: "parking", type: "parking", status: "answered", reason: "", dataSource: "property_catalog", facts: { subject: "停車", status: "confirmed_yes", answer: "民宿旁可停車。" } }],
    trace: [
      { stage: "property_catalog", providerType: "postgres" },
      { stage: "planner", parserSucceeded: true, semanticLedgerBoundaries: [{
        stage: "compile_after",
        candidateCount: 1,
        validCandidateCount: 0,
        invalidCandidateCount: 1,
        ownershipCount: 0,
        failureCodes: ["evidence_refs"],
        evidenceFailureCodes: ["missing_refs"],
        candidates: [{ candidateOrdinal: 0, coverageStatus: "bound", lifecycle: "bound", provenancePresent: false, provenanceCount: 0, provenanceRelationCandidateIndexes: [], verifiedRelationCount: 0, evidenceRefCount: 0, valid: false, failureCodes: ["evidence_refs"], missingRefsReason: "bound_missing_provenance", provenanceRelations: [] }]
      }] }, { stage: "validation" }, { stage: "semantic_contract", validationPassed: true },
      { stage: "canonical_request" }, { stage: "formal_request" }, { stage: "query_plan" },
      { stage: "executor" }, { stage: "claim_validator" }, { stage: "final_decision" }
    ]
  };
  assert.equal(validateAcceptanceResult(safeResult, { expectedActions: ["reply"], expectedCapabilities: ["parking"] }).action, "reply");
  const supportedAssessment = assessFinalResponseEvidence(safeResult, { expectedActions: ["reply"], expectedCapabilities: ["parking"] });
  assert.equal(supportedAssessment.status, "PASS", "an exact Engine FinalResponse grounded in allowlisted formal facts may pass");
  assert.deepEqual(supportedAssessment.reasons, []);
  const unprovenAssessment = assessFinalResponseEvidence(
    { ...safeResult, finalResponse: { ...safeResult.finalResponse, replyText: "" } },
    { expectedActions: ["reply"], expectedCapabilities: ["parking"] }
  );
  assert.equal(unprovenAssessment.status, "FAIL", "a reply without an actual Engine FinalResponse must fail closed");
  assert.ok(unprovenAssessment.reasons.includes("reply_text_required_for_final_action"));
  const uncoveredAssessment = assessFinalResponseEvidence(
    { ...safeResult, claimValidation: { ...safeResult.claimValidation, coveredTaskIds: [], missingTaskIds: ["parking"] } },
    { expectedActions: ["reply"], expectedCapabilities: ["parking"] }
  );
  assert.equal(uncoveredAssessment.status, "FAIL", "an answered task not covered by the existing Claim Validator must fail closed");
  assert.ok(uncoveredAssessment.reasons.includes("answered_task_not_covered_by_claim_validator"));

  const reportDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-acceptance-report-"));
  try {
    const report = {
      schemaVersion: 1,
      commit: expectedCommit,
      generatedAt: "2026-08-04T08:00:00.000Z",
      summary: { caseCount: 1, passCount: 0, failCount: 1 },
      cases: [{
        caseId: "report-private-case",
        status: "FAIL",
        turns: [{
          turn: 1,
          guestQuestion: "PRIVATE_GUEST_QUESTION",
          formalEvidence: [{ capability: "parking", status: "answered", reason: "", dataSource: "property_catalog", facts: { subject: "parking", answer: "PRIVATE_FORMAL_FACT" } }],
          finalResponse: { action: "reply", shouldReply: true, replyText: "PRIVATE_FINAL_RESPONSE" },
          assessment: { status: "FAIL", reasons: ["reply_text_required_for_final_action"] }
        }]
      }]
    };
    const files = writeAcceptanceReport(report, reportDirectory);
    const json = fs.readFileSync(files.jsonPath, "utf8");
    const markdown = fs.readFileSync(files.markdownPath, "utf8");
    for (const required of ["PRIVATE_GUEST_QUESTION", "PRIVATE_FORMAL_FACT", "PRIVATE_FINAL_RESPONSE", "reply_text_required_for_final_action"]) {
      assert.equal(json.includes(required), true, `private JSON artifact must contain ${required}`);
      assert.equal(markdown.includes(required), true, `private Markdown artifact must contain ${required}`);
    }
  } finally {
    fs.rmSync(reportDirectory, { recursive: true, force: true });
  }
  const multiCapabilityResult = { ...safeResult, taskResults: [...safeResult.taskResults, { taskId: "bbq", capability: "policy", type: "policy", status: "answered", reason: "", dataSource: "property_catalog", facts: { subject: "烤肉", answer: "依規範使用。" } }] };
  assert.equal(validateAcceptanceResult(multiCapabilityResult, { expectedActions: ["reply"], expectedCapabilities: [["parking", "amenity"], ["bbq", "policy"]] }).action, "reply");
  assert.throws(() => validateAcceptanceResult(safeResult, { expectedActions: ["reply"], expectedCapabilities: [["parking", "amenity"], ["bbq", "policy"]] }), /expected_capability_missing/);
  const incompleteMultiQuestion = {
    ...safeResult,
    finalDecision: { action: "clarification", reasonCode: "missing_information" },
    finalResponse: { action: "clarification", shouldReply: true, replyText: "15:00\n請補充入住日期。" },
    taskResults: [
      { ...safeResult.taskResults[0], taskId: "price", capability: "price", type: "price", status: "needs_clarification", dataSource: "", facts: {} },
      { ...safeResult.taskResults[0], taskId: "check-in", capability: "policy", type: "policy", facts: { subject: "入住", status: "confirmed_yes", answer: "15:00" } }
    ],
    claimValidation: { ok: true, errors: [], coveredTaskIds: ["price", "check-in"], missingTaskIds: [], unexpectedTaskIds: [] },
    trace: safeResult.trace.map((entry) => entry.stage === "canonical_request" ? {
      ...entry,
      items: [
        { taskId: "price", capability: "price", canonicalEntity: { category: "bundle", canonicalId: "bundle-a", status: "resolved" } },
        { taskId: "check-in", capability: "policy", canonicalEntity: { category: "policy", canonicalId: "check_in", status: "resolved" } }
      ]
    } : entry)
  };
  assert.throws(
    () => validateAcceptanceResult(incompleteMultiQuestion, { expectedActions: ["clarification"], expectedSemantic: ["price", "pool", "check_in"] }),
    /expected_semantic_evidence_missing:pool/,
    "one generic policy task must not make an omitted pool question pass"
  );
  const incompleteAssessment = assessFinalResponseEvidence(incompleteMultiQuestion, { expectedSemantic: ["price", "pool", "check_in"] });
  assert.equal(incompleteAssessment.status, "FAIL", "an omitted explicit semantic subject must not be reported as a complete answer");
  assert.ok(incompleteAssessment.reasons.includes("expected_semantic_evidence_missing:pool"));
  assert.throws(() => validateAcceptanceResult({ ...safeResult, finalResponse: { ...safeResult.finalResponse, replyText: "一定有房，已完成訂房" } }, { expectedActions: ["reply"] }), /unsafe_final_response/);
  assert.throws(() => validateAcceptanceResult({ ...safeResult, finalResponse: null }, { expectedActions: ["reply"] }), /final_response_required/);
  assert.throws(() => validateAcceptanceResult({ ...safeResult, taskResults: [{ ...safeResult.taskResults[0], facts: { ...safeResult.taskResults[0].facts, propertyId: "secret-scope" } }] }, { expectedActions: ["reply"] }), /unsafe_fact_key/);
  assert.throws(() => validateAcceptanceResult({ ...safeResult, taskResults: [{ ...safeResult.taskResults[0], facts: { availableInventory: [{ publicName: "401 雙人房", category: "room", capacity: 2, canonicalId: "room401" }] } }] }, { expectedActions: ["reply"] }), /unsafe_nested_fact_key/);
  const pastDateResult = {
    ...safeResult,
    finalResponse: { action: "reply", shouldReply: true, replyText: "目前可詢問空房。" },
    taskResults: [{ ...safeResult.taskResults[0], capability: "availability", type: "availability", dataSource: "availability_resolver" }],
    trace: safeResult.trace.map((entry) => entry.stage === "canonical_request" ? { ...entry, items: [{ capability: "availability", temporalState: { checkIn: "2026-07-15", checkOut: "2026-07-16", nights: 1 } }] } : entry)
  };
  assert.throws(
    () => validateAcceptanceResult(pastDateResult, { expectedActions: ["reply"], pastDatePolicy: "reject_if_resolved_past", evaluatedAt: new Date("2026-08-04T00:00:00.000Z") }),
    /past_date_not_explicitly_rejected/,
    "a resolved past date must never be treated as current availability"
  );
  assert.doesNotThrow(() => validateAcceptanceResult({
    ...pastDateResult,
    finalResponse: { action: "clarification", shouldReply: true, replyText: "這個日期已過，請提供新的入住日期。" },
    finalDecision: { action: "clarification", reasonCode: "past_date" },
    taskResults: [{ ...pastDateResult.taskResults[0], status: "needs_clarification", dataSource: "" }]
  }, { expectedActions: ["clarification"], pastDatePolicy: "reject_if_resolved_past", evaluatedAt: new Date("2026-08-04T00:00:00.000Z"), requiredStages: ["planner", "validation", "semantic_contract", "final_decision"] }));
  const unresolvedPastDateResult = {
    ...pastDateResult,
    trace: safeResult.trace.map((entry) => entry.stage === "canonical_request" ? {
      ...entry,
      items: [{ capability: "availability", temporalState: { resolutionStatus: "unresolved", repairReasonCode: "past_date", expressionType: "absolute_date", checkIn: null, checkOut: null, nights: 1 } }]
    } : entry)
  };
  assert.throws(
    () => validateAcceptanceResult(unresolvedPastDateResult, { expectedActions: ["reply"], pastDatePolicy: "reject_if_resolved_past", evaluatedAt: new Date("2026-08-04T00:00:00.000Z") }),
    /past_date_not_explicitly_rejected/,
    "a canonically recognized past date must be rejected even though executable dates are intentionally removed"
  );

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
  let continuedReport = null;
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
      write: (value) => continuedWrites.push(value),
      reportWriter: (report) => { continuedReport = report; }
    });
  } catch (error) {
    matrixFailure = error;
  } finally {
    ACCEPTANCE_MATRIX.splice(0, ACCEPTANCE_MATRIX.length, ...originalMatrix);
  }
  assert.deepEqual(continuedRequests, ["first", "middle", "last"], "a failed middle case must not prevent later cases from running");
  assert.equal(matrixFailure && matrixFailure.code, "deployed_acceptance_matrix_failed", "the completed matrix must still report an aggregate failure");
  assert.equal(matrixFailure && matrixFailure.failCount, 1);
  assert.equal(continuedReport.cases.length, 3, "a failed matrix must still produce every case in the private report");
  assert.equal(continuedReport.cases[1].turns[0].guestQuestion, "middle");
  assert.equal(continuedReport.cases[1].turns[0].finalResponse.replyText, "PRIVATE_FINAL_RESPONSE");
  assert.equal(continuedReport.cases[1].turns[0].formalEvidence[0].facts.answer, "PRIVATE_FACT_ANSWER");
  assert.equal(continuedReport.cases[0].turns[0].runtimeEvidence.planner[0].semanticLedgerBoundaries[0].candidates[0].missingRefsReason, "bound_missing_provenance", "safe candidate diagnostics must survive into the private acceptance artifact");
  assert.equal(continuedReport.cases[2].status, "PASS", "later cases must be preserved in the private report after an earlier failure");
  assert.equal(JSON.stringify(continuedReport).includes("PRIVATE_OIDC_TOKEN"), false, "the private report must not retain authentication material");
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

  const refreshOriginalMatrix = ACCEPTANCE_MATRIX.splice(0);
  const refreshRequests = [];
  const refreshWrites = [];
  const refreshTimes = [
    new Date("2026-08-04T07:46:20.508Z"),
    new Date("2026-08-04T07:46:21.000Z")
  ];
  let refreshCount = 0;
  let refreshFailure = null;
  ACCEPTANCE_MATRIX.push(
    { id: "auth-first-pass", turns: [{ messageText: "first", expectedActions: ["reply"], expectedCapabilities: ["parking"] }] },
    { id: "auth-expired-middle", turns: [{ messageText: "expired", expectedActions: ["reply"], expectedCapabilities: ["parking"] }] },
    { id: "http-non-auth-fail", turns: [{ messageText: "unavailable", expectedActions: ["reply"], expectedCapabilities: ["parking"] }] },
    { id: "auth-last-pass", turns: [{ messageText: "last", expectedActions: ["reply"], expectedCapabilities: ["parking"] }] }
  );
  try {
    await runAcceptanceMatrix({
      baseUrl: "https://test-only.example",
      propertyId: "property-a",
      oidcToken: "EXPIRED_OIDC_TOKEN",
      refreshOidcToken: async () => {
        refreshCount += 1;
        return "FRESH_OIDC_TOKEN";
      },
      commit: expectedCommit,
      now: () => refreshTimes.shift() || new Date("2026-08-04T07:46:22.000Z"),
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const authorization = options.headers.authorization;
        refreshRequests.push({ messageText: body.messageText, authorization, eventId: body.eventId });
        if (body.messageText === "expired" && authorization === "Bearer EXPIRED_OIDC_TOKEN") {
          return { ok: false, status: 403, json: async () => ({ ok: false, error: { code: "ACCEPTANCE_OIDC_REJECTED", message: "PRIVATE_AUTH_MESSAGE" } }) };
        }
        if (body.messageText === "unavailable") {
          return { ok: false, status: 503, json: async () => ({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "PRIVATE_PROVIDER_MESSAGE" } }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { ...safeResult, eventId: body.eventId, traceId: `trace-${body.messageText}` } }) };
      },
      write: (value) => refreshWrites.push(value)
    });
  } catch (error) {
    refreshFailure = error;
  } finally {
    ACCEPTANCE_MATRIX.splice(0, ACCEPTANCE_MATRIX.length, ...refreshOriginalMatrix);
  }
  assert.equal(refreshCount, 1, "an expired deployed acceptance identity must obtain one new GitHub Actions OIDC token");
  assert.deepEqual(
    refreshRequests.map((item) => item.messageText),
    ["first", "expired", "expired", "unavailable", "last"],
    "only an authentication rejection before handler execution may repeat the same event after legal OIDC renewal"
  );
  assert.equal(refreshRequests[1].eventId, refreshRequests[2].eventId, "OIDC renewal must retain the original idempotent event ID");
  assert.equal(refreshRequests[2].authorization, "Bearer FRESH_OIDC_TOKEN");
  assert.equal(refreshRequests[4].authorization, "Bearer FRESH_OIDC_TOKEN", "later cases must reuse the renewed short-lived identity");
  assert.equal(refreshFailure && refreshFailure.code, "deployed_acceptance_matrix_failed");
  assert.equal(refreshFailure && refreshFailure.failCount, 1, "a non-authentication HTTP failure must remain failed after the batch completes");
  assert.deepEqual(
    refreshWrites[1],
    {
      case: "auth-expired-middle",
      turn: 1,
      status: "OIDC_IDENTITY_REJECTED",
      errorCode: "acceptance_http_failed",
      httpStatus: 403,
      httpErrorCode: "ACCEPTANCE_OIDC_REJECTED",
      occurredAt: "2026-08-04T07:46:20.508Z"
    },
    "the public log must prove the exact safe authentication failure that caused OIDC renewal"
  );
  assert.deepEqual(
    refreshWrites[3],
    {
      case: "http-non-auth-fail",
      turn: 1,
      errorCode: "acceptance_http_failed",
      httpStatus: 503,
      httpErrorCode: "SERVICE_UNAVAILABLE",
      occurredAt: "2026-08-04T07:46:21.000Z",
      finalDecisionAction: "",
      finalDecisionReasonCode: "",
      claimValidationOk: null,
      tasks: []
    },
    "an unrecovered HTTP failure must retain only bounded status, code, case, time, and existing safe evidence"
  );
  assert.equal(refreshWrites[4].status, "PASS", "a non-authentication HTTP failure must not stop later cases");
  const serializedHttpEvidence = JSON.stringify(refreshWrites);
  for (const forbidden of ["EXPIRED_OIDC_TOKEN", "FRESH_OIDC_TOKEN", "PRIVATE_AUTH_MESSAGE", "PRIVATE_PROVIDER_MESSAGE"]) {
    assert.equal(serializedHttpEvidence.includes(forbidden), false, `HTTP diagnostics must not expose ${forbidden}`);
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
  assert.match(workflow, /workflow_dispatch:/, "manual deployed acceptance must be explicitly dispatchable");
  assert.match(workflow, /target_preflight/);
  assert.match(workflow, /full_matrix/);
  assert.match(workflow, /verify:\s*\r?\n\s*if:\s*github\.event_name != 'workflow_dispatch'/, "manual acceptance must not repeat verify");
  assert.match(workflow, /deployed-acceptance:\s*\r?\n\s*if:\s*github\.event_name == 'workflow_dispatch'/, "push and pull request must not start deployed acceptance");
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /run-deployed-conversation-acceptance\.js/);
  assert.doesNotMatch(workflow, /deployed-acceptance:[\s\S]*?needs:\s*verify/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /name:\s*junzan-\$\{\{ inputs\.acceptance_mode \}\}-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /if:\s*always\(\)/, "the private report must upload even when the deployed matrix exits 1");
  assert.match(workflow, /TEST_ONLY_ACCEPTANCE_REPORT_DIR/);
  assert.doesNotMatch(workflow, /continue-on-error|forced success/i);

  const targetIds = Object.keys(TARGET_PREFLIGHT_TURNS);
  const selected = selectAcceptanceMatrix({ matrix: DEPLOYED_ACCEPTANCE_MATRIX, caseIds: targetIds });
  assert.deepEqual(selected.map((item) => item.id), targetIds, "target preflight must select only the requested deployed cases in order");
  assert.throws(() => selectAcceptanceMatrix({ matrix: DEPLOYED_ACCEPTANCE_MATRIX, caseIds: [] }), /acceptance_case_ids_required/);
  assert.throws(() => selectAcceptanceMatrix({ matrix: DEPLOYED_ACCEPTANCE_MATRIX, caseIds: [" "] }), /acceptance_case_id_blank/);
  assert.throws(() => selectAcceptanceMatrix({ matrix: DEPLOYED_ACCEPTANCE_MATRIX, caseIds: [targetIds[0], targetIds[0]] }), /acceptance_case_id_duplicate/);
  assert.throws(() => selectAcceptanceMatrix({ matrix: DEPLOYED_ACCEPTANCE_MATRIX, caseIds: ["rg-999-unknown"] }), /acceptance_case_id_unknown/);
  const trustedIdentity = {
    GITHUB_REPOSITORY: "gqlikjguo-web/nephi-home",
    GITHUB_REF: "refs/heads/test-only/node-pilot-integration",
    GITHUB_WORKFLOW_REF: "gqlikjguo-web/nephi-home/.github/workflows/test-only-ci.yml@refs/heads/test-only/node-pilot-integration"
  };
  assert.doesNotThrow(() => validateWorkflowIdentity({ ...trustedIdentity, GITHUB_EVENT_NAME: "workflow_dispatch" }));
  assert.doesNotThrow(() => validateWorkflowIdentity({ ...trustedIdentity, GITHUB_EVENT_NAME: "push" }));
  assert.throws(() => validateWorkflowIdentity({ ...trustedIdentity, GITHUB_EVENT_NAME: "pull_request" }), /github_workflow_identity_mismatch/);
  const targetedMatrix = acceptanceMatrixForMode({ TEST_ONLY_ACCEPTANCE_MODE: "target_preflight", TEST_ONLY_ACCEPTANCE_CASE_IDS: targetIds.join(",") }).matrix;
  assert.deepEqual(targetedMatrix.map((item) => item.id), targetIds);
  assert.equal(targetedMatrix.reduce((sum, item) => sum + item.turns.length, 0), 18, "preflight must execute exactly the 18 previously failing turns");
  assert.equal(acceptanceMatrixForMode({ TEST_ONLY_ACCEPTANCE_MODE: "full_matrix", TEST_ONLY_ACCEPTANCE_CASE_IDS: "" }).matrix.length, 77);
  assert.throws(() => acceptanceMatrixForMode({ TEST_ONLY_ACCEPTANCE_MODE: "full_matrix", TEST_ONLY_ACCEPTANCE_CASE_IDS: targetIds[0] }), /full_matrix_case_filter_forbidden/);
  const correlationIdFor = (caseIndex, turnIndex) => `00000000-0000-4000-8000-${String(caseIndex * 10 + turnIndex + 1).padStart(12, "0")}`;
  const repairTargetFor = (caseId, correlationId) => {
    const byCase = {
      "rg-003-price-nights": { capability: "price", canonicalEntity: { category: "property", canonicalId: "" } },
      "rg-004-bundle-price": { capability: "price", canonicalEntity: { category: "bundle", canonicalId: "" } },
      "rg-006-named-room-availability": { capability: "availability", canonicalEntity: { category: "room", canonicalId: "room_402" } },
      "rg-013-booking-request-full": { capability: "availability", canonicalEntity: { category: "room", canonicalId: "room_301" } },
      "rg-023-pool-fee": { capability: "amenity", canonicalEntity: { category: "amenity", canonicalId: "pool" } },
      "rg-029-checkin-latest": { capability: "policy", canonicalEntity: { category: "policy", canonicalId: "check_in" } },
      "rg-033-kitchen": { capability: "property_fact", canonicalEntity: { category: "amenity", canonicalId: "kitchen" } },
      "rg-037-multi-pool-price-checkin": { capability: "amenity", canonicalEntity: { category: "amenity", canonicalId: "pool" } },
      "rg-038-conversation-room-price-payment": { capability: "availability", canonicalEntity: { category: "room", canonicalId: "room_402" } },
      "rg-039-conversation-booking-refund": { capability: "availability", canonicalEntity: { category: "room", canonicalId: "" } },
      "rgs-003-bbq": { capability: "bbq", canonicalEntity: { category: "amenity", canonicalId: "bbq" } },
      "rgs-005-parking": { capability: "parking", canonicalEntity: { category: "transport", canonicalId: "parking" } },
      "rgs-010-pets": { capability: "policy", canonicalEntity: { category: "policy", canonicalId: "" } },
      "rgs-014-bundle-price": { capability: "price", canonicalEntity: { category: "bundle", canonicalId: "" } },
      "rgs-019-modify-room-mix": { capability: "bundle_availability", canonicalEntity: { category: "bundle", canonicalId: "" } },
      "rgs-020-modify-date": {
        capability: "availability",
        canonicalEntity: { category: "room", canonicalId: "room_301" },
        temporalState: { resolutionStatus: "resolved", checkIn: "2026-08-20", checkOut: "2026-08-21" }
      }
    };
    return { ...byCase[caseId], repairCorrelationId: correlationId };
  };
  const attributedReport = {
    cases: targetIds.map((caseId, caseIndex) => ({
      caseId,
      status: "PASS",
      turns: TARGET_PREFLIGHT_TURNS[caseId].map((_turnNumber, turnIndex) => ({
        runtimeEvidence: {
          providerType: "postgresql",
          plannerParserSucceeded: true,
          semanticContractValidationPassed: true,
          planner: [{ stage: "planner" }],
          validation: [{ stage: "semantic_contract", semanticValidation: { repairedTasks: [] } }],
          canonicalRequest: [{ stage: "canonical_request", items: [{}] }],
          conversationState: [{ stage: "state" }],
          queryPlan: [{ stage: "query_plan", count: 1 }],
          resolverExecution: [{ stage: "executor" }]
        },
        claimValidation: { ok: true },
        finalDecision: { action: "reply" },
        finalResponse: { replyText: "verified" }
      }))
    }))
  };
  assert.throws(() => validateTargetPreflightAttribution(attributedReport), /TARGET_PASS_ATTRIBUTION_UNPROVEN/, "complete generic traces without the repaired boundary must not certify target attribution");
  for (let caseIndex = 0; caseIndex < attributedReport.cases.length; caseIndex += 1) {
    const item = attributedReport.cases[caseIndex];
    for (let turnIndex = 0; turnIndex < item.turns.length; turnIndex += 1) {
      const turn = item.turns[turnIndex];
      const correlationId = correlationIdFor(caseIndex, turnIndex);
      const repairTarget = repairTargetFor(item.caseId, correlationId);
      repairTarget.taskId = `target-${caseIndex}-${turnIndex}`;
      turn.runtimeEvidence.canonicalRequest[0].items = [
        repairTarget,
        { capability: "price", canonicalEntity: { category: "property", canonicalId: "" } },
        { capability: "availability", canonicalEntity: { category: "room", canonicalId: "check_in" } },
        { capability: "policy", canonicalEntity: { category: "transport", canonicalId: "parking" } },
        { capability: "amenity", canonicalEntity: { category: "amenity", canonicalId: "bbq" } },
        { capability: "property_fact", canonicalEntity: { category: "amenity", canonicalId: "kitchen" } }
      ];
      if (item.caseId === "rg-023-pool-fee") {
        turn.runtimeEvidence.validation[0].repairProvenance = [{ kind: "semantic_repair", correlationId }];
      } else {
        Object.assign(turn.runtimeEvidence.planner[0], {
          coverageRepairPerformed: true,
          coverageRepairSucceeded: true,
          coverageRepairFallback: false,
          repairProvenance: [{ kind: "coverage_repair", correlationId }]
        });
      }
    }
  }
  const attribution = validateTargetPreflightAttribution(attributedReport);
  assert.equal(attribution.status, "TARGET_PASS_ATTRIBUTION_PROVEN");
  assert.equal(attribution.cases.reduce((sum, item) => sum + item.completeTurnCount, 0), 18);
  const prematureQueryReport = JSON.parse(JSON.stringify(attributedReport));
  prematureQueryReport.cases[0].turns[0].runtimeEvidence.queryPlan[0].items = [{ capability: "price", operation: "availability" }];
  assert.throws(() => validateTargetPreflightAttribution(prematureQueryReport), /TARGET_PASS_ATTRIBUTION_UNPROVEN/, "a real availability capability operation must invalidate pending-turn attribution");
  const unprovenReport = JSON.parse(JSON.stringify(attributedReport));
  unprovenReport.cases[0].turns[0].runtimeEvidence.planner = [];
  assert.throws(() => validateTargetPreflightAttribution(unprovenReport), /TARGET_PASS_ATTRIBUTION_UNPROVEN/);
  const unrelatedRepairReport = JSON.parse(JSON.stringify(attributedReport));
  const unrelatedTurn = unrelatedRepairReport.cases[0].turns[0];
  const unrelatedCorrelationId = unrelatedTurn.runtimeEvidence.planner[0].repairProvenance[0].correlationId;
  delete unrelatedTurn.runtimeEvidence.canonicalRequest[0].items[0].repairCorrelationId;
  unrelatedTurn.runtimeEvidence.canonicalRequest[0].items.push({ capability: "amenity", canonicalEntity: { category: "amenity", canonicalId: "unrelated" }, repairCorrelationId: unrelatedCorrelationId });
  assert.throws(() => validateTargetPreflightAttribution(unrelatedRepairReport), /TARGET_PASS_ATTRIBUTION_UNPROVEN/, "an unrelated repaired task must not attribute matching canonical evidence from a different task");
  const multiTaskReport = JSON.parse(JSON.stringify(attributedReport));
  multiTaskReport.cases[0].turns[0].runtimeEvidence.canonicalRequest[0].items.push({ capability: "price", canonicalEntity: { category: "property", canonicalId: "" } });
  assert.doesNotThrow(() => validateTargetPreflightAttribution(multiTaskReport), "only the directly correlated target task is allowed to prove a multi-task turn");
  const taskCollectionReport = JSON.parse(JSON.stringify(attributedReport));
  taskCollectionReport.cases[0].turns[0].runtimeEvidence.planner[0] = {
    stage: "planner",
    taskCollectionRepairPerformed: true,
    preservedTaskCount: 1,
    fallbackTaskCount: 1,
    repairProvenance: taskCollectionReport.cases[0].turns[0].runtimeEvidence.planner[0].repairProvenance.map((entry) => ({ ...entry, kind: "task_collection_repair" }))
  };
  assert.doesNotThrow(() => validateTargetPreflightAttribution(taskCollectionReport), "task collection repair must join through the same opaque correlation ID");
  const rg023MismatchReport = JSON.parse(JSON.stringify(attributedReport));
  const rg023Turn = rg023MismatchReport.cases.find((item) => item.caseId === "rg-023-pool-fee").turns[0];
  rg023Turn.runtimeEvidence.validation[0].repairProvenance[0].correlationId = "99999999-9999-4999-8999-999999999999";
  assert.throws(() => validateTargetPreflightAttribution(rg023MismatchReport), /TARGET_PASS_ATTRIBUTION_UNPROVEN/, "rg-023 semantic repair must join the pool canonical evidence by the same opaque ID");
  const duplicateProvenanceReport = JSON.parse(JSON.stringify(attributedReport));
  duplicateProvenanceReport.cases[0].turns[0].runtimeEvidence.planner[0].repairProvenance.push({ ...duplicateProvenanceReport.cases[0].turns[0].runtimeEvidence.planner[0].repairProvenance[0] });
  assert.throws(() => validateTargetPreflightAttribution(duplicateProvenanceReport), /TARGET_PASS_ATTRIBUTION_UNPROVEN/, "duplicate provenance IDs must fail closed");
  const unknownCanonicalIdReport = JSON.parse(JSON.stringify(attributedReport));
  unknownCanonicalIdReport.cases[0].turns[0].runtimeEvidence.canonicalRequest[0].items.push({ capability: "price", canonicalEntity: { category: "property", canonicalId: "" }, repairCorrelationId: "88888888-8888-4888-8888-888888888888" });
  assert.throws(() => validateTargetPreflightAttribution(unknownCanonicalIdReport), /TARGET_PASS_ATTRIBUTION_UNPROVEN/, "unknown canonical repair IDs must fail closed");
  const ambiguousCanonicalReport = JSON.parse(JSON.stringify(attributedReport));
  ambiguousCanonicalReport.cases[0].turns[0].runtimeEvidence.canonicalRequest[0].items.push({ ...ambiguousCanonicalReport.cases[0].turns[0].runtimeEvidence.canonicalRequest[0].items[0] });
  assert.throws(() => validateTargetPreflightAttribution(ambiguousCanonicalReport), /TARGET_PASS_ATTRIBUTION_UNPROVEN/, "one repair ID mapping to multiple canonical items must fail closed");
  const conflictingKindReport = JSON.parse(JSON.stringify(attributedReport));
  const conflictingEntry = conflictingKindReport.cases[0].turns[0].runtimeEvidence.planner[0].repairProvenance[0];
  conflictingKindReport.cases[0].turns[0].runtimeEvidence.planner[0].repairProvenance.push({ ...conflictingEntry, kind: "task_collection_repair" });
  assert.throws(() => validateTargetPreflightAttribution(conflictingKindReport), /TARGET_PASS_ATTRIBUTION_UNPROVEN/, "one repair ID claiming conflicting repair kinds must fail closed");
  const conflictingCanonicalIdentityReport = JSON.parse(JSON.stringify(attributedReport));
  const conflictingCanonicalTurn = conflictingCanonicalIdentityReport.cases[0].turns[0].runtimeEvidence;
  const secondCorrelationId = "77777777-7777-4777-8777-777777777777";
  conflictingCanonicalTurn.planner[0].repairProvenance.push({ kind: "coverage_repair", correlationId: secondCorrelationId });
  conflictingCanonicalTurn.canonicalRequest[0].items.push({
    ...conflictingCanonicalTurn.canonicalRequest[0].items[0],
    repairCorrelationId: secondCorrelationId
  });
  assert.throws(() => validateTargetPreflightAttribution(conflictingCanonicalIdentityReport), /TARGET_PASS_ATTRIBUTION_UNPROVEN/, "one canonical task claiming different repair IDs must fail closed");

  const deployedRunnerSource = fs.readFileSync(path.join(__dirname, "../scripts/run-deployed-conversation-acceptance.js"), "utf8");
  assert.doesNotMatch(deployedRunnerSource, /require\([^)]*pglite|createPglite|fake planner/i);
  assert.match(deployedRunnerSource, /FORBIDDEN_PROVIDER_MARKERS/, "deployed evidence must explicitly reject fake or local provider markers");
  assert.doesNotMatch(deployedRunnerSource, /console\.(?:log|error)\([^\n]*(?:oidcToken|requestToken)/, "OIDC tokens must never be passed to output calls");

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.equal(packageJson.scripts["test:deployed-acceptance-contract"], "node tests/test-only-acceptance-oidc-runner.js && node tests/deployed-conversation-acceptance-contract-runner.js && node tests/real-guest-deployed-acceptance-matrix-runner.js && node tests/test-only-conversation-acceptance-api-runner.js");
  assert.equal(packageJson.scripts.posttest, "node tests/test-only-acceptance-oidc-runner.js && node tests/deployed-conversation-acceptance-contract-runner.js && node tests/real-guest-deployed-acceptance-matrix-runner.js");

  console.log(JSON.stringify({ suite: "deployed-conversation-acceptance-contract", caseCount: 18, passCount: 18, failCount: 0 }));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
