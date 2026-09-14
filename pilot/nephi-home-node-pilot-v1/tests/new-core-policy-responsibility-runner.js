"use strict";
// FAKE_INTEGRATION: queued Understanding; official admission/core/Resolver/bytes.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { isValidatedFinalResponse, unknownProvenanceFor } = require("../lib/conversation-engine-v2/claim-validator");
const { formalProperty } = require("./new-core-room-composition-query-runner");
const { policy } = require("./new-core-operator-policy-runner");
const NOW = "2026-09-13T08:00:00.000Z";

async function query(propertyId, specs, { detailRegistered = false, configure = () => {}, transform = (_n, units) => units, initialState = null } = {}) {
  const property = formalProperty(propertyId);
  property.propertyFacts = [policy("allowed", "The general service is available.")];
  if (detailRegistered) property.propertyFacts.push({ ...policy("conditional", "Only formally registered participants qualify."), canonicalId: "operator_access__eligibility" });
  configure(property);
  const scope = { propertyId, channel: "isolated", userId: "actor" };
  const state = initialState || createConversationStateV3({ ...scope, createdAt: NOW, updatedAt: NOW, expiresAt: "2026-09-14T08:00:00.000Z" });
  const message = specs.map(s => s.text).join("\n"); let calls = 0;
  const result = await executeNewCoreTurn({ scope, state, property, now: NOW, publicBaseUrl: "https://example.invalid", providerConfig: { apiKey: "isolated-provider-double" },
    input: { turnId: "turn", traceId: "turn", message, recentConversation: [], sourceEvents: [{ eventId: "event", messageRef: "event", role: "guest", timestamp: NOW, messageKind: "text", messageText: message }] },
    resolver: { availability: () => { throw Error("unexpected inventory lookup"); }, availableDates: () => { throw Error("unexpected inventory lookup"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, fetchImpl: async () => {
      calls++;
      const units = transform(calls, specs.map((s, index) => {
        const startOffset = message.indexOf(s.text), evidenceRefs = [{ eventId: "event", messageRef: "event", startOffset, endOffset: startOffset + s.text.length, quote: s.text }];
        return { unitId: `unit-${index}`, contextLinkCandidateId: `link-${index}`, purpose: "lodging_question", capability: s.capability || "policy", subject: s.subject || { kind: "policy", catalogIdentity: "operator_access" },
          evidenceRefs, stayDependent: false, temporalCandidate: null, safetyCandidate: null, confidenceBand: "high", quantityCandidate: null,
          slotCandidates: (s.intents || []).map((value, i) => ({ slotCandidateId: `need-${index}-${i}`, slot: "information_need", operation: "SET", value, evidenceRefs })) };
      }));
      const envelope = { understandingOutput: { schemaVersion: 1, turnId: input.turnId, units }, contextLinkCandidates: units.map(u => ({ unitId: u.unitId, contextLinkCandidateId: u.contextLinkCandidateId, relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: u.evidenceRefs, referencedHistoryEventRefs: [] })) };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(envelope) }] }] }) };
    } }) });
  return { result, calls, valid: result.finalResponse.shouldReply ? isValidatedFinalResponse(result.finalResponse, { propertyId, eventId: "turn", turnId: "turn" }) : result.finalDecision.action === "no_reply" && result.finalResponse.replyText === "" && result.artifacts.claimValidation.ok };
}


