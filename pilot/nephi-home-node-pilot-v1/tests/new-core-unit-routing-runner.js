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
  createUnitRoutingDecision
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
assert.equal(route(newQuestion).value.disposition, "ANSWER");

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

function tokenizeJavaScript(source) {
  const tokens = [];
  const punctuators = ["===", "!==", "**=", "&&=", "||=", "??=", ">>>=", "<<=", ">>=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "++", "--", "=>"];
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (/\s/.test(character)) { index += 1; continue; }
    if (source.startsWith("//", index)) {
      index = source.indexOf("\n", index + 2);
      if (index < 0) break;
      continue;
    }
    if (source.startsWith("/*", index)) {
      index = source.indexOf("*/", index + 2);
      if (index < 0) break;
      index += 2;
      continue;
    }
    if (["'", "\"", "`"].includes(character)) {
      const quote = character;
      let value = "";
      let dynamic = false;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (quote === "`" && source.startsWith("${", index)) dynamic = true;
        if (source[index] === "\\") { value += source[index + 1] || ""; index += 2; } else { value += source[index]; index += 1; }
      }
      index += 1;
      tokens.push({ type: dynamic ? "dynamic" : "string", value });
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      tokens.push({ type: "identifier", value: source.slice(start, index) });
      continue;
    }
    const punctuator = punctuators.find((candidate) => source.startsWith(candidate, index));
    tokens.push({ type: "punctuator", value: punctuator || character });
    index += (punctuator || character).length;
  }
  return tokens;
}

function matchingToken(tokens, start, open, close) {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    if (tokens[index].value === close && --depth === 0) return index;
  }
  return -1;
}

function staticPropertyName(tokens, constants = new Map()) {
  if (tokens.length === 1) return tokens[0].type === "string" ? tokens[0].value : constants.get(tokens[0].value);
  if (tokens.length % 2 === 1 && tokens.every((token, index) => index % 2 ? token.value === "+" : token.type === "string")) {
    return tokens.filter((_, index) => index % 2 === 0).map((token) => token.value).join("");
  }
  return undefined;
}

function staticStringConstants(tokens) {
  const constants = new Map();
  for (let index = 0; index < tokens.length - 3; index += 1) {
    if (tokens[index].value !== "const" || tokens[index + 1].type !== "identifier" || tokens[index + 2].value !== "=") continue;
    const end = tokens.findIndex((token, candidate) => candidate > index + 2 && token.value === ";");
    const value = staticPropertyName(tokens.slice(index + 3, end < 0 ? tokens.length : end), constants);
    if (value !== undefined) constants.set(tokens[index + 1].value, value);
  }
  return constants;
}

function callArgument(tokens, openIndex, argumentIndex) {
  let depth = 0;
  let currentArgument = 0;
  let start = openIndex + 1;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === "(") depth += 1;
    if (tokens[index].value === ")") {
      if (depth === 0) return currentArgument === argumentIndex ? tokens.slice(start, index) : [];
      depth -= 1;
    }
    if (tokens[index].value === "," && depth === 0) {
      if (currentArgument === argumentIndex) return tokens.slice(start, index);
      currentArgument += 1;
      start = index + 1;
    }
  }
  return [];
}

function objectPropertyNames(tokens, openIndex, constants) {
  const closeIndex = matchingToken(tokens, openIndex, "{", "}");
  if (closeIndex < 0) return null;
  const names = new Set();
  for (let index = openIndex + 1, depth = 0; index < closeIndex; index += 1) {
    const token = tokens[index];
    if (token.value === "[" && depth === 0) {
      const end = matchingToken(tokens, index, "[", "]");
      if (end > index && tokens[end + 1] && tokens[end + 1].value === ":") names.add(staticPropertyName(tokens.slice(index + 1, end), constants));
    }
    if (["{", "[", "("].includes(token.value)) { depth += 1; continue; }
    if (["}", "]", ")"].includes(token.value)) { depth -= 1; continue; }
    if (depth !== 0) continue;
    if ((token.type === "identifier" || token.type === "string") && tokens[index + 1] && tokens[index + 1].value === ":") names.add(token.value);
  }
  return names;
}

function staticObjectMethodOpen(tokens, index, method, constants) {
  if (!["Object", "Reflect"].includes(tokens[index] && tokens[index].value)) return -1;
  if (tokens[index + 1] && tokens[index + 1].value === "."
    && tokens[index + 2] && tokens[index + 2].value === method
    && tokens[index + 3] && tokens[index + 3].value === "(") return index + 3;
  if (tokens[index + 1] && tokens[index + 1].value === "[") {
    const close = matchingToken(tokens, index + 1, "[", "]");
    if (close > index + 1 && staticPropertyName(tokens.slice(index + 2, close), constants) === method
      && tokens[close + 1] && tokens[close + 1].value === "(") return close + 1;
  }
  return -1;
}

