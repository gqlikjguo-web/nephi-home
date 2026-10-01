"use strict";
// RECORDED_REPRODUCTION / FAKE_INTEGRATION / RUNTIME_COMPONENT_TEST.
// All model transport is injected; no OpenAI, database or LINE calls.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../lib/new-core/application-service");
const provider = require("../lib/providers/openai-understanding-v1");
const { createTerminalContext } = require("../lib/new-core/terminal-failure");
const { isValidatedFinalResponse } = require("../lib/conversation-engine-v2/claim-validator");
const { turn, refs, dateRange } = require("./helpers/new-core-context-scenarios");
const saved = require("./fixtures/understanding-unsupported-terminal-recorded.json");

function recordedProperty(propertyId) {
  const room = (id, name, type, capacity, price) => ({ id, name, type, capacity,
    basePrice: price, mondayThursdayPrice: price, fridayPrice: price, saturdayHolidayPrice: price, sundayPrice: price });
  return { propertyId, timezone: "Asia/Taipei", currency: "TWD", availabilityAutoReplyEnabled: true,
    rooms: [room("901", "901雙人房", "double", 2, 1200), room("903", "903雙人房", "double", 2, 1200),
      room("902", "902四人房", "quad", 4, 1800),
      { ...room("all", "完整包棟", "", 8, 3300), inventoryType: "bundle", memberRoomIds: ["901", "903", "902"] }],
    commonAnswers: { checkInTime: "15:00" }, businessProfile: { publicSlug: "recorded-property" },
    propertyFacts: [{ canonicalId: "parking", category: "amenity", publicName: "停車場", status: "allowed",
      publicText: "合成測試停車位免費提供。" }] };
}
async function replayLatest() {
  const before = structuredClone(saved.before), now = before.input.sourceEvents[0].timestamp;
  let calls = 0, queries = 0, inputFailure;
  const result = await app.executeNewCoreTurn({ ...before, now, property: recordedProperty(before.scope.propertyId),
    publicBaseUrl: "https://example.invalid", providerConfig: { apiKey: "fixture-only" },
    resolver: { availability: () => { queries++; throw Error("UNTRUSTED_RESOLVER"); },
      availableDates: () => { queries++; throw Error("UNTRUSTED_RESOLVER"); },
      priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, config) => provider.callOpenAIUnderstandingV1(input, {
      ...config, nowMs: () => Date.parse(now), fetchImpl: async (_url, request) => {
        try {
          assert.deepEqual(JSON.parse(JSON.parse(request.body).input[1].content[0].text), saved.providerInput);
          assert.deepEqual(input.referenceableCycles, [], "expired Context cannot be offered to the model");
        } catch (error) { inputFailure = error; throw error; }
        assert.ok(calls < 2 && calls < saved.outputs.length, "only the exact saved attempts");
        const output = saved.outputs[calls++];
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({
          model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }]
        }) };
      }
    })
  });
  if (inputFailure) throw inputFailure;
  return { before, result, calls, queries };
}

test("latest recorded unsupported C03 need hands off without reviving expired Context", async () => {
  const { before, result, calls, queries } = await replayLatest();
  assert.equal(saved.outputs[0].understandingOutput.units[0].purpose, "unknown");
  assert.equal(saved.outputs[0].understandingOutput.units[0].capability, "unsupported");
  assert.equal(calls, 2);
  assert.equal(result.earliestFailure.failureCode, "UNIT_MEANING_UNSUPPORTED");
  assert.equal(result.artifacts.understanding.failedUnits[0].boundary, "C03");
  assert.deepEqual(result.state.tasks, before.state.tasks);
  assert.equal(queries, 0);
  assert.equal(result.artifacts.formalRequests.length, 0);
  console.log("U1_EVIDENCE", JSON.stringify({ earliest: result.earliestFailure,
    failed: result.artifacts.understanding.failedUnits, decision: result.finalDecision.action,
    response: result.finalResponse.replyText, terminal: result.artifacts.terminalFailures }));
  assert.equal(result.finalDecision.action, "handoff");
  assert.equal(result.finalResponse.replyText, "請稍後，將盡快回覆您。");
  assert.equal(isValidatedFinalResponse(result.finalResponse), true);
});

async function twoStays() {
  const first = await turn([{ capability: "availability", kind: "room", identity: "room-a",
    temporal: dateRange("2026-10-22", "2026-10-24") }]);
  const second = await turn([{ capability: "availability", kind: "room", identity: "room-b",
    temporal: dateRange("2026-11-03", "2026-11-05") }], { previous: first.state, history: first.history });
  assert.equal(first.result.earliestFailure, null);
  assert.equal(second.result.earliestFailure, null);
  assert.equal(second.state.tasks.length, 2);
  return { first, second };
}

