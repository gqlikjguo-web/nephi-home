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
        requestKind: "availability",
        capability: "availability",
        status: "pending",
        expiresAt: "2026-08-29T08:00:00.000Z",
        subject: { kind: "room", catalogIdentity: "room-a" },
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
  safetyCandidate = null
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
    safetyCandidate,
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

// A validated relative-day expression is complete enough to enter the sole
// canonical temporal authority even when OpenAI correctly leaves executable
// dates null. Removing that admission would prematurely clarify before C08.
const relativeDateText = "今天有房嗎";
const relativeDate = validated({
  messageText: relativeDateText,
  unit: candidate({
    messageText: relativeDateText,
    temporalCandidate: {
      rawText: "今天",
      kind: "relative_date",
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null
    }
  })
});
assert.deepEqual(route(relativeDate).value, {
  unitId: "unit-routing",
  disposition: "ANSWER",
  reasonClass: "executable_lodging_need",
  requiresCanonicalExecution: true,
  missingGuestFields: [],
  operatorActionClass: null,
  riskClass: null
});

for (const incomplete of [
  { messageText: "住兩晚有房嗎", rawText: "住兩晚", kind: "nights_only", nightsCandidate: 2 },
  { messageText: "九月有房嗎", rawText: "九月", kind: "partial", nightsCandidate: null },
  { messageText: "某天有房嗎", rawText: "某天", kind: "unknown", nightsCandidate: null }
]) {
  const pipeline = validated({
    messageText: incomplete.messageText,
    unit: candidate({
      messageText: incomplete.messageText,
      temporalCandidate: {
        rawText: incomplete.rawText,
        kind: incomplete.kind,
        checkInCandidate: null,
        checkOutCandidate: null,
        nightsCandidate: incomplete.nightsCandidate
      },
      safetyCandidate: null
    })
  });
  assert.deepEqual(route(pipeline).value.missingGuestFields, ["stay.checkIn", "stay.checkOut"]);
}

// AC-RTE-002 / AC-AVL-004 / AC-PRI-003 / AC-HOF-009: only formally missing
// guest inputs clarify a lodging need; neither unknown nor lifecycle chooses it.
const missingDatesText = "還有房嗎";
const missingDates = validated({
  messageText: missingDatesText,
  unit: candidate({
    messageText: missingDatesText,
    temporalCandidate: null,
    safetyCandidate: null
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
    safetyCandidate: { operatorActionClass: "booking_mutation", riskClass: null }
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
    safetyCandidate: { operatorActionClass: null, riskClass: "access_credential" }
  })
});
const riskPolicy = createTrustedOperatorSafetyPolicy({ unit: risk.unit, lifecycleDecision: risk.lifecycle, routingRegistry: registry });
assert.equal(riskPolicy.ok, true);
assert.equal(route({ ...risk, operatorSafetyPolicy: riskPolicy.value }).value.riskClass, "access_credential");

// AC-HOF-004: cancellation END is lifecycle-only NO_REPLY. A separate
// operator-request unit carries reservation action handoff; no HANDOFF may
// own END.
const cancellationText = "請取消我的訂房";
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
    temporalCandidate: null
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
    safetyCandidate: { operatorActionClass: "reservation_cancellation", riskClass: null }
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
    safetyCandidate: { operatorActionClass: "booking_mutation", riskClass: null }
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
    safetyCandidate: { operatorActionClass: "booking_mutation", riskClass: null }
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
assert.equal(Object.isFrozen(officialAnswer.missingGuestFields), true, "official C07 nested values are immutable");
assert.equal(isTrustedUnitRoutingDecision(officialAnswer), true, "only the official C07 factory brands its output");
const structuralDecision = {
  unitId: officialAnswer.unitId,
  disposition: officialAnswer.disposition,
  reasonClass: officialAnswer.reasonClass,
  requiresCanonicalExecution: officialAnswer.requiresCanonicalExecution,
  missingGuestFields: [],
  operatorActionClass: officialAnswer.operatorActionClass,
  riskClass: officialAnswer.riskClass
};
assert.equal(validateUnitRoutingDecision(structuralDecision).ok, true, "the structural adversary must satisfy the public C07 shape");
assert.equal(isTrustedUnitRoutingDecision(structuralDecision), false, "a structurally valid C07 literal is untrusted");
const spreadDecision = { ...officialAnswer };
assert.equal(validateUnitRoutingDecision(spreadDecision).ok, true, "the spread adversary must satisfy the public C07 shape");
assert.equal(isTrustedUnitRoutingDecision(spreadDecision), false, "a spread-equivalent C07 object is untrusted");
const bracketBuiltDecision = {};
for (const [key, value] of Object.entries(officialAnswer)) bracketBuiltDecision[key] = value;
assert.equal(validateUnitRoutingDecision(bracketBuiltDecision).ok, true, "the bracket adversary must satisfy the public C07 shape");
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
    safetyCandidate: { operatorActionClass: "booking_mutation", riskClass: null }
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

