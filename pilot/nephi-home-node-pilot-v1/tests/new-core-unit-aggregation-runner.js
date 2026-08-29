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
      requestKind: "availability",
      capability: "availability",
      status: "pending",
      expiresAt: "2026-08-29T08:00:00.000Z",
      subject: { kind: "room", catalogIdentity: "room-aggregation" },
      missingFields: [],
      confirmedValues: { checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null },
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

function foreignAnswerFor(unitId) {
  const foreignInput = buildUnderstandingTurnInput({
    coreVersion: "new-core-v1",
    traceId: `trace-foreign-${unitId}`,
    turnId: `turn-foreign-${unitId}`,
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
        requestKind: "availability",
        capability: "availability",
        status: "pending",
        expiresAt: "2026-08-29T08:00:00.000Z",
        subject: { kind: "room", catalogIdentity: "room-aggregation" },
        missingFields: [],
        confirmedValues: { checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null },
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
  const foreignEvidence = validateAndNormalizeSourceEvidence([evidence()], foreignInput.sourceEvents);
  assert.equal(foreignEvidence.ok, true);
  const rawUnit = candidate({ unitId });
  const semantic = validateSemanticUnit({
    unit: rawUnit,
    validatedEvidenceRefs: foreignEvidence.value,
    understandingTurnInput: foreignInput,
    publicCatalogIdentitySet: buildPublicCatalogIdentitySet(foreignInput),
    capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY)
  });
  assert.equal(semantic.ok, true, semantic.code);
  const context = validateContextLink({
    unit: semantic.value,
    linkCandidate: {
      contextLinkCandidateId: rawUnit.contextLinkCandidateId,
      unitId,
      actionCandidate: "START",
      targetRequestCycleId: null,
      evidenceRefs: [evidence()]
    },
    understandingTurnInput: foreignInput,
    validatedEvidenceRefs: foreignEvidence.value,
    now: NOW
  });
  assert.equal(context.ok, true, context.code);
  const lifecycle = createLifecycleDecision({
    lifecycleDecisionId: `lifecycle-foreign-${unitId}`,
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
  const route = createUnitRoutingDecision({
    unit: semantic.value,
    lifecycleDecision: lifecycle.value,
    routingRegistry,
    readiness: readiness.value
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
const duplicateSemantic = pipeline({ unit: candidate({ unitId: "unit-duplicate-semantic" }) });

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

// C07 may be structurally identical across turns, but its private authority
// must remain bound to the exact C01/C03/C06 tuple that produced it. Without
// that provenance C09 can replace an acknowledgement/NONE route with a
// foreign ANSWER and canonical item under the same unitId.
const foreignAnswer = foreignAnswerFor("unit-answer");
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [answer.unit],
  lifecycleDecisions: [answer.lifecycle],
  routingDecisions: [foreignAnswer.route],
  canonicalItems: [canonicalAnswer]
}).code, "AGGREGATION_ROUTE_CONFLICT");
const sameTurnDifferentUnit = pipeline({ unit: candidate({ unitId: "unit-answer" }) });
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [answer.unit],
  lifecycleDecisions: [answer.lifecycle],
  routingDecisions: [sameTurnDifferentUnit.route],
  canonicalItems: [canonicalAnswer]
}).code, "AGGREGATION_ROUTE_CONFLICT");
const foreignAcknowledgementAnswer = foreignAnswerFor("unit-no-reply");
assert.equal(aggregateUnitOutcomes({
  turnId: turnInput.turnId,
  validatedUnits: [noReply.unit],
  lifecycleDecisions: [noReply.lifecycle],
  routingDecisions: [foreignAcknowledgementAnswer.route],
  canonicalItems: [Object.freeze({ unitId: "unit-no-reply", canonicalInputId: "forged-acknowledgement-answer" })]
}).code, "AGGREGATION_ROUTE_CONFLICT");

function scenarioCanonicalItem(item) {
  return Object.freeze({ unitId: item.unit.unitId, canonicalInputId: `scenario-${item.unit.unitId}` });
}

