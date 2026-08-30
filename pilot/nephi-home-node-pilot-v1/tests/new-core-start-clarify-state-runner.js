"use strict";

const assert = require("node:assert/strict");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { buildCanonicalFormalRequest } = require("../lib/conversation-engine-v2/formal-request");
const {
  createConversationStateV3
} = require("../lib/conversation-contracts/conversation-state-v3");
const { reduceConversationStateV3 } = require("../lib/conversation-engine-v2/conversation-state-v3-reducer");
const {
  buildUnderstandingTurnInput,
  buildPublicCatalogIdentityProjection
} = require("../lib/new-core/turn-input-adapter");
const { validateAndNormalizeSourceEvidence } = require("../lib/new-core/source-evidence-validator");
const {
  buildPublicCatalogIdentitySet,
  projectCapabilityRegistry,
  validateSemanticUnit
} = require("../lib/new-core/semantic-unit-validator");
const { validateContextLink } = require("../lib/new-core/context-link-validator");
const { createLifecycleDecision } = require("../lib/new-core/lifecycle-manager");
const {
  createUnitReplyRoutingRegistry,
  createUnitReadiness,
  createUnitRoutingDecision
} = require("../lib/new-core/unit-reply-router");
const { aggregateUnitOutcomes } = require("../lib/new-core/unit-aggregator");
const { adaptLifecycleDecisionsToStateV3 } = require("../lib/new-core/state-v3-lifecycle-adapter");
const {
  createCanonicalizerInputItem,
  executeCanonicalizerInputItem
} = require("../lib/new-core/canonical-execution-adapter");

const NOW = "2026-08-29T08:00:00.000Z";
const FUTURE = "2026-08-30T08:00:00.000Z";
const MESSAGE = "想了解包棟價格";
const scope = {
  propertyId: "property-start-clarify",
  channel: "line-start-clarify",
  userId: "guest-start-clarify"
};
const catalog = buildPropertyCatalog({
  propertyId: scope.propertyId,
  displayName: "START CLARIFY Property",
  timezone: "Asia/Taipei",
  businessProfile: {},
  rooms: [
    { id: "room-a", displayName: "Room A", type: "four_person", aliases: [], enabled: true },
    { id: "bundle-all", displayName: "包棟", inventoryType: "bundle", aliases: ["包棟"], enabled: true, memberRoomIds: ["room-a"] }
  ],
  propertyFacts: [],
  commonAnswers: {}
});

function evidence() {
  return {
    eventId: "event-start-clarify",
    messageRef: "message-start-clarify",
    startOffset: 0,
    endOffset: MESSAGE.length,
    quote: MESSAGE
  };
}

