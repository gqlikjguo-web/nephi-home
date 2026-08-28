"use strict";

const assert = require("node:assert/strict");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
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
  createTrustedOperatorSafetyPolicy,
  createUnitRoutingDecision
} = require("../lib/new-core/unit-reply-router");
const {
  aggregateUnitOutcomes,
  isTrustedUnitAggregationResult
} = require("../lib/new-core/unit-aggregator");
const { validateUnitAggregationResult } = require("../lib/new-core/contracts/unit-aggregation-result");

const NOW = "2026-08-28T08:00:00.000Z";
const MESSAGE = "請回答房價，幫我取消訂房，謝謝";
const scope = { propertyId: "property-aggregation", channel: "line-aggregation", userId: "guest-aggregation" };
const routingRegistry = createUnitReplyRoutingRegistry(projectCapabilityRegistry(CAPABILITY_REGISTRY));

function evidence() {
  return {
    eventId: "event-aggregation",
    messageRef: "message-aggregation",
    startOffset: 0,
    endOffset: MESSAGE.length,
    quote: MESSAGE
  };
}

const turnInput = buildUnderstandingTurnInput({
  coreVersion: "new-core-v1",
  traceId: "trace-aggregation",
  turnId: "turn-aggregation",
  verifiedPropertyBinding: { propertyId: scope.propertyId, channel: scope.channel },
  verifiedConversationScope: { channel: scope.channel, userId: scope.userId },
  sourceEvents: [{
    eventId: "event-aggregation",
    messageRef: "message-aggregation",
    role: "guest",
    timestamp: NOW,
    messageKind: "text",
    messageText: MESSAGE
  }],
  recentConversation: [],
  stateV3Snapshot: {
    scope,
    referenceableCycles: [{
      requestCycleId: "cycle-aggregation",
      status: "pending",
      expiresAt: "2026-08-29T08:00:00.000Z",
      slotRefs: []
    }]
  },
  publicCatalog: {
    propertyId: scope.propertyId,
    timezone: "Asia/Taipei",
    capabilityCatalog: ["availability", "price", "property_fact", "booking_request", "high_risk"],
    publicSubjectCatalog: [
      { catalogIdentity: "room-aggregation", kind: "room", propertyId: scope.propertyId, publicName: "Room aggregation" },
      { catalogIdentity: "policy-aggregation", kind: "policy", propertyId: scope.propertyId, publicName: "Policy aggregation" },
      { catalogIdentity: "other-aggregation", kind: "other_verified", propertyId: scope.propertyId, publicName: "Other aggregation" }
    ]
  }
});
const normalizedEvidence = validateAndNormalizeSourceEvidence([evidence()], turnInput.sourceEvents);
assert.equal(normalizedEvidence.ok, true);
const identitySet = buildPublicCatalogIdentitySet(turnInput);
const capabilityRegistry = projectCapabilityRegistry(CAPABILITY_REGISTRY);

function candidate({
  unitId,
  purpose = "lodging_question",
  capability = "property_fact",
  subject = { kind: "policy", catalogIdentity: "policy-aggregation" },
  stayDependent = false,
  temporalCandidate = null,
  disposition = "ANSWER",
  reasonClass = "lodging_need"
}) {
  return {
    unitId,
    evidenceRefs: [evidence()],
    purpose,
    capability,
    subject,
    stayDependent,
    temporalCandidate,
    contextLinkCandidateId: `link-${unitId}`,
    replyCandidate: { disposition, reasonClass },
    slotCandidates: [],
    confidenceBand: "high"
  };
}

function pipeline({ unit, action = "START", target = null }) {
  const semantic = validateSemanticUnit({
    unit,
    validatedEvidenceRefs: normalizedEvidence.value,
    understandingTurnInput: turnInput,
    publicCatalogIdentitySet: identitySet,
    capabilityRegistryProjection: capabilityRegistry
  });
  assert.equal(semantic.ok, true, semantic.code);
  const context = validateContextLink({
    unit: semantic.value,
    linkCandidate: {
      contextLinkCandidateId: unit.contextLinkCandidateId,
      unitId: unit.unitId,
      actionCandidate: action,
      targetRequestCycleId: target,
      evidenceRefs: [evidence()]
    },
    understandingTurnInput: turnInput,
    validatedEvidenceRefs: normalizedEvidence.value,
    now: NOW
  });
  assert.equal(context.ok, true, context.code);
  const lifecycle = createLifecycleDecision({
    lifecycleDecisionId: `lifecycle-${unit.unitId}`,
    unit: semantic.value,
    validatedContextLink: context.value
  });
  assert.equal(lifecycle.ok, true, lifecycle.code);
  const readiness = createUnitReadiness({
    unit: semantic.value,
    lifecycleDecision: lifecycle.value,
    routingRegistry
  });
  assert.equal(readiness.ok, true, readiness.code);
  const safety = unit.capability === "booking_operator_request"
    ? createTrustedOperatorSafetyPolicy({
      unit: semantic.value,
      lifecycleDecision: lifecycle.value,
      routingRegistry
    })
    : null;
  if (safety) assert.equal(safety.ok, true, safety.code);
  const route = createUnitRoutingDecision({
    unit: semantic.value,
    lifecycleDecision: lifecycle.value,
    routingRegistry,
    readiness: readiness.value,
    operatorSafetyPolicy: safety && safety.value
  });
  assert.equal(route.ok, true, route.code);
  return { unit: semantic.value, lifecycle: lifecycle.value, route: route.value };
}

