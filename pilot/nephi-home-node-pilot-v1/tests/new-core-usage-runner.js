"use strict";
// FAKE_INTEGRATION: production provider/trace/transport with fake OpenAI and LINE,
// isolated JSON storage and PGlite. Never calls a real external provider.
const assert = require("node:assert/strict");
const { setup } = require("./helpers/burst-production-fixture");
const { formatNewCoreProductionTrace } = require("../lib/new-core/production-safe-trace");

const firstUsage = { input_tokens: 100, input_tokens_details: { cached_tokens: 60 }, output_tokens: 20, total_tokens: 120 };
const secondUsage = { input_tokens: 200, input_tokens_details: { cached_tokens: 120 }, output_tokens: 30, total_tokens: 230 };
const unknownUsage = { input_tokens: null, input_tokens_details: { cached_tokens: null }, output_tokens: null, total_tokens: null };

async function run(name, { usage, expectedUsage = usage === undefined ? unknownUsage : usage, correction = false, persistenceFailure = false, pg = false } = {}) {
  const x = await setup(`usage-${name}`, { debounce: 0, pg, providerResponse(payload, attempt) {
    if (usage !== undefined) payload.usage = attempt === 2 ? secondUsage : usage;
    payload.privateResponse = "UNSAVED_RAW_RESPONSE";
    if (correction && attempt === 1) {
      const output = JSON.parse(payload.output[0].content[0].text);
      output.understandingOutput.units[0].confidenceBand = "invalid";
      payload.output[0].content[0].text = JSON.stringify(output);
    }
    return payload;
  } });
  let failedWrites = 0;
  const attemptedTraces = [];
  if (persistenceFailure) {
    const update = x.providers.persistence.updateMessageEvent.bind(x.providers.persistence);
    x.providers.persistence.updateMessageEvent = (property, channel, event, patch) => {
      if (Object.hasOwn(patch, "safeTrace")) {
        attemptedTraces.push(patch.safeTrace);
        failedWrites++;
        throw Object.assign(new Error("synthetic trace persistence failure"), { code: "TRACE_PERSISTENCE_FAILURE" });
      }
      return update(property, channel, event, patch);
    };
  }
  try {
    await x.post([x.event("usage-turn")]);
    await x.done("usage-turn");
    await new Promise(resolve => setImmediate(resolve));
    const record = x.record("usage-turn");
    assert.equal(record.processingStatus, "reply_succeeded");
    assert.equal(x.sent.length, 1);
    assert.equal(x.core[0].earliestFailure, null);
    const trace = persistenceFailure ? attemptedTraces.at(-1) : record.safeTrace;
    const events = trace.filter(entry => entry.stage === "new_core_understanding_attempts");
    assert.equal(events.length, 1, "accounting reuses one existing attempt trace stage");
    const attempts = events[0].attempts;
    assert.equal(attempts.length, correction ? 2 : 1);
    assert.equal(x.calls[0].mockCalls, attempts.length, "each actual fetch attempt has one accounting entry");
    for (const [index, attempt] of attempts.entries()) {
      assert.equal(attempt.attemptNumber, index + 1);
      assert.equal(attempt.attemptType, index ? "correction" : "initial");
      assert.ok(attempt.usageAccounting, "every attempt must retain usage accounting");
      assert.equal(attempt.usageAccounting.propertyId, "audit_a");
      assert.equal(new Date(attempt.usageAccounting.timestamp).toISOString(), attempt.usageAccounting.timestamp);
      assert.deepEqual(attempt.usageAccounting.usage, index ? secondUsage : expectedUsage);
    }
    assert.equal(JSON.stringify(trace).includes("UNSAVED_RAW_RESPONSE"), false);
    if (persistenceFailure) {
      assert.ok(failedWrites > 0, "exercise the real server trace-persistence catch path");
      assert.equal(record.safeTrace, undefined, "a failed write must not be claimed as persisted");
    }
    return { reply: record.replyText, action: x.core[0].decision.action, revision: x.core[0].state.revision };
  } finally {
    await x.app.stop();
  }
}

(async () => {
  const normal = await run("present", { usage: firstUsage, pg: true });
  assert.deepEqual(await run("missing"), normal, "unknown usage must not change the reply or State result");
  assert.deepEqual(await run("malformed", { usage: 0, expectedUsage: unknownUsage }), normal);
  assert.deepEqual(await run("missing-cached", { usage: { ...firstUsage, input_tokens_details: 0 }, expectedUsage: { ...firstUsage, input_tokens_details: { cached_tokens: null } } }), normal);
  assert.deepEqual(await run("zero", { usage: { ...firstUsage, input_tokens_details: { cached_tokens: 0 } } }), normal);
  assert.deepEqual(await run("correction", { usage: firstUsage, correction: true }), normal);
  assert.deepEqual(await run("persistence-failure", { usage: firstUsage, persistenceFailure: true }), normal);

  const input = { stage: "new_core_understanding_attempts", traceId: "usage-trace", totalUnderstandingCalls: 1, attempts: [{
    attemptNumber: 1, attemptType: "initial", usageAccounting: {
      propertyId: "audit_a", timestamp: "2026-09-16T00:00:00.000Z", rawResponse: "PRIVATE",
      usage: { ...firstUsage, secret: "PRIVATE", input_tokens_details: { cached_tokens: 60, raw: "PRIVATE" } }
    }
  }] };
  const safe = formatNewCoreProductionTrace(input);
  assert.deepEqual(safe.attempts[0].usageAccounting.usage, firstUsage);
  assert.equal(JSON.stringify(safe).includes("PRIVATE"), false);
  assert.deepEqual(formatNewCoreProductionTrace(safe), safe, "DB review formatting preserves accounting on a second pass");
  for (const invalid of [undefined, null, -1, 1.5, NaN, Infinity, "12", Number.MAX_SAFE_INTEGER + 1]) {
    input.attempts[0].usageAccounting.usage = { input_tokens: invalid, input_tokens_details: { cached_tokens: invalid }, output_tokens: invalid, total_tokens: invalid };
    assert.deepEqual(formatNewCoreProductionTrace(input).attempts[0].usageAccounting.usage, unknownUsage);
  }
  console.log("PASS FAKE_INTEGRATION usage/cached/unknown/correction, isolated message_logs persistence, failure-safe reply, numeric allowlist");
})().catch(error => { console.error(error); process.exitCode = 1; });
