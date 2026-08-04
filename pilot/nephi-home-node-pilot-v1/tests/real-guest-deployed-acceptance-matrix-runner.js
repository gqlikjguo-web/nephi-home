"use strict";

const assert = require("node:assert/strict");
const {
  ACCEPTANCE_MATRIX,
  SUPPLEMENTAL_ACCEPTANCE_MATRIX,
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
        executionStatus: "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API",
        executionReasonCode: "native_non_text_event_requires_line_transport",
        turns: [{ messageText: "MUST_NOT_BE_SENT_AS_TEXT", expectedActions: ["reply"] }]
      },
      {
        id: "operator-context-only",
        executionStatus: "NOT_EXECUTABLE_WITH_CURRENT_ACCEPTANCE_API",
        executionReasonCode: "operator_prior_context_cannot_be_established",
        turns: [{ messageText: "MUST_NOT_BE_SENT_WITHOUT_CONTEXT", expectedActions: ["reply"] }]
      },
      {
        id: "partially-executable",
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
      notExecutableTurnCount: 3
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
        turns: [
          { messageText: "setup", establishOperatorContext: true, expectedActions: ["reply"], expectedCapabilities: ["parking"] },
          { messageText: "modify", expectedActions: ["reply"], expectedCapabilities: ["parking"] }
        ]
      },
      {
        id: "native-sticker",
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
    reportWriter: (report) => { supplementalReport = report; }
  });
  assert.deepEqual(supplementalResult, { caseCount: 2, turnCount: 3, executableCaseCount: 2, executableTurnCount: 3, passCount: 2, partialCount: 0, failCount: 0, notExecutableCaseCount: 0, notExecutableTurnCount: 0 });
  assert.equal(supplementalRequests[0].establishOperatorContext, true);
  assert.equal(supplementalRequests[0].messageText, "setup");
  assert.equal(supplementalRequests[1].conversationId, supplementalRequests[0].conversationId);
  assert.deepEqual(supplementalRequests[2].lineEvent, { type: "message", message: { type: "sticker" } });
  assert.equal(Object.hasOwn(supplementalRequests[2], "messageText"), false, "native events must never be serialized as text");
  assert.equal(supplementalReport.cases[0].turns[0].operatorContext.source, "engine_final_response");
  assert.equal(supplementalReport.cases[1].turns[0].nativeEvent.type, "sticker");

  if (redFailures.length) {
    const error = new Error(redFailures.map((item) => item.message).join("\n"));
    error.cause = redFailures[0];
    throw error;
  }

  console.log(JSON.stringify({ suite: "real-guest-deployed-acceptance-matrix", caseCount: 8, passCount: 8, failCount: 0 }));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
