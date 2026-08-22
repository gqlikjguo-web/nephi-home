"use strict";

const assert = require("node:assert/strict");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");

const property = {
  propertyId: "data_mover_property",
  displayName: "通用旅宿",
  timezone: "Asia/Taipei",
  currency: "TWD",
  businessProfile: { publicSlug: "genericlodge" },
  rooms: [
    { id: "room_double", name: "標準雙人房", type: "雙人房", capacity: 2, enabled: true, mondayThursdayPrice: 2200, fridayPrice: 2400, saturdayHolidayPrice: 2800, sundayPrice: 2300 },
    { id: "bundle_all", name: "全館包棟", inventoryType: "bundle", capacity: 8, enabled: true, memberRoomIds: ["room_double"], mondayThursdayPrice: 8800, fridayPrice: 9600, saturdayHolidayPrice: 10800, sundayPrice: 9200 }
  ],
  commonAnswers: {
    bbqRule: "可於指定區域使用烤肉設備，使用後請清潔復原。",
    priceRule: "住宿價格依入住日期與住宿產品計算。"
  },
  propertyFacts: [
    { canonicalId: "splash_pool", category: "amenity", publicName: "戲水池", status: "available", publicText: "戲水池開放時間與使用限制依後台公告。", appliesTo: "whole_property" }
  ],
  semanticCatalog: {
    aliases: {
      room_double: ["雙人房"],
      bundle_all: ["包棟"],
      bbq: ["烤肉"],
      splash_pool: ["泳池", "戲水池"]
    }
  }
};

const emptyStay = () => ({
  dateExpression: { rawText: "", kind: "none", anchor: "none" },
  checkInCandidate: null,
  checkOutCandidate: null,
  nightsCandidate: null,
  guestCountCandidate: null
});

function task({ candidateIndex, taskId, type, sourceText, category = "other", canonicalCandidate = null, detailIntent = "general", requestedOutputs, stayCandidate = null }) {
  return {
    candidateIndex,
    taskId,
    type,
    sourceText,
    detailIntent,
    requestedOutputs: requestedOutputs || (["price", "total_price"].includes(type) ? [type] : type.includes("availability") ? ["availability"] : ["answer"]),
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: ["price", "total_price", "availability", "bundle_availability", "room_options"].includes(type),
    entity: { category, rawText: canonicalCandidate ? sourceText : "", canonicalCandidate, confidence: 1 },
    stayCandidate,
    confidence: 1
  };
}

function relationFor(messageText, item) {
  const startOffset = messageText.indexOf(item.sourceText);
  assert.notEqual(startOffset, -1, "task source must exist in the current message");
  return {
    candidateIndex: item.candidateIndex,
    kind: "new_request",
    candidateRequestCycleRefs: [],
    evidenceRefs: [{ eventId: "event", messageRef: "message", startOffset, endOffset: startOffset + item.sourceText.length, quote: item.sourceText }]
  };
}

function rawPlan(messageText, tasks, stay = emptyStay(), { shouldIgnore = false, discourse = "new_request" } = {}) {
  return {
    schemaVersion: 2,
    discourse: { relation: discourse, confidence: 1 },
    stateOperations: [],
    stay,
    tasks,
    contextRelationCandidates: tasks.map((item) => relationFor(messageText, item)),
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore,
    reason: "first_version_data_mover"
  };
}

function persistence() {
  const states = new Map();
  return {
    getConversationState: (propertyId, channelId, lineUserId) => states.get(`${propertyId}:${channelId}:${lineUserId}`) || null,
    setConversationState: (propertyId, channelId, lineUserId, value) => states.set(`${propertyId}:${channelId}:${lineUserId}`, value),
    appendMessageLog: (_propertyId, value) => ({ ...value, reviewId: value.needsReview ? "review" : "" }),
    updateMessageEvent: (_propertyId, _channelId, _eventId, value) => value
  };
}

function engineFor(output, counters = {}) {
  return new ConversationEngineV2({
    planner: { classify: async () => { counters.planner = (counters.planner || 0) + 1; return output; } },
    composer: { compose: async () => { counters.openAiComposer = (counters.openAiComposer || 0) + 1; throw new Error("OpenAI composer must be unreachable"); } },
    persistence: persistence(),
    getProperty: () => property,
    availabilityResolver: (query) => {
      counters.availability = (counters.availability || 0) + 1;
      const rooms = property.rooms.filter((room) => query.roomType === "all" || room.id === query.roomType);
      return { ...query, availabilityReliable: true, rooms };
    },
    availableDatesResolver: () => ({ status: "answered", dates: [], source: "formal_availability" }),
    listPriceOverrides: () => [],
    listDatePriceClassifications: () => [],
    listCustomReplies: () => [],
    publicBaseUrl: "https://guest.example",
    now: () => new Date("2026-08-22T02:00:00.000Z")
  });
}

