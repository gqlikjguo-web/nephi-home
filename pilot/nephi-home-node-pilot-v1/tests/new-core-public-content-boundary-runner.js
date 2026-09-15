"use strict";
// FAKE_INTEGRATION: official core and catalog Resolver with queued Understanding.
// Public bytes must be owner content; scope/claim/provenance stay internal.
const { test } = require("node:test"), assert = require("node:assert/strict");
const { query } = require("./new-core-policy-responsibility-runner");
const { policy } = require("./new-core-operator-policy-runner");
const { composeSection } = require("../lib/conversation-engine-v2/controlled-composer");
const examples = [
  { id: "parking", kind: "amenity", answer: "停車請使用館旁指定空間。" },
  { id: "check_out", kind: "policy", answer: "11:00" },
  { id: "operator_access", kind: "policy", answer: "Published service is available.\nPlease retain  this spacing." },
  { id: "check_in", kind: "policy", answer: "您好，15:00後可自行入住", custom: "checkInGuestText" },
  { id: "check_out", kind: "policy", answer: "您好，早上11:00前可自行退房", custom: "checkOutGuestText" }
];
function configure(property, examples) {
  property.propertyFacts = examples.filter(x => !x.custom).map(x => ({ ...policy("allowed", x.answer), canonicalId: x.id, category: x.kind }));
  for (const x of examples) if (x.custom) property.commonAnswers[x.custom] = x.answer;
}
function spec(x, index) { return { text: `Please state the published policy and whether our extra arrangement qualifies (${index}).`, capability: x.kind === "amenity" ? "amenity" : "policy", subject: { kind: x.kind, catalogIdentity: x.id }, intents: ["eligibility"] }; }
for (const [index, example] of examples.entries()) test(`public answer preserves original content: ${example.custom || example.id}`, async () => {
  const { result, valid } = await query(`public-content-${index}`, [spec(example, index)], { configure: p => configure(p, [example]) });
  assert.equal(result.earliestFailure, null); assert.equal(valid, true);
  const outcome = result.artifacts.executionOutcomes[0];
  assert.equal(outcome.outcome, "unknown", "additional condition remains unknown");
  assert.equal(outcome.knownFacts.answerScope, "general_policy", "internal scope is preserved");
  assert.equal(result.finalResponse.replyText, example.answer);
  assert.equal(result.finalDecision.action, "reply");
});
test("multiple qualified questions retain both public answers without scope labels", async () => {
  const chosen = examples.slice(0, 2);
  const { result, valid } = await query("public-content-mixed", chosen.map(spec), { configure: p => configure(p, chosen) });
  assert.equal(result.earliestFailure, null); assert.equal(valid, true);
  assert.equal(result.finalResponse.replyText, chosen.map(x => x.answer).join("\n"));
  assert.equal(result.artifacts.responsePlan.renderObligations.length, 2);
  assert.ok(result.artifacts.executionOutcomes.every(o => o.knownFacts.answerScope === "general_policy"));
});
test("metadata values never become content and owner wording is never stripped", () => {
  const answer = "一般政策：這是業者自行輸入的原文。\n保留  原文。";
  const facts = Object.freeze({ answer, answerScope: "general_policy", source: "INTERNAL_SOURCE", propertyId: "INTERNAL_SCOPE", category: "INTERNAL_CATEGORY", detailIntent: "eligibility" });
  const section = Object.freeze({ status: "answered", claimType: "FACTUAL_ANSWER", outcomeReason: "INTERNAL_REASON", facts });
  assert.equal(composeSection(section), answer);
  assert.equal(facts.answerScope, "general_policy");
});
