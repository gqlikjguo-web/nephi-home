"use strict";

const assert = require("node:assert/strict");
const { applyPlannerSemanticContract, plannerJsonSchema } = require("../lib/conversation-engine-v2/planner-schema");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { instructions } = require("../lib/providers/test-only-openai-conversation-planner");

function task({ taskId, type = "property_fact", category, canonicalCandidate, detailIntent = "general", requestedOutputs = ["answer"], eligibilityEvidence = { kind: "none", sourceText: "" }, sourceText }) {
  return { taskId, type, sourceText, detailIntent, requestedOutputs, eligibilityEvidence, dependsOnStayContext: false, entity: { category, rawText: sourceText, canonicalCandidate, confidence: 0.99 }, stayCandidate: null, confidence: 0.99 };
}

function plan(tasks) {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: tasks.map((item, candidateIndex) => ({ ...item, candidateIndex })),
    contextRelationCandidates: tasks.map((_, candidateIndex) => ({ candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "fixture", startOffset: 0, endOffset: 1, quote: "x" }] })),
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "semantic_contract_test"
  };
}

function withExplicitRelations(output, sourceEvents) {
  const source = sourceEvents[0];
  return { ...output, contextRelationCandidates: output.tasks.map((task) => ({ candidateIndex: task.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: source.eventId, startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }] })) };
}

function memory() {
  const states = new Map();
  return {
    getConversationState: (propertyId, channelId, userId) => states.get(`${propertyId}:${channelId}:${userId}`) || null,
    setConversationState: (propertyId, channelId, userId, value) => states.set(`${propertyId}:${channelId}:${userId}`, value),
    appendMessageLog: () => ({ reviewId: "review" })
  };
}

