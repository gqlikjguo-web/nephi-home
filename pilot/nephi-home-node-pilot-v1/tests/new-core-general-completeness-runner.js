"use strict";

// FAKE_INTEGRATION / STRUCTURED_CONTRACT_TEST. Fixed model output, actual
// admission/lifecycle/composer. No network, database, production or OpenAI use.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
function fixture(name, boundary, exports) {
  const filename = path.join(__dirname, name);
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(__dirname);
  module._compile(fs.readFileSync(filename, "utf8").split(boundary)[0]
    + `\nmodule.exports={${exports}};`, filename);
  return module.exports;
}
const f = fixture("new-core-openai-adapter-contract-runner.js", "async function main()",
  "c01,providerOutput,successfulResponse,options,unit,link,evidence");
const lifecycle = fixture("new-core-context-lifecycle-runner.js", "const fourGuestsText =",
  "validatedPipeline,turnInput,slot");
const preservation = fixture("new-core-semantic-obligation-runner.js", "(async()=>{const results=[];",
  "cases,run");
const {
  callOpenAIUnderstandingV1,
  OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC: D
} = require("../lib/providers/openai-understanding-v1");
const { productionUnderstandingFailureEvidence } = require("../lib/providers/understanding-attempt-diagnostic");
const { composeSection, validateComposedSection } = require("../lib/conversation-engine-v2/controlled-composer");
const { turn, refs, dateRange } = require("./helpers/new-core-context-scenarios");
const clone = value => JSON.parse(JSON.stringify(value));

async function understand(input, first, second = first) {
  let calls = 0, value, error;
  try {
    value = await callOpenAIUnderstandingV1(input, f.options(async () => {
      calls++;
      assert.ok(calls <= 2, "Understanding cannot exceed two calls");
      return f.successfulResponse(calls === 1 ? first : second);
    }));
  } catch (caught) { error = caught; }
  return { calls, value, error, diagnostic: (value || error)?.[D] };
}

test("G1 / omitted unit: a source event cannot disappear behind an empty valid envelope", async () => {
  const output = f.providerOutput();
  output.understandingOutput.units = [];
  output.contextLinkCandidates = [];
  const r = await understand(f.c01(), output);
  assert.equal(r.diagnostic.finalAcceptedAttempt, null,
    "No semantic disposition or admission obligation accounts for the current source");
});

test("G1 / omitted current source: another source's legal unit does not cover this source", async () => {
  const original = f.c01().sourceEvents[0];
  const input = f.c01({ sourceEvents: [original,
    { ...original, eventId: "unaccounted-event", messageRef: "unaccounted-message", messageText: "可否提供房價？" }] });
  const r = await understand(input, f.providerOutput());
  assert.equal(r.diagnostic.finalAcceptedAttempt, null,
    "Every event needs its own source-grounded semantic disposition");
});

test("G1 / accepted residual limitation: simultaneous misclassification is not independent semantic proof", async () => {
  const messageText = "需要住兩晚，也想知道房價";
  const input = f.c01({ sourceEvents: [{ ...f.c01().sourceEvents[0], messageText }] });
  const ref = f.evidence({ endOffset: messageText.length, quote: messageText });
  const output = f.providerOutput({ understandingOutput: { schemaVersion: 1,
    turnId: input.turnId, units: [f.unit({ evidenceRefs: [ref] })] },
    contextLinkCandidates: [f.link({ currentSourceEvidenceRefs: [ref] })],
    sourceObligations:require("./helpers/understanding-source-obligations-fixture").fixtureSourceObligations(input.sourceEvents,[{
      obligationId:"model-misclassified",unitId:"unit-a",purpose:"acknowledgement",capability:null,sourceEvidenceRefs:[ref],
      requiredFields:[],relationKind:"NONE",referencedHistoryEventRefs:[],referencedCurrentUnitId:null
    }]) });
  const r = await understand(input, output);
  assert.equal(r.calls,1);assert.equal(r.diagnostic.finalAcceptedAttempt,1,
    "Owner-accepted residual risk: correspondence alone cannot independently detect a model misclassifying both need and obligation");
});

