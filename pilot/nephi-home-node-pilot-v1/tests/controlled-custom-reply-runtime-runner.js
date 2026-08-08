"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const NOW = () => new Date("2026-07-30T04:00:00.000Z");
const EVENT_TIMESTAMP = Date.parse("2026-07-30T12:00:00+08:00");
const EMPTY_STAY = {
  dateExpression: { rawText: "", kind: "none", anchor: "none" },
  checkInCandidate: null,
  checkOutCandidate: null,
  nightsCandidate: null,
  guestCountCandidate: null
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function property(propertyId) {
  return {
    propertyId,
    displayName: propertyId,
    timezone: "Asia/Taipei",
    rooms: [{ id: `${propertyId}_room`, name: `${propertyId} room`, capacity: 2, enabled: true }],
    businessProfile: { googleMapsUrl: `https://maps.google.com/?q=${propertyId}` },
    propertyFacts: [
      { canonicalId: "parking", category: "amenity", status: "provided", publicText: `${propertyId} parking fact.` },
      { canonicalId: "bbq", category: "amenity", status: "provided", publicText: `${propertyId} bbq fact.` }
    ],
    semanticCatalog: {
      aliases: {
        parking: ["車位"],
        bbq: ["烤肉"],
        location: ["民宿位置"]
      },
      amenities: []
    },
    commonAnswers: {}
  };
}
function task(taskId, type, sourceText, category, canonicalCandidate, candidateIndex, stayCandidate = null) {
  return {
    candidateIndex,
    taskId,
    type,
    sourceText,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: Boolean(stayCandidate),
    entity: { category, rawText: canonicalCandidate ? sourceText : "", canonicalCandidate, confidence: 0.99 },
    stayCandidate,
    confidence: 0.99
  };
}
function plan(tasks, sourceEvent) {
  return migrateFakePlannerOutput({
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: clone(EMPTY_STAY),
    tasks,
    contextRelationCandidates: tasks.map((item) => {
      const startOffset = sourceEvent.messageText.indexOf(item.sourceText);
      return {
        candidateIndex: item.candidateIndex,
        kind: "new_request",
        candidateRequestCycleRefs: [],
        evidenceRefs: [{ eventId: sourceEvent.eventId, messageRef: "", startOffset, endOffset: startOffset + item.sourceText.length, quote: item.sourceText }]
      };
    }),
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "controlled_custom_reply_test"
  });
}
function persistence() {
  const states = new Map();
  return {
    getConversationState: (a, b, c) => states.get(`${a}:${b}:${c}`) || null,
    setConversationState: (a, b, c, value) => states.set(`${a}:${b}:${c}`, clone(value)),
    appendMessageLog: (propertyId, value) => ({ ...value, customerId: propertyId, reviewId: value.needsReview ? `review-${value.eventId}` : "" })
  };
}
async function run({ currentProperty, message, tasks, rules }) {
  const engine = new ConversationEngineV2({
    planner: { classify: async ({ sourceEvents }) => plan(tasks, sourceEvents[0]) },
    composer: null,
    persistence: persistence(),
    getProperty: (propertyId) => propertyId === currentProperty.propertyId ? currentProperty : null,
    availabilityResolver: (query) => ({ customerId: query.customerId, checkIn: query.checkIn, checkOut: query.checkOut, availabilityReliable: true, rooms: [] }),
    availableDatesResolver: () => ({ status: "answered", dates: [], source: "availability_provider" }),
    listPriceOverrides: () => [],
    listCustomReplies: (propertyId) => rules.filter((rule) => rule.propertyId === propertyId),
    now: NOW
  });
  return engine.process({
    customerId: currentProperty.propertyId,
    channelId: `channel-${Math.random()}`,
    lineUserId: `user-${Math.random()}`,
    eventId: `event-${Math.random()}`,
    eventTimestamp: EVENT_TIMESTAMP,
    messageText: message
  });
}

(async () => {
  const alpha = property("property_alpha");
  const rule = {
    ruleId: "rule-alpha-booking",
    propertyId: "property_alpha",
    name: "九月公告",
    topic: "booking_open",
    scope: "all",
    roomTypeId: "",
    stayStartDate: "2026-09-01",
    stayEndDate: "2026-09-30",
    effectiveStartDate: "2026-07-01",
    effectiveEndDate: "2026-09-30",
    approvedReply: "9 月住房目前尚未開放預訂，開放時間會另行公告。",
    enabled: true
  };
  const stay = {
    dateExpression: { rawText: "9月10日", kind: "absolute", anchor: "none" },
    checkInCandidate: "2026-09-10",
    checkOutCandidate: "2026-09-11",
    nightsCandidate: 1,
    guestCountCandidate: null
  };
  const mixed = await run({
    currentProperty: alpha,
    message: "9月10日可以訂嗎？有車位嗎？",
    tasks: [
      task("booking", "availability", "9月10日可以訂嗎？", "other", null, 0, stay),
      task("parking", "amenity", "有車位嗎？", "amenity", "parking", 1)
    ],
    rules: [rule]
  });
  assert.equal(mixed.finalDecision.action, "reply");
  assert.equal(mixed.taskResults.length, 2);
  assert.equal(mixed.taskResults[0].status, "answered");
  assert.equal(mixed.taskResults[0].facts.customReply, rule.approvedReply);
  assert.equal(mixed.taskResults[0].facts.customReplySource, "operator_approved_rule");
  assert.equal(mixed.taskResults[1].facts.source, "property_catalog");
  assert.equal(mixed.taskResults[1].facts.answer, "property_alpha parking fact.");
  assert.match(mixed.replyText, /9 月住房目前尚未開放預訂/);
  assert.match(mixed.replyText, /property_alpha parking fact/);

  const location = await run({
    currentProperty: alpha,
    message: "民宿在哪裡",
    tasks: [task("location", "property_fact", "民宿在哪裡", "transport", "location", 0)],
    rules: [rule]
  });
  assert.equal(location.taskResults[0].facts.source, "property_catalog");
  assert.match(location.replyText, /https:\/\/maps\.google\.com\/\?q=property_alpha/);
  assert.doesNotMatch(location.replyText, /尚未開放預訂/);

  const bbq = await run({
    currentProperty: alpha,
    message: "可以烤肉嗎",
    tasks: [task("bbq", "amenity", "可以烤肉嗎", "amenity", "bbq", 0)],
    rules: [rule]
  });
  assert.equal(bbq.taskResults[0].facts.source, "property_catalog");
  assert.equal(bbq.replyText, "property_alpha bbq fact.");

  const beta = await run({
    currentProperty: property("property_beta"),
    message: "9月10日可以訂嗎？",
    tasks: [task("booking", "availability", "9月10日可以訂嗎？", "other", null, 0, stay)],
    rules: [rule]
  });
  assert.doesNotMatch(beta.replyText, /尚未開放預訂/, "Alpha rule must never enter Beta reply");
  assert.equal(beta.taskResults[0].facts.customReply, undefined);

  console.log(JSON.stringify({ suite: "controlled-custom-reply-runtime", pass: true, assertions: 16 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
