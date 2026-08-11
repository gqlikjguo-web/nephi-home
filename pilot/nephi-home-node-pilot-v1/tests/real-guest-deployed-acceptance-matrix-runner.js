"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ACCEPTANCE_MATRIX,
  SUPPLEMENTAL_ACCEPTANCE_MATRIX,
  DEPLOYED_ACCEPTANCE_MATRIX,
  loadAcceptanceMatrix,
  runAcceptanceMatrix
} = require("../scripts/run-deployed-conversation-acceptance");

const expectedCommit = "075d6772e16312013ad2029752bae3942c5a17e4";

function safeResult(eventId, traceId) {
  return {
    traceId,
    eventId,
    finalDecision: { action: "reply", reasonCode: "execution_answered" },
    claimValidation: { ok: true, errors: [], coveredTaskIds: ["parking"], missingTaskIds: [], unexpectedTaskIds: [] },
    finalResponse: { action: "reply", shouldReply: true, replyText: "parking available" },
    taskResults: [{
      taskId: "parking",
      capability: "parking",
      type: "parking",
      status: "answered",
      reason: "",
      dataSource: "property_catalog",
      facts: { subject: "parking", status: "confirmed_yes", answer: "available" }
    }],
    trace: [
      { stage: "property_catalog", providerType: "postgres" },
      { stage: "planner", parserSucceeded: true, taskCount: 1 },
      { stage: "validation" },
      { stage: "semantic_contract", validationPassed: true },
      { stage: "canonical_request", items: [{ capability: "parking" }] },
      { stage: "formal_request" },
      { stage: "query_plan" },
      { stage: "executor" },
      { stage: "claim_validator" },
      { stage: "final_decision" }
    ]
  };
}