for (const propertyId of ["responsibility-alpha", "responsibility-beta"]) {
  const pet = {kind:"policy",catalogIdentity:"pets"};
  const configure = p => {p.propertyFacts.push({...policy("allowed","Pets are welcome under the published general policy."),canonicalId:"pets"});};
  test(`${propertyId}: general permission remains an answer`, async () => {
    const x=await query(propertyId,[{text:"Are pets welcome?",subject:pet}],{configure});
    assert.equal(x.result.earliestFailure,null);assert.equal(x.valid,true);
    assert.equal(x.result.artifacts.executionOutcomes[0].outcome,"answered");
    assert.equal(x.result.artifacts.executionOutcomes[0].facts.answer,"Pets are welcome under the published general policy.");
    assert.equal(x.result.finalDecision.action,"reply");
  });
  test(`${propertyId}: missing qualified applicability cannot be inferred from general permission`, async () => {
    const x=await query(propertyId,[{text:"Can our four dogs stay?",subject:pet,intents:["eligibility"]}],{configure});
    assert.equal(x.result.earliestFailure,null);assert.equal(x.valid,true);assert.equal(x.calls,1);
    const out=x.result.artifacts.executionOutcomes[0];
    assert.equal(out.outcome,"unknown");assert.equal(unknownProvenanceFor(out).propertyId,propertyId);
    assert.equal(out.facts.answer,undefined);assert.equal(x.result.finalDecision.action,"reply");
    assert.equal(out.knownFacts.answerScope,"general_policy");
    assert.equal(x.result.finalResponse.replyText, "一般政策：Pets are welcome under the published general policy.");
  });
  test(`${propertyId}: registered restriction is the answer, never an inferred approval`, async () => {
    const answer="The registered limit is two pets; larger groups are not permitted.";
    const x=await query(propertyId,[{text:"Can our four dogs stay?",subject:pet,intents:["eligibility"]}],{configure:p=>{configure(p);p.propertyFacts.push({...policy("conditional",answer),canonicalId:"pets__eligibility"});}});
    assert.equal(x.result.earliestFailure,null);assert.equal(x.valid,true);
    const out=x.result.artifacts.executionOutcomes[0];assert.equal(out.outcome,"answered");
    assert.equal(out.facts.answer,answer);assert.ok(x.result.finalResponse.replyText.includes(answer));
    assert.equal(x.result.finalDecision.action,"reply");
  });
  test(`${propertyId}: registered arrival policy remains a direct answer`, async () => {
    const answer="Latest arrival is 22:00.";
    const x=await query(propertyId,[{text:"What is the latest arrival policy?",subject:{kind:"policy",catalogIdentity:"check_in__latest_arrival_policy"}}],{configure:p=>p.propertyFacts.push({...policy("allowed",answer),canonicalId:"check_in__latest_arrival_policy"})});
    assert.equal(x.result.earliestFailure,null);assert.equal(x.valid,true);
    assert.equal(x.result.artifacts.executionOutcomes[0].outcome,"answered");
    assert.equal(x.result.artifacts.executionOutcomes[0].facts.answer,answer);assert.equal(x.result.finalDecision.action,"reply");
  });
}
test("a general answer and additional-condition sibling keep separate responsibility",async()=>{
 const x=await query("mixed-responsibility",[{text:"Is this service offered?"},{text:"Does our particular arrangement qualify?",intents:["eligibility"]}]);
 assert.equal(x.result.earliestFailure,null);assert.equal(x.valid,true);
 assert.deepEqual(x.result.artifacts.executionOutcomes.map(o=>o.outcome),["answered","unknown"]);
 assert.equal(x.result.artifacts.responsePlan.renderObligations.length,2);
 assert.equal(x.result.finalResponse.replyText,"The general service is available.");
});
test("an unrelated bundle note is not eligibility evidence",async()=>{
 const x=await query("bundle-note",[{text:"Does our arrangement qualify?",capability:"amenity",subject:{kind:"amenity",catalogIdentity:"singing"},intents:["eligibility"]}],{configure:p=>{p.rooms[2].entertainmentAmenities=[{key:"singing",provided:true,statusSource:"operator",source:"preset",note:"Available in the lounge."}];}});
 assert.equal(x.result.earliestFailure,null);assert.equal(x.valid,true);
 assert.equal(x.result.artifacts.executionOutcomes[0].outcome,"unknown");
 assert.ok(!x.result.finalResponse.replyText.includes("Available in the lounge."));
});

for (const propertyId of ["known-policy-alpha", "known-policy-beta"]) {
  test(`partial registered policy survives unregistered qualification: ${propertyId}`, async () => {
    const answer = "11:00";
    const x = await query(propertyId, [{ text: "May we leave at thirteen without further steps?", subject: { kind: "policy", catalogIdentity: "check_out" }, intents: ["eligibility"] }], {
      configure: property => { property.commonAnswers.checkOutTime = answer; }
    });
    const out = x.result.artifacts.executionOutcomes[0];
    assert.equal(out.outcome, "unknown", "the exceptional permission is still unknown");
    assert.ok(unknownProvenanceFor(out));
    assert.equal(out.facts.answer, undefined, "unknown conditions must not acquire an invented answer");
    assert.equal(out.knownFacts?.answer, answer, "retain separately registered general policy");
    assert.equal(x.result.finalResponse.replyText, "一般政策：" + answer);
    assert.equal(x.result.finalDecision.reviewRequired, false);
    assert.equal(x.valid, true);
    assert.equal(x.result.state.tasks[0].status, "unknown");
    const { validateClaims } = require("../lib/conversation-engine-v2/claim-validator");
    const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");
    for (const mode of ["facts", "property", "turn", "task", "provenance"]) {
      const plan = { ...x.result.artifacts.responsePlan, sections: x.result.artifacts.responsePlan.sections.map(s => ({ ...s, facts: { ...s.facts } })) };
      if (mode === "facts") plan.sections[0].facts.answer = "13:00 authorized";
      if (mode === "property") plan.propertyId = "foreign";
      if (mode === "turn") plan.turnId = "another-turn";
      if (mode === "task") plan.sections[0].taskId = "another-task";
      if (mode === "provenance") plan.sections[0].executionProvenance = { ...plan.sections[0].executionProvenance };
      assert.equal(validateClaims(composeControlledReply(plan), plan).ok, false, mode);
    }
  });
}