// AC-RTE-005..008 / AC-HOF-008: C07 is the sole disposition authority. A
// non-actionable validated acknowledgement stays silent without a model reply
// proposal, and malformed deterministic inputs still fail closed.
const contradictoryText = "謝謝";
const contradictory = validated({
  messageText: contradictoryText,
  unit: candidate({
    messageText: contradictoryText,
    purpose: "acknowledgement",
    capability: null,
    subject: { kind: null, catalogIdentity: null },
    stayDependent: false,
    temporalCandidate: null
  })
});
const contradictionResult = route(contradictory);
assert.equal(contradictionResult.ok, true);
assert.equal(contradictionResult.value.disposition, "NO_REPLY");
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
function loadEmbeddedAcorn() {
  const source = process.binding("natives")["internal/deps/acorn/acorn/dist/acorn"];
  assert.equal(typeof source, "string", "the configured Node runtime must expose its embedded JavaScript parser");
  const embeddedModule = { exports: {} };
  Function("exports", "require", "module", "__filename", "__dirname", source)(
    embeddedModule.exports,
    require,
    embeddedModule,
    "embedded-acorn.js",
    ""
  );
  return embeddedModule.exports;
}

const EMBEDDED_ACORN = loadEmbeddedAcorn();
const C07_AUTHORITY_NAMES = new Set([
  "C07_AUTHORITY_MARKER",
  "createUnitRoutingDecision",
  "isTrustedUnitRoutingDecision"
]);

function walkAuthorityAst(value, visitor) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkAuthorityAst(item, visitor));
    return;
  }
  if (typeof value.type === "string") visitor(value);
  for (const [key, item] of Object.entries(value)) {
    if (["start", "end", "loc", "range"].includes(key)) continue;
    walkAuthorityAst(item, visitor);
  }
}

function staticPropertyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

function isNamedMember(node, owner, property) {
  return Boolean(node) && node.type === "MemberExpression"
    && node.object && node.object.type === "Identifier" && node.object.name === owner
    && staticPropertyName(node.property) === property;
}

function isModuleExports(node) {
  return isNamedMember(node, "module", "exports");
}

function isExportsObject(node) {
  return Boolean(node) && ((node.type === "Identifier" && node.name === "exports") || isModuleExports(node));
}

function exportedSlotName(node) {
  return Boolean(node) && node.type === "MemberExpression" && isExportsObject(node.object)
    ? staticPropertyName(node.property)
    : null;
}

function isFunctionValue(node) {
  return Boolean(node) && ["FunctionExpression", "ArrowFunctionExpression"].includes(node.type);
}

function isWeakSetConstruction(node) {
  return Boolean(node) && node.type === "NewExpression"
    && node.callee.type === "Identifier" && node.callee.name === "WeakSet";
}

function isObjectMethod(node, owner, method) {
  return Boolean(node) && node.type === "MemberExpression"
    && node.object && node.object.type === "Identifier" && node.object.name === owner
    && staticPropertyName(node.property) === method;
}

function isOfficialRouterRequire(node, filePath) {
  if (!node || node.type !== "CallExpression" || node.callee.type !== "Identifier" || node.callee.name !== "require"
    || node.arguments.length !== 1) return false;
  const request = staticPropertyName(node.arguments[0]);
  if (!request || !request.startsWith(".")) return false;
  const normalizedFilePath = filePath.split(path.sep).join("/");
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(normalizedFilePath), request));
  return resolved === "unit-reply-router" || resolved === "unit-reply-router.js";
}

