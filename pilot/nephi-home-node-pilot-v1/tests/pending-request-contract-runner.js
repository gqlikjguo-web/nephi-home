"use strict";

const assert = require("node:assert/strict");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { createPendingRequest, resumePendingRequest } = require("../lib/conversation-engine-v2/pending-request");

const property = {
  propertyId: "pending_contract_property",
  displayName: "Pending Contract Lodge",
  timezone: "Asia/Taipei",
  rooms: [{ id: "room_double", name: "雙人房", type: "雙人房", capacity: 2, enabled: true }],
  commonAnswers: {},
  faqs: [],
  semanticCatalog: { aliases: { room_double: ["雙人房"] } }
};

function availabilityTask(overrides = {}) {
  return {
    taskId: overrides.taskId || "availability",
    type: overrides.type || "availability",
    sourceText: overrides.sourceText || "住宿需求",
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: true,
    entity: overrides.entity || { category: "other", rawText: "", canonicalCandidate: null, confidence: 0.95 },
    confidence: 0.95
  };
}

function plan(tasks, options = {}) {
  const dateText = options.dateText || "";
  return {
    schemaVersion: 2,
    discourse: { relation: options.relation || "new_request", confidence: 0.99 },
    stateOperations: options.stateOperations || [],
    stay: {
      dateExpression: { rawText: dateText, kind: options.dateKind || "none", anchor: dateText ? "message_time" : "none" },
      checkInCandidate: options.checkInCandidate || null,
      checkOutCandidate: options.checkOutCandidate || null,
      nightsCandidate: options.nightsCandidate || null,
      guestCountCandidate: options.guestCountCandidate || null
    },
    tasks,
    ambiguities: [],
    missingInformation: options.missingInformation || [],
    needsHuman: false,
    shouldIgnore: Boolean(options.shouldIgnore),
    reason: options.reason || "pending_contract_test"
  };
}

function persistenceMemory() {
  const states = new Map();
  return {
    states,
    getConversationState: (propertyId, channelId, userId) => states.get(`${propertyId}:${channelId}:${userId}`) || null,
    setConversationState: (propertyId, channelId, userId, value) => states.set(`${propertyId}:${channelId}:${userId}`, value),
    appendMessageLog: () => ({ reviewId: "" }),
    updateMessageEvent: () => ({})
  };
}

function input(eventId, messageText) {
  return {
    customerId: property.propertyId,
    channelId: "test-line",
    lineUserId: "same-guest",
    eventId,
    eventTimestamp: Date.parse("2026-07-23T10:00:00+08:00"),
    messageText
  };
}

