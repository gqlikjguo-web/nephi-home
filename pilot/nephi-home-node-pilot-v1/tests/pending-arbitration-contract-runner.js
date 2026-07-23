"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { createPendingRequest } = require("../lib/conversation-engine-v2/pending-request");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { createLineBindingService } = require("../lib/line-binding-service");

const NOW = "2026-07-23T02:00:00.000Z";
const EVENT_TIME = Date.parse("2026-07-23T10:00:00+08:00");
const property = {
  propertyId: "pending_arbitration_property",
  displayName: "Pending Arbitration Lodge",
  timezone: "Asia/Taipei",
  businessProfile: { googleMapsUrl: "https://maps.google.com/?q=23.5,121.0" },
  rooms: [
    { id: "room_double", name: "Double Room", type: "double", capacity: 2, enabled: true }
  ],
  commonAnswers: {
    parkingRule: "Parking is available.",
    bbqRule: "Barbecue is available."
  },
  semanticCatalog: {
    aliases: {
      room_double: ["double room"],
      parking: ["parking"],
      bbq: ["barbecue"],
      location: ["location"]
    }
  }
};

function task(type, taskId = type, options = {}) {
  const factType = ["amenity", "policy", "property_fact"].includes(type);
  return {
    taskId,
    type,
    sourceText: options.sourceText || type,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: !factType,
    entity: options.entity || {
      category: type === "amenity" ? "amenity" : type === "policy" ? "policy" : type === "property_fact" ? "transport" : "other",
      rawText: options.rawText || "",
      canonicalCandidate: options.canonicalCandidate === undefined ? null : options.canonicalCandidate,
      confidence: 0.99
    },
    confidence: 0.99
  };
}

function plan(tasks, options = {}) {
  const dateText = options.dateText || "";
  const stateOperations = [...(options.stateOperations || [])];
  if (dateText && !stateOperations.some((item) => item.field === "stay.dateExpression.rawText")) {
    stateOperations.push(
      { field: "stay.dateExpression.rawText", operation: "set", value: dateText, sourceText: dateText },
      { field: "stay.dateExpression.kind", operation: "set", value: options.dateKind || "absolute", sourceText: dateText },
      { field: "stay.dateExpression.anchor", operation: "set", value: "message_time", sourceText: dateText }
    );
  }
  if (options.nights !== undefined) stateOperations.push({ field: "stay.nightsCandidate", operation: "set", value: options.nights, sourceText: "nights" });
  if (options.guests !== undefined) stateOperations.push({ field: "stay.guestCountCandidate", operation: "set", value: options.guests, sourceText: "guests" });
  if (options.roomId) {
    stateOperations.push(
      { field: "inventory.entityId", operation: "set", value: options.roomId, sourceText: "room" },
      { field: "inventory.mode", operation: "set", value: "room_only", sourceText: "room" }
    );
  }
  return {
    schemaVersion: 2,
    discourse: { relation: options.relation || "new_request", confidence: 0.99 },
    stateOperations,
    stay: {
      dateExpression: { rawText: dateText, kind: options.dateKind || "none", anchor: dateText ? "message_time" : "none" },
      checkInCandidate: options.checkInCandidate || null,
      checkOutCandidate: options.checkOutCandidate || null,
      nightsCandidate: options.nights === undefined ? null : options.nights,
      guestCountCandidate: options.guests === undefined ? null : options.guests
    },
    tasks,
    ambiguities: [],
    missingInformation: options.missingInformation || [],
    needsHuman: false,
    shouldIgnore: Boolean(options.shouldIgnore),
    reason: "pending_arbitration_contract"
  };
}

function memory() {
  const states = new Map();
  const messages = [];
  return {
    states,
    messages,
    getConversationState: (propertyId, channelId, userId) => states.get(`${propertyId}:${channelId}:${userId}`) || null,
    setConversationState: (propertyId, channelId, userId, value) => states.set(`${propertyId}:${channelId}:${userId}`, value),
    appendMessageLog: (_propertyId, value) => { messages.push(value); return { ...value, reviewId: "" }; },
    updateMessageEvent: (_propertyId, _channelId, _eventId, value) => { messages.push(value); return value; }
  };
}

