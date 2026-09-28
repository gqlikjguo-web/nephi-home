"use strict";
// FAKE_INTEGRATION: actual signed webhook/coordinator/core/persistence, fixed
// Understanding and isolated LINE sink. No real providers or ideal prefilled State.
const assert = require("node:assert/strict");
const { setup } = require("./helpers/burst-production-fixture");

(async () => {
  const x = await setup("context-burst-provenance", { debounce: 20 });
  const writes = [], results = [];
  const persistence = x.providers.persistence;
  const update = persistence.updateMessageEvent.bind(persistence);
  const engine = x.app.lineWebhookCoordinator.engine;
  const processTurn = engine.process.bind(engine);
  persistence.updateMessageEvent = async (property, channel, event, patch) => {
    const value = await update(property, channel, event, patch);
    if (Array.isArray(patch.requestCycleRefs)) writes.push({
      event, status: value.processingStatus, refs: [...patch.requestCycleRefs]
    });
    return value;
  };
  engine.process = async input => {
    const result = await processTurn(input);
    results.push({ event: input.eventId, refs: result.requestCycleRefs,
      owned: result.eventRequestCycleRefs, writeCount: writes.length });
    return result;
  };
  try {
    await x.post([x.event("early"), x.event("late")]);
    await x.done("early");
    await x.done("late");
    const early = x.record("early"), late = x.record("late");
    console.log(JSON.stringify({ classification: "FAKE_INTEGRATION", results, writes,
      records: [early, late].map(record => ({event:record.eventId,
        status:record.processingStatus, refs:record.requestCycleRefs})) }));
    assert.deepEqual(results[0].owned, {early:["late-unit-0"], late:["late-unit-1"]},
      "validated unit evidence retains distinct event ownership");
    assert.deepEqual(results[0].refs, ["late-unit-0", "late-unit-1"],
      "the completed core result still carries the complete burst");
    assert.deepEqual(early.requestCycleRefs, results[0].owned.early,
      "merged event retains only its own admitted cycles");
    assert.deepEqual(late.requestCycleRefs, results[0].refs,
      "the tail must preserve the complete burst linkage, not only its own units");
    assert.equal(early.safeTrace[0].targetEventId, "late");
    assert.equal(x.sent.length, 1);
    assert.deepEqual(writes.find(write => write.event === "late" && write.status === "decided").refs,
      results[0].refs, "completed burst linkage is published before the scoped slot releases");
    await x.post([x.event("next")]);
    await x.done("next");
    assert.deepEqual(x.calls[1].c01.sourceEvents.map(event => event.eventId), ["next"],
      "prior burst is never relabeled as current-event source evidence");
    const history = x.calls[1].c01.recentConversation;
    assert.deepEqual(history.find(event => event.eventId === "early").referenceableCycleIds,
      results[0].owned.early);
    assert.deepEqual(history.find(event => event.eventId === "late").referenceableCycleIds,
      results[0].refs, "history keeps the complete admitted burst linkage");
    assert.ok(x.calls[1].priorRevision > x.calls[0].priorRevision);
    await x.post([x.event("next")]);
    assert.equal(x.calls.length, 2, "duplicate event does not execute again");
    assert.equal(x.sent.length, 2);
    console.log("PASS FAKE_INTEGRATION owned refs, full burst linkage, publication, history, dedup");
  } finally { await x.app.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
