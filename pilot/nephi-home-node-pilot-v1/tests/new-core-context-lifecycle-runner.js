"use strict";

const assert = require("node:assert/strict");
const { createConversationStateV3, createConversationTaskV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const { reduceConversationStateV3 } = require("../lib/conversation-engine-v2/conversation-state-v3-reducer");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const { validateAndNormalizeSourceEvidence } = require("../lib/new-core/source-evidence-validator");
const {
  buildPublicCatalogIdentitySet,
  projectCapabilityRegistry,
  validateSemanticUnit
} = require("../lib/new-core/semantic-unit-validator");
const { validateContextLink } = require("../lib/new-core/context-link-validator");
const {
  createLifecycleDecision,
  validateLifecycleDecisions
} = require("../lib/new-core/lifecycle-manager");
const { adaptLifecycleDecisionsToStateV3 } = require("../lib/new-core/state-v3-lifecycle-adapter");

const NOW = "2026-08-28T08:00:00.000Z";
const FUTURE = "2026-08-29T08:00:00.000Z";
const PAST = "2026-08-27T08:00:00.000Z";
const scope = { propertyId: "property-a", channel: "line-a", userId: "guest-a" };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceEvent(messageText = "我們4位") {
  return {
    eventId: "event-current",
    messageRef: "message-current",
    role: "guest",
    timestamp: NOW,
    messageKind: "text",
    messageText
  };
}

function evidence(messageText = "我們4位") {
  return {
    eventId: "event-current",
    messageRef: "message-current",
    startOffset: 0,
    endOffset: messageText.length,
    quote: messageText
  };
}

function turnInput({ messageText = "我們4位", cycles, propertyScope = scope } = {}) {
  return buildUnderstandingTurnInput({
    coreVersion: "new-core-v1",
    traceId: "trace-context-lifecycle",
    turnId: "turn-context-lifecycle",
    verifiedPropertyBinding: {
      propertyId: propertyScope.propertyId,
      channel: propertyScope.channel
    },
    verifiedConversationScope: {
      channel: propertyScope.channel,
      userId: propertyScope.userId
    },
    sourceEvents: [sourceEvent(messageText)],
    recentConversation: [],
    stateV3Snapshot: {
      scope: propertyScope,
      referenceableCycles: cycles || [{
        requestCycleId: "cycle-a",
        status: "pending",
        expiresAt: FUTURE,
        slotRefs: ["guestCount", "productId", "checkIn", "checkOut"]
      }]
    },
    publicCatalog: {
      propertyId: propertyScope.propertyId,
      timezone: "Asia/Taipei",
      capabilityCatalog: ["availability", "property_fact"],
      publicSubjectCatalog: [
        { catalogIdentity: "room-a", kind: "room", propertyId: propertyScope.propertyId, publicName: "Room A" },
        { catalogIdentity: "bundle-a", kind: "bundle", propertyId: propertyScope.propertyId, publicName: "Bundle A" },
        { catalogIdentity: "transport-driving", kind: "other_verified", propertyId: propertyScope.propertyId, publicName: "Driving" }
      ]
    }
  });
}

function candidate({ messageText = "我們4位", slots = [], purpose = "context_update", overrides = {} } = {}) {
  return {
    unitId: "unit-context",
    evidenceRefs: [evidence(messageText)],
    purpose,
    capability: null,
    subject: { kind: null, catalogIdentity: null },
    stayDependent: false,
    temporalCandidate: null,
    contextLinkCandidateId: "link-context",
    replyCandidate: { disposition: "NO_REPLY", reasonClass: "context_only" },
    slotCandidates: slots,
    confidenceBand: "high",
    ...overrides
  };
}

function slot({ messageText, id, slot: slotName, value, operation = "SET" }) {
  return {
    slotCandidateId: id,
    slot: slotName,
    operation,
    value,
    evidenceRefs: [evidence(messageText)]
  };
}

function validatedPipeline({
  messageText = "我們4位",
  slots = [],
  action = "MODIFY",
  target = "cycle-a",
  input = turnInput({ messageText }),
  lifecycleDecisionId = "lifecycle-context",
  unitOverrides = {}
} = {}) {
  const evidenceResult = validateAndNormalizeSourceEvidence([evidence(messageText)], input.sourceEvents);
  assert.equal(evidenceResult.ok, true);
  const unitResult = validateSemanticUnit({
    unit: candidate({ messageText, slots, overrides: unitOverrides }),
    validatedEvidenceRefs: evidenceResult.value,
    understandingTurnInput: input,
    publicCatalogIdentitySet: buildPublicCatalogIdentitySet(input),
    capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY)
  });
  assert.equal(unitResult.ok, true);
  const linkResult = validateContextLink({
    unit: unitResult.value,
    linkCandidate: {
      contextLinkCandidateId: "link-context",
      unitId: "unit-context",
      actionCandidate: action,
      targetRequestCycleId: target,
      evidenceRefs: [evidence(messageText)]
    },
    understandingTurnInput: input,
    validatedEvidenceRefs: evidenceResult.value,
    now: NOW
  });
  if (!linkResult.ok) return { input, unit: unitResult.value, linkResult };
  const lifecycleResult = createLifecycleDecision({
    lifecycleDecisionId,
    unit: unitResult.value,
    validatedContextLink: linkResult.value
  });
  return { input, unit: unitResult.value, linkResult, lifecycleResult };
}

