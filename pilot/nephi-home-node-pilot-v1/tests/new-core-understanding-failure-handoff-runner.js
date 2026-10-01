"use strict";
// RECORDED_REPRODUCTION / FAKE_INTEGRATION. Saved model outputs only.
// The actual provider admission, correction, Context, decision and renderer run.
// No OpenAI, PostgreSQL, LINE or deployment is invoked.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const provider = require("../lib/providers/openai-understanding-v1");
const { isValidatedFinalResponse } = require("../lib/conversation-engine-v2/claim-validator");
const saved = require("./fixtures/understanding-failure-handoff-recorded.json");
const { run } = require("./new-core-request-responsibility-fixture");
const { turn } = require("./helpers/new-core-context-scenarios");

function propertyFor(propertyId) {
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

async function replay(item, options = {}) {
  const before = structuredClone(item.before);
  const now = before.input.sourceEvents[0].timestamp;
  let calls = 0, queries = 0, replayInputFailure;
  const outputs = structuredClone(item.outputs);
  if (options.changeOutputs) options.changeOutputs(outputs);
  const property = { ...propertyFor(before.scope.propertyId), ...options.property };
  const result = await executeNewCoreTurn({ ...before, property, now,
    publicBaseUrl: "https://example.invalid", providerConfig: { apiKey: "fixture-only" },
    resolver: { availability: () => { queries++; throw Error("FAILED_NEED_EXECUTED_RESOLVER"); },
      availableDates: () => { queries++; throw Error("FAILED_NEED_EXECUTED_RESOLVER"); },
      priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, config) => {
      // Replay the exact saved source/scope/catalog/history, not idealized Context.
      try {
        for (const field of ["propertyScope", "sourceEvents", "publicSubjectCatalog"])
          assert.deepEqual(input[field], item.providerInput[field], field);
      } catch (error) { replayInputFailure = error; throw error; }
      if (item.caseNumber === 22) assert.deepEqual(input.referenceableCycles, [], "expired cycles must stay excluded");
      return provider.callOpenAIUnderstandingV1(input, { ...config, nowMs: () => Date.parse(now), fetchImpl: async (_url, request) => {
        try { assert.deepEqual(JSON.parse(JSON.parse(request.body).input[1].content[0].text), item.providerInput, "exact saved provider-visible input"); }
        catch (error) { replayInputFailure = error; throw error; }
        assert.ok(calls < outputs.length && calls < 2, "no resampling beyond saved attempts");
        const output = outputs[calls++];
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({
          model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }]
        }) };
      } });
    }
  });
  if (replayInputFailure) throw replayInputFailure;
  return { result, calls, queries, before };
}


