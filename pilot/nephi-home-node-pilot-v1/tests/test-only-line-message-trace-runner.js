"use strict";

const assert = require("node:assert/strict");
const {
  createTestOnlyLineMessageTrace,
  sha256
} = require("../lib/test-only-line-message-trace");

const TARGET_MESSAGE = "8/6 有雙人房嗎？";

function persistenceDouble() {
  const records = new Map();
  return {
    records,
    upsertTestOnlyLineTrace(record) {
      const key = `${record.propertyId}:${record.eventId}`;
      const previous = records.get(key) || {};
      records.set(key, {
        ...previous,
        ...structuredClone(record),
        stages: { ...(previous.stages || {}), ...(structuredClone(record.stages) || {}) }
      });
      return records.get(key);
    },
    listTestOnlyLineTraces({ propertyId }) {
      return [...records.values()].filter((item) => item.propertyId === propertyId);
    }
  };
}

function createTrace(overrides = {}) {
  const persistence = overrides.persistence || persistenceDouble();
  return {
    persistence,
    trace: createTestOnlyLineMessageTrace({
      enabled: true,
      testOnly: true,
      targetPropertyId: "nephi_home",
      targetMessageSha256: sha256(TARGET_MESSAGE),
      persistence,
      now: () => new Date("2026-08-01T12:00:00.000Z"),
      ...overrides
    })
  };
}

function begin(trace, suffix, lineUserId, messageText = TARGET_MESSAGE) {
  return trace.begin({
    propertyId: "nephi_home",
    channelId: "test-only-channel",
    lineUserId,
    eventId: `event-${suffix}`,
    eventTimestamp: "2026-08-01T11:59:59.000Z",
    messageText
  });
}

function recordsOf(persistence) {
  return [...persistence.records.values()];
}

