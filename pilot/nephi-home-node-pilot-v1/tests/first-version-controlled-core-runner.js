"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { attachPropertyScopedLineBinding } = require("./helpers/property-scoped-line-webhook");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { applyPlannerSemanticContract } = require("../lib/conversation-engine-v2/planner-schema");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const property = {
  propertyId: "controlled_core_property",
  displayName: "Controlled Core Lodge",
  timezone: "Asia/Taipei",
  rooms: [
    { id: "room_double", name: "301 雙人房", type: "雙人房", capacity: 2, enabled: true },
    { id: "room_quad", name: "302 四人房", type: "四人房", capacity: 4, enabled: true },
    { id: "bundle_all", name: "包棟", inventoryType: "bundle", capacity: 6, enabled: true, memberRoomIds: ["room_double", "room_quad"], entertainmentAmenities: [
      { key: "singing", provided: true, statusSource: "operator", source: "preset" },
      { key: "splash_pool", provided: true, statusSource: "operator", source: "preset" }
    ] }
  ],
  commonAnswers: {
    parkingRule: "提供停車位。",
    bbqRule: "可以依規定烤肉。"
  },
  faqs: [
    { knowledgeKey: "singing", question: "唱歌設備", answer: "提供唱歌設備。" },
    { knowledgeKey: "splash_pool", question: "戲水池", answer: "提供戲水池。" }
  ],
  semanticCatalog: {
    aliases: {
      room_double: ["雙人房"],
      room_quad: ["302"],
      singing: ["唱歌"],
      splash_pool: ["戲水池"],
      parking: ["車位"],
      bbq: ["烤肉"]
    }
  }
};

function task({ taskId, type, sourceText, category, rawText, canonicalCandidate = null }) {
  return {
    taskId,
    type,
    sourceText,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: type === "availability",
    entity: { category, rawText, canonicalCandidate, confidence: 0.95 },
    confidence: 0.95
  };
}

function plan(tasks, { shouldIgnore = false, relation = "new_request", dateText = "", dateKind = "none" } = {}) {
  const stay = {
    dateExpression: { rawText: dateText, kind: dateKind, anchor: dateText ? "message_time" : "none" },
    checkInCandidate: null,
    checkOutCandidate: null,
    nightsCandidate: null,
    guestCountCandidate: null
  };
  const stayTaskCount = tasks.filter((item) => item.dependsOnStayContext).length;
  return {
    schemaVersion: 2,
    discourse: { relation, confidence: 0.99 },
    stateOperations: [],
    stay,
    tasks: tasks.map((item, candidateIndex) => ({
      ...item,
      candidateIndex,
      stayCandidate: item.stayCandidate !== undefined ? item.stayCandidate : item.dependsOnStayContext && stayTaskCount === 1 ? stay : null
    })),
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore,
    reason: shouldIgnore ? "acknowledgement" : "controlled_core_test"
  };
}

function withExplicitRelations(output, sourceEvents) {
  const source = sourceEvents[0];
  return migrateFakePlannerOutput({
    ...output,
    contextRelationCandidates: output.tasks.map((item) => ({
      candidateIndex: item.candidateIndex,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [{ eventId: source.eventId, messageRef: source.messageRef || "", startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }]
    }))
  });
}

function memory() {
  const states = new Map();
  const messages = [];
  return {
    messages,
    getConversationState: (propertyId, channelId, userId) => states.get(`${propertyId}:${channelId}:${userId}`) || null,
    setConversationState: (propertyId, channelId, userId, value) => states.set(`${propertyId}:${channelId}:${userId}`, value),
    appendMessageLog: (_propertyId, value) => { messages.push(value); return { ...value, reviewId: value.needsReview ? `review-${messages.length}` : "" }; },
    updateMessageEvent: (_propertyId, _channelId, _eventId, value) => { messages.push(value); return value; }
  };
}

function createEngine(plannerOutput, counters = {}) {
  const persistence = memory();
  const engine = new ConversationEngineV2({
    planner: { classify: async ({ sourceEvents }) => {
      counters.planner = (counters.planner || 0) + 1;
      return withExplicitRelations(plannerOutput, sourceEvents);
    } },
    composer: { compose: async () => { counters.composer = (counters.composer || 0) + 1; return null; } },
    persistence,
    getProperty: () => property,
    availabilityResolver: (query) => {
      counters.availability = (counters.availability || 0) + 1;
      const rooms = property.rooms.filter((room) => query.roomType === "all" || room.id === query.roomType);
      return { ...query, availabilityReliable: true, rooms };
    },
    availableDatesResolver: () => ({ status: "answered", dates: [], source: "test" }),
    listPriceOverrides: () => [],
    now: () => new Date("2026-07-22T02:00:00.000Z")
  });
  return { engine, persistence };
}