function stateTask(overrides = {}) {
  return createConversationTaskV3({
    taskId: "cycle-a",
    taskType: "capacity",
    productType: "room_type",
    productId: "room-a",
    roomTypeId: "room-a",
    bundleId: null,
    checkIn: "2026-09-01",
    checkOut: "2026-09-02",
    guestCount: 2,
    knownFields: ["productType", "productId", "roomTypeId", "checkIn", "checkOut", "guestCount"],
    missingFields: [],
    status: "answered",
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: FUTURE,
    ...overrides
  });
}

function state(tasks = [stateTask()]) {
  return createConversationStateV3({
    ...scope,
    revision: 3,
    tasks,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: FUTURE
  });
}

function applyDecision(previous, lifecycleResult) {
  assert.equal(lifecycleResult.ok, true);
  const adapted = adaptLifecycleDecisionsToStateV3([lifecycleResult.value]);
  assert.equal(adapted.ok, true);
  return {
    adapted,
    next: reduceConversationStateV3({
      previous,
      lifecycleOperations: adapted.value.lifecycleOperations,
      scope: { ...scope, now: NOW }
    })
  };
}

// 1 / AC-CTX-003 / AC-LIF-012: a validated guest-count MODIFY updates the
// already-supported V3 guestCount field without coupling lifecycle to reply.
const fourGuestsText = "我們4位";
const fourGuests = validatedPipeline({
  messageText: fourGuestsText,
  slots: [slot({ messageText: fourGuestsText, id: "slot-guests", slot: "guest_count", value: 4 })]
});
assert.equal(fourGuests.lifecycleResult.ok, true);
assert.equal(fourGuests.lifecycleResult.value.status, "VALIDATED");
assert.equal(fourGuests.lifecycleResult.value.action, "MODIFY");
assert.equal(fourGuests.lifecycleResult.value.verifiedSlotOperations[0].persistedField, "guestCount");
assert.equal(fourGuests.lifecycleResult.value.replyCandidate, undefined, "C06 must not rewrite or own reply");
const fourGuestState = applyDecision(state(), fourGuests.lifecycleResult);
assert.equal(fourGuestState.next.tasks[0].guestCount, 4);
assert.equal(fourGuestState.next.tasks[0].status, "answered");

// 2 / AC-CTX-015: transport remains a validated turn-context operation when
// the byte-frozen V3 schema has no matching persisted field.
const drivingText = "有開車";
const driving = validatedPipeline({
  messageText: drivingText,
  slots: [slot({ messageText: drivingText, id: "slot-driving", slot: "transport", value: "driving" })]
});
assert.equal(driving.lifecycleResult.ok, true);
assert.equal(driving.lifecycleResult.value.verifiedSlotOperations[0].persistedField, null);
const drivingState = applyDecision(state(), driving.lifecycleResult);
assert.equal(drivingState.adapted.value.lifecycleOperations.length, 0);
assert.deepEqual(drivingState.next.tasks[0], state().tasks[0]);
assert.equal(Object.hasOwn(drivingState.next.tasks[0], "transport"), false);

