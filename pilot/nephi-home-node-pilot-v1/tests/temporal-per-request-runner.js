"use strict";

const assert = require("node:assert/strict");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { emptyStateV2 } = require("../lib/conversation-engine-v2/state-reducer");
const { resolveTemporalExpression } = require("../lib/conversation-engine-v2/temporal-resolver");

const NOW = "2026-07-24T00:00:00.000Z";
const PROPERTY_ID = "temporal-property";
const CHANNEL_ID = "temporal-channel";

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function stay({ rawText = "", kind = "none", checkInCandidate = null, checkOutCandidate = null, nightsCandidate = null, guestCountCandidate = null } = {}) {
  return { dateExpression: { rawText, kind, anchor: rawText ? "message_time" : "none" }, checkInCandidate, checkOutCandidate, nightsCandidate, guestCountCandidate };
}
function availabilityTask(candidateIndex, roomId, stayCandidate) {
  return {
    candidateIndex, taskId: `availability-${candidateIndex}-${roomId}`, type: "availability", sourceText: `availability ${roomId}`,
    detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: true, entity: { category: "room", rawText: roomId, canonicalCandidate: roomId, confidence: 1 },
    stayCandidate, confidence: 1
  };
}
function plan(tasks, relations) {
  return (sourceEvents) => {
    const source = sourceEvents[0];
    return {
      schemaVersion: 2,
      discourse: { relation: "new_request", confidence: 1 }, stateOperations: [],
      stay: stay(), tasks,
      contextRelationCandidates: relations.map((relation) => ({
        candidateIndex: relation.candidateIndex,
        kind: relation.kind,
        candidateRequestCycleRefs: relation.refs || [],
        evidenceRefs: [{ eventId: source.eventId, startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }]
      })),
      ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "temporal per request test"
    };
  };
}
function inputs(roomId, checkIn, checkOut, nights, guests) {
  return {
    stay: { checkIn, checkOut, nights, guests, searchRange: null },
    inventory: { mode: "room_only", entityId: roomId, features: [] },
    topic: { capabilityType: "availability", canonicalId: roomId, category: "room", detailIntent: "general", detailFields: ["answer"] }
  };
}
function cycle(id, roomId, checkIn, checkOut, nights, guests, status = "answered") {
  return {
    requestCycleId: id, requestKind: "availability", status,
    confirmedInputs: inputs(roomId, checkIn, checkOut, nights, guests),
    temporalResult: null,
    createdAt: NOW, updatedAt: NOW, contextReuseExpiresAt: "2026-07-25T00:00:00.000Z"
  };
}
function stateFor(userId, cycles) {
  const state = emptyStateV2({ propertyId: PROPERTY_ID, channelId: CHANNEL_ID, lineUserId: userId, now: NOW });
  state.requestCycles = cycles;
  return state;
}
function cycleById(state, id) { return state.requestCycles.find((item) => item.requestCycleId === id); }
function harness(initial = {}) {
  const states = new Map(Object.entries(initial).map(([userId, state]) => [`${PROPERTY_ID}:${CHANNEL_ID}:${userId}`, clone(state)]));
  const plans = [];
  const calls = [];
  const logs = [];
  const diagnostics = [];
  const property = {
    propertyId: PROPERTY_ID, displayName: "Temporal Test Lodge", timezone: "Asia/Taipei", currency: "TWD",
    rooms: [{ id: "room-a", name: "Room A", type: "Room A", capacity: 2, enabled: true }, { id: "room-b", name: "Room B", type: "Room B", capacity: 4, enabled: true }],
    commonAnswers: { parkingRule: "Parking." }, semanticCatalog: { aliases: { "room-a": ["room-a"], "room-b": ["room-b"] }, amenities: [] }
  };
  const engine = new ConversationEngineV2({
    planner: { classify: async ({ sourceEvents }) => plans.shift()(sourceEvents) },
    persistence: {
      getConversationState: (_propertyId, _channelId, userId) => clone(states.get(`${PROPERTY_ID}:${CHANNEL_ID}:${userId}`) || null),
      setConversationState: (_propertyId, _channelId, userId, value) => states.set(`${PROPERTY_ID}:${CHANNEL_ID}:${userId}`, clone(value)),
      appendMessageLog: (_propertyId, value) => { logs.push(clone(value)); return { reviewId: value.needsReview ? `review-${logs.length}` : "" }; }
    },
    getProperty: () => property,
    availabilityResolver: (request) => { calls.push(clone(request)); return { ...request, availabilityReliable: true, rooms: property.rooms.filter((room) => room.id === request.roomType), lineUrl: "" }; },
    listPriceOverrides: () => [], now: () => new Date(NOW), onDiagnostic: (entry) => diagnostics.push(clone(entry))
  });
  return {
    calls, logs, diagnostics,
    queue: (value) => plans.push(value),
    state: (userId) => clone(states.get(`${PROPERTY_ID}:${CHANNEL_ID}:${userId}`)),
    process: (userId, eventId, messageText) => engine.process({ customerId: PROPERTY_ID, channelId: CHANNEL_ID, lineUserId: userId, eventId, eventTimestamp: Date.parse(NOW), messageText })
  };
}
function assertSafe(result, testHarness) {
  assert.ok(result.replyText.length > 0, "a temporal rejection must produce a non-empty safe reply");
  assert.ok(testHarness.logs.every((item) => item.processingStatus !== "processing_failed"), "a temporal rejection must never write processing_failed");
}
function temporalItems(testHarness) { return testHarness.diagnostics.filter((entry) => entry.stage === "temporal").at(-1).items; }

