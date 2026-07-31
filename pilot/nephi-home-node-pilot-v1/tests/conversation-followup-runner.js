"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { instructions } = require("../lib/providers/test-only-openai-conversation-planner");

function plan({ relation, type, category, sourceText, topic = null, detailIntent = "general", eligibilityEvidence = { kind: "none", sourceText: "" } }) {
  return {
    schemaVersion: 2,
    discourse: { relation, confidence: 1 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{ candidateIndex: 0, taskId: "question", type, sourceText, detailIntent, requestedOutputs: [detailIntent === "eligibility" ? "eligibility" : "answer"], eligibilityEvidence, dependsOnStayContext: false,
      entity: { category, rawText: sourceText, canonicalCandidate: topic, confidence: 1 }, confidence: 1 }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "fixture", startOffset: 0, endOffset: 1, quote: "x" }] }],
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: relation
  };
}

function withExplicitRelation(output, sourceEvents, contextSnapshot) {
  const source = sourceEvents[0];
  const relation = output.discourse.relation;
  const kind = ["continue", "answer_clarification"].includes(relation) ? "supplement_existing" : relation === "modify" ? "modify_existing" : relation === "end" ? "end_existing" : "new_request";
  const cycle = contextSnapshot.cycles[0] && contextSnapshot.cycles[0].requestCycleId;
  return {
    ...output,
    contextRelationCandidates: output.tasks.map((task) => ({
      candidateIndex: task.candidateIndex,
      kind,
      candidateRequestCycleRefs: kind === "new_request" ? [] : cycle ? [cycle] : [],
      evidenceRefs: [{ eventId: source.eventId, startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }]
    }))
  };
}

function property(propertyId, overrides = {}) {
  return {
    propertyId,
    commonAnswers: {
      parkingRule: "Parking is available.",
      bbqRule: "BBQ is available for groups.",
      checkInTime: "15:00",
      early_checkin: overrides.early_checkin || "",
      singing__fee: overrides.singing__fee || "",
      bbq__reservation_required: overrides.bbq__reservation_required || "",
      parking__quantity: overrides.parking__quantity || "",
      pool__eligibility: overrides.pool__eligibility || ""
    },
    rooms: [],
    faqs: [
      { knowledgeKey: "singing", question: "Singing", answer: "Singing is bundle-only from 08:00-22:00." },
      { knowledgeKey: "pool", question: "Pool", answer: "Pool is available." }
    ]
  };
}

function createEngine({ plans, properties, propertyReads }) {
  const memory = new Map();
  const planner = { classify: async ({ currentMessage, sourceEvents, contextSnapshot }) => withExplicitRelation(plans.get(currentMessage), sourceEvents, contextSnapshot) };
  const engine = new ConversationEngineV2({
    planner,
    persistence: {
      getConversationState: (p, c, u) => memory.get(`${p}:${c}:${u}`) || null,
      setConversationState: (p, c, u, value) => memory.set(`${p}:${c}:${u}`, value),
      appendMessageLog: () => ({ reviewId: "review" })
    },
    getProperty: (propertyId) => { propertyReads.push(propertyId); return properties[propertyId](); },
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => []
  });
  return { engine, memory };
}

async function runFollowUp({ id, propertyId = "property_alpha", first, followUp, properties }) {
  const propertyReads = [];
  const plans = new Map([
    [first.message, plan({ relation: "new_request", type: first.type, category: first.category, sourceText: first.message, topic: first.topic })],
    [followUp.message, plan({ relation: followUp.relation || "continue", type: followUp.type, category: followUp.category, sourceText: followUp.message, topic: followUp.topic === undefined ? first.topic : followUp.topic, detailIntent: followUp.detailIntent, eligibilityEvidence: followUp.eligibilityEvidence })]
  ]);
  const { engine, memory } = createEngine({ plans, properties, propertyReads });
  const input = (eventId, messageText) => ({ customerId: propertyId, channelId: id, lineUserId: "guest", eventId, eventTimestamp: 1, messageText });
  const initial = await engine.process(input(`${id}-1`, first.message));
  const second = await engine.process(input(`${id}-2`, followUp.message));
  return { initial, second, memory, propertyReads };
}