test("Understanding provider timeout with a current text event fails safe to visible handoff", async () => {
  const item = saved.cases.find(row => row.caseNumber === 14);
  const before = structuredClone(item.before);
  const now = before.input.sourceEvents[0].timestamp;
  let queries = 0;
  const timeout = new Error("fixture provider timeout");
  timeout.code = "UNDERSTANDING_PROVIDER_TIMEOUT";
  timeout.errorCategory = "timeout";
  const result = await executeNewCoreTurn({ ...before, property: propertyFor(before.scope.propertyId), now,
    publicBaseUrl: "https://example.invalid", providerConfig: { apiKey: "fixture-only" },
    resolver: { availability: () => { queries++; throw Error("FAILED_NEED_EXECUTED_RESOLVER"); },
      availableDates: () => { queries++; throw Error("FAILED_NEED_EXECUTED_RESOLVER"); },
      priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: async () => { throw timeout; }
  });
  assert.equal(result.earliestFailure.failureCode, "UNDERSTANDING_PROVIDER_TIMEOUT");
  assert.equal(queries, 0);
  assert.deepEqual(result.state.tasks, before.state.tasks);
  assert.equal(result.finalDecision.action, "handoff");
  assert.equal(result.finalResponse.replyText, "請稍後，將盡快回覆您。");
  assert.equal(isValidatedFinalResponse(result.finalResponse), true);
});

for (const number of [14, 15, 16, 22]) test(`recorded failed need ${number} has visible handoff without Context or facts execution`, async () => {
  const item = saved.cases.find(row => row.caseNumber === number);
  const { result, calls, queries, before } = await replay(item);
  assert.equal(calls, 2);
  assert.equal(result.earliestFailure.failureCode, item.baselineEarliestFailure.failureCode);
  assert.equal(queries, 0);
  assert.deepEqual(result.state.tasks, before.state.tasks, "failed needs cannot create, modify or revive cycles");
  assert.equal((result.artifacts.canonicalItems || []).length, 0);
  assert.equal((result.artifacts.formalRequests || []).length, 0);
  assert.equal(result.finalDecision.action, "handoff", "verified failed customer need must not become silent no_reply");
  assert.equal(result.finalDecision.reviewRequired, true);
  assert.equal(result.finalResponse.shouldReply, true);
  assert.equal(result.finalResponse.replyText, "請稍後，將盡快回覆您。");
  assert.equal(isValidatedFinalResponse(result.finalResponse), true);
});

test("recorded new guest operator interpretation retains safe handoff and no foreign Context", async () => {
  const item = saved.cases.find(row => row.caseNumber === 21);
  const { result, calls, queries, before } = await replay(item);
  assert.equal(calls, 2);
  assert.deepEqual(before.state.tasks, []);
  assert.deepEqual(result.state.tasks, []);
  assert.equal(queries, 0);
  assert.equal(result.finalDecision.action, "handoff");
  assert.equal(result.finalResponse.replyText, "請稍後，將盡快回覆您。");
});

for (const number of [12, 20]) test(`recorded legitimate silence ${number} remains silent`, async () => {
  const { result, calls, queries } = await replay(saved.cases.find(row => row.caseNumber === number));
  assert.equal(calls, 1);
  assert.equal(queries, 0);
  assert.equal(result.finalDecision.action, "no_reply");
  assert.equal(result.finalDecision.reviewRequired, false);
  assert.equal(result.finalResponse.shouldReply, false);
  assert.equal(result.finalResponse.replyText, "");
  if (number === 12) assert.ok(result.state.tasks.some(task => task.status === "cancelled"));
});

for (const purpose of ["acknowledgement", "supplement", "context_update", "social", "off_topic"])
  test(`formal NONE ${purpose} does not acquire human responsibility`, async () => {
    const { result } = await run(["NO_REPLY"], { purpose });
    assert.equal(result.finalDecision.action, "no_reply");
    assert.equal(result.finalDecision.reviewRequired, false);
  });

test("independently admitted nights on a new guest still save and clarify with property link", async () => {
  const { result, calls, queries, state } = await turn([{ capability: "availability", kind: "property", identity: null,
    text: "那改成三晚吧。", temporal: { kind: "nights_only", rawText: "三晚", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 3 } }]);
  assert.equal(calls, 1);
  assert.equal(queries.length, 0);
  assert.equal(state.tasks[0].nights, 3);
  assert.equal(state.tasks[0].checkIn, null);
  assert.equal(result.finalDecision.action, "clarification");
  assert.ok(result.finalResponse.replyText.includes("入住日期"));
  assert.ok(result.finalResponse.replyText.includes("https://example.invalid/"));
});

test("policy-suppressed failed availability is not promoted to handoff", async () => {
  const { result } = await replay(saved.cases.find(row => row.caseNumber === 14), { property: { availabilityAutoReplyEnabled: false } });
  assert.equal(result.finalDecision.action, "no_reply");
  assert.equal(result.finalResponse.shouldReply, false);
});

for (const invalid of ["turn", "source"]) test(`unverified ${invalid} identity cannot create human responsibility`, async () => {
  const { result } = await replay(saved.cases.find(row => row.caseNumber === 22), { changeOutputs: outputs => {
    for (const output of outputs) {
      if (invalid === "turn") output.understandingOutput.turnId = "different-turn";
      else for (const unit of output.understandingOutput.units) for (const ref of unit.evidenceRefs) ref.eventId = "different-event";
    }
  } });
  assert.equal(result.finalDecision.action, "no_reply");
  assert.equal(result.finalResponse.shouldReply, false);
});
