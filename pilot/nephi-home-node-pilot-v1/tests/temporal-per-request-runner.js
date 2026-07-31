"use strict";

require("./phase5-formal-request-runner");
require("./phase5-query-plan-execution-runner");

const assert = require("node:assert/strict");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { emptyStateV2 } = require("../lib/conversation-engine-v2/state-reducer");
const { resolveTemporalExpression } = require("../lib/conversation-engine-v2/temporal-resolver");

const NOW = "2026-07-24T00:00:00.000Z";
const PROPERTY_ID = "temporal-property";
const CHANNEL_ID = "temporal-channel";

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
        mode: item.productType === "room_type"
          ? "room_only"
          : item.productType === "bundle"
            ? "bundle_only"
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
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    contextReuseExpiresAt: item.expiresAt
  }));
  return {
    ...projected,
    requestCycles,
    pendingRequests: requestCycles.filter((cycle) => {
      const item = projected.tasks.find(
        (taskValue) => taskValue.taskId === cycle.requestCycleId
      );
      return ["pending", "needs_clarification"].includes(item.status);
    }).map((cycle) => {
      const item = projected.tasks.find(
        (taskValue) => taskValue.taskId === cycle.requestCycleId
      );
      return {
        pendingRequestId: item.taskId,
        requestCycleId: item.taskId,
        conditions: cycle.confirmedInputs,
        missingFields: item.missingFields
      };
    })
  };
}
function stay({ rawText = "", kind = "none", checkInCandidate = null, checkOutCandidate = null, nightsCandidate = null, guestCountCandidate = null } = {}) {
  return { dateExpression: { rawText, kind, anchor: rawText ? "message_time" : "none" }, checkInCandidate, checkOutCandidate, nightsCandidate, guestCountCandidate };
}
function availabilityTask(candidateIndex, roomId, stayCandidate) {
  return {
    candidateIndex, taskId: `availability-${candidateIndex}-${roomId}`, type: "availability", sourceText: stayCandidate.dateExpression.rawText || `availability ${roomId}`,
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
function evidenceRef(eventId, quote = "") {
  return { eventId, messageRef: "", startOffset: 0, endOffset: quote.length, quote };
}
function resolvedTemporalResult(checkIn, checkOut, nights, sourceEvidenceRefs) {
  const field = (value, provenance = "explicit", ruleRef = null, derivedFromFieldRefs = []) => ({
    value, valueStatus: "confirmed", provenance, sourceEvidenceRefs, ruleRef, derivedFromFieldRefs
  });
  return {
    checkIn, checkOut, nights, searchRange: null,
    resolutionStatus: "resolved", timezone: "Asia/Taipei", ambiguity: null, originalExpression: "",
    fields: {
      checkIn: field(checkIn),
      checkOut: field(checkOut, "derived", "temporal:checkout_from_checkin_and_nights", ["stay.checkIn", "stay.nights"]),
      nights: field(nights),
      searchRange: { value: null, valueStatus: "missing", provenance: null, sourceEvidenceRefs, ruleRef: null, derivedFromFieldRefs: [] }
    }
  };
}
function cycle(id, roomId, checkIn, checkOut, nights, guests, status = "answered", options = {}) {
  const contextReuseExpiresAt = options.contextReuseExpiresAt || "2026-07-25T00:00:00.000Z";
  const sourceEvidenceRefs = options.sourceEvidenceRefs || [evidenceRef(id + "-source")];
  return {
    requestCycleId: id, requestKind: "availability", status,
    confirmedInputs: inputs(roomId, checkIn, checkOut, nights, guests),
    temporalResult: options.temporalResult || resolvedTemporalResult(checkIn, checkOut, nights, sourceEvidenceRefs),
    sourceEvidenceRefs,
    createdAt: NOW, updatedAt: NOW, contextReuseExpiresAt
  };
}
function stateFor(userId, cycles) {
  const state = emptyStateV2({ propertyId: PROPERTY_ID, channelId: CHANNEL_ID, lineUserId: userId, now: NOW });
  state.requestCycles = cycles;
  return state;
}
function cycleById(state, id) { return state.requestCycles.find((item) => item.requestCycleId === id); }
function assertCycleCore(actual, expected, message) {
  assert.deepEqual({
    requestCycleId: actual.requestCycleId,
    status: actual.status === "ended" ? "cancelled" : actual.status,
    checkIn: actual.confirmedInputs.stay.checkIn,
    checkOut: actual.confirmedInputs.stay.checkOut,
    guests: actual.confirmedInputs.stay.guests,
    entityId: actual.confirmedInputs.inventory.entityId,
    createdAt: actual.createdAt
  }, {
    requestCycleId: expected.requestCycleId,
    status: expected.status === "ended" ? "cancelled" : expected.status,
    checkIn: expected.confirmedInputs.stay.checkIn,
    checkOut: expected.confirmedInputs.stay.checkOut,
    guests: expected.confirmedInputs.stay.guests,
    entityId: expected.confirmedInputs.inventory.entityId,
    createdAt: expected.createdAt
  }, message);
}
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
    state: (userId) => projectStateForLegacyAssertions(
      states.get(`${PROPERTY_ID}:${CHANNEL_ID}:${userId}`)
    ),
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
  const result = await testHarness.process("pair", "pair-event", "8/6 and 8/10");
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
    cycle("cycle-b", "room-b", "2026-08-10", "2026-08-12", 2, 4, "answered", { contextReuseExpiresAt: "2026-07-24T12:00:00.000Z" })
  ]);
  const testHarness = harness({ [userId]: initial });
  testHarness.queue(plan([availabilityTask(7, "room-b", stay({ guestCountCandidate: 4 }))], [{ candidateIndex: 7, kind: "supplement_existing", refs: ["cycle-b"] }]));
  const result = await testHarness.process(userId, "reuse-event", "follow up");
  const state = testHarness.state(userId);
  assert.ok(result.replyText.length > 0);
  assert.deepEqual(testHarness.calls.map((item) => [item.roomType, item.checkIn, item.checkOut, item.guests]), [["room-b", "2026-08-10", "2026-08-12", 4]], "a relation to B must only reuse B temporal context");
  assertCycleCore(cycleById(state, "cycle-a"), initial.requestCycles[0], "reusing B must leave A's authoritative fields unchanged");
  const item = temporalItems(testHarness)[0];
  assert.equal(item.resolutionStatus, "resolved", "context reuse must be a resolved TemporalResult, not an implicit state side effect");
  assert.equal(item.provenance.checkIn, "context");
  assert.equal(item.provenance.checkOut, "context");
  assert.equal(item.fields.checkIn.valueStatus, "confirmed");
  assert.ok(cycleById(state, "cycle-b").contextReuseExpiresAt > initial.requestCycles[1].contextReuseExpiresAt, "an updated V3 task receives a fresh bounded TTL");
}

