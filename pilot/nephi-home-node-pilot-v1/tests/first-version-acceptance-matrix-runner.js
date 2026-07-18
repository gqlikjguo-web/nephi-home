"use strict";

/*
 * First-version acceptance fixture.  It deliberately has no production IDs:
 * the Nephi messages below are acceptance input only.  Facts, inventory and
 * policies all remain data on the two independently seeded properties.
 */
const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");

const EVENT_TIME = Date.parse("2026-07-17T10:00:00+08:00");

const properties = [
  {
    propertyId: "fixture_nephi", displayName: "尼腓驗收旅宿", timezone: "Asia/Taipei", currency: "TWD",
    rooms: [
      { id: "nephi_sky_double", name: "晴空雙人房", type: "雙人房", capacity: 2, enabled: true },
      { id: "nephi_hill_quad", name: "山景四人房", type: "四人房", capacity: 4, enabled: true },
      { id: "nephi_house", name: "星光包棟", type: "包棟", inventoryType: "bundle", capacity: 12, enabled: true }
    ],
    commonAnswers: {
      parkingRule: "提供一個免費車位", bbqRule: "可使用戶外烤肉區，請先預約", checkInTime: "15:00 後入住",
      checkOutTime: "11:00 前退房", selfCheckInRule: "入住當日會提供密碼鎖資訊", cancellationRule: "依訂房確認內容辦理取消與訂金"
    },
    faqs: [
      { knowledgeKey: "pool", question: "有戲水池嗎", answer: "有季節性戲水池" },
      { knowledgeKey: "ktv", question: "可以唱歌嗎", answer: "設有 KTV 唱歌設備" },
      { knowledgeKey: "children", question: "可以帶小孩嗎", answer: "歡迎親子入住，提供嬰兒澡盆" },
      { knowledgeKey: "kitchen", question: "可以開伙嗎", answer: "可使用廚房，請維持清潔" },
      { knowledgeKey: "address", question: "地址與交通", answer: "地址與交通資訊會在訂房確認後提供" }
    ],
    semanticCatalog: { aliases: {
      nephi_sky_double: ["301", "雙人房", "兩人房"], nephi_hill_quad: ["401", "四人房", "家庭房"], nephi_house: ["包棟", "整棟"],
      parking: ["車位", "停車"], bbq: ["烤肉", "BBQ"], check_in: ["入住", "check in"], self_checkin: ["密碼", "密碼鎖"],
      pool: ["戲水池", "游泳池"], ktv: ["唱歌", "KTV"], children: ["小孩", "嬰兒用品"], kitchen: ["開伙", "廚房"], cancellation: ["取消", "訂金"]
    }, amenities: [] }
  },
  {
    propertyId: "fixture_orchid", displayName: "蘭庭驗收旅宿", timezone: "Asia/Taipei", currency: "TWD",
    rooms: [
      { id: "orchid_couple", name: "蘭庭雙人套房", type: "雙人房", capacity: 2, enabled: true },
      { id: "orchid_family", name: "蘭庭家庭房", type: "四人房", capacity: 4, enabled: true },
      { id: "orchid_villa", name: "蘭庭花園別墅", type: "包棟", inventoryType: "bundle", capacity: 10, enabled: true }
    ],
    commonAnswers: {
      parkingRule: "附近合作停車場可停車", bbqRule: "館內不提供烤肉", checkInTime: "16:00 後入住",
      checkOutTime: "10:00 前退房", cancellationRule: "取消規則以訂房確認內容為準"
    },
    faqs: [
      { knowledgeKey: "pool", question: "有戲水池嗎", answer: "沒有戲水池" },
      { knowledgeKey: "ktv", question: "可以唱歌嗎", answer: "館內沒有 KTV" },
      { knowledgeKey: "children", question: "可以帶小孩嗎", answer: "可攜帶孩童，但未提供嬰兒用品" },
      { knowledgeKey: "kitchen", question: "可以開伙嗎", answer: "不開放廚房" },
      { knowledgeKey: "address", question: "地址與交通", answer: "鄰近車站，地址在訂房確認內" }
    ],
    semanticCatalog: { aliases: {
      orchid_couple: ["雙人房", "兩人房"], orchid_family: ["四人房", "家庭房"], orchid_villa: ["包棟", "整棟"],
      parking: ["車位", "停車"], bbq: ["烤肉", "BBQ"], check_in: ["入住", "check in"],
      pool: ["戲水池", "游泳池"], ktv: ["唱歌", "KTV"], children: ["小孩", "嬰兒用品"], kitchen: ["開伙", "廚房"], cancellation: ["取消", "訂金"]
    }, amenities: [] }
  }
];