function c07WriteSignals(source) {
  const tokens = tokenizeJavaScript(source);
  const constants = staticStringConstants(tokens);
  const fields = new Set(["disposition", "requiresCanonicalExecution", "missingGuestFields", "operatorActionClass", "riskClass"]);
  const writesByTarget = new Map();
  const dynamicByTarget = new Set();
  const add = (target, name) => {
    if (name === undefined) { dynamicByTarget.add(target); return; }
    if (!fields.has(name)) return;
    if (!writesByTarget.has(target)) writesByTarget.set(target, new Set());
    writesByTarget.get(target).add(name);
  };
  const targetFor = (parts) => parts.map((token) => token.value).join("") || "dynamic";
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === "{") {
      const names = objectPropertyNames(tokens, index, constants);
      if (names && [...fields].every((field) => names.has(field))) return { writer: true };
    }
    if (tokens[index].value === "." && tokens[index + 1] && tokens[index + 2]
      && tokens[index + 2].value === "=") add(targetFor(tokens.slice(Math.max(0, index - 1), index)), tokens[index + 1].value);
    if (tokens[index].value === "[") {
      const close = matchingToken(tokens, index, "[", "]");
      if (close > index && tokens[close + 1] && tokens[close + 1].value === "=") {
        add(targetFor(tokens.slice(Math.max(0, index - 1), index)), staticPropertyName(tokens.slice(index + 1, close), constants));
      }
    }
    const objectAssign = staticObjectMethodOpen(tokens, index, "assign", constants);
    if (objectAssign >= 0) {
      const target = targetFor(callArgument(tokens, objectAssign, 0));
      const patch = callArgument(tokens, objectAssign, 1);
      if (patch[0] && patch[0].value === "{") (objectPropertyNames(patch, 0, constants) || new Set()).forEach((name) => add(target, name));
      else dynamicByTarget.add(target);
    }
    const defineProperty = staticObjectMethodOpen(tokens, index, "defineProperty", constants);
    if (defineProperty >= 0) {
      add(targetFor(callArgument(tokens, defineProperty, 0)), staticPropertyName(callArgument(tokens, defineProperty, 1), constants));
    }
  }
  return {
    writer: [...writesByTarget.entries()].some(([target, names]) => (
      [...fields].every((field) => names.has(field))
      || (dynamicByTarget.has(target) && names.size >= fields.size - 1)
    ))
  };
}

function structuralC07Writers(files) {
  return files.filter(({ filePath, source }) => {
    if (filePath.endsWith("contracts/unit-routing-decision.js")) return false;
    return c07WriteSignals(source).writer;
  });
}

const newCoreDirectory = path.join(__dirname, "../lib/new-core");
const productionSources = newCoreSourceFiles(newCoreDirectory).map((filePath) => ({
  filePath: path.relative(newCoreDirectory, filePath),
  source: fs.readFileSync(filePath, "utf8")
}));
assert.deepEqual(
  structuralC07Writers(productionSources).map((item) => item.filePath),
  ["unit-reply-router.js"],
  "C07 must have one structural pre-execution reply writer across new-core"
);
assert.deepEqual(
  structuralC07Writers([{ filePath: "bypass.js", source: "const key = 'disposition'; const decision = {}; decision[key] = 'ANSWER'; decision['requiresCanonicalExecution'] = true; decision['missingGuestFields'] = []; decision['operatorActionClass'] = null; decision['riskClass'] = null;" }]).map((item) => item.filePath),
  ["bypass.js"], "the ownership gate must detect computed C07 assignment"
);
assert.deepEqual(
  structuralC07Writers([{ filePath: "bypass.js", source: "const decision = {}; decision[`dis${''}position`] = 'ANSWER'; decision['requiresCanonicalExecution'] = true; decision['missingGuestFields'] = []; decision['operatorActionClass'] = null; decision['riskClass'] = null;" }]).map((item) => item.filePath),
  ["bypass.js"], "the ownership gate must fail closed on dynamic computed C07 assignment"
);
assert.deepEqual(
  structuralC07Writers([{ filePath: "bypass.js", source: "Object.assign(decision, { disposition: 'ANSWER', requiresCanonicalExecution: true, missingGuestFields: [], operatorActionClass: null, riskClass: null });" }]).map((item) => item.filePath),
  ["bypass.js"], "the ownership gate must detect Object.assign C07 construction"
);
assert.deepEqual(
  structuralC07Writers([{ filePath: "bypass.js", source: "Object['assign'](decision, { disposition: 'ANSWER', requiresCanonicalExecution: true, missingGuestFields: [], operatorActionClass: null, riskClass: null });" }]).map((item) => item.filePath),
  ["bypass.js"], "the ownership gate must detect computed Object.assign C07 construction"
);
assert.deepEqual(
  structuralC07Writers([{ filePath: "bypass.js", source: "const patch = { riskClass: null }; decision.disposition = 'ANSWER'; decision.requiresCanonicalExecution = true; decision.missingGuestFields = []; decision.operatorActionClass = null; Object['assign'](decision, patch);" }]).map((item) => item.filePath),
  ["bypass.js"], "the ownership gate must fail closed on computed Object.assign with an opaque patch"
);
assert.deepEqual(
  structuralC07Writers([{ filePath: "bypass.js", source: "Object.defineProperty(decision, 'disposition', { value: 'ANSWER' }); Object.defineProperty(decision, 'requiresCanonicalExecution', { value: true }); Object.defineProperty(decision, 'missingGuestFields', { value: [] }); Object.defineProperty(decision, 'operatorActionClass', { value: null }); Object.defineProperty(decision, 'riskClass', { value: null });" }]).map((item) => item.filePath),
  ["bypass.js"], "the ownership gate must detect defineProperty C07 construction"
);
assert.deepEqual(
  structuralC07Writers([{ filePath: "bypass.js", source: "Object['define' + 'Property'](decision, 'disposition', { value: 'ANSWER' }); Object['define' + 'Property'](decision, 'requiresCanonicalExecution', { value: true }); Object['define' + 'Property'](decision, 'missingGuestFields', { value: [] }); Object['define' + 'Property'](decision, 'operatorActionClass', { value: null }); Object['define' + 'Property'](decision, 'riskClass', { value: null });" }]).map((item) => item.filePath),
  ["bypass.js"], "the ownership gate must detect computed defineProperty C07 construction"
);

console.log(JSON.stringify({ suite: "new-core-unit-routing", level: "STRUCTURED_CONTRACT_TEST", caseCount: 20, passCount: 20, failCount: 0 }));
