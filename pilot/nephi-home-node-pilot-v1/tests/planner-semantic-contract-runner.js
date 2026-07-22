"use strict";

const assert = require("node:assert/strict");
const { applyPlannerSemanticContract } = require("../lib/conversation-engine-v2/planner-schema");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { instructions } = require("../lib/providers/test-only-openai-conversation-planner");

function task({ taskId, type = "property_fact", category, canonicalCandidate, detailIntent = "general", requestedOutputs = ["answer"], sourceText }) {
  return { taskId, type, sourceText, detailIntent, requestedOutputs, dependsOnStayContext: false, entity: { category, rawText: sourceText, canonicalCandidate, confidence: 0.99 }, confidence: 0.99 };
}

function plan(tasks) {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks,
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "semantic_contract_test"
  };
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

  for (const [canonicalCandidate, sourceText] of [["bbq", "可以烤肉嗎"], ["pool", "有戲水池嗎"]]) {
    const baseQuestion = applyPlannerSemanticContract(plan([
      task({ taskId: canonicalCandidate, type: "policy", category: "policy", canonicalCandidate, detailIntent: "eligibility", requestedOutputs: ["answer"], sourceText })
    ]));
    assert.equal(baseQuestion.tasks[0].detailIntent, "general", `${canonicalCandidate} base question must use general`);
    assert.equal(baseQuestion.semanticValidation.repairedTasks[0].reason, "detail_intent_output_mismatch");
  }

  for (const trueEligibility of [
    task({ taskId: "pool-child", type: "amenity", category: "amenity", canonicalCandidate: "pool", detailIntent: "eligibility", requestedOutputs: ["eligibility"], sourceText: "小朋友可以使用戲水池嗎" }),
    task({ taskId: "bbq-bundle", type: "policy", category: "policy", canonicalCandidate: "bbq", detailIntent: "eligibility", requestedOutputs: ["eligibility"], sourceText: "只有包棟才能烤肉嗎" }),
    task({ taskId: "bbq-room", type: "policy", category: "policy", canonicalCandidate: "bbq", detailIntent: "eligibility", requestedOutputs: ["eligibility"], sourceText: "單訂房間也可以烤肉嗎" })
  ]) {
    const checked = applyPlannerSemanticContract(plan([trueEligibility]));
    assert.equal(checked.tasks[0].detailIntent, "eligibility");
    assert.equal(checked.semanticValidation.repairedTasks.length, 0);
    assert.equal(checked.semanticValidation.rejectedTasks.length, 0);
  }

  const multi = applyPlannerSemanticContract(plan([
    task({ taskId: "location", category: "transport", canonicalCandidate: null, sourceText: "民宿離夜市近嗎" }),
    task({ taskId: "bbq", type: "policy", category: "policy", canonicalCandidate: "bbq", detailIntent: "eligibility", requestedOutputs: ["answer"], sourceText: "可以烤肉嗎" })
  ]));
  assert.equal(multi.tasks.length, 2);
  assert.deepEqual(multi.tasks.map((item) => [item.entity.canonicalCandidate, item.detailIntent]), [["location", "general"], ["bbq", "general"]]);

  const property = {
    propertyId: "property_alpha", displayName: "Alpha", timezone: "Asia/Taipei", rooms: [],
    businessProfile: { googleMapsUrl: "https://maps.app.goo.gl/AlphaLocation" },
    commonAnswers: { bbqRule: "Alpha barbecue policy" },
    semanticCatalog: { aliases: { bbq: ["barbecue"] }, amenities: [] }
  };
  const engine = new ConversationEngineV2({
    planner: { classify: async () => plan([
      task({ taskId: "location", category: "transport", canonicalCandidate: null, sourceText: "property near a market" }),
      task({ taskId: "bbq", type: "policy", category: "policy", canonicalCandidate: "bbq", detailIntent: "eligibility", requestedOutputs: ["answer"], sourceText: "barbecue available" })
    ]) },
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