test("G1 / omitted condition: selected evidence cannot discard duration outside its quote", async () => {
  const messageText = "2026-10-10住兩晚";
  const input = f.c01({ sourceEvents: [{ ...f.c01().sourceEvents[0], messageText }] });
  const ref = f.evidence({ endOffset: 10, quote: "2026-10-10" });
  const unit = f.unit({ purpose: "lodging_question", capability: "availability", stayDependent: true,
    subject: { kind: "room", catalogIdentity: "room-a" }, evidenceRefs: [ref],
    temporalCandidate: { kind: "absolute_date", rawText: ref.quote,
      checkInCandidate: ref.quote, checkOutCandidate: null, nightsCandidate: null } });
  const output = f.providerOutput({ understandingOutput: { schemaVersion: 1, turnId: input.turnId, units: [unit] },
    contextLinkCandidates: [f.link({ relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: [ref] })] });
  const r = await understand(input, output);
  assert.equal(r.diagnostic.finalAcceptedAttempt, null,
    "The unaccounted duration must not be replaced by a default merely because the selected date quote is valid");
});

for (const purpose of ["correction", "cancellation", "context_update"]) {
  test(`G2 / explicit target: NONE plus ${purpose} cannot select the sole pending cycle`, () => {
    const r = lifecycle.validatedPipeline({ action: "NONE", target: null, unitOverrides: { purpose } });
    assert.ok(!r.linkResult.ok || !r.lifecycleResult?.ok || r.lifecycleResult.value.action === "NONE",
      "C06 selected an existing cycle without a validated explicit reference");
  });
}

// C05 must admit the existing C06 nonactionable path without authorizing a mutation.
for (const purpose of ["supplement", "context_update"]) {
  test(`G2 / nonactionable ${purpose} + NONE retains validated no-op with no cycles`, () => {
    const messageText = "Note: seven guests";
    const input = lifecycle.turnInput({ messageText, cycles: [], recentConversation: [] });
    const r = lifecycle.validatedPipeline({ messageText, input, action: "NONE", target: null,
      unitOverrides: { purpose }, slots: [lifecycle.slot({ messageText, id: "unbound-guests", slot: "guest_count", value: 7 })] });
    assert.equal(r.linkResult.ok, true, JSON.stringify(r.linkResult));
    assert.equal(r.lifecycleResult.ok, true);
    assert.equal(r.lifecycleResult.value.action, "NONE");
    assert.equal(r.lifecycleResult.value.targetRequestCycleId, null);
    assert.deepEqual(r.lifecycleResult.value.verifiedSlotOperations, []);
  });
  test(`G2 / nonactionable exception cannot choose an existing cycle for ${purpose}`, () => {
    const r = lifecycle.validatedPipeline({ action: "NONE", target: null, unitOverrides: { purpose } });
    assert.equal(r.linkResult.ok, false);
  });
}
for (const purpose of ["correction", "cancellation"]) {
  test(`G2 / nonactionable exception cannot authorize targetless ${purpose}`, () => {
    const r = lifecycle.validatedPipeline({ input: lifecycle.turnInput({ cycles: [], recentConversation: [] }),
      action: "NONE", target: null, unitOverrides: { purpose } });
    assert.equal(r.linkResult.ok, false);
  });
}
test("G2 / nonactionable exception cannot turn a targetless SUPPLEMENT into a no-op", () => {
  const r = lifecycle.validatedPipeline({ input: lifecycle.turnInput({ cycles: [], recentConversation: [] }),
    action: "CONTINUE", target: null, unitOverrides: { purpose: "supplement" } });
  assert.equal(r.linkResult.ok, false);
  assert.equal(r.linkResult.code, "UNDERSTANDING_SCHEMA_INVALID");
  assert.ok(r.linkResult.errors.includes("referencedHistoryEventRefs.required"));
});

for (const name of ["A-additive-correction", "H-addition-to-valid-sibling"]) {
  test(`G3 / repair scope: ${name} cannot introduce unrelated product semantics`, async () => {
    const c = preservation.cases.find(item => item.name === name);
    assert.ok(c, "existing recorded fixture must remain available");
    const r = await preservation.run(c.first, c.second);
    assert.equal(r.calls, 2);
    assert.notEqual(r.meta.finalAcceptedAttempt, 2,
      "Repairing relation/stay-dependency does not authorize a new product slot on an unaffected meaning");
  });
}

