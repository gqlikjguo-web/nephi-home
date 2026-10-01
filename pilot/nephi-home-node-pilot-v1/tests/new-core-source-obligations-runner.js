"use strict";
// STRUCTURED_CONTRACT_TEST: fixed model declarations, not language inference.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { sourceObligationFailure, obligationsPreserved } = require("../lib/new-core/source-obligations");
const clone = structuredClone;
function fixture() {
  const text = "10/14住四晚，還要問房價";
  const ref = { eventId: "current", messageRef: "current-message", startOffset: 0, endOffset: text.length, quote: text };
  const input = { sourceEvents: [{ eventId: ref.eventId, messageRef: ref.messageRef, messageText: text }] };
  const make = (id, capability) => ({ unitId: id, purpose: "lodging_question", capability, subject: { kind: "room", catalogIdentity: "public-room" },
    temporalCandidate: capability === "availability" ? { kind: "month_day", rawText: "10/14住四晚", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 4 } : null,
    evidenceRefs: [clone(ref)], slotCandidates: [], contextLinkCandidateId: `${id}-link` });
  const units = [make("stay", "availability"), make("price", "price")];
  const links = units.map(unit => ({ unitId: unit.unitId, contextLinkCandidateId: unit.contextLinkCandidateId,
    relationKind: unit.unitId === "stay" ? "NEW_REQUEST" : "RELATED_UNIT", currentSourceEvidenceRefs: [clone(ref)],
    referencedHistoryEventRefs: [], referencedCurrentUnitId: unit.unitId === "stay" ? null : "stay" }));
  // Independent declarations: mutations below never rebuild the obligations.
  const requirements = [
    { obligationId: "stay-obligation", unitId: "stay", purpose: "lodging_question", capability: "availability", sourceEvidenceRefs: [clone(ref)],
      requiredFields: ["subject", "temporalCandidate", "temporalCandidate.nightsCandidate"], relationKind: "NEW_REQUEST", referencedHistoryEventRefs: [], referencedCurrentUnitId: null },
    { obligationId: "price-obligation", unitId: "price", purpose: "lodging_question", capability: "price", sourceEvidenceRefs: [clone(ref)],
      requiredFields: ["subject"], relationKind: "RELATED_UNIT", referencedHistoryEventRefs: [], referencedCurrentUnitId: "stay" }
  ];
  return { input, output: { understandingOutput: { units }, contextLinkCandidates: links, sourceObligations: {
    coverage: [{ source: clone(ref), disposition: "required", obligationIds: ["stay-obligation", "price-obligation"] }], requirements } } };
}
test("source obligations correspond without making execution decisions", () => {
  const { input, output } = fixture();
  assert.equal(sourceObligationFailure(output, input), null);
});
for (const [name, mutate, reason] of [
  ["omitted unit", x => x.understandingOutput.units.pop(), "unit_missing"],
  ["omitted condition", x => { x.understandingOutput.units[0].temporalCandidate.nightsCandidate = null; }, "field_missing"],
  ["omitted relation", x => { x.contextLinkCandidates[1].relationKind = "NEW_REQUEST"; x.contextLinkCandidates[1].referencedCurrentUnitId = null; }, "relation_mismatch"],
  ["wrong capability", x => { x.understandingOutput.units[1].capability = "availability"; }, "unit_meaning_mismatch"],
  ["unaccounted field", x => { x.understandingOutput.units[1].slotCandidates = [{ slot: "guest_count", operation: "SET", value: 3 }]; }, "field_unaccounted"],
  ["source gap", x => { x.sourceObligations.coverage = []; }, "source_gap"],
  ["foreign source", x => { x.sourceObligations.coverage[0].source.eventId = "foreign"; }, "EVIDENCE_SOURCE_UNKNOWN"],
  ["source quote mismatch", x => { x.sourceObligations.coverage[0].source.quote = "fabricated"; }, "EVIDENCE_QUOTE_MISMATCH"],
  ["duplicate obligation", x => { x.sourceObligations.requirements.push(clone(x.sourceObligations.requirements[0])); }, "duplicate_obligation"],
  ["unknown coverage reference", x => { x.sourceObligations.coverage[0].obligationIds.push("invented"); }, "unknown_obligation"]
]) test(name, () => {
  const { input, output } = fixture(); mutate(output);
  const result = sourceObligationFailure(output, input);
  assert.ok(result); assert.equal(result.violation.actual, `admission_obligation:${reason}`);
});
test("correcting output cannot erase an original source-valid obligation", () => {
  const { input, output } = fixture(), next = clone(output);
  next.sourceObligations.requirements.pop();
  assert.equal(obligationsPreserved(output, next, input), false);
});
test("another current event needs its own coverage", () => {
  const { input, output } = fixture(); input.sourceEvents.push({ eventId: "other", messageRef: "other-message", messageText: "More" });
  assert.equal(sourceObligationFailure(output, input).violation.actual, "admission_obligation:source_gap");
});
test("residual risk: simultaneous model omission is not an independent semantic completeness proof", () => {
  const { input, output } = fixture();
  output.understandingOutput.units = [];
  output.contextLinkCandidates = [];
  output.sourceObligations.requirements = [];
  output.sourceObligations.coverage[0].disposition = "background";
  output.sourceObligations.coverage[0].obligationIds = [];
  assert.equal(sourceObligationFailure(output, input), null,
    "Accepted Owner limitation: JunZan does not reinterpret source or add another semantic authority");
});