async function failedDatesDoNotReuseOrMutate() {
  const userId = "reject";
  const initial = stateFor(userId, [cycle("cycle-a", "room-a", "2026-08-06", "2026-08-07", 1, 2, "answered", {
    contextReuseExpiresAt: "2026-07-24T12:00:00.000Z",
    sourceEvidenceRefs: [evidenceRef("event-A")]
  })]);
  const cases = [
    ["invalid-date", stay({ rawText: "2/30", kind: "absolute", checkInCandidate: "2026-02-30", nightsCandidate: 2, guestCountCandidate: 2 })],
    ["unrecognized", stay({ rawText: "someday", kind: "weekday", nightsCandidate: 2, guestCountCandidate: 2 })],
    ["invalid-range", stay({ rawText: "8/10到8/9", kind: "range", checkInCandidate: "2026-08-10", checkOutCandidate: "2026-08-09", nightsCandidate: 2, guestCountCandidate: 2 })]
  ];
  for (const [caseName, candidate] of cases) {
    const testHarness = harness({ [userId]: initial });
    testHarness.queue(plan([availabilityTask(3, "room-a", candidate)], [{ candidateIndex: 3, kind: "supplement_existing", refs: ["cycle-a"] }]));
    const result = await testHarness.process(userId, `${caseName}-event`, candidate.dateExpression.rawText);
    assertSafe(result, testHarness);
    assert.equal(testHarness.calls.length, 0, `${caseName} dates must not call a date-dependent Resolver`);
    const failedCycle = cycleById(testHarness.state(userId), "cycle-a");
    assert.equal(failedCycle.confirmedInputs.stay.checkIn, null, `${caseName} must clear stale confirmed check-in`);
    assert.equal(failedCycle.confirmedInputs.stay.checkOut, null, `${caseName} must clear stale confirmed check-out`);
    assert.equal(failedCycle.confirmedInputs.stay.searchRange, null, `${caseName} must clear stale search range`);
    assert.equal(temporalItems(testHarness)[0].resolutionStatus, "unresolved", `${caseName} must trace the current canonical TemporalResult`);
    assert.equal(testHarness.state(userId).pendingRequests.length, 1, `${caseName} dates must create only the cycle-scoped clarification pending`);
    assert.equal(testHarness.state(userId).pendingRequests[0].requestCycleId, "cycle-a");
    assert.equal(temporalItems(testHarness)[0].resolutionStatus, "unresolved");
    assert.equal(temporalItems(testHarness)[0].fields.checkIn.valueStatus, "uncertain");
    assert.ok(failedCycle.contextReuseExpiresAt > NOW, `${caseName} must retain a bounded pending-task TTL without retaining stale dates`);
    assert.equal(failedCycle.createdAt, initial.requestCycles[0].createdAt, `${caseName} dates must not replace cycle creation time`);
  }
}

