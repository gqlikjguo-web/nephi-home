"use strict";

// FAKE_INTEGRATION: fixture Understanding, real shared validation/application.
// Dependency observers delegate unchanged calls; no decision is stubbed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { randomUUID, randomBytes } = require("node:crypto");
const { CAPABILITIES, OPERATOR_ACTION_CLASSES } = require("../lib/new-core/contracts/semantic-unit-candidate");
const { CAPABILITY_REGISTRY_PROJECTION: registry, capabilityPolicyFor, catalogIdentityRuleFor } = require("../lib/new-core/capability-subject-policy");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");

const policies = [...CAPABILITIES].map(capability => ({ capability, policy: capabilityPolicyFor(registry, capability) })).filter(item => item.policy);
const answer = policies.find(({ policy }) => policy.routeKind === "ANSWER" && !policy.stayDependent && policy.subjectKinds.length === 1 && policy.safetyShape === "none" && policy.requiredGuestFields.length === 0);
const handoff = policies.find(({ capability, policy }) => policy.routeKind === "HANDOFF" && policy.safetyShape === "operator_action"
  && policy.subjectKinds.some(kind => catalogIdentityRuleFor(registry, capability, kind) === "NULL_OR_PUBLIC_CATALOG"));
assert.ok(answer && handoff, "registry must supply fixture dispositions");
const handoffKind = handoff.policy.subjectKinds.find(kind => catalogIdentityRuleFor(registry, handoff.capability, kind) === "NULL_OR_PUBLIC_CATALOG");

function observedApplication(records) {
  const filename = path.resolve(__dirname, "../lib/new-core/application-service.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = name => {
    const original = originalRequire(name);
    const targets = {
      "../conversation-engine-v2/final-decision": ["buildFinalDecision", "decisionInputs"],
      "../conversation-engine-v2/response-planner": ["buildResponsePlan", "planInputs"],
      "./unit-aggregator": ["aggregateUnitOutcomes", "aggregationInputs"]
    };
    if (!targets[name]) return original;
    const [fn, key] = targets[name];
    return { ...original, [fn]: (...args) => { records[key].push(args[0]); return original[fn](...args); } };
  };
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return loaded.exports;
}