{
  const { trace, persistence } = createTrace();
  const stateBefore = {
    schemaVersion: 3,
    revision: 7,
    tasks: [{
      taskId: "availability-1",
      taskType: "availability",
      productType: "room",
      productId: "room401",
      checkIn: "2026-08-06",
      checkOut: "2026-08-07",
      missingFields: [],
      status: "pending",
      sourceEvidence: [{ quote: "guest@example.com" }]
    }],
    pendingRequests: [{ taskId: "availability-1", missingFields: ["guestCount"] }],
    credential: "secret-value"
  };
  const originalState = structuredClone(stateBefore);

  assert.equal(begin(trace, "a", "Ualice"), true);
  trace.diagnostic({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    stage: "state_before",
    state: stateBefore
  });
  trace.diagnostic({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    stage: "planner",
    parserSucceeded: true,
    taskCount: 1,
    repairProvenance: [{
      kind: "coverage_repair",
      correlationId: "12345678-1234-4123-8123-123456789abc",
      taskId: "availability-1",
      propertyId: "nephi_home",
      canonicalId: "room401",
      sourceText: TARGET_MESSAGE
    }],
    semanticLedgerBoundaries: [
      { stage: "raw_parsed_output", candidateCount: 1, validCandidateCount: 1, invalidCandidateCount: 0, ownershipCount: 0, failureCodes: [], sourceText: TARGET_MESSAGE },
      { stage: "compile_after", candidateCount: 1, validCandidateCount: 0, invalidCandidateCount: 1, ownershipCount: 0, failureCodes: ["evidence_refs", "unapproved_code"] }
    ],
    tasks: [{
      taskId: "availability-1",
      type: "availability",
      productType: "room",
      productId: "room401",
      checkIn: "2026-08-06",
      checkOut: "2026-08-07",
      requestedOutputs: ["availability"],
      dependsOnStayContext: true,
      entity: { category: "room", canonicalCandidate: "room401", confidence: 0.99, rawText: "雙人房" },
      stayCandidate: { dateExpression: { rawText: "8/6", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-06", checkOutCandidate: "2026-08-07", nightsCandidate: 1, guestCountCandidate: 2 },
      evidence: [{ text: TARGET_MESSAGE }],
      authorization: "Bearer must-not-survive"
    }]
  });
  trace.diagnostic({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    stage: "temporal",
    contextAction: "start",
    items: [{ candidateIndex: 0, requestCycleId: "availability-1", taskIds: ["availability-1"], dateExpressionPresent: true, expressionType: "absolute", resolutionStatus: "resolved", resolutionSource: "current_turn", repairReasonCode: "", timezone: "Asia/Taipei", fields: { checkIn: "2026-08-06", checkOut: "2026-08-07" }, produced: { checkIn: true, checkOut: true, nights: true } }]
  });
  trace.diagnostic({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    stage: "validation",
    acceptedTasks: [{ taskId: "availability-1", type: "availability" }],
    rejectedTasks: [],
    rejectionReasons: [],
    semanticValidation: {
      repairedTasks: [{ taskId: "semantic-pool-fee-task", reason: "property_catalog_entity_grounding" }]
    },
    repairProvenance: [{
      kind: "semantic_repair",
      correlationId: "87654321-4321-4321-8321-cba987654321",
      taskId: "semantic-pool-fee-task",
      canonicalId: "pool"
    }]
  });
  trace.diagnostic({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    stage: "canonical_request",
    items: [{
      taskId: "availability-1",
      repairCorrelationId: "12345678-1234-4123-8123-123456789abc",
      capability: "availability",
      canonicalEntity: { category: "room", canonicalId: "room401", status: "resolved" },
      temporalState: { resolutionStatus: "resolved", checkIn: "2026-08-06", checkOut: "2026-08-07", timezone: "Asia/Taipei" },
      resolverId: "availability"
    }, {
      taskId: "semantic-pool-fee-task",
      repairCorrelationId: "87654321-4321-4321-8321-cba987654321",
      capability: "amenity",
      canonicalEntity: { category: "amenity", canonicalId: "pool", status: "resolved" },
      temporalState: { resolutionStatus: "resolved", checkIn: "", checkOut: "", timezone: "Asia/Taipei" }
    }]
  });
  trace.diagnostic({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    stage: "executor",
    results: [{ taskId: "availability-1", status: "answered", facts: { availableRoomIds: ["room401"] } }],
    resolverCalls: [{ request: { customerId: "nephi_home", checkIn: "2026-08-06", checkOut: "2026-08-07", guests: 2, roomType: "all", roomTypeSet: [], queryMode: "room_only" }, response: { customerId: "nephi_home", availabilityReliable: true, rooms: [{ id: "room401", name: "401雙人房" }] } }]
  });
  trace.finalResponse({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    finalDecision: { action: "reply", reasonCode: "execution_answered", reviewRequired: false },
    finalResponse: { action: "reply", shouldReply: true, replyText: "2026-08-06 入住可選：401雙人房。" }
  });
  trace.transport({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    attempted: true,
    delivered: true,
    reasonCode: "reply_succeeded",
    replyText: "2026-08-06 入住可選：401雙人房。"
  });

  const [record] = recordsOf(persistence);
  assert.equal(record.lineUserHash, sha256("Ualice"));
  assert.equal(record.channelIdHash, sha256("test-only-channel"));
  assert.equal(record.messageTextHash, sha256(TARGET_MESSAGE));
  assert.equal(record.expiresAt, "2026-08-04T12:00:00.000Z");
  assert.equal(record.traceId, "trace-a");
  assert.equal(record.stages.state_before.revision, 7);
  assert.deepEqual(record.stages.state_before.pending, [{ taskId: "availability-1", missingFields: ["guestCount"] }]);
  assert.deepEqual(record.stages.state_before.tasks[0], { taskId: "availability-1", taskType: "availability", productType: "room", productId: "room401", checkIn: "2026-08-06", checkOut: "2026-08-07", missingFields: [], status: "pending" });
  assert.equal(record.stages.planner.parserSucceeded, true);
  assert.deepEqual(record.stages.planner.repairProvenance, [{ kind: "coverage_repair", correlationId: "12345678-1234-4123-8123-123456789abc" }]);
  assert.deepEqual(record.stages.planner.semanticLedgerBoundaries, [
    { stage: "raw_parsed_output", candidateCount: 1, validCandidateCount: 1, invalidCandidateCount: 0, ownershipCount: 0, failureCodes: [] },
    { stage: "compile_after", candidateCount: 1, validCandidateCount: 0, invalidCandidateCount: 1, ownershipCount: 0, failureCodes: ["evidence_refs"] }
  ]);
  assert.equal(record.stages.canonical_request.items[0].repairCorrelationId, "12345678-1234-4123-8123-123456789abc", "persisted safe trace must retain the opaque direct join");
  assert.equal(JSON.stringify(record.stages.planner.repairProvenance).includes("availability-1"), false, "safe provenance must not project semantic Planner task IDs");
  assert.equal(JSON.stringify(record.stages.planner.repairProvenance).includes("room401"), false, "safe provenance must not project inventory IDs");
  assert.equal(JSON.stringify(record.stages.planner.repairProvenance).includes("nephi_home"), false, "safe provenance must not project property IDs");
  assert.equal(record.stages.planner.tasks[0].stayCandidate.checkInCandidate, "2026-08-06");
  assert.equal(record.stages.planner.tasks[0].entity.canonicalCandidate, "room401");
  assert.equal(Object.hasOwn(record.stages.planner.tasks[0].entity, "rawText"), false);
  assert.equal(record.stages.validation.rejectedTasks.length, 0);
  assert.deepEqual(record.stages.validation.repairProvenance, [{ kind: "semantic_repair", correlationId: "87654321-4321-4321-8321-cba987654321" }]);
  assert.equal(Object.hasOwn(record.stages.validation, "semanticValidation"), false, "safe validation trace must not expose semantic Planner task IDs");
  assert.equal(record.stages.canonical_request.items[1].repairCorrelationId, record.stages.validation.repairProvenance[0].correlationId, "rg-023-style semantic repair must remain directly joinable to canonical evidence");
  assert.equal(record.stages.canonical_request.items[0].temporalState.timezone, "Asia/Taipei");
  assert.equal(record.stages.temporal.items[0].resolutionSource, "current_turn");
  assert.deepEqual(record.stages.executor.resolverCalls[0].response.rooms, [{ id: "room401", name: "401雙人房" }]);
  assert.equal(record.stages.final_decision.action, "reply");
  assert.equal(record.stages.final_response.shouldReply, true);
  assert.equal(record.stages.line_transport.replyText, "2026-08-06 入住可選：401雙人房。");
  assert.deepEqual(stateBefore, originalState, "tracing must not mutate conversation state");

  const serialized = JSON.stringify(record);
  for (const forbidden of ["Ualice", "test-only-channel", TARGET_MESSAGE, "secret-value", "Bearer must-not-survive", "guest@example.com"]) {
    assert.equal(serialized.includes(forbidden), false, `trace leaked forbidden input: ${forbidden}`);
  }
}

{
  const { trace, persistence } = createTrace();
  assert.equal(begin(trace, "a", "Ualice"), true);
  assert.equal(begin(trace, "b", "Ubob"), true);
  const records = recordsOf(persistence);
  assert.equal(records.length, 2);
  assert.notEqual(records[0].lineUserHash, records[1].lineUserHash);
}

{
  const { trace, persistence } = createTrace();
  assert.equal(begin(trace, "other", "Uother", "你好"), false);
  assert.equal(recordsOf(persistence).length, 0, "unrelated messages must not be persisted");
}

{
  const { trace, persistence } = createTrace();
  assert.equal(trace.begin({ propertyId: "other_property", channelId: "test-only-channel", lineUserId: "Uother", eventId: "event-other-property", messageText: TARGET_MESSAGE }), false);
  assert.equal(recordsOf(persistence).length, 0, "a target message from a different property must not be persisted");
}

for (const options of [
  { enabled: false, testOnly: true },
  { enabled: true, testOnly: false },
  { enabled: true, testOnly: true, targetMessageSha256: "invalid" }
]) {
  const persistence = persistenceDouble();
  const trace = createTestOnlyLineMessageTrace({
    ...options,
    targetMessageSha256: options.targetMessageSha256 || sha256(TARGET_MESSAGE),
    persistence
  });
  assert.equal(begin(trace, "disabled", "Udisabled"), false);
  assert.equal(recordsOf(persistence).length, 0);
}

console.log("test-only LINE message trace: PASS");
