"use strict";

const assert = require("node:assert/strict");
const matrix = require("./fixtures/conversation-contract-sequences.json");
const {
  createConversationStateV3,
  createConversationTaskV3,
  selectActiveConversationTasks
} = require("../lib/conversation-contracts/conversation-state-v3");
const {
  evaluateTaskReadiness
} = require("../lib/conversation-contracts/task-readiness");

const REQUIRED_CASE_IDS = [
  "incident_pricing_then_date",
  "availability_then_date",
  "availability_then_guest_count",
  "bundle_then_date",
  "next_day_followup",
  "then_bundle_followup",
  "four_person_room_followup",
  "mixed_then_partial_supplement",
  "change_date",
  "duplicate_message",
  "pending_expired",
  "different_users_isolated",
  "alpha_beta_properties_isolated",
  "closed_unknown_distinct",
  "incident_explicit_date_bundle"
];
const REQUIRED_LAYERS = [
  "planner",
  "reducer",
  "readiness",
  "canonicalRequest",
  "queryPlan",
  "resolver",
  "claimValidator",
  "finalDecision",
  "finalText"
];

function assertLineEvent(turn, scope) {
  const payload = turn.lineWebhook;
  assert.equal(typeof payload.destination, "string");
  assert.ok(payload.destination.length > 0);
  assert.equal(payload.events.length, 1);
  const event = payload.events[0];
  assert.equal(event.type, "message");
  assert.equal(event.mode, "active");
  assert.equal(Number.isInteger(event.timestamp), true);
  assert.equal(event.source.type, "user");
  assert.equal(event.source.userId, scope.userId);
  assert.ok(event.replyToken);
  assert.equal(event.message.type, "text");
  assert.ok(event.message.id);
  assert.ok(event.message.quoteToken);
  assert.equal(event.message.text, turn.message);
  assert.equal(typeof event.webhookEventId, "string");
  assert.equal(typeof event.deliveryContext.isRedelivery, "boolean");
}

function readinessInput(task) {
  return {
    taskType: task.taskType,
    productType: task.productType,
    productId: task.productId,
    roomTypeId: task.roomTypeId,
    bundleId: task.bundleId,
    checkIn: task.checkIn,
    checkOut: task.checkOut,
    guestCount: task.guestCount,
    searchFrom: task.searchFrom,
    searchTo: task.searchTo
  };
}

assert.equal(matrix.schemaVersion, 1);
assert.equal(
  matrix.providerFixture,
  "conversation-contract-postgres-properties.json"
);
assert.deepEqual(
  matrix.cases.map((item) => item.id),
  REQUIRED_CASE_IDS
);

for (const item of matrix.cases) {
  assert.ok(item.sessions.length >= 1);
  for (const session of item.sessions) {
    assert.ok(session.scope.propertyId);
    assert.ok(session.scope.channel);
    assert.ok(session.scope.userId);
    assert.ok(session.turns.length >= 1);
    session.turns.forEach((turn) => {
      assertLineEvent(turn, session.scope);
      assert.ok(turn.planner.tasks.length >= 1);
      turn.planner.tasks.forEach((task) => {
        assert.ok(task.taskId);
        assert.ok(task.taskType);
        assert.ok(task.sourceText.length > 0);
      });
    });

    assert.deepEqual(
      Object.keys(session.expected.layers),
      REQUIRED_LAYERS
    );
    assert.equal(
      Object.values(session.expected.layers).every(
        (value) => typeof value === "string" && value.length > 0
      ),
      true
    );
    assert.ok(session.expected.tasks.length >= 1);
    const tasks = session.expected.tasks.map((task) =>
      createConversationTaskV3(task)
    );
    const state = createConversationStateV3({
      ...session.scope,
      tasks,
      createdAt: session.expected.createdAt,
      updatedAt: session.expected.updatedAt,
      expiresAt: session.expected.expiresAt
    });
    assert.equal(state.scope.propertyId, session.scope.propertyId);
    assert.equal(state.scope.channel, session.scope.channel);
    assert.equal(state.scope.userId, session.scope.userId);

    session.expected.readiness.forEach((expectedReadiness) => {
      const task = session.expected.tasks.find(
        (candidate) => candidate.taskId === expectedReadiness.taskId
      );
      assert.ok(task, `${item.id} readiness task must exist`);
      assert.deepEqual(
        evaluateTaskReadiness(readinessInput(task)),
        expectedReadiness.result
      );
    });

    const activeTaskIds = selectActiveConversationTasks(
      state,
      session.expected.evaluationTime
    ).map((task) => task.taskId);
    assert.deepEqual(activeTaskIds, session.expected.activeTaskIds);
  }
}

const userIsolation = matrix.cases.find(
  (item) => item.id === "different_users_isolated"
);
assert.equal(userIsolation.sessions.length, 2);
assert.notEqual(
  userIsolation.sessions[0].scope.userId,
  userIsolation.sessions[1].scope.userId
);

const propertyIsolation = matrix.cases.find(
  (item) => item.id === "alpha_beta_properties_isolated"
);
assert.equal(propertyIsolation.sessions.length, 2);
assert.notEqual(
  propertyIsolation.sessions[0].scope.propertyId,
  propertyIsolation.sessions[1].scope.propertyId
);
assert.notEqual(
  propertyIsolation.sessions[0].expected.tasks[0].productId,
  propertyIsolation.sessions[1].expected.tasks[0].productId
);

const outcomeBoundary = matrix.cases.find(
  (item) => item.id === "closed_unknown_distinct"
);
assert.deepEqual(
  outcomeBoundary.expectedOutcomes,
  {
    closed: "closed",
    unknown: "unknown"
  }
);

const duplicate = matrix.cases.find(
  (item) => item.id === "duplicate_message"
).sessions[0];
assert.equal(
  duplicate.turns[0].lineWebhook.events[0].webhookEventId,
  duplicate.turns[1].lineWebhook.events[0].webhookEventId
);
assert.equal(
  duplicate.turns[1].lineWebhook.events[0].deliveryContext.isRedelivery,
  true
);

const mixed = matrix.cases.find(
  (item) => item.id === "mixed_then_partial_supplement"
).sessions[0];
assert.deepEqual(
  mixed.expected.tasks.map((task) => task.taskId),
  ["availability", "parking"]
);

console.log(JSON.stringify({
  suite: "conversation-sequence-matrix-contract",
  caseCount: matrix.cases.length,
  sessionCount: matrix.cases.reduce(
    (count, item) => count + item.sessions.length,
    0
  ),
  passCount: matrix.cases.length,
  failCount: 0
}));