async function resolvedDateReplacesConfirmedTemporalEvidence() {
  const userId = "resolved-update";
  const initial = stateFor(userId, [cycle("cycle-a", "room-a", "2026-08-06", "2026-08-07", 1, 2, "answered", {
    contextReuseExpiresAt: "2026-07-24T12:00:00.000Z",
    sourceEvidenceRefs: [evidenceRef("event-A")]
  })]);
  const testHarness = harness({ [userId]: initial });
  testHarness.queue(plan([availabilityTask(8, "room-a", stay({ rawText: "8/10", kind: "absolute", checkInCandidate: "2026-08-10", nightsCandidate: 2, guestCountCandidate: 2 }))], [{ candidateIndex: 8, kind: "supplement_existing", refs: ["cycle-a"] }]));
  const result = await testHarness.process(userId, "event-C", "8/10 new legal date");
  const updated = cycleById(testHarness.state(userId), "cycle-a");
  assert.ok(result.replyText.length > 0);
  assert.deepEqual(updated.confirmedInputs.stay, { checkIn: "2026-08-10", checkOut: "2026-08-12", nights: null, guests: 2, searchRange: null });
  assert.equal(temporalItems(testHarness)[0].resolutionStatus, "resolved");
  assert.notEqual(updated.contextReuseExpiresAt, initial.requestCycles[0].contextReuseExpiresAt);
  assert.deepEqual(testHarness.calls.map((item) => [item.checkIn, item.checkOut]), [["2026-08-10", "2026-08-12"]]);
}

