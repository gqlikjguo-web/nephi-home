"use strict";

// STRUCTURED_CONTRACT_TEST / FAKE_INTEGRATION: no external provider calls.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const fixturePath = path.join(__dirname, "new-core-openai-adapter-contract-runner.js");
const fixture = new Module(fixturePath, module);
fixture.filename = fixturePath;
fixture.paths = Module._nodeModulePaths(__dirname);
fixture._compile(fs.readFileSync(fixturePath, "utf8").split("async function main()")[0]
  + "\nmodule.exports={c01,providerOutput,successfulResponse,options,schemaAccepts};", fixturePath);
const f = fixture.exports;
const { callOpenAIUnderstandingV1, openAiUnderstandingV1ProviderSchema,
  OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC: D } = require("../lib/providers/openai-understanding-v1");
const clone = value => JSON.parse(JSON.stringify(value));

function input() {
  const value = f.c01();
  return f.c01({ sourceEvents: [value.sourceEvents[0], {
    ...value.sourceEvents[0], eventId: "event-b", messageRef: "message-b"
  }] });
}

function wrongLink() {
  const output = f.providerOutput();
  Object.assign(output.contextLinkCandidates[0].currentSourceEvidenceRefs[0], {
    eventId: "fabricated-event", messageRef: "fabricated-message"
  });
  return output;
}

async function run(first, second, turnInput = input()) {
  const bodies = [];
  let result, error;
  try {
    result = await callOpenAIUnderstandingV1(turnInput, f.options(async (_url, request) => {
      bodies.push(JSON.parse(request.body));
      assert.ok(bodies.length <= 2, "one initial call plus at most one correction");
      return f.successfulResponse(bodies.length === 1 ? first : second);
    }));
  } catch (caught) { error = caught; }
  return { result, error, bodies, meta: (result || error)?.[D] };
}

function correctionBody(result) {
  return JSON.parse(result.bodies[1].input.at(-1).content[0].text.split("\n").at(-1));
}

test("every current-source schema accepts only exact C01 source pairs", () => {
  const schema = openAiUnderstandingV1ProviderSchema(input());
  const evidenceSchemas = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["evidenceRefs", "currentSourceEvidenceRefs"].includes(key)) evidenceSchemas.push(child.items);
      else visit(child);
    }
  }
  visit(schema);
  assert.ok(evidenceSchemas.length > 4, "unit, slot, quantity and context links covered");
  const ref = f.providerOutput().understandingOutput.units[0].evidenceRefs[0];
  for (const item of evidenceSchemas) {
    assert.equal(f.schemaAccepts(item, ref), true);
    assert.equal(f.schemaAccepts(item, { ...ref, eventId: "event-b", messageRef: "message-b" }), true);
    assert.equal(f.schemaAccepts(item, { ...ref, eventId: "fabricated-event" }), false);
    assert.equal(f.schemaAccepts(item, { ...ref, messageRef: "message-b" }), false,
      "individually valid IDs from different events are not an authorized pair");
  }
});

test("C04 locates the rejected link reference without blaming valid unit references", async () => {
  const r = await run(wrongLink(), f.providerOutput());
  assert.equal(r.meta.attempts[0].validationResult.failures[0].code, "EVIDENCE_SOURCE_UNKNOWN");
  const failure = correctionBody(r).failures[0];
  assert.equal(failure.field, "contextLinkCandidates.0.currentSourceEvidenceRefs.0");
  assert.deepEqual(failure.evidenceFailures, [{
    field: "contextLinkCandidates.0.currentSourceEvidenceRefs.0", code: "EVIDENCE_SOURCE_UNKNOWN"
  }]);
  assert.equal(failure.fieldValidationState.find(state => state.field === "evidenceRefs").preservation, "PRESERVE");
  assert.equal(r.meta.finalAcceptedAttempt, 2);
  assert.deepEqual(r.result.understandingOutput, f.providerOutput().understandingOutput);
});

test("recorded wrong-direction correction remains rejected with no third call", async () => {
  const second = wrongLink();
  Object.assign(second.understandingOutput.units[0].evidenceRefs[0], {
    eventId: "fabricated-event", messageRef: "fabricated-message"
  });
  const r = await run(wrongLink(), second);
  assert.equal(r.bodies.length, 2);
  assert.equal(r.meta.finalAcceptedAttempt, null);
  assert.equal(r.meta.attempts[1].validationResult.adoptionFailure, "CORRECTION_FIELD_NOT_PRESERVED");
});

