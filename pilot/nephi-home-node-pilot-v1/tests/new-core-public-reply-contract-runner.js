"use strict";
// FAKE_INTEGRATION / RUNTIME_COMPONENT_TEST. Internal execution and provenance
// remain observable even when the approved public decision is silence.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("./new-core-request-responsibility-fixture");
const { finalizeTurnResponse } = require("../lib/new-core/application-service");
const { createTerminalContext } = require("../lib/new-core/terminal-failure");
const { unknownProvenanceFor, validateClaims } = require("../lib/conversation-engine-v2/claim-validator");
const HANDOFF = "請稍後，將盡快回覆您。";
const forbidden = ["目前無法確認", "無法確認該條件是否適用", "目前未能完成處理", "目前未能完成這則訊息的理解", "目前未能確認這則訊息需要處理的內容", "訂房處理需求需要請業者確認", "這部分需要請業者確認"];
function bytes(response) { for (const wording of forbidden) assert.ok(!response.replyText.includes(wording), wording); }
test("formal Unknown survives internally without customer text", async () => {
  const { result } = await run(["ANSWER"], { unknownFacts: true });
  const outcome = result.artifacts.executionOutcomes[0];
  assert.equal(outcome.outcome, "unknown");
  assert.ok(unknownProvenanceFor(outcome));
  assert.equal(result.artifacts.requestEvidence[0].requestPresence, "PRESENT");
  assert.equal(result.finalDecision.action, "no_reply");
  assert.equal(result.finalResponse.shouldReply, false);
  assert.equal(result.finalResponse.replyText, ""); bytes(result.finalResponse);
});
test("formal human responsibility uses only the approved notice", async () => {
  const { result } = await run(["HANDOFF"]);
  assert.equal(result.finalDecision.action, "handoff");
  assert.equal(result.finalDecision.reviewRequired, true);
  assert.equal(result.finalResponse.replyText, HANDOFF); bytes(result.finalResponse);
});
test("human sibling cannot replace a known answer", async () => {
  const { result } = await run(["ANSWER", "HANDOFF"]);
  assert.ok(result.finalResponse.replyText.includes("Official fixture fact 0"));
  assert.ok(result.finalResponse.replyText.includes(HANDOFF));
  assert.equal(result.finalDecision.reviewRequired, true); bytes(result.finalResponse);
});
for (const withAnswer of [false, true]) test(`technical provenance remains internal; answer=${withAnswer}`, () => {
  const propertyId = "public-terminal", turnId = "turn", ctx = createTerminalContext({ propertyId, turnId });
  ctx.fromException(new Error("dependency failure"), "failed");
  const fact = { taskId: "answer", type: "policy", outcome: "answered", facts: { propertyId, source: "property_catalog", answer: "Official policy 11:00" } };
  const executions = withAnswer ? [fact] : [];
  const requestEvidence = ["failed", ...(withAnswer ? ["answer"] : [])].map(taskId => ({ taskId, requestPresence: "PRESENT", activeRequest: true, replyPermission: "ALLOWED", humanActionRequired: false }));
  const result = finalizeTurnResponse({ scope: { propertyId }, property: { propertyId }, turnId, terminalContext: ctx,
    requestEvidence, executionOutcomes: executions, taskResults: executions.map(item => ({ ...item, status: "answered" })) });
  assert.equal(result.terminalFailures[0].kind, "EXECUTION_TECHNICAL");
  assert.equal(result.responsePlan.sections.find(s => s.taskId === "failed").claimType, "PROCESSING_STATUS");
  assert.equal(result.finalDecision.reviewRequired, false);
  assert.equal(result.finalResponse.replyText, withAnswer ? "Official policy 11:00" : "");
  assert.equal(result.finalResponse.shouldReply, withAnswer); bytes(result.finalResponse);
  if (withAnswer) {
    const v = validateClaims(result.finalResponse.replyText + "目前未能完成處理", result.responsePlan,
      result.responsePlan.sections.map(s => s.taskId), null, { finalDecision: result.finalDecision });
    assert.equal(v.ok, false, "actual bytes must reject injected failure prose");
  }
});
test("validated absent remains absent", async () => {
  const { result } = await run(["NO_REPLY"]);
  assert.equal(result.artifacts.requestEvidence[0].requestPresence, "ABSENT");
  assert.equal(result.finalResponse.shouldReply, false); assert.equal(result.finalResponse.replyText, "");
});
test("global validation failure retains its safety classification before public silence", () => {
  const propertyId = "safety-control", taskId = "answer";
  const fact = { source: "property_catalog", propertyId, answer: "Official validated policy" };
  const result = finalizeTurnResponse({ scope: { propertyId }, property: { propertyId }, turnId: "turn", maxLength: 2,
    requestEvidence: [{ taskId, requestPresence: "PRESENT", activeRequest: true, replyPermission: "ALLOWED" }],
    executionOutcomes: [{ taskId, type: "policy", outcome: "answered", facts: fact }],
    taskResults: [{ taskId, type: "policy", status: "answered", facts: fact }] });
  assert.equal(result.finalDecision.reasonCode, "terminal_safety_blocked");
  assert.equal(result.rebuildCount, 1);
  assert.equal(result.initialClaimValidation.ok, false);
  assert.equal(result.finalResponse.shouldReply, false);
  assert.equal(result.finalResponse.replyText, "");
});
test("separate formal human obligations may share the single approved notice", async () => {
  const { result } = await run(["HANDOFF", "HANDOFF"]);
  assert.equal(result.finalResponse.replyText, HANDOFF);
  assert.equal(result.artifacts.responsePlan.renderObligations.length, 2);
  assert.equal(result.finalDecision.reviewRequired, true);
});
test("known policy remains visible without inventing a missing detail", () => {
  const propertyId = "detail-control", taskId = "policy";
  const facts = { propertyId, source: "property_catalog", answer: "Official departure time 11:00", detailNeedsConfirmation: true, detailIntent: "conditions" };
  const result = finalizeTurnResponse({ scope: { propertyId }, property: { propertyId }, turnId: "turn",
    requestEvidence: [{ taskId, requestPresence: "PRESENT", activeRequest: true, replyPermission: "ALLOWED", humanActionRequired: false }],
    executionOutcomes: [{ taskId, type: "policy", outcome: "answered", facts }],
    taskResults: [{ taskId, type: "policy", status: "answered", facts }] });
  assert.equal(result.finalResponse.replyText, facts.answer);
  assert.equal(result.finalDecision.reviewRequired, false);
  assert.equal(result.responsePlan.sections[0].facts.detailNeedsConfirmation, true);
});