test("a unique formal history binding selects its target even when the new product matches another cycle", async () => {
  const { first, second } = await twoStays();
  const next = await turn([{ capability: "availability", kind: "room", identity: "room-b",
    relation: "MODIFICATION", refs: refs(first), slots: [["product", "room-b"]] }],
    { previous: second.state, history: [...first.history, ...second.history] });
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.calls, 1);
  assert.equal(next.state.tasks.find(task => task.taskId === first.state.tasks[0].taskId).productId, "room-b");
  assert.deepEqual(next.state.tasks.find(task => task.taskId === second.state.tasks[1].taskId), second.state.tasks[1]);
  assert.equal(next.queries[0].checkIn, "2026-10-22");
});

for (const value of ["product", "dates"]) test(`a modification's new ${value} cannot select an old target from a shared history binding`, async () => {
  const { second } = await twoStays();
  const shared = { eventId: "shared-origin", messageRef: "shared-origin", role: "guest",
    timestamp: "2026-09-24T02:00:00.000Z", messageKind: "text", messageText: "two verified requests",
    referenceableCycleIds: second.state.tasks.map(task => task.taskId) };
  const spec = { capability: "availability", kind: "room", identity: "room-b", relation: "MODIFICATION",
    refs: [{ eventId: shared.eventId, messageRef: shared.messageRef }],
    ...(value === "product" ? { slots: [["product", "room-b"]] } : { temporal: dateRange("2026-11-03", "2026-11-05") }) };
  const next = await turn([spec], { previous: second.state, history: [shared] });
  console.log("U2_EVIDENCE", JSON.stringify({ value, earliest: next.result.earliestFailure,
    targets: next.result.artifacts.contextCandidates, queries: next.queries }));
  assert.equal(next.result.earliestFailure?.failureCode, "CONTEXT_TARGET_AMBIGUOUS");
  assert.deepEqual(next.state.tasks, second.state.tasks);
  assert.equal(next.queries.length, 0);
  assert.equal(next.result.finalDecision.action, "handoff");
  assert.equal(next.result.finalResponse.replyText, "請稍後，將盡快回覆您。");
});

test("a later transport failure preserves an actually admitted acknowledgement NONE receipt", async () => {
  const admitted = await turn([{ purpose: "acknowledgement", capability: null, kind: null, identity: null,
    text: "Acknowledged.", relation: "NONE", stayDependent: false }]);
  assert.equal(admitted.result.earliestFailure, null);
  assert.equal(provider.isTrustedUnderstandingResult(admitted.result.artifacts.understanding), true);
  const evidence = admitted.result.artifacts.requestEvidence;
  assert.equal(evidence[0].requestPresence, "ABSENT");
  const input = admitted.c01, scope = admitted.state.scope;
  const context = createTerminalContext({ propertyId: scope.propertyId, turnId: input.turnId, understandingTurnInput: input });
  const error = Object.assign(new Error("fixture transport failure"), { code: "UNDERSTANDING_PROVIDER_TIMEOUT", errorCategory: "timeout" });
  context.fromException(error, evidence[0].taskId, "UNDERSTANDING");
  const result = app.finalizeTurnResponse({ scope, turnId: input.turnId, property: { propertyId: scope.propertyId },
    terminalContext: context, requestEvidence: evidence });
  assert.equal(result.finalDecision.action, "no_reply");
  assert.equal(result.finalResponse.shouldReply, false);
  assert.equal(result.finalDecision.reviewRequired, false);
});

// FAKE_INTEGRATION: timeout is injected at the actual provider transport boundary.
// This proves fail-safe delivery only; no pre-timeout semantic classification exists.
test("an unresolved customer turn times out safely without Context or Resolver execution", async () => {
  const before = structuredClone(saved.before), now = before.input.sourceEvents[0].timestamp;
  let calls = 0, queries = 0;
  const result = await app.executeNewCoreTurn({ ...before, now, property: recordedProperty(before.scope.propertyId),
    providerConfig: { apiKey: "fixture-only" }, publicBaseUrl: "https://example.invalid",
    resolver: { availability: () => { queries++; throw Error("UNTRUSTED_RESOLVER"); },
      availableDates: () => { queries++; throw Error("UNTRUSTED_RESOLVER"); },
      priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, config) => provider.callOpenAIUnderstandingV1(input, {
      ...config, fetchImpl: async () => { calls++; throw Object.assign(new Error("offline timeout"), { name: "AbortError" }); }
    })
  });
  assert.equal(calls, 1);
  assert.equal(result.earliestFailure.failureCode, "UNDERSTANDING_PROVIDER_TIMEOUT");
  assert.equal(result.finalDecision.action, "handoff");
  assert.equal(result.finalResponse.replyText, "請稍後，將盡快回覆您。");
  assert.deepEqual(result.state.tasks, before.state.tasks);
  assert.equal(queries, 0);
  assert.equal(result.artifacts.requestEvidence[0].requestPresence, "UNDETERMINED");
});
