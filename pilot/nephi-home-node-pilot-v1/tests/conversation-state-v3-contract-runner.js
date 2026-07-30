"use strict";

const assert = require("node:assert/strict");
const {
  CONVERSATION_STATE_SCHEMA_VERSION,
  createConversationStateV3,
  createConversationTaskV3,
  readConversationStateV3,
  selectActiveConversationTasks,
  validateConversationStateV3
} = require("../lib/conversation-contracts/conversation-state-v3");

const NOW = "2026-07-30T02:00:00.000Z";
const FUTURE = "2026-07-30T02:30:00.000Z";
const PAST = "2026-07-30T01:30:00.000Z";
const scope = {
  propertyId: "property_alpha",
  channel: "line:test-only-alpha",
  userId: "line-user-alpha"
};

function pricingTask(overrides = {}) {
  return createConversationTaskV3({
    taskId: "task-pricing",
    taskType: "pricing",
    productType: "room_type",
    productId: "alpha-double",
    roomTypeId: "alpha-double",
    bundleId: null,
    checkIn: "2026-07-30",
    checkOut: "2026-07-31",
    guestCount: 2,
    knownFields: [
      "productType",
      "productId",
      "roomTypeId",
      "checkIn",
      "checkOut",
      "guestCount"
    ],
    missingFields: [],
    status: "ready",
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: FUTURE,
    ...overrides
  });
}

const task = pricingTask();
const state = createConversationStateV3({
  ...scope,
  tasks: [task],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});

assert.equal(CONVERSATION_STATE_SCHEMA_VERSION, 3);
assert.deepEqual(Object.keys(state.scope), ["propertyId", "channel", "userId"]);
assert.deepEqual(state.scope, scope);
assert.equal(state.tasks.length, 1);
assert.deepEqual(state.tasks[0], task);
assert.equal(Object.hasOwn(state, "pendingRequests"), false);
assert.equal(Object.hasOwn(state, "pendingRequest"), false);
assert.equal(Object.hasOwn(state, "requestCycles"), false);
assert.equal(Object.hasOwn(state, "contextCycle"), false);
assert.equal(validateConversationStateV3(state).ok, true);
assert.equal(Object.isFrozen(state), true);
assert.equal(Object.isFrozen(state.tasks[0]), true);

assert.throws(
  () => pricingTask({
    taskType: "availability",
    checkIn: null,
    checkOut: null,
    knownFields: ["productType", "productId", "roomTypeId"],
    missingFields: [],
    status: "ready"
  }),
  /task_readiness_mismatch/
);