// 3 / AC-CTX-015 / AC-LIF-014: mixed context-only slots remain NO_REPLY input
// for Task 7, and Lifecycle emits no C08/Resolver work.
const mixedText = "我們4位、有開車，謝謝";
const mixed = validatedPipeline({
  messageText: mixedText,
  slots: [
    slot({ messageText: mixedText, id: "slot-mixed-guests", slot: "guest_count", value: 4 }),
    slot({ messageText: mixedText, id: "slot-mixed-driving", slot: "transport", value: "driving" })
  ]
});
assert.equal(mixed.lifecycleResult.ok, true);
assert.equal(mixed.unit.replyCandidate.disposition, "NO_REPLY");
assert.equal(Object.hasOwn(mixed.lifecycleResult.value, "canonicalItems"), false);
assert.equal(Object.hasOwn(mixed.lifecycleResult.value, "resolver"), false);
assert.equal(adaptLifecycleDecisionsToStateV3([mixed.lifecycleResult.value]).value.lifecycleOperations.length, 1);

// 4 / AC-CTX-003: an explicit active-target guest count correction applies
// exactly the validated value.
const changedGuestsText = "改成4位";
const changedGuests = validatedPipeline({
  messageText: changedGuestsText,
  slots: [slot({ messageText: changedGuestsText, id: "slot-changed-guests", slot: "guest_count", value: 4 })]
});
assert.equal(applyDecision(state(), changedGuests.lifecycleResult).next.tasks[0].guestCount, 4);

// 5 / AC-CTX-004: a catalog-validated product candidate maps to the existing
// lodging-product fields only after a legal MODIFY; raw text never reaches V3.
const bundleText = "改成包棟";
const bundle = validatedPipeline({
  messageText: bundleText,
  slots: [slot({ messageText: bundleText, id: "slot-bundle", slot: "product", value: "bundle-a" })]
});
const bundleState = applyDecision(state(), bundle.lifecycleResult).next.tasks[0];
assert.equal(bundleState.productType, "bundle");
assert.equal(bundleState.productId, "bundle-a");
assert.equal(bundleState.bundleId, "bundle-a");
assert.equal(bundleState.roomTypeId, null);
assert.doesNotMatch(JSON.stringify(bundleState), /改成包棟/);

// 6 / AC-CTX-005 / AC-CTX-018 / AC-LIF-011: explicit unique END cancels the
// dialogue task and owns no executable item.
const endText = "不用了";
const ended = validatedPipeline({ messageText: endText, action: "END", slots: [] });
assert.equal(ended.lifecycleResult.ok, true);
assert.equal(ended.lifecycleResult.value.verifiedSlotOperations.length, 0);
assert.equal(Object.hasOwn(ended.lifecycleResult.value, "canonicalItems"), false);
assert.equal(applyDecision(state(), ended.lifecycleResult).next.tasks[0].status, "cancelled");

// 7 / AC-CTX-007 / AC-PND-001: an unknown or omitted target fails closed and
// no pending task is selected as a likely continuation.
const unknownTarget = validatedPipeline({ target: "cycle-unknown" });
assert.equal(unknownTarget.linkResult.ok, false);
assert.equal(unknownTarget.linkResult.code, "CONTEXT_TARGET_UNAVAILABLE");
const missingTarget = validatedPipeline({ target: null });
assert.equal(missingTarget.linkResult.ok, true);
assert.equal(missingTarget.lifecycleResult.ok, false);
assert.equal(missingTarget.lifecycleResult.code, "LIFECYCLE_TARGET_REQUIRED");