async function process(engine, eventId, messageText) {
  return engine.process({
    customerId: property.propertyId,
    channelId: "test-line",
    lineUserId: `guest-${eventId}`,
    eventId,
    eventTimestamp: Date.parse("2026-07-22T10:00:00+08:00"),
    messageText
  });
}

async function main() {
  const catalog = buildPropertyCatalog(property);
  const genericShape = task({ taskId: "generic", type: "availability", sourceText: "generic lodging availability", category: "room", rawText: "unresolved lodging inventory" });
  const normalizedGeneric = applyPlannerSemanticContract(plan([genericShape]), { catalog });
  assert.equal(normalizedGeneric.tasks[0].entity.category, "other");
  assert.equal(normalizedGeneric.tasks[0].entity.rawText, "");
  assert.equal(normalizedGeneric.tasks[0].entity.canonicalCandidate, null);

  for (const specific of [
    task({ taskId: "double", type: "availability", sourceText: "有雙人房嗎", category: "room", rawText: "雙人房" }),
    task({ taskId: "room-number", type: "availability", sourceText: "302 有空嗎", category: "room", rawText: "302" })
  ]) {
    const retained = applyPlannerSemanticContract(plan([specific]), { catalog });
    assert.equal(retained.tasks[0].entity.category, "room");
    assert.equal(retained.tasks[0].entity.rawText, specific.entity.rawText);
  }

  const multiTasks = [
    task({ taskId: "singing", type: "amenity", sourceText: "有唱歌嗎", category: "amenity", rawText: "唱歌", canonicalCandidate: "singing" }),
    task({ taskId: "pool", type: "amenity", sourceText: "有戲水池嗎", category: "amenity", rawText: "戲水池", canonicalCandidate: "splash_pool" }),
    task({ taskId: "parking", type: "amenity", sourceText: "有車位嗎", category: "amenity", rawText: "車位", canonicalCandidate: "parking" }),
    task({ taskId: "availability", type: "availability", sourceText: "7/23 還有房嗎", category: "room", rawText: "房" })
  ];
  const multiCounters = {};
  const multiRuntime = createEngine(plan(multiTasks, { dateText: "7/23", dateKind: "absolute" }), multiCounters);
  const multi = await process(multiRuntime.engine, "multi", "有唱歌嗎？有戲水池嗎？有車位嗎？7/23 還有房嗎？");
  assert.equal(multiCounters.availability, 1);
  assert.equal(multi.taskResults.length, 4);
  assert.deepEqual(multi.taskResults.map((item) => item.status), ["answered", "answered", "answered", "answered"]);

  const singleCounters = {};
  const singleRuntime = createEngine(plan([multiTasks[3]], { dateText: "7/23", dateKind: "absolute" }), singleCounters);
  const single = await process(singleRuntime.engine, "single", "7/23 還有房嗎？");
  assert.equal(singleCounters.availability, 1);
  assert.deepEqual(multi.taskResults[3].facts.availableInventory, single.taskResults[0].facts.availableInventory);

  for (const [eventId, sourceText] of [["empty", "有空房嗎"], ["tonight", "今晚可以住嗎"]]) {
    const counters = {};
    const runtime = createEngine(plan([
      task({ taskId: eventId, type: "availability", sourceText, category: "room", rawText: "unresolved generic inventory" })
    ], { dateText: eventId === "tonight" ? "今晚" : "7/23", dateKind: eventId === "tonight" ? "relative" : "absolute" }), counters);
    const result = await process(runtime.engine, eventId, sourceText);
    if (eventId === "empty") {
      assert.equal(counters.availability || 0, 0, "a Planner temporal span absent from the guest message must not reach availability");
      assert.equal(result.taskResults[0].status, "needs_clarification");
    } else {
      assert.equal(counters.availability, 1);
      assert.equal(result.taskResults[0].status, "answered");
    }
  }

  const ignoreCounters = {};
  const ignoreRuntime = createEngine(plan([
    task({ taskId: "ack", type: "unknown", sourceText: "好的謝謝", category: "other", rawText: "好的謝謝" })
  ], { shouldIgnore: true, relation: "acknowledgement" }), ignoreCounters);
  const ignored = await process(ignoreRuntime.engine, "ignore", "好的謝謝");
  assert.equal(ignored.shouldReply, false);
  assert.equal(ignored.noReply, true);
  assert.equal(ignoreCounters.availability || 0, 0);
  assert.equal(ignoreCounters.composer || 0, 0);

  for (const [eventId, messageText] of [["punctuation-only", "！？…"], ["symbol-only", "✅"]]) {
    const counters = {};
    const runtime = createEngine(plan([
      task({ taskId: eventId, type: "unknown", sourceText: messageText, category: "other", rawText: messageText })
    ]), counters);
    const result = await process(runtime.engine, eventId, messageText);
    assert.equal(result.shouldReply, false, "Unicode punctuation or symbols without substantive text must not enter handoff");
    assert.equal(result.noReply, true);
    assert.equal(result.reviewCount, 0);
    assert.equal(counters.availability || 0, 0);
    assert.equal(counters.composer || 0, 0);
    assert.equal(counters.planner, 1, "punctuation normalization must not add a Planner or repair call");
  }

  const malformedPunctuationPlan = plan([
    task({ taskId: "unknown_0", type: "unknown", sourceText: "？", category: "other", rawText: "" })
  ]);
  malformedPunctuationPlan.tasks[0].detailIntent = "missing_information";
  malformedPunctuationPlan.missingInformation = ["Please describe the question."];
  const malformedPunctuationRuntime = createEngine(malformedPunctuationPlan);
  const malformedPunctuation = await process(malformedPunctuationRuntime.engine, "malformed-punctuation", "？");
  assert.equal(malformedPunctuation.shouldReply, false, "pure Unicode punctuation must not become a handoff when the Planner candidate is structurally invalid");
  assert.equal(malformedPunctuation.noReply, true);
  assert.equal(malformedPunctuation.finalDecision.reasonCode, "no_reply_gate_hit");
  const substantiveUnknownRuntime = createEngine(plan([
    task({ taskId: "substantive-unknown", type: "unknown", sourceText: "Price?", category: "other", rawText: "Price?" })
  ]));
  const substantiveUnknown = await process(substantiveUnknownRuntime.engine, "substantive-unknown", "Price?");
  assert.equal(substantiveUnknown.shouldReply, true, "letters or numbers must remain Planner-controlled substantive input");

  const mixedCounters = {};
  const mixedRuntime = createEngine(plan([
    task({ taskId: "availability", type: "availability", sourceText: "明天有房嗎", category: "room", rawText: "unresolved lodging inventory" })
  ], { shouldIgnore: true, relation: "acknowledgement", dateText: "明天", dateKind: "relative" }), mixedCounters);
  const mixed = await process(mixedRuntime.engine, "mixed", "好的謝謝，那明天有房嗎？");
  assert.equal(mixed.shouldReply, true);
  assert.equal(mixedCounters.availability, 1);

  const partialCounters = {};
  const partialRuntime = createEngine(plan([
    task({ taskId: "unknown", type: "unknown", sourceText: "未提供的服務", category: "other", rawText: "未提供的服務" }),
    task({ taskId: "parking", type: "amenity", sourceText: "有車位嗎", category: "amenity", rawText: "車位", canonicalCandidate: "parking" })
  ]), partialCounters);
  const partial = await process(partialRuntime.engine, "partial", "未提供的服務？有車位嗎？");
  assert.deepEqual(partial.taskResults.map((item) => item.status), ["needs_human", "answered"]);
  assert.match(partial.replyText, /提供停車位/);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "controlled-core-line-"));
  const secret = "controlled-core-secret";
  const replies = [];
  const providers = { kind: "json", ...createJsonProviders({
    dataFile: path.join(temp, "store.json"),
    seedFile: path.resolve(__dirname, "../fixtures/seed.json")
  }) };
  const binding = attachPropertyScopedLineBinding({
    providers,
    propertyId: "demo_homestay_a",
    channelSecret: secret,
    channelAccessToken: "controlled-core-token"
  });
  const app = createApp({
    providers,
    lineBindingEnv: binding.lineBindingEnv,
    conversationDebounceMs: 1,
    conversationPlannerV2: { classify: async ({ sourceEvents }) => withExplicitRelations(plan([
      task({ taskId: "ack", type: "unknown", sourceText: "好的謝謝", category: "other", rawText: "好的謝謝" })
    ], { shouldIgnore: true, relation: "acknowledgement" }), sourceEvents) },
    lineReplyClientFactory: () => ({ replyMessageWithHttpInfo: async (body) => { replies.push(body); return { httpResponse: { status: 200 } }; } })
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    const payload = JSON.stringify({ destination: "line", events: [{ type: "message", webhookEventId: "ignore-line", replyToken: "reply-token", timestamp: 1, source: { userId: "guest" }, message: { type: "text", id: "m1", text: "好的謝謝" } }] });
    const response = await binding.post(running.url, payload);
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(replies.length, 0);
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log("first-version controlled core: PASS");
}

async function run(mainFunction = main) {
  try {
    await mainFunction();
  } catch (error) {
    console.error(error.stack || error);
    globalThis.process.exitCode = 1;
  }
}

if (require.main === module) void run();

module.exports = { run };
