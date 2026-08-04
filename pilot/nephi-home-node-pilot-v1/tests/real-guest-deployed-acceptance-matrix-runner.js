"use strict";

const assert = require("node:assert/strict");
const {
  ACCEPTANCE_MATRIX,
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

  if (redFailures.length) {
    const error = new Error(redFailures.map((item) => item.message).join("\n"));
    error.cause = redFailures[0];
    throw error;
  }

  console.log(JSON.stringify({ suite: "real-guest-deployed-acceptance-matrix", caseCount: 8, passCount: 8, failCount: 0 }));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