function topLevelBindings(ast, filePath) {
  const bindings = new Map();
  for (const statement of ast.body) {
    if (statement.type === "FunctionDeclaration" && statement.id) bindings.set(statement.id.name, statement);
    if (statement.type === "VariableDeclaration") {
      for (const declaration of statement.declarations) {
        if (declaration.id.type === "Identifier") bindings.set(declaration.id.name, declaration.init);
        if (declaration.id.type === "ObjectPattern" && isOfficialRouterRequire(declaration.init, filePath)) {
          for (const property of declaration.id.properties) {
            if (property.type !== "Property" || property.value.type !== "Identifier") continue;
            const authorityName = staticPropertyName(property.key);
            if (C07_AUTHORITY_NAMES.has(authorityName)) {
              bindings.set(property.value.name, { type: "KnownC07Authority", authorityName });
            }
          }
        }
      }
    }
    if (statement.type === "ExpressionStatement" && statement.expression.type === "AssignmentExpression"
      && statement.expression.operator === "=" && statement.expression.left.type === "Identifier") {
      bindings.set(statement.expression.left.name, statement.expression.right);
    }
  }
  return bindings;
}

function objectPropertyValue(node, propertyName) {
  if (!node || node.type !== "ObjectExpression") return null;
  const property = node.properties.find((item) => item.type === "Property" && staticPropertyName(item.key) === propertyName);
  return property ? property.value : null;
}

function collectExportedAuthorityNames(node, names, options) {
  const {
    bindings,
    filePath,
    includePropertyKeys = true,
    roleHint = null,
    seenBindings = new Set()
  } = options;
  if (!node) return;
  if (node.type === "KnownC07Authority") {
    names.add(node.authorityName);
    return;
  }
  if (node.type === "Identifier") {
    if (bindings.has(node.name) && !seenBindings.has(node.name)) {
      const nextSeen = new Set(seenBindings);
      nextSeen.add(node.name);
      const binding = bindings.get(node.name);
      if (isWeakSetConstruction(binding)) {
        if (roleHint === "C07_AUTHORITY_MARKER" || node.name === "C07_AUTHORITY_MARKER") {
          names.add("C07_AUTHORITY_MARKER");
        }
        return;
      }
      if (isFunctionValue(binding) || (binding && binding.type === "FunctionDeclaration")) {
        if (C07_AUTHORITY_NAMES.has(roleHint)) names.add(roleHint);
        else if (C07_AUTHORITY_NAMES.has(node.name)) names.add(node.name);
        return;
      }
      collectExportedAuthorityNames(binding, names, { ...options, seenBindings: nextSeen });
      return;
    }
    if (C07_AUTHORITY_NAMES.has(node.name)) names.add(node.name);
    return;
  }
  if (node.type === "MemberExpression") {
    const propertyName = staticPropertyName(node.property);
    let object = node.object;
    if (object.type === "Identifier" && bindings.has(object.name)) object = bindings.get(object.name);
    if (isOfficialRouterRequire(object, filePath) && C07_AUTHORITY_NAMES.has(propertyName)) {
      names.add(propertyName);
      return;
    }
    const knownValue = objectPropertyValue(object, propertyName);
    if (knownValue) collectExportedAuthorityNames(knownValue, names, { ...options, includePropertyKeys: false });
    return;
  }
  if (isOfficialRouterRequire(node, filePath)) {
    names.add("createUnitRoutingDecision");
    names.add("isTrustedUnitRoutingDecision");
    return;
  }
  if (isWeakSetConstruction(node)) {
    if (roleHint === "C07_AUTHORITY_MARKER") names.add("C07_AUTHORITY_MARKER");
    return;
  }
  if (node.type === "ObjectExpression") {
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        collectExportedAuthorityNames(property.argument, names, { ...options, includePropertyKeys });
      }
      if (property.type !== "Property") continue;
      const keyName = staticPropertyName(property.key);
      const propertyRole = includePropertyKeys && C07_AUTHORITY_NAMES.has(keyName) ? keyName : null;
      collectExportedAuthorityNames(property.value, names, {
        ...options,
        includePropertyKeys: false,
        roleHint: propertyRole
      });
    }
    return;
  }
  if (node.type === "CallExpression" && isObjectMethod(node.callee, "Object", "freeze")) {
    collectExportedAuthorityNames(node.arguments[0], names, { ...options, includePropertyKeys });
    return;
  }
  if (node.type === "CallExpression" && isObjectMethod(node.callee, "Object", "assign")) {
    node.arguments.forEach((argument) => collectExportedAuthorityNames(argument, names, { ...options, includePropertyKeys }));
    return;
  }
  if (isFunctionValue(node) || node.type === "FunctionDeclaration") {
    if (C07_AUTHORITY_NAMES.has(roleHint)) names.add(roleHint);
    else if (node.id && C07_AUTHORITY_NAMES.has(node.id.name)) names.add(node.id.name);
  }
}