async function perCandidateIsolation() {
  const testHarness = harness();
  const tasks = [
    availabilityTask(0, "room-a", stay({ rawText: "8/6", kind: "absolute", checkInCandidate: "2026-08-06", nightsCandidate: 1, guestCountCandidate: 2 })),
    availabilityTask(1, "room-b", stay({ rawText: "8/10", kind: "absolute", checkInCandidate: "2026-08-10", nightsCandidate: 2, guestCountCandidate: 4 }))
  ];
  testHarness.queue(plan(tasks, [{ candidateIndex: 0, kind: "new_request" }, { candidateIndex: 1, kind: "new_request" }]));
  const result = await testHarness.process("pair", "pair-event", "two requests");
  const state = testHarness.state("pair");
  assert.ok(result.replyText.length > 0);
  assert.deepEqual(testHarness.calls.map((item) => [item.roomType, item.checkIn, item.checkOut, item.guests]).sort(), [
    ["room-a", "2026-08-06", "2026-08-07", 2],
    ["room-b", "2026-08-10", "2026-08-12", 4]
  ]);
  assert.equal(state.requestCycles.length, 2);
  const items = temporalItems(testHarness).sort((left, right) => left.candidateIndex - right.candidateIndex);
  assert.equal(items.length, 2, "each candidate must emit an independent TemporalResult trace item");
  assert.equal(items[0].requestCycleId === items[1].requestCycleId, false);
  assert.equal(items[0].resolutionStatus, "resolved");
  assert.equal(items[1].resolutionStatus, "resolved");
}

async function contextReuseAndIsolation() {
  const userId = "reuse";
  const initial = stateFor(userId, [
    cycle("cycle-a", "room-a", "2026-08-06", "2026-08-07", 1, 2),
    cycle("cycle-b", "room-b", "2026-08-10", "2026-08-12", 2, 4)
  ]);
  const testHarness = harness({ [userId]: initial });
  testHarness.queue(plan([availabilityTask(7, "room-b", stay({ guestCountCandidate: 4 }))], [{ candidateIndex: 7, kind: "supplement_existing", refs: ["cycle-b"] }]));
  const result = await testHarness.process(userId, "reuse-event", "follow up");
  const state = testHarness.state(userId);
  assert.ok(result.replyText.length > 0);
  assert.deepEqual(testHarness.calls.map((item) => [item.roomType, item.checkIn, item.checkOut, item.guests]), [["room-b", "2026-08-10", "2026-08-12", 4]], "a relation to B must only reuse B temporal context");
  assert.deepEqual(cycleById(state, "cycle-a"), initial.requestCycles[0], "reusing B must leave A completely unchanged");
  const item = temporalItems(testHarness)[0];
  assert.equal(item.resolutionStatus, "resolved", "context reuse must be a resolved TemporalResult, not an implicit state side effect");
  assert.equal(item.provenance.checkIn, "context");
  assert.equal(item.provenance.checkOut, "context");
}

