"use strict";
// FAKE_INTEGRATION / STRUCTURED_CONTRACT_TEST. Zero real provider calls.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { run, lodging, information, setRelation, refs, FACTS } = require("./helpers/multi-unit-relation-fixture");
const { unknownProvenanceFor } = require("../lib/conversation-engine-v2/claim-validator");
const rows = FACTS.filter(([, identity]) => identity !== "reading_lounge");
const outcome = (turn, capability) => turn.result.artifacts.executionOutcomes.find(item => item.capability === capability || item.type === capability);
const admitted = turn => turn.result.artifacts.understanding?.validatedUnits.map(unit => unit.unitId) || [];
function assertAnswer(turn, identity, propertyId = "relation-alpha") {
  assert.equal(turn.result.earliestFailure, null, JSON.stringify(turn.result.earliestFailure));
  const result = turn.result.artifacts.executionOutcomes.find(item => item.facts?.answer === `Registered ${identity} facts for ${propertyId}.`);
  assert.ok(result, JSON.stringify(turn.result.artifacts.executionOutcomes));
  assert.equal(result.outcome, "answered");
  assert.equal(result.facts.propertyId, propertyId);
  assert.equal(result.facts.source, "property_catalog");
  assert.ok(turn.result.finalResponse.replyText.includes(result.facts.answer));
}
async function prior() {
  const turn = await run([lodging()]);
  assert.equal(turn.result.earliestFailure, null);
  assert.equal(turn.result.state.tasks[0].status, "answered");
  return turn;
}
function rejectedPair(output, previous) {
  setRelation(output, "stay", "RELATED_REQUEST", refs(previous));
  setRelation(output, "information", "RELATED_UNIT", [], "stay");
  return output;
}
function localFailures(turn) {
  return turn.attempts[1]?.correctionInput?.failures.filter(failure => failure.unitValidationFailed !== false) || [];
}
for (const [kind, identity] of rows) {
  test(`independent booking + ${identity} retains both responsibilities in one call`, async () => {
    const turn = await run([lodging("booking_operator_request"), information(kind, identity)]);
    assertAnswer(turn, identity);
    assert.equal(turn.calls, 1);
    assert.equal(turn.queries.length, 0, "operator handoff and property facts do not query inventory");
    assert.ok(outcome(turn, "human_help"));
    assert.ok(turn.result.finalResponse.replyText.includes("請稍後，將盡快回覆您。"));
  });
  test(`all invalid relation edges reach the one correction: booking + ${identity}`, async () => {
    const previous = await prior();
    const turn = await run([lodging("booking_operator_request"), information(kind, identity)], {
      previous, transform: (output, attempt) => attempt === 1 ? rejectedPair(output, previous) : output
    });
    assertAnswer(turn, identity);
    assert.equal(turn.calls, 2);
    const failures = localFailures(turn);
    assert.deepEqual(failures.map(failure => failure.unitId).sort(), ["information", "stay"],
      "the first failure must not conceal another invalid dependency");
    assert.ok(failures.every(failure => failure.origin === "model_output"));
    const dependency = failures.find(failure => failure.unitId === "information");
    assert.ok(dependency.field.endsWith("referencedCurrentUnitId"));
    assert.ok(dependency.relationDependencyRepair, "the formal failure must bound the dependency repair");
    assert.deepEqual(admitted(turn).sort(), ["information", "stay"]);
    assert.equal(turn.result.state.tasks.filter(task => task.capability === kind).every(task => !task.checkIn && !task.checkOut), true);
  });
}
test("a same-turn incompatible dependency alone is a correctable model relation failure", async () => {
  const turn = await run([lodging(), information("amenity", "parking")], {
    transform: (output, attempt) => {
      if (attempt === 1) setRelation(output, "information", "RELATED_UNIT", [], "stay");
      return output;
    }
  });
  assert.equal(turn.calls, 2);
  assertAnswer(turn, "parking");
  assert.equal(turn.queries.length, 1);
  assert.equal(turn.attempts[0].validationResult.failures.find(failure => failure.unitId === "information").boundary, "C05");
});
test("a fully revalidated independent sibling survives an unfinished relation correction", async () => {
  const previous = await prior();
  const turn = await run([lodging("booking_operator_request"), information("policy", "pets"), information("amenity", "parking", "independent")], {
    previous, transform: (output, attempt) => {
      if (attempt === 1) rejectedPair(output, previous);
      else setRelation(output, "information", "RELATED_UNIT", [], "stay");
      return output;
    }
  });
  assert.equal(turn.calls, 2);
  assert.ok(admitted(turn).includes("independent"));
  assert.ok(!admitted(turn).includes("information"), "invalid dependency must remain nonexecutable");
  assert.ok(turn.result.finalResponse.replyText.includes("Registered parking facts for relation-alpha."));
  assert.ok(turn.result.finalResponse.replyText.includes("請稍後，將盡快回覆您。"));
  assert.ok(!turn.result.artifacts.executionOutcomes.some(item => item.facts?.answer?.includes("pets")));
  assert.equal(turn.queries.length, 0);
});
test("relation correction cannot add history semantics to an unrelated preserved sibling", async () => {
  const previous = await prior();
  const price = { ...lodging("price"), id: "price" };
  const turn = await run([lodging("booking_operator_request"), information("policy", "pets"), price], {
    previous, transform: (output, attempt) => {
      if (attempt === 1) return rejectedPair(output, previous);
      setRelation(output, "price", "RELATED_REQUEST", refs(previous));
      return output;
    }
  });
  assert.equal(turn.calls, 2);
  assert.equal(turn.queries.length, 0);
  assert.equal(turn.attempts[1].accepted, false);
  assert.equal(turn.attempts[1].validationResult.adoptionFailure, "CORRECTION_FIELD_NOT_PRESERVED");
});
test("relation repair preserves validated operator purpose, capability, values and source obligations", async () => {
  const previous = await prior();
  const turn = await run([lodging("booking_operator_request"), information("policy", "pets")], {
    previous, transform: (output, attempt) => {
      if (attempt === 1) return rejectedPair(output, previous);
      output.understandingOutput.units[0].slotCandidates[0].value = 3;
      return output;
    }
  });
  assert.equal(turn.calls, 2);
  assert.equal(turn.queries.length, 0);
  assert.equal(turn.attempts[1].accepted, false);
  assert.equal(turn.attempts[1].validationResult.adoptionFailure, "CORRECTION_FIELD_NOT_PRESERVED");
});
test("correction transport failure never validates missing structured output", async () => {
  const previous = await prior();
  const turn = await run([lodging("booking_operator_request"), information("policy", "pets")], {
    previous, transform: (output, attempt) => attempt === 1 ? rejectedPair(output, previous)
      : Object.assign(new Error("isolated transport failure"), { name: "AbortError" })
  });
  assert.equal(turn.calls, 2);
  assert.equal(turn.queries.length, 0);
  assert.equal(turn.result.finalDecision.action, "handoff");
  assert.equal(turn.result.finalResponse.replyText, "請稍後，將盡快回覆您。");
  assert.equal(turn.attempts[1].validationResult.terminalCode, "UNDERSTANDING_PROVIDER_TIMEOUT");
});
test("a malformed correction remains a schema failure and cannot enter relation preservation", async () => {
  const previous = await prior();
  const turn = await run([lodging("booking_operator_request"), information("policy", "pets")], {
    previous, transform: (output, attempt) => {
      if (attempt === 1) return rejectedPair(output, previous);
      output.sourceObligations.requirements = null;
      return output;
    }
  });
  assert.equal(turn.calls, 2);
  assert.equal(turn.queries.length, 0);
  assert.equal(turn.result.finalDecision.action, "handoff");
  assert.equal(turn.attempts[1].validationResult.terminalCode, "UNDERSTANDING_SCHEMA_INVALID");
});
test("standalone availability still executes inventory once without history", async () => {
  const turn = await run([lodging()]);
  assert.equal(turn.calls, 1);
  assert.equal(turn.result.earliestFailure, null);
  assert.equal(turn.queries.length, 1);
  assert.equal(turn.queries[0].checkIn, "2026-10-08");
  assert.equal(turn.queries[0].checkOut, "2026-10-09");
  assert.equal(turn.queries[0].customerId, "relation-alpha");
});
test("standalone policy remains independent and does not inherit dates", async () => {
  const turn = await run([information("policy", "pets")], { previous: await prior() });
  assertAnswer(turn, "pets");
  assert.equal(turn.calls, 1);
  assert.equal(turn.queries.length, 0);
  assert.equal(turn.result.artifacts.formalRequests[0].stay.checkIn, null);
});
test("three independent amenities keep separate identities, facts and reply coverage", async () => {
  const identities = ["parking", "bathtub", "reading_lounge"];
  const turn = await run(identities.map((id, index) => information("amenity", id, `amenity-${index}`)), { propertyId: "relation-beta" });
  assert.equal(turn.calls, 1);
  for (const identity of identities) assertAnswer(turn, identity, "relation-beta");
  assert.equal(admitted(turn).length, 3);
  assert.equal(turn.queries.length, 0);
});
test("legitimate RELATED_UNIT reuses only verified same-stay conditions", async () => {
  const price = { ...information("price", "room-r", "price"), kind: "room", stayDependent: true,
    relation: "RELATED_UNIT", sourceUnitId: "stay" };
  const turn = await run([lodging(), price]);
  assert.equal(turn.calls, 1);
  assert.equal(turn.result.earliestFailure, null);
  assert.equal(turn.queries.length, 2);
  const requests = turn.result.artifacts.formalRequests;
  for (const request of requests) {
    assert.equal(request.stay.checkIn, "2026-10-08");
    assert.equal(request.stay.checkOut, "2026-10-09");
    assert.equal(request.stay.nights, 1);
  }
});
test("legitimate RELATED_REQUEST uses the exact compatible history target", async () => {
  const previous = await prior();
  const turn = await run([{ ...information("price", "room-r", "price"), kind: "room", stayDependent: true,
    relation: "RELATED_REQUEST", refs: refs(previous) }], { previous });
  assert.equal(turn.calls, 1);
  assert.equal(turn.result.earliestFailure, null);
  assert.equal(turn.queries.length, 1);
  assert.equal(turn.queries[0].checkIn, "2026-10-08");
  assert.equal(turn.result.state.tasks.length, 2, "different capabilities retain different cycles");
});
test("unknown property facts never become permission or a negative fact", async () => {
  const turn = await run([lodging("booking_operator_request"), information("policy", "pets")], { unknown: true });
  assert.equal(turn.calls, 1);
  const unknown = turn.result.artifacts.executionOutcomes.find(item => item.outcome === "unknown");
  assert.ok(unknownProvenanceFor(unknown));
  assert.equal(unknown.facts.answer, undefined);
  assert.equal(turn.result.finalResponse.replyText, "請稍後，將盡快回覆您。");
});
