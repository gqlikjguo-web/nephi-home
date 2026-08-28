"use strict";

const assert = require("node:assert/strict");
const {
  validateUnderstandingTurnInput
} = require("../lib/new-core/contracts/understanding-turn-input");
const {
  buildUnderstandingTurnInput
} = require("../lib/new-core/turn-input-adapter");

const NOW = "2026-08-28T08:00:00.000Z";

function validArgs(overrides = {}) {
  return {
    coreVersion: "new-core-v1",
    traceId: "trace-c01",
    turnId: "turn-c01",
    verifiedPropertyBinding: {
      propertyId: "property-a",
      channel: "line-binding-a",
      channelSecret: "must-not-leak",
      channelAccessToken: "must-not-leak"
    },
    verifiedConversationScope: {
      channel: "line-binding-a",
      userId: "guest-a"
    },
    sourceEvents: [{
      eventId: "event-current",
      messageRef: "message-current",
      role: "guest",
      timestamp: NOW,
      messageKind: "text",
      messageText: "請問還有房嗎？",
      query: { propertyId: "property-a" }
    }],
    recentConversation: [{
      eventId: "event-prior",
      messageRef: "message-prior",
      role: "assistant",
      timestamp: "2026-08-28T07:58:00.000Z",
      messageKind: "text",
      messageText: "您好，請告訴我日期。",
      referenceableCycleIds: ["cycle-a"]
    }],
    stateV3Snapshot: {
      scope: { propertyId: "property-a", channel: "line-binding-a", userId: "guest-a" },
      referenceableCycles: [{
        requestCycleId: "cycle-a",
        status: "active",
        expiresAt: "2026-08-29T08:00:00.000Z",
        slotRefs: ["stay.checkIn"]
      }]
    },
    publicCatalog: {
      propertyId: "property-a",
      timezone: "Asia/Taipei",
      capabilityCatalog: ["availability", "property_fact"],
      publicSubjectCatalog: [
        { catalogIdentity: "room-a", kind: "room", propertyId: "property-a", publicName: "Room A" }
      ],
      facts: [{ answer: "must-not-leak" }]
    },
    ...overrides
  };
}

function assertBuildFails(args, code) {
  assert.throws(
    () => buildUnderstandingTurnInput(args),
    (error) => error && error.code === code,
    `expected ${code}`
  );
}

// AC-CON-001: this fails if the adapter stops deriving a bounded immutable
// public projection from the verified input boundary.
const valid = buildUnderstandingTurnInput(validArgs());
assert.equal(validateUnderstandingTurnInput(valid).ok, true);
assert.deepEqual(valid.propertyScope, {
  propertyId: "property-a",
  channel: "line-binding-a",
  userId: "guest-a"
});
assert.equal(Object.isFrozen(valid), true);
assert.equal(Object.isFrozen(valid.sourceEvents), true);
assert.equal(Object.hasOwn(valid, "facts"), false);
assert.equal(Object.hasOwn(valid.publicSubjectCatalog[0], "propertyId"), false);
assert.doesNotMatch(JSON.stringify(valid), /must-not-leak/);
assert.throws(() => { valid.sourceEvents.push({}); }, TypeError);

// AC-CON-002: this fails if duplicate source identity can reach OpenAI.
assertBuildFails(validArgs({
  sourceEvents: [
    validArgs().sourceEvents[0],
    { ...validArgs().sourceEvents[0], messageRef: "message-duplicate" }
  ]
}), "SOURCE_EVENT_DUPLICATE");

// AC-CON-003: this fails if a caller can synthesize an input without a
// verified property binding.
assertBuildFails(validArgs({ verifiedPropertyBinding: null }), "PROPERTY_SCOPE_INVALID");

// AC-CON-004: this fails if an unbounded recent history is accepted.
assertBuildFails(validArgs({
  recentConversation: Array.from({ length: 21 }, (_, index) => ({
    eventId: `history-${index}`,
    messageRef: `history-message-${index}`,
    role: "guest",
    timestamp: NOW,
    messageKind: "text",
    messageText: "history",
    referenceableCycleIds: []
  }))
}), "CONTEXT_WINDOW_INVALID");

// AC-ISO-001: this fails if query/body identity can override the verified
// binding property.
assertBuildFails(validArgs({ query: { propertyId: "property-b" } }), "PROPERTY_SCOPE_INVALID");

// AC-ISO-002: this fails if a direct property argument survives alongside the
// verified binding as a second identity source.
assertBuildFails(validArgs({ propertyId: "property-b" }), "PROPERTY_SCOPE_INVALID");

// AC-ISO-003: this fails if another property's state-v3 cycle is exposed to
// the understanding call.
assertBuildFails(validArgs({
  stateV3Snapshot: {
    scope: { propertyId: "property-a", channel: "line-binding-a", userId: "guest-a" },
    referenceableCycles: [{
      requestCycleId: "cycle-b",
      status: "active",
      expiresAt: "2026-08-29T08:00:00.000Z",
      propertyId: "property-b",
      slotRefs: []
    }]
  }
}), "PROPERTY_SCOPE_INVALID");

// AC-ISO-004: this fails if a catalog identity from another property is
// supplied as public context.
assertBuildFails(validArgs({
  publicCatalog: {
    ...validArgs().publicCatalog,
    publicSubjectCatalog: [
      { catalogIdentity: "room-b", kind: "room", propertyId: "property-b", publicName: "Room B" }
    ]
  }
}), "PROPERTY_SCOPE_INVALID");

console.log(JSON.stringify({
  suite: "new-core-turn-input-contract",
  classification: "STRUCTURED_CONTRACT_TEST",
  caseCount: 8,
  status: "PASS"
}));