async function mixedTemporalOutcomesStayIsolated() {
  const userId = "mixed-outcomes";
  const existing = stateFor(userId, [
    cycle("cycle-b", "room-b", "2026-08-10", "2026-08-12", 2, 4, "answered", { contextReuseExpiresAt: "2026-07-24T12:00:00.000Z" }),
    cycle("cycle-dormant", "room-dormant", "2026-08-20", "2026-08-21", 1, 1)
  ]);
  const validA = availabilityTask(11, "room-a", stay({ rawText: "8/6", kind: "absolute", checkInCandidate: "2026-08-06", nightsCandidate: 1, guestCountCandidate: 2 }));
  const invalidB = availabilityTask(29, "room-b", stay({ rawText: "2/30", kind: "absolute", checkInCandidate: "2026-02-30", nightsCandidate: 2, guestCountCandidate: 4 }));
  const relations = [
    { candidateIndex: 11, kind: "new_request" },
    { candidateIndex: 29, kind: "supplement_existing", refs: ["cycle-b"] }
  ];

  async function run(tasks, orderedRelations) {
    const testHarness = harness({ [userId]: existing });
    testHarness.queue(plan(tasks, orderedRelations));
    const result = await testHarness.process(userId, `mixed-${tasks[0].candidateIndex}`, "8/6 and 2/30");
    const state = testHarness.state(userId);
    const cycleA = state.requestCycles.find((item) => item.requestCycleId !== "cycle-b" && item.requestCycleId !== "cycle-dormant");
    const cycleB = cycleById(state, "cycle-b");
    const aResult = result.taskResults.find((item) => item.taskId === validA.taskId);
    const bResult = result.taskResults.find((item) => (
      item.taskId === invalidB.taskId || item.taskId === "cycle-b"
    ));
    const temporal = temporalItems(testHarness).sort((left, right) => left.candidateIndex - right.candidateIndex);

    assert.ok(result.replyText.length > 0, "mixed outcomes must still deliver a reply");
    assert.ok(result.replyText.includes("Room A"), "the valid A result must remain answerable");
    assert.equal(result.replyText.includes("2026-08-10"), false, "B's previous date must not leak into the reply");
    assert.equal(aResult.status, "answered");
    assert.equal(bResult.status, "needs_clarification");
    assert.deepEqual(bResult.facts, {}, "the failed B request must not introduce an unauthorized fact");
    assert.deepEqual(temporal.map((item) => [item.candidateIndex, item.resolutionStatus]), [[11, "resolved"], [29, "unresolved"]]);
    assert.ok(cycleA && cycleB);
    assert.deepEqual(cycleA.confirmedInputs.stay, { checkIn: "2026-08-06", checkOut: "2026-08-07", nights: null, guests: 2, searchRange: null });
    assert.deepEqual(cycleB.confirmedInputs.stay, { ...existing.requestCycles[0].confirmedInputs.stay, checkIn: null, checkOut: null, nights: null, searchRange: null }, "B's unresolved current date must clear stale dates");
    assert.equal(temporal.find((item) => item.candidateIndex === 29).resolutionStatus, "unresolved", "B's current failed attempt must replace stale resolved temporal context");
    assert.ok(cycleB.contextReuseExpiresAt > NOW, "B's unresolved date must retain only a bounded pending-task TTL");
    assert.deepEqual(testHarness.calls.map((item) => [item.roomType, item.checkIn, item.checkOut, item.guests]), [["room-a", "2026-08-06", "2026-08-07", 2]], "only A may call the date-dependent Resolver");
    assert.equal(state.pendingRequests.length, 1, "only B may have a clarification pending request");
    assert.equal(state.pendingRequests[0].requestCycleId, "cycle-b");
    assertCycleCore(cycleById(state, "cycle-dormant"), existing.requestCycles[1], "an unrelated cycle must remain unchanged");
    assertSafe(result, testHarness);
    return { a: cycleA.confirmedInputs.stay, b: cycleB.confirmedInputs.stay, calls: testHarness.calls.map((item) => [item.roomType, item.checkIn, item.checkOut, item.guests]), pendingCycleId: state.pendingRequests[0].requestCycleId };
  }

  const forward = await run([validA, invalidB], relations);
  const reversed = await run([invalidB, validA], [relations[1], relations[0]]);
  assert.deepEqual(reversed, forward, "task and relation order must not change mixed temporal outcome alignment");
}