function aggregateScenario(items, { downstreamOutcomes = [], failedUnits = [] } = {}) {
  return aggregateUnitOutcomes({
    turnId: turnInput.turnId,
    validatedUnits: items.map((item) => item.unit),
    lifecycleDecisions: items.map((item) => item.lifecycle),
    routingDecisions: items.map((item) => item.route),
    canonicalItems: items.filter((item) => item.route.disposition === "ANSWER").map(scenarioCanonicalItem),
    downstreamOutcomes,
    failedUnits
  });
}

function assertScenario(id, items, expected) {
  const result = aggregateScenario(items, expected.options);
  assert.equal(result.ok, true, `${id}: ${result.code}`);
  assert.deepEqual(result.value.unitOutcomes.map((outcome) => outcome.unitId), items.map((item) => item.unit.unitId), `${id}: stable unit coverage/order`);
  assert.equal(result.value.hasReplyWork, expected.hasReplyWork, `${id}: reply-work attribution`);
  assert.equal(result.value.hasClarification, expected.hasClarification, `${id}: clarification attribution`);
  assert.equal(result.value.hasHandoff, expected.hasHandoff, `${id}: handoff attribution`);
  assert.equal(result.value.allNoReply, expected.allNoReply, `${id}: no-reply attribution`);
  return result.value;
}

// Explicit C09 replacement/attribution coverage. These cases deliberately
// assert unit ownership and downstream references rather than changing the
// protected product/fact/FinalDecision oracle.
const multiAttributionCases = [
  { id: "AC-MUL-001", items: [noReply, answer], hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false },
  { id: "AC-MUL-002", items: [noReply, answer], hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false },
  { id: "AC-MUL-003", items: [noReply], hasReplyWork: false, hasClarification: false, hasHandoff: false, allNoReply: true },
  { id: "AC-MUL-004", items: [answer, clarify, handoff], hasReplyWork: true, hasClarification: true, hasHandoff: true, allNoReply: false },
  { id: "AC-MUL-005", items: [answer, duplicateSemantic], hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false },
  { id: "AC-MUL-006", items: [answer], hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false,
    options: { failedUnits: [Object.freeze({ unitId: "unit-unknown-fragment", failureCode: "SEMANTIC_UNIT_INVALID" })] } },
  { id: "AC-MUL-007", items: [answer, handoff], hasReplyWork: true, hasClarification: false, hasHandoff: true, allNoReply: false },
  { id: "AC-MUL-008", items: [answer, duplicateSemantic], hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false },
  { id: "AC-MUL-009", items: [answer], hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false,
    options: { failedUnits: [Object.freeze({ unitId: "unit-invalid-sibling", failureCode: "SEMANTIC_UNIT_INVALID" })] } },
  { id: "AC-MUL-010", items: [answer, duplicateSemantic], hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false }
];
for (const expectation of multiAttributionCases) {
  const value = assertScenario(expectation.id, expectation.items, expectation);
  if (expectation.id === "AC-MUL-006" || expectation.id === "AC-MUL-009") {
    assert.equal(value.failedUnits.length, 1, `${expectation.id}: invalid sibling stays explicit`);
  }
  if (expectation.id === "AC-MUL-010") {
    assert.deepEqual(value.canonicalItems.map((item) => item.unitId), ["unit-answer", "unit-duplicate-semantic"], "AC-MUL-010: C09 never raw-text-deduplicates distinct units");
  }
}

