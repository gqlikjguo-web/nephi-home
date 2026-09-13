"use strict";
// FAKE_INTEGRATION: formal C01/provider admission; queued model responses only.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const { callOpenAIUnderstandingV1, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC: DIAGNOSTIC } = require("../lib/providers/openai-understanding-v1");

function scenario(propertyId, dateText, labels) {
  const message = `${dateText} ${labels.join(" ")}`;
  const ref = quote => {
    const startOffset = message.indexOf(quote);
    return { eventId: "event", messageRef: "message", startOffset, endOffset: startOffset + quote.length, quote };
  };
  const input = buildUnderstandingTurnInput({ coreVersion: "new-core-v1", traceId: "trace", turnId: "turn",
    verifiedPropertyBinding: { propertyId, channel: "channel" }, verifiedConversationScope: { propertyId, channel: "channel", userId: "actor" },
    sourceEvents: [{ eventId: "event", messageRef: "message", role: "guest", timestamp: "2026-09-12T08:00:00.000Z", messageKind: "text", messageText: message }], recentConversation: [],
    stateV3Snapshot: { scope: { propertyId, channel: "channel", userId: "actor" }, referenceableCycles: [] },
    publicCatalog: { propertyId, timezone: "Asia/Taipei", capabilityCatalog: ["availability", "price", "policy"], publicSubjectCatalog: [
      { propertyId, catalogIdentity: "room-a", kind: "room", publicName: "Lodging" },
      { propertyId, catalogIdentity: "policy-a", kind: "policy", publicName: "Policy" }
    ] } });
  const units = ["availability", "price", "policy"].map((capability, index) => ({
    unitId: `task-${index}`, evidenceRefs: [ref(index === 0 ? `${dateText} ${labels[0]}` : labels[index])],
    purpose: "lodging_question", capability, subject: { kind: index === 2 ? "policy" : "room", catalogIdentity: index === 2 ? "policy-a" : "room-a" }, stayDependent: index !== 2,
    temporalCandidate: { rawText: dateText, kind: "absolute_date", checkInCandidate: dateText, checkOutCandidate: null, nightsCandidate: null },
    contextLinkCandidateId: `link-${index}`, safetyCandidate: null, slotCandidates: [], confidenceBand: "high"
  }));
  const first = { understandingOutput: { schemaVersion: 1, turnId: "turn", units }, contextLinkCandidates: units.map(unit => ({ contextLinkCandidateId: unit.contextLinkCandidateId, unitId: unit.unitId, relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: unit.evidenceRefs, referencedHistoryEventRefs: [] })) };
  const repair = structuredClone(first);
  repair.understandingOutput.units.slice(1).forEach(unit => unit.evidenceRefs.push(ref(dateText)));
  return { input, first, repair };
}
async function run(data, second = data.repair) {
  let calls = 0, result, error; const requests = [];
  try { result = await callOpenAIUnderstandingV1(data.input, { apiKey: "isolated-model-double", nowMs: () => Date.parse("2026-09-12T08:00:00.000Z"), fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    assert.ok(++calls <= 2);
    const envelope = calls === 1 ? data.first : second;
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(envelope) }] }] }) };
  } }); } catch (caught) { error = caught; }
  return { calls, result, error, requests, diagnostic: (result || error)?.[DIAGNOSTIC] };
}

for (const [property, date, labels] of [["property-one", "2026-12-25", ["有空房嗎", "費用怎麼算", "入住規則呢"]], ["property-two", "2027-02-13", ["lodging", "rates", "conditions"]]]) {
  test(`${property}: wire evidence report attributes each local failure without revoking typed obligations`, async () => {
    const x = await run(scenario(property, date, labels));
    assert.equal(x.calls, 2);
    const failures = x.diagnostic.attempts[0].validationResult.failures;
    for (const index of [2, 1]) {
      const failure = failures.find(f => f.unitId === `task-${index}`);
      assert.equal(failure.field, `understandingOutput.units.${index}.temporalCandidate.rawText`);
      assert.equal(failure.unitValidationFailed, true);
      assert.equal(failure.fieldValidationState.find(f => f.field === "temporalCandidate").preservation, "PRESERVE");
    }
    const sibling = failures.find(f => f.unitId === "task-0");
    assert.equal(sibling.unitValidationFailed, false);
    assert.equal(sibling.field, null);
    assert.equal(sibling.fieldValidationState.find(f => f.field === "temporalCandidate").preservation, "PRESERVE");
    assert.equal(x.diagnostic.finalAcceptedAttempt, 2);
  });
  test(`${property}: exact additive evidence passes all unchanged validators`, async () => {
    const data = scenario(property, date, labels), x = await run(data);
    assert.equal(x.diagnostic.finalAcceptedAttempt, 2);
    assert.equal(x.result.validatedUnits.length, 3);
    assert.deepEqual(x.result.understandingOutput.units.map(u => u.temporalCandidate), data.first.understandingOutput.units.map(u => u.temporalCandidate));
  });
  test(`${property}: trusted temporal deletion and non-null erasure remain rejected`, async () => {
    for (const replacement of [null, {rawText:labels[1],kind:"unknown",checkInCandidate:null,checkOutCandidate:null,nightsCandidate:null}]) {
      const data = scenario(property, date, labels), second = structuredClone(data.repair);
      second.understandingOutput.units[1].temporalCandidate = replacement;
      const x = await run(data, second);
      assert.notEqual(x.diagnostic.finalAcceptedAttempt, 2);
      assert.equal(x.calls, 2);
      assert.equal(x.diagnostic.attempts[1].validationResult.adoptionFailure, "CORRECTION_FIELD_NOT_PRESERVED");
    }
  });
  test(`${property}: envelope-blocked sibling is still fully protected`, async () => {
    for (const mutation of [second => {second.understandingOutput.units.shift();second.contextLinkCandidates.shift();}, second => {second.understandingOutput.units[0].temporalCandidate=null;}]) {
      const data=scenario(property,date,labels), second=structuredClone(data.repair); mutation(second);
      const x=await run(data,second); assert.notEqual(x.diagnostic.finalAcceptedAttempt,2);
    }
  });
  test(`${property}: evidence addition cannot change source event or erase prior ownership`, async () => {
    for (const mutation of [second => {second.understandingOutput.units[1].evidenceRefs[1].eventId="foreign-event";}, second => {second.understandingOutput.units[1].evidenceRefs.shift();}]) {
      const data=scenario(property,date,labels), second=structuredClone(data.repair); mutation(second);
      const x=await run(data,second); assert.notEqual(x.diagnostic.finalAcceptedAttempt,2);
    }
  });
  test(`${property}: already grounded input stays a single Understanding call`, async () => {
    const data=scenario(property,date,labels); data.first=structuredClone(data.repair);
    const x=await run(data); assert.equal(x.calls,1); assert.equal(x.diagnostic.finalAcceptedAttempt,1);
  });
}
