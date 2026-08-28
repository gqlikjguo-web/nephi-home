"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
  createUnitRoutingDecision,
  isTrustedUnitRoutingDecision
} = require("../lib/new-core/unit-reply-router");
const { validateUnitRoutingDecision } = require("../lib/new-core/contracts/unit-routing-decision");

const NOW = "2026-08-28T08:00:00.000Z";
const scope = { propertyId: "property-a", channel: "line-a", userId: "guest-a" };
const registry = createUnitReplyRoutingRegistry(projectCapabilityRegistry(CAPABILITY_REGISTRY));

function sourceEvent(messageText) {
  return {
    eventId: "event-routing",
    messageRef: "message-routing",
    role: "guest",
    timestamp: NOW,
    messageKind: "text",
    messageText
  };
}

function evidence(messageText) {
  return {
    eventId: "event-routing",
    messageRef: "message-routing",
    startOffset: 0,
    endOffset: messageText.length,
    quote: messageText
  };
}

function input(messageText) {
  return buildUnderstandingTurnInput({
    coreVersion: "new-core-v1",
    traceId: "trace-unit-routing",
    turnId: "turn-unit-routing",
    verifiedPropertyBinding: { propertyId: scope.propertyId, channel: scope.channel },
    verifiedConversationScope: { channel: scope.channel, userId: scope.userId },
    sourceEvents: [sourceEvent(messageText)],
    recentConversation: [],
    stateV3Snapshot: {
      scope,
      referenceableCycles: [{
        requestCycleId: "cycle-routing",
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
        { catalogIdentity: "room-a", kind: "room", propertyId: scope.propertyId, publicName: "Room A" },
        { catalogIdentity: "policy-a", kind: "policy", propertyId: scope.propertyId, publicName: "Policy A" },
        { catalogIdentity: "safety-a", kind: "other_verified", propertyId: scope.propertyId, publicName: "Safety A" }
      ]
    }
  });
}

function candidate({
  messageText,
  unitId = "unit-routing",
  purpose = "lodging_question",
  capability = "availability",
  subject = { kind: "room", catalogIdentity: "room-a" },
  stayDependent = true,
  temporalCandidate = {
    rawText: messageText,
    kind: "date_range",
    checkInCandidate: "2026-09-01",
    checkOutCandidate: "2026-09-02",
    nightsCandidate: 1
  },
  disposition = "ANSWER",
  reasonClass = "lodging_need"
} = {}) {
  return {
    unitId,
    evidenceRefs: [evidence(messageText)],
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

function validated({ unit, messageText, action = "START", target = null }) {
  const turnInput = input(messageText);
  const evidenceResult = validateAndNormalizeSourceEvidence([evidence(messageText)], turnInput.sourceEvents);
  assert.equal(evidenceResult.ok, true);
  const unitResult = validateSemanticUnit({
    unit,
    validatedEvidenceRefs: evidenceResult.value,
    understandingTurnInput: turnInput,
    publicCatalogIdentitySet: buildPublicCatalogIdentitySet(turnInput),
    capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY)
  });
  assert.equal(unitResult.ok, true, unitResult.code);
  const linkResult = validateContextLink({
    unit: unitResult.value,
    linkCandidate: {
      contextLinkCandidateId: unit.contextLinkCandidateId,
      unitId: unit.unitId,
      actionCandidate: action,
      targetRequestCycleId: target,
      evidenceRefs: [evidence(messageText)]
    },
    understandingTurnInput: turnInput,
    validatedEvidenceRefs: evidenceResult.value,
    now: NOW
  });
  assert.equal(linkResult.ok, true, linkResult.code);
  const lifecycleResult = createLifecycleDecision({
    lifecycleDecisionId: `lifecycle-${unit.unitId}`,
    unit: unitResult.value,
    validatedContextLink: linkResult.value
  });
  assert.equal(lifecycleResult.ok, true, lifecycleResult.code);
  return { unit: unitResult.value, lifecycle: lifecycleResult.value };
}

function route({ unit, lifecycle, operatorSafetyPolicy = null }) {
  const readiness = createUnitReadiness({ unit, lifecycleDecision: lifecycle, routingRegistry: registry });
  assert.equal(readiness.ok, true, readiness.code);
  return createUnitRoutingDecision({
    unit,
    lifecycleDecision: lifecycle,
    routingRegistry: registry,
    readiness: readiness.value,
    operatorSafetyPolicy
  });
}

// AC-RTE-001 / AC-AVL-001 / AC-PRI-001 / AC-FCT-001: a complete lodging
// need reaches formal execution; changing this route to a no-reply or
// handoff would make this assertion fail.
for (const spec of [
  { messageText: "9/1有房嗎", capability: "availability", subject: { kind: "room", catalogIdentity: "room-a" }, stayDependent: true },
  { messageText: "9/1房價多少", capability: "price", subject: { kind: "room", catalogIdentity: "room-a" }, stayDependent: true },
  { messageText: "有什麼規定", capability: "property_fact", subject: { kind: "policy", catalogIdentity: "policy-a" }, stayDependent: false, temporalCandidate: null }
]) {
  const pipeline = validated({ unit: candidate(spec), messageText: spec.messageText });
  const result = route(pipeline);
  assert.deepEqual(result, {
    ok: true,
    code: null,
    errors: [],
    value: {
      unitId: "unit-routing",
      disposition: "ANSWER",
      reasonClass: "executable_lodging_need",
      requiresCanonicalExecution: true,
      missingGuestFields: [],
      operatorActionClass: null,
      riskClass: null
    }
  });
}

// AC-RTE-002 / AC-AVL-004 / AC-PRI-003 / AC-HOF-009: only formally missing
// guest inputs clarify a lodging need; neither unknown nor lifecycle chooses it.
const missingDatesText = "還有房嗎";
const missingDates = validated({
  messageText: missingDatesText,
  unit: candidate({
    messageText: missingDatesText,
    temporalCandidate: null,
    disposition: "CLARIFY",
    reasonClass: "missing_stay_dates"
  })
});
assert.deepEqual(route(missingDates).value, {
  unitId: "unit-routing",
  disposition: "CLARIFY",
  reasonClass: "missing_guest_fields",
  requiresCanonicalExecution: false,
  missingGuestFields: ["stay.checkIn", "stay.checkOut"],
  operatorActionClass: null,
  riskClass: null
});

// AC-RTE-003 / AC-HOF-003: operator work cannot hand off without an explicit
// structured operator basis.
const operatorText = "請幫我更改訂房";
const operator = validated({
  messageText: operatorText,
  unit: candidate({
    messageText: operatorText,
    purpose: "operator_request",
    capability: "booking_operator_request",
    subject: { kind: "room", catalogIdentity: "room-a" },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "HANDOFF",
    reasonClass: "booking_mutation"
  }),
  action: "CONTINUE",
  target: "cycle-routing"
});
const missingBasis = route(operator);
assert.equal(missingBasis.ok, false);
assert.equal(missingBasis.code, "HANDOFF_WITHOUT_OPERATOR_OR_RISK");
const operatorPolicy = createTrustedOperatorSafetyPolicy({
  unit: operator.unit,
  lifecycleDecision: operator.lifecycle,
  routingRegistry: registry
});
assert.equal(operatorPolicy.ok, true);
assert.deepEqual(route({ ...operator, operatorSafetyPolicy: operatorPolicy.value }).value, {
  unitId: "unit-routing",
  disposition: "HANDOFF",
  reasonClass: "operator_action_required",
  requiresCanonicalExecution: false,
  missingGuestFields: [],
  operatorActionClass: "booking_mutation",
  riskClass: null
});

// AC-RTE-003 / AC-HOF-001: a high-risk unit routes only from its explicit risk
// basis, not because the router saw message content.
const riskText = "請給我門鎖密碼";
const risk = validated({
  messageText: riskText,
  unit: candidate({
    messageText: riskText,
    purpose: "sensitive_request",
    capability: "high_risk",
    subject: { kind: "other_verified", catalogIdentity: "safety-a" },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "HANDOFF",
    reasonClass: "access_credential"
  })
});
const riskPolicy = createTrustedOperatorSafetyPolicy({ unit: risk.unit, lifecycleDecision: risk.lifecycle, routingRegistry: registry });
assert.equal(riskPolicy.ok, true);
assert.equal(route({ ...risk, operatorSafetyPolicy: riskPolicy.value }).value.riskClass, "access_credential");

// AC-HOF-004: cancellation END is lifecycle-only NO_REPLY. A separate
// operator-request unit carries reservation action handoff; no HANDOFF may
// own END.
const cancellationText = "請取消我的訂房";
const combinedCancellation = validated({
  messageText: cancellationText,
  action: "END",
  target: "cycle-routing",
  unit: candidate({
    messageText: cancellationText,
    purpose: "cancellation",
    capability: "booking_operator_request",
    subject: { kind: "room", catalogIdentity: "room-a" },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "NO_REPLY",
    reasonClass: "cancellation"
  })
});
assert.equal(route(combinedCancellation).ok, false, "a booking-operator cancellation may not combine END with NO_REPLY");
assert.equal(route(combinedCancellation).code, "ROUTE_PURPOSE_CONFLICT");
const cancellation = validated({
  messageText: cancellationText,
  action: "END",
  target: "cycle-routing",
  unit: candidate({
    messageText: cancellationText,
    unitId: "unit-cancellation-end",
    purpose: "cancellation",
    capability: null,
    subject: { kind: null, catalogIdentity: null },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "NO_REPLY",
    reasonClass: "cancellation"
  })
});
assert.equal(route(cancellation).value.disposition, "NO_REPLY");
const cancellationOperator = validated({
  messageText: cancellationText,
  action: "CONTINUE",
  target: "cycle-routing",
  unit: candidate({
    messageText: cancellationText,
    unitId: "unit-cancellation-operator",
    purpose: "operator_request",
    capability: "booking_operator_request",
    subject: { kind: "room", catalogIdentity: "room-a" },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "HANDOFF",
    reasonClass: "reservation_cancellation"
  })
});
const cancellationOperatorPolicy = createTrustedOperatorSafetyPolicy({
  unit: cancellationOperator.unit,
  lifecycleDecision: cancellationOperator.lifecycle,
  routingRegistry: registry
});
assert.equal(cancellationOperatorPolicy.ok, true);
assert.equal(route({ ...cancellationOperator, operatorSafetyPolicy: cancellationOperatorPolicy.value }).value.disposition, "HANDOFF");
const operatorEnd = validated({
  messageText: operatorText,
  action: "END",
  target: "cycle-routing",
  unit: candidate({
    messageText: operatorText,
    unitId: "unit-operator-end",
    purpose: "operator_request",
    capability: "booking_operator_request",
    subject: { kind: "room", catalogIdentity: "room-a" },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "HANDOFF",
    reasonClass: "booking_mutation"
  })
});
assert.equal(route(operatorEnd).code, "ROUTE_PURPOSE_CONFLICT");
const operatorNone = validated({
  messageText: operatorText,
  action: "NONE",
  unit: candidate({
    messageText: operatorText,
    unitId: "unit-operator-none",
    purpose: "operator_request",
    capability: "booking_operator_request",
    subject: { kind: "room", catalogIdentity: "room-a" },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "HANDOFF",
    reasonClass: "booking_mutation"
  })
});
assert.equal(route(operatorNone).code, "ROUTE_PURPOSE_CONFLICT");

// AC-NRP-001..008 / AC-RTE-004,009..012 / AC-CTX-015: acknowledgements,
// social/off-topic content and verified context-only updates stay silent per
// unit even when lifecycle is START, MODIFY, or NONE.
for (const [purpose, reasonClass, action, target] of [
  ["acknowledgement", "acknowledgement", "NONE", null],
  ["social", "social", "START", null],
  ["off_topic", "off_topic", "NONE", null],
  ["context_update", "context_only", "MODIFY", "cycle-routing"],
  ["correction", "correction", "MODIFY", "cycle-routing"]
]) {
  const messageText = `${purpose}-unit`;
  const pipeline = validated({
    messageText,
    action,
    target,
    unit: candidate({
      messageText,
      purpose,
      capability: null,
      subject: { kind: null, catalogIdentity: null },
      stayDependent: false,
      temporalCandidate: null,
      disposition: "NO_REPLY",
      reasonClass
    })
  });
  const result = route(pipeline);
  assert.equal(result.ok, true);
  assert.equal(result.value.disposition, "NO_REPLY");
  assert.equal(result.value.requiresCanonicalExecution, false);
}

// AC-MUL-002 / AC-RTE-012: correction is silent, while a separate new
// question remains answerable; no context or lifecycle branch may silence it.
const correctionText = "不是這個";
const correction = validated({
  messageText: correctionText,
  action: "MODIFY",
  target: "cycle-routing",
  unit: candidate({
    messageText: correctionText,
    unitId: "unit-correction",
    purpose: "correction",
    capability: null,
    subject: { kind: null, catalogIdentity: null },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "NO_REPLY",
    reasonClass: "correction"
  })
});
const newQuestionText = "停車規定";
const newQuestion = validated({
  messageText: newQuestionText,
  unit: candidate({
    messageText: newQuestionText,
    unitId: "unit-question",
    capability: "property_fact",
    subject: { kind: "policy", catalogIdentity: "policy-a" },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "ANSWER",
    reasonClass: "lodging_need"
  })
});
assert.equal(route(correction).value.disposition, "NO_REPLY");
const officialAnswer = route(newQuestion).value;
assert.equal(officialAnswer.disposition, "ANSWER");
assert.equal(Object.isFrozen(officialAnswer), true, "official C07 decisions are immutable");
assert.equal(isTrustedUnitRoutingDecision(officialAnswer), true, "only the official C07 factory brands its output");
assert.equal(isTrustedUnitRoutingDecision({ ...officialAnswer }), false, "a spread-equivalent C07 object is untrusted");
const bracketBuiltDecision = {};
for (const [key, value] of Object.entries(officialAnswer)) bracketBuiltDecision[key] = value;
assert.equal(isTrustedUnitRoutingDecision(bracketBuiltDecision), false, "a bracket-built C07 lookalike is untrusted");

// AC-HOF-007: an active pending continuation is not silenced; the unchanged
// C03 and basis route identically whether its C06 is START or CONTINUE.
const continued = route({ ...operator, operatorSafetyPolicy: operatorPolicy.value });
assert.equal(continued.value.disposition, "HANDOFF");
const operatorStart = validated({
  messageText: operatorText,
  action: "START",
  unit: candidate({
    messageText: operatorText,
    unitId: "unit-operator-start",
    purpose: "operator_request",
    capability: "booking_operator_request",
    subject: { kind: "room", catalogIdentity: "room-a" },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "HANDOFF",
    reasonClass: "booking_mutation"
  })
});
const startPolicy = createTrustedOperatorSafetyPolicy({
  unit: operatorStart.unit,
  lifecycleDecision: operatorStart.lifecycle,
  routingRegistry: registry
});
assert.equal(startPolicy.ok, true);
assert.deepEqual(
  (({ unitId: _unitId, ...value }) => value)(route({ ...operatorStart, operatorSafetyPolicy: startPolicy.value }).value),
  (({ unitId: _unitId, ...value }) => value)(continued.value),
  "START and CONTINUE lifecycle actions must not alter a protected operator route"
);
const rawHandoffPolicy = route({
  ...operator,
  operatorSafetyPolicy: { unitId: operator.unit.unitId, operatorActionClass: "booking_mutation", riskClass: null }
});
assert.equal(rawHandoffPolicy.ok, false);
assert.equal(rawHandoffPolicy.code, "HANDOFF_WITHOUT_OPERATOR_OR_RISK");

// AC-RTE-005..008 / AC-HOF-008: contradictions fail closed. A model candidate
// cannot route a non-actionable unit, and missing/invalid route inputs never
// choose an unknown shortcut route.
const contradictoryText = "謝謝";
const contradictory = validated({
  messageText: contradictoryText,
  unit: candidate({
    messageText: contradictoryText,
    purpose: "acknowledgement",
    capability: null,
    subject: { kind: null, catalogIdentity: null },
    stayDependent: false,
    temporalCandidate: null,
    disposition: "ANSWER",
    reasonClass: "unknown"
  })
});
const contradictionResult = route(contradictory);
assert.equal(contradictionResult.ok, false);
assert.equal(contradictionResult.code, "ROUTE_PURPOSE_CONFLICT");
const invalidReadiness = createUnitRoutingDecision({
  unit: missingDates.unit,
  lifecycleDecision: missingDates.lifecycle,
  routingRegistry: registry,
  readiness: { unitId: "unit-routing", status: "READY", missingGuestFields: ["stay.checkIn"] },
  operatorSafetyPolicy: null
});
assert.equal(invalidReadiness.ok, false);
assert.equal(invalidReadiness.code, "ROUTING_READINESS_INVALID");

// C07 itself is a closed contract and only ANSWER may request canonical work.
assert.equal(validateUnitRoutingDecision({
  unitId: "unit-routing",
  disposition: "ANSWER",
  reasonClass: "executable_lodging_need",
  requiresCanonicalExecution: false,
  missingGuestFields: [],
  operatorActionClass: null,
  riskClass: null
}).ok, false);
assert.doesNotThrow(() => validateUnitRoutingDecision({
  unitId: "unit-routing",
  disposition: "ANSWER",
  reasonClass: "executable_lodging_need",
  requiresCanonicalExecution: true,
  missingGuestFields: null,
  operatorActionClass: null,
  riskClass: null
}), "invalid C07 input must fail closed rather than throw");

// AC-MUT-001..003 / AC-MNT-005: the sole reply authority receives no raw guest
// text and no other new-core production module writes a C07 decision.
const routerPath = path.join(__dirname, "../lib/new-core/unit-reply-router.js");
const routerSource = fs.readFileSync(routerPath, "utf8");
assert.equal(/rawText|messageText|sourceEvents|\bquote\b/.test(routerSource), false, "router must not access raw guest text");
function newCoreSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return newCoreSourceFiles(filePath);
    return entry.isFile() && entry.name.endsWith(".js") ? [filePath] : [];
  });
}

const newCoreDirectory = path.join(__dirname, "../lib/new-core");
const productionSources = newCoreSourceFiles(newCoreDirectory).map((filePath) => ({
  filePath: path.relative(newCoreDirectory, filePath),
  source: fs.readFileSync(filePath, "utf8")
}));
function c07AuthorityModules(files) {
  return files.filter(({ source }) => (
    source.includes("C07_AUTHORITY_MARKER")
    || source.includes("createUnitRoutingDecision")
    || source.includes("isTrustedUnitRoutingDecision")
  ));
}
assert.deepEqual(
  c07AuthorityModules(productionSources).map((item) => item.filePath),
  ["unit-reply-router.js"],
  "C07 brand, factory, and verifier must have one new-core authority"
);
assert.deepEqual(
  c07AuthorityModules([{ filePath: "contracts/unit-routing-decision.js", source: "const schemaMetadata = { disposition: 'ANSWER', requiresCanonicalExecution: true, missingGuestFields: [] };" }]).map((item) => item.filePath),
  [], "harmless C07 schema metadata is not a writer or authority marker"
);

console.log(JSON.stringify({ suite: "new-core-unit-routing", level: "STRUCTURED_CONTRACT_TEST", caseCount: 20, passCount: 20, failCount: 0 }));