function engineFor(outputs, options = {}) {
  const persistence = options.persistence || memory();
  const calls = options.calls || { availability: [], availableDates: [] };
  const diagnostics = options.diagnostics || [];
  const engine = new ConversationEngineV2({
    planner: { classify: async () => outputs.shift() },
    persistence,
    getProperty: () => property,
    availabilityResolver: (query) => {
      calls.availability.push(query);
      return { ...query, availabilityReliable: true, rooms: property.rooms };
    },
    availableDatesResolver: (query) => {
      calls.availableDates.push(query);
      return { status: "answered", dates: [{ checkIn: query.dateFrom, checkOut: query.dateTo, available: true }], source: "test" };
    },
    listPriceOverrides: () => [],
    now: () => new Date(NOW),
    onDiagnostic: (item) => diagnostics.push(item)
  });
  return { engine, persistence, calls, diagnostics };
}

function input(eventId, messageText, userId = "same-user", channelId = "line-binding:test") {
  return {
    customerId: property.propertyId,
    channelId,
    lineUserId: userId,
    eventId,
    eventTimestamp: EVENT_TIME,
    messageText
  };
}

function pendingState(pending, overrides = {}) {
  return {
    schemaVersion: 2,
    scope: {
      propertyId: property.propertyId,
      channelId: overrides.channelId || "line-binding:test",
      lineUserId: overrides.userId || "same-user"
    },
    conditions: {
      stay: { checkIn: null, checkOut: null, nights: null, guests: null, searchRange: null, ...(overrides.stay || {}) },
      inventory: { mode: "any", entityId: null, features: [], ...(overrides.inventory || {}) },
      topic: { capabilityType: null, canonicalId: null, category: null, detailIntent: "general", detailFields: [] }
    },
    pendingRequest: pending,
    transition: { set: [], replaced: [], cleared: [], kept: [], sourceEventId: "seed" },
    updatedAt: NOW
  };
}

function availabilityPending(missingFields, conditions = {}) {
  return createPendingRequest({
    tasks: [task("availability", "original-availability")],
    conditions: {
      stay: { checkIn: null, checkOut: null, nights: null, guests: null, searchRange: null, ...(conditions.stay || {}) },
      inventory: { mode: "any", entityId: null, features: [], ...(conditions.inventory || {}) }
    },
    missingFields,
    clarificationTarget: missingFields[0],
    scope: { eventId: "seed-pending", now: NOW }
  });
}

async function testProductionFailureShape() {
  const runtime = engineFor([
    plan([task("availability", "original-availability")], { missingInformation: ["stay.checkIn"] }),
    plan([task("available_dates", "planner-date-candidate")], {
      relation: "new_request",
      dateText: "7/24",
      dateKind: "absolute",
      checkInCandidate: "2026-07-24"
    })
  ]);
  const first = await runtime.engine.process(input("failure-shape-first", "availability"));
  assert.equal(first.state.pendingRequest.capability, "availability");
  assert.deepEqual(first.state.pendingRequest.missingFields, ["stay.checkIn"]);

  const second = await runtime.engine.process(input("failure-shape-second", "7/24"));
  assert.equal(runtime.calls.availableDates.length, 0, "a single validated date must not execute the candidate available_dates resolver");
  assert.equal(runtime.calls.availability.length, 1, "the original availability capability must execute");
  assert.equal(second.taskResults[0].type, "availability");
  assert.equal(second.state.conditions.stay.checkIn, "2026-07-24");
  assert.equal(second.state.pendingRequest, null);
  const arbitration = runtime.diagnostics.find((item) => item.stage === "pending_request" && item.reasonCode === "pending_missing_fields_matched");
  assert.ok(arbitration, "the Engine must report the canonical pending arbitration result");
  assert.deepEqual(arbitration.acceptedFields, ["stay.checkIn"]);
}