function c07AuthoritySignals(source, filePath) {
  const ast = EMBEDDED_ACORN.parse(source, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true });
  const bindings = topLevelBindings(ast, filePath);
  const signals = {
    markerDefinitions: 0,
    factoryDefinitions: 0,
    verifierDefinitions: 0,
    markerExports: 0,
    factoryExports: 0,
    verifierExports: 0
  };
  const incrementExport = (name) => {
    if (name === "C07_AUTHORITY_MARKER") signals.markerExports += 1;
    if (name === "createUnitRoutingDecision") signals.factoryExports += 1;
    if (name === "isTrustedUnitRoutingDecision") signals.verifierExports += 1;
  };
  const recordExports = (names) => names.forEach(incrementExport);
  const collectExports = (node, names, overrides = {}) => collectExportedAuthorityNames(node, names, {
    bindings,
    filePath,
    includePropertyKeys: true,
    roleHint: null,
    ...overrides
  });
  walkAuthorityAst(ast, (node) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
      if (node.id.name === "C07_AUTHORITY_MARKER" && isWeakSetConstruction(node.init)) signals.markerDefinitions += 1;
      if (node.id.name === "createUnitRoutingDecision" && isFunctionValue(node.init)) signals.factoryDefinitions += 1;
      if (node.id.name === "isTrustedUnitRoutingDecision" && isFunctionValue(node.init)) signals.verifierDefinitions += 1;
    }
    if (node.type === "FunctionDeclaration" && node.id) {
      if (node.id.name === "createUnitRoutingDecision") signals.factoryDefinitions += 1;
      if (node.id.name === "isTrustedUnitRoutingDecision") signals.verifierDefinitions += 1;
    }
    if (node.type === "AssignmentExpression" && node.operator === "=") {
      if (node.left.type === "Identifier" && isFunctionValue(node.right)) {
        if (node.left.name === "createUnitRoutingDecision") signals.factoryDefinitions += 1;
        if (node.left.name === "isTrustedUnitRoutingDecision") signals.verifierDefinitions += 1;
      }
      const names = new Set();
      if (isModuleExports(node.left)) collectExports(node.right, names);
      const slotName = exportedSlotName(node.left);
      if (slotName) {
        collectExports(node.right, names, {
          includePropertyKeys: false,
          roleHint: C07_AUTHORITY_NAMES.has(slotName) ? slotName : null
        });
      }
      recordExports(names);
    }
    if (node.type === "CallExpression" && isObjectMethod(node.callee, "Object", "assign")
      && isExportsObject(node.arguments[0])) {
      const names = new Set();
      node.arguments.slice(1).forEach((argument) => collectExports(argument, names));
      recordExports(names);
    }
    if (node.type === "CallExpression"
      && (isObjectMethod(node.callee, "Object", "defineProperty") || isObjectMethod(node.callee, "Reflect", "defineProperty"))
      && isExportsObject(node.arguments[0])) {
      const names = new Set();
      const slotName = staticPropertyName(node.arguments[1]);
      const descriptorValue = objectPropertyValue(node.arguments[2], "value");
      collectExports(descriptorValue, names, {
        includePropertyKeys: false,
        roleHint: C07_AUTHORITY_NAMES.has(slotName) ? slotName : null
      });
      recordExports(names);
    }
  });
  return signals;
}