async function process(output, messageText, eventId, counters = {}) {
  const engine = engineFor(output, counters);
  return engine.process({
    customerId: property.propertyId,
    channelId: "test-channel",
    lineUserId: `guest-${eventId}`,
    eventId,
    messageRef: "message",
    eventTimestamp: Date.parse("2026-08-22T10:00:00+08:00"),
    messageText,
    sourceEvents: [{ eventId: "event", messageRef: "message", messageText }]
  });
}

async function providerSchemaContract() {
  let requestBody;
  const messageText = "有雙人房嗎";
  const output = rawPlan(messageText, [task({ candidateIndex: 0, taskId: "availability", type: "availability", sourceText: messageText, category: "room", canonicalCandidate: "room_double", stayCandidate: emptyStay() })]);
  const planner = new TestOnlyOpenAiConversationPlanner({
    apiKey: "test-key",
    model: "test-model",
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ output_text: JSON.stringify(output) }) };
    }
  });
  const result = await planner.classify({
    currentMessage: messageText,
    currentMessages: [messageText],
    sourceEvents: [{ eventId: "event", messageRef: "message", messageText }],
    eventTimestamp: Date.parse("2026-08-22T10:00:00+08:00"),
    catalog: { propertyId: property.propertyId, rooms: [{ canonicalId: "room_double", category: "room" }], amenities: [], policies: [], faqs: [], propertyFacts: [], transportFacts: [] },
    contextSnapshot: { scope: {}, cycles: [] }
  });
  assert.equal(Object.hasOwn(requestBody.text.format.schema.properties, "semanticCandidates"), false, "the provider schema must not request a semantic ledger");
  assert.equal(requestBody.input.some((item) => JSON.stringify(item).includes("coverageRepair")), false, "the primary call must not contain a repair protocol");
  assert.equal(Object.hasOwn(result, "semanticCandidates"), false, "the provider returns only task/relation understanding for Engine compilation");
  assert.equal(result[Symbol.for("junzan.plannerProviderDiagnostic")].providerAttemptCount, 1);
}

