"use strict";

const assert = require("node:assert/strict");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const {
  createNewCoreProductionTurnAdapter,
  bindProductionHistoryToCycles
} = require("../lib/new-core/production-turn-adapter");

const NOW = "2026-09-03T03:00:00.000Z";
const PROPERTY_A = Object.freeze({ propertyId: "property_a", timezone: "Asia/Taipei", rooms: [], propertyFacts: [], commonAnswers: {}, businessProfile: {} });
const PROPERTY_B = Object.freeze({ propertyId: "property_b", timezone: "Asia/Taipei", rooms: [], propertyFacts: [], commonAnswers: {}, businessProfile: {} });

function state(scope, revision = 1) {
  return createConversationStateV3({ ...scope, revision, tasks: [], createdAt: NOW, updatedAt: NOW, expiresAt: "2026-09-04T03:00:00.000Z" });
}

function result(action, nextState) {
  return {
    state: nextState,
    finalDecision: { action, reasonCode: `${action}_reason`, taskIds: [], missingFields: [], reviewRequired: action === "handoff" },
    finalResponse: { action, shouldReply: action !== "no_reply", replyText: action === "no_reply" ? "" : `${action} response` },
    traceId: "trace-from-core",
    artifacts: {
      canonicalItems: [{ requestCycleId: "cycle-answer" }],
      adapted: { taskCreations: [], canonicalTaskBindings: [] },
      executionOutcomes: []
    }
  };
}

function fixture({ executeTurn, providerConfig = { apiKey: "test-provider-key" } } = {}) {
  const stored = new Map();
  const writes = [];
  const historyCalls = [];
  const resolverCalls = [];
  const persistence = {
    getConversationState(propertyId, channelId, lineUserId) {
      return stored.get(`${propertyId}:${channelId}:${lineUserId}`) || null;
    },
    setConversationState(propertyId, channelId, lineUserId, value) {
      writes.push({ propertyId, channelId, lineUserId, value });
      stored.set(`${propertyId}:${channelId}:${lineUserId}`, value);
      return value;
    },
    listRecentMessages(propertyId, channelId, lineUserId) {
      historyCalls.push({ propertyId, channelId, lineUserId });
      return [{
        eventId: "prior-event",
        eventTimestamp: "2026-09-03T02:55:00.000Z",
        guestMessage: "prior question",
        requestCycleRefs: []
      }];
    }
  };
  const customerSettings = {
    getProperty(propertyId) { return propertyId === "property_a" ? PROPERTY_A : propertyId === "property_b" ? PROPERTY_B : null; },
    listInventoryPriceOverrides(propertyId) { resolverCalls.push({ kind: "price", propertyId }); return []; },
    listDatePriceClassifications(propertyId) { resolverCalls.push({ kind: "dates", propertyId }); return []; }
  };
  const service = {
    searchAvailability(query) { resolverCalls.push({ kind: "availability", propertyId: query.customerId }); return { customerId: query.customerId, rooms: [] }; },
    searchAvailableDates(query) { resolverCalls.push({ kind: "availableDates", propertyId: query.customerId }); return { status: "answered", dates: [] }; }
  };
  const customReplies = { list(propertyId) { resolverCalls.push({ kind: "custom", propertyId }); return []; } };
  const adapter = createNewCoreProductionTurnAdapter({
    persistence,
    customerSettings,
    service,
    customReplies,
    providerConfig,
    publicBaseUrl: "https://example.invalid",
    now: () => new Date(NOW),
    executeTurn
  });
  return { adapter, stored, writes, historyCalls, resolverCalls };
}

function input(overrides = {}) {
  return {
    customerId: "property_a",
    channelId: "line-binding:abc",
    lineUserId: "line-user-a",
    eventId: "event-current",
    eventTimestamp: NOW,
    messageText: "guest message",
    ...overrides
  };
}