const fs = require("node:fs"), Module = require("node:module"), path = require("node:path");
const filename = path.join(__dirname, "new-core-openai-adapter-contract-runner.js");
const fixtureModule = new Module(filename, module);
fixtureModule.filename = filename; fixtureModule.paths = Module._nodeModulePaths(__dirname);
fixtureModule._compile(fs.readFileSync(filename, "utf8").split("async function main()")[0]
  + "\nmodule.exports={c01,unit,link,evidence,options,successfulResponse};", filename);
const f = fixtureModule.exports;
const { callOpenAIUnderstandingV1, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC: D } = require("../lib/providers/openai-understanding-v1");
const { fixtureSourceObligations } = require("./helpers/understanding-source-obligations-fixture");
function admittedFixture() {
  const input = f.c01(), unit = f.unit(), link = f.link();
  const requirements = [{ obligationId: "ack-obligation", unitId: "unit-a", purpose: "acknowledgement", capability: null,
    sourceEvidenceRefs: [f.evidence()], requiredFields: [], relationKind: "NONE", referencedHistoryEventRefs: [], referencedCurrentUnitId: null }];
  return { input, output: { understandingOutput: { schemaVersion: 1, turnId: input.turnId, units: [unit] },
    contextLinkCandidates: [link], sourceObligations: fixtureSourceObligations(input.sourceEvents, requirements) } };
}
async function callFixture(input, first, second = first) {
  let calls = 0, value, error;
  try { value = await callOpenAIUnderstandingV1(input, f.options(async () => {
    assert.ok(++calls <= 2); return f.successfulResponse(calls === 1 ? first : second);
  })); } catch (caught) { error = caught; }
  return { calls, value, error, diagnostic: (value || error)?.[D] };
}
test("FAKE_INTEGRATION: complete first attempt stays one call", async () => {
  const { input, output } = admittedFixture(), r = await callFixture(input, output);
  assert.equal(r.calls, 1); assert.equal(r.diagnostic.finalAcceptedAttempt, 1);
});
test("FAKE_INTEGRATION: omitted declared unit triggers one correction, never local synthesis", async () => {
  const { input, output } = admittedFixture(), first = clone(output);
  first.understandingOutput.units = []; first.contextLinkCandidates = [];
  const r = await callFixture(input, first, output);
  assert.equal(r.calls, 2); assert.equal(r.diagnostic.finalAcceptedAttempt, 2);
  assert.equal(r.diagnostic.attempts[0].validationResult.failures[0].reason.actual, "admission_obligation:unit_missing");
  assert.deepEqual(r.value.understandingOutput.units, output.understandingOutput.units);
});
test("FAKE_INTEGRATION: correction cannot drop the declared unit obligation", async () => {
  const { input, output } = admittedFixture(), first = clone(output), second = clone(output);
  first.understandingOutput.units = []; first.contextLinkCandidates = [];
  second.understandingOutput.units = []; second.contextLinkCandidates = [];
  second.sourceObligations.requirements = [];
  second.sourceObligations.coverage[0].obligationIds = []; second.sourceObligations.coverage[0].disposition = "background";
  const r = await callFixture(input, first, second);
  assert.equal(r.calls, 2); assert.notEqual(r.diagnostic.finalAcceptedAttempt, 2);
});
test("FAKE_INTEGRATION: still-incomplete correction has no third call", async () => {
  const { input, output } = admittedFixture(); output.sourceObligations.coverage = [];
  const r = await callFixture(input, output);
  assert.equal(r.calls, 2); assert.equal(r.diagnostic.finalAcceptedAttempt, null);
});

