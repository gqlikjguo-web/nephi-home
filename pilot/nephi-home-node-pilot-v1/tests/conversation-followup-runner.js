"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { instructions } = require("../lib/providers/test-only-openai-conversation-planner");

const facts = {
  singing: { type: "amenity", category: "amenity", question: "可以唱歌嗎？", answer: "僅限包棟，使用時間 08:00-22:00。" },
  bbq: { type: "policy", category: "policy", question: "可以烤肉嗎？", answer: "僅限包棟，場地費 1000 元。" },
  pool: { type: "amenity", category: "amenity", question: "有戲水池嗎？", answer: "僅限包棟使用，費用 300 元/天。" },
  parking: { type: "amenity", category: "amenity", question: "有停車嗎？", answer: "有空地與一個車庫位；車庫滿時可停旁邊空地。" },
  check_in: { type: "policy", category: "policy", question: "幾點可以入住？", answer: "15:00 後入住。" }
};
function plan({ relation, task, topic = null }) {
  return { schemaVersion: 2, discourse: { relation, confidence: 1 }, stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{ taskId: "question", type: task.type, sourceText: task.sourceText, requestedOutputs: task.requestedOutputs || ["answer"], dependsOnStayContext: false,
      entity: { category: task.category, rawText: task.sourceText, canonicalCandidate: topic, confidence: 1 }, confidence: 1 }],
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: relation };
}
function property(answerOverrides = {}) {
  return { propertyId: "property_alpha", commonAnswers: {
    parkingRule: answerOverrides.parking || facts.parking.answer,
    bbqRule: answerOverrides.bbq || facts.bbq.answer,
    checkInTime: answerOverrides.check_in || facts.check_in.answer
  }, rooms: [], faqs: [
    { knowledgeKey: "singing", question: facts.singing.question, answer: answerOverrides.singing || facts.singing.answer },
    { knowledgeKey: "pool", question: facts.pool.question, answer: answerOverrides.pool || facts.pool.answer }
  ] };
}
function runPair(id, first, followUp, { latestAnswer } = {}) {
  const memory = new Map();
  let propertyReads = 0;
  const planner = { classify: async ({ currentMessage }) => currentMessage === first.message
    ? plan({ relation: "new_request", task: { type: first.type, category: first.category, sourceText: first.message }, topic: first.topic })
    : plan({ relation: "continue", task: { type: followUp.type, category: followUp.category, sourceText: followUp.message } }) };
  const engine = new ConversationEngineV2({ planner,
    persistence: { getConversationState: (p, c, u) => memory.get(`${p}:${c}:${u}`) || null, setConversationState: (p, c, u, value) => memory.set(`${p}:${c}:${u}`, value), appendMessageLog: () => ({ reviewId: "review" }) },
    getProperty: () => { propertyReads += 1; return property(propertyReads > 1 && latestAnswer ? { [first.topic]: latestAnswer } : {}); },
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }), listPriceOverrides: () => []
  });
  return Promise.resolve()
    .then(() => engine.process({ customerId: "property_alpha", channelId: id, lineUserId: "guest", eventId: `${id}-1`, eventTimestamp: 1, messageText: first.message }))
    .then((initial) => engine.process({ customerId: "property_alpha", channelId: id, lineUserId: "guest", eventId: `${id}-2`, eventTimestamp: 2, messageText: followUp.message }).then((second) => ({ initial, second, memory, propertyReads })));
}

(async () => {
  const cases = [
    { id: "singing", first: { message: "可以唱歌嗎？", topic: "singing", type: "amenity", category: "amenity" }, followUp: { message: "可以到幾點？", type: "amenity", category: "other" }, expected: "08:00-22:00", latestAnswer: "僅限包棟，使用時間更新為 09:00-21:00。", latestExpected: "09:00-21:00" },
    { id: "bbq", first: { message: "可以烤肉嗎？", topic: "bbq", type: "policy", category: "policy" }, followUp: { message: "要收費嗎？", type: "policy", category: "other" }, expected: "1000 元" },
    { id: "pool", first: { message: "有戲水池嗎？", topic: "pool", type: "amenity", category: "amenity" }, followUp: { message: "只有包棟可以用嗎？", type: "amenity", category: "other" }, expected: "僅限包棟" },
    { id: "parking", first: { message: "有停車嗎？", topic: "parking", type: "amenity", category: "amenity" }, followUp: { message: "車位滿了怎麼辦？", type: "amenity", category: "other" }, expected: "旁邊空地" },
    { id: "checkin", first: { message: "幾點可以入住？", topic: "check_in", type: "policy", category: "policy" }, followUp: { message: "可以提早嗎？", type: "human_help", category: "other" }, expected: null }
  ];
  for (const item of cases) {
    const { initial, second, memory, propertyReads } = await runPair(item.id, item.first, item.followUp, { latestAnswer: item.latestAnswer });
    assert.equal(initial.taskResults[0].status, "answered", `${item.id} first question must resolve`);
    assert.equal(memory.get(`property_alpha:${item.id}:guest`).conditions.topic.canonicalId, item.first.topic, `${item.id} must store only canonical follow-up topic`);
    assert.equal(memory.get(`property_alpha:${item.id}:guest`).conditions.tasks, undefined, "state must not retain prior task text as a fact source");
    assert.equal(propertyReads, 2, `${item.id} follow-up must re-read current property data`);
    if (item.expected) {
      assert.equal(second.taskResults[0].status, "answered", `${item.id} follow-up must resolve from canonical topic`);
      assert.ok(second.replyText.includes(item.latestExpected || item.expected), `${item.id} follow-up must use freshly resolved property data`);
    } else {
      assert.equal(second.taskResults[0].status, "needs_human", "actual early-check-in request stays human handoff");
      assert.equal(second.replyText.includes("已安排"), false);
    }
  }
  assert.match(instructions(), /follow-up|previous topic|conversationState/i, "planner must receive a generic follow-up instruction");
  console.log("conversation follow-up: PASS");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