function c07AuthorityModules(files) {
  return files.map((item) => ({ ...item, signals: c07AuthoritySignals(item.source, item.filePath) }))
    .filter(({ signals }) => Object.values(signals).some((count) => count > 0));
}
const c07Authorities = c07AuthorityModules(productionSources);
assert.deepEqual(c07Authorities.map((item) => item.filePath), ["unit-reply-router.js"], "C07 brand, factory, and verifier must have one new-core authority");
assert.deepEqual(c07Authorities[0].signals, {
  markerDefinitions: 1,
  factoryDefinitions: 1,
  verifierDefinitions: 1,
  markerExports: 0,
  factoryExports: 1,
  verifierExports: 1
}, "the private C07 marker stays private while its sole factory and boundary verifier are exported exactly once");
assert.deepEqual(
  c07AuthorityModules([{ filePath: "contracts/unit-routing-decision.js", source: "const schemaMetadata = { disposition: 'ANSWER', requiresCanonicalExecution: true, missingGuestFields: [] };" }]).map((item) => item.filePath),
  [], "harmless C07 schema metadata is not a writer or authority marker"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "unit-aggregator.js",
    source: `
      // C07_AUTHORITY_MARKER, createUnitRoutingDecision, and
      // isTrustedUnitRoutingDecision are owned by the router.
      const {
        createUnitRoutingDecision,
        isTrustedUnitRoutingDecision
      } = require("./unit-reply-router");
      const metadata = {
        createUnitRoutingDecision: "unit-reply-router.js",
        isTrustedUnitRoutingDecision: "unit-reply-router.js",
        C07_AUTHORITY_MARKER: "private"
      };
      function consume(value) {
        return isTrustedUnitRoutingDecision(value);
      }
    `
  }]).map((item) => item.filePath),
  [], "imports, calls, comments, and metadata must not become C07 authorities"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "bypass.js",
    source: `
      const C07_AUTHORITY_MARKER = new WeakSet();
      function createUnitRoutingDecision() {}
      function isTrustedUnitRoutingDecision() {}
      module.exports = { createUnitRoutingDecision, isTrustedUnitRoutingDecision };
    `
  }]).map((item) => ({ filePath: item.filePath, signals: item.signals })),
  [{
    filePath: "bypass.js",
    signals: {
      markerDefinitions: 1,
      factoryDefinitions: 1,
      verifierDefinitions: 1,
      markerExports: 0,
      factoryExports: 1,
      verifierExports: 1
    }
  }],
  "a second private marker, factory, verifier, or export must be visible to the ownership gate"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "reexport.js",
    source: `
      const { createUnitRoutingDecision, isTrustedUnitRoutingDecision } = require("./unit-reply-router");
      module.exports = {
        alternateFactory: createUnitRoutingDecision,
        alternateVerifier: isTrustedUnitRoutingDecision
      };
    `
  }]).map((item) => ({ filePath: item.filePath, signals: item.signals })),
  [{
    filePath: "reexport.js",
    signals: {
      markerDefinitions: 0,
      factoryDefinitions: 0,
      verifierDefinitions: 0,
      markerExports: 0,
      factoryExports: 1,
      verifierExports: 1
    }
  }],
  "aliased exports of the authoritative factory or verifier remain visible ownership boundaries"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "alternate-definitions.js",
    source: `
      let C07_AUTHORITY_MARKER = new WeakSet();
      const createUnitRoutingDecision = () => {};
      let isTrustedUnitRoutingDecision = function (value) { return Boolean(value); };
      module.exports = Object.freeze({
        alternateFactory: createUnitRoutingDecision,
        alternateVerifier: isTrustedUnitRoutingDecision
      });
    `
  }]).map((item) => ({ filePath: item.filePath, signals: item.signals })),
  [{
    filePath: "alternate-definitions.js",
    signals: {
      markerDefinitions: 1,
      factoryDefinitions: 1,
      verifierDefinitions: 1,
      markerExports: 0,
      factoryExports: 1,
      verifierExports: 1
    }
  }],
  "alternate declaration forms and a frozen export object remain visible ownership boundaries"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "computed-reexport.js",
    source: `
      const router = require("./unit-reply-router");
      exports["createUnitRoutingDecision"] = router.createUnitRoutingDecision;
      module.exports["isTrustedUnitRoutingDecision"] = router.isTrustedUnitRoutingDecision;
    `
  }]).map((item) => ({ filePath: item.filePath, signals: item.signals })),
  [{
    filePath: "computed-reexport.js",
    signals: {
      markerDefinitions: 0,
      factoryDefinitions: 0,
      verifierDefinitions: 0,
      markerExports: 0,
      factoryExports: 1,
      verifierExports: 1
    }
  }],
  "computed CommonJS exports remain visible ownership boundaries"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "regex-metadata.js",
    source: `
      const factoryPattern = /function createUnitRoutingDecision\\(\\)/;
      const verifierPattern = /function isTrustedUnitRoutingDecision\\(value\\)/;
      const markerPattern = /const C07_AUTHORITY_MARKER = new WeakSet/;
    `
  }]).map((item) => item.filePath),
  [],
  "regex metadata containing authority syntax must not become a definition"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "split-object-assign.js",
    source: `
      let createUnitRoutingDecision;
      let isTrustedUnitRoutingDecision;
      createUnitRoutingDecision = () => ({});
      isTrustedUnitRoutingDecision = (value) => Boolean(value);
      Object.assign(module.exports, {
        alternateFactory: createUnitRoutingDecision,
        alternateVerifier: isTrustedUnitRoutingDecision
      });
    `
  }]).map((item) => ({ filePath: item.filePath, signals: item.signals })),
  [{
    filePath: "split-object-assign.js",
    signals: {
      markerDefinitions: 0,
      factoryDefinitions: 1,
      verifierDefinitions: 1,
      markerExports: 0,
      factoryExports: 1,
      verifierExports: 1
    }
  }],
  "split function assignments and Object.assign re-exports remain visible ownership boundaries"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "void-regex-metadata.js",
    source: `
      const docs = void /function createUnitRoutingDecision\\(\\)/;
      const verifierDocs = void /function isTrustedUnitRoutingDecision\\(value\\)/;
    `
  }]).map((item) => item.filePath),
  [],
  "regex metadata after unary operators must not become a definition"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "nested-export-metadata.js",
    source: `
      module.exports = {
        docs: {
          createUnitRoutingDecision: "owned by unit-reply-router",
          isTrustedUnitRoutingDecision: "consumer boundary"
        }
      };
    `
  }]).map((item) => item.filePath),
  [],
  "nested exported documentation metadata must not become a factory or verifier export"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "whole-module-reexport.js",
    source: `module.exports = require("./unit-reply-router");`
  }, {
    filePath: "spread-module-reexport.js",
    source: `module.exports = { ...require("./unit-reply-router") };`
  }]).map((item) => ({ filePath: item.filePath, signals: item.signals })),
  ["whole-module-reexport.js", "spread-module-reexport.js"].map((filePath) => ({
    filePath,
    signals: {
      markerDefinitions: 0,
      factoryDefinitions: 0,
      verifierDefinitions: 0,
      markerExports: 0,
      factoryExports: 1,
      verifierExports: 1
    }
  })),
  "whole-module and spread re-exports of the official C07 boundary remain visible"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "binding-module-reexport.js",
    source: `
      const router = require("./unit-reply-router");
      module.exports = router;
    `
  }, {
    filePath: "binding-spread-reexport.js",
    source: `
      const router = require("./unit-reply-router");
      module.exports = { ...router };
    `
  }, {
    filePath: "adapters/nested-reexport.js",
    source: `module.exports = require("../unit-reply-router");`
  }]).map((item) => ({ filePath: item.filePath, signals: item.signals })),
  ["binding-module-reexport.js", "binding-spread-reexport.js", "adapters/nested-reexport.js"].map((filePath) => ({
    filePath,
    signals: {
      markerDefinitions: 0,
      factoryDefinitions: 0,
      verifierDefinitions: 0,
      markerExports: 0,
      factoryExports: 1,
      verifierExports: 1
    }
  })),
  "bound and nested-path re-exports of the official C07 module remain visible"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "member-metadata.js",
    source: `
      const metadata = {
        createUnitRoutingDecision: "owned by router",
        isTrustedUnitRoutingDecision: "consumer boundary"
      };
      module.exports = {
        factoryDocs: metadata.createUnitRoutingDecision,
        verifierDocs: metadata.isTrustedUnitRoutingDecision
      };
    `
  }]).map((item) => item.filePath),
  [],
  "statically known member metadata values must not become authority exports"
);
assert.deepEqual(
  c07AuthorityModules([{
    filePath: "marker-export.js",
    source: `
      const C07_AUTHORITY_MARKER = new WeakSet();
      module.exports = { C07_AUTHORITY_MARKER };
    `
  }]).map((item) => ({ filePath: item.filePath, signals: item.signals })),
  [{
    filePath: "marker-export.js",
    signals: {
      markerDefinitions: 1,
      factoryDefinitions: 0,
      verifierDefinitions: 0,
      markerExports: 1,
      factoryExports: 0,
      verifierExports: 0
    }
  }],
  "exporting the private C07 brand must be visible to the ownership gate"
);

console.log(JSON.stringify({ suite: "new-core-unit-routing", level: "STRUCTURED_CONTRACT_TEST", caseCount: 20, passCount: 20, failCount: 0 }));