test("FAKE_INTEGRATION: a declared duration omission repairs only Temporal, preserving other meaning", async () => {
  const text = "2026-10-10住兩晚", input = f.c01({ sourceEvents: [{ ...f.c01().sourceEvents[0], messageText: text }] });
  const ref = f.evidence({ endOffset: text.length, quote: text });
  const unit = f.unit({ purpose: "lodging_question", capability: "availability", stayDependent: true,
    subject: { kind: "room", catalogIdentity: "room-a" }, evidenceRefs: [ref],
    temporalCandidate: { kind: "absolute_date", rawText: "2026-10-10", checkInCandidate: "2026-10-10", checkOutCandidate: null, nightsCandidate: 2 } });
  const output = { understandingOutput: { schemaVersion: 1, turnId: input.turnId, units: [unit] },
    contextLinkCandidates: [f.link({ relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: [ref] })],
    sourceObligations: fixtureSourceObligations(input.sourceEvents, [{ obligationId: "stay", unitId: "unit-a",
      purpose: "lodging_question", capability: "availability", sourceEvidenceRefs: [ref],
      requiredFields: ["subject", "temporalCandidate", "temporalCandidate.checkInCandidate", "temporalCandidate.nightsCandidate"],
      relationKind: "NEW_REQUEST", referencedHistoryEventRefs: [], referencedCurrentUnitId: null }]) };
  const first = clone(output); first.understandingOutput.units[0].temporalCandidate.nightsCandidate = null;
  const r = await callFixture(input, first, output);
  assert.equal(r.calls, 2); assert.equal(r.diagnostic.finalAcceptedAttempt, 2);
  assert.equal(r.diagnostic.attempts[0].validationResult.failures[0].reason.actual, "admission_obligation:field_missing");
  assert.equal(r.value.validatedUnits[0].temporalCandidate.nightsCandidate, 2);
  assert.deepEqual(r.value.validatedUnits[0].subject, unit.subject);
});

function undecidedDateFixture() {
  const text = "兩個人想住雙人房，住兩晚，日期還沒決定。";
  const input = f.c01({ sourceEvents: [{ ...f.c01().sourceEvents[0], messageText: text }],
    recentConversation: [], stateV3Snapshot: { scope: { propertyId: "property-a", channel: "line-a", userId: "guest-a" }, referenceableCycles: [] } });
  const ref = f.evidence({ endOffset: text.length, quote: text });
  const unit = f.unit({ purpose: "lodging_question", capability: "availability", stayDependent: true,
    subject: { kind: "room", catalogIdentity: "room-a" }, evidenceRefs: [ref],
    temporalCandidate: { kind: "nights_only", rawText: "住兩晚", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 2 } });
  const output = { understandingOutput: { schemaVersion: 1, turnId: input.turnId, units: [unit] },
    contextLinkCandidates: [f.link({ relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: [ref] })],
    sourceObligations: fixtureSourceObligations(input.sourceEvents, [{ obligationId: "stay", unitId: "unit-a",
      purpose: "lodging_question", capability: "availability", sourceEvidenceRefs: [ref],
      requiredFields: ["subject", "temporalCandidate", "temporalCandidate.nightsCandidate"],
      relationKind: "NEW_REQUEST", referencedHistoryEventRefs: [], referencedCurrentUnitId: null }]) };
  const first = clone(output);
  first.sourceObligations.requirements[0].requiredFields.push("temporalCandidate.checkInCandidate");
  return { input, first, output };
}
test("FAKE_INTEGRATION: rejected obligation is corrected by the model without inventing an undecided date", async () => {
  const { input, first, output } = undecidedDateFixture();
  assert.equal(sourceObligationFailure(first, input).violation.actual, "admission_obligation:field_missing");
  const r = await callFixture(input, first, output);
  assert.equal(r.calls, 2);
  assert.equal(r.diagnostic.finalAcceptedAttempt, 2);
  assert.deepEqual(r.value.understandingOutput.units, first.understandingOutput.units);
  assert.equal(r.value.validatedUnits[0].temporalCandidate.nightsCandidate, 2);
  assert.equal(r.value.validatedUnits[0].temporalCandidate.checkInCandidate, null);
});
test("FAKE_INTEGRATION: incomplete execution inputs with complete source correspondence need no correction", async () => {
  const { input, output } = undecidedDateFixture(), r = await callFixture(input, output);
  assert.equal(r.calls, 1); assert.equal(r.diagnostic.finalAcceptedAttempt, 1);
});
test("rejected requiredFields repair cannot change a validated field, relation, source or obligation identity", () => {
  const { input, first, output } = undecidedDateFixture();
  for (const mutate of [r => { r.requiredFields = ["subject"]; }, r => { r.relationKind = "NONE"; },
    r => { r.obligationId = "new"; }, r => { r.sourceEvidenceRefs[0].eventId = "foreign"; }]) {
    const next = clone(output); mutate(next.sourceObligations.requirements[0]);
    assert.equal(obligationsPreserved(first, next, input), false);
  }
});