test("G3 / dependent-unit identity: correction cannot rewire a valid RELATED_UNIT parent", async () => {
  let attempt = 0;
  const r = await turn([
    { id: "first-stay", capability: "availability", kind: "room", identity: "room-a", temporal: dateRange() },
    { id: "second-stay", capability: "availability", kind: "room", identity: "room-a", temporal: dateRange("2026-10-15", "2026-10-17") },
    { id: "price", capability: "price", kind: "room", identity: "room-a", relation: "RELATED_UNIT", sourceUnitId:"first-stay", text: "Price for the first stay" },
    { id: "ack", capability: null, kind: null, identity: null, purpose: "acknowledgement", relation: "NONE", text: "Thanks" }
  ], { transformOutput(output) {
    attempt++;
    output.contextLinkCandidates[2].referencedCurrentUnitId = attempt === 1 ? "first-stay" : "second-stay";
    output.understandingOutput.units[3].stayDependent = attempt === 1;
    return output;
  } });
  const diagnostic = r.result.artifacts.understanding?.[D];
  assert.equal(r.calls, 2);
  assert.ok(diagnostic, "actual provider admission diagnostic required");
  assert.notEqual(diagnostic.finalAcceptedAttempt, 2,
    "A different valid parent is still an unauthorized change to an already validated dependency");
});

test("G3 / unit-set preservation: repair cannot append an unrelated semantic unit", async () => {
  const first = f.providerOutput(); first.understandingOutput.units[0].stayDependent = true;
  const second = f.providerOutput();
  second.understandingOutput.units.push(f.unit({ unitId: "extra-unit", contextLinkCandidateId: "extra-link" }));
  second.contextLinkCandidates.push(f.link({ unitId: "extra-unit", contextLinkCandidateId: "extra-link" }));
  const r = await understand(f.c01(), first, second);
  assert.equal(r.calls, 2);
  assert.notEqual(r.diagnostic.finalAcceptedAttempt, 2,
    "Fixing a stay-dependency flag does not authorize another semantic unit");
});

test("G2 / SET KEEP CLEAR: clearing guest count preserves dates and really removes the old value", async () => {
  const first = await turn([{ capability: "availability", kind: "room", identity: "room-a",
    temporal: dateRange("2026-10-10", "2026-10-12"), slots: [["guest_count", 2]] }]);
  assert.equal(first.result.earliestFailure, null);
  const next = await turn([{ capability: "availability", kind: "room", identity: "room-a",
    relation: "MODIFICATION", refs: refs(first), text: "Do not keep the guest count", slots: [["guest_count", null, "CLEAR"]] }],
  { previous: first.state, history: first.history });
  assert.equal(next.result.earliestFailure, null);
  assert.equal(next.state.tasks[0].guestCount, null);
  assert.equal(next.state.tasks[0].checkIn, "2026-10-10");
  assert.equal(next.state.tasks[0].checkOut, "2026-10-12");
  assert.equal(next.result.artifacts.formalRequests[0].resolverTask.guestCount, null,
    "Canonical execution cannot resurrect a cleared value from Context");
});

const unknown = { type: "availability", status: "unknown", responseMode: "answer",
  claimType: "EPISTEMIC_UNKNOWN", outcomeStatus: "unknown", facts: {},
  unknownProvenance: { sourceReasonCode: "missing_inventory_records",
    resolverProvenance: { readEvidence: { from: "2026-10-10", to: "2026-10-12" } } } };
const noAvailability = { type: "availability", status: "answered", responseMode: "answer",
  claimType: "FACTUAL_ANSWER", outcomeStatus: "no_availability", facts: {
    checkIn: "2026-10-10", checkOut: "2026-10-12", availableInventory: [], source: "availability_resolver" } };

