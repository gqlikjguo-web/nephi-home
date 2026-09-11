"use strict";

// FAKE_INTEGRATION / STRUCTURED_CONTRACT_TEST. No real OpenAI or facts calls.
// This RED observes existing admission; it does not interpret source language.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const { validateAndNormalizeSourceEvidence } = require("../lib/new-core/source-evidence-validator");
const { validateSemanticUnit, buildPublicCatalogIdentitySet, projectCapabilityRegistry } = require("../lib/new-core/semantic-unit-validator");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const { callOpenAIUnderstandingV1, openAiUnderstandingV1ProviderSchema, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC: META } = require("../lib/providers/openai-understanding-v1");

// Structural schema checks only; no source-text matching or intent rules.
function schemaAccepts(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(item => schemaAccepts(item, value));
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const type = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  if (types.length && !types.includes(type)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (type === "string" && (value.length < (schema.minLength || 0) || value.length > (schema.maxLength || Infinity))) return false;
  if (type === "integer" && schema.minimum !== undefined && value < schema.minimum) return false;
  if (type === "array") return value.length >= (schema.minItems || 0) && value.length <= (schema.maxItems || Infinity) && value.every(item => schemaAccepts(schema.items, item));
  if (type === "object") {
    const properties = schema.properties || {};
    return !(schema.required || []).some(key => !Object.hasOwn(value, key))
      && !(schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key)))
      && Object.entries(properties).every(([key, child]) => !Object.hasOwn(value, key) || schemaAccepts(child, value[key]));
  }
  return true;
}

async function main() {
  const propertyId = randomUUID(), now = "2026-09-07T06:00:00.000Z";
  const source = "source evidence";
  const evidence = { eventId: "event", messageRef: "message", startOffset: 0, endOffset: source.length, quote: source };
  const catalog = ["property", "room", "bundle", "matched_room_set", "amenity", "policy", "other_verified"].map(kind => ({
    propertyId, kind, catalogIdentity: randomUUID(), publicName: kind
  }));
  const input = buildUnderstandingTurnInput({
    coreVersion: "new-core-v1", traceId: "diagnostics-red", turnId: "turn",
    verifiedPropertyBinding: { propertyId, channel: "isolated" },
    verifiedConversationScope: { channel: "isolated", userId: "guest" },
    sourceEvents: [{ eventId: "event", messageRef: "message", role: "guest", timestamp: now, messageKind: "text", messageText: source }],
    recentConversation: [], stateV3Snapshot: { scope: { propertyId, channel: "isolated", userId: "guest" }, referenceableCycles: [] },
    publicCatalog: { propertyId, timezone: "Asia/Taipei", capabilityCatalog: ["booking_request"], publicSubjectCatalog: catalog }
  });
  const candidate = {
    unitId: "unit", evidenceRefs: [evidence], purpose: "operator_request", capability: "booking_operator_request",
    subject: { kind: "room", catalogIdentity: catalog.find(item => item.kind === "room").catalogIdentity },
    stayDependent: false, temporalCandidate: null, contextLinkCandidateId: "link",
    safetyCandidate: { operatorActionClass: "special_arrangement", riskClass: null },
    slotCandidates: [], quantityCandidate: null, confidenceBand: "high"
  };
  const normalized = validateAndNormalizeSourceEvidence([evidence], input.sourceEvents);
  assert.equal(normalized.ok, true, "fixture evidence must pass C04");
  const identitySet = buildPublicCatalogIdentitySet(input);
  const validate = unit => validateSemanticUnit({ unit, validatedEvidenceRefs: normalized.value, understandingTurnInput: input,
    publicCatalogIdentitySet: identitySet, capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY) });
  assert.equal(validate(candidate).ok, true, "control without the slot must be legal");
  const withIdentity = identity => ({ ...candidate, slotCandidates: [{ slotCandidateId: "slot", slot: "other_supported", operation: "SET", value: identity, evidenceRefs: [evidence] }] });
  // Obtain allowed kinds from the real validator, not a second admission list.
  const outcomes = identitySet.map(([identity, kind]) => ({ identity, kind, admission: validate(withIdentity(identity)) }));
  const allowedKinds = [...new Set(outcomes.filter(item => item.admission.ok).map(item => item.kind))];
  const rejected = outcomes.find(item => item.kind === "policy" && !item.admission.ok);
  assert.ok(allowedKinds.length > 0 && rejected, "fixture requires admitted and rejected catalog controls");
  const invalid = withIdentity(rejected.identity);
  assert.equal(rejected.admission.code, "UNIT_MEANING_UNSUPPORTED");
  const output = { understandingOutput: { schemaVersion: 1, turnId: "turn", units: [invalid] }, contextLinkCandidates: [{
    contextLinkCandidateId: "link", unitId: "unit", relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: [evidence], referencedHistoryEventRefs: []
  }] };
  assert.equal(schemaAccepts(openAiUnderstandingV1ProviderSchema(input), output), true, "fixture must pass provider schema");
  const bodies = [], markers = [], operational = [];
  const result = await callOpenAIUnderstandingV1(input, {
    apiKey: "isolated-test-placeholder", nowMs: () => Date.parse(now),
    onDiagnostic: entry => markers.push(entry), onOperationalDiagnostic: entry => operational.push(entry),
    fetchImpl: async (_url, request) => {
      bodies.push(JSON.parse(request.body));
      return { ok: true, status: 200, headers: { get: () => "fixture-request" }, text: async () => JSON.stringify({
        model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }]
      }) };
    }
  });
  assert.equal(bodies.length, 2, "only one correction is allowed");
  const first = result[META].attempts[0];
  assert.equal(first.validationResult.category, null);
  assert.deepEqual(first.validationResult.failures.map(item => [item.boundary, item.code, item.origin]), [["C03", "UNIT_MEANING_UNSUPPORTED", "model_output"]]);
  assert.deepEqual(markers.slice(0, 3).map(item => item.targetMarker), ["C02_UNDERSTANDING_RECEIVED", "C04_SOURCE_EVIDENCE_VALIDATED", "C03_SEMANTIC_UNIT_REJECTED"]);
  assert.deepEqual(bodies[0].input, bodies[1].input.slice(0, -1));
  const correctionText = bodies[1].input.at(-1).content[0].text;
  const correction = JSON.parse(correctionText.slice(correctionText.indexOf("\n") + 1));
  const failure = correction.failures[0];
  const present = {
    field: typeof failure.field === "string" && failure.field.length > 0,
    rule: typeof failure.rule === "string" && failure.rule.length > 0,
    actualKind: failure.actualKind === rejected.kind,
    allowedKinds: Array.isArray(failure.allowedKinds) && JSON.stringify(failure.allowedKinds) === JSON.stringify(allowedKinds)
  };
  console.log(JSON.stringify({ classification: "FAKE_INTEGRATION", prerequisites: "PASS", calls: bodies.length,
    expected: { field: "slotCandidates[0].value (within failed unit)", rule: "existing otherSupportedSlotAdmission rule reference", actualKind: rejected.kind, allowedKinds },
    c03Result: rejected.admission, c03Diagnostics: operational.filter(item => item.stage === "new_core_c03" && item.status === "FAILURE").map(item => item.validationErrors),
    correctionFailure: failure, present }));
  assert.deepEqual(present, { field: true, rule: true, actualKind: true, allowedKinds: true },
    "C03_CORRECTION_DIAGNOSTICS_MISSING: existing admission rejection lacks field/rule/actualKind/allowedKinds");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