const input = buildUnderstandingTurnInput({
  coreVersion: "new-core-v1",
  traceId: "trace-start-clarify",
  turnId: "turn-start-clarify",
  verifiedPropertyBinding: { propertyId: scope.propertyId, channel: scope.channel },
  verifiedConversationScope: { channel: scope.channel, userId: scope.userId },
  sourceEvents: [{
    eventId: "event-start-clarify",
    messageRef: "message-start-clarify",
    role: "guest",
    timestamp: NOW,
    messageKind: "text",
    messageText: MESSAGE
  }],
  recentConversation: [],
  stateV3Snapshot: { scope, referenceableCycles: [] },
  publicCatalog: {
    propertyId: scope.propertyId,
    timezone: "Asia/Taipei",
    capabilityCatalog: ["price"],
    publicSubjectCatalog: [
      { catalogIdentity: "room-a", kind: "room", propertyId: scope.propertyId, publicName: "Room A" },
      { catalogIdentity: "bundle-all", kind: "bundle", propertyId: scope.propertyId, publicName: "包棟" }
    ]
  }
});
const normalizedEvidence = validateAndNormalizeSourceEvidence([evidence()], input.sourceEvents);
assert.equal(normalizedEvidence.ok, true);
const rawUnit = {
  unitId: "unit-start-clarify",
  evidenceRefs: [evidence()],
  purpose: "lodging_question",
  capability: "price",
  subject: { kind: "bundle", catalogIdentity: "bundle-all" },
  stayDependent: true,
  temporalCandidate: null,
  contextLinkCandidateId: "link-start-clarify",
  safetyCandidate: null,
  slotCandidates: [],
  confidenceBand: "high"
};
const semantic = validateSemanticUnit({
  unit: rawUnit,
  validatedEvidenceRefs: normalizedEvidence.value,
  understandingTurnInput: input,
  publicCatalogIdentitySet: buildPublicCatalogIdentitySet(input),
  capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY)
});
assert.equal(semantic.ok, true, semantic.code);
const context = validateContextLink({
  unit: semantic.value,
  linkCandidate: {
    contextLinkCandidateId: rawUnit.contextLinkCandidateId,
    unitId: rawUnit.unitId,
    relationKind: "NEW_REQUEST",
    targetRequestCycleIdCandidate: null,
    evidenceRefs: [evidence()]
  },
  understandingTurnInput: input,
  validatedEvidenceRefs: normalizedEvidence.value,
  now: NOW
});
assert.equal(context.ok, true, context.code);
const lifecycle = createLifecycleDecision({
  lifecycleDecisionId: "lifecycle-start-clarify",
  unit: semantic.value,
  validatedContextLink: context.value
});
assert.equal(lifecycle.ok, true, lifecycle.code);
const routingRegistry = createUnitReplyRoutingRegistry(projectCapabilityRegistry(CAPABILITY_REGISTRY));
const readiness = createUnitReadiness({
  unit: semantic.value,
  lifecycleDecision: lifecycle.value,
  routingRegistry
});
assert.equal(readiness.ok, true, readiness.code);
const route = createUnitRoutingDecision({
  unit: semantic.value,
  lifecycleDecision: lifecycle.value,
  routingRegistry,
  readiness: readiness.value
});
assert.equal(route.ok, true, route.code);
assert.deepEqual(route.value.missingGuestFields, ["stay.checkIn", "stay.checkOut"]);
const aggregation = aggregateUnitOutcomes({
  turnId: input.turnId,
  validatedUnits: [semantic.value],
  lifecycleDecisions: [lifecycle.value],
  routingDecisions: [route.value],
  canonicalItems: []
});
assert.equal(aggregation.ok, true, aggregation.code);