test("G4 / Unknown is not No: partial inventory missing preserves epistemic uncertainty", () => {
  assert.equal(composeSection(unknown), "2026-10-10 入住的房況資料尚未完整，目前無法確認是否可預訂。");
});
test("G4 / independent validation rejects known-unavailable text for an Unknown section", () => {
  assert.equal(validateComposedSection(unknown, composeSection(noAvailability)).ok, false);
});
test("G4 / known No remains a distinct valid outcome", () => {
  const text = composeSection(noAvailability);
  assert.equal(text, "2026-10-10 入住目前沒有可提供的房型，歡迎查看其他日期，謝謝您。");
  assert.equal(validateComposedSection(noAvailability, text).ok, true);
});

test("G5 / successful correction still leaves private failure and adoption evidence", async () => {
  const invalid = f.providerOutput(); invalid.understandingOutput.turnId = "invalid-turn";
  const r = await understand(f.c01(), invalid, f.providerOutput());
  assert.equal(r.diagnostic.finalAcceptedAttempt, 2);
  const saved = productionUnderstandingFailureEvidence({ understandingAttempts: r.diagnostic.attemptEvidence });
  assert.ok(saved.understandingFailureDiagnostic,
    "Attempt 1 schema failure was lost because attempt 2 succeeded");
  const [first, second] = saved.understandingFailureDiagnostic.attempts;
  assert.equal(first.schemaError.fieldPath, "understandingOutput.turnId");
  assert.equal(first.schemaError.actual, "invalid-turn");
  assert.equal(second.accepted, true);
  assert.equal(second.adoption.rejectionStage, null);
  assert.ok(second.correctionInput.failures.length > 0);
  assert.equal(Object.hasOwn(second, "structuredOutput"), false,
    "Successful raw output is not required for the private correction receipt");
});
test("G5 / ordinary successful output does not acquire a persisted raw diagnostic", async () => {
  const r = await understand(f.c01(), f.providerOutput());
  assert.equal(r.calls, 1);
  assert.deepEqual(productionUnderstandingFailureEvidence({ understandingAttempts: r.diagnostic.attemptEvidence }), {});
});

// G5 attribution is evidence of the first failed boundary, not a substitute
// for G3 acceptance. No production provider/network is used by these cases.
test("G5 / schema rejection cannot masquerade as changed preserved fields or siblings", async () => {
  const first = f.providerOutput(), second = f.providerOutput();
  first.understandingOutput.turnId = "invalid-first-turn";
  second.understandingOutput.turnId = "invalid-correction-turn";
  assert.deepEqual(first.understandingOutput.units, second.understandingOutput.units);
  assert.deepEqual(first.contextLinkCandidates, second.contextLinkCandidates);
  const r = await understand(f.c01(), first, second);
  assert.equal(r.calls, 2);
  assert.equal(r.diagnostic.finalAcceptedAttempt, null);
  const attempt = r.diagnostic.attemptEvidence[1];
  assert.equal(attempt.schemaError.fieldPath, "understandingOutput.turnId");
  assert.equal(attempt.admissionFailureCode, "UNDERSTANDING_SCHEMA_INVALID");
  assert.equal(attempt.adoption.rejectionStage, "admission");
  assert.equal(attempt.adoption.reportedFailure, "UNDERSTANDING_SCHEMA_INVALID");
});
for (const failure of ["CORRECTION_FIELD_NOT_PRESERVED", "CORRECTION_SIBLING_NOT_PRESERVED"]) {
  test(`G5 / actual preservation rejection remains visible: ${failure}`, () => {
    const { captureUnderstandingAttempts } = require("../lib/providers/understanding-attempt-diagnostic");
    const saved = captureUnderstandingAttempts([{ adoption: { candidateAdmitted: true, rejectionStage: "preservation" } }],
      [{ attemptNumber: 2, attemptType: "correction", validationResult: { ok: false, adoptionFailure: failure } }], null);
    assert.equal(saved[0].adoption.reportedFailure, failure);
    assert.equal(saved[0].adoption.rejectionStage, "preservation");
    assert.equal(saved[0].accepted, false);
  });
}