async function run(dispositions) {
  const now = "2026-09-07T06:00:00.000Z", propertyId = randomUUID();
  const scope = { propertyId, channel: "isolated", userId: randomUUID() };
  const facts = dispositions.map((_, i) => ({ canonicalId: "fixture_" + randomBytes(6).toString("hex"), category: answer.policy.subjectKinds[0],
    publicName: `Fixture fact ${i}`, status: "allowed", publicText: `Official fixture fact ${i}` }));
  const property = { propertyId, displayName: "Isolated fixture", rooms: [], commonAnswers: {}, businessProfile: {}, propertyFacts: facts };
  const events = dispositions.map((_, i) => ({ eventId: `event-${i}`, messageRef: `event-${i}`, role: "guest", timestamp: now, messageKind: "text", messageText: randomUUID() }));
  const records = { decisionInputs: [], planInputs: [], aggregationInputs: [] };
  const { executeNewCoreTurn } = observedApplication(records);
  let calls = 0;
  const result = await executeNewCoreTurn({
    scope, property, now, publicBaseUrl: "https://example.invalid",
    state: createConversationStateV3({ ...scope, tasks: [], createdAt: now, updatedAt: now, expiresAt: "2026-09-08T06:00:00.000Z" }),
    input: { turnId: "turn", traceId: randomUUID(), message: events.map(event => event.messageText).join(""), sourceEvents: events, recentConversation: [] },
    providerConfig: { apiKey: "fixture-only" },
    resolver: { availability: () => { throw Error("UNEXPECTED_RESOLVER"); }, availableDates: () => { throw Error("UNEXPECTED_RESOLVER"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, nowMs: () => Date.parse(now), fetchImpl: async () => {
      calls += 1;
      const units = dispositions.map((disposition, i) => {
        const choice = disposition === "ANSWER" ? answer : handoff, event = input.sourceEvents[i];
        const ref = { eventId: event.eventId, messageRef: event.messageRef, startOffset: 0, endOffset: event.messageText.length, quote: event.messageText };
        return { unitId: `unit-${i}`, evidenceRefs: [ref], purpose: choice.policy.safetyPurposes[0], capability: choice.capability,
          subject: disposition === "ANSWER" ? { kind: answer.policy.subjectKinds[0], catalogIdentity: facts[i].canonicalId } : { kind: handoffKind, catalogIdentity: null },
          stayDependent: choice.policy.stayDependent, temporalCandidate: null, contextLinkCandidateId: `link-${i}`,
          safetyCandidate: disposition === "HANDOFF" ? { operatorActionClass: [...OPERATOR_ACTION_CLASSES][0], riskClass: null } : null,
          slotCandidates: [], confidenceBand: "high" };
      });
      const output = { understandingOutput: { schemaVersion: 1, turnId: input.turnId, units }, contextLinkCandidates: units.map(unit => ({
        contextLinkCandidateId: unit.contextLinkCandidateId, unitId: unit.unitId, relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: unit.evidenceRefs, referencedHistoryEventRefs: []
      })) };
      return { ok: true, status: 200, headers: { get: () => "fixture" }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
    } })
  });
  assert.equal(calls, 1, "fixture Understanding must pass without correction");
  assert.equal(result.earliestFailure, null, "fixture must have no upstream failure");
  assert.deepEqual(result.routing, dispositions);
  return { result, records };
}

async function main() {
  const aa = await run(["ANSWER", "ANSWER"]);
  assert.equal(aa.result.finalDecision.action, "reply");
  assert.equal(aa.result.finalDecision.taskIds.length, 2);
  assert.equal(aa.result.artifacts.executionOutcomes.filter(item => item.outcome === "answered").length, 2);
  const h = await run(["HANDOFF"]);
  assert.equal(h.result.finalDecision.action, "handoff");
  assert.equal(h.result.finalDecision.reviewRequired, true);
  console.log("CONTROL_CASES: ANSWER+ANSWER PASS; HANDOFF-only PASS");
  const { result, records } = await run(["ANSWER", "HANDOFF"]);
  const aggregation = result.artifacts.aggregation;
  assert.deepEqual(aggregation.unitOutcomes.map(item => item.unitId), ["unit-0", "unit-1"]);
  assert.equal(aggregation.hasHandoff, true);
  assert.equal(aggregation.unitOutcomes[1].routingDecision.disposition, "HANDOFF");
  assert.equal(aggregation.unitOutcomes[1].canonicalItem, null);
  assert.equal(result.artifacts.executionOutcomes[0].outcome, "answered");
  assert.equal(records.decisionInputs.length, 1);
  const decisionInput = records.decisionInputs[0];
  const handoffId = aggregation.unitOutcomes[1].unitId;
  const presence = {
    decisionInput: decisionInput.executionOutcomes.some(item => item.taskId === handoffId),
    responsePlan: records.planInputs[0].inputTaskIds.includes(handoffId),
    responsibility: result.finalDecision.reviewRequired === true || result.finalDecision.action === "handoff"
  };
  console.log(JSON.stringify({ classification: "FAKE_INTEGRATION", prerequisites: "PASS", aggregationInput: records.aggregationInputs[0],
    bridgeOutcomes: result.artifacts.executionOutcomes, finalDecisionInput: decisionInput, responsePlanInput: records.planInputs[0],
    finalDecision: result.finalDecision, finalResponse: result.finalResponse, presence }));
  assert.deepEqual(presence, { decisionInput: true, responsePlan: true, responsibility: true }, "MIXED_ANSWER_HANDOFF_BRIDGE_DROPS_HANDOFF");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