// 8 / AC-CTX-006..007 / AC-LIF-017: ended/expired targets are unavailable to
// the extent represented by the supplied snapshot and are never revived.
for (const unavailableCycle of [
  { requestCycleId: "cycle-a", status: "answered", expiresAt: PAST, slotRefs: [] },
  { requestCycleId: "cycle-a", status: "ended", expiresAt: FUTURE, slotRefs: [] }
]) {
  const input = clone(turnInput());
  input.referenceableCycles = [unavailableCycle];
  const unavailable = validatedPipeline({ input });
  assert.equal(unavailable.linkResult.ok, false);
  assert.equal(unavailable.linkResult.code, "CONTEXT_TARGET_UNAVAILABLE");
}

// 9 / AC-CTX-008 / AC-ISO-003: cross-property state is rejected at the C01
// verified-scope boundary before it can become a link target.
assert.throws(() => turnInput({
  propertyScope: scope,
  cycles: [{
    requestCycleId: "cycle-a",
    status: "active",
    expiresAt: FUTURE,
    slotRefs: [],
    propertyId: "property-b"
  }]
}), (error) => error && error.code === "PROPERTY_SCOPE_INVALID");
const propertyBInput = turnInput({
  propertyScope: { propertyId: "property-b", channel: "line-b", userId: "guest-b" }
});
const crossScopeLink = validateContextLink({
  unit: fourGuests.unit,
  linkCandidate: {
    contextLinkCandidateId: "link-context",
    unitId: "unit-context",
    actionCandidate: "MODIFY",
    targetRequestCycleId: "cycle-a",
    evidenceRefs: [evidence(fourGuestsText)]
  },
  understandingTurnInput: propertyBInput,
  validatedEvidenceRefs: [evidence(fourGuestsText)],
  now: NOW
});
assert.equal(crossScopeLink.ok, false);
assert.equal(crossScopeLink.code, "CONTEXT_TARGET_SCOPE_CONFLICT");
const untrustedInputClone = clone(fourGuests.input);
const untrustedUnitEvidence = validateAndNormalizeSourceEvidence(
  [evidence(fourGuestsText)],
  untrustedInputClone.sourceEvents
);
const untrustedUnit = validateSemanticUnit({
  unit: candidate({ messageText: fourGuestsText }),
  validatedEvidenceRefs: untrustedUnitEvidence.value,
  understandingTurnInput: untrustedInputClone,
  publicCatalogIdentitySet: null,
  capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY)
});
assert.equal(untrustedUnit.ok, true, "the Context boundary must independently require adapter-owned C01 scope");
const untrustedLink = validateContextLink({
  unit: untrustedUnit.value,
  linkCandidate: {
    contextLinkCandidateId: "link-context",
    unitId: "unit-context",
    actionCandidate: "MODIFY",
    targetRequestCycleId: "cycle-a",
    evidenceRefs: [evidence(fourGuestsText)]
  },
  understandingTurnInput: untrustedInputClone,
  validatedEvidenceRefs: untrustedUnitEvidence.value,
  now: NOW
});
assert.equal(untrustedLink.ok, false);
assert.equal(untrustedLink.code, "CONTEXT_TARGET_SCOPE_CONFLICT");

// 10 / AC-CTX-018 / AC-LIF-018: duplicate target identities are ambiguous;
// Context never chooses the latest/first/pending candidate.
const ambiguousInput = clone(turnInput());
ambiguousInput.referenceableCycles.push(clone(ambiguousInput.referenceableCycles[0]));
const ambiguous = validatedPipeline({ input: ambiguousInput });
assert.equal(ambiguous.linkResult.ok, false);
assert.equal(ambiguous.linkResult.code, "CONTEXT_TARGET_AMBIGUOUS");