async function noRelationAndIneligibleCyclesCannotReuse() {
  const userId = "ineligible";
  const initial = stateFor(userId, [cycle("cycle-a", "room-a", "2026-08-06", "2026-08-07", 1, 2)]);
  const noRelation = harness({ [userId]: initial });
  noRelation.queue(plan([availabilityTask(0, "room-a", stay({ guestCountCandidate: 2 }))], [{ candidateIndex: 0, kind: "relation_uncertain" }]));
  const noRelationResult = await noRelation.process(userId, "no-relation", "uncertain");
  assertSafe(noRelationResult, noRelation);
  assert.equal(noRelation.calls.length, 0);
  assertCycleCore(cycleById(noRelation.state(userId), "cycle-a"), initial.requestCycles[0]);

  for (const status of ["ended", "expired"]) {
    const scopedState = clone(initial);
    scopedState.requestCycles[0].status = status;
    const testHarness = harness({ [userId]: scopedState });
    testHarness.queue(plan([availabilityTask(0, "room-a", stay({ guestCountCandidate: 2 }))], [{ candidateIndex: 0, kind: "supplement_existing", refs: ["cycle-a"] }]));
    const result = await testHarness.process(userId, `${status}-event`, status);
    assertSafe(result, testHarness);
    assert.equal(testHarness.calls.length, 0);
    assertCycleCore(cycleById(testHarness.state(userId), "cycle-a"), scopedState.requestCycles[0]);
  }
}