const partialUnknown = Object.freeze({ unitId: "unit-answer", outcomeRef: Object.freeze({ status: "unknown" }) });
const partialClaimRejection = Object.freeze({ unitId: "unit-answer", outcomeRef: Object.freeze({ status: "claim_rejected" }) });
const partialComposerFailure = Object.freeze({ unitId: "unit-answer", outcomeRef: Object.freeze({ status: "composer_failed" }) });
const partialAttributionCases = [
  { id: "AC-PAR-001", items: [answer, handoff], expected: { hasReplyWork: true, hasClarification: false, hasHandoff: true, allNoReply: false } },
  { id: "AC-PAR-002", items: [answer, clarify], expected: { hasReplyWork: true, hasClarification: true, hasHandoff: false, allNoReply: false } },
  { id: "AC-PAR-003", items: [answer, duplicateSemantic, handoff], expected: { hasReplyWork: true, hasClarification: false, hasHandoff: true, allNoReply: false } },
  { id: "AC-PAR-004", items: [answer, failed], expected: { hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false,
    options: { failedUnits: [Object.freeze({ unitId: "unit-failed", failureCode: "CANONICAL_REJECTED" })] } } },
  { id: "AC-PAR-005", items: [answer, handoff], expected: { hasReplyWork: true, hasClarification: false, hasHandoff: true, allNoReply: false } },
  { id: "AC-PAR-006", items: [answer, duplicateSemantic], expected: { hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false,
    options: { downstreamOutcomes: [partialUnknown] } } },
  { id: "AC-PAR-007", items: [answer, duplicateSemantic], expected: { hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false,
    options: { downstreamOutcomes: [partialClaimRejection] } } },
  { id: "AC-PAR-008", items: [answer, duplicateSemantic], expected: { hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false,
    options: { downstreamOutcomes: [partialComposerFailure] } } },
  { id: "AC-PAR-009", items: [noReply, answer], expected: { hasReplyWork: true, hasClarification: false, hasHandoff: false, allNoReply: false } },
  { id: "AC-PAR-010", items: [handoff, answer, noReply], expected: { hasReplyWork: true, hasClarification: false, hasHandoff: true, allNoReply: false } }
];
for (const expectation of partialAttributionCases) {
  const value = assertScenario(expectation.id, expectation.items, expectation.expected);
  if (["AC-PAR-006", "AC-PAR-007", "AC-PAR-008"].includes(expectation.id)) {
    assert.equal(value.unitOutcomes[0].downstreamOutcomeRef.status, expectation.expected.options.downstreamOutcomes[0].outcomeRef.status, `${expectation.id}: scoped downstream failure/Unknown is retained`);
  }
  if (expectation.id === "AC-PAR-010") {
    assert.deepEqual(value.unitOutcomes.map((outcome) => outcome.unitId), ["unit-handoff", "unit-answer", "unit-no-reply"], "AC-PAR-010: no-reply/failure siblings cannot reorder a turn");
  }
}

// AC-MUL-011..014 retain individual, owned failure attribution rather than
// collapsing malformed collections into a turn-level response.
const ownershipAttributionCases = [
  { id: "AC-MUL-011", result: () => aggregateUnitOutcomes({ turnId: turnInput.turnId, validatedUnits: [answer.unit, answer.unit], lifecycleDecisions: [answer.lifecycle], routingDecisions: [answer.route], canonicalItems: [canonicalAnswer] }), code: "UNIT_OUTCOME_DUPLICATE" },
  { id: "AC-MUL-012", result: () => aggregateUnitOutcomes({ turnId: turnInput.turnId, validatedUnits: [answer.unit, handoff.unit], lifecycleDecisions: [answer.lifecycle], routingDecisions: [answer.route, handoff.route], canonicalItems: [canonicalAnswer] }), code: "UNIT_COVERAGE_INCOMPLETE" },
  { id: "AC-MUL-013", result: () => aggregateUnitOutcomes({ turnId: turnInput.turnId, validatedUnits: [answer.unit], lifecycleDecisions: [answer.lifecycle, handoff.lifecycle], routingDecisions: [answer.route], canonicalItems: [canonicalAnswer] }), code: "UNIT_OUTCOME_ORPHAN" },
  { id: "AC-MUL-014", result: () => aggregateUnitOutcomes({ turnId: turnInput.turnId, validatedUnits: [handoff.unit], lifecycleDecisions: [handoff.lifecycle], routingDecisions: [handoff.route], canonicalItems: [canonicalAnswer] }), code: "CANONICAL_ITEM_ORPHAN" }
];
for (const expectation of ownershipAttributionCases) {
  assert.equal(expectation.result().code, expectation.code, `${expectation.id}: exact C09 ownership gate`);
}

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
  caseCount: 46,
  passCount: 46,
  failCount: 0
}));