for (const field of ["purpose", "legalReference", "linkReference"]) {
  test(`C04 repair cannot change an unrelated ${field} when a unit reference failed`, async () => {
    const valid = f.providerOutput();
    valid.understandingOutput.units[0].evidenceRefs.push({
      ...valid.understandingOutput.units[0].evidenceRefs[0], eventId: "event-b", messageRef: "message-b"
    });
    const first = clone(valid), second = clone(valid);
    first.understandingOutput.units[0].evidenceRefs[0].eventId = "fabricated-event";
    if (field === "purpose") second.understandingOutput.units[0].purpose = "conversational_statement";
    if (field === "legalReference") second.understandingOutput.units[0].evidenceRefs[1]
      = clone(second.understandingOutput.units[0].evidenceRefs[0]);
    if (field === "linkReference") Object.assign(second.contextLinkCandidates[0].currentSourceEvidenceRefs[0], {
      eventId: "event-b", messageRef: "message-b"
    });
    const control = await run(second, second);
    assert.equal(control.meta.finalAcceptedAttempt, 1, "replacement is independently valid, but unauthorized as a repair");
    const r = await run(first, second);
    assert.equal(r.meta.finalAcceptedAttempt, null);
    assert.equal(r.meta.attempts[1].validationResult.adoptionFailure, "CORRECTION_FIELD_NOT_PRESERVED");
  });
}

for (const change of ["unknownSource", "crossPair", "badQuote"]) {
  test(`correction fully revalidates ${change}`, async () => {
    const second = f.providerOutput();
    const ref = second.contextLinkCandidates[0].currentSourceEvidenceRefs[0];
    if (change === "unknownSource") ref.eventId = "not-in-c01";
    if (change === "crossPair") ref.messageRef = "message-b";
    if (change === "badQuote") ref.quote = "absent source text";
    const r = await run(wrongLink(), second);
    assert.equal(r.bodies.length, 2);
    assert.equal(r.meta.finalAcceptedAttempt, null);
    assert.equal(r.meta.attempts[1].validationResult.failures[0].boundary, "C04");
  });
}

test("valid first understanding is accepted once with no resampling", async () => {
  const r = await run(f.providerOutput(), wrongLink());
  assert.equal(r.bodies.length, 1);
  assert.equal(r.meta.finalAcceptedAttempt, 1);
});

test("legal correction preserves two-night typed meaning and all legitimate refs", async () => {
  const value = input();
  const messageText = "2027/9/7雙人房住兩晚可以嗎？";
  const c01 = f.c01({ sourceEvents: [{ ...value.sourceEvents[0], messageText }] });
  const valid = f.providerOutput();
  const ref = (startOffset, endOffset) => ({ eventId: "event-a", messageRef: "message-a",
    startOffset, endOffset, quote: messageText.slice(startOffset, endOffset) });
  Object.assign(valid.understandingOutput.units[0], {
    purpose: "lodging_question", capability: "availability", stayDependent: true,
    subject: { kind: "room", catalogIdentity: "room-a" },
    evidenceRefs: [ref(0, 8), ref(8, 11), ref(11, 14)],
    temporalCandidate: { rawText: "2027/9/7", kind: "absolute_date", checkInCandidate: "2027-09-07",
      checkOutCandidate: null, nightsCandidate: 2 }
  });
  Object.assign(valid.contextLinkCandidates[0], { relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: [ref(0, messageText.length)] });
  const bad = clone(valid);
  Object.assign(bad.contextLinkCandidates[0].currentSourceEvidenceRefs[0], {
    eventId: "fabricated-event", messageRef: "fabricated-message"
  });
  const control = await run(valid, valid, c01);
  assert.equal(control.meta.finalAcceptedAttempt, 1);
  const r = await run(bad, valid, c01);
  assert.equal(r.meta.finalAcceptedAttempt, 2);
  assert.equal(r.result.validatedUnits[0].temporalCandidate.nightsCandidate, 2);
  assert.deepEqual(r.result.understandingOutput, valid.understandingOutput);
});
