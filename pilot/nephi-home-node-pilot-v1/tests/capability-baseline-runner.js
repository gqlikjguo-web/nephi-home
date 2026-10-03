"use strict";
// STRUCTURED_CONTRACT_TEST / FAKE_INTEGRATION, NOT a raw production replay.
// Production shapes: a73ca81a (policy), a75d4928 (amenities), a8bd08e7 -> 1bae1fc0 (stay modification).
// Operational identifiers/facts are synthetic. Model transport is always injected.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { run, refs, stay } = require("./helpers/capability-baseline-fixture");
const information = (category, identity) => ({ capability: category, kind: category, identity,
  text: `Please explain ${identity}.`, stayDependent: false });
for (const [category, identity] of [["policy", "travel_subsidy"], ["amenity", "parking"], ["amenity", "clothes_dryer"]]) {
  test(`production-derived ${identity} retains formal catalog fact and reply in one call`, async () => {
    const t = await run([information(category, identity)]);
    assert.equal(t.result.earliestFailure, null);
    assert.equal(t.calls, 1);
    assert.equal(t.queries.length, 0);
    const outcome = t.result.artifacts.executionOutcomes[0];
    assert.equal(outcome.facts.source, "property_catalog");
    assert.equal(outcome.facts.propertyId, "receipt-property");
    assert.equal(outcome.outcome, "answered");
    assert.equal(t.result.finalDecision.action, "reply");
    assert.ok(t.result.finalResponse.replyText.includes(`Official fixture fact: ${identity}.`));
  });
}
test("parking and dryer remain two independent answered units", async () => {
  const t = await run([information("amenity", "parking"), information("amenity", "clothes_dryer")]);
  assert.equal(t.result.earliestFailure, null);
  assert.equal(t.calls, 1);
  assert.equal(t.result.artifacts.executionOutcomes.length, 2);
  assert.equal(t.result.artifacts.understanding.validatedUnits.length, 2);
  assert.ok(t.result.finalResponse.replyText.includes("Official fixture fact: parking."));
  assert.ok(t.result.finalResponse.replyText.includes("Official fixture fact: clothes_dryer."));
});
test("single availability and grounded room set query preserve dates, nights and scope", async () => {
  const t = await run([stay()]);
  assert.equal(t.result.earliestFailure, null);
  assert.equal(t.calls, 1);
  assert.equal(t.queries.length, 1);
  assert.equal(t.queries[0].customerId, "receipt-property");
  assert.deepEqual(t.result.artifacts.formalRequests[0].entity.canonicalSet, ["double-a", "double-b"]);
  const request = t.result.artifacts.formalRequests[0];
  assert.deepEqual([request.stay.checkIn, request.stay.checkOut, request.stay.nights], ["2026-10-06", "2026-10-09", 3]);
  assert.equal(t.state.tasks[0].nights, 3);
  assert.equal(t.state.tasks[0].expiresAt, "2026-10-03T08:00:00.000Z");
});
test("an inserted amenity turn preserves the exact stay for double-to-quad modification, without inventing guests", async () => {
  const first = await run([stay()]);
  const insert = await run([information("amenity", "parking"), information("amenity", "clothes_dryer")], { previous: first });
  const changed = await run([{ capability: "availability", roomType: "四人房", setProduct: true, text: "換成四人房", relation: "MODIFICATION", refs: refs(first) }], { previous: insert });
  assert.equal(changed.result.earliestFailure, null);
  assert.equal(changed.calls, 1);
  const request = changed.result.artifacts.formalRequests[0];
  assert.deepEqual([request.stay.checkIn, request.stay.checkOut, request.stay.nights], ["2026-10-06", "2026-10-09", 3]);
  assert.deepEqual(request.entity.canonicalSet, ["quad-a", "quad-b"]);
  assert.equal(request.stay.guests, null);
  const selected = changed.result.artifacts.contextCandidates[0].resolvedTargetRequestCycleId;
  assert.equal(selected, first.state.tasks[0].taskId);
  assert.equal(changed.state.tasks.find(x => x.taskId === selected).nights, 3);
  assert.equal(changed.result.finalDecision.action, "reply");
});
test("ordinary acknowledgement stays NONE/no_reply with no execution", async () => {
  const t = await run([{ purpose: "acknowledgement", capability: null, kind: null, identity: null, text: "Acknowledged.", relation: "NONE" }]);
  assert.equal(t.result.earliestFailure, null);
  assert.equal(t.calls, 1);
  assert.equal(t.queries.length, 0);
  assert.deepEqual(t.state.tasks, []);
  assert.equal(t.result.finalDecision.action, "no_reply");
  assert.equal(t.result.finalResponse.shouldReply, false);
});