const propertyById = new Map(properties.map((property) => [property.propertyId, property]));

function availabilityTask(id, rawText, canonicalCandidate, queryMode = "any") {
  return { taskId: id, type: queryMode === "bundle_only" ? "bundle_availability" : "availability", sourceText: rawText, requestedOutputs: ["availability"], dependsOnStayContext: true, entity: { category: "room", rawText, canonicalCandidate, confidence: 0.99 }, confidence: 0.99 };
}
function factTask(id, type, rawText, candidate) {
  return { taskId: id, type, sourceText: rawText, requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: type === "policy" ? "policy" : "amenity", rawText, canonicalCandidate: candidate, confidence: 0.99 }, confidence: 0.99 };
}
function casePlan(item) {
  const stay = item.request && item.request.checkIn ? {
    dateExpression: { rawText: item.dateText || item.request.checkIn.slice(5).replace("-", "/"), kind: "absolute", anchor: "message_time" },
    checkInCandidate: item.request.checkIn, checkOutCandidate: null, nightsCandidate: item.request.nights || 1, guestCountCandidate: item.request.guests || null
  } : { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null };
  const stateOperations = item.request && item.request.checkIn ? [
    { field: "stay.dateExpression.rawText", operation: "set", value: stay.dateExpression.rawText, sourceText: stay.dateExpression.rawText },
    { field: "stay.dateExpression.kind", operation: "set", value: "absolute", sourceText: stay.dateExpression.rawText },
    { field: "stay.dateExpression.anchor", operation: "set", value: "message_time", sourceText: stay.dateExpression.rawText },
    { field: "stay.checkInCandidate", operation: "set", value: item.request.checkIn, sourceText: stay.dateExpression.rawText },
    { field: "stay.nightsCandidate", operation: "set", value: item.request.nights || 1, sourceText: String(item.request.nights || 1) },
    ...(item.request.guests ? [{ field: "stay.guestCountCandidate", operation: "set", value: item.request.guests, sourceText: String(item.request.guests) }] : []),
    { field: "inventory.mode", operation: "set", value: item.request.queryMode || "any", sourceText: item.request.queryMode || "any" }
  ] : [];
  return {
    schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations, stay, tasks: item.tasks,
    ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "fixture_matrix"
  };
}