async function providerDefersNormalizableEngineContracts() {
  const cases = [
    { name: "rg-044-short-meaningful-nights", messageText: "兩晚", type: "unknown", detailIntent: "missing_information", requestedOutputs: ["answer"], nightsCandidate: 2 },
    { name: "rg-046-no-reply-thanks", messageText: "謝謝", shouldIgnore: true, discourse: "acknowledgement", requestedOutputs: [] },
    { name: "rg-047-no-reply-good", messageText: "好", shouldIgnore: true, discourse: "acknowledgement", requestedOutputs: [] },
    { name: "rg-048-no-reply-emoji", messageText: "👌", shouldIgnore: true, discourse: "acknowledgement", requestedOutputs: [] },
    { name: "rg-049-punctuation", messageText: "？", shouldIgnore: true, requestedOutputs: ["answer"] },
    { name: "rgs-017-two-days-arrangement", messageText: "我們想住兩天怎麼安排", type: "booking_request", detailIntent: "missing_information", requestedOutputs: ["answer"], nightsCandidate: 2 },
    { name: "new-019", messageText: "8/20住一晚，2個人", type: "booking_request", requestedOutputs: ["answer"], nightsCandidate: 1, guestCountCandidate: 2 },
    { name: "new-034", messageText: "哈哈哈好喔謝啦", shouldIgnore: true, discourse: "acknowledgement", requestedOutputs: ["answer"] },
    { name: "new-035", messageText: "？？？", shouldIgnore: true, requestedOutputs: [] },
    { name: "hf-06-run-1", messageText: "不用了，謝謝", shouldIgnore: true, discourse: "acknowledgement", relationKind: "end_existing", requestedOutputs: [] },
    { name: "hf-06-run-2", messageText: "不用了，謝謝", shouldIgnore: true, discourse: "acknowledgement", relationKind: "end_existing", requestedOutputs: [] },
    { name: "hf-06-run-3", messageText: "不用了，謝謝", shouldIgnore: true, discourse: "acknowledgement", relationKind: "end_existing", requestedOutputs: [] }
  ];
  const results = await Promise.allSettled(cases.map(async (fixture) => {
    const stay = {
      ...emptyStay(),
      nightsCandidate: fixture.nightsCandidate || null,
      guestCountCandidate: fixture.guestCountCandidate || null
    };
    const output = rawPlan(fixture.messageText, [task({
      candidateIndex: 0,
      taskId: fixture.name,
      type: fixture.type || "unknown",
      sourceText: fixture.messageText,
      detailIntent: fixture.detailIntent || "general",
      requestedOutputs: fixture.requestedOutputs,
      stayCandidate: fixture.nightsCandidate || fixture.guestCountCandidate ? stay : null
    })], stay, { shouldIgnore: fixture.shouldIgnore, discourse: fixture.discourse });
    output.contextRelationCandidates[0].kind = fixture.relationKind || "new_request";
    const planner = new TestOnlyOpenAiConversationPlanner({
      apiKey: "test-key",
      model: "test-model",
      retryDelayMs: 0,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ output_text: JSON.stringify(output) })
      })
    });
    const result = await planner.classify({
      currentMessage: fixture.messageText,
      currentMessages: [fixture.messageText],
      sourceEvents: [{ eventId: "event", messageRef: "message", messageText: fixture.messageText }],
      eventTimestamp: Date.parse("2026-08-22T10:00:00+08:00"),
      catalog: { propertyId: property.propertyId, rooms: [], amenities: [], policies: [], faqs: [], propertyFacts: [], transportFacts: [] },
      contextSnapshot: { scope: {}, cycles: [] }
    });
    assert.equal(Array.isArray(result.tasks), true, `${fixture.name}: provider must return parsed tasks for Engine normalization`);
  }));
  const rejected = results.flatMap((result, index) => result.status === "rejected"
    ? [`${cases[index].name}:${result.reason && result.reason.code || result.reason}`]
    : []);
  assert.deepEqual(rejected, [], `provider must defer all 12 normalizable Engine contracts: ${rejected.join(", ")}`);
}