async function failedDatesDoNotReuseOrMutate() {
  const userId = "reject";
  const initial = stateFor(userId, [cycle("cycle-a", "room-a", "2026-08-06", "2026-08-07", 1, 2)]);
  const cases = [
    ["invalid", stay({ rawText: "2/30", kind: "absolute", checkInCandidate: "2026-02-30", nightsCandidate: 1, guestCountCandidate: 2 })],
    ["unresolved", stay({ rawText: "someday", kind: "weekday", nightsCandidate: 1, guestCountCandidate: 2 })],
    ["conflicting", stay({ rawText: "8/10", kind: "absolute", checkInCandidate: "2026-08-10", checkOutCandidate: "2026-08-09", nightsCandidate: 1, guestCountCandidate: 2 })]
  ];
  for (const [expectedStatus, candidate] of cases) {
    const testHarness = harness({ [userId]: initial });
    testHarness.queue(plan([availabilityTask(3, "room-a", candidate)], [{ candidateIndex: 3, kind: "supplement_existing", refs: ["cycle-a"] }]));
    const result = await testHarness.process(userId, `${expectedStatus}-event`, expectedStatus);
    assertSafe(result, testHarness);
    assert.equal(testHarness.calls.length, 0, `${expectedStatus} dates must not call a date-dependent Resolver`);
    assert.deepEqual(cycleById(testHarness.state(userId), "cycle-a").confirmedInputs, initial.requestCycles[0].confirmedInputs, `${expectedStatus} dates must not overwrite confirmed cycle dates`);
    assert.equal(testHarness.state(userId).pendingRequests.length, 1, `${expectedStatus} dates must create only the cycle-scoped clarification pending`);
    assert.equal(testHarness.state(userId).pendingRequests[0].requestCycleId, "cycle-a");
    assert.equal(temporalItems(testHarness)[0].resolutionStatus, expectedStatus);
  }
}

async function noRelationAndIneligibleCyclesCannotReuse() {
  const userId = "ineligible";
  const initial = stateFor(userId, [cycle("cycle-a", "room-a", "2026-08-06", "2026-08-07", 1, 2)]);
  const noRelation = harness({ [userId]: initial });
  noRelation.queue(plan([availabilityTask(0, "room-a", stay({ guestCountCandidate: 2 }))], [{ candidateIndex: 0, kind: "relation_uncertain" }]));
  const noRelationResult = await noRelation.process(userId, "no-relation", "uncertain");
  assertSafe(noRelationResult, noRelation);
  assert.equal(noRelation.calls.length, 0);
  assert.deepEqual(noRelation.state(userId).requestCycles, initial.requestCycles);
  assert.deepEqual(noRelation.state(userId).pendingRequests, initial.pendingRequests);

  for (const status of ["ended", "expired"]) {
    const scopedState = clone(initial);
    scopedState.requestCycles[0].status = status;
    const testHarness = harness({ [userId]: scopedState });
    testHarness.queue(plan([availabilityTask(0, "room-a", stay({ guestCountCandidate: 2 }))], [{ candidateIndex: 0, kind: "supplement_existing", refs: ["cycle-a"] }]));
    const result = await testHarness.process(userId, `${status}-event`, status);
    assertSafe(result, testHarness);
    assert.equal(testHarness.calls.length, 0);
    assert.deepEqual(testHarness.state(userId).requestCycles, scopedState.requestCycles);
    assert.deepEqual(testHarness.state(userId).pendingRequests, scopedState.pendingRequests);
  }
}

function temporalContract() {
  const explicit = resolveTemporalExpression({ rawText: "8/6", kind: "absolute", anchor: "message_time" }, { eventTimestamp: Date.parse(NOW), timezone: "Asia/Taipei", checkInCandidate: "2026-08-06", defaultNights: 1, defaultNightsRuleRef: "PRODUCT_BASELINE:single_date_availability_default_one_night" });
  assert.equal(explicit.resolutionStatus, "resolved");
  assert.equal(explicit.provenance.checkIn, "explicit");
  assert.equal(explicit.provenance.nights, "defaulted");
  assert.equal(explicit.ruleRefs.nights, "PRODUCT_BASELINE:single_date_availability_default_one_night");
  assert.equal(explicit.provenance.checkOut, "derived");
  assert.equal(explicit.ruleRefs.checkOut, "PRODUCT_BASELINE:single_date_availability_default_one_night");
  assert.deepEqual(explicit.derivedFromFieldRefs.checkOut, ["stay.checkIn", "stay.nights"]);
  assert.equal(resolveTemporalExpression({ rawText: "", kind: "none", anchor: "none" }, { eventTimestamp: Date.parse(NOW), timezone: "Asia/Taipei" }).resolutionStatus, "absent");
}

async function main() {
  temporalContract();
  await perCandidateIsolation();
  await contextReuseAndIsolation();
  await failedDatesDoNotReuseOrMutate();
  await noRelationAndIneligibleCyclesCannotReuse();
  console.log("temporal per request: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