// `message` is acceptance data.  The planner is deterministic by design so
// this runner proves resolver and property behavior, not a particular model.
const matrix = [
  { id: "named-room", propertyId: "fixture_nephi", message: "7/18 的301可以預訂嗎？", request: { checkIn: "2026-07-18", nights: 1, guests: 2, roomType: "nephi_sky_double", queryMode: "room_only" }, tasks: [availabilityTask("availability", "301", "forged_candidate", "room_only")], result: { reliable: true, roomIds: ["nephi_sky_double"] } },
  { id: "any-room", propertyId: "fixture_nephi", message: "7/18 可以訂房嗎？", request: { checkIn: "2026-07-18", nights: 1, queryMode: "any" }, tasks: [availabilityTask("availability", "", null)], result: { reliable: true, roomIds: ["nephi_sky_double", "nephi_hill_quad", "nephi_house"] } },
  { id: "double-colloquial", propertyId: "fixture_nephi", message: "7/18 有兩人房嗎？", request: { checkIn: "2026-07-18", nights: 1, guests: 2, roomType: "nephi_sky_double", queryMode: "room_only" }, tasks: [availabilityTask("availability", "兩人房", "untrusted_id", "room_only")], result: { reliable: true, roomIds: ["nephi_sky_double"] } },
  { id: "quad-synonym", propertyId: "fixture_nephi", message: "7/18 有家庭房嗎？", request: { checkIn: "2026-07-18", nights: 1, guests: 4, roomType: "nephi_hill_quad", queryMode: "room_only" }, tasks: [availabilityTask("availability", "家庭房", null, "room_only")], result: { reliable: true, roomIds: ["nephi_hill_quad"] } },
  { id: "bundle-multi-night", propertyId: "fixture_nephi", message: "7/18 包棟住兩晚還有嗎？", request: { checkIn: "2026-07-18", nights: 2, guests: 8, roomType: "nephi_house", queryMode: "bundle_only" }, tasks: [availabilityTask("availability", "包棟", null, "bundle_only")], result: { reliable: true, roomIds: ["nephi_house"] } },
  { id: "full-day", propertyId: "fixture_nephi", message: "7/19 可以預訂嗎？", request: { checkIn: "2026-07-19", nights: 1, queryMode: "any" }, tasks: [availabilityTask("availability", "", null)], result: { reliable: true, roomIds: [] } },
  { id: "multi-question", propertyId: "fixture_nephi", message: "8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？", request: { checkIn: "2026-08-06", nights: 1, guests: 2, roomType: "nephi_sky_double", queryMode: "room_only" }, tasks: [availabilityTask("availability", "雙人房", null, "room_only"), factTask("parking", "amenity", "車位", "parking"), factTask("bbq", "policy", "烤肉", "bbq")], result: { reliable: true, roomIds: ["nephi_sky_double"] }, answers: ["提供一個免費車位", "可使用戶外烤肉區，請先預約"] },
  { id: "pool", propertyId: "fixture_nephi", message: "有戲水池嗎？", tasks: [factTask("pool", "amenity", "戲水池", "pool")], answers: ["有季節性戲水池"] },
  { id: "ktv", propertyId: "fixture_nephi", message: "可以唱歌嗎？有KTV嗎？", tasks: [factTask("ktv", "amenity", "KTV", "ktv")], answers: ["設有 KTV 唱歌設備"] },
  { id: "self-checkin", propertyId: "fixture_nephi", message: "幾點入住？怎麼拿密碼？", tasks: [factTask("checkin", "policy", "入住", "check_in"), factTask("selfcheckin", "policy", "密碼", "self_checkin")], answers: ["15:00 後入住", "入住當日會提供密碼鎖資訊"] },
  { id: "children", propertyId: "fixture_nephi", message: "可以帶小孩嗎？有嬰兒用品嗎？", tasks: [factTask("children", "amenity", "嬰兒用品", "children")], answers: ["歡迎親子入住，提供嬰兒澡盆"] },
  { id: "kitchen", propertyId: "fixture_nephi", message: "可以開伙嗎？可以烤肉嗎？", tasks: [factTask("kitchen", "amenity", "開伙", "kitchen"), factTask("bbq", "policy", "烤肉", "bbq")], answers: ["可使用廚房，請維持清潔", "可使用戶外烤肉區，請先預約"] },
  { id: "cancellation", propertyId: "fixture_nephi", message: "取消會退訂金嗎？", tasks: [factTask("cancellation", "policy", "訂金", "cancellation")], answers: ["依訂房確認內容辦理取消與訂金"] },
  { id: "missing-date", propertyId: "fixture_nephi", message: "有雙人房嗎？", tasks: [availabilityTask("availability", "雙人房", null, "room_only")], expectedStatus: "needs_clarification" },
  { id: "unreliable", propertyId: "fixture_nephi", message: "8/7 有雙人房嗎？", request: { checkIn: "2026-08-07", nights: 1, guests: 2, roomType: "nephi_sky_double", queryMode: "room_only" }, tasks: [availabilityTask("availability", "雙人房", null, "room_only")], result: { reliable: false, roomIds: [] }, expectedStatus: "needs_human" },
  { id: "isolation-orchid", propertyId: "fixture_orchid", message: "7/18 有雙人房嗎？有車位嗎？", request: { checkIn: "2026-07-18", nights: 1, guests: 2, roomType: "orchid_couple", queryMode: "room_only" }, tasks: [availabilityTask("availability", "雙人房", null, "room_only"), factTask("parking", "amenity", "車位", "parking")], result: { reliable: true, roomIds: ["orchid_couple"] }, answers: ["附近合作停車場可停車"], excludes: ["晴空雙人房", "提供一個免費車位"] },
  { id: "unknown-knowledge", propertyId: "fixture_orchid", message: "有私人碼頭嗎？", tasks: [factTask("unknown", "amenity", "私人碼頭", "private_dock")], expectedStatus: "needs_human" }
];

