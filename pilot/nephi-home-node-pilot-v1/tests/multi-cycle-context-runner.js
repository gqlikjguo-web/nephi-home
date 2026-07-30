"use strict";

const assert = require("node:assert/strict");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { createPendingRequest } = require("../lib/conversation-engine-v2/pending-request");
const { buildContextSnapshot } = require("../lib/conversation-engine-v2/contracts");
const { emptyStateV2, migrateStateV2, reduceConversationState, decideContextExecution } = require("../lib/conversation-engine-v2/state-reducer");
const { validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const {
  createConversationStateV3,
  createConversationTaskV3,
  readConversationStateV3
} = require("../lib/conversation-contracts/conversation-state-v3");

const scope = { propertyId: "multi-property", channelId: "multi-channel", lineUserId: "multi-user", now: "2026-07-24T00:00:00.000Z", eventId: "multi-event" };
const task = (candidateIndex, taskId, canonicalCandidate) => ({ candidateIndex, taskId, type: "policy", sourceText: taskId, detailIntent: "general", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "policy", rawText: taskId, canonicalCandidate, confidence: 1 }, confidence: 1 });
const relation = (candidateIndex, stateAction, requestCycleId = null) => ({ candidateIndex, stateAction, requestCycleId });
const decision = (candidateIndex, action, requestCycleId = null) => ({ candidateIndex, action, requestCycleId });
const inputs = (checkIn, roomType, guests) => ({ stay: { checkIn, checkOut: null, nights: 1, guests, searchRange: null }, inventory: { mode: "room_only", entityId: roomType, features: [] }, topic: { capabilityType: "policy", canonicalId: roomType, category: "policy", detailIntent: "general", detailFields: ["answer"] } });