(async () => {
  const cases = [
    { id: "checkin-early", first: { message: "check-in time", topic: "check_in", type: "policy", category: "policy" }, followUp: { message: "can I arrive early?", type: "policy", category: "other", detailIntent: "early_arrival_policy" }, expected: ["15:00", "提前入住"] },
    { id: "checkin-latest", first: { message: "check-in time latest", topic: "check_in", type: "policy", category: "policy" }, followUp: { message: "what is the latest arrival?", type: "policy", category: "other", detailIntent: "latest_arrival_policy" }, expected: ["最晚抵達"], forbidden: ["15:00"] },
    { id: "singing-fee", first: { message: "singing available", topic: "singing", type: "amenity", category: "amenity" }, followUp: { message: "is there a fee?", type: "amenity", category: "other", detailIntent: "fee" }, expected: ["Singing fee: 500"], forbidden: ["08:00-22:00"] },
    { id: "bbq-reservation", first: { message: "bbq available", topic: "bbq", type: "policy", category: "policy" }, followUp: { message: "do I need a reservation?", type: "policy", category: "other", detailIntent: "reservation_required" }, expected: ["BBQ reservation must be confirmed"] },
    { id: "parking-quantity", first: { message: "parking available", topic: "parking", type: "amenity", category: "amenity" }, followUp: { message: "how many spaces?", type: "amenity", category: "other", detailIntent: "quantity" }, expected: ["3 spaces"] },
    { id: "pool-eligibility", first: { message: "pool available", topic: "pool", type: "amenity", category: "amenity" }, followUp: { message: "can children use it?", type: "amenity", category: "other", detailIntent: "eligibility", eligibilityEvidence: { kind: "person", sourceText: "children" } }, expected: ["Children must be accompanied"] }
  ];
  const overrides = { singing__fee: "Singing fee: 500", bbq__reservation_required: "BBQ reservation must be confirmed", parking__quantity: "3 spaces", pool__eligibility: "Children must be accompanied" };
  for (const item of cases) {
    const result = await runFollowUp({ id: item.id, first: item.first, followUp: item.followUp, properties: { property_alpha: () => property("property_alpha", overrides) } });
    assert.equal(result.initial.taskResults[0].status, "answered", `${item.id} initial topic must resolve`);
    assert.equal(result.second.taskResults[0].status, "answered", `${item.id} follow-up must preserve a partial answer instead of global fallback`);
    assert.equal(result.second.taskResults[0].facts.detailIntent, item.followUp.detailIntent, `${item.id} resolver must receive controlled detail intent`);
    const persistedTask = result.memory.get(`property_alpha:${item.id}:guest`).tasks[0];
    assert.equal(persistedTask.entityId, item.first.topic, `${item.id} must retain the canonical topic`);
    assert.equal(persistedTask.detailIntent, item.followUp.detailIntent, `${item.id} state must retain only the controlled detail intent`);
    assert.equal(Object.hasOwn(persistedTask, "facts"), false, `${item.id} must not retain a prior reply as fact`);
    assert.deepEqual(result.propertyReads, ["property_alpha", "property_alpha"], `${item.id} must re-read current property data each turn`);
    for (const expected of item.expected) assert.ok(result.second.replyText.includes(expected), `${item.id} must answer the requested detail`);
    for (const forbidden of item.forbidden || []) assert.equal(result.second.replyText.includes(forbidden), false, `${item.id} must not repeat unrelated base fact`);
  }

  const newTopic = await runFollowUp({
    id: "new-topic", first: { message: "parking?", topic: "parking", type: "amenity", category: "amenity" },
    followUp: { message: "check-in time?", relation: "new_topic", topic: "check_in", type: "policy", category: "policy", detailIntent: "general" },
    properties: { property_alpha: () => property("property_alpha", overrides) }
  });
  assert.ok(newTopic.second.replyText.includes("15:00"), "an explicit new topic must not inherit parking detail");
  assert.equal(newTopic.memory.get("property_alpha:new-topic:guest").tasks.at(-1).entityId, "check_in");

  let alphaVersion = 0;
  const fresh = await runFollowUp({
    id: "fresh", first: { message: "bbq?", topic: "bbq", type: "policy", category: "policy" },
    followUp: { message: "reservation?", type: "policy", category: "other", detailIntent: "reservation_required" },
    properties: { property_alpha: () => property("property_alpha", { bbq__reservation_required: ++alphaVersion === 1 ? "Old reservation policy" : "New reservation policy" }) }
  });
  assert.ok(fresh.second.replyText.includes("New reservation policy"), "follow-up must use newly resolved property facts, not previous reply text");

  const isolated = await runFollowUp({
    id: "isolation", propertyId: "property_beta", first: { message: "parking beta", topic: "parking", type: "amenity", category: "amenity" },
    followUp: { message: "how many beta?", type: "amenity", category: "other", detailIntent: "quantity" },
    properties: { property_beta: () => property("property_beta", { parking__quantity: "7 beta spaces" }) }
  });
  assert.ok(isolated.second.replyText.includes("7 beta spaces"));
  assert.equal(isolated.memory.get("property_beta:isolation:guest").scope.propertyId, "property_beta");

  const noContextPlans = new Map([["can I arrive early?", plan({ relation: "continue", type: "policy", category: "other", sourceText: "can I arrive early?", detailIntent: "early_arrival_policy" })]]);
  const noContextReads = [];
  const noContext = createEngine({ plans: noContextPlans, properties: { property_alpha: () => property("property_alpha", overrides) }, propertyReads: noContextReads });
  const noContextResult = await noContext.engine.process({ customerId: "property_alpha", channelId: "no-context", lineUserId: "guest", eventId: "one", eventTimestamp: 1, messageText: "can I arrive early?" });
  assert.equal(noContextResult.shouldReply, true, "a detail-only question without a safe prior topic must safely reject instead of guessing a topic");
  assert.ok(noContextResult.replyText.length > 0);

  assert.equal(validatePlannerOutput(plan({ relation: "continue", type: "policy", category: "policy", sourceText: "invalid detail", detailIntent: "free_text_detail" })).ok, false, "planner detail intent must remain a controlled contract");
  assert.match(instructions(), /detailIntent/i, "planner must receive a generic controlled detail-intent instruction");
  console.log("conversation follow-up: PASS");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
