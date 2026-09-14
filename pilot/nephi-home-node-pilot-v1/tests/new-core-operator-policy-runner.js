"use strict";
// FAKE_INTEGRATION. Registered data and structured Understanding are fixtures;
// C03/C05/lifecycle/C08, Resolver provenance and final bytes are production code.
const assert = require("node:assert/strict");
const { query, formalProperty } = require("./new-core-room-composition-query-runner");
const { unknownProvenanceFor } = require("../lib/conversation-engine-v2/claim-validator");
const { normalizePropertyFacts } = require("../lib/property-facts");

function policy(status, text) {
  return { canonicalId: "operator_access", publicName: "Operator access policy", category: "policy", status,
    appliesTo: "whole_property", publicText: text, fees: [], advanceNoticeRequired: null, reservationRequired: null,
    conditions: [], restrictions: [], operatingHours: [], availablePeriods: [], notes: "", source: "operator_form", updatedAt: "2026-09-12T12:00:00.000Z" };
}

async function run() {
  let cases = 0;
  for (const scope of ["policy-alpha", "policy-beta"]) {
    for (const status of ["allowed", "not_allowed", "conditional", "unknown"]) {
      const property = formalProperty(scope);
      const answer = status === "unknown" ? "" : status === "allowed" ? "此項服務依正式規則開放。"
        : status === "not_allowed" ? "此項服務依正式規則不提供。" : "此項服務只於公告時段提供。";
      property.propertyFacts = normalizePropertyFacts([policy(status, answer)]);
      const { result, calls, validated } = await query(property, [{ text: "這項接待服務是否開放？", capability: "policy", subject: { kind: "policy", catalogIdentity: "operator_access" } }]);
      assert.equal(result.earliestFailure, null); assert.equal(calls, 1); assert.equal(validated, status !== "unknown");
      const outcome = result.artifacts.executionOutcomes[0];
      assert.equal(outcome.outcome, status === "unknown" ? "unknown" : "answered");
      if (status === "unknown") { assert.equal(unknownProvenanceFor(outcome).propertyId, scope); assert.equal(result.finalResponse.replyText, ""); assert.equal(result.finalResponse.shouldReply,false); }
      else { assert.equal(outcome.facts.propertyId, scope); if (status === "not_allowed") { assert.equal(outcome.facts.status, "confirmed_no"); assert.equal(result.finalResponse.replyText, "Operator access policy目前沒有提供。"); } else assert.ok(result.finalResponse.replyText.includes(answer)); }
      assert.notEqual(result.finalDecision.action, "handoff"); cases++;
    }
    for (const text of ["可以先看看住宿環境再決定嗎？", "行李能否提前寄放？", "朋友可以短暫來訪嗎？"]) {
      const property = formalProperty(scope);
      const { result, calls, validated } = await query(property, [{ text, capability: "policy", subject: { kind: "property", catalogIdentity: null } }]);
      assert.equal(result.earliestFailure, null, JSON.stringify(result.earliestFailure));
      assert.equal(calls, 1); assert.equal(validated, false); assert.equal(result.finalResponse.shouldReply, false); assert.equal(result.finalResponse.replyText, "");
      const outcome = result.artifacts.executionOutcomes[0];
      assert.equal(outcome.outcome, "unknown"); assert.equal(unknownProvenanceFor(outcome).propertyId, scope);
      assert.notEqual(result.finalDecision.action, "handoff"); cases++;
    }
  }
  // A policy query is not an operator action. An explicit arrangement request
  // has its own validated responsibility; its sibling cannot consume answers.
  const specs = [
    { text: "請問整體房間組成？", capability: "lodging_room_composition", subject: { kind: "property", catalogIdentity: null } },
    { text: "未登錄的服務是否允許？", capability: "policy", subject: { kind: "property", catalogIdentity: null } },
    { text: "請業者替我安排特殊接待。", purpose: "operator_request", capability: "booking_operator_request", subject: { kind: "other_verified", catalogIdentity: null }, safetyCandidate: { operatorActionClass: "special_arrangement", riskClass: null } }
  ];
  const mixed = await query(formalProperty(), specs);
  assert.equal(mixed.result.earliestFailure, null); assert.equal(mixed.validated, true);
  assert.deepEqual(mixed.result.artifacts.executionOutcomes.slice(0, 2).map(outcome => outcome.outcome), ["answered", "unknown"]);
  const human = mixed.result.artifacts.executionOutcomes[2];
  assert.equal(human.type, "human_help");
  assert.equal(human.operatorActionClass, "special_arrangement");
  assert.equal(unknownProvenanceFor(human), null, "human responsibility is not a Resolver unknown fact");
  const obligation = mixed.result.artifacts.responsePlan.renderObligations.find(item => item.taskId === human.taskId);
  assert.equal(obligation.kind, "HANDOFF"); assert.equal(obligation.payload.status, "needs_human");
  assert.ok(mixed.result.finalResponse.replyText.includes("請稍後，將盡快回覆您。"));
  assert.equal(mixed.result.finalDecision.action, "reply"); assert.equal(mixed.result.finalDecision.reviewRequired, true);
  assert.ok(mixed.result.finalResponse.replyText.includes("East suite")); cases++;
  console.log(`operator policy: ${cases}/${cases} PASS (FAKE_INTEGRATION)`);
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run, policy };