const answer = pipeline({ unit: candidate({ unitId: "unit-answer" }) });
const handoff = pipeline({
  unit: candidate({
    unitId: "unit-handoff",
    purpose: "operator_request",
    capability: "booking_operator_request",
    subject: { kind: "room", catalogIdentity: "room-aggregation" },
    disposition: "HANDOFF",
    reasonClass: "booking_mutation"
  }),
  action: "CONTINUE",
  target: "cycle-aggregation"
});
const clarify = pipeline({
  unit: candidate({
    unitId: "unit-clarify",
    capability: "availability",
    subject: { kind: "room", catalogIdentity: "room-aggregation" },
    stayDependent: true,
    disposition: "CLARIFY",
    reasonClass: "missing_stay_dates"
  })
});
const noReply = pipeline({
  unit: candidate({
    unitId: "unit-no-reply",
    purpose: "acknowledgement",
    capability: null,
    subject: { kind: null, catalogIdentity: null },
    disposition: "NO_REPLY",
    reasonClass: "acknowledgement"
  }),
  action: "NONE"
});
const failed = pipeline({ unit: candidate({ unitId: "unit-failed" }) });

const canonicalAnswer = Object.freeze({ unitId: "unit-answer", canonicalInputId: "canonical-answer" });
const canonicalFailed = Object.freeze({ unitId: "unit-failed", canonicalInputId: "canonical-failed" });
const downstreamAnswer = Object.freeze({ unitId: "unit-answer", outcomeRef: Object.freeze({ outcomeId: "outcome-answer" }) });
const downstreamFailed = Object.freeze({ unitId: "unit-failed", outcomeRef: Object.freeze({ outcomeId: "outcome-failed" }) });
const failedUnit = Object.freeze({ unitId: "unit-failed", failureCode: "CANONICAL_REJECTED" });
const invalidSibling = Object.freeze({ unitId: "unit-invalid", failureCode: "SEMANTIC_UNIT_INVALID" });

const validatedUnits = [noReply.unit, answer.unit, handoff.unit, clarify.unit, failed.unit];
const lifecycleDecisions = [failed.lifecycle, clarify.lifecycle, handoff.lifecycle, answer.lifecycle, noReply.lifecycle];
const routingDecisions = [clarify.route, noReply.route, failed.route, answer.route, handoff.route];

// AC-MUL-001..009 / AC-PAR-001..005: changing aggregation to choose one
// turn-level disposition, or dropping a sibling after a failure, makes these
// independently routed outcomes disappear.
const aggregated = aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits,
  lifecycleDecisions,
  routingDecisions,
  canonicalItems: [canonicalFailed, canonicalAnswer],
  downstreamOutcomes: [downstreamFailed, downstreamAnswer],
  failedUnits: [failedUnit, invalidSibling]
});
assert.equal(aggregated.ok, true, aggregated.code);
assert.equal(isTrustedUnitAggregationResult(aggregated.value), true);
assert.equal(Object.isFrozen(aggregated.value), true);
assert.deepEqual(aggregated.value.unitOutcomes.map((outcome) => outcome.unitId), [
  "unit-no-reply", "unit-answer", "unit-handoff", "unit-clarify", "unit-failed"
]);
assert.deepEqual(aggregated.value.canonicalItems, [canonicalAnswer, canonicalFailed]);
assert.equal(aggregated.value.unitOutcomes[0].canonicalItem, null, "lifecycle-only NO_REPLY owns no executable item");
assert.equal(aggregated.value.unitOutcomes[1].canonicalItem, canonicalAnswer);
assert.equal(aggregated.value.unitOutcomes[2].canonicalItem, null);
assert.equal(aggregated.value.unitOutcomes[3].canonicalItem, null);
assert.equal(aggregated.value.unitOutcomes[1].routingDecision, answer.route, "C09 keeps the exact C07 route rather than promoting a turn route");
assert.equal(aggregated.value.unitOutcomes[2].lifecycleDecision, handoff.lifecycle, "C09 keeps the protected pending lifecycle reference");
assert.equal(aggregated.value.unitOutcomes[2].lifecycleDecision.targetRequestCycleId, "cycle-aggregation");
assert.equal(aggregated.value.unitOutcomes[4].failure, failedUnit, "a failed unit remains explicit without erasing an answer sibling");
assert.equal(aggregated.value.unitOutcomes[1].downstreamOutcomeRef, downstreamAnswer.outcomeRef);
assert.deepEqual(aggregated.value.failedUnits, [failedUnit, invalidSibling], "an invalid pre-C03 sibling remains explicit beside validated work");
assert.equal(aggregated.value.hasReplyWork, true);
assert.equal(aggregated.value.hasClarification, true);
assert.equal(aggregated.value.hasHandoff, true);
assert.equal(aggregated.value.allNoReply, false);

