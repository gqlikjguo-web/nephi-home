"use strict";

// STRUCTURED_CONTRACT_TEST. OpenAI identifies only the typed capacity intent;
// every capacity fact below comes from the official property catalog executor.
const assert = require("node:assert/strict");
const { CAPABILITY_REGISTRY } = require("../lib/conversation-engine-v2/capability-registry");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { buildCanonicalFormalRequest, buildCanonicalQueryPlan } = require("../lib/conversation-engine-v2/formal-request");
const { executeCanonicalQueryPlans } = require("../lib/conversation-engine-v2/capability-executor");
const {
  buildUnderstandingTurnInput,
  buildC01TrustedCanonicalizerCatalog,
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
const {
  createCanonicalizerInputItem,
  executeCanonicalizerInputItem
} = require("../lib/new-core/canonical-execution-adapter");
const { openAiUnderstandingV1ProviderSchema } = require("../lib/providers/openai-understanding-v1");

const NOW = "2026-09-11T08:00:00.000Z";
const scope = { propertyId: "static-capacity-contract", channel: "line-contract", userId: "guest-contract" };
const property = {
  propertyId: scope.propertyId,
  displayName: "Contract Lodge",
  timezone: "Asia/Taipei",
  rooms: [
    { id: "room-a", name: "Garden Room", type: "family", capacity: 4, enabled: true },
    { id: "bundle-a", name: "Courtyard Lodge", type: "whole house", inventoryType: "bundle", capacity: 11, enabled: true }
  ],
  commonAnswers: {},
  semanticCatalog: { aliases: {} }
};
const catalog = buildPropertyCatalog(property);
const routingRegistry = createUnitReplyRoutingRegistry(projectCapabilityRegistry(CAPABILITY_REGISTRY));

function schemaAccepts(schema, value) {
  if (schema.anyOf) return schema.anyOf.some((item) => schemaAccepts(item, value));
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const type = value === null ? "null" : Array.isArray(value) ? "array"
    : Number.isInteger(value) ? "integer" : typeof value;
  if (types.length && !types.includes(type)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (type === "string" && (value.length < (schema.minLength || 0)
    || value.length > (schema.maxLength || Infinity))) return false;
  if (type === "integer" && schema.minimum !== undefined && value < schema.minimum) return false;
  if (type === "array") return value.length >= (schema.minItems || 0)
    && value.length <= (schema.maxItems || Infinity)
    && value.every((item) => schemaAccepts(schema.items, item));
  if (type === "object") {
    const properties = schema.properties || {};
    return !(schema.required || []).some((key) => !Object.hasOwn(value, key))
      && !(schema.additionalProperties === false
        && Object.keys(value).some((key) => !Object.hasOwn(properties, key)))
      && Object.entries(properties).every(([key, child]) => (
        !Object.hasOwn(value, key) || schemaAccepts(child, value[key])
      ));
  }
  return true;
}

function fixture(messageText, kind, catalogIdentity) {
  const sourceEvent = {
    eventId: `event-${kind}`,
    messageRef: `message-${kind}`,
    role: "guest",
    timestamp: NOW,
    messageKind: "text",
    messageText
  };
  const evidence = {
    eventId: sourceEvent.eventId,
    messageRef: sourceEvent.messageRef,
    startOffset: 0,
    endOffset: messageText.length,
    quote: messageText
  };
  const input = buildUnderstandingTurnInput({
    coreVersion: "new-core-v1",
    traceId: `trace-${kind}`,
    turnId: `turn-${kind}`,
    verifiedPropertyBinding: { propertyId: scope.propertyId, channel: scope.channel },
    verifiedConversationScope: { channel: scope.channel, userId: scope.userId },
    sourceEvents: [sourceEvent],
    recentConversation: [],
    stateV3Snapshot: { scope, referenceableCycles: [] },
    publicCatalog: {
      propertyId: scope.propertyId,
      timezone: property.timezone,
      capabilityCatalog: Object.keys(CAPABILITY_REGISTRY),
      publicSubjectCatalog: catalog.rooms.map((item) => ({
        propertyId: scope.propertyId,
        catalogIdentity: item.canonicalId,
        kind: item.category,
        publicName: item.publicName
      }))
    }
  });
  return { input, evidence, kind, catalogIdentity };
}

function unitFor({ messageText, kind, catalogIdentity }, capability, stayDependent, temporalCandidate = null, slotCandidates = []) {
  const evidence = {
    eventId: `event-${kind}`,
    messageRef: `message-${kind}`,
    startOffset: 0,
    endOffset: messageText.length,
    quote: messageText
  };
  return {
    unitId: `unit-${kind}-${capability}`,
    evidenceRefs: [evidence],
    purpose: "lodging_question",
    capability,
    subject: { kind, catalogIdentity },
    stayDependent,
    temporalCandidate,
    contextLinkCandidateId: `link-${kind}-${capability}`,
    safetyCandidate: null,
    slotCandidates,
    quantityCandidate: null,
    confidenceBand: "high"
  };
}

function validatePipeline(fixtureValue, rawUnit) {
  const normalized = validateAndNormalizeSourceEvidence(rawUnit.evidenceRefs, fixtureValue.input.sourceEvents);
  assert.equal(normalized.ok, true, normalized.code);
  const semantic = validateSemanticUnit({
    unit: rawUnit,
    validatedEvidenceRefs: normalized.value,
    understandingTurnInput: fixtureValue.input,
    publicCatalogIdentitySet: buildPublicCatalogIdentitySet(fixtureValue.input),
    capabilityRegistryProjection: projectCapabilityRegistry(CAPABILITY_REGISTRY)
  });
  assert.equal(semantic.ok, true, semantic.code);
  const link = validateContextLink({
    unit: semantic.value,
    linkCandidate: {
      contextLinkCandidateId: rawUnit.contextLinkCandidateId,
      unitId: rawUnit.unitId,
      relationKind: "NEW_REQUEST",
      currentSourceEvidenceRefs: rawUnit.evidenceRefs,
      referencedHistoryEventRefs: []
    },
    understandingTurnInput: fixtureValue.input,
    validatedEvidenceRefs: normalized.value,
    now: NOW
  });
  assert.equal(link.ok, true, link.code);
  const lifecycle = createLifecycleDecision({
    lifecycleDecisionId: `lifecycle-${rawUnit.unitId}`,
    unit: semantic.value,
    validatedContextLink: link.value
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
  return { unit: semantic.value, lifecycle: lifecycle.value, readiness: readiness.value, route: route.value };
}

function staticCapacityCase(messageText, kind, catalogIdentity, expectedCapacity) {
  const f = fixture(messageText, kind, catalogIdentity);
  const rawUnit = unitFor({ messageText, kind, catalogIdentity }, "lodging_product_capacity", false);
  const providerUnitSchema = openAiUnderstandingV1ProviderSchema(f.input)
    .properties.understandingOutput.properties.units.items;
  assert.equal(schemaAccepts(providerUnitSchema, rawUnit), true,
    "provider admission must represent static product capacity without stay inputs");
  const pipeline = validatePipeline(f, rawUnit);
  assert.deepEqual(pipeline.readiness, {
    unitId: rawUnit.unitId,
    status: "READY",
    missingGuestFields: []
  });
  assert.equal(pipeline.route.disposition, "ANSWER");
  const trustedCatalog = buildC01TrustedCanonicalizerCatalog(f.input, catalog);
  const c08 = createCanonicalizerInputItem({
    unit: pipeline.unit,
    lifecycleDecision: pipeline.lifecycle,
    routingDecision: pipeline.route,
    understandingTurnInput: f.input,
    canonicalizerCatalog: trustedCatalog,
    publicCatalogIdentityProjection: buildPublicCatalogIdentityProjection(f.input)
  });
  assert.equal(c08.ok, true, c08.code);
  const canonical = executeCanonicalizerInputItem({
    canonicalizerInputItem: c08.value,
    catalog: trustedCatalog,
    publicCatalogIdentityProjection: buildPublicCatalogIdentityProjection(f.input),
    contextSnapshot: {
      scope: { propertyId: scope.propertyId, channelId: scope.channel, userId: scope.userId },
      generatedAt: NOW,
      cycles: []
    }
  });
  assert.equal(canonical.ok, true, canonical.code);
  assert.equal(canonical.value.canonicalRequest.capability, "lodging_product_capacity");
  assert.equal(canonical.value.canonicalRequest.stayDependency, false);
  assert.deepEqual(canonical.value.canonicalRequest.requiredFields, []);
  assert.equal(canonical.value.canonicalRequest.resolverId, "property_catalog");
  assert.equal(canonical.value.canonicalRequest.detailIntent, "quantity");
  const formal = buildCanonicalFormalRequest({
    property,
    canonicalRequest: canonical.value.canonicalRequest,
    requestCycleId: rawUnit.unitId,
    confirmedInputs: canonical.value.stateInput.confirmedFields
  });
  assert.equal(formal.readiness.status, "ready");
  const queryPlan = buildCanonicalQueryPlan(formal);
  const [outcome] = executeCanonicalQueryPlans({
    property,
    catalog,
    queryPlans: [queryPlan],
    availabilityResolver: () => { throw new Error("static capacity must not call availability resolver"); },
    now: NOW
  });
  assert.equal(outcome.outcome, "answered");
  assert.equal(outcome.resolverAttempted, false);
  assert.equal(outcome.facts.source, "property_catalog");
  assert.equal(outcome.facts.maxGuests, expectedCapacity);
}

staticCapacityCase("這間房最多住幾人？", "room", "room-a", 4);
staticCapacityCase("整棟容納上限是多少？", "bundle", "bundle-a", 11);

// Control: a stay-dependent capacity/feasibility request remains incomplete
// without its existing date and guest inputs.
{
  const messageText = "想確認這個住宿安排是否住得下";
  const f = fixture(messageText, "room", "room-a");
  const rawUnit = unitFor({ messageText, kind: "room", catalogIdentity: "room-a" }, "capacity", true);
  const pipeline = validatePipeline(f, rawUnit);
  assert.deepEqual(pipeline.readiness, {
    unitId: rawUnit.unitId,
    status: "MISSING_GUEST_FIELDS",
    missingGuestFields: ["stay.checkIn", "stay.checkOut", "stay.guests"]
  });
  assert.equal(pipeline.route.disposition, "CLARIFY");
}

process.stdout.write("new core static capacity contract: PASS\n");