async function testRemainingFieldsAndCompletion() {
  const persistence = memory();
  const pending = availabilityPending(["stay.checkIn", "stay.nights"]);
  persistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(pending));
  const runtime = engineFor([
    plan([task("available_dates", "date-candidate")], {
      relation: "new_request",
      dateText: "7/24",
      dateKind: "absolute",
      checkInCandidate: "2026-07-24"
    }),
    plan([task("available_dates", "nights-candidate")], {
      relation: "new_request",
      nights: 2
    })
  ], { persistence });

  const partial = await runtime.engine.process(input("remaining-date", "7/24"));
  assert.equal(partial.finalDecision.type, "clarification");
  assert.deepEqual(partial.finalDecision.clarificationFields, ["stay.nights"]);
  assert.deepEqual(partial.state.pendingRequest.missingFields, ["stay.nights"]);
  assert.equal(partial.state.pendingRequest.clarificationTarget, "stay.nights");
  assert.equal(runtime.calls.availability.length, 0);
  assert.equal(runtime.calls.availableDates.length, 0);

  const complete = await runtime.engine.process(input("remaining-nights", "two nights"));
  assert.equal(complete.taskResults[0].type, "availability");
  assert.equal(complete.taskResults[0].status, "answered");
  assert.equal(complete.state.conditions.stay.checkIn, "2026-07-24");
  assert.equal(complete.state.conditions.stay.checkOut, "2026-07-26");
  assert.equal(complete.state.conditions.stay.nights, 2);
  assert.equal(complete.state.pendingRequest, null);
  assert.equal(runtime.calls.availability.length, 1);
  assert.equal(runtime.calls.availableDates.length, 0);
}

async function testSharedSlotContract() {
  for (const item of [
    {
      field: "stay.nights",
      conditions: { stay: { checkIn: "2026-07-24" } },
      plan: plan([task("available_dates", "nights-candidate")], { relation: "new_request", nights: 2 }),
      assertState: (state) => assert.equal(state.conditions.stay.nights, 2)
    },
    {
      field: "stay.guests",
      conditions: { stay: { checkIn: "2026-07-24", checkOut: "2026-07-25", nights: 1 } },
      plan: plan([task("available_dates", "guests-candidate")], { relation: "new_request", guests: 2 }),
      assertState: (state) => assert.equal(state.conditions.stay.guests, 2)
    },
    {
      field: "inventory.entityId",
      conditions: { stay: { checkIn: "2026-07-24", checkOut: "2026-07-25", nights: 1 } },
      plan: plan([task("available_dates", "room-candidate")], { relation: "new_request", roomId: "room_double" }),
      assertState: (state) => assert.equal(state.conditions.inventory.entityId, "room_double")
    }
  ]) {
    const persistence = memory();
    const pending = availabilityPending([item.field], item.conditions);
    persistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(pending, item.conditions));
    const runtime = engineFor([item.plan], { persistence });
    const result = await runtime.engine.process(input(`slot-${item.field}`, item.field));
    assert.equal(result.taskResults[0].type, "availability", `${item.field} must preserve the pending capability`);
    assert.equal(runtime.calls.availableDates.length, 0, `${item.field} must not execute available_dates`);
    item.assertState(result.state);
    if (item.field === "inventory.entityId") {
      assert.equal(runtime.calls.availability[0].roomType, "room_double", "the merged room preference must reach the property-scoped Resolver");
    }
  }
}

async function testReplacementAndExplicitRange() {
  const replacementPersistence = memory();
  const pending = availabilityPending(["stay.checkIn"]);
  replacementPersistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(pending));
  const replacementRuntime = engineFor([
    plan([task("availability", "new-complete-availability")], {
      relation: "new_request",
      dateText: "7/30",
      dateKind: "absolute",
      checkInCandidate: "2026-07-30",
      nights: 2
    })
  ], { persistence: replacementPersistence });
  const replacement = await replacementRuntime.engine.process(input("replace-complete", "7/30 for two nights"));
  assert.equal(replacement.taskResults[0].taskId, "new-complete-availability");
  assert.equal(replacement.state.conditions.stay.checkIn, "2026-07-30");
  assert.equal(replacement.state.conditions.stay.checkOut, "2026-08-01");
  assert.equal(replacement.state.pendingRequest, null);

  const rangePersistence = memory();
  rangePersistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(availabilityPending(["stay.checkIn"])));
  const rangeRuntime = engineFor([
    plan([task("available_dates", "explicit-range")], {
      relation: "new_request",
      dateText: "7/25-7/28",
      dateKind: "range",
      checkInCandidate: "2026-07-25",
      checkOutCandidate: "2026-07-28"
    })
  ], { persistence: rangePersistence });
  const range = await rangeRuntime.engine.process(input("explicit-range", "7/25-7/28"));
  assert.equal(range.taskResults[0].type, "available_dates");
  assert.equal(rangeRuntime.calls.availableDates.length, 1);
  assert.equal(rangeRuntime.calls.availability.length, 0);
  assert.equal(rangeRuntime.calls.availableDates[0].dateFrom, "2026-07-25");
  assert.equal(rangeRuntime.calls.availableDates[0].dateTo, "2026-07-28");
}