async function main() {
  const transportNull = applyPlannerSemanticContract(plan([
    task({ taskId: "location", category: "transport", canonicalCandidate: null, sourceText: "車站在附近嗎" })
  ]));
  assert.equal(transportNull.tasks[0].type, "property_fact");
  assert.equal(transportNull.tasks[0].entity.category, "transport");
  assert.equal(transportNull.tasks[0].entity.canonicalCandidate, "location");
  assert.equal(transportNull.tasks[0].detailIntent, "general");
  assert.deepEqual(transportNull.semanticValidation.repairedTasks.map((item) => item.reason), ["transport_location_candidate_missing"]);

  const unresolvedOther = applyPlannerSemanticContract(plan([
    task({ taskId: "nearby", category: "other", canonicalCandidate: null, sourceText: "附近有便利商店嗎" })
  ]));
  assert.equal(unresolvedOther.tasks[0].type, "unknown");
  assert.deepEqual(unresolvedOther.semanticValidation.rejectedTasks.map((item) => item.reason), ["unresolved_property_fact"]);

  for (const [canonicalCandidate, sourceText] of [["bbq", "可以烤肉嗎"], ["pool", "有戲水池嗎"], ["parking", "有停車嗎"]]) {
    const baseQuestion = applyPlannerSemanticContract(plan([
      task({ taskId: canonicalCandidate, type: "policy", category: "policy", canonicalCandidate, detailIntent: "eligibility", requestedOutputs: ["eligibility"], sourceText })
    ]));
    assert.equal(baseQuestion.tasks[0].detailIntent, "general", `${canonicalCandidate} base question must use general`);
    assert.deepEqual(baseQuestion.tasks[0].requestedOutputs, ["answer"]);
    assert.equal(baseQuestion.semanticValidation.repairedTasks[0].reason, canonicalCandidate === "parking" ? "parking_contract_mismatch" : "eligibility_evidence_missing");
  }

  for (const sourceText of ["有車位嗎", "停車方便嗎", "需要預約車位嗎"]) {
    const parking = applyPlannerSemanticContract(plan([
      task({ taskId: "parking", type: "availability", category: "amenity", canonicalCandidate: "parking", requestedOutputs: ["availability", "policy"], sourceText })
    ]));
    assert.equal(parking.tasks[0].type, "amenity");
    assert.equal(parking.tasks[0].entity.category, "amenity");
    assert.equal(parking.tasks[0].entity.canonicalCandidate, "parking");
    assert.equal(parking.tasks[0].dependsOnStayContext, false);
    assert.equal(parking.tasks[0].stayCandidate, null);
    assert.deepEqual(parking.tasks[0].requestedOutputs, ["answer"]);
    assert.deepEqual(parking.semanticValidation.repairedTasks.map((item) => item.reason), ["parking_contract_mismatch"]);
  }

  for (const trueEligibility of [
    task({ taskId: "pool-child", type: "amenity", category: "amenity", canonicalCandidate: "pool", detailIntent: "eligibility", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "person", sourceText: "小朋友" }, sourceText: "小朋友可以使用戲水池嗎" }),
    task({ taskId: "bbq-bundle", type: "policy", category: "policy", canonicalCandidate: "bbq", detailIntent: "eligibility", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "booking_mode", sourceText: "包棟" }, sourceText: "只有包棟才能烤肉嗎" }),
    task({ taskId: "bbq-room", type: "policy", category: "policy", canonicalCandidate: "bbq", detailIntent: "eligibility", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "room", sourceText: "單訂房間" }, sourceText: "單訂房間也可以烤肉嗎" }),
    task({ taskId: "facility-room", type: "amenity", category: "amenity", canonicalCandidate: "facility", detailIntent: "eligibility", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "room", sourceText: "哪些房型" }, sourceText: "哪些房型可以使用這項設施" })
  ]) {
    const checked = applyPlannerSemanticContract(plan([trueEligibility]));
    assert.equal(checked.tasks[0].detailIntent, "eligibility");
    assert.deepEqual(checked.tasks[0].requestedOutputs, ["eligibility"]);
    assert.equal(checked.semanticValidation.rejectedTasks.length, 0);
  }

  const multi = applyPlannerSemanticContract(plan([
    task({ taskId: "location", category: "transport", canonicalCandidate: null, sourceText: "民宿離夜市近嗎" }),
    task({ taskId: "bbq", type: "policy", category: "policy", canonicalCandidate: "bbq", detailIntent: "eligibility", requestedOutputs: ["eligibility"], sourceText: "可以烤肉嗎" })
  ]));
  assert.equal(multi.tasks.length, 2);
  assert.deepEqual(multi.tasks.map((item) => [item.entity.canonicalCandidate, item.detailIntent]), [["location", "general"], ["bbq", "general"]]);

  const partiallyRepairable = applyPlannerSemanticContract(plan([
    task({ taskId: "location-ok", category: "transport", canonicalCandidate: null, sourceText: "property near a place" }),
    task({ taskId: "unknown-local", category: "other", canonicalCandidate: null, sourceText: "unresolved property question" })
  ]));
  assert.equal(partiallyRepairable.tasks.length, 2);
  assert.equal(partiallyRepairable.tasks[0].entity.canonicalCandidate, "location");
  assert.equal(partiallyRepairable.tasks[1].type, "unknown");
  assert.deepEqual(partiallyRepairable.semanticValidation.rejectedTasks.map((item) => item.taskId), ["unknown-local"]);

  const schema = plannerJsonSchema();
  assert.ok(schema.properties.tasks.items.required.includes("eligibilityEvidence"));
  assert.deepEqual(schema.properties.tasks.items.properties.eligibilityEvidence.properties.kind.enum, ["none", "person", "room", "plan", "booking_mode", "identity", "stated_condition"]);

  const property = {
    propertyId: "property_alpha", displayName: "Alpha", timezone: "Asia/Taipei", rooms: [],
    businessProfile: { googleMapsUrl: "https://maps.app.goo.gl/AlphaLocation" },
    commonAnswers: { bbqRule: "Alpha barbecue policy" },
    semanticCatalog: { aliases: { bbq: ["barbecue"] }, amenities: [] }
  };
  const engine = new ConversationEngineV2({
    planner: { classify: async ({ sourceEvents }) => withExplicitRelations(plan([
      task({ taskId: "location", category: "transport", canonicalCandidate: null, sourceText: "property near a market" }),
      task({ taskId: "bbq", type: "policy", category: "policy", canonicalCandidate: "bbq", detailIntent: "eligibility", requestedOutputs: ["eligibility"], sourceText: "barbecue available" })
    ]), sourceEvents) },
    persistence: memory(), getProperty: () => property,
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }), listPriceOverrides: () => []
  });
  const result = await engine.process({ customerId: property.propertyId, channelId: "test", lineUserId: "guest", eventId: "semantic-multi", eventTimestamp: Date.parse("2026-07-22T10:00:00+08:00"), messageText: "property near a market; barbecue available" });
  assert.equal(result.shouldReply, true);
  assert.match(result.replyText, /https:\/\/maps\.app\.goo\.gl\/AlphaLocation/);
  assert.match(result.replyText, /Alpha barbecue policy/);
  assert.equal(result.taskResults.length, 2);

  const prompt = instructions();
  assert.match(prompt, /base availability or permission question/i);
  assert.match(prompt, /requestedOutputs.*eligibility/i);
  assert.match(prompt, /do not infer eligibility from a generic permission word/i);
  assert.match(prompt, /every independent clause/i);

  console.log("planner semantic contract: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