const previous = createConversationStateV3({
  ...scope,
  revision: 0,
  tasks: [],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: NOW
});
const adapted = adaptLifecycleDecisionsToStateV3({
  decisions: [lifecycle.value],
  aggregationResult: aggregation.value,
  previous
});
assert.equal(adapted.ok, true, adapted.code);
assert.equal(
  Array.isArray(adapted.value.taskCreations),
  true,
  "START + CLARIFY must create a trusted non-executable reducer input"
);
assert.throws(() => reduceConversationStateV3({
  previous,
  taskCreations: JSON.parse(JSON.stringify(adapted.value.taskCreations)),
  scope: { ...scope, now: NOW }
}), /state_v3_task_creations_invalid/);
assert.throws(() => reduceConversationStateV3({
  previous,
  taskCreations: adapted.value.taskCreations,
  scope: { ...scope, propertyId: "other-property", now: NOW }
}), /state_v3_task_creations_invalid/);
const next = reduceConversationStateV3({
  previous,
  taskCreations: adapted.value.taskCreations,
  scope: { ...scope, now: NOW }
});
assert.equal(next.tasks.length, 1, "START + CLARIFY must persist one pending task");
assert.deepEqual(next.tasks[0], {
  taskId: "unit-start-clarify",
  taskType: "pricing",
  productType: "bundle",
  productId: "bundle-all",
  roomTypeId: null,
  bundleId: "bundle-all",
  checkIn: null,
  checkOut: null,
  guestCount: null,
  searchFrom: null,
  searchTo: null,
  entityId: "bundle-all",
  entityCategory: "bundle",
  detailIntent: "general",
  knownFields: ["productType", "productId", "bundleId"],
  missingFields: ["checkIn", "checkOut"],
  status: "needs_clarification",
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
const repeatedAdapted = adaptLifecycleDecisionsToStateV3({
  decisions: [lifecycle.value],
  aggregationResult: aggregation.value,
  previous: next
});
assert.equal(repeatedAdapted.ok, true, repeatedAdapted.code);
const repeated = reduceConversationStateV3({
  previous: next,
  taskCreations: repeatedAdapted.value.taskCreations,
  scope: { ...scope, now: NOW }
});
assert.equal(repeated.tasks.length, 2, "a repeated cross-turn unit id must receive a unique cycle id");
assert.equal(repeated.tasks[1].taskId, "unit-start-clarify#2");

const duplicateSlotRawUnit = {
  ...rawUnit,
  unitId: "unit-start-clarify-duplicate-product",
  contextLinkCandidateId: "link-start-clarify-duplicate-product",
  slotCandidates: ["a", "b"].map((suffix) => ({
    slotCandidateId: `slot-product-${suffix}`,
    slot: "product",
    operation: "SET",
    value: "bundle-all",
    evidenceRefs: [evidence()]
  }))
};
const duplicateSlotSemantic = validateSemanticUnit({
  unit: duplicateSlotRawUnit,
  validatedEvidenceRefs: normalizedEvidence.value,
  understandingTurnInput: input,
  publicCatalogIdentitySet: buildPublicCatalogIdentitySet(input),
  capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY)
});
assert.equal(duplicateSlotSemantic.ok, true, duplicateSlotSemantic.code);
const duplicateSlotContext = validateContextLink({
  unit: duplicateSlotSemantic.value,
  linkCandidate: {
    contextLinkCandidateId: duplicateSlotRawUnit.contextLinkCandidateId,
    unitId: duplicateSlotRawUnit.unitId,
    relationKind: "NEW_REQUEST",
    targetRequestCycleIdCandidate: null,
    evidenceRefs: [evidence()]
  },
  understandingTurnInput: input,
  validatedEvidenceRefs: normalizedEvidence.value,
  now: NOW
});
assert.equal(duplicateSlotContext.ok, true, duplicateSlotContext.code);
const duplicateSlotLifecycle = createLifecycleDecision({
  lifecycleDecisionId: "lifecycle-start-clarify-duplicate-product",
  unit: duplicateSlotSemantic.value,
  validatedContextLink: duplicateSlotContext.value
});
assert.equal(duplicateSlotLifecycle.ok, true, duplicateSlotLifecycle.code);
const duplicateSlotReadiness = createUnitReadiness({
  unit: duplicateSlotSemantic.value,
  lifecycleDecision: duplicateSlotLifecycle.value,
  routingRegistry
});
assert.equal(duplicateSlotReadiness.ok, true, duplicateSlotReadiness.code);
const duplicateSlotRoute = createUnitRoutingDecision({
  unit: duplicateSlotSemantic.value,
  lifecycleDecision: duplicateSlotLifecycle.value,
  routingRegistry,
  readiness: duplicateSlotReadiness.value
});
assert.equal(duplicateSlotRoute.ok, true, duplicateSlotRoute.code);
const duplicateSlotAggregation = aggregateUnitOutcomes({
  turnId: input.turnId,
  validatedUnits: [duplicateSlotSemantic.value],
  lifecycleDecisions: [duplicateSlotLifecycle.value],
  routingDecisions: [duplicateSlotRoute.value],
  canonicalItems: []
});
assert.equal(duplicateSlotAggregation.ok, true, duplicateSlotAggregation.code);
const duplicateSlotAdapted = adaptLifecycleDecisionsToStateV3({
  decisions: [duplicateSlotLifecycle.value],
  aggregationResult: duplicateSlotAggregation.value,
  previous
});
assert.equal(duplicateSlotAdapted.ok, false, "ambiguous persisted identity must fail closed");

const followUpMessage = "2026/09/20 到 09/21";
const followUpEvidence = {
  eventId: "event-start-clarify-follow-up",
  messageRef: "message-start-clarify-follow-up",
  startOffset: 0,
  endOffset: followUpMessage.length,
  quote: followUpMessage
};
const followUpInput = buildUnderstandingTurnInput({
  coreVersion: "new-core-v1",
  traceId: "trace-start-clarify-follow-up",
  turnId: "turn-start-clarify-follow-up",
  verifiedPropertyBinding: { propertyId: scope.propertyId, channel: scope.channel },
  verifiedConversationScope: { channel: scope.channel, userId: scope.userId },
  sourceEvents: [{
    eventId: followUpEvidence.eventId,
    messageRef: followUpEvidence.messageRef,
    role: "guest",
    timestamp: NOW,
    messageKind: "text",
    messageText: followUpMessage
  }],
  recentConversation: [],
  stateV3Snapshot: {
    scope,
    referenceableCycles: [{
      requestCycleId: next.tasks[0].taskId,
      requestKind: "pricing",
      capability: "price",
      status: "pending",
      expiresAt: next.tasks[0].expiresAt,
      subject: { kind: "bundle", catalogIdentity: "bundle-all" },
      missingFields: next.tasks[0].missingFields,
      confirmedValues: { checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null },
      slotRefs: next.tasks[0].knownFields
    }]
  },
  publicCatalog: {
    propertyId: scope.propertyId,
    timezone: "Asia/Taipei",
    capabilityCatalog: ["price"],
    publicSubjectCatalog: [
      { catalogIdentity: "room-a", kind: "room", propertyId: scope.propertyId, publicName: "Room A" },
      { catalogIdentity: "bundle-all", kind: "bundle", propertyId: scope.propertyId, publicName: "包棟" }
    ]
  }
});
const followUpNormalizedEvidence = validateAndNormalizeSourceEvidence(
  [followUpEvidence],
  followUpInput.sourceEvents
);
assert.equal(followUpNormalizedEvidence.ok, true);
const followUpRawUnit = {
  unitId: "unit-start-clarify-follow-up",
  evidenceRefs: [followUpEvidence],
  purpose: "lodging_question",
  capability: "price",
  subject: { kind: "bundle", catalogIdentity: "bundle-all" },
  stayDependent: true,
  temporalCandidate: {
    rawText: followUpMessage,
    kind: "date_range",
    checkInCandidate: "2026-09-20",
    checkOutCandidate: "2026-09-21",
    nightsCandidate: 1
  },
  contextLinkCandidateId: "link-start-clarify-follow-up",
  safetyCandidate: null,
  slotCandidates: [],
  confidenceBand: "high"
};
const followUpSemantic = validateSemanticUnit({
  unit: followUpRawUnit,
  validatedEvidenceRefs: followUpNormalizedEvidence.value,
  understandingTurnInput: followUpInput,
  publicCatalogIdentitySet: buildPublicCatalogIdentitySet(followUpInput),
  capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY)
});
assert.equal(followUpSemantic.ok, true, followUpSemantic.code);
const followUpContext = validateContextLink({
  unit: followUpSemantic.value,
  linkCandidate: {
    contextLinkCandidateId: followUpRawUnit.contextLinkCandidateId,
    unitId: followUpRawUnit.unitId,
    relationKind: "SUPPLEMENT",
    targetRequestCycleIdCandidate: next.tasks[0].taskId,
    evidenceRefs: [followUpEvidence]
  },
  understandingTurnInput: followUpInput,
  validatedEvidenceRefs: followUpNormalizedEvidence.value,
  now: NOW
});
assert.equal(followUpContext.ok, true, followUpContext.code);
const followUpLifecycle = createLifecycleDecision({
  lifecycleDecisionId: "lifecycle-start-clarify-follow-up",
  unit: followUpSemantic.value,
  validatedContextLink: followUpContext.value
});
assert.equal(followUpLifecycle.ok, true, followUpLifecycle.code);
assert.equal(followUpLifecycle.value.action, "CONTINUE");
assert.equal(followUpLifecycle.value.targetRequestCycleId, next.tasks[0].taskId);
const followUpReadiness = createUnitReadiness({
  unit: followUpSemantic.value,
  lifecycleDecision: followUpLifecycle.value,
  routingRegistry
});
assert.equal(followUpReadiness.ok, true, followUpReadiness.code);
const followUpRoute = createUnitRoutingDecision({
  unit: followUpSemantic.value,
  lifecycleDecision: followUpLifecycle.value,
  routingRegistry,
  readiness: followUpReadiness.value
});
assert.equal(followUpRoute.ok, true, followUpRoute.code);
const followUpC08 = createCanonicalizerInputItem({
  unit: followUpSemantic.value,
  lifecycleDecision: followUpLifecycle.value,
  routingDecision: followUpRoute.value,
  understandingTurnInput: followUpInput,
  canonicalizerCatalog: catalog,
  publicCatalogIdentityProjection: buildPublicCatalogIdentityProjection(followUpInput)
});
assert.equal(followUpC08.ok, true, followUpC08.code);
const contextSnapshot = {
  scope: { propertyId: scope.propertyId, channelId: scope.channel, userId: scope.userId },
  generatedAt: NOW,
  cycles: [{
    requestCycleId: next.tasks[0].taskId,
    requestKind: "pricing",
    status: "pending",
    confirmedInputs: {
      stay: { checkIn: null, checkOut: null, nights: null, guests: null, searchRange: null },
      inventory: { mode: "bundle_only", entityId: "bundle-all", features: [] },
      topic: { capabilityType: "price", canonicalId: "bundle-all", category: "bundle", detailIntent: "general", detailFields: [] }
    },
    temporalResult: null,
    sourceEvidenceRefs: [],
    contextReuseExpiresAt: next.tasks[0].expiresAt,
    pendingRequestId: next.tasks[0].taskId
  }]
};
const followUpCanonical = executeCanonicalizerInputItem({
  canonicalizerInputItem: followUpC08.value,
  catalog,
  publicCatalogIdentityProjection: buildPublicCatalogIdentityProjection(followUpInput),
  contextSnapshot
});
assert.equal(followUpCanonical.ok, true, followUpCanonical.code);
assert.equal(followUpCanonical.value.canonicalRequest.capability, "price");
assert.equal(
  followUpLifecycle.value.targetRequestCycleId,
  next.tasks[0].taskId,
  "the ANSWER C08 path must retain the same pending cycle at the C06 lifecycle authority"
);
const followUpAggregation = aggregateUnitOutcomes({
  turnId: followUpInput.turnId,
  validatedUnits: [followUpSemantic.value],
  lifecycleDecisions: [followUpLifecycle.value],
  routingDecisions: [followUpRoute.value],
  canonicalItems: [followUpCanonical.value]
});
assert.equal(followUpAggregation.ok, true, followUpAggregation.code);
const followUpAdapted = adaptLifecycleDecisionsToStateV3({
  decisions: [followUpLifecycle.value],
  aggregationResult: followUpAggregation.value,
  previous: next
});
assert.equal(followUpAdapted.ok, true, followUpAdapted.code);
assert.equal(
  Array.isArray(followUpAdapted.value.canonicalTaskBindings),
  true,
  "trusted C09 must carry the C06 cycle identity to the reducer without changing C08"
);
assert.deepEqual(followUpAdapted.value.canonicalTaskBindings, [{
  unitId: followUpSemantic.value.unitId,
  action: "CONTINUE",
  requestCycleId: next.tasks[0].taskId
}]);
const followUpFormal = buildCanonicalFormalRequest({
  property: { propertyId: scope.propertyId },
  canonicalRequest: followUpCanonical.value.canonicalRequest,
  requestCycleId: next.tasks[0].taskId,
  confirmedInputs: {
    stay: { checkIn: "2026-09-20", checkOut: "2026-09-21", nights: 1, guests: null, searchRange: null },
    inventory: { mode: "bundle_only", entityId: "bundle-all", features: [] }
  }
});
const completed = reduceConversationStateV3({
  previous: next,
  canonicalItems: [followUpCanonical.value],
  canonicalTaskBindings: followUpAdapted.value.canonicalTaskBindings,
  formalRequests: [followUpFormal],
  executionOutcomes: [{ taskId: followUpCanonical.value.canonicalRequest.taskId, outcome: "answered" }],
  scope: { ...scope, now: NOW }
});
assert.equal(completed.tasks.length, 1, "CONTINUE must update rather than fork the pending cycle");
assert.equal(completed.tasks[0].taskId, next.tasks[0].taskId);
assert.equal(completed.tasks[0].status, "answered");
assert.equal(completed.tasks[0].checkIn, "2026-09-20");
assert.equal(completed.tasks[0].checkOut, "2026-09-21");
const missingTargetAdapted = adaptLifecycleDecisionsToStateV3({
  decisions: [followUpLifecycle.value],
  aggregationResult: followUpAggregation.value,
  previous
});
assert.equal(missingTargetAdapted.ok, true, missingTargetAdapted.code);
assert.throws(() => reduceConversationStateV3({
  previous,
  canonicalItems: [followUpCanonical.value],
  canonicalTaskBindings: missingTargetAdapted.value.canonicalTaskBindings,
  formalRequests: [followUpFormal],
  executionOutcomes: [{ taskId: followUpCanonical.value.canonicalRequest.taskId, outcome: "answered" }],
  scope: { ...scope, now: NOW }
}), /state_v3_canonical_target_unavailable/);
const independentContext = validateContextLink({
  unit: followUpSemantic.value,
  linkCandidate: {
    contextLinkCandidateId: followUpRawUnit.contextLinkCandidateId,
    unitId: followUpRawUnit.unitId,
    relationKind: "NEW_REQUEST",
    targetRequestCycleIdCandidate: null,
    evidenceRefs: [followUpEvidence]
  },
  understandingTurnInput: followUpInput,
  validatedEvidenceRefs: followUpNormalizedEvidence.value,
  now: NOW
});
assert.equal(independentContext.ok, true, independentContext.code);
const independentLifecycle = createLifecycleDecision({
  lifecycleDecisionId: "lifecycle-independent-answer",
  unit: followUpSemantic.value,
  validatedContextLink: independentContext.value
});
assert.equal(independentLifecycle.ok, true, independentLifecycle.code);
const independentReadiness = createUnitReadiness({
  unit: followUpSemantic.value,
  lifecycleDecision: independentLifecycle.value,
  routingRegistry
});
const independentRoute = createUnitRoutingDecision({
  unit: followUpSemantic.value,
  lifecycleDecision: independentLifecycle.value,
  routingRegistry,
  readiness: independentReadiness.value
});
assert.equal(independentRoute.ok, true, independentRoute.code);
const independentC08 = createCanonicalizerInputItem({
  unit: followUpSemantic.value,
  lifecycleDecision: independentLifecycle.value,
  routingDecision: independentRoute.value,
  understandingTurnInput: followUpInput,
  canonicalizerCatalog: catalog,
  publicCatalogIdentityProjection: buildPublicCatalogIdentityProjection(followUpInput)
});
assert.equal(independentC08.ok, true, independentC08.code);
const independentCanonical = executeCanonicalizerInputItem({
  canonicalizerInputItem: independentC08.value,
  catalog,
  publicCatalogIdentityProjection: buildPublicCatalogIdentityProjection(followUpInput),
  contextSnapshot
});
assert.equal(independentCanonical.ok, true, independentCanonical.code);
assert.throws(() => reduceConversationStateV3({
  previous: next,
  canonicalItems: [independentCanonical.value],
  canonicalTaskBindings: followUpAdapted.value.canonicalTaskBindings,
  formalRequests: [followUpFormal],
  executionOutcomes: [{ taskId: independentCanonical.value.canonicalRequest.taskId, outcome: "answered" }],
  scope: { ...scope, now: NOW }
}), /state_v3_canonical_task_bindings_invalid/);
assert.throws(() => reduceConversationStateV3({
  previous: next,
  canonicalItems: [followUpCanonical.value, independentCanonical.value],
  canonicalTaskBindings: followUpAdapted.value.canonicalTaskBindings,
  formalRequests: [followUpFormal],
  executionOutcomes: [{ taskId: followUpCanonical.value.canonicalRequest.taskId, outcome: "answered" }],
  scope: { ...scope, now: NOW }
}), /state_v3_canonical_task_bindings_invalid/);
const independentAggregation = aggregateUnitOutcomes({
  turnId: followUpInput.turnId,
  validatedUnits: [followUpSemantic.value],
  lifecycleDecisions: [independentLifecycle.value],
  routingDecisions: [independentRoute.value],
  canonicalItems: [independentCanonical.value]
});
assert.equal(independentAggregation.ok, true, independentAggregation.code);
const independentAdapted = adaptLifecycleDecisionsToStateV3({
  decisions: [independentLifecycle.value],
  aggregationResult: independentAggregation.value,
  previous: next
});
assert.deepEqual(independentAdapted.value.canonicalTaskBindings, [], "START + ANSWER keeps the existing C08 identity path");
assert.deepEqual(independentAdapted.value.taskCreations, [], "START + ANSWER must not enter clarification creation");

console.log("new-core START + CLARIFY state: PASS (pending creation + same-cycle CONTINUE)");