const availabilityTransitions = [
  { id: "admin-open-close-reflects-next-query", propertyId: "fixture_orchid", message: "8/8 有雙人房嗎？", request: { checkIn: "2026-08-08", nights: 1, guests: 2, roomType: "orchid_couple", queryMode: "room_only" }, tasks: [availabilityTask("availability", "雙人房", null, "room_only")], before: { reliable: true, roomIds: [] }, after: { reliable: true, roomIds: ["orchid_couple"] } }
];

function requestKey(request) { return JSON.stringify([request.customerId, request.checkIn, request.checkOut, request.guests || null, request.roomType || "all", request.queryMode || "any"]); }
function expectedResolverRequest(propertyId, request) {
  return { customerId: propertyId, checkIn: request.checkIn, checkOut: addDays(request.checkIn, request.nights || 1), guests: request.guests || null, roomType: request.roomType || "all", queryMode: request.queryMode || "any" };
}
function addDays(value, days) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function legacyResult(request, result) {
  const property = propertyById.get(request.customerId);
  assert.ok(property, `fixture resolver must receive a known propertyId: ${request.customerId}`);
  return { customerId: property.propertyId, homestayName: property.displayName, checkIn: request.checkIn, checkOut: request.checkOut, nightCount: Math.round((Date.parse(`${request.checkOut}T00:00:00Z`) - Date.parse(`${request.checkIn}T00:00:00Z`)) / 86400000), guests: request.guests, roomType: request.roomType, queryMode: request.queryMode, availabilityReliable: result.reliable, rooms: result.roomIds.map((id) => property.rooms.find((room) => room.id === id)), lineUrl: "" };
}
function createLegacyResolver() {
  const calls = [], responses = new Map();
  return {
    calls,
    set(request, result) { responses.set(requestKey(request), result); },
    searchAvailability(request) {
      calls.push({ ...request });
      const result = responses.get(requestKey(request));
      assert.ok(result, `legacy resolver fixture has no response for ${requestKey(request)}`);
      return legacyResult(request, result);
    }
  };
}
function createPersistence() {
  const states = new Map();
  return {
    getConversationState: (propertyId, channelId, lineUserId) => states.get(`${propertyId}:${channelId}:${lineUserId}`) || null,
    setConversationState: (propertyId, channelId, lineUserId, value) => states.set(`${propertyId}:${channelId}:${lineUserId}`, value),
    appendMessageLog: (_propertyId, value) => ({ ...value, reviewId: value.needsReview ? `review-${states.size}` : "" })
  };
}

async function runCase(engine, item, index) {
  const plannerOutput = casePlan(item);
  engine.planner = { classify: async () => plannerOutput };
  return engine.process({ customerId: item.propertyId, channelId: "matrix-channel", lineUserId: `matrix-user-${index}`, eventId: `matrix-event-${index}`, eventTimestamp: EVENT_TIME, messageText: item.message });
}