(async () => {
  const redFailures = [];
  try {
    assert.equal(ACCEPTANCE_MATRIX.length, 53, "the deployed runner must load all 53 fixed real-guest cases");
    assert.equal(
      ACCEPTANCE_MATRIX.reduce((sum, item) => sum + item.turns.length, 0),
      61,
      "the fixed source matrix must retain all 61 source turns"
    );
    const whollyNotExecutable = ACCEPTANCE_MATRIX.filter((item) => item.executionStatus === "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API");
    const notExecutableTurns = ACCEPTANCE_MATRIX.reduce((sum, item) => sum + item.turns.filter((turn) => item.executionStatus === "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API" || turn.executionStatus === "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API").length, 0);
    assert.deepEqual(whollyNotExecutable.map((item) => item.id), ["rg-040-modify-guests-bed", "rg-041-modify-room-mix", "rg-042-modify-date"]);
    assert.equal(ACCEPTANCE_MATRIX.find((item) => item.id === "rg-050-nontext-markers").turns.every((turn) => turn.executionStatus === "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API"), true);
    assert.equal(ACCEPTANCE_MATRIX.find((item) => item.id === "rg-039-conversation-booking-refund").turns[1].executionStatus, "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API");
    assert.equal(notExecutableTurns, 9, "five native non-text markers and four operator-context turns must be excluded from text execution");
    assert.equal(SUPPLEMENTAL_ACCEPTANCE_MATRIX.length, 24, "the supplemental matrix must retain all 17 high-frequency variants plus three context and four native-event cases");
    assert.equal(SUPPLEMENTAL_ACCEPTANCE_MATRIX.reduce((sum, item) => sum + item.turns.length, 0), 29);
    assert.deepEqual(
      SUPPLEMENTAL_ACCEPTANCE_MATRIX.slice(0, 17).map((item) => item.turns[0].messageText),
      ["離交流道近嗎", "雙人房", "可以烤肉嗎", "請問有早餐嗎", "有停車位嗎", "請問今天還有空房嗎", "請問費用", "請問價錢", "價格多少", "可以帶寵物嗎", "請問有飲水機嗎", "價格？", "還有空房嗎", "想詢問包棟價格", "請問有寵物友善嗎", "7/15可以訂房嗎", "我們想住兩天怎麼安排"],
      "the supplemental matrix must preserve every approved real wording exactly"
    );
    assert.equal(SUPPLEMENTAL_ACCEPTANCE_MATRIX.find((item) => item.id === "rgs-016-past-or-future-date").turns[0].pastDatePolicy, "reject_if_resolved_past");
    const expectedTierTotals = {
      TIER_1_CORE: { cases: 34, turns: 34 },
      TIER_2_COMPLEX: { cases: 21, turns: 31 },
      TIER_3_SAFETY: { cases: 10, turns: 10 },
      TIER_4_EDGE: { cases: 12, turns: 15 }
    };
    for (const [tier, expected] of Object.entries(expectedTierTotals)) {
      const cases = DEPLOYED_ACCEPTANCE_MATRIX.filter((item) => item.tier === tier);
      assert.deepEqual(
        { cases: cases.length, turns: cases.reduce((sum, item) => sum + item.turns.length, 0) },
        expected,
        `${tier} must have the approved case/turn partition`
      );
    }
    assert.equal(new Set(DEPLOYED_ACCEPTANCE_MATRIX.map((item) => item.id)).size, 77, "Tier metadata must retain exactly one assignment per case");
    for (const item of DEPLOYED_ACCEPTANCE_MATRIX.filter((entry) => ["TIER_1_CORE", "TIER_2_COMPLEX"].includes(entry.tier))) {
      for (const turn of item.turns) {
        assert.equal(
          ["reply", "clarification", "handoff"].every((action) => turn.expectedActions.includes(action)),
          false,
          `${item.id} must not pass Core/Complex product outcome through any final action`
        );
      }
    }
    const invalidTierDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-invalid-tier-"));
    try {
      const source = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/real-guest-fixed-matrix.json"), "utf8"));
      source.tiers.TIER_1_CORE.push(source.tiers.TIER_2_COMPLEX[0]);
      const invalidTierPath = path.join(invalidTierDirectory, "duplicate-tier.json");
      fs.writeFileSync(invalidTierPath, `${JSON.stringify(source)}\n`, "utf8");
      assert.throws(() => loadAcceptanceMatrix(invalidTierPath), /real_guest_matrix_tier_case_duplicate/, "one case must never be assigned to two acceptance tiers");
    } finally {
      fs.rmSync(invalidTierDirectory, { recursive: true, force: true });
    }

    const rg003 = ACCEPTANCE_MATRIX.find((item) => item.id === "rg-003-price-nights");
    assert.equal(rg003.tier, "TIER_3_SAFETY");
    assert.equal(rg003.turns[0].pastDatePolicy, "reject_if_resolved_past", "the stale May date must be a past-date safety case");
    assert.equal(rg003.turns[0].expectedSemantic.includes("price"), false, "the stale May case must not remain a future-price auto-answer KPI");
    assert.deepEqual(rg003.turns[0].productOutcomes, [{ subject: "past_date", disposition: "retain" }]);
    assert.deepEqual(
      SUPPLEMENTAL_ACCEPTANCE_MATRIX.find((item) => item.id === "rgs-016-past-or-future-date").turns[0].productOutcomes,
      [{ subject: "past_date", disposition: "retain" }],
      "the explicit past-date safety guard must require structured temporal evidence"
    );

    const rg029 = ACCEPTANCE_MATRIX.find((item) => item.id === "rg-029-checkin-latest").turns[0];
    assert.deepEqual(rg029.expectedActions, ["reply", "handoff"], "requested-detail handling must accept the protected reply path or a safe handoff");
    assert.equal(rg029.strictDetailReview, true, "rg-029 must opt in to the reusable strict requested-detail contract");
    assert.equal(rg029.expectedSemantic.includes("check_in"), false, "latest arrival must not fail solely on canonicalId=check_in");
    assert.deepEqual(rg029.productOutcomes, [{ subject: "latest_arrival", disposition: "retain", sourceText: "最晚入住時間" }]);

    const rg038 = ACCEPTANCE_MATRIX.find((item) => item.id === "rg-038-conversation-room-price-payment").turns[0];
    assert.deepEqual(rg038.expectedActions, ["clarification"]);
    assert.equal(rg038.expectedCapabilities.some((group) => Array.isArray(group) && group.includes("availability")), false, "ambiguous Saturday clarification must not require an independent availability capability");
    assert.deepEqual(rg038.productOutcomes, [
      { subject: "price", disposition: "retain" },
      { subject: "exact_saturday", disposition: "clarification", sourceText: "8月週六" }
    ]);

    const rg039 = ACCEPTANCE_MATRIX.find((item) => item.id === "rg-039-conversation-booking-refund").turns[0];
    assert.deepEqual(rg039.expectedActions, ["handoff"]);
    assert.equal(rg039.expectedCapabilities.some((group) => Array.isArray(group) && group.includes("amenity")), false, "bathtub retention must not require an independent amenity capability");
    assert.deepEqual(rg039.productOutcomes, [
      { subject: "booking", disposition: "handoff" },
      { subject: "double_room", disposition: "retain", sourceText: "雙人房" },
      { subject: "bathtub", disposition: "retain", sourceText: "浴缸" }
    ]);

    const rgs019 = SUPPLEMENTAL_ACCEPTANCE_MATRIX.find((item) => item.id === "rgs-019-modify-room-mix").turns[0];
    assert.equal(rgs019.expectedSemantic.includes("bundle"), false, "a guest who did not ask for a bundle must not be graded on bundle scope");

    for (const [caseId, turnNumber] of [
      ["rg-010-pay-deposit", 1], ["rg-017-bbq-and-ktv-time", 1], ["rg-018-bbq-pool-fees", 1],
      ["rg-021-pool-use", 1], ["rg-023-pool-fee", 1], ["rg-028-ktv-hours", 1],
      ["rg-030-late-arrival", 1], ["rg-036-multi-bundle-breakfast-cleaning", 1],
      ["rg-038-conversation-room-price-payment", 3], ["rgs-001-freeway-distance", 1],
      ["rgs-018-modify-guests-extra-bed", 2], ["rgs-019-modify-room-mix", 3], ["rgs-020-modify-date", 3]
    ]) {
      const item = DEPLOYED_ACCEPTANCE_MATRIX.find((entry) => entry.id === caseId);
      assert.ok(item.turns[turnNumber - 1].productOutcomes?.length, `${caseId} turn ${turnNumber} must protect substantive coverage against a false green`);
    }
    for (const item of SUPPLEMENTAL_ACCEPTANCE_MATRIX.filter((entry) => entry.bucket === "controlled_operator_context")) {
      assert.equal(item.turns[0].establishOperatorContext, true, `${item.id} must establish prior context through an Engine turn`);
      assert.equal(item.turns.some((turn) => turn.executionStatus === "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API"), false);
    }
    for (const item of SUPPLEMENTAL_ACCEPTANCE_MATRIX.filter((entry) => entry.bucket === "native_line_event")) {
      assert.equal(item.turns[0].messageText, undefined, `${item.id} must not masquerade as text`);
      assert.equal(item.turns[0].lineEvent.type, "message");
      assert.ok(["sticker", "image", "video", "file"].includes(item.turns[0].lineEvent.message.type));
    }
  } catch (error) {
    redFailures.push(error);
  }

  const originalMatrix = ACCEPTANCE_MATRIX.splice(0);
  const requests = [];
  const writes = [];
  let result;
  try {
    ACCEPTANCE_MATRIX.push(
      {
        id: "native-nontext-only",
        tier: "TIER_4_EDGE",
        executionStatus: "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API",
        executionReasonCode: "native_non_text_event_requires_line_transport",
        turns: [{ messageText: "MUST_NOT_BE_SENT_AS_TEXT", expectedActions: ["reply"] }]
      },
      {
        id: "operator-context-only",
        tier: "TIER_2_COMPLEX",
        executionStatus: "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API",
        executionReasonCode: "operator_prior_context_cannot_be_established",
        turns: [{ messageText: "MUST_NOT_BE_SENT_WITHOUT_CONTEXT", expectedActions: ["reply"] }]
      },
      {
        id: "partially-executable",
        tier: "TIER_2_COMPLEX",
        turns: [
          { messageText: "partial-first", expectedActions: ["reply"], expectedCapabilities: ["parking"] },
          {
            messageText: "MUST_NOT_SEND_NATIVE_MARKER",
            expectedActions: ["reply"],
            executionStatus: "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API",
            executionReasonCode: "native_non_text_event_requires_line_transport"
          },
          { messageText: "partial-last", expectedActions: ["reply"], expectedCapabilities: ["parking"] }
        ]
      },
      {
        id: "ordinary-text",
        tier: "TIER_1_CORE",
        turns: [{ messageText: "ordinary", expectedActions: ["reply"], expectedCapabilities: ["parking"] }]
      }
    );

    result = await runAcceptanceMatrix({
      baseUrl: "https://test-only.example",
      propertyId: "nephi_home",
      oidcToken: "PRIVATE_OIDC_TOKEN",
      commit: expectedCommit,
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: safeResult(body.eventId, `trace-${requests.length}`) })
        };
      },
      write: (value) => writes.push(value)
    });

    assert.deepEqual(
      requests.map((item) => item.messageText),
      ["partial-first", "partial-last", "ordinary"],
      "native events and operator-context-dependent cases must never be sent to the text acceptance API"
    );
    assert.equal(requests[0].conversationId, requests[1].conversationId, "executable turns in a partial case must retain one conversation");
    assert.notEqual(requests[1].conversationId, requests[2].conversationId, "different cases must remain isolated");
    assert.deepEqual(result, {
      caseCount: 4,
      turnCount: 6,
      executableCaseCount: 2,
      executableTurnCount: 3,
      passCount: 1,
      partialCount: 1,
      failCount: 0,
      notExecutableCaseCount: 2,
      notExecutableTurnCount: 3,
      tiers: {
        TIER_1_CORE: { caseCount: 1, turnCount: 1, executableCaseCount: 1, executableTurnCount: 1, passCount: 1, partialCount: 0, failCount: 0, notExecutableCaseCount: 0, notExecutableTurnCount: 0 },
        TIER_2_COMPLEX: { caseCount: 2, turnCount: 4, executableCaseCount: 1, executableTurnCount: 2, passCount: 0, partialCount: 1, failCount: 0, notExecutableCaseCount: 1, notExecutableTurnCount: 2 },
        TIER_3_SAFETY: { caseCount: 0, turnCount: 0, executableCaseCount: 0, executableTurnCount: 0, passCount: 0, partialCount: 0, failCount: 0, notExecutableCaseCount: 0, notExecutableTurnCount: 0 },
        TIER_4_EDGE: { caseCount: 1, turnCount: 1, executableCaseCount: 0, executableTurnCount: 0, passCount: 0, partialCount: 0, failCount: 0, notExecutableCaseCount: 1, notExecutableTurnCount: 1 }
      },
      groups: {
        coreComplexProductOutcome: { caseCount: 3, turnCount: 5, executableCaseCount: 2, executableTurnCount: 3, passCount: 1, partialCount: 1, failCount: 0, notExecutableCaseCount: 1, notExecutableTurnCount: 2 },
        safetyContract: { caseCount: 0, turnCount: 0, executableCaseCount: 0, executableTurnCount: 0, passCount: 0, partialCount: 0, failCount: 0, notExecutableCaseCount: 0, notExecutableTurnCount: 0 },
        edgeRobustness: { caseCount: 1, turnCount: 1, executableCaseCount: 0, executableTurnCount: 0, passCount: 0, partialCount: 0, failCount: 0, notExecutableCaseCount: 1, notExecutableTurnCount: 1 }
      }
    });
    assert.equal(writes.filter((item) => item.status === "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API").length, 3);
  } catch (error) {
    redFailures.push(error);
  } finally {
    ACCEPTANCE_MATRIX.splice(0, ACCEPTANCE_MATRIX.length, ...originalMatrix);
  }

  const supplementalRequests = [];
  let supplementalReport = null;
  const supplementalResult = await runAcceptanceMatrix({
    baseUrl: "https://test-only.example",
    propertyId: "nephi_home",
    oidcToken: "PRIVATE_OIDC_TOKEN",
    commit: expectedCommit,
    matrix: [
      {
        id: "controlled-context",
        tier: "TIER_2_COMPLEX",
        turns: [
          { messageText: "setup", establishOperatorContext: true, expectedActions: ["reply"], expectedCapabilities: ["parking"] },
          { messageText: "modify", expectedActions: ["reply"], expectedCapabilities: ["parking"] }
        ]
      },
      {
        id: "native-sticker",
        tier: "TIER_4_EDGE",
        turns: [{ lineEvent: { type: "message", message: { type: "sticker" } }, expectedActions: ["no_reply"] }]
      }
    ],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      supplementalRequests.push(body);
      if (body.lineEvent) return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data: {
          traceId: "trace-native",
          eventId: body.eventId,
          nativeEvent: { type: "sticker", transport: "shared_line_message_gate", engineInvoked: false },
          finalDecision: { action: "no_reply", reasonCode: "line_non_text_event_ignored" },
          claimValidation: { ok: true, notApplicable: true, errors: [], coveredTaskIds: [], missingTaskIds: [], unexpectedTaskIds: [] },
          finalResponse: { action: "no_reply", shouldReply: false, replyText: "" },
          taskResults: [],
          trace: [{ stage: "line_transport", reasonCode: "line_non_text_event_ignored" }]
        } })
      };
      const engine = safeResult(body.eventId, `trace-${body.messageText}`);
      return { ok: true, status: 200, json: async () => ({ ok: true, data: body.establishOperatorContext ? { ...engine, operatorContext: { established: true, source: "engine_final_response", eventId: body.eventId, finalResponse: engine.finalResponse } } : engine }) };
    },
    write: () => {},
    reportWriter: (report) => { supplementalReport = report; },
    reportFinalizer: () => { throw new Error("TARGET_PASS_ATTRIBUTION_UNPROVEN"); }
  });
  const { tiers: supplementalTiers, groups: supplementalGroups, ...supplementalTotals } = supplementalResult;
  assert.deepEqual(supplementalTotals, { caseCount: 2, turnCount: 3, executableCaseCount: 2, executableTurnCount: 3, passCount: 2, partialCount: 0, failCount: 0, notExecutableCaseCount: 0, notExecutableTurnCount: 0 });
  assert.deepEqual(supplementalTiers.TIER_2_COMPLEX, { caseCount: 1, turnCount: 2, executableCaseCount: 1, executableTurnCount: 2, passCount: 1, partialCount: 0, failCount: 0, notExecutableCaseCount: 0, notExecutableTurnCount: 0 });
  assert.deepEqual(supplementalTiers.TIER_4_EDGE, { caseCount: 1, turnCount: 1, executableCaseCount: 1, executableTurnCount: 1, passCount: 1, partialCount: 0, failCount: 0, notExecutableCaseCount: 0, notExecutableTurnCount: 0 });
  assert.deepEqual(supplementalGroups.coreComplexProductOutcome, supplementalTiers.TIER_2_COMPLEX);
  assert.deepEqual(supplementalGroups.edgeRobustness, supplementalTiers.TIER_4_EDGE);
  assert.equal(supplementalRequests[0].establishOperatorContext, true);
  assert.equal(supplementalReport.schemaVersion, 2, "tiered product-outcome reports must use the corrected report schema");
  assert.equal(supplementalRequests[0].messageText, "setup");
  assert.equal(supplementalRequests[1].conversationId, supplementalRequests[0].conversationId);
  assert.deepEqual(supplementalRequests[2].lineEvent, { type: "message", message: { type: "sticker" } });
  assert.equal(Object.hasOwn(supplementalRequests[2], "messageText"), false, "native events must never be serialized as text");
  assert.equal(supplementalReport.cases[0].turns[0].operatorContext.source, "engine_final_response");
  assert.equal(supplementalReport.cases[1].turns[0].nativeEvent.type, "sticker");
  assert.deepEqual(
    supplementalReport.attribution,
    { status: "ENGINEERING_DIAGNOSTIC_UNPROVEN", errorCode: "acceptance_case_failed" },
    "legacy repair attribution must remain visible but cannot override product-outcome PASS"
  );

  const runFailingTier = (tier) => runAcceptanceMatrix({
    baseUrl: "https://test-only.example",
    propertyId: "nephi_home",
    oidcToken: "PRIVATE_OIDC_TOKEN",
    commit: expectedCommit,
    matrix: [{ id: `failing-${tier}`, tier, turns: [{ tier, messageText: "ordinary", expectedActions: ["clarification"], expectedCapabilities: ["parking"] }] }],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, data: safeResult(body.eventId, `trace-${tier}`) }) };
    },
    write: () => {}
  });
  const edgeOnlyResult = await runFailingTier("TIER_4_EDGE");
  assert.equal(edgeOnlyResult.failCount, 1, "an Edge failure remains visible in the report summary");
  assert.equal(edgeOnlyResult.groups.edgeRobustness.failCount, 1);
  await assert.rejects(
    runFailingTier("TIER_3_SAFETY"),
    (error) => error && error.code === "deployed_acceptance_matrix_failed" && error.groups.safetyContract.failCount === 1,
    "a Safety contract failure must remain a V1 blocker"
  );

  if (redFailures.length) {
    const error = new Error(redFailures.map((item) => item.message).join("\n"));
    error.cause = redFailures[0];
    throw error;
  }

  console.log(JSON.stringify({ suite: "real-guest-deployed-acceptance-matrix", caseCount: 8, passCount: 8, failCount: 0 }));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