function temporalContract() {
  const explicitEvidence = [evidenceRef("explicit-event")];
  const explicit = resolveTemporalExpression({ rawText: "8/6", kind: "absolute", anchor: "message_time" }, { eventTimestamp: Date.parse(NOW), timezone: "Asia/Taipei", checkInCandidate: "2026-08-06", defaultNights: 1, defaultNightsRuleRef: "PRODUCT_BASELINE:single_date_availability_default_one_night", sourceEvidenceRefs: explicitEvidence });
  assert.equal(explicit.resolutionStatus, "resolved");
  assert.equal(explicit.provenance.checkIn, "explicit");
  assert.equal(explicit.provenance.nights, "defaulted");
  assert.equal(explicit.ruleRefs.nights, "PRODUCT_BASELINE:single_date_availability_default_one_night");
  assert.equal(explicit.provenance.checkOut, "derived");
  assert.equal(explicit.ruleRefs.checkOut, "PRODUCT_BASELINE:single_date_availability_default_one_night");
  assert.deepEqual(explicit.derivedFromFieldRefs.checkOut, ["stay.checkIn", "stay.nights"]);
  assert.deepEqual(explicit.fields.checkIn, {
    value: "2026-08-06", valueStatus: "confirmed", provenance: "explicit",
    sourceEvidenceRefs: explicitEvidence, ruleRef: "temporal:canonical_grammar", derivedFromFieldRefs: []
  });
  assert.deepEqual(explicit.fields.nights, {
    value: 1, valueStatus: "confirmed", provenance: "defaulted",
    sourceEvidenceRefs: explicitEvidence, ruleRef: "PRODUCT_BASELINE:single_date_availability_default_one_night", derivedFromFieldRefs: []
  });
  assert.deepEqual(explicit.fields.checkOut, {
    value: "2026-08-07", valueStatus: "confirmed", provenance: "derived",
    sourceEvidenceRefs: explicitEvidence, ruleRef: "PRODUCT_BASELINE:single_date_availability_default_one_night", derivedFromFieldRefs: ["stay.checkIn", "stay.nights"]
  });
  const reused = resolveTemporalExpression({ rawText: "", kind: "none", anchor: "none" }, {
    eventTimestamp: Date.parse(NOW), timezone: "Asia/Taipei", allowContextReuse: true,
    approvedContext: {
      checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1,
      sourceEvidenceRefs: [evidenceRef("original-cycle-event")]
    }
  });
  assert.deepEqual(reused.fields.checkIn, {
    value: "2026-08-06", valueStatus: "confirmed", provenance: "context",
    sourceEvidenceRefs: [evidenceRef("original-cycle-event")], ruleRef: "temporal:contextual_expression", derivedFromFieldRefs: []
  });
  const unresolved = resolveTemporalExpression({ rawText: "ambiguous", kind: "weekday", anchor: "message_time" }, { eventTimestamp: Date.parse(NOW), timezone: "Asia/Taipei", sourceEvidenceRefs: [evidenceRef("unresolved-event")] });
  assert.equal(unresolved.resolutionStatus, "unresolved");
  assert.equal(unresolved.fields.checkIn.valueStatus, "uncertain");
  assert.equal(unresolved.fields.checkOut.valueStatus, "missing");
  assert.equal(unresolved.fields.nights.valueStatus, "missing");
  assert.equal(unresolved.fields.searchRange.valueStatus, "missing");
  assert.deepEqual(unresolved.fields.checkIn.sourceEvidenceRefs, [evidenceRef("unresolved-event")]);
  const invalid = resolveTemporalExpression({ rawText: "2/30", kind: "absolute", anchor: "message_time" }, { eventTimestamp: Date.parse(NOW), timezone: "Asia/Taipei", checkInCandidate: "2026-02-30", nightsCandidate: 2, sourceEvidenceRefs: [evidenceRef("invalid-event")] });
  assert.equal(invalid.resolutionStatus, "unresolved");
  assert.equal(invalid.fields.checkIn.valueStatus, "uncertain");
  assert.equal(invalid.fields.checkOut.valueStatus, "missing");
  assert.equal(invalid.fields.nights.valueStatus, "missing");
  assert.equal(invalid.fields.searchRange.valueStatus, "missing");
  const conflicting = resolveTemporalExpression({ rawText: "8/10", kind: "absolute", anchor: "message_time" }, { eventTimestamp: Date.parse(NOW), timezone: "Asia/Taipei", checkInCandidate: "2026-08-10", checkOutCandidate: "2026-08-09", nightsCandidate: 1, sourceEvidenceRefs: [evidenceRef("conflicting-event")] });
  assert.equal(conflicting.resolutionStatus, "resolved");
  assert.equal(conflicting.fields.checkIn.valueStatus, "confirmed");
  assert.equal(conflicting.fields.checkOut.valueStatus, "confirmed");
  assert.equal(conflicting.fields.nights.valueStatus, "confirmed");
  assert.equal(conflicting.fields.searchRange.valueStatus, "missing");
  const explicitRange = resolveTemporalExpression({ rawText: "週末", kind: "weekend", anchor: "message_time" }, { eventTimestamp: Date.parse(NOW), timezone: "Asia/Taipei", sourceEvidenceRefs: [evidenceRef("range-event")] });
  assert.equal(explicitRange.fields.checkIn.valueStatus, "confirmed");
  assert.equal(explicitRange.fields.checkOut.valueStatus, "confirmed");
  assert.equal(explicitRange.fields.checkIn.provenance, "explicit");
  assert.deepEqual(explicitRange.fields.checkIn.sourceEvidenceRefs, [evidenceRef("range-event")]);
  const defaultedRange = resolveTemporalExpression({ rawText: "", kind: "none", anchor: "none" }, {
    eventTimestamp: Date.parse(NOW), timezone: "Asia/Taipei", sourceEvidenceRefs: [evidenceRef("available-dates-event")],
    defaultSearchRangeDays: 31, defaultSearchRangeRuleRef: "temporal:available_dates_default_lookahead"
  });
  assert.deepEqual(defaultedRange.fields.searchRange, {
    value: { from: "2026-07-24", to: "2026-08-24" }, valueStatus: "confirmed", provenance: "defaulted",
    sourceEvidenceRefs: [evidenceRef("available-dates-event")], ruleRef: "temporal:available_dates_default_lookahead", derivedFromFieldRefs: ["eventTimestamp"]
  });
  assert.equal(resolveTemporalExpression({ rawText: "", kind: "none", anchor: "none" }, { eventTimestamp: Date.parse(NOW), timezone: "Asia/Taipei" }).resolutionStatus, "absent");
}

async function main() {
  temporalContract();
  await perCandidateIsolation();
  await contextReuseAndIsolation();
  await failedDatesDoNotReuseOrMutate();
  await resolvedDateReplacesConfirmedTemporalEvidence();
  await mixedTemporalOutcomesStayIsolated();
  await noRelationAndIneligibleCyclesCannotReuse();
  console.log("temporal per request: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
