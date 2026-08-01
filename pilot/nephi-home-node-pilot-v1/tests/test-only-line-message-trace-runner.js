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
    tasks: [{
      taskId: "availability-1",
      type: "availability",
      productType: "room",
      productId: "room401",
      checkIn: "2026-08-06",
      checkOut: "2026-08-07",
      evidence: [{ text: TARGET_MESSAGE }],
      authorization: "Bearer must-not-survive"
    }]
  });
  trace.diagnostic({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    stage: "validation",
    acceptedTasks: [{ taskId: "availability-1", type: "availability" }],
    rejectedTasks: [],
    rejectionReasons: []
  });
  trace.diagnostic({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    stage: "canonical_request",
    items: [{
      taskId: "availability-1",
      capability: "availability",
      canonicalEntity: { category: "room", canonicalId: "room401", status: "resolved" },
      temporalState: { resolutionStatus: "resolved", checkIn: "2026-08-06", checkOut: "2026-08-07", timezone: "Asia/Taipei" },
      resolverId: "availability"
    }]
  });
  trace.diagnostic({
    traceId: "trace-a",
    eventId: "event-a",
    propertyId: "nephi_home",
    stage: "executor",
    results: [{ taskId: "availability-1", status: "answered", facts: { availableRoomIds: ["room401"] } }],
    resolverCalls: [{ resolverId: "availability", result: { rooms: [{ id: "room401", name: "401雙人房" }] } }]
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
  assert.equal(record.stages.validation.rejectedTasks.length, 0);
  assert.equal(record.stages.canonical_request.items[0].temporalState.timezone, "Asia/Taipei");
  assert.deepEqual(record.stages.executor.resolverCalls[0].result.rooms, [{ id: "room401", name: "401雙人房" }]);
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