const availableDatesTask = createConversationTaskV3({
  taskId: "task-available-dates",
  taskType: "available_dates",
  productType: "any",
  productId: null,
  roomTypeId: null,
  bundleId: null,
  checkIn: null,
  checkOut: null,
  guestCount: null,
  searchFrom: "2026-07-30",
  searchTo: "2026-08-30",
  knownFields: ["productType", "searchFrom", "searchTo"],
  missingFields: [],
  status: "ready",
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
assert.equal(availableDatesTask.searchFrom, "2026-07-30");
assert.equal(availableDatesTask.searchTo, "2026-08-30");
assert.equal(
  createConversationStateV3({
    ...scope,
    tasks: [availableDatesTask],
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: FUTURE
  }).tasks[0].taskType,
  "available_dates"
);

const dualAuthorityState = {
  ...JSON.parse(JSON.stringify(state)),
  pendingRequests: []
};
assert.equal(
  validateConversationStateV3(dualAuthorityState).ok,
  false,
  "V3 must reject a second pending-state authority"
);
assert.throws(
  () => readConversationStateV3(dualAuthorityState, scope, NOW),
  /invalid_conversation_state_v3/
);

const expiredState = createConversationStateV3({
  ...scope,
  tasks: [pricingTask({
    taskId: "expired-pricing",
    status: "pending",
    checkIn: null,
    checkOut: null,
    guestCount: null,
    knownFields: ["productType", "productId", "roomTypeId"],
    missingFields: ["checkIn", "checkOut"],
    expiresAt: PAST
  })],
  createdAt: PAST,
  updatedAt: PAST,
  expiresAt: PAST
});
assert.deepEqual(
  selectActiveConversationTasks(expiredState, NOW),
  [],
  "expired tasks must not participate in a new turn"
);

const legacyV2 = {
  schemaVersion: 2,
  scope: {
    propertyId: scope.propertyId,
    channelId: scope.channel,
    lineUserId: scope.userId
  },
  requestCycles: [{
    requestCycleId: "legacy-cycle",
    requestKind: "price",
    status: "active",
    confirmedInputs: {
      stay: {
        checkIn: null,
        checkOut: null,
        nights: null,
        guests: 2,
        searchRange: null
      },
      inventory: {
        mode: "room_only",
        entityId: "alpha-double",
        features: []
      }
    },
    createdAt: NOW,
    updatedAt: NOW,
    contextReuseExpiresAt: FUTURE
  }],
  pendingRequests: [{
    pendingRequestId: "legacy-pending",
    requestCycleId: "legacy-cycle",
    capability: "price",
    tasks: [{
      taskId: "legacy-price-task",
      type: "price"
    }],
    conditions: {
      stay: {
        checkIn: null,
        checkOut: null,
        nights: null,
        guests: 2,
        searchRange: null
      },
      inventory: {
        mode: "room_only",
        entityId: "alpha-double",
        features: []
      }
    },
    missingFields: ["stay.checkIn", "stay.checkOut"],
    status: "pending",
    metadata: {
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: FUTURE
    }
  }]
};

const compatible = readConversationStateV3(legacyV2, scope, NOW);
assert.equal(compatible.schemaVersion, 3);
assert.equal(compatible.tasks.length, 1);
assert.equal(compatible.tasks[0].taskType, "pricing");
assert.equal(compatible.tasks[0].productType, "room_type");
assert.equal(compatible.tasks[0].roomTypeId, "alpha-double");
assert.equal(compatible.tasks[0].guestCount, 2);
assert.deepEqual(compatible.tasks[0].missingFields, ["checkIn", "checkOut"]);
assert.equal(Object.hasOwn(compatible, "pendingRequests"), false);
assert.equal(Object.hasOwn(compatible, "requestCycles"), false);

const legacyPriceOnlyCheckIn = JSON.parse(JSON.stringify(legacyV2));
legacyPriceOnlyCheckIn.pendingRequests[0].missingFields = ["stay.checkIn"];
const compatiblePriceOnlyCheckIn = readConversationStateV3(
  legacyPriceOnlyCheckIn,
  scope,
  NOW
);
assert.deepEqual(
  compatiblePriceOnlyCheckIn.tasks[0].missingFields,
  ["checkIn", "checkOut"],
  "V2 compatibility reads must derive V3 readiness instead of copying legacy missing-field semantics"
);

const legacyAvailableDates = {
  schemaVersion: 2,
  scope: {
    propertyId: scope.propertyId,
    channelId: scope.channel,
    lineUserId: scope.userId
  },
  requestCycles: [],
  pendingRequests: [{
    pendingRequestId: "legacy-available-dates",
    capability: "available_dates",
    tasks: [{
      taskId: "legacy-available-dates-task",
      type: "available_dates"
    }],
    conditions: {
      stay: {
        checkIn: null,
        checkOut: null,
        nights: null,
        guests: null,
        searchRange: {
          from: "2026-07-30",
          to: "2026-08-30"
        }
      },
      inventory: {
        mode: "any",
        entityId: null,
        features: []
      }
    },
    missingFields: [],
    status: "pending",
    metadata: {
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: FUTURE
    }
  }]
};
const compatibleAvailableDates = readConversationStateV3(
  legacyAvailableDates,
  scope,
  NOW
);
assert.equal(
  compatibleAvailableDates.tasks[0].searchFrom,
  "2026-07-30"
);
assert.equal(
  compatibleAvailableDates.tasks[0].searchTo,
  "2026-08-30"
);
assert.deepEqual(
  compatibleAvailableDates.tasks[0].knownFields,
  ["productType", "searchFrom", "searchTo"]
);
assert.deepEqual(compatibleAvailableDates.tasks[0].missingFields, []);
assert.equal(compatibleAvailableDates.tasks[0].status, "ready");

const wrongProperty = readConversationStateV3(
  legacyV2,
  { ...scope, propertyId: "property_beta" },
  NOW
);
const wrongUser = readConversationStateV3(
  legacyV2,
  { ...scope, userId: "line-user-beta" },
  NOW
);
const wrongChannel = readConversationStateV3(
  legacyV2,
  { ...scope, channel: "line:test-only-beta" },
  NOW
);
assert.deepEqual(wrongProperty.tasks, []);
assert.deepEqual(wrongUser.tasks, []);
assert.deepEqual(wrongChannel.tasks, []);

assert.equal(validateConversationStateV3({
  schemaVersion: 3,
  revision: 0,
  scope,
  tasks: {},
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
}).ok, false);

assert.throws(
  () => createConversationStateV3({
    propertyId: "",
    channel: scope.channel,
    userId: scope.userId,
    tasks: [],
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: FUTURE
  }),
  /invalid_conversation_state_v3/
);

console.log(JSON.stringify({
  suite: "conversation-state-v3-contract",
  caseCount: 18,
  passCount: 18,
  failCount: 0
}));