// AC-NRP-001 / AC-CTX-015..018: lifecycle-only/no-reply units remain covered
// while producing no canonical work.
const onlyNoReply = aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [noReply.unit],
  lifecycleDecisions: [noReply.lifecycle],
  routingDecisions: [noReply.route]
});
assert.equal(onlyNoReply.ok, true, onlyNoReply.code);
assert.equal(onlyNoReply.value.allNoReply, true);
assert.equal(onlyNoReply.value.hasReplyWork, false);
assert.deepEqual(onlyNoReply.value.canonicalItems, []);

// C09 must not smuggle a mutable later-stage reference through an otherwise
// frozen result; a shallow freeze would let downstream code change canonical
// or outcome data after ownership validation.
const shallowCanonical = Object.freeze({ unitId: "unit-answer", nested: {} });
const shallowOutcome = Object.freeze({ unitId: "unit-answer", outcomeRef: Object.freeze({ nested: {} }) });
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [answer.unit],
  lifecycleDecisions: [answer.lifecycle],
  routingDecisions: [answer.route],
  canonicalItems: [shallowCanonical]
}).code, "CANONICAL_ITEM_ORPHAN");
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [answer.unit],
  lifecycleDecisions: [answer.lifecycle],
  routingDecisions: [answer.route],
  canonicalItems: [canonicalAnswer],
  downstreamOutcomes: [shallowOutcome]
}).code, "UNIT_OUTCOME_ORPHAN");
const mapCanonical = Object.freeze({ unitId: "unit-answer", nested: Object.freeze(new Map()) });
const callableOutcome = Object.freeze({ unitId: "unit-answer", outcomeRef: Object.freeze({ nested: () => {} }) });
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [answer.unit],
  lifecycleDecisions: [answer.lifecycle],
  routingDecisions: [answer.route],
  canonicalItems: [mapCanonical]
}).code, "CANONICAL_ITEM_ORPHAN");
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [answer.unit],
  lifecycleDecisions: [answer.lifecycle],
  routingDecisions: [answer.route],
  canonicalItems: [canonicalAnswer],
  downstreamOutcomes: [callableOutcome]
}).code, "UNIT_OUTCOME_ORPHAN");

// The exported C09 validator is itself the coverage/ownership gate, so a
// structurally shaped handoff cannot gain a canonical item or contradictory
// turn flags outside the aggregator factory.
const handoffCanonical = Object.freeze({ unitId: "unit-handoff", canonicalInputId: "canonical-handoff" });
const routeEscalation = {
  ...aggregated.value,
  unitOutcomes: aggregated.value.unitOutcomes.map((outcome) => outcome.unitId === "unit-handoff"
    ? { ...outcome, canonicalItem: handoffCanonical }
    : outcome),
  canonicalItems: [canonicalAnswer, handoffCanonical, canonicalFailed],
  hasReplyWork: false
};
assert.equal(validateUnitAggregationResult(routeEscalation).ok, false);

// AC-MUL-011..014: duplicate, missing, orphan, and route-forged ownership
// must fail at C09 instead of being repaired or silently ignored.
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [answer.unit, answer.unit],
  lifecycleDecisions: [answer.lifecycle],
  routingDecisions: [answer.route],
  canonicalItems: [canonicalAnswer]
}).code, "UNIT_OUTCOME_DUPLICATE");
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [answer.unit, handoff.unit],
  lifecycleDecisions: [answer.lifecycle],
  routingDecisions: [answer.route, handoff.route],
  canonicalItems: [canonicalAnswer]
}).code, "UNIT_COVERAGE_INCOMPLETE");
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [answer.unit],
  lifecycleDecisions: [answer.lifecycle, handoff.lifecycle],
  routingDecisions: [answer.route],
  canonicalItems: [canonicalAnswer]
}).code, "UNIT_OUTCOME_ORPHAN");
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [handoff.unit],
  lifecycleDecisions: [handoff.lifecycle],
  routingDecisions: [handoff.route],
  canonicalItems: [canonicalAnswer]
}).code, "CANONICAL_ITEM_ORPHAN");
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [answer.unit],
  lifecycleDecisions: [answer.lifecycle],
  routingDecisions: [{ ...answer.route }],
  canonicalItems: [canonicalAnswer]
}).code, "AGGREGATION_ROUTE_CONFLICT");

console.log(JSON.stringify({
  suite: "new-core-unit-aggregation",
  level: "STRUCTURED_CONTRACT_TEST",
  caseCount: 19,
  passCount: 19,
  failCount: 0
}));