function legacyState() {
  const state = emptyStateV2(scope);
  state.conditions = inputs("2026-08-06", "room-a", 2);
  state.contextCycle = { requestCycleId: "legacy-cycle", requestKind: "availability", status: "answered", confirmedInputs: state.conditions, contextReuseExpiresAt: "2026-07-25T00:00:00.000Z" };
  state.pendingRequest = createPendingRequest({ tasks: [task(0, "legacy-task", "room-a")], conditions: state.conditions, missingFields: ["stay.guests"], clarificationTarget: "stay.guests", scope: { pendingRequestId: "legacy-pending", requestCycleId: "legacy-cycle", eventId: "legacy-event", now: scope.now, expiresAt: "2026-07-25T00:00:00.000Z" } });
  return state;
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function projectStateForLegacyAssertions(state) {
  const projected = clone(state);
  if (!projected || projected.schemaVersion !== 3) return projected;
  const requestCycles = projected.tasks.map((item) => ({
    requestCycleId: item.taskId,
    requestKind: item.taskType,
    status: item.status,
    confirmedInputs: {
      stay: {
        checkIn: item.checkIn,
        checkOut: item.checkOut,
        nights: null,
        guests: item.guestCount,
        searchRange: item.searchFrom && item.searchTo
          ? { from: item.searchFrom, to: item.searchTo }
          : null
      },
      inventory: {
        mode: item.productType === "bundle"
          ? "bundle_only"
          : item.productType === "room_type"
            ? "room_only"
            : "any",
        entityId: item.productId,
        features: []
      },
      topic: {
        capabilityType: item.taskType,
        canonicalId: item.entityId,
        category: item.entityCategory,
        detailIntent: item.detailIntent
      }
    },
    contextReuseExpiresAt: item.expiresAt
  }));
  return {
    ...projected,
    requestCycles,
    pendingRequests: requestCycles.filter((cycle) => {
      const taskValue = projected.tasks.find(
        (item) => item.taskId === cycle.requestCycleId
      );
      return ["pending", "needs_clarification"].includes(taskValue.status);
    }).map((cycle) => {
      const taskValue = projected.tasks.find(
        (item) => item.taskId === cycle.requestCycleId
      );
      return {
        pendingRequestId: taskValue.taskId,
        requestCycleId: taskValue.taskId,
        conditions: cycle.confirmedInputs,
        missingFields: taskValue.missingFields
      };
    })
  };
}
function engineTask(candidateIndex, taskId, type, canonicalCandidate, stayCandidate = type === "availability" ? candidateStay("", null, null) : null, omitStayCandidate = false) {
  return {
    candidateIndex, taskId, type, sourceText: taskId, detailIntent: "general", requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: type === "availability",
    entity: { category: type === "availability" ? "room" : "policy", rawText: taskId, canonicalCandidate, confidence: 1 },
    ...(omitStayCandidate ? {} : { stayCandidate }), confidence: 1
  };
}
function enginePlan({ tasks, relations, dateText = "", checkInCandidate = null, guests = null, missingInformation = [], shouldIgnore = false }) {
  return (sourceEvents) => {
    const source = sourceEvents[0];
    return {
      schemaVersion: 2,
      discourse: { relation: "new_request", confidence: 1 }, stateOperations: [],
      stay: { dateExpression: { rawText: dateText, kind: dateText ? "absolute" : "none", anchor: dateText ? "message_time" : "none" }, checkInCandidate, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: guests },
      tasks,
      contextRelationCandidates: relations.map((relation) => ({
        candidateIndex: relation.candidateIndex, kind: relation.kind, candidateRequestCycleRefs: relation.refs || [],
        evidenceRefs: [{ eventId: source.eventId, startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }]
      })),
      ambiguities: [], missingInformation, needsHuman: false, shouldIgnore, reason: "multi-cycle engine test"
    };
  };
}
function engineHarness(initial = {}) {
  const states = new Map(Object.entries(initial).map(([userId, state]) => [`multi-property:multi-channel:${userId}`, clone(state)]));
  const logs = [];
  const resolverCalls = [];
  const diagnostics = [];
  const plans = [];
  const property = {
    propertyId: "multi-property", displayName: "Multi Cycle Lodge", timezone: "Asia/Taipei", currency: "TWD",
    rooms: [
      { id: "room-a", name: "Room A", type: "Room A", capacity: 2, enabled: true },
      { id: "room-b", name: "Room B", type: "Room B", capacity: 4, enabled: true }
    ],
    commonAnswers: { checkInTime: "15:00", parkingRule: "Parking is available." },
    semanticCatalog: { aliases: { "room-a": ["Room A"], "room-b": ["Room B"], check_in: ["check in"], parking: ["parking"] }, amenities: [] }
  };
  const engine = new ConversationEngineV2({
    planner: { classify: async ({ sourceEvents }) => plans.shift()(sourceEvents) },
    persistence: {
      getConversationState: (propertyId, channelId, userId) => clone(states.get(`${propertyId}:${channelId}:${userId}`) || null),
      setConversationState: (propertyId, channelId, userId, state) => states.set(`${propertyId}:${channelId}:${userId}`, clone(state)),
      appendMessageLog: (_propertyId, item) => { logs.push(clone(item)); return { reviewId: item.needsReview ? `review-${logs.length}` : "" }; }
    },
    getProperty: () => property,
    availabilityResolver: (request) => { resolverCalls.push(clone(request)); return { ...request, availabilityReliable: true, rooms: property.rooms.filter((room) => request.roomType === "all" || room.id === request.roomType), lineUrl: "" }; },
    listPriceOverrides: () => [], now: () => new Date(scope.now), onDiagnostic: (entry) => diagnostics.push(clone(entry))
  });
  return {
    states, logs, resolverCalls, diagnostics,
    queue: (plan) => plans.push(plan),
    state: (userId) => projectStateForLegacyAssertions(
      states.get(`multi-property:multi-channel:${userId}`)
    ),
    process: async (userId, eventId, messageText) => engine.process({ customerId: "multi-property", channelId: "multi-channel", lineUserId: userId, eventId, eventTimestamp: Date.parse(scope.now), messageText })
  };
}
function assertSafeLog(logs) { assert.ok(logs.every((item) => item.processingStatus !== "processing_failed")); }
function cycleById(state, requestCycleId) { return state.requestCycles.find((cycle) => cycle.requestCycleId === requestCycleId); }
function candidateStay(dateText, checkInCandidate, guests, nights = 1) {
  return {
    dateExpression: { rawText: dateText, kind: dateText ? "absolute" : "none", anchor: dateText ? "message_time" : "none" },
    checkInCandidate,
    checkOutCandidate: null,
    nightsCandidate: nights,
    guestCountCandidate: guests
  };
}
function cycleByInventory(state, entityId) { return state.requestCycles.find((cycle) => cycle.confirmedInputs.inventory.entityId === entityId); }

function assertSafeRejection(harness, result, userId) {
  assert.ok(result.replyText.length > 0, "rejected input must receive a non-empty safe reply");
  assert.equal(harness.state(userId) || null, null, "rejected input must not persist conversation state");
  assert.equal(harness.resolverCalls.length, 0, "rejected input must not call a Resolver");
  assertSafeLog(harness.logs);
}

async function explicitStayCandidateContractCoverage() {
  const availabilityStay = candidateStay("8/6", "2026-08-06", 2);
  const relations = [{ candidateIndex: 0, kind: "new_request" }];
  const validAvailability = enginePlan({ tasks: [engineTask(0, "schema-availability", "availability", "room-a", availabilityStay)], relations })([{ eventId: "schema-event", messageText: "schema" }]);
  const missingStayCandidate = clone(validAvailability);
  delete missingStayCandidate.tasks[0].stayCandidate;
  assert.equal(validatePlannerOutput(missingStayCandidate).ok, false, "a task without stayCandidate must fail schema validation");
  const nullAvailability = clone(validAvailability);
  nullAvailability.tasks[0].stayCandidate = null;
  assert.equal(validatePlannerOutput(nullAvailability).ok, false, "a stay-dependent task with null stayCandidate must fail schema validation");
  const nullAmenity = enginePlan({ tasks: [engineTask(0, "schema-amenity", "amenity", "parking", null)], relations })([{ eventId: "schema-event", messageText: "schema" }]);
  assert.equal(validatePlannerOutput(nullAmenity).ok, true, "a non-stay task with null stayCandidate must be valid");
  const objectAmenity = clone(nullAmenity);
  objectAmenity.tasks[0].stayCandidate = availabilityStay;
  assert.equal(validatePlannerOutput(objectAmenity).ok, true, "a non-stay task with a complete stayCandidate must be valid");
  objectAmenity.tasks[0].stayCandidate = { checkInCandidate: "2026-08-06" };
  assert.equal(validatePlannerOutput(objectAmenity).ok, false, "a non-stay task with an incomplete stayCandidate must fail schema validation");

  const topLevelOnly = engineHarness();
  topLevelOnly.queue(enginePlan({
    tasks: [engineTask(0, "top-only-room-a", "availability", "room-a", null), engineTask(1, "top-only-room-b", "availability", "room-b", null)],
    relations: [{ candidateIndex: 0, kind: "new_request" }, { candidateIndex: 1, kind: "new_request" }],
    dateText: "8/6", checkInCandidate: "2026-08-06", guests: 2
  }));
  assertSafeRejection(topLevelOnly, await topLevelOnly.process("top-only", "top-only-event", "8/6 Room A and Room B"), "top-only");

  const oneNullStayDependent = engineHarness();
  oneNullStayDependent.queue(enginePlan({
    tasks: [engineTask(0, "valid-room-a", "availability", "room-a", availabilityStay), engineTask(1, "null-room-b", "availability", "room-b", null)],
    relations: [{ candidateIndex: 0, kind: "new_request" }, { candidateIndex: 1, kind: "new_request" }]
  }));
  assertSafeRejection(oneNullStayDependent, await oneNullStayDependent.process("one-null", "one-null-event", "8/6 Room A and Room B"), "one-null");

  const mixed = engineHarness();
  mixed.queue(enginePlan({
    tasks: [engineTask(0, "valid-room", "availability", "room-a", availabilityStay), engineTask(1, "valid-parking", "amenity", "parking", null)],
    relations: [{ candidateIndex: 0, kind: "new_request" }, { candidateIndex: 1, kind: "new_request" }]
  }));
  const mixedResult = await mixed.process("valid-mixed", "valid-mixed-event", "8/6 Room A and parking");
  assert.ok(mixedResult.replyText.length > 0);
  assert.equal(mixed.resolverCalls.length, 1, "an availability task with an explicit stayCandidate must still execute beside a null amenity candidate");

  const duplicateId = engineHarness();
  const duplicateTasks = [
    engineTask(0, "duplicate-task", "availability", "room-a", candidateStay("8/6", "2026-08-06", 2)),
    engineTask(1, "duplicate-task", "availability", "room-b", candidateStay("8/10", "2026-08-10", 4))
  ];
  const duplicatePlan = enginePlan({
    tasks: duplicateTasks,
    relations: [
      { candidateIndex: 0, kind: "new_request" },
      { candidateIndex: 1, kind: "new_request" }
    ]
  });
  assert.ok(
    validatePlannerOutput(duplicatePlan([{
      eventId: "duplicate-task-event",
      messageText: "Room A and Room B"
    }])).errors.includes("tasks.taskId.duplicate"),
    "same-turn duplicate Planner task IDs must fail the schema boundary"
  );
  duplicateId.queue(duplicatePlan);
  assertSafeRejection(
    duplicateId,
    await duplicateId.process(
      "duplicate-task",
      "duplicate-task-event",
      "Room A and Room B"
    ),
    "duplicate-task"
  );

  for (const [entityCategory, entityId] of [
    ["room", "missing-room"],
    ["bundle", "missing-bundle"]
  ]) {
    const unresolved = engineHarness();
    const unresolvedTask = engineTask(
      0,
      `unresolved-${entityCategory}`,
      "availability",
      entityId,
      candidateStay("8/6", "2026-08-06", 2)
    );
    unresolvedTask.entity.category = entityCategory;
    unresolvedTask.sourceText = `8/6 unknown ${entityCategory}`;
    unresolved.queue(enginePlan({
      tasks: [unresolvedTask],
      relations: [{ candidateIndex: 0, kind: "new_request" }]
    }));
    const result = await unresolved.process(
      `unresolved-${entityCategory}`,
      `unresolved-${entityCategory}-event`,
      `8/6 unknown ${entityCategory}`
    );
    const persisted = unresolved.states.get(
      `multi-property:multi-channel:unresolved-${entityCategory}`
    );
    assert.ok(result.replyText.length > 0);
    assert.equal(unresolved.resolverCalls.length, 0);
    assert.equal(
      persisted.tasks[0].status,
      "needs_human",
      JSON.stringify({
        entityCategory,
        taskResults: result.taskResults,
        persisted,
        diagnostics: unresolved.diagnostics
      })
    );
  }

  const singleLegacy = engineHarness();
  singleLegacy.queue(enginePlan({
    tasks: [engineTask(0, "legacy-single", "availability", "room-a", undefined, true)],
    relations,
    dateText: "8/6", checkInCandidate: "2026-08-06", guests: 2
  }));
  const legacyResult = await singleLegacy.process("legacy-single", "legacy-single-event", "8/6 Room A");
  assert.ok(legacyResult.replyText.length > 0);
  assert.deepEqual(singleLegacy.resolverCalls.map((call) => [call.roomType, call.checkIn, call.guests]), [["room-a", "2026-08-06", 2]], "a one-task legacy top-level stay must be mechanically compatible");
}

async function perCandidateConditionsCoverage() {
  const roomAStay = candidateStay("8/6", "2026-08-06", 2);
  const roomBStay = candidateStay("8/10", "2026-08-10", 4);
  const tasks = [
    engineTask(0, "candidate-room-a", "availability", "room-a", roomAStay),
    engineTask(1, "candidate-room-b", "availability", "room-b", roomBStay)
  ];
  const relations = [{ candidateIndex: 0, kind: "new_request" }, { candidateIndex: 1, kind: "new_request" }];
  const harness = engineHarness();
  harness.queue(enginePlan({ tasks, relations }));
  const result = await harness.process("candidate-pair", "candidate-pair-event", "8/6 Room A and 8/10 Room B");
  const state = harness.state("candidate-pair");
  const cycleA = cycleByInventory(state, "room-a");
  const cycleB = cycleByInventory(state, "room-b");
  assert.ok(result.replyText.length > 0);
  assert.ok(cycleA && cycleB, "each candidate must retain its own resolved inventory conditions");
  assert.equal(cycleA.confirmedInputs.stay.checkIn, "2026-08-06");
  assert.equal(cycleA.confirmedInputs.stay.guests, 2);
  assert.equal(cycleB.confirmedInputs.stay.checkIn, "2026-08-10");
  assert.equal(cycleB.confirmedInputs.stay.guests, 4);
  assert.deepEqual(harness.resolverCalls.map((call) => [call.roomType, call.checkIn, call.guests]).sort(), [
    ["room-a", "2026-08-06", 2],
    ["room-b", "2026-08-10", 4]
  ]);
  assert.equal(state.pendingRequests.length, 0);

  const reordered = engineHarness();
  reordered.queue(enginePlan({ tasks: [tasks[1], tasks[0]], relations: [relations[1], relations[0]] }));
  await reordered.process("candidate-pair", "candidate-pair-reordered", "8/10 Room B and 8/6 Room A");
  const reorderedState = reordered.state("candidate-pair");
  assert.equal(cycleByInventory(reorderedState, "room-a").confirmedInputs.stay.checkIn, "2026-08-06", "candidate alignment must not use task or relation array order");
  assert.equal(cycleByInventory(reorderedState, "room-b").confirmedInputs.stay.checkIn, "2026-08-10", "candidate alignment must not use task or relation array order");

  const mixed = engineHarness();
  mixed.queue(enginePlan({
    tasks: [engineTask(0, "mixed-answer", "availability", "room-a", roomAStay), engineTask(1, "mixed-pending", "availability", "room-b", candidateStay("", null, 4))],
    relations
  }));
  await mixed.process("mixed", "mixed-event", "8/6 Room A and Room B");
  const mixedState = mixed.state("mixed");
  const mixedA = cycleByInventory(mixedState, "room-a");
  const mixedB = cycleByInventory(mixedState, "room-b");
  assert.ok(mixedA && mixedB);
  assert.equal(mixedState.pendingRequests.length, 1, "only the incomplete candidate may create a pending request");
  assert.equal(mixedState.pendingRequests[0].requestCycleId, mixedB.requestCycleId);
  assert.deepEqual(mixed.resolverCalls.map((call) => call.roomType), ["room-a"], "a complete candidate must not execute with another candidate's missing conditions");

  const twoPending = engineHarness();
  twoPending.queue(enginePlan({
    tasks: [engineTask(0, "pending-room-a", "availability", "room-a", candidateStay("", null, 2)), engineTask(1, "pending-room-b", "availability", "room-b", candidateStay("", null, 4))],
    relations
  }));
  await twoPending.process("two-pending", "two-pending-event", "Room A and Room B");
  const pendingState = twoPending.state("two-pending");
  assert.equal(pendingState.pendingRequests.length, 2, "two incomplete candidates require two cycle-scoped pending requests");
  assert.deepEqual(pendingState.pendingRequests.map((pending) => [pending.requestCycleId, pending.conditions.inventory.entityId]).sort((left, right) => left[1].localeCompare(right[1])), [
    [cycleByInventory(pendingState, "room-a").requestCycleId, "room-a"],
    [cycleByInventory(pendingState, "room-b").requestCycleId, "room-b"]
  ]);
  assert.equal(twoPending.resolverCalls.length, 0);

  const ambiguousLegacy = engineHarness();
  ambiguousLegacy.queue(enginePlan({
    tasks: [engineTask(0, "legacy-room-a", "availability", "room-a", undefined, true), engineTask(1, "legacy-room-b", "availability", "room-b", undefined, true)],
    relations,
    dateText: "8/6", checkInCandidate: "2026-08-06", guests: 2
  }));
  const legacyResult = await ambiguousLegacy.process("ambiguous-legacy", "ambiguous-legacy-event", "8/6 Room A and Room B");
  assert.ok(legacyResult.replyText.length > 0);
  assert.equal(ambiguousLegacy.resolverCalls.length, 0, "a multi-candidate legacy top-level stay must not be guessed onto either candidate");
  assert.equal(ambiguousLegacy.state("ambiguous-legacy") || null, null, "an ambiguous legacy top-level stay must leave state unchanged");

  const singleLegacy = engineHarness();
  singleLegacy.queue(enginePlan({
    tasks: [engineTask(0, "single-legacy-room", "availability", "room-a", undefined, true)],
    relations: [{ candidateIndex: 0, kind: "new_request" }],
    dateText: "8/6", checkInCandidate: "2026-08-06", guests: 2
  }));
  await singleLegacy.process("single-legacy", "single-legacy-event", "8/6 Room A");
  assert.deepEqual(singleLegacy.resolverCalls.map((call) => [call.roomType, call.checkIn, call.guests]), [["room-a", "2026-08-06", 2]], "a single candidate may mechanically retain legacy top-level stay compatibility");
}

async function engineEndToEndCoverage() {
  const sameTurn = engineHarness();
  sameTurn.queue(enginePlan({
    tasks: [engineTask(0, "same-room-a", "availability", "room-a"), engineTask(1, "same-room-b", "availability", "room-b")],
    relations: [{ candidateIndex: 0, kind: "new_request" }, { candidateIndex: 1, kind: "new_request" }]
  }));
  const sameTurnResult = await sameTurn.process("same-turn", "same-turn-1", "check in and parking");
  const sameTurnState = sameTurn.state("same-turn");
  assert.ok(sameTurnState, `same-turn state was not persisted: ${JSON.stringify({ sameTurnResult, diagnostics: sameTurn.diagnostics })}`);
  assert.ok(sameTurnResult.replyText.length > 0);
  assert.equal(sameTurnState.requestCycles.length, 2, "one Engine turn must persist two independent cycles");
  assert.notEqual(sameTurnState.requestCycles[0].requestCycleId, sameTurnState.requestCycles[1].requestCycleId);
  assertSafeLog(sameTurn.logs);

  const harness = engineHarness();
  harness.queue(enginePlan({ tasks: [engineTask(0, "need-room-b", "availability", "room-b")], relations: [{ candidateIndex: 0, kind: "new_request" }], missingInformation: ["stay.checkIn"] }));
  const pendingResult = await harness.process("guest", "b-pending", "Need Room B");
  assert.ok(pendingResult.replyText.length > 0);
  const afterPending = harness.state("guest");
  const pendingB = afterPending.pendingRequests[0];
  const cycleBId = pendingB.requestCycleId;
  assert.ok(cycleBId && cycleById(afterPending, cycleBId));

  harness.queue(enginePlan({ tasks: [engineTask(0, "room-a", "availability", "room-a", candidateStay("8/6", "2026-08-06", 2))], relations: [{ candidateIndex: 0, kind: "new_request" }], dateText: "8/6", checkInCandidate: "2026-08-06", guests: 2 }));
  const answerA = await harness.process("guest", "a-answer", "8/6 Room A for two");
  const afterA = harness.state("guest");
  const cycleA = afterA.requestCycles.find((cycle) => cycle.requestCycleId !== cycleBId);
  const cycleBBefore = clone(cycleById(afterA, cycleBId));
  const pendingBBefore = clone(afterA.pendingRequests.find((pending) => pending.requestCycleId === cycleBId));
  assert.ok(answerA.replyText.length > 0 && answerA.replyText.includes("Room A"));
  assert.equal(answerA.replyText.includes("Room B"), false, "dormant B must not appear in an unrelated A reply");
  assert.deepEqual(cycleById(afterA, cycleBId), cycleBBefore, "answering A must not mutate B");
  assert.deepEqual(afterA.pendingRequests.find((pending) => pending.requestCycleId === cycleBId), pendingBBefore, "answering A must retain B pending");
  assert.equal(cycleA.confirmedInputs.stay.checkIn, "2026-08-06");
  assert.equal(cycleA.confirmedInputs.stay.guests, 2);
  assert.equal(cycleBBefore.confirmedInputs.stay.checkIn, null, "A date must not copy into B");
  assert.equal(cycleBBefore.confirmedInputs.stay.guests, null, "A guests must not copy into B");
  assert.deepEqual(harness.resolverCalls.map((call) => call.roomType), ["room-a"], "dormant B must not cause an unrelated Resolver call");

  const reorderedRaw = clone(harness.states.get("multi-property:multi-channel:guest"));
  reorderedRaw.tasks.reverse();
  harness.states.set("multi-property:multi-channel:guest", reorderedRaw);
  const reordered = harness.state("guest");
  const cycleABeforeB = clone(cycleById(reordered, cycleA.requestCycleId));
  harness.queue(enginePlan({ tasks: [engineTask(0, "room-b-return", "availability", "room-b", candidateStay("8/10", "2026-08-10", 4))], relations: [{ candidateIndex: 0, kind: "supplement_existing", refs: [cycleBId] }], dateText: "8/10", checkInCandidate: "2026-08-10", guests: 4 }));
  const answerB = await harness.process("guest", "b-answer", "8/10 Room B for four");
  const afterB = harness.state("guest");
  const cycleBAfter = cycleById(afterB, cycleBId);
  assert.ok(answerB.replyText.length > 0 && answerB.replyText.includes("Room B"));
  assert.deepEqual(cycleById(afterB, cycleA.requestCycleId), cycleABeforeB, "reordered collection must still update B by ID, not array position");
  assert.equal(cycleBAfter.confirmedInputs.stay.checkIn, "2026-08-10");
  assert.equal(cycleBAfter.confirmedInputs.stay.guests, 4);
  assert.equal(afterB.pendingRequests.some((pending) => pending.requestCycleId === cycleBId), false, "answering B clears only B pending");
  assert.deepEqual(harness.resolverCalls.map((call) => call.roomType), ["room-a", "room-b"]);
  assertSafeLog(harness.logs);
  assert.equal(Object.hasOwn(afterB, "contextCycle"), false);
  assert.equal(Object.hasOwn(afterB, "pendingRequest"), false);

  const uncertainBefore = clone(afterB);
  harness.queue(enginePlan({ tasks: [engineTask(0, "uncertain", "policy", "parking")], relations: [{ candidateIndex: 0, kind: "relation_uncertain" }] }));
  const uncertain = await harness.process("guest", "uncertain", "uncertain follow-up");
  const uncertainAfter = harness.state("guest");
  assert.ok(uncertain.replyText.length > 0);
  for (const priorCycle of uncertainBefore.requestCycles) {
    assert.deepEqual(
      cycleById(uncertainAfter, priorCycle.requestCycleId),
      priorCycle,
      "uncertain relation must not modify any existing cycle"
    );
  }
  assert.deepEqual(uncertainAfter.pendingRequests, uncertainBefore.pendingRequests, "uncertain relation must not modify any pending request");
  assertSafeLog(harness.logs);

  const legacyPendingHarness = engineHarness();
  const legacyPending = createPendingRequest({ tasks: [{ ...task(0, "legacy-pending", "room-b"), type: "availability", dependsOnStayContext: true, entity: { category: "room", rawText: "room-b", canonicalCandidate: "room-b", confidence: 1 } }], conditions: inputs(null, "room-b", null), missingFields: ["stay.checkIn"], clarificationTarget: "stay.checkIn", scope: { pendingRequestId: "legacy-only-pending", requestCycleId: "legacy-pending-cycle", eventId: "legacy", now: scope.now, expiresAt: "2026-07-25T00:00:00.000Z" } });
  legacyPendingHarness.states.set("multi-property:multi-channel:legacy-pending", { schemaVersion: 2, scope: { propertyId: "multi-property", channelId: "multi-channel", lineUserId: "legacy-pending" }, pendingRequest: legacyPending });
  legacyPendingHarness.queue(enginePlan({ tasks: [engineTask(0, "legacy-safe", "policy", "parking")], relations: [{ candidateIndex: 0, kind: "relation_uncertain" }] }));
  const migratedPendingResult = await legacyPendingHarness.process("legacy-pending", "legacy-pending-event", "parking");
  const migratedPendingState = legacyPendingHarness.state("legacy-pending");
  assert.ok(migratedPendingResult.replyText.length > 0);
  assert.deepEqual(
    migratedPendingState.requestCycles.map((cycle) => cycle.requestCycleId),
    ["legacy-pending-cycle", "legacy-safe"]
  );
  assert.equal(migratedPendingState.pendingRequests[0].requestCycleId, "legacy-pending-cycle");
  assert.equal(Object.hasOwn(migratedPendingState, "contextCycle"), false);
  assert.equal(Object.hasOwn(migratedPendingState, "pendingRequest"), false);

  const legacyBothHarness = engineHarness();
  legacyBothHarness.states.set("multi-property:multi-channel:legacy-both", { schemaVersion: 2, scope: { propertyId: "multi-property", channelId: "multi-channel", lineUserId: "legacy-both" }, contextCycle: { requestCycleId: "legacy-both-cycle", requestKind: "availability", status: "active", confirmedInputs: inputs("2026-08-06", "room-b", 2), contextReuseExpiresAt: "2026-07-25T00:00:00.000Z" }, pendingRequest: { ...legacyPending, pendingRequestId: "legacy-both-pending", requestCycleId: "legacy-both-cycle" } });
  legacyBothHarness.queue(enginePlan({ tasks: [engineTask(0, "legacy-both-safe", "policy", "parking")], relations: [{ candidateIndex: 0, kind: "relation_uncertain" }] }));
  await legacyBothHarness.process("legacy-both", "legacy-both-event", "parking");
  const migratedBoth = legacyBothHarness.state("legacy-both");
  const reloadedBoth = projectStateForLegacyAssertions(readConversationStateV3(
    clone(legacyBothHarness.states.get("multi-property:multi-channel:legacy-both")),
    {
      propertyId: scope.propertyId,
      channel: scope.channelId,
      userId: "legacy-both"
    },
    scope.now
  ));
  assert.deepEqual(reloadedBoth.requestCycles, migratedBoth.requestCycles, "legacy cycle and pending IDs must survive reload");
  assert.deepEqual(reloadedBoth.pendingRequests, migratedBoth.pendingRequests, "legacy pending binding must survive reload");
  assertSafeLog(legacyPendingHarness.logs);
  assertSafeLog(legacyBothHarness.logs);

  const endState = createConversationStateV3({
    propertyId: "multi-property",
    channel: "multi-channel",
    userId: "end-pending",
    tasks: [
      createConversationTaskV3({
        taskId: "end-pricing",
        taskType: "pricing",
        productType: "any",
        productId: null,
        roomTypeId: null,
        bundleId: null,
        checkIn: null,
        checkOut: null,
        guestCount: null,
        entityId: null,
        entityCategory: null,
        detailIntent: "general",
        knownFields: ["productType"],
        missingFields: ["checkIn", "checkOut"],
        status: "pending",
        createdAt: scope.now,
        updatedAt: scope.now,
        expiresAt: "2026-07-25T00:00:00.000Z"
      }),
      createConversationTaskV3({
        taskId: "end-parking",
        taskType: "parking",
        productType: "any",
        productId: null,
        roomTypeId: null,
        bundleId: null,
        checkIn: null,
        checkOut: null,
        guestCount: null,
        entityId: "parking",
        entityCategory: "amenity",
        detailIntent: "general",
        knownFields: ["productType"],
        missingFields: [],
        status: "answered",
        createdAt: scope.now,
        updatedAt: scope.now,
        expiresAt: "2026-07-25T00:00:00.000Z"
      })
    ],
    createdAt: scope.now,
    updatedAt: scope.now,
    expiresAt: "2026-07-25T00:00:00.000Z"
  });
  const endHarness = engineHarness({ "end-pending": endState });
  endHarness.queue(enginePlan({
    tasks: [{
      candidateIndex: 0,
      taskId: "end-current",
      type: "unknown",
      sourceText: "cancel that",
      detailIntent: "general",
      requestedOutputs: ["answer"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: {
        category: "other",
        rawText: "cancel that",
        canonicalCandidate: null,
        confidence: 1
      },
      stayCandidate: null,
      confidence: 1
    }],
    relations: [{
      candidateIndex: 0,
      kind: "end_existing",
      refs: ["end-pricing"]
    }],
    shouldIgnore: true
  }));
  const endResult = await endHarness.process(
    "end-pending",
    "end-pending-event",
    "cancel that"
  );
  const endedState = endHarness.states.get(
    "multi-property:multi-channel:end-pending"
  );
  assert.equal(endResult.noReply, true);
  assert.equal(
    endedState.tasks.find((item) => item.taskId === "end-pricing").status,
    "cancelled",
    "a silent end turn must cancel the referenced pending task"
  );
  assert.equal(
    endedState.tasks.find((item) => item.taskId === "end-parking").status,
    "answered",
    "a silent end turn must preserve unrelated tasks"
  );
}

async function main() {
  const migrated = migrateStateV2(legacyState(), scope);
  assert.deepEqual(migrated.requestCycles.map((cycle) => cycle.requestCycleId), ["legacy-cycle"], "legacy single contextCycle must migrate mechanically into requestCycles");
  assert.deepEqual(migrated.pendingRequests.map((pending) => pending.pendingRequestId), ["legacy-pending"], "legacy single pendingRequest must migrate mechanically into pendingRequests");
  assert.equal(Object.hasOwn(migrated, "contextCycle"), false, "migrated state must not retain a second context authority");
  assert.equal(Object.hasOwn(migrated, "pendingRequest"), false, "migrated state must not retain a second pending authority");

  const started = reduceConversationState(emptyStateV2(scope), {
    contextDecisions: [decision(0, "start", "cycle-a"), decision(1, "start", "cycle-b")],
    tasks: [task(0, "task-a", "room-a"), task(1, "task-b", "room-b")],
    cycleInputsByCandidateIndex: { 0: inputs("2026-08-06", "room-a", 2), 1: inputs("2026-08-10", "room-b", 4) }
  }, scope);
  assert.deepEqual(started.requestCycles.map((cycle) => cycle.requestCycleId), ["cycle-a", "cycle-b"], "one turn may create two independent request cycles");
  assert.equal(started.requestCycles[0].confirmedInputs.stay.checkIn, "2026-08-06");
  assert.equal(started.requestCycles[1].confirmedInputs.stay.checkIn, "2026-08-10");
  assert.equal(started.requestCycles[0].confirmedInputs.inventory.entityId, "room-a");
  assert.equal(started.requestCycles[1].confirmedInputs.inventory.entityId, "room-b");

  const pendingA = createPendingRequest({ tasks: [task(0, "pending-a", "room-a")], conditions: started.requestCycles[0].confirmedInputs, missingFields: ["stay.guests"], clarificationTarget: "stay.guests", scope: { pendingRequestId: "pending-a", requestCycleId: "cycle-a", eventId: "a", now: scope.now, expiresAt: "2026-07-25T00:00:00.000Z" } });
  const multi = { ...started, pendingRequests: [pendingA] };
  const execution = decideContextExecution(multi, [relation(0, "start", "cycle-c")], [task(0, "task-c", "room-c")]);
  assert.equal(execution.resumedPending, false, "an unrelated new request must not resume dormant pending work");
  assert.deepEqual(execution.executionTasks.map((item) => item.taskId), ["task-c"], "dormant pending must not enter an unrelated response");
  const afterNew = reduceConversationState(multi, { contextDecisions: execution.contextDecisions, tasks: [task(0, "task-c", "room-c")], cycleInputsByCandidateIndex: { 0: inputs("2026-08-12", "room-c", 3) } }, { ...scope, eventId: "new-event" });
  assert.deepEqual(afterNew.pendingRequests.map((pending) => pending.pendingRequestId), ["pending-a"], "new work must not clear an unrelated pending request");

  const continued = reduceConversationState(afterNew, { contextDecisions: [decision(0, "continue", "cycle-b")], tasks: [task(0, "task-b-followup", "room-b")], cycleInputsByCandidateIndex: { 0: inputs("2026-08-10", "room-b", 5) } }, { ...scope, eventId: "continue-b" });
  const cycleA = continued.requestCycles.find((cycle) => cycle.requestCycleId === "cycle-a");
  const cycleB = continued.requestCycles.find((cycle) => cycle.requestCycleId === "cycle-b");
  assert.equal(cycleA.confirmedInputs.stay.guests, 2, "updating B must not overwrite A inputs");
  assert.equal(cycleB.confirmedInputs.stay.guests, 5, "explicitly referenced B alone may update");

  const snapshot = buildContextSnapshot(continued, scope);
  assert.equal(snapshot.cycles.length, 3, "answered and pending-backed active cycles must persist and reload as one scoped collection");
  assert.deepEqual(snapshot.cycles.filter((cycle) => ["cycle-a", "cycle-b"].includes(cycle.requestCycleId)).map((cycle) => cycle.requestCycleId).sort(), ["cycle-a", "cycle-b"]);
  const reloaded = migrateStateV2(JSON.parse(JSON.stringify(continued)), scope);
  assert.deepEqual(reloaded.requestCycles, continued.requestCycles, "collection state must survive serialization and reload exactly");
  assert.deepEqual(buildContextSnapshot(reloaded, { ...scope, propertyId: "other-property" }).cycles, [], "property/channel/user scope must isolate all cycles");

  const uncertain = reduceConversationState(continued, { contextDecisions: [decision(0, "none", null)], tasks: [task(0, "uncertain", "room-x")] }, { ...scope, eventId: "uncertain-event" });
  assert.deepEqual(uncertain.requestCycles, continued.requestCycles, "relation uncertainty must leave every existing cycle unchanged");
  assert.deepEqual(uncertain.pendingRequests, continued.pendingRequests, "relation uncertainty must leave dormant pending unchanged");

  await explicitStayCandidateContractCoverage();
  await perCandidateConditionsCoverage();
  await engineEndToEndCoverage();

  console.log("multi-cycle context: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