// G3: a capability mismatch may repair the dependency graph, not erase the
// source-grounded modification and its already identified history target.
async function capabilityRepair(mode) {
  const prior = await turn([{ capability:"availability", kind:"room", identity:"room-a",
    temporal:dateRange("2026-10-14","2026-10-18"), slots:[["guest_count",1]] }]);
  assert.equal(prior.result.earliestFailure,null);
  let attempt=0;
  return turn([{ id:"price", capability:"price", kind:"room", identity:"room-b",
    text:"Change the lodging product and quote its price", relation:"MODIFICATION", refs:refs(prior),
    slots:[["product","room-b"]] }],{ previous:prior.state,history:prior.history, transformOutput(output,input) {
    if (++attempt===1) return output;
    const link=output.contextLinkCandidates[0], requirement=output.sourceObligations.requirements[0];
    if (mode==="erase") {
      link.relationKind="NEW_REQUEST";link.referencedHistoryEventRefs=[];
      link.independentRequestEvidence={currentSourceEvidenceRefs:clone(link.currentSourceEvidenceRefs),
        assessedHistoryEventRefs:input.recentConversation.map(({eventId,messageRef})=>({eventId,messageRef}))};
      requirement.relationKind="NEW_REQUEST";requirement.referencedHistoryEventRefs=[];
      return output;
    }
    const source=clone(output.understandingOutput.units[0]);
    source.unitId="modified-stay";source.contextLinkCandidateId="modified-stay-link";source.capability="availability";
    source.slotCandidates.forEach(slot=>{slot.slotCandidateId=`source-${slot.slotCandidateId}`;});
    const sourceLink={...clone(link),unitId:source.unitId,contextLinkCandidateId:source.contextLinkCandidateId};
    const sourceRequirement={...clone(requirement),obligationId:"modified-stay-obligation",
      unitId:source.unitId,capability:source.capability};
    output.understandingOutput.units.unshift(source);output.contextLinkCandidates.unshift(sourceLink);
    output.sourceObligations.requirements.unshift(sourceRequirement);
    output.sourceObligations.coverage[0].obligationIds.unshift(sourceRequirement.obligationId);
    link.relationKind="RELATED_UNIT";link.referencedHistoryEventRefs=[];link.referencedCurrentUnitId=source.unitId;
    requirement.relationKind="RELATED_UNIT";requirement.referencedHistoryEventRefs=[];requirement.referencedCurrentUnitId=source.unitId;
    if(mode==="add-value") {
      source.slotCandidates.push({slotCandidateId:"added-guests",slot:"guest_count",operation:"SET",value:4,evidenceRefs:clone(source.evidenceRefs)});
      sourceRequirement.requiredFields.push("slot:guest_count");
    }
    return output;
  }});
}

test("G3 / incompatible capability correction cannot erase an evidenced modification",async()=>{
  const r=await capabilityRepair("erase"),d=r.result.artifacts.understanding?.[D]||r.result.artifacts.understandingDiagnostic;
  assert.equal(r.calls,2);
  assert.notEqual(d?.finalAcceptedAttempt,2,"A failed capability binding does not authorize NEW_REQUEST or dropping its target");
  assert.equal(r.result.understandingAttempts[1].adoption.rejectionStage,"preservation");
  assert.equal(r.result.understandingAttempts[1].adoption.checks.unitIdsRetained,false);
});
test("G3 / incompatible capability correction may introduce only its required source unit",async()=>{
  const r=await capabilityRepair("dependency");
  assert.equal(r.calls,2);assert.equal(r.result.earliestFailure,null,JSON.stringify(r.result.earliestFailure));
  assert.equal(r.result.artifacts.understanding[D].finalAcceptedAttempt,2);
  const requests=r.result.artifacts.formalRequests;
  assert.equal(requests.length,2);
  for(const request of requests) {
    assert.equal(request.resolverTask.checkIn,"2026-10-14");
    assert.equal(request.resolverTask.checkOut,"2026-10-18");
    assert.equal(request.resolverTask.productId,"room-b");
    assert.equal(request.resolverTask.guestCount,1);
  }
});
test("G3 / prerequisite repair cannot add unrelated values to the new source",async()=>{
  const r=await capabilityRepair("add-value");
  assert.equal(r.calls,2);
  assert.notEqual(r.result.artifacts.understanding?.[D]?.finalAcceptedAttempt,2);
});
