"use strict";

const assert = require("node:assert/strict");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { createPendingRequest, pendingFromResults } = require("../lib/conversation-engine-v2/pending-request");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

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
    candidateIndex: Number.isInteger(overrides.candidateIndex) ? overrides.candidateIndex : 0,
    taskId: overrides.taskId || "availability",
    type: overrides.type || "availability",
    sourceText: overrides.sourceText || "住宿需求",
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: overrides.dependsOnStayContext === undefined
      ? true
      : Boolean(overrides.dependsOnStayContext),
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

function withExplicitRelations(output, sourceEvents, contextSnapshot) {
  const source = sourceEvents[0];
  const relationKind = output.discourse.relation === "answer_clarification"
    ? "supplement_existing"
    : output.discourse.relation === "acknowledgement"
      ? "relation_uncertain"
      : "new_request";
  return migrateFakePlannerOutput({
    ...output,
    tasks: output.tasks.map((item, candidateIndex) => ({
      ...item,
      candidateIndex,
      sourceText: source.messageText
    })),
    contextRelationCandidates: output.tasks.map((_item, candidateIndex) => ({
      candidateIndex,
      kind: relationKind,
      candidateRequestCycleRefs: relationKind === "new_request" ? [] : [contextSnapshot.cycles[0].requestCycleId],
      evidenceRefs: [{ eventId: source.eventId, messageRef: source.messageRef || "", startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }]
    }))
  });
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
    plan([availabilityTask({
      taskId: "acknowledgement",
      type: "unknown",
      dependsOnStayContext: false,
      entity: {
        category: "other",
        rawText: "thanks",
        canonicalCandidate: null,
        confidence: 0.99
      }
    })], { relation: "acknowledgement", shouldIgnore: true }),
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
    planner: { classify: async ({ sourceEvents, contextSnapshot }) => withExplicitRelations(plannerOutputs.shift(), sourceEvents, contextSnapshot) },
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
  const firstPending = first.state.tasks[0];
  assert.equal(first.state.schemaVersion, 3);
  assert.equal(firstPending.taskId, "availability");
  assert.equal(firstPending.taskType, "availability");
  assert.deepEqual(firstPending.missingFields, ["checkIn", "checkOut"]);
  assert.equal(firstPending.status, "needs_clarification");
  assert.equal(Object.hasOwn(first.state, "pendingRequests"), false);
  assert.equal(Object.hasOwn(first.state, "requestCycles"), false);
  assert.equal(JSON.stringify(firstPending).includes("facts"), false);

  const stateBeforeAcknowledgement = JSON.stringify(
    persistence.getConversationState(property.propertyId, "test-line", "same-guest")
  );
  const acknowledgementResult = await engine.process(input("pending-acknowledgement", "thanks"));
  assert.equal(acknowledgementResult.finalDecision.action, "no_reply");
  assert.equal(acknowledgementResult.finalResponse.shouldReply, false);
  assert.equal(calls.availability, 0);
  assert.equal(calls.availableDates, 0);
  assert.equal(
    JSON.stringify(persistence.getConversationState(property.propertyId, "test-line", "same-guest")),
    stateBeforeAcknowledgement,
    "a pending request must not take ownership of an acknowledgement turn"
  );

  const second = await engine.process(input("pending-second", "今天"));
  assert.ok(diagnostics.filter((entry) => entry.stage === "pending_request").some((entry) => entry.action === "resumed"), "the V3 reducer must resume the pending request");
  assert.equal(second.state.tasks.find((item) => item.taskId === firstPending.taskId).checkIn, "2026-07-23", "the validated date must reach V3 state before pending execution");
  assert.equal(calls.availability, 1, "the original availability resolver must run after the missing date is supplied");
  assert.equal(calls.availableDates, 0, "a date-only continuation must not become available_dates");
  assert.equal(second.taskResults[0].type, "availability");
  assert.equal(second.taskResults[0].status, "answered");
  assert.equal(second.state.tasks.find((item) => item.taskId === firstPending.taskId).status, "answered", "the pending request must become answered after execution");

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

  assert.equal(Object.hasOwn(pending, "resumed"), false, "pending data carries identity and scope only; it does not choose a continuation");

  const newlyCreatedOnly = pendingFromResults({
    plannerOutput: plan([availabilityTask({ taskId: "new-pending" })], { missingInformation: ["stay.guests"] }),
    taskResults: [{ taskId: "new-pending", status: "needs_clarification", missingInputs: ["stay.guests"] }],
    conditions: pending.conditions,
    scope: { pendingRequestId: "new-pending-id", requestCycleId: "reducer-approved-cycle", eventId: "new-event", now: "2026-07-23T02:00:00.000Z", previousPendingRequest: pending }
  });
  assert.equal(newlyCreatedOnly.pendingRequestId, "new-pending-id");
  assert.equal(newlyCreatedOnly.requestCycleId, "reducer-approved-cycle");
  assert.deepEqual(newlyCreatedOnly.tasks.map((task) => task.taskId), ["new-pending"], "pendingFromResults may create only the supplied task result; it cannot select an older pending request");

  const gate = diagnostics.find((entry) => entry.stage === "no_reply_gate");
  assert.ok(gate, "every valid planner result must emit a no-reply gate diagnostic");
  assert.equal(typeof gate.reasonCode, "string");
  assert.ok(diagnostics.some((entry) => entry.stage === "semantic_contract"));
  assert.ok(diagnostics.some((entry) => entry.stage === "final_decision"));

  console.log("pending request contract: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