async function testAcknowledgementAndIndependentTasks() {
  const acknowledgementPersistence = memory();
  const pending = availabilityPending(["stay.checkIn"]);
  acknowledgementPersistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(pending));
  const acknowledgementRuntime = engineFor([
    plan([task("unknown", "acknowledgement", { rawText: "thanks" })], {
      relation: "acknowledgement",
      shouldIgnore: true
    }),
    plan([task("amenity", "parking", { rawText: "parking", canonicalCandidate: "parking" })], {
      relation: "acknowledgement",
      shouldIgnore: true
    })
  ], { persistence: acknowledgementPersistence });
  const ignored = await acknowledgementRuntime.engine.process(input("ack-only", "thanks"));
  assert.equal(ignored.finalDecision.type, "no_reply");
  assert.equal(acknowledgementPersistence.getConversationState(property.propertyId, "line-binding:test", "same-user").pendingRequest.capability, "availability");

  const question = await acknowledgementRuntime.engine.process(input("ack-question", "thanks, parking?"));
  assert.equal(question.finalDecision.type, "reply");
  assert.equal(question.taskResults[0].type, "amenity");
  assert.match(question.replyText, /Parking is available/);
}

async function testSupplementWithIndependentTaskAndNoSupplement() {
  const mixedPersistence = memory();
  mixedPersistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(availabilityPending(["stay.checkIn"])));
  const mixedRuntime = engineFor([
    plan([
      task("available_dates", "mixed-date-candidate"),
      task("amenity", "mixed-parking", { rawText: "parking", canonicalCandidate: "parking" })
    ], {
      relation: "new_request",
      dateText: "7/24",
      dateKind: "absolute",
      checkInCandidate: "2026-07-24"
    })
  ], { persistence: mixedPersistence });
  const mixed = await mixedRuntime.engine.process(input("mixed-supplement", "7/24 and parking?"));
  assert.deepEqual(mixed.taskResults.map((result) => result.type), ["availability", "amenity"]);
  assert.equal(mixedRuntime.calls.availability.length, 1);
  assert.equal(mixedRuntime.calls.availableDates.length, 0);
  assert.match(mixed.replyText, /Parking is available/);

  const emptyPersistence = memory();
  emptyPersistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(availabilityPending(["stay.checkIn"])));
  const emptyRuntime = engineFor([
    plan([task("unknown", "no-supplement-candidate", { rawText: "unresolved" })], { relation: "continue" })
  ], { persistence: emptyPersistence });
  const empty = await emptyRuntime.engine.process(input("no-supplement", "continuation without a validated value"));
  assert.equal(empty.finalDecision.type, "no_reply");
  assert.equal(empty.replyText, "");
  assert.equal(empty.state.pendingRequest.capability, "availability");
  assert.equal(emptyRuntime.calls.availability.length, 0);
  assert.equal(emptyRuntime.calls.availableDates.length, 0);
}

async function testSingleTurnCapabilities() {
  const cases = [
    plan([task("availability", "single-date")], {
      dateText: "7/25",
      dateKind: "absolute",
      checkInCandidate: "2026-07-25"
    }),
    plan([task("amenity", "parking", { rawText: "parking", canonicalCandidate: "parking" })]),
    plan([task("policy", "bbq", { rawText: "barbecue", canonicalCandidate: "bbq" })]),
    plan([task("property_fact", "location", { rawText: "location", canonicalCandidate: "location" })])
  ];
  const runtime = engineFor(cases);
  const availability = await runtime.engine.process(input("single-availability", "7/25 availability", "single-availability"));
  assert.equal(availability.taskResults[0].status, "answered");
  for (const [index, label] of ["parking", "bbq", "location"].entries()) {
    const result = await runtime.engine.process(input(`single-${label}`, label, `single-${label}`));
    assert.equal(result.taskResults[0].status, "answered", `${label} must not regress`);
  }
}

function memoryBindingProvider() {
  const rowsByProperty = new Map();
  const rowsByKey = new Map();
  return {
    getLineBindingByPropertyId: (propertyId) => rowsByProperty.get(propertyId) || null,
    getLineBindingByWebhookKey: (webhookKey) => rowsByKey.get(webhookKey) || null,
    upsertLineBinding(row) {
      const saved = { ...row, createdAt: row.createdAt || NOW, updatedAt: NOW };
      rowsByProperty.set(saved.propertyId, saved);
      rowsByKey.set(saved.webhookKey, saved);
      return saved;
    },
    setLineBindingEnabled(propertyId, enabled) {
      const row = rowsByProperty.get(propertyId);
      return row ? this.upsertLineBinding({ ...row, enabled: Boolean(enabled) }) : null;
    },
    recordValidLineWebhook(propertyId) {
      const row = rowsByProperty.get(propertyId);
      return row ? this.upsertLineBinding({ ...row, lastWebhookAt: NOW }) : null;
    }
  };
}

