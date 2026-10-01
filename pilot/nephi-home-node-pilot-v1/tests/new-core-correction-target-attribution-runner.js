"use strict";
// STRUCTURED_CONTRACT_TEST / FAKE_INTEGRATION: injected model transport only.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { correctionUnitSetPreserved } = require("../lib/providers/understanding-correction-scope");
const { turn, refs, dateRange, NOW } = require("./helpers/new-core-context-scenarios");
const recorded = require("./fixtures/understanding-cancellation-target-recorded.json");

test("field-only target repair damage does not become unit-set damage", () => {
  const [previous, next] = structuredClone(recorded.outputs);
  const link = previous.contextLinkCandidates[0];
  const allowed = recorded.before.input.recentConversation.filter(event => event.referenceableCycleIds.length)
    .map(({ eventId, messageRef }) => ({ eventId, messageRef }));
  assert.ok(allowed.length);
  const failure = { unitId: previous.understandingOutput.units[0].unitId,
    targetReferenceRepair: { contextLinkCandidateId: link.contextLinkCandidateId, allowedHistoryEventRefs: allowed } };
  assert.deepEqual(previous.understandingOutput.units.map(unit => unit.unitId), next.understandingOutput.units.map(unit => unit.unitId));
  assert.equal(correctionUnitSetPreserved(previous, next, [failure]), true);
  const removed = structuredClone(next);
  removed.understandingOutput.units = [];
  assert.equal(correctionUnitSetPreserved(previous, removed, [failure]), false);
});

test("renaming a validated sibling still reports SIBLING rather than FIELD", async () => {
  const first = await turn([{ capability: "availability", kind: "room", identity: "room-a",
    temporal: dateRange("2026-11-08", "2026-11-10") }]);
  const ordinary = { eventId: "ordinary-history", messageRef: "ordinary-history", role: "guest",
    timestamp: NOW, messageKind: "text", messageText: "An unprocessed follow-up.", referenceableCycleIds: [] };
  const invalidRef = [{ eventId: ordinary.eventId, messageRef: ordinary.messageRef }];
  let attempt = 0;
  const result = await turn([
    { purpose: "cancellation", capability: null, kind: null, identity: null,
      relation: "TERMINATION", refs: invalidRef, text: "End the lodging inquiry." },
    { purpose: "acknowledgement", capability: null, kind: null, identity: null,
      relation: "NONE", text: "Acknowledged." }
  ], { previous: first.state, history: [...first.history, ordinary], transformOutput: (output, input) => {
    if (++attempt === 2) {
      const bound = input.recentConversation.filter(event => event.referenceableCycleIds.length)
        .map(({ eventId, messageRef }) => ({ eventId, messageRef }));
      output.contextLinkCandidates[0].referencedHistoryEventRefs = bound;
      output.sourceObligations.requirements[0].referencedHistoryEventRefs = bound;
      output.understandingOutput.units[1].unitId = "renamed-sibling";
      output.contextLinkCandidates[1].unitId = "renamed-sibling";
      output.sourceObligations.requirements[1].unitId = "renamed-sibling";
    }
    return output;
  } });
  assert.equal(result.calls, 2);
  assert.ok(result.result.artifacts.terminalFailures.some(failure => failure.code === "CORRECTION_SIBLING_NOT_PRESERVED"));
  assert.deepEqual(result.state.tasks, first.state.tasks);
  assert.equal(result.queries.length, 0);
});

test("elapsed TTL excludes an answered cycle without rewriting its persisted status", async () => {
  const first = await turn([{ capability: "availability", kind: "room", identity: "room-a",
    temporal: dateRange("2026-11-08", "2026-11-10") }]);
  const now = "2026-09-27T03:00:00.000Z";
  assert.equal(first.state.tasks[0].status, "answered");
  assert.ok(Date.parse(first.state.tasks[0].expiresAt) < Date.parse(now));
  const result = await turn([{ purpose: "cancellation", capability: null, kind: null, identity: null,
    relation: "TERMINATION", refs: refs(first), text: "End the lodging inquiry." }],
  { previous: first.state, history: first.history, now });
  assert.equal(result.c01.referenceableCycles.length, 0);
  assert.equal(result.result.earliestFailure.failureCode, "CONTEXT_TARGET_UNAVAILABLE");
  assert.deepEqual(result.result.artifacts.adapted.lifecycleOperations, []);
  assert.deepEqual(result.state.tasks, first.state.tasks);
  assert.equal(result.queries.length, 0);
  assert.equal(result.result.finalDecision.action, "handoff");
  assert.equal(result.result.finalResponse.replyText, "請稍後，將盡快回覆您。");
});