async function main() {
  await providerSchemaContract();
  await providerDefersNormalizableEngineContracts();

  const multiMessage = "8/29可包棟嗎？有烤肉嗎？有泳池嗎？";
  const datedStay = { dateExpression: { rawText: "8/29", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-29", checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null };
  const multiTasks = [
    task({ candidateIndex: 0, taskId: "bundle", type: "bundle_availability", sourceText: "8/29可包棟嗎", category: "bundle", canonicalCandidate: "bundle_all", stayCandidate: datedStay }),
    task({ candidateIndex: 1, taskId: "bbq", type: "policy", sourceText: "有烤肉嗎", category: "policy", canonicalCandidate: "bbq" }),
    task({ candidateIndex: 2, taskId: "pool", type: "amenity", sourceText: "有泳池嗎", category: "amenity", canonicalCandidate: "splash_pool" })
  ];
  const multiCounters = {};
  const multi = await process(rawPlan(multiMessage, multiTasks, datedStay), multiMessage, "multi", multiCounters);
  assert.equal(multi.taskResults.length, 3);
  assert.equal(multi.taskResults.every((item) => item.status === "answered"), true);
  assert.match(multi.replyText, /全館包棟/);
  assert.match(multi.replyText, /烤肉設備/);
  assert.match(multi.replyText, /戲水池開放時間/);
  assert.equal(multiCounters.openAiComposer || 0, 0, "customer-visible wording must use only the deterministic composer");

  const feeMessage = "可以烤肉嗎？費用多少？";
  const feeTasks = [
    task({ candidateIndex: 0, taskId: "bbq-usage", type: "policy", sourceText: "可以烤肉嗎", category: "policy", canonicalCandidate: "bbq" }),
    task({ candidateIndex: 1, taskId: "bbq-fee", type: "policy", sourceText: "費用多少", category: "policy", canonicalCandidate: "bbq", detailIntent: "fee", requestedOutputs: ["fee"] })
  ];
  const fee = await process(rawPlan(feeMessage, feeTasks), feeMessage, "fee");
  assert.equal((fee.replyText.match(/可於指定區域使用烤肉設備/g) || []).length, 1);
  assert.equal(fee.finalDecision.action, "reply");

  const noDateMessage = "有雙人房嗎？";
  const noDate = await process(rawPlan(noDateMessage, [task({ candidateIndex: 0, taskId: "no-date", type: "availability", sourceText: "有雙人房嗎", category: "room", canonicalCandidate: "room_double", stayCandidate: emptyStay() })]), noDateMessage, "no-date");
  assert.equal(noDate.finalDecision.action, "clarification");
  assert.match(noDate.replyText, /請提供入住日期/);
  assert.match(noDate.replyText, /https:\/\/guest\.example\/genericlodge/);

  const priceMessage = "8/25一晚多少錢？";
  const priceStay = { dateExpression: { rawText: "8/25", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-25", checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null };
  const price = await process(rawPlan(priceMessage, [task({ candidateIndex: 0, taskId: "all-price", type: "price", sourceText: "8/25一晚多少錢", stayCandidate: priceStay, requestedOutputs: ["price"] })], priceStay), priceMessage, "price");
  assert.equal(price.finalDecision.action, "reply");
  assert.match(price.replyText, /標準雙人房/);
  assert.match(price.replyText, /全館包棟/);

  const lodgingPriceCollisionFailures = [];
  for (const [caseId, messageText] of [
    ["rgs-007-fee", "請問費用"],
    ["rgs-008-price-polite", "請問價錢"],
    ["rgs-009-price-how-much", "價格多少"],
    ["rgs-012-price-punctuation", "價格？"],
    ["new-024-turn-1", "價格？"]
  ]) {
    const result = await process(rawPlan(messageText, [task({
      candidateIndex: 0,
      taskId: caseId,
      type: "price",
      sourceText: messageText,
      category: "other",
      canonicalCandidate: "price",
      requestedOutputs: ["price"],
      stayCandidate: emptyStay()
    })]), messageText, caseId);
    if (result.finalDecision.action !== "clarification"
      || result.replyText !== "請提供入住日期。\n查房連結：https://guest.example/genericlodge") {
      lodgingPriceCollisionFailures.push(`${caseId}:action=${result.finalDecision.action}:reply=${result.replyText}`);
    }
  }

  const pastPriceMessage = "請問5月1-3\n兩個人住兩晚的價格大概多少呢";
  const pastPriceStay = {
    dateExpression: { rawText: "5月1-3", kind: "range", anchor: "message_time" },
    checkInCandidate: "5月1日",
    checkOutCandidate: "5月3日",
    nightsCandidate: 2,
    guestCountCandidate: 2
  };
  const pastCounters = {};
  const pastPrice = await process(rawPlan(pastPriceMessage, [task({
    candidateIndex: 0,
    taskId: "rg-003-price-nights",
    type: "price",
    sourceText: pastPriceMessage,
    category: "other",
    canonicalCandidate: "price",
    requestedOutputs: ["price"],
    stayCandidate: pastPriceStay
  })], pastPriceStay), pastPriceMessage, "rg-003-price-nights", pastCounters);
  if (pastPrice.finalDecision.action !== "clarification"
    || pastPrice.finalDecision.reasonCode !== "past_date"
    || (pastCounters.availability || 0) !== 0) {
    lodgingPriceCollisionFailures.push(`rg-003-price-nights:action=${pastPrice.finalDecision.action}:reason=${pastPrice.finalDecision.reasonCode}:resolverCalls=${pastCounters.availability || 0}`);
  }
  assert.deepEqual(lodgingPriceCollisionFailures, [], `lodging price identity collision targets must retain their existing lodging path:\n${lodgingPriceCollisionFailures.join("\n")}`);

  for (const [eventId, rawText, kind] of [["today", "今天", "relative"], ["tomorrow", "明天", "relative"], ["weekday", "下週三", "weekday"]]) {
    const messageText = `${rawText}有房嗎？`;
    const stay = { dateExpression: { rawText, kind, anchor: "message_time" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null };
    const result = await process(rawPlan(messageText, [task({ candidateIndex: 0, taskId: eventId, type: "availability", sourceText: `${rawText}有房嗎`, stayCandidate: stay })], stay), messageText, eventId);
    assert.equal(result.finalDecision.action, "reply", `${rawText} must resolve only through the existing Temporal authority`);
  }

  console.log("first-version data mover: PASS");
}

main().catch((error) => {
  console.error(error.stack || error);
  globalThis.process.exitCode = 1;
});