async function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for production LINE handler");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function testProductionRoute() {
  const originalLog = console.log;
  const observedLogs = [];
  console.log = (...args) => observedLogs.push(args.map(String).join(" "));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pending-arbitration-line-"));
  const seedFile = path.join(temp, "seed.json");
  const dataFile = path.join(temp, "store.json");
  fs.writeFileSync(seedFile, JSON.stringify({
    testOnly: true,
    seedDays: 10,
    messageLogs: { pending_arbitration_property: [] },
    homestays: [{
      customerId: property.propertyId,
      name: property.displayName,
      safeFacts: property.commonAnswers,
      rooms: property.rooms
    }]
  }));
  const providers = { kind: "json", ...createJsonProviders({ dataFile, seedFile }) };
  providers.lineBindings = memoryBindingProvider();
  const encryptionKey = crypto.randomBytes(32).toString("base64");
  const secret = "pending-arbitration-line-secret";
  const token = "pending-arbitration-line-token";
  const bindingService = createLineBindingService({
    provider: providers.lineBindings,
    env: { JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY: encryptionKey }
  });
  const binding = bindingService.upsert(property.propertyId, {
    channelSecret: secret,
    channelAccessToken: token,
    enabled: true
  });
  const plannerOutputs = [
    plan([task("availability", "route-availability")], { missingInformation: ["stay.checkIn"] }),
    plan([task("available_dates", "route-date-candidate")], {
      relation: "new_request",
      dateText: "7/24",
      dateKind: "absolute",
      checkInCandidate: "2026-07-24"
    })
  ];
  const replies = [];
  const app = createApp({
    providers,
    lineBindingEnv: { JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY: encryptionKey },
    conversationDebounceMs: 1,
    conversationPlannerV2: { classify: async () => plannerOutputs.shift() },
    lineReplyClientFactory: ({ channelAccessToken }) => ({
      replyMessageWithHttpInfo: async (body) => {
        replies.push({ channelAccessToken, body });
        return { httpResponse: { status: 200 } };
      }
    })
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    async function send(eventId, text) {
      const payload = JSON.stringify({
        events: [{
          type: "message",
          webhookEventId: eventId,
          replyToken: `reply-${eventId}`,
          timestamp: EVENT_TIME,
          source: { userId: "same-line-user" },
          message: { type: "text", id: `message-${eventId}`, text }
        }]
      });
      const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64");
      return fetch(`${running.url}/api/line/webhooks/${binding.webhookKey}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-line-signature": signature },
        body: payload
      });
    }
    assert.equal((await send("route-first", "availability")).status, 200);
    await waitFor(() => replies.length === 1);
    assert.equal((await send("route-second", "7/24")).status, 200);
    await waitFor(() => replies.length === 2);
    assert.equal(replies[1].channelAccessToken, token);
    assert.ok(observedLogs.some((line) => line.includes('"stage":"executor"') && line.includes('"taskId":"route-availability"')), "the production handler must execute the original availability task");
    assert.equal(observedLogs.some((line) => line.includes('"stage":"executor"') && line.includes('"taskId":"route-date-candidate"')), false, "the production handler must not execute the candidate available_dates task");
    const channelId = `line-binding:${crypto.createHash("sha256").update(binding.webhookKey).digest("hex").slice(0, 24)}`;
    const state = providers.persistence.getConversationState(property.propertyId, channelId, "same-line-user");
    assert.equal(state.conditions.stay.checkIn, "2026-07-24");
    assert.equal(state.pendingRequest, null);
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
    console.log = originalLog;
  }
}

(async () => {
  await testProductionFailureShape();
  await testRemainingFieldsAndCompletion();
  await testSharedSlotContract();
  await testReplacementAndExplicitRange();
  await testAcknowledgementAndIndependentTasks();
  await testSupplementWithIndependentTaskAndNoSupplement();
  await testSingleTurnCapabilities();
  await testProductionRoute();
  console.log("pending arbitration contract: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