test("FAKE_INTEGRATION: field-unaccounted failure names the actual counterpart, not an invented missing date", async () => {
  const text = "10月14號入住。", input = f.c01({sourceEvents:[{...f.c01().sourceEvents[0],messageText:text}],
    recentConversation:[],stateV3Snapshot:{scope:{propertyId:"property-a",channel:"line-a",userId:"guest-a"},referenceableCycles:[]}});
  const ref = f.evidence({endOffset:text.length,quote:text});
  const u = f.unit({purpose:"lodging_question",capability:"availability",stayDependent:true,
    subject:{kind:"property",catalogIdentity:null},evidenceRefs:[ref],
    temporalCandidate:{kind:"month_day",rawText:"10月14號",checkInCandidate:null,checkOutCandidate:null,nightsCandidate:null}});
  const first={understandingOutput:{schemaVersion:1,turnId:input.turnId,units:[u]},
    contextLinkCandidates:[f.link({relationKind:"NEW_REQUEST",currentSourceEvidenceRefs:[ref]})],
    sourceObligations:fixtureSourceObligations(input.sourceEvents,[{obligationId:"date",unitId:"unit-a",purpose:u.purpose,capability:u.capability,
      sourceEvidenceRefs:[ref],requiredFields:["temporalCandidate"],relationKind:"NEW_REQUEST",referencedHistoryEventRefs:[],referencedCurrentUnitId:null}])};
  const failure=sourceObligationFailure(first,input);
  assert.equal(failure.violation.actual,"admission_obligation:field_unaccounted");
  assert.ok(failure.violation.expected.includes("subject"),"correction evidence must name the emitted field omitted by the ledger");
  const second=clone(first);second.sourceObligations.requirements[0].requiredFields.unshift("subject");
  const r=await callFixture(input,first,second);
  assert.equal(r.calls,2);assert.equal(r.diagnostic.finalAcceptedAttempt,2);
  assert.deepEqual(r.value.understandingOutput.units,first.understandingOutput.units);
});

test("FAKE_INTEGRATION: source-correspondence correction identifies the unit span, preserving source-grounded meaning",async()=>{
 const {input,first:unused,output}=undecidedDateFixture(),first=clone(output);
 const ref=first.understandingOutput.units[0].evidenceRefs[0];
 first.understandingOutput.units[0].evidenceRefs=[{...ref,startOffset:0,endOffset:3,quote:ref.quote.slice(0,3)},
   {...ref,startOffset:9,endOffset:12,quote:ref.quote.slice(9,12)}];
 const failure=sourceObligationFailure(first,input);
 assert.equal(failure.violation.actual,"admission_obligation:unit_source_mismatch");
 assert.ok(failure.violation.expected.includes("unit.evidenceRefs"));
 const r=await callFixture(input,first,output);
 assert.equal(r.calls,2);assert.equal(r.diagnostic.finalAcceptedAttempt,2);
 assert.deepEqual(r.value.understandingOutput.units[0].temporalCandidate,first.understandingOutput.units[0].temporalCandidate);
 assert.deepEqual(r.diagnostic.attemptEvidence[1].structuredOutput.sourceObligations,output.sourceObligations);
});

function duplicateLedgerFixture() {
  const {input,output}=undecidedDateFixture(),first=clone(output);
  const req=first.sourceObligations.requirements[0];
  req.requiredFields=req.requiredFields.filter(field=>field!=="subject");
  req.requiredFields.push("temporalCandidate.checkInCandidate");
  const duplicate={...clone(req),obligationId:"duplicate-declaration",requiredFields:[]};
  first.sourceObligations.requirements.push(duplicate);
  first.sourceObligations.coverage[0].obligationIds.push(duplicate.obligationId);
  return {input,first,output};
}
test("G1: one correction receives duplicate and field-correspondence failures together",()=>{
  const {input,first}=duplicateLedgerFixture();
  const failure=sourceObligationFailure(first,input);
  assert.equal(failure.violation.actual,"admission_obligation:duplicate_obligation");
  const evidence=JSON.stringify(failure);
  assert.ok(evidence.includes("admission_obligation:field_missing"));
  assert.ok(evidence.includes("admission_obligation:field_unaccounted"));
  assert.ok(evidence.includes("subject"));
});
test("FAKE_INTEGRATION: duplicate ledger repair preserves its unit and all actual conditions",async()=>{
  const {input,first,output}=duplicateLedgerFixture();
  assert.equal(obligationsPreserved(first,output,input),true);
  const r=await callFixture(input,first,output);
  assert.equal(r.calls,2);assert.equal(r.diagnostic.finalAcceptedAttempt,2);
  assert.deepEqual(r.value.understandingOutput.units,first.understandingOutput.units);
});
test("G1: duplicate receipt cannot erase a distinct source-owned relation or valid condition",()=>{
  const {input,first,output}=duplicateLedgerFixture();
  const dropped=clone(output);dropped.sourceObligations.requirements[0].requiredFields=['subject'];
  assert.equal(obligationsPreserved(first,dropped,input),false);
  first.sourceObligations.requirements[1].relationKind="NONE";
  assert.equal(obligationsPreserved(first,output,input),false);
});