(async () => {
  const legacyResolver = createLegacyResolver();
  const expectedRequests = [];
  for (const item of matrix.filter((item) => item.result)) {
    const request = expectedResolverRequest(item.propertyId, item.request);
    legacyResolver.set(request, item.result); expectedRequests.push(request);
  }
  // Same input three times must remain deterministic and each time consult
  // current resolver facts; do not cache a planner candidate as truth.
  const repeat = matrix.find((item) => item.id === "named-room");
  for (let index = 0; index < 3; index += 1) expectedRequests.push(expectedResolverRequest(repeat.propertyId, repeat.request));

  const directAvailabilityCalls = [];
  const engine = new ConversationEngineV2({
    planner: { classify: async () => { throw new Error("planner fixture not installed"); } }, persistence: createPersistence(),
    getProperty: (propertyId) => propertyById.get(propertyId) || null,
    // This is the desired adapter dependency.  The current RED behavior is
    // that V2 ignores it and reads availability rows directly.
    availabilityResolver: (request) => legacyResolver.searchAvailability(request),
    availability: { getRows: (...args) => { directAvailabilityCalls.push(args); return []; } }, listPriceOverrides: () => [], now: () => new Date(EVENT_TIME)
  });

  const outcomes = [];
  for (const [index, item] of matrix.entries()) outcomes.push({ item, result: await runCase(engine, item, index) });
  for (let index = 0; index < 3; index += 1) outcomes.push({ item: repeat, result: await runCase(engine, repeat, matrix.length + index), repeated: true });

  for (const transition of availabilityTransitions) {
    const request = expectedResolverRequest(transition.propertyId, transition.request);
    legacyResolver.set(request, transition.before); expectedRequests.push(request);
    const before = await runCase(engine, transition, outcomes.length);
    legacyResolver.set(request, transition.after); expectedRequests.push(request);
    const after = await runCase(engine, transition, outcomes.length + 1);
    outcomes.push({ item: { ...transition, result: transition.before }, result: before }, { item: { ...transition, result: transition.after }, result: after });
  }

  // RED contract: this assertion fails on the current code because the V2
  // executor bypasses `availabilityResolver` and calls getRows itself.
  assert.deepEqual(legacyResolver.calls, expectedRequests, "V2 must adapt validated canonical requests to the legacy property-scoped availability resolver");
  assert.equal(directAvailabilityCalls.length, 0, "V2 must not bypass the legacy availability/reliability resolver with direct availability rows");

  for (const { item, result } of outcomes) {
    assert.equal(result.claimValidation.ok, true, `${item.id}: reply claims must validate`);
    const availability = result.taskResults.find((task) => task.type === "availability" || task.type === "bundle_availability");
    if (item.expectedStatus) assert.equal(availability && availability.status, item.expectedStatus, `${item.id}: deterministic boundary`);
    if (item.result && item.result.reliable) {
      assert.equal(availability && availability.status, "answered", `${item.id}: reliable resolver answer`);
      assert.deepEqual((availability.facts.availableInventory || []).map((room) => room.canonicalId), item.result.roomIds, `${item.id}: resolver inventory`);
      assert.equal(availability.facts.propertyId, item.propertyId, `${item.id}: property-scoped facts`);
    }
    for (const answer of item.answers || []) assert.ok(result.replyText.includes(answer), `${item.id}: response must contain property-backed fact`);
    for (const excluded of item.excludes || []) assert.equal(result.replyText.includes(excluded), false, `${item.id}: must not leak another property fact`);
  }

  const [before, after] = outcomes.slice(-2).map((item) => item.result.taskResults[0].facts.availableInventory.map((room) => room.canonicalId));
  assert.deepEqual(before, []);
  assert.deepEqual(after, ["orchid_couple"]);
  console.log("first-version property-scoped acceptance matrix: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