// AC-LIF-001..010: exact cardinality, closed status, unit ownership, and
// duplicate lifecycle identities fail at the lifecycle owner.
const start = validatedPipeline({ action: "START", target: null, slots: [] });
assert.equal(start.lifecycleResult.ok, true);
assert.equal(start.lifecycleResult.value.targetRequestCycleId, null);
const capabilitySwitch = validatedPipeline({
  action: "START",
  target: null,
  slots: [],
  unitOverrides: {
    purpose: "lodging_question",
    capability: "availability",
    subject: { kind: "room", catalogIdentity: "room-a" },
    stayDependent: true,
    replyCandidate: { disposition: "ANSWER", reasonClass: "lodging_need" }
  }
});
assert.equal(capabilitySwitch.lifecycleResult.ok, true);
assert.equal(capabilitySwitch.unit.capability, "availability");
assert.equal(capabilitySwitch.lifecycleResult.value.action, "START");
assert.equal(capabilitySwitch.lifecycleResult.value.targetRequestCycleId, null, "an active pending cycle must not be selected for a capability switch");
const continued = validatedPipeline({
  action: "CONTINUE",
  slots: [slot({ messageText: fourGuestsText, id: "slot-continued-guests", slot: "guest_count", value: 4 })]
});
assert.equal(continued.lifecycleResult.ok, true);
assert.equal(continued.lifecycleResult.value.action, "CONTINUE");
assert.equal(applyDecision(state(), continued.lifecycleResult).next.tasks[0].guestCount, 4);
const none = validatedPipeline({ action: "NONE", target: null, slots: [] });
assert.equal(none.lifecycleResult.ok, true);
assert.equal(adaptLifecycleDecisionsToStateV3([none.lifecycleResult.value]).value.lifecycleOperations.length, 0);
const invalidStartTarget = validatedPipeline({ action: "START", target: "cycle-a", slots: [] });
assert.equal(invalidStartTarget.lifecycleResult.ok, false);
assert.equal(invalidStartTarget.lifecycleResult.code, "LIFECYCLE_START_TARGET_FORBIDDEN");
const forgedStatus = { ...clone(fourGuests.lifecycleResult.value), status: "APPLIED" };
assert.equal(validateLifecycleDecisions([forgedStatus], { unitIds: ["unit-context"] }).code, "LIFECYCLE_TRANSITION_INVALID");
const forgedNonPersistedGuests = clone(fourGuests.lifecycleResult.value);
forgedNonPersistedGuests.verifiedSlotOperations[0].persistedField = null;
assert.equal(validateLifecycleDecisions([forgedNonPersistedGuests], { unitIds: ["unit-context"] }).code, "LIFECYCLE_TRANSITION_INVALID");
const forgedSlotValue = clone(fourGuests.lifecycleResult.value);
forgedSlotValue.verifiedSlotOperations[0].value = { guestCount: 4 };
assert.equal(validateLifecycleDecisions([forgedSlotValue], { unitIds: ["unit-context"] }).code, "LIFECYCLE_TRANSITION_INVALID");
const forgedTransportValue = clone(driving.lifecycleResult.value);
forgedTransportValue.verifiedSlotOperations[0].value = { transport: "driving" };
assert.equal(validateLifecycleDecisions([forgedTransportValue], { unitIds: ["unit-context"] }).code, "LIFECYCLE_TRANSITION_INVALID");
assert.equal(validateLifecycleDecisions([
  fourGuests.lifecycleResult.value,
  { ...clone(fourGuests.lifecycleResult.value) }
], { unitIds: ["unit-context"] }).code, "LIFECYCLE_TRANSITION_INVALID");
assert.equal(validateLifecycleDecisions([fourGuests.lifecycleResult.value], { unitIds: ["other-unit"] }).code, "LIFECYCLE_TRANSITION_INVALID");

// Existing reducer callers remain byte-compatible when the new optional input
// is omitted; a cloned/forged lifecycle operation is not trusted.
const previous = state();
const unchangedPath = reduceConversationStateV3({ previous, scope: { ...scope, now: NOW } });
assert.deepEqual(unchangedPath.tasks, previous.tasks);
const adaptedGuest = adaptLifecycleDecisionsToStateV3([fourGuests.lifecycleResult.value]);
const forgedOperations = clone(adaptedGuest.value.lifecycleOperations);
assert.throws(() => reduceConversationStateV3({
  previous,
  lifecycleOperations: forgedOperations,
  scope: { ...scope, now: NOW }
}), /state_v3_lifecycle_operations_invalid/);

console.log(JSON.stringify({
  suite: "new-core-context-lifecycle",
  classification: "RUNTIME_COMPONENT_TEST",
  caseCount: 27,
  status: "PASS"
}));