async function main() {
  const plannerOutputs = [
    plan([availabilityTask()], { missingInformation: ["stay.checkIn"] }),
    plan([availabilityTask({ taskId: "mistaken-search", type: "available_dates" })], {
      relation: "answer_clarification",
      dateText: "今天",
      dateKind: "relative",
      stateOperations: [
        { field: "stay.dateExpression.rawText", operation: "replace", value: "今天", sourceText: "今天" },
        { field: "stay.dateExpression.kind", operation: "replace", value: "relative", sourceText: "今天" },
        { field: "stay.dateExpression.anchor", operation: "replace", value: "message_time", sourceText: "今天" }
      ]
    })
  ];
  const persistence = persistenceMemory();
  const calls = { availability: 0, availableDates: 0 };
  const diagnostics = [];
  const engine = new ConversationEngineV2({
    planner: { classify: async () => plannerOutputs.shift() },
    persistence,
    getProperty: () => property,
    availabilityResolver: (query) => {
      calls.availability += 1;
      return { ...query, availabilityReliable: true, rooms: property.rooms };
    },
    availableDatesResolver: () => {
      calls.availableDates += 1;
      return { status: "answered", dates: [], source: "test" };
    },
    listPriceOverrides: () => [],
    now: () => new Date("2026-07-23T02:00:00.000Z"),
    onDiagnostic: (entry) => diagnostics.push(entry)
  });

  const first = await engine.process(input("pending-first", "還有房嗎"));
  assert.equal(first.taskResults[0].status, "needs_clarification");
  assert.equal(first.state.pendingRequest.version, 1);
  assert.equal(first.state.pendingRequest.capability, "availability");
  assert.deepEqual(first.state.pendingRequest.missingFields, ["stay.checkIn"]);
  assert.equal(first.state.pendingRequest.clarificationTarget, "stay.checkIn");
  assert.equal(first.state.pendingRequest.tasks[0].type, "availability");
  assert.equal(Object.hasOwn(first.state.pendingRequest, "replyText"), false);
  assert.equal(JSON.stringify(first.state.pendingRequest).includes("facts"), false);

  const second = await engine.process(input("pending-second", "今天"));
  assert.equal(calls.availability, 1, "the original availability resolver must run after the missing date is supplied");
  assert.equal(calls.availableDates, 0, "a date-only continuation must not become available_dates");
  assert.equal(second.taskResults[0].type, "availability");
  assert.equal(second.taskResults[0].status, "answered");
  assert.equal(second.state.pendingRequest, null, "the pending request must clear after execution");

  const pending = createPendingRequest({
    tasks: [availabilityTask({ entity: { category: "room", rawText: "雙人房", canonicalCandidate: "room_double", confidence: 0.95 } })],
    conditions: { stay: { checkIn: "2026-07-24", checkOut: null, nights: null, guests: null, searchRange: null }, inventory: { mode: "room_only", entityId: null, features: [] } },
    missingFields: ["stay.nights", "stay.guests", "inventory.entityId"],
    clarificationTarget: "stay.nights",
    scope: { eventId: "pending-shape", now: "2026-07-23T02:00:00.000Z" }
  });
  assert.equal(pending.conditions.stay.guests, null);
  assert.equal(pending.conditions.inventory.entityId, null);
  assert.deepEqual(pending.missingFields, ["stay.nights", "stay.guests", "inventory.entityId"]);
  assert.equal(Object.hasOwn(pending, "resolverResult"), false);

  for (const [field, operation] of [
    ["stay.nights", { field: "stay.nightsCandidate", operation: "set", value: 2, sourceText: "supplement" }],
    ["stay.guests", { field: "stay.guestCountCandidate", operation: "set", value: 4, sourceText: "supplement" }],
    ["inventory.entityId", { field: "inventory.entityId", operation: "set", value: "room_double", sourceText: "supplement" }]
  ]) {
    const item = createPendingRequest({ tasks: [availabilityTask()], conditions: { stay: {}, inventory: {} }, missingFields: [field], clarificationTarget: field, scope: { eventId: `missing-${field}`, now: "2026-07-23T02:00:00.000Z" } });
    const merged = resumePendingRequest(plan([availabilityTask({ taskId: "continuation" })], { relation: "answer_clarification", stateOperations: [operation] }), item);
    assert.equal(merged.resumed, true, `${field} must resume the canonical pending capability`);
    assert.equal(merged.plannerOutput.tasks[0].type, "availability");
    assert.ok(merged.plannerOutput.stateOperations.some((entry) => entry.field === operation.field));
  }

  const replacement = resumePendingRequest(plan([availabilityTask({ taskId: "new-complete" })], { relation: "new_request", checkInCandidate: "2026-07-30", nightsCandidate: 1 }), pending);
  assert.equal(replacement.resumed, false, "an explicit complete new request replaces rather than merges the pending request");
  assert.equal(replacement.reason, "explicit_new_request");
  const explicitRange = resumePendingRequest(plan([availabilityTask({ taskId: "range", type: "available_dates" })], { relation: "new_request" }), null);
  assert.equal(explicitRange.plannerOutput.tasks[0].type, "available_dates", "available_dates remains available for an explicit standalone range search");

  const gate = diagnostics.find((entry) => entry.stage === "no_reply_gate");
  assert.ok(gate, "every valid planner result must emit a no-reply gate diagnostic");
  assert.equal(typeof gate.reasonCode, "string");
  assert.ok(diagnostics.some((entry) => entry.stage === "semantic_contract"));
  assert.ok(diagnostics.some((entry) => entry.stage === "final_decision"));

  console.log("pending request contract: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