(async () => {
  assert.doesNotThrow(() => fixture({
    providerConfig: {},
    executeTurn: async (args) => result("reply", state(args.scope, args.state.revision + 1))
  }), "an explicitly injected execution dependency must not require an unused OpenAI key");
  assert.throws(() => fixture({ providerConfig: {} }), /provider_api_key_required/,
    "default real execution must fail closed without an OpenAI key");
  assert.doesNotThrow(() => fixture({ providerConfig: { apiKey: "configured-production-key" } }),
    "default real execution may be constructed with a configured OpenAI key");

  const seen = [];
  const fx = fixture({ executeTurn: async (args) => {
    seen.push(args);
    args.resolver.priceOverrides();
    args.resolver.dateClassifications();
    args.resolver.customReplies();
    args.resolver.availability({ customerId: args.scope.propertyId });
    return result("reply", state(args.scope, args.state.revision + 1));
  } });
  const answer = await fx.adapter.process(input());
  assert.equal(answer.finalDecision.action, "reply");
  assert.equal(answer.finalResponse.replyText, "reply response");
  assert.deepEqual(answer.requestCycleRefs, ["cycle-answer"]);
  assert.equal(seen.length, 1, "one event must invoke exactly one new-core turn");
  assert.deepEqual(seen[0].scope, { propertyId: "property_a", channel: "line-binding:abc", userId: "line-user-a" });
  assert.equal(seen[0].property, PROPERTY_A);
  assert.equal(seen[0].input.message, "guest message");
  assert.equal(seen[0].input.sourceEvents[0].eventId, "event-current");
  assert.equal(seen[0].input.recentConversation[0].eventId, "prior-event");
  assert.equal(fx.writes.length, 1, "next ConversationStateV3 must be persisted once");
  assert.deepEqual(fx.resolverCalls.map((item) => item.propertyId), ["property_a", "property_a", "property_a", "property_a"]);

  for (const action of ["clarification", "handoff", "no_reply"]) {
    const current = fixture({ executeTurn: async (args) => result(action, state(args.scope, args.state.revision + 1)) });
    const output = await current.adapter.process(input());
    assert.equal(output.finalDecision.action, action);
    assert.equal(output.finalResponse.shouldReply, action !== "no_reply");
    assert.equal(current.writes.length, 1);
  }

  const failed = fixture({ executeTurn: async () => { const error = new Error("provider exploded"); error.code = "UNDERSTANDING_PROVIDER_FAILURE"; throw error; } });
  const safe = await failed.adapter.process(input());
  assert.equal(safe.finalDecision.action, "handoff");
  assert.equal(safe.finalDecision.reviewRequired, true);
  assert.equal(safe.finalResponse.action, "handoff");
  assert.equal(safe.finalResponse.shouldReply, true);
  assert.equal(failed.writes.length, 0, "runtime failure must not overwrite the prior state");

  const isolated = fixture({ executeTurn: async (args) => {
    assert.equal(args.scope.propertyId, "property_b");
    args.resolver.priceOverrides();
    args.resolver.customReplies();
    return result("reply", state(args.scope, args.state.revision + 1));
  } });
  await isolated.adapter.process(input({ customerId: "property_b", lineUserId: "line-user-b" }));
  assert.deepEqual(isolated.resolverCalls.map((item) => item.propertyId), ["property_b", "property_b"]);
  await assert.rejects(() => isolated.adapter.process(input({ customerId: "missing_property" })), (error) => error && error.code === "PROPERTY_NOT_FOUND");

  const history = bindProductionHistoryToCycles([
    { eventId: "event-a", eventTimestamp: NOW, guestMessage: "hello", requestCycleRefs: ["cycle-a", "cycle-other"] },
    { eventId: "event-b", eventTimestamp: NOW, guestMessage: "", requestCycleRefs: ["cycle-a"] }
  ], [{ requestCycleId: "cycle-a" }]);
  assert.deepEqual(history, [{
    eventId: "event-a",
    messageRef: "event-a",
    role: "guest",
    timestamp: NOW,
    messageKind: "text",
    messageText: "hello",
    referenceableCycleIds: ["cycle-a"]
  }]);

  process.stdout.write("new-core production turn adapter: 24/24 PASS\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
