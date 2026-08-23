"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const {
  createConversationStateV3,
  createConversationTaskV3
} = require("../lib/conversation-contracts/conversation-state-v3");
const {
  decideContextExecutionV3
} = require("../lib/conversation-engine-v2/conversation-state-v3-reducer");
const {
  buildPropertyCatalog
} = require("../lib/conversation-engine-v2/property-catalog");
const { createPendingRequest } = require("../lib/conversation-engine-v2/pending-request");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { createLineBindingService } = require("../lib/line-binding-service");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const NOW = "2026-07-23T02:00:00.000Z";
const EVENT_TIME = Date.parse("2026-07-23T10:00:00+08:00");
const property = {
  propertyId: "pending_arbitration_property",
  displayName: "Pending Arbitration Lodge",
  timezone: "Asia/Taipei",
  businessProfile: { googleMapsUrl: "https://maps.google.com/?q=23.5,121.0" },
  rooms: [
    { id: "room_double", name: "Double Room", type: "double", capacity: 2, enabled: true },
    { id: "room_401", name: "Room 401", type: "double", capacity: 2, enabled: true },
    { id: "room_402", name: "Room 402", type: "double", capacity: 2, enabled: true }
  ],
  commonAnswers: {
    parkingRule: "Parking is available.",
    bbqRule: "Barbecue is available."
  },
  propertyFacts: [
    { canonicalId: "parking", category: "amenity", publicName: "Parking", status: "available", publicText: "Parking is available." },
    { canonicalId: "bbq", category: "policy", publicName: "Barbecue", status: "available", publicText: "Barbecue is available." }
  ],
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
    candidateIndex: options.candidateIndex === undefined ? 0 : options.candidateIndex,
    taskId,
    type,
    sourceText: options.sourceText || type,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: new Set(["availability", "available_dates", "bundle_availability", "room_options", "capacity", "price", "total_price"]).has(type),
    entity: options.entity || {
      category: type === "amenity" ? "amenity" : type === "policy" ? "policy" : type === "property_fact" ? "transport" : "other",
      rawText: options.rawText || "",
      canonicalCandidate: options.canonicalCandidate === undefined ? null : options.canonicalCandidate,
      confidence: 0.99
    },
    stayCandidate: null,
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
    _contextRequestCycleRefs: options.contextRequestCycleRefs || [],
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

function bindPlanToSource(output, sourceEvents) {
  const source = sourceEvents[0];
  const contextRequestCycleRefs = output._contextRequestCycleRefs || [];
  delete output._contextRequestCycleRefs;
  output.tasks = output.tasks.map((item, index) => ({ ...item, candidateIndex: index, stayCandidate: item.dependsOnStayContext ? { ...output.stay } : null }));
  output.contextRelationCandidates = output.tasks.map((item) => ({
    candidateIndex: item.candidateIndex,
    kind: item.type === "unknown" ? "relation_uncertain" : output.discourse.relation === "modify" ? "modify_existing" : ["continue", "answer_clarification"].includes(output.discourse.relation) ? "supplement_existing" : output.discourse.relation === "acknowledgement" ? "relation_uncertain" : "new_request",
    candidateRequestCycleRefs: contextRequestCycleRefs,
    evidenceRefs: [{ eventId: source.eventId, messageRef: source.messageRef || "", startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }]
  }));
  return migrateFakePlannerOutput(output);
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
    planner: { classify: async ({ sourceEvents }) => bindPlanToSource(outputs.shift(), sourceEvents) },
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

function availabilityPending(missingFields, conditions = {}, capability = "availability") {
  return createPendingRequest({
    tasks: [task(capability, "original-availability")],
    conditions: {
      stay: { checkIn: null, checkOut: null, nights: null, guests: null, searchRange: null, ...(conditions.stay || {}) },
      inventory: { mode: "any", entityId: null, features: [], ...(conditions.inventory || {}) }
    },
    missingFields,
    clarificationTarget: missingFields[0],
    scope: {
      eventId: "seed-pending",
      now: NOW,
      expiresAt: "2026-07-24T02:00:00.000Z"
    }
  });
}

function answeredAvailabilityTask(index, overrides = {}) {
  const updatedAt = overrides.updatedAt
    || new Date(Date.parse("2026-07-23T01:00:00.000Z") + index * 1000).toISOString();
  return createConversationTaskV3({
    taskId: overrides.taskId || `answered-availability-${index}`,
    taskType: "availability",
    productType: "room_type",
    productId: overrides.roomId || "room_double",
    roomTypeId: overrides.roomId || "room_double",
    bundleId: null,
    checkIn: overrides.checkIn || "2026-08-20",
    checkOut: overrides.checkOut || "2026-08-21",
    guestCount: null,
    searchFrom: null,
    searchTo: null,
    entityId: null,
    entityCategory: null,
    detailIntent: "general",
    knownFields: ["productType", "productId", "roomTypeId", "checkIn", "checkOut"],
    missingFields: [],
    status: "answered",
    createdAt: updatedAt,
    updatedAt,
    expiresAt: "2026-08-28T02:00:00.000Z"
  });
}

function answeredAvailabilityState(overrides = {}) {
  const tasks = Array.from({ length: 18 }, (_, index) => answeredAvailabilityTask(index));
  tasks[17] = answeredAvailabilityTask(17, {
    taskId: "latest-availability",
    roomId: "room_401",
    checkIn: "2026-08-27",
    checkOut: "2026-08-28",
    updatedAt: overrides.latestUpdatedAt || "2026-08-23T01:17:00.000Z"
  });
  if (overrides.tieLatest) {
    tasks[16] = answeredAvailabilityTask(16, {
      taskId: "tied-latest-availability",
      roomId: "room_double",
      updatedAt: "2026-08-23T01:17:00.000Z"
    });
  }
  return createConversationStateV3({
    propertyId: property.propertyId,
    channel: "line-binding:test",
    userId: "same-user",
    revision: 18,
    tasks,
    createdAt: "2026-07-23T01:00:00.000Z",
    updatedAt: "2026-08-23T01:17:00.000Z",
    expiresAt: "2026-08-28T02:00:00.000Z"
  });
}

function productOnlyAvailabilityTask(roomId) {
  return task("availability", "current-room-availability", {
    sourceText: "current room",
    entity: {
      category: "room",
      rawText: "current room",
      canonicalCandidate: roomId,
      confidence: 0.99
    }
  });
}

async function testLatestAnsweredProductOnlyContinuation() {
  const catalog = buildPropertyCatalog(property);
  const current = productOnlyAvailabilityTask("room_402");
  const decision = decideContextExecutionV3({
    state: answeredAvailabilityState(),
    plannerTasks: [current],
    relations: [],
    catalog,
    now: "2026-08-23T02:00:00.000Z"
  });
  assert.equal(decision.automaticPendingDiagnostic.reasonCode, "continuation_selected");
  assert.equal(decision.executionItems[0].requestCycleId, "latest-availability");
  assert.equal(decision.executionItems[0].transition.contextTask.checkIn, "2026-08-27");
  assert.equal(decision.executionItems[0].transition.approvedProduct.roomTypeId, "room_402");

  for (const [label, state, roomId] of [
    ["tied latest answered candidates", answeredAvailabilityState({ tieLatest: true }), "room_402"],
    ["unresolved current product", answeredAvailabilityState(), "room_unresolved"]
  ]) {
    const negative = decideContextExecutionV3({
      state,
      plannerTasks: [productOnlyAvailabilityTask(roomId)],
      relations: [],
      catalog,
      now: "2026-08-23T02:00:00.000Z"
    });
    assert.equal(
      negative.automaticPendingDiagnostic.reasonCode,
      "no_unique_compatible_candidate",
      `${label} must fail closed`
    );
    assert.equal(negative.executionItems[0].requestCycleId, "current-room-availability");
  }
}

async function testProductionFailureShape() {
  const runtime = engineFor([
    plan([task("availability", "original-availability")], { missingInformation: ["stay.checkIn"] }),
    plan([task("available_dates", "planner-date-candidate")], {
      relation: "new_request",
      dateText: "7/24",
      dateKind: "absolute",
      checkInCandidate: "2026-07-24",
      nights: 1
    })
  ]);
  const first = await runtime.engine.process(input("failure-shape-first", "availability"));
  assert.ok(first.state, JSON.stringify({ first, diagnostics: runtime.diagnostics }));
  const originalTask = first.state.tasks[0];
  assert.equal(originalTask.taskType, "availability");
  assert.equal(originalTask.missingFields.includes("checkIn"), true);

  const second = await runtime.engine.process(input("failure-shape-second", "7/24"));
  assert.equal(runtime.calls.availableDates.length, 0, "a single validated date must not execute the candidate available_dates resolver");
  assert.equal(runtime.calls.availability.length, 1, "the original availability capability must execute");
  assert.equal(second.taskResults[0].type, "availability");
  assert.equal(runtime.calls.availability[0].checkIn, "2026-07-24", JSON.stringify(runtime.calls.availability[0]));
  assert.equal(second.taskResults[0].status, "answered");
  const arbitration = runtime.diagnostics.find((item) => item.stage === "pending_request" && Array.isArray(item.items) && item.items.some((entry) => entry.capability === "availability"));
  assert.ok(arbitration, "the Engine must report the canonical availability pending result");
}

async function testRemainingFieldsAndCompletion() {
  const persistence = memory();
  const conditions = { stay: { checkIn: "2026-07-24" } };
  const pending = availabilityPending(["stay.nights"], conditions);
  persistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(pending, conditions));
  const runtime = engineFor([
    plan([task("available_dates", "nights-candidate", { sourceText: "two nights" })], {
      relation: "continue",
      contextRequestCycleRefs: ["original-availability"],
      nights: 2
    })
  ], { persistence });

  const complete = await runtime.engine.process(input("remaining-nights", "two nights"));
  assert.ok(complete.taskResults[0], JSON.stringify({ complete, diagnostics: runtime.diagnostics }));
  assert.equal(complete.taskResults[0].type, "availability");
  assert.equal(complete.taskResults[0].status, "answered", JSON.stringify(complete));
  assert.equal(runtime.calls.availability[0].checkIn, "2026-07-24");
  assert.equal(runtime.calls.availability[0].checkOut, "2026-07-26");
  assert.equal(runtime.calls.availability.length, 1);
  assert.equal(runtime.calls.availableDates.length, 0);
  assert.equal(complete.state.tasks.length, 1, "slot-only follow-up must not create a duplicate task");
  assert.equal(complete.state.tasks[0].taskId, "original-availability");
}

async function testSharedSlotContract() {
  for (const item of [
    {
      field: "stay.nights",
      capability: "availability",
      conditions: { stay: { checkIn: "2026-07-24" } },
      message: "two nights",
      plan: plan([task("available_dates", "nights-candidate", { sourceText: "two nights" })], { relation: "continue", contextRequestCycleRefs: ["original-availability"], nights: 2 }),
      assertState: (state) => assert.equal(state.tasks.some((entry) => entry.checkOut === "2026-07-26"), true)
    },
    {
      field: "stay.guests",
      capability: "capacity",
      conditions: { stay: { checkIn: "2026-07-24", checkOut: "2026-07-25", nights: 1 } },
      message: "2 guests",
      plan: plan([task("capacity", "guests-candidate", { sourceText: "2 guests" })], { relation: "continue", contextRequestCycleRefs: ["original-availability"], guests: 2 }),
      expectedType: "capacity",
      expectedAvailabilityCalls: 1,
      assertState: (state) => assert.equal(state.tasks.some((entry) => entry.guestCount === 2), true)
    },
    {
      field: "inventory.entityId",
      capability: "availability",
      conditions: {},
      message: "the double room",
      plan: plan([task("available_dates", "room-candidate", { sourceText: "the double room", entity: { category: "room", rawText: "double room", canonicalCandidate: "room_double", confidence: 0.99 } })], { relation: "continue", contextRequestCycleRefs: ["original-availability"], roomId: "room_double" }),
      expectedType: "availability",
      expectedAvailabilityCalls: 0,
      assertState: (state) => assert.equal(state.tasks.some((entry) => entry.productId === "room_double"), true)
    }
  ]) {
    const persistence = memory();
    const pending = availabilityPending([item.field], item.conditions, item.capability);
    persistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(pending, item.conditions));
    const runtime = engineFor([item.plan], { persistence });
    const result = await runtime.engine.process(input(`slot-${item.field}`, item.message));
    assert.equal(result.taskResults[0].type, item.expectedType || "availability", `${item.field} must preserve the pending capability`);
    assert.equal(runtime.calls.availableDates.length, 0, `${item.field} must not execute available_dates`);
    assert.equal(runtime.calls.availability.length, item.expectedAvailabilityCalls === undefined ? 1 : item.expectedAvailabilityCalls, JSON.stringify(result));
    item.assertState(result.state);
    assert.equal(result.state.tasks.length, 1, `${item.field} must not create a duplicate task`);
    assert.equal(result.state.tasks[0].taskId, "original-availability");
    if (item.field === "inventory.entityId" && runtime.calls.availability.length) {
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
  assert.equal(replacementRuntime.calls.availability[0].checkIn, "2026-07-30");
  assert.equal(replacementRuntime.calls.availability[0].checkOut, "2026-08-01");

  const rangePersistence = memory();
  rangePersistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(availabilityPending(["stay.checkIn"])));
  const rangeRuntime = engineFor([
    plan([task("available_dates", "explicit-range", { sourceText: "7/25-7/28" })], {
      relation: "new_request",
      dateText: "7/25-7/28",
      dateKind: "range",
      checkInCandidate: "2026-07-25",
      checkOutCandidate: "2026-07-28"
    })
  ], { persistence: rangePersistence });
  const range = await rangeRuntime.engine.process(input("explicit-range", "7/25-7/28"));
  assert.equal(range.taskResults[0].type, "availability", JSON.stringify(range));
  assert.equal(range.taskResults[0].taskId, "explicit-range");
  assert.equal(rangeRuntime.calls.availableDates.length, 0);
  assert.equal(rangeRuntime.calls.availability.length, 1);
  assert.equal(range.state.tasks.length, 2, "a complete new request must not replace or absorb the old pending task");
  assert.equal(range.state.tasks.some((entry) => entry.taskId === "original-availability" && entry.status === "pending"), true);
  assert.equal(range.state.tasks.some((entry) => entry.taskId === "explicit-range" && entry.status === "answered"), true);
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
      relation: "new_request",
      shouldIgnore: false
    })
  ], { persistence: acknowledgementPersistence });
  const ignored = await acknowledgementRuntime.engine.process(input("ack-only", "thanks"));
  assert.equal(ignored.finalDecision.action, "no_reply", JSON.stringify(ignored));
  assert.equal(acknowledgementPersistence.getConversationState(property.propertyId, "line-binding:test", "same-user").pendingRequest.capability, "availability");

  const question = await acknowledgementRuntime.engine.process(input("ack-question", "thanks, parking?"));
  assert.equal(question.finalDecision.action, "reply");
  assert.equal(question.taskResults[0].type, "parking");
  assert.match(question.replyText, /Parking is available/);
  assert.equal(acknowledgementRuntime.calls.availability.length, 0, "an independent property question must not execute the old pending lodging task");
  assert.equal(question.state.tasks.some((entry) => entry.taskType === "availability" && entry.status === "pending"), true);
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
      checkInCandidate: "2026-07-24",
      nights: 1
    })
  ], { persistence: mixedPersistence });
  const mixed = await mixedRuntime.engine.process(input("mixed-supplement", "7/24 for one night and parking?"));
  assert.deepEqual(mixed.taskResults.map((result) => result.type), ["availability", "parking"]);
  assert.equal(mixedRuntime.calls.availability.length, 1);
  assert.equal(mixedRuntime.calls.availableDates.length, 0);
  assert.match(mixed.replyText, /Parking is available/);

  const emptyPersistence = memory();
  emptyPersistence.setConversationState(property.propertyId, "line-binding:test", "same-user", pendingState(availabilityPending(["stay.checkIn"])));
  const emptyRuntime = engineFor([
    plan([task("unknown", "no-supplement-candidate", { rawText: "unresolved" })], { relation: "continue" })
  ], { persistence: emptyPersistence });
  const empty = await emptyRuntime.engine.process(input("no-supplement", "continuation without a validated value"));
  assert.equal(empty.finalDecision.action, "handoff");
  assert.equal(empty.finalResponse.shouldReply, true);
  assert.equal(empty.state.tasks.some((entry) => entry.taskType === "availability"), true);
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
    plan([task("available_dates", "route-date-candidate", { sourceText: "7/24" })], {
      relation: "continue",
      contextRequestCycleRefs: ["route-availability"],
      dateText: "7/24",
      dateKind: "absolute",
      checkInCandidate: "2026-07-24",
      nights: 1
    })
  ];
  const replies = [];
  const app = createApp({
    providers,
    lineBindingEnv: { JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY: encryptionKey },
    conversationDebounceMs: 1,
    conversationPlannerV2: { classify: async ({ sourceEvents }) => bindPlanToSource(plannerOutputs.shift(), sourceEvents) },
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
    const canonicalLogs = observedLogs.filter((line) => line.includes('"stage":"canonical_request"'));
    assert.ok(canonicalLogs.some((line) => line.includes('"taskId":"route-availability"') && line.includes('"capability":"availability"')), "the resumed canonical request must preserve the original availability task");
    assert.equal(canonicalLogs.some((line) => line.includes('"taskId":"route-date-candidate"')), false, "the slot candidate must not become a duplicate canonical task");
    const channelId = `line-binding:${crypto.createHash("sha256").update(binding.webhookKey).digest("hex").slice(0, 24)}`;
    const state = providers.persistence.getConversationState(property.propertyId, channelId, "same-line-user");
    assert.equal(state.tasks.some((entry) => entry.checkIn === "2026-07-24"), true);
    assert.equal(state.tasks.some((entry) => entry.taskId === "route-date-candidate"), false);
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
    console.log = originalLog;
  }
}

(async () => {
  await testLatestAnsweredProductOnlyContinuation();
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
