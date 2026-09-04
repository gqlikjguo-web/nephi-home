"use strict";

const assert = require("node:assert/strict");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const { CAPABILITIES } = require("../lib/new-core/contracts/semantic-unit-candidate");
const {
  OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC,
  callOpenAIUnderstandingV1,
  instructions,
  isTrustedUnderstandingResult,
  openAiUnderstandingV1ProviderSchema
} = require("../lib/providers/openai-understanding-v1");

const NOW = "2026-08-29T08:00:00.000Z";

function c01(overrides = {}) {
  return buildUnderstandingTurnInput({
    coreVersion: "new-core-v1",
    traceId: "trace-openai-understanding-v1",
    turnId: "turn-openai-understanding-v1",
    verifiedPropertyBinding: { propertyId: "property-a", channel: "line-a" },
    verifiedConversationScope: { channel: "line-a", userId: "guest-a" },
    sourceEvents: [{
      eventId: "event-a",
      messageRef: "message-a",
      role: "guest",
      timestamp: NOW,
      messageKind: "text",
      messageText: "謝謝"
    }],
    recentConversation: [{
      eventId: "history-a",
      messageRef: "history-message-a",
      role: "assistant",
      timestamp: "2026-08-29T07:59:00.000Z",
      messageKind: "text",
      messageText: "請提供日期",
      referenceableCycleIds: ["cycle-a"]
    }],
    stateV3Snapshot: {
      scope: { propertyId: "property-a", channel: "line-a", userId: "guest-a" },
      referenceableCycles: [{
        requestCycleId: "cycle-a",
        requestKind: "availability",
        capability: "availability",
        status: "active",
        expiresAt: "2026-08-30T08:00:00.000Z",
        subject: { kind: "room", catalogIdentity: "room-a" },
        missingFields: ["checkIn"],
        confirmedValues: { checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null },
        slotRefs: ["stay.checkIn"]
      }]
    },
    publicCatalog: {
      propertyId: "property-a",
      timezone: "Asia/Taipei",
      capabilityCatalog: ["availability", "property_fact"],
      publicSubjectCatalog: [
        { catalogIdentity: "property-a", kind: "property", propertyId: "property-a", publicName: "Property A" },
        { catalogIdentity: "room-a", kind: "room", propertyId: "property-a", publicName: "Room A" }
      ]
    },
    ...overrides
  });
}

function evidence(overrides = {}) {
  return {
    eventId: "event-a",
    messageRef: "message-a",
    startOffset: 0,
    endOffset: 2,
    quote: "謝謝",
    ...overrides
  };
}

function unit(overrides = {}) {
  return {
    unitId: "unit-a",
    evidenceRefs: [evidence()],
    purpose: "acknowledgement",
    capability: null,
    subject: { kind: null, catalogIdentity: null },
    stayDependent: false,
    temporalCandidate: null,
    contextLinkCandidateId: "link-a",
    safetyCandidate: null,
    slotCandidates: [],
    confidenceBand: "high",
    ...overrides
  };
}

function link(overrides = {}) {
  return {
    contextLinkCandidateId: "link-a",
    unitId: "unit-a",
    relationKind: "NONE",
    currentSourceEvidenceRefs: [evidence()],
    referencedHistoryEventRefs: [],
    ...overrides
  };
}

function providerOutput(overrides = {}) {
  return {
    understandingOutput: {
      schemaVersion: 1,
      turnId: "turn-openai-understanding-v1",
      units: [unit()]
    },
    contextLinkCandidates: [link()],
    ...overrides
  };
}

function response(status, body, requestId = "", resolvedModel = "gpt-5.6-luna") {
  let safeBody = String(body);
  if (status >= 200 && status < 300) {
    try {
      const parsed = JSON.parse(safeBody);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
        && !Object.hasOwn(parsed, "model")) {
        safeBody = JSON.stringify({ model: resolvedModel, ...parsed });
      }
    } catch { /* malformed-body tests must remain malformed */ }
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === "x-request-id" ? requestId : null },
    text: async () => safeBody
  };
}

function structuredResponse(value = providerOutput(), status = "completed", requestId = "req-understanding-a", resolvedModel = "gpt-5.6-luna") {
  return response(200, JSON.stringify({
    model: resolvedModel,
    status,
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(value) }]
    }]
  }), requestId);
}

function successfulResponse(value = providerOutput(), requestId = "req-understanding-a") {
  return structuredResponse(value, "completed", requestId);
}

function siblingInput() {
  return c01({
    sourceEvents: [{
      eventId: "event-a",
      messageRef: "message-a",
      role: "guest",
      timestamp: NOW,
      messageKind: "text",
      messageText: "謝謝，有房嗎"
    }]
  });
}

function availabilityUnit(overrides = {}) {
  return unit({
    unitId: "unit-availability",
    evidenceRefs: [evidence({ startOffset: 3, endOffset: 6, quote: "有房嗎" })],
    purpose: "lodging_question",
    capability: "availability",
    subject: { kind: "room", catalogIdentity: "room-a" },
    stayDependent: true,
    contextLinkCandidateId: "link-availability",
    safetyCandidate: null,
    ...overrides
  });
}

function availabilityLink(overrides = {}) {
  return link({
    contextLinkCandidateId: "link-availability",
    unitId: "unit-availability",
    currentSourceEvidenceRefs: [evidence({ startOffset: 3, endOffset: 6, quote: "有房嗎" })],
    ...overrides
  });
}

function contextRelationVarianceInput(overrides = {}) {
  return c01({
    sourceEvents: [{
      eventId: "event-a",
      messageRef: "message-a",
      role: "guest",
      timestamp: NOW,
      messageKind: "text",
      messageText: "9/16有房嗎"
    }],
    recentConversation: [{
      eventId: "history-bundle",
      messageRef: "history-bundle-message",
      role: "guest",
      timestamp: "2026-08-29T07:58:00.000Z",
      messageKind: "text",
      messageText: "9/18包棟還有位子嗎",
      referenceableCycleIds: ["cycle-bundle"]
    }],
    stateV3Snapshot: {
      scope: { propertyId: "property-a", channel: "line-a", userId: "guest-a" },
      referenceableCycles: [{
        requestCycleId: "cycle-bundle",
        requestKind: "availability",
        capability: "availability",
        status: "answered",
        expiresAt: "2026-08-30T08:00:00.000Z",
        subject: { kind: "bundle", catalogIdentity: "bundle-a" },
        missingFields: [],
        confirmedValues: { checkIn: "2026-09-18", checkOut: "2026-09-19", guestCount: null, searchFrom: null, searchTo: null },
        slotRefs: ["productType", "bundleId", "checkIn", "checkOut"]
      }]
    },
    publicCatalog: {
      propertyId: "property-a",
      timezone: "Asia/Taipei",
      capabilityCatalog: ["availability"],
      publicSubjectCatalog: [
        { catalogIdentity: "property-a", kind: "property", propertyId: "property-a", publicName: "Property A" },
        { catalogIdentity: "bundle-a", kind: "bundle", propertyId: "property-a", publicName: "Bundle A" }
      ]
    },
    ...overrides
  });
}

function incompatibleContextRelationOutput() {
  return providerOutput({
    understandingOutput: {
      ...providerOutput().understandingOutput,
      units: [availabilityUnit({
        unitId: "unit-a",
        contextLinkCandidateId: "link-a",
        evidenceRefs: [evidence({ endOffset: 7, quote: "9/16有房嗎" })],
        subject: { kind: "property", catalogIdentity: null },
        temporalCandidate: {
          rawText: "9/16",
          kind: "month_day",
          checkInCandidate: null,
          checkOutCandidate: null,
          nightsCandidate: null
        }
      })]
    },
    contextLinkCandidates: [link({
      relationKind: "MODIFICATION",
      currentSourceEvidenceRefs: [evidence({ endOffset: 7, quote: "9/16有房嗎" })],
      referencedHistoryEventRefs: [{ eventId: "history-bundle", messageRef: "history-bundle-message" }]
    })]
  });
}

function schemaAccepts(schema, value) {
  if (schema.anyOf) return schema.anyOf.some((candidate) => schemaAccepts(candidate, value));
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  if (types.length && !types.includes(actualType)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (actualType === "string" && (value.length < (schema.minLength || 0) || value.length > (schema.maxLength || Infinity) || schema.pattern && !new RegExp(schema.pattern).test(value))) return false;
  if (actualType === "integer" && schema.minimum !== undefined && value < schema.minimum) return false;
  if (actualType === "array") {
    if (value.length < (schema.minItems || 0) || value.length > (schema.maxItems || Infinity)) return false;
    return value.every((item) => schemaAccepts(schema.items, item));
  }
  if (actualType === "object") {
    const properties = schema.properties || {};
    if ((schema.required || []).some((key) => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(properties, key))) return false;
    return Object.entries(properties).every(([key, child]) => !Object.hasOwn(value, key) || schemaAccepts(child, value[key]));
  }
  return true;
}

function semanticCapabilityBranch(schema, capability) {
  return schema.properties.understandingOutput.properties.units.items.anyOf
    .find((branch) => branch.properties.capability.enum.includes(capability));
}

const capabilityBoundaryInput = contextRelationVarianceInput();
const capabilityBoundarySchema = openAiUnderstandingV1ProviderSchema(capabilityBoundaryInput);
const availabilityCapability = semanticCapabilityBranch(capabilityBoundarySchema, "availability");
const availableDatesCapability = semanticCapabilityBranch(capabilityBoundarySchema, "available_dates");
assert.match(
  availabilityCapability.properties.capability.description,
  /specific supplied stay date or date range/i,
  "availability schema guidance must own fixed-date inventory questions"
);
assert.match(
  availableDatesCapability.properties.capability.description,
  /search for which stay dates are available/i,
  "available_dates schema guidance must own open-date inventory searches"
);
assert.match(
  instructions(),
  /A supplied specific stay date or date range.*availability.*which dates are available.*available_dates/i,
  "provider guidance must distinguish fixed-date availability from open-date available_dates"
);
assert.match(
  instructions(),
  /relationship between the property and any named or unnamed external place.*location.*external_place/i,
  "provider guidance must preserve the formal generic external-place location meaning"
);
assert.match(
  instructions(),
  /occupancy.*guest_count.*must not.*matched_room_set.*explicitly names.*lodging product type/i,
  "provider guidance must keep occupancy count separate from an explicitly named room-group product"
);
const temporalObjectBranches = availabilityCapability.properties.temporalCandidate.anyOf
  .filter((branch) => branch.type === "object");
assert.ok(temporalObjectBranches.length > 0);
for (const branch of temporalObjectBranches) {
  assert.match(
    branch.properties.rawText.description || "",
    /complete exact substring of one evidenceRefs.*quote/i,
    "temporal rawText schema guidance must expose the existing single-evidence grounding contract"
  );
}
assert.match(
  instructions(),
  /temporalCandidate\.rawText.*complete exact substring of one evidenceRefs.*quote.*date range.*single evidence span/is,
  "provider guidance must require one source evidence span to cover a complete date-range rawText"
);

const discriminatedInput = c01({
  publicCatalog: {
    propertyId: "property-a",
    timezone: "Asia/Taipei",
      capabilityCatalog: ["availability", "amenity", "property_fact", "price", "total_price"],
    publicSubjectCatalog: [
      { catalogIdentity: "property-a", kind: "property", propertyId: "property-a", publicName: "Property A" },
      { catalogIdentity: "room-a", kind: "room", propertyId: "property-a", publicName: "Room A" },
      { catalogIdentity: "bundle-a", kind: "bundle", propertyId: "property-a", publicName: "Bundle A" },
      { catalogIdentity: "parking", kind: "amenity", propertyId: "property-a", publicName: "Parking" }
    ]
  }
});
const semanticUnitProviderSchema = openAiUnderstandingV1ProviderSchema(discriminatedInput)
  .properties.understandingOutput.properties.units.items;
assert.equal(schemaAccepts(semanticUnitProviderSchema, availabilityUnit({ subject: { kind: null, catalogIdentity: null } })), false,
  "provider schema must reject availability without a lodging subject before C03");
assert.equal(schemaAccepts(semanticUnitProviderSchema, availabilityUnit({ capability: "amenity", subject: { kind: "amenity", catalogIdentity: "parking" }, stayDependent: true })), false,
  "provider schema must reject stay-dependent amenity output before C03");
assert.equal(schemaAccepts(semanticUnitProviderSchema, unit({
  purpose: "cancellation",
  capability: "unsupported",
  subject: { kind: null, catalogIdentity: null },
  stayDependent: false
})), false, "provider schema must not admit cancellation through the unsupported branch when null capability owns END");
for (const valid of [
  availabilityUnit({ subject: { kind: "property", catalogIdentity: null } }),
  availabilityUnit({ subject: { kind: "room", catalogIdentity: "room-a" } }),
  availabilityUnit({ subject: { kind: "bundle", catalogIdentity: "bundle-a" } }),
  availabilityUnit({ capability: "price", subject: { kind: "property", catalogIdentity: null }, temporalCandidate: null }),
  availabilityUnit({ capability: "total_price", subject: { kind: "property", catalogIdentity: null }, temporalCandidate: null }),
  availabilityUnit({ capability: "amenity", subject: { kind: "amenity", catalogIdentity: "parking" }, stayDependent: false })
]) assert.equal(schemaAccepts(semanticUnitProviderSchema, valid), true);

function siblingOutput({ invalidBoundary, invalidFirst }) {
  const availabilityOverrides = invalidBoundary === "C04"
    ? { evidenceRefs: [evidence({ startOffset: 3, endOffset: 6, quote: "不存在" })] }
    : invalidBoundary === "C03"
      ? { subject: { kind: "property", catalogIdentity: "property-a" } }
      : {};
  const linkOverrides = invalidBoundary === "C05"
    ? { relationKind: "SUPPLEMENT", referencedHistoryEventRefs: [{ eventId: "missing", messageRef: "missing" }] }
    : {};
  const acknowledgement = unit();
  const availability = availabilityUnit(availabilityOverrides);
  const acknowledgementLink = link();
  const availabilityContextLink = availabilityLink(linkOverrides);
  return providerOutput({
    understandingOutput: {
      ...providerOutput().understandingOutput,
      units: invalidFirst ? [availability, acknowledgement] : [acknowledgement, availability]
    },
    contextLinkCandidates: invalidFirst
      ? [availabilityContextLink, acknowledgementLink]
      : [acknowledgementLink, availabilityContextLink]
  });
}

function strictObjectAudit(schema, path = "root") {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false, `${path} must reject unknown fields`);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path} must require every field`);
  }
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === "object") strictObjectAudit(value, `${path}.${key}`);
  }
}

async function captureError(operation) {
  try { await operation(); }
  catch (error) { return error; }
  assert.fail("expected fail-closed OpenAI Understanding error");
}

function options(fetchImpl, overrides = {}) {
  return {
    apiKey: "test-only-key",
    fetchImpl,
    retryDelayMs: 0,
    waitImpl: async () => undefined,
    nowMs: () => Date.parse(NOW),
    ...overrides
  };
}

async function main() {
  // FAKE_INTEGRATION / AC-CON-001, AC-WIR-001, AC-MNT-001: one provider
  // response carries exact C02/C03/C04/C05 candidates. The request uses the
  // current Responses API pattern, current configured model, and one strict,
  // recursively closed schema without a sampling override.
  let calls = 0;
  let capturedUrl;
  let capturedRequest;
  const diagnostics = [];
  const input = c01();
  const result = await callOpenAIUnderstandingV1(input, options(async (url, request) => {
    calls += 1;
    capturedUrl = url;
    capturedRequest = request;
    return successfulResponse();
  }, { onDiagnostic: (event) => diagnostics.push(event) }));
  assert.equal(calls, 1, "valid understanding must use exactly one provider call");
  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  const body = JSON.parse(capturedRequest.body);
  assert.equal(body.model, "gpt-5.6-luna");
  assert.equal(Object.hasOwn(body, "temperature"), false);
  assert.equal(Object.hasOwn(body, "top_p"), false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "junzan_understanding_v1");
  assert.equal(body.text.format.strict, true);
  assert.match(body.input[0].content[0].text, /composite lodging meaning/u);
  assert.match(body.input[0].content[0].text, /cycle's missingFields/u);
  strictObjectAudit(body.text.format.schema);
  assert.deepEqual(body.text.format.schema.required.sort(), ["contextLinkCandidates", "understandingOutput"]);
  assert.deepEqual(
    body.text.format.schema.properties.understandingOutput.required.sort(),
    ["schemaVersion", "turnId", "units"]
  );
  const unitBranches = body.text.format.schema.properties.understandingOutput.properties.units.items.anyOf;
  assert.ok(unitBranches.length <= CAPABILITIES.size);
  for (const requiredCapability of ["availability"]) assert.ok(
    unitBranches.some((branch) => branch.properties.capability.enum.includes(requiredCapability))
  );
  const amenityListBranch = unitBranches.find((branch) => branch.properties.capability.enum.includes("amenity_list"));
  assert.ok(amenityListBranch, "provider schema must derive amenity_list from the shared capability policy");
  assert.match(amenityListBranch.properties.capability.description, /collection.*amenit|amenit.*collection/i);
  for (const capability of ["price", "total_price"]) {
    const priceBranch = unitBranches.find((branch) => branch.properties.capability.enum.includes(capability));
    assert.ok(priceBranch, `${capability} must be derived from the shared capability policy`);
    assert.ok(priceBranch.properties.subject.anyOf.some((subjectBranch) =>
      subjectBranch.properties.kind.enum.includes("property")
        && subjectBranch.properties.catalogIdentity.enum.length === 1
        && subjectBranch.properties.catalogIdentity.enum[0] === null
    ), `${capability} must expose a catalog-independent property subject`);
    assert.match(priceBranch.properties.capability.description, /property subject.*no catalog identity/i);
  }
  const operatorBranch = unitBranches.find((branch) => branch.properties.capability.enum.includes("booking_operator_request"));
  assert.ok(operatorBranch.properties.subject.anyOf.some((subjectBranch) =>
    subjectBranch.properties.kind.enum.includes("other_verified")
      && subjectBranch.properties.catalogIdentity.enum.length === 1
      && subjectBranch.properties.catalogIdentity.enum[0] === null
  ), "booking operator requests must expose a catalog-independent generic subject");
  for (const branch of unitBranches) assert.deepEqual(
    branch.required.sort(),
    ["capability", "confidenceBand", "contextLinkCandidateId", "evidenceRefs", "purpose", "safetyCandidate", "slotCandidates", "stayDependent", "subject", "temporalCandidate", "unitId"].sort()
  );
  assert.deepEqual(
    body.text.format.schema.properties.contextLinkCandidates.items.required.sort(),
    ["contextLinkCandidateId", "currentSourceEvidenceRefs", "referencedHistoryEventRefs", "relationKind", "unitId"].sort()
  );
  assert.deepEqual(
    unitBranches[0].properties.evidenceRefs.items.required.sort(),
    ["endOffset", "eventId", "messageRef", "quote", "startOffset"].sort()
  );
  assert.equal(JSON.stringify(body.input).includes("must-not-leak"), false);
  const providerDeveloperInput = JSON.parse(body.input[1].content[0].text);
  assert.equal(JSON.stringify(providerDeveloperInput).includes("requestCycleId"), false,
    "the provider must never receive internal cycle identities");
  assert.deepEqual(result.understandingOutput, providerOutput().understandingOutput);
  assert.deepEqual(result.contextLinkCandidates, providerOutput().contextLinkCandidates);
  assert.equal(result.validatedUnits.length, 1);
  assert.equal(result.validatedContextLinks.length, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].requestedModel, "gpt-5.6-luna");
  assert.equal(result[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].resolvedModel, "gpt-5.6-luna");
  assert.deepEqual(result[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].understandingEvidence.providerVisibleInput.sourceEvents, input.sourceEvents);
  assert.deepEqual(result[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].understandingEvidence.structuredOutput, {
    understandingOutput: result.understandingOutput,
    contextLinkCandidates: result.contextLinkCandidates
  });
  assert.ok(result[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].understandingEvidence.providerGuidance.some((item) => item.includes("safetyCandidate")));
  assert.ok(result[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].understandingEvidence.schemaBranches.booking_operator_request);
  assert.equal(Object.isFrozen(result.understandingOutput), true);
  assert.equal(Object.isFrozen(result.validatedUnits[0]), true);
  assert.equal(isTrustedUnderstandingResult(result), true);
  assert.deepEqual(diagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C03_SEMANTIC_UNIT_VALIDATED",
    "C05_CONTEXT_LINK_VALIDATED"
  ]);
  assert.equal(result[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].providerAttemptCount, 1);

  const inconsistentTemporalError = await captureError(() => callOpenAIUnderstandingV1(
    contextRelationVarianceInput({ recentConversation: [], stateV3Snapshot: { scope: { propertyId: "property-a", channel: "line-a", userId: "guest-a" }, referenceableCycles: [] } }),
    options(async () => successfulResponse(providerOutput({
      understandingOutput: {
        ...providerOutput().understandingOutput,
        units: [availabilityUnit({
          evidenceRefs: [evidence({ endOffset: 7, quote: "9/16有房嗎" })],
          subject: { kind: "property", catalogIdentity: null },
          temporalCandidate: { rawText: "明天", kind: "relative_date", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null }
        })]
      },
      contextLinkCandidates: [availabilityLink({
        currentSourceEvidenceRefs: [evidence({ endOffset: 7, quote: "9/16有房嗎" })]
      })]
    })))
  ));
  assert.equal(inconsistentTemporalError.code, "UNDERSTANDING_SCHEMA_INVALID",
    "a temporal candidate must be grounded in its declared unit evidence");
  assert.deepEqual(inconsistentTemporalError.schemaViolation, {
    validationErrorCode: "UNDERSTANDING_SCHEMA_INVALID",
    fieldPath: "understandingOutput.units.0.temporalCandidate.rawText",
    expected: "exact substring of understandingOutput.units.0.evidenceRefs[].quote",
    actual: "string:not_grounded"
  }, "schema rejection diagnostics must identify the exact safe field without persisting source text");
  assert.deepEqual(inconsistentTemporalError.rejectedEvidence, {
    fieldPath: "understandingOutput.units.0.temporalCandidate.rawText",
    validationReason: "string:not_grounded",
    rejectedUnitIndex: 0,
    semantic: {
      purpose: "lodging_question",
      capability: "availability",
      subject: { kind: "property", catalogIdentity: null },
      confidenceBand: "high"
    },
    temporalCandidate: {
      rawText: "明天",
      kind: "relative_date",
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null
    },
    evidenceRefs: [{
      eventId: "event-a",
      messageRef: "message-a",
      startOffset: 0,
      endOffset: 7,
      quote: "9/16有房嗎",
      sourceExcerpt: "9/16有房嗎",
      quoteMatchesSource: true
    }],
    rawTextInSource: false,
    rawTextInEvidenceQuote: false
  }, "wire rejection must retain the bounded raw evidence needed for root-cause diagnosis");

  // A targeted relation is part of the provider wire contract: the cited
  // history event must bind to a cycle whose capability and subject identity
  // match the semantic unit. C05 remains the second, authoritative guard.
  let incompatibleRelationCalls = 0;
  const incompatibleRelationDiagnostics = [];
  const incompatibleRelationError = await captureError(() => callOpenAIUnderstandingV1(
    contextRelationVarianceInput(),
    options(async () => {
      incompatibleRelationCalls += 1;
      return successfulResponse(incompatibleContextRelationOutput());
    }, { onDiagnostic: (event) => incompatibleRelationDiagnostics.push(event) })
  ));
  assert.equal(incompatibleRelationCalls, 1, "identity-incompatible targeted relation must not be admitted");
  assert.equal(incompatibleRelationError.code, "UNDERSTANDING_SCHEMA_INVALID");
  assert.deepEqual(incompatibleRelationError.schemaViolation, {
    validationErrorCode: "UNDERSTANDING_SCHEMA_INVALID",
    fieldPath: "contextLinkCandidates.0.referencedHistoryEventRefs",
    expected: "target bound to capability/subject-compatible referenceable cycle",
    actual: "relation_target:identity_incompatible"
  });
  assert.deepEqual(incompatibleRelationDiagnostics.map((event) => event.targetMarker), ["C02_WIRE_SCHEMA_REJECTED"]);

  const missingFieldNotFilledInput = c01({
    sourceEvents: [{
      eventId: "event-a", messageRef: "message-a", role: "guest", timestamp: NOW,
      messageKind: "text", messageText: "有房嗎"
    }],
    stateV3Snapshot: {
      scope: { propertyId: "property-a", channel: "line-a", userId: "guest-a" },
      referenceableCycles: [{
        requestCycleId: "cycle-a", requestKind: "availability", capability: "availability",
        status: "pending", expiresAt: "2026-08-30T08:00:00.000Z",
        subject: { kind: "room", catalogIdentity: "room-a" }, missingFields: ["checkIn"],
        confirmedValues: { checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null },
        slotRefs: []
      }]
    }
  });
  const missingFieldNotFilledError = await captureError(() => callOpenAIUnderstandingV1(
    missingFieldNotFilledInput,
    options(async () => successfulResponse(providerOutput({
      understandingOutput: {
        ...providerOutput().understandingOutput,
        units: [availabilityUnit({
          unitId: "unit-a", contextLinkCandidateId: "link-a",
          evidenceRefs: [evidence({ endOffset: 3, quote: "有房嗎" })]
        })]
      },
      contextLinkCandidates: [link({
        relationKind: "SUPPLEMENT",
        currentSourceEvidenceRefs: [evidence({ endOffset: 3, quote: "有房嗎" })],
        referencedHistoryEventRefs: [{ eventId: "history-a", messageRef: "history-message-a" }]
      })]
    })))
  ));
  assert.equal(missingFieldNotFilledError.code, "UNDERSTANDING_SCHEMA_INVALID");
  assert.equal(missingFieldNotFilledError.schemaViolation.actual, "relation_target:missing_field_not_filled",
    "SUPPLEMENT must supply at least one field missing from its compatible target");

  const standaloneSupplementError = await captureError(() => callOpenAIUnderstandingV1(
    c01({
      sourceEvents: [{
        eventId: "event-a", messageRef: "message-a", role: "guest", timestamp: NOW,
        messageKind: "text", messageText: "9/16有房嗎"
      }],
      stateV3Snapshot: {
        scope: { propertyId: "property-a", channel: "line-a", userId: "guest-a" },
        referenceableCycles: [{
          requestCycleId: "cycle-a", requestKind: "availability", capability: "availability",
          status: "pending", expiresAt: "2026-08-30T08:00:00.000Z",
          subject: { kind: "room", catalogIdentity: "room-a" }, missingFields: ["checkIn", "checkOut"],
          confirmedValues: { checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null },
          slotRefs: []
        }]
      }
    }),
    options(async () => successfulResponse(providerOutput({
      understandingOutput: {
        ...providerOutput().understandingOutput,
        units: [availabilityUnit({
          unitId: "unit-a", contextLinkCandidateId: "link-a",
          evidenceRefs: [evidence({ endOffset: 7, quote: "9/16有房嗎" })],
          temporalCandidate: {
            rawText: "9/16", kind: "month_day",
            checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null
          }
        })]
      },
      contextLinkCandidates: [link({
        relationKind: "SUPPLEMENT",
        currentSourceEvidenceRefs: [evidence({ endOffset: 7, quote: "9/16有房嗎" })],
        referencedHistoryEventRefs: [{ eventId: "history-a", messageRef: "history-message-a" }]
      })]
    })))
  ));
  assert.equal(standaloneSupplementError.code, "UNDERSTANDING_SCHEMA_INVALID");
  assert.equal(standaloneSupplementError.schemaViolation.actual, "relation_target:standalone_request_complete",
    "a semantic unit that is independently ready must not be admitted as SUPPLEMENT");

  const compatibleSupplementInput = c01({
    sourceEvents: [{
      eventId: "event-a", messageRef: "message-a", role: "guest", timestamp: NOW,
      messageKind: "text", messageText: "4個人"
    }],
    stateV3Snapshot: {
      scope: { propertyId: "property-a", channel: "line-a", userId: "guest-a" },
      referenceableCycles: [{
        requestCycleId: "cycle-a", requestKind: "capacity", capability: "capacity",
        status: "pending", expiresAt: "2026-08-30T08:00:00.000Z",
        subject: { kind: "room", catalogIdentity: "room-a" }, missingFields: ["guestCount"],
        confirmedValues: { checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null },
        slotRefs: []
      }]
    },
    publicCatalog: {
      propertyId: "property-a", timezone: "Asia/Taipei",
      capabilityCatalog: ["availability", "capacity", "property_fact"],
      publicSubjectCatalog: [
        { catalogIdentity: "property-a", kind: "property", propertyId: "property-a", publicName: "Property A" },
        { catalogIdentity: "room-a", kind: "room", propertyId: "property-a", publicName: "Room A" }
      ]
    }
  });
  const compatibleSupplementResult = await callOpenAIUnderstandingV1(
    compatibleSupplementInput,
    options(async () => successfulResponse(providerOutput({
      understandingOutput: {
        ...providerOutput().understandingOutput,
        units: [unit({
          purpose: "lodging_question", capability: "capacity",
          subject: { kind: "room", catalogIdentity: "room-a" }, stayDependent: true,
          evidenceRefs: [evidence({ endOffset: 3, quote: "4個人" })],
          slotCandidates: [{
            slotCandidateId: "slot-guest-count", slot: "guest_count", operation: "SET", value: 4,
            evidenceRefs: [evidence({ endOffset: 3, quote: "4個人" })]
          }]
        })]
      },
      contextLinkCandidates: [link({
        relationKind: "SUPPLEMENT",
        currentSourceEvidenceRefs: [evidence({ endOffset: 3, quote: "4個人" })],
        referencedHistoryEventRefs: [{ eventId: "history-a", messageRef: "history-message-a" }]
      })]
    })))
  );
  assert.equal(compatibleSupplementResult.validatedContextLinks[0].relationKind, "SUPPLEMENT",
    "identity-compatible SUPPLEMENT that fills a missing field but remains incomplete must be admitted");

  const standaloneResult = await callOpenAIUnderstandingV1(
    contextRelationVarianceInput(),
    options(async () => successfulResponse(providerOutput({
      understandingOutput: incompatibleContextRelationOutput().understandingOutput,
      contextLinkCandidates: [link({
        relationKind: "NEW_REQUEST",
        currentSourceEvidenceRefs: [evidence({ endOffset: 7, quote: "9/16有房嗎" })],
        referencedHistoryEventRefs: []
      })]
    })))
  );
  assert.equal(standaloneResult.validatedContextLinks[0].relationKind, "NEW_REQUEST",
    "standalone NEW_REQUEST must remain admitted when incompatible history exists");

  const unboundTargetResult = await callOpenAIUnderstandingV1(
    contextRelationVarianceInput({ recentConversation: [] }),
    options(async () => successfulResponse(providerOutput({
      understandingOutput: {
        ...providerOutput().understandingOutput,
        units: [availabilityUnit({
          unitId: "unit-a",
          contextLinkCandidateId: "link-a",
          evidenceRefs: [evidence({ endOffset: 7, quote: "9/16有房嗎" })],
          subject: { kind: "bundle", catalogIdentity: "bundle-a" },
          temporalCandidate: {
            rawText: "9/16",
            kind: "month_day",
            checkInCandidate: null,
            checkOutCandidate: null,
            nightsCandidate: null
          }
        })]
      },
      contextLinkCandidates: [link({
        relationKind: "MODIFICATION",
        currentSourceEvidenceRefs: [evidence({ endOffset: 7, quote: "9/16有房嗎" })],
        referencedHistoryEventRefs: [{ eventId: "history-bundle", messageRef: "history-bundle-message" }]
      })]
    })))
  );
  assert.deepEqual(unboundTargetResult.failedUnits.map((failure) => failure.failureCode), ["CONTEXT_TARGET_UNAVAILABLE"],
    "targeted relations require a trusted C01 conversation-to-cycle binding");

  // After the response passes the global C02 wire contract, C04/C03/C05
  // failures are unit-scoped. A failing availability sibling cannot erase or
  // contaminate a valid acknowledgement, regardless of sibling order.
  const siblingFailureCodes = {
    C04: "EVIDENCE_QUOTE_MISMATCH",
    C03: "CATALOG_IDENTITY_INVALID",
    C05: "CONTEXT_TARGET_UNAVAILABLE"
  };
  const siblingFailureMarkers = {
    C04: "C04_SOURCE_EVIDENCE_REJECTED",
    C03: "C03_SEMANTIC_UNIT_REJECTED",
    C05: "C05_CONTEXT_LINK_REJECTED"
  };
  for (const invalidBoundary of ["C04", "C03", "C05"]) {
    for (const invalidFirst of [false, true]) {
      let validationCalls = 0;
      const siblingBoundaryDiagnostics = [];
      const siblingResult = await callOpenAIUnderstandingV1(siblingInput(), options(async () => {
        validationCalls += 1;
        return successfulResponse(siblingOutput({ invalidBoundary, invalidFirst }));
      }, { onDiagnostic: (event) => siblingBoundaryDiagnostics.push(event) }));
      assert.equal(validationCalls, 1, `${invalidBoundary}/${invalidFirst}: local validation must not resample`);
      assert.deepEqual(
        siblingResult.validatedUnits.map((candidate) => candidate.unitId),
        ["unit-a"],
        `${invalidBoundary}/${invalidFirst}: valid acknowledgement must survive`
      );
      assert.deepEqual(
        siblingResult.validatedContextLinks.map((candidate) => candidate.unitId),
        ["unit-a"],
        `${invalidBoundary}/${invalidFirst}: only the valid sibling link is admitted`
      );
      assert.deepEqual(siblingResult.failedUnits, [{
        unitId: "unit-availability",
        failureCode: siblingFailureCodes[invalidBoundary],
        boundary: invalidBoundary
      }]);
      assert.equal(Object.isFrozen(siblingResult.failedUnits), true);
      assert.equal(Object.isFrozen(siblingResult.failedUnits[0]), true);
      assert.equal(isTrustedUnderstandingResult(siblingResult), true);
      assert.equal(
        siblingBoundaryDiagnostics.some((event) => event.targetMarker === siblingFailureMarkers[invalidBoundary]),
        true,
        `${invalidBoundary}/${invalidFirst}: owned rejection marker must be emitted`
      );
      assert.deepEqual(
        siblingBoundaryDiagnostics.filter((event) => event.status === "SUCCESS").map((event) => event.targetMarker),
        [
          "C02_UNDERSTANDING_RECEIVED",
          ...Array(invalidBoundary === "C04" ? 1 : 2).fill("C04_SOURCE_EVIDENCE_VALIDATED"),
          ...Array(invalidBoundary === "C05" ? 2 : 1).fill("C03_SEMANTIC_UNIT_VALIDATED"),
          "C05_CONTEXT_LINK_VALIDATED"
        ],
        `${invalidBoundary}/${invalidFirst}: successful sibling markers remain boundary ordered`
      );
    }
  }

  // A malformed sibling rejects the whole wire response before C04/C03/C05;
  // the adapter neither drops it nor asks for a replacement sample.
  let siblingCalls = 0;
  const siblingDiagnostics = [];
  const invalidSibling = providerOutput({
    understandingOutput: {
      ...providerOutput().understandingOutput,
      units: [unit(), unit({ unitId: "unit-b", contextLinkCandidateId: "link-b", facts: [] })]
    },
    contextLinkCandidates: [link(), link({ unitId: "unit-b", contextLinkCandidateId: "link-b" })]
  });
  const siblingError = await captureError(() => callOpenAIUnderstandingV1(input, options(async () => {
    siblingCalls += 1;
    return successfulResponse(invalidSibling);
  }, { onDiagnostic: (event) => siblingDiagnostics.push(event) })));
  assert.equal(siblingCalls, 1);
  assert.equal(siblingError.code, "UNKNOWN_WIRE_FIELD");
  assert.deepEqual(siblingDiagnostics.map((event) => event.targetMarker), ["C02_WIRE_SCHEMA_REJECTED"]);

  // A schema-valid but C03-invalid semantic choice is never retried, repaired,
  // classified again, or replaced with a deterministic raw-text decision.
  let semanticCalls = 0;
  const semanticDiagnostics = [];
  const semanticResult = await callOpenAIUnderstandingV1(input, options(async () => {
    semanticCalls += 1;
    return successfulResponse(providerOutput({
      understandingOutput: {
        ...providerOutput().understandingOutput,
        units: [unit({
          purpose: "lodging_question",
          capability: "availability",
          subject: { kind: "property", catalogIdentity: "property-a" },
          stayDependent: true,
          safetyCandidate: null
        })]
      }
    }));
  }, { onDiagnostic: (event) => semanticDiagnostics.push(event) }));
  assert.equal(semanticCalls, 1);
  assert.deepEqual(semanticResult.validatedUnits, []);
  assert.deepEqual(semanticResult.failedUnits, [{
    unitId: "unit-a",
    failureCode: "CATALOG_IDENTITY_INVALID",
    boundary: "C03"
  }]);
  assert.deepEqual(semanticDiagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C03_SEMANTIC_UNIT_REJECTED"
  ]);

  // Duplicate C05 ownership remains a C05-owned rejection. It must not be
  // collapsed into the C02 generic schema code merely because the duplicate
  // arrived inside the same structured response.
  let duplicateLinkCalls = 0;
  const duplicateLinkDiagnostics = [];
  const duplicateLinkResult = await callOpenAIUnderstandingV1(input, options(async () => {
    duplicateLinkCalls += 1;
    return successfulResponse(providerOutput({
      contextLinkCandidates: [link(), link({ unitId: "unit-b" })]
    }));
  }, { onDiagnostic: (event) => duplicateLinkDiagnostics.push(event) }));
  assert.equal(duplicateLinkCalls, 1);
  assert.deepEqual(duplicateLinkResult.validatedUnits.map((candidate) => candidate.unitId), ["unit-a"]);
  assert.deepEqual(duplicateLinkResult.failedUnits, [{
    unitId: "unit-b",
    failureCode: "CONTEXT_LINK_DUPLICATE",
    boundary: "C05"
  }]);
  assert.deepEqual(duplicateLinkDiagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C03_SEMANTIC_UNIT_VALIDATED",
    "C05_CONTEXT_LINK_VALIDATED",
    "C05_CONTEXT_LINK_REJECTED"
  ]);
  assert.equal(duplicateLinkDiagnostics.at(-1).inputUnitIds.length, 1);

  // An orphan duplicate may claim an existing semantic unit under a different
  // link ID. That owner cannot appear in both validated and failed outcomes.
  const ownershipCollisionResult = await callOpenAIUnderstandingV1(siblingInput(), options(async () =>
    successfulResponse(providerOutput({
      understandingOutput: {
        ...providerOutput().understandingOutput,
        units: [unit(), availabilityUnit()]
      },
      contextLinkCandidates: [
        link(),
        availabilityLink(),
        link({
          unitId: "unit-availability",
          currentSourceEvidenceRefs: [evidence({ startOffset: 3, endOffset: 6, quote: "有房嗎" })]
        })
      ]
    }))));
  assert.deepEqual(ownershipCollisionResult.validatedUnits.map((candidate) => candidate.unitId), ["unit-a"]);
  assert.deepEqual(ownershipCollisionResult.validatedContextLinks.map((candidate) => candidate.unitId), ["unit-a"]);
  assert.deepEqual(ownershipCollisionResult.failedUnits, [{
    unitId: "unit-availability",
    failureCode: "CONTEXT_LINK_DUPLICATE",
    boundary: "C05"
  }]);
  assert.equal(
    ownershipCollisionResult.validatedUnits.some((candidate) =>
      ownershipCollisionResult.failedUnits.some((failure) => failure.unitId === candidate.unitId)),
    false,
    "validated and failed unit ownership must remain disjoint"
  );

  // A duplicate link owned by another unit retains that unit's evidence and
  // diagnostic attribution; matching only the shared link ID would blame the
  // C02 unit for the foreign C05 evidence failure.
  const foreignLinkDiagnostics = [];
  const foreignLinkResult = await callOpenAIUnderstandingV1(input, options(async () =>
    successfulResponse(providerOutput({
      contextLinkCandidates: [
        link(),
        link({ unitId: "unit-b", currentSourceEvidenceRefs: [evidence({ quote: "不存在" })] })
      ]
    })), { onDiagnostic: (event) => foreignLinkDiagnostics.push(event) }));
  assert.deepEqual(foreignLinkResult.validatedUnits.map((candidate) => candidate.unitId), ["unit-a"]);
  assert.deepEqual(foreignLinkResult.failedUnits, [{
    unitId: "unit-b",
    failureCode: "EVIDENCE_QUOTE_MISMATCH",
    boundary: "C04"
  }]);
  assert.deepEqual(foreignLinkDiagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C04_SOURCE_EVIDENCE_REJECTED",
    "C03_SEMANTIC_UNIT_VALIDATED",
    "C05_CONTEXT_LINK_VALIDATED"
  ]);
  assert.notEqual(
    foreignLinkDiagnostics.find((event) => event.targetMarker === "C04_SOURCE_EVIDENCE_REJECTED").inputUnitIds[0],
    foreignLinkDiagnostics[0].inputUnitIds[0],
    "the C04 failure must identify foreign C05 unit-b rather than C02 unit-a"
  );

  // C04 and C05 own their own fail-closed boundary codes and markers, with no
  // provider resampling after a parseable response.
  const evidenceDiagnostics = [];
  const evidenceResult = await callOpenAIUnderstandingV1(input, options(async () =>
    successfulResponse(providerOutput({
      understandingOutput: {
        ...providerOutput().understandingOutput,
        units: [unit({ evidenceRefs: [evidence({ quote: "不存在" })] })]
      }
    })), { onDiagnostic: (event) => evidenceDiagnostics.push(event) }));
  assert.deepEqual(evidenceResult.validatedUnits, []);
  assert.deepEqual(evidenceResult.failedUnits, [{
    unitId: "unit-a",
    failureCode: "EVIDENCE_QUOTE_MISMATCH",
    boundary: "C04"
  }]);
  assert.deepEqual(evidenceDiagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_REJECTED"
  ]);
  const contextDiagnostics = [];
  const contextResult = await callOpenAIUnderstandingV1(input, options(async () =>
    successfulResponse(providerOutput({
      contextLinkCandidates: [link({
        relationKind: "SUPPLEMENT",
        referencedHistoryEventRefs: [{ eventId: "missing", messageRef: "missing" }]
      })]
    })), { onDiagnostic: (event) => contextDiagnostics.push(event) }));
  assert.deepEqual(contextResult.validatedUnits, []);
  assert.deepEqual(contextResult.failedUnits, [{
    unitId: "unit-a",
    failureCode: "CONTEXT_TARGET_UNAVAILABLE",
    boundary: "C05"
  }]);
  assert.deepEqual(contextDiagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C03_SEMANTIC_UNIT_VALIDATED",
    "C05_CONTEXT_LINK_REJECTED"
  ]);

  // Refusal, outer response parse failure, provider schema failure, and local
  // contract failure are non-transport failures. Each stops after one call.
  const nonRetryableCases = [
    ["refusal", async () => response(200, JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["failed-with-output", async () => structuredResponse(providerOutput(), "failed"), "UNDERSTANDING_SCHEMA_INVALID"],
    ["incomplete-with-output", async () => structuredResponse(providerOutput(), "incomplete"), "UNDERSTANDING_SCHEMA_INVALID"],
    ["in-progress-with-output", async () => structuredResponse(providerOutput(), "in_progress"), "UNDERSTANDING_SCHEMA_INVALID"],
    ["queued-with-output", async () => structuredResponse(providerOutput(), "queued"), "UNDERSTANDING_SCHEMA_INVALID"],
    ["cancelled-with-output", async () => structuredResponse(providerOutput(), "cancelled"), "UNDERSTANDING_SCHEMA_INVALID"],
    ["unknown-status-with-output", async () => structuredResponse(providerOutput(), "unexpected"), "UNDERSTANDING_SCHEMA_INVALID"],
    ["missing-status-with-output", async () => response(200, JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(providerOutput()) }] }]
    })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["top-level-output-text-shortcut", async () => response(200, JSON.stringify({
      status: "completed",
      output_text: JSON.stringify(providerOutput())
    })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["refusal-with-output", async () => response(200, JSON.stringify({
      status: "completed",
      output_text: JSON.stringify(providerOutput()),
      output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }]
    })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["malformed-output-container-with-refusal", async () => response(200, JSON.stringify({
      status: "completed",
      output_text: JSON.stringify(providerOutput()),
      output: { type: "message", content: [{ type: "refusal", refusal: "no" }] }
    })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["multiple-output-parts", async () => response(200, JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [
        { type: "output_text", text: JSON.stringify(providerOutput()) },
        { type: "output_text", text: JSON.stringify(providerOutput()) }
      ] }]
    })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["multiple-output-objects", async () => response(200, JSON.stringify({
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(providerOutput()) }] },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(providerOutput()) }] }
      ]
    })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["structured-plus-extra-output-object", async () => response(200, JSON.stringify({
      status: "completed",
      output: [
        { type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "hidden" }] },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(providerOutput()) }] }
      ]
    })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["structured-plus-extra-content-part", async () => response(200, JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [
        { type: "output_text", text: JSON.stringify(providerOutput()) },
        { type: "annotation", value: "extra" }
      ] }]
    })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["parse", async () => response(200, "not-json"), "UNDERSTANDING_SCHEMA_INVALID"],
    ["provider-schema", async () => response(400, JSON.stringify({ error: { type: "invalid_request_error", code: "invalid_json_schema", param: "text.format.schema" } })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["turn-contract", async () => successfulResponse(providerOutput({ understandingOutput: { ...providerOutput().understandingOutput, turnId: "wrong-turn" } })), "UNDERSTANDING_SCHEMA_INVALID"],
    ["link-cardinality", async () => successfulResponse(providerOutput({
      contextLinkCandidates: Array.from({ length: 101 }, (_, index) => link({
        contextLinkCandidateId: `link-${index}`,
        unitId: `unit-${index}`
      }))
    })), "UNDERSTANDING_CARDINALITY_INVALID"]
  ];
  for (const [name, fetchImpl, code] of nonRetryableCases) {
    let count = 0;
    const error = await captureError(() => callOpenAIUnderstandingV1(input, options(async (...args) => {
      count += 1;
      return fetchImpl(...args);
    })));
    assert.equal(count, 1, `${name} must not retry`);
    assert.equal(error.code, code);
  }

  // Existing provider policy permits one retry only for transport categories.
  // A successful second transport attempt is still one logical understanding
  // response and retains bounded, body-free attempt metadata.
  let transportCalls = 0;
  const transportResult = await callOpenAIUnderstandingV1(input, options(async () => {
    transportCalls += 1;
    if (transportCalls === 1) throw new TypeError("network unavailable");
    return successfulResponse();
  }));
  assert.equal(transportCalls, 2);
  assert.equal(transportResult[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].providerAttemptCount, 2);
  assert.equal(transportResult[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].retryPerformed, true);
  assert.equal(JSON.stringify(transportResult[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC]).includes("network unavailable"), false);

  // Node/network transports commonly attach system codes. Those codes do not
  // turn transport failure into an adapter-owned contract failure.
  let codedNetworkCalls = 0;
  const codedNetworkResult = await callOpenAIUnderstandingV1(input, options(async () => {
    codedNetworkCalls += 1;
    if (codedNetworkCalls === 1) {
      const error = new Error("socket reset");
      error.code = "ECONNRESET";
      throw error;
    }
    return successfulResponse();
  }));
  assert.equal(codedNetworkCalls, 2);
  assert.equal(codedNetworkResult[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].providerAttempts[0].errorCategory, "network");

  // The existing Responses adapter requires UUID-v4 client request IDs and
  // replaces unsafe/incompatible injected values before the request is sent.
  let sentClientRequestId = "";
  await callOpenAIUnderstandingV1(input, options(async (_url, request) => {
    sentClientRequestId = request.headers["X-Client-Request-Id"];
    return successfulResponse();
  }, { requestIdFactory: () => "not-a-uuid" }));
  assert.match(sentClientRequestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  // Timeout exhaustion uses the owned provider-timeout code and C11 marker;
  // the bounded policy stops after the one permitted retry.
  let timeoutCalls = 0;
  const timeoutDiagnostics = [];
  const timeoutError = await captureError(() => callOpenAIUnderstandingV1(input, options(async (_url, request) => {
    timeoutCalls += 1;
    return new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => {
      const error = new Error("secret timeout detail");
      error.name = "AbortError";
      reject(error);
    }, { once: true }));
  }, {
    timeoutMs: 2,
    roundTimeoutMs: 20,
    onDiagnostic: (event) => timeoutDiagnostics.push(event)
  })));
  assert.equal(timeoutCalls, 2);
  assert.equal(timeoutError.code, "UNDERSTANDING_PROVIDER_TIMEOUT");
  assert.equal(JSON.stringify(timeoutError).includes("secret timeout detail"), false);
  assert.deepEqual(timeoutDiagnostics.map((event) => event.targetMarker), ["C02_PROVIDER_TIMEOUT"]);

  // A forged or unbounded non-C01 object never reaches the provider.
  let invalidInputCalls = 0;
  const invalidInputError = await captureError(() => callOpenAIUnderstandingV1({ ...input, facts: [] }, options(async () => {
    invalidInputCalls += 1;
    return successfulResponse();
  })));
  assert.equal(invalidInputCalls, 0);
  assert.equal(invalidInputError.code, "TURN_INPUT_INVALID");

  // Task 12 provenance is private and checked without reading attacker fields.
  let forgedAccessorReads = 0;
  const forgedResult = {};
  for (const field of ["validatedUnits", "validatedContextLinks", "failedUnits"]) {
    Object.defineProperty(forgedResult, field, {
      enumerable: true,
      get() {
        forgedAccessorReads += 1;
        return [];
      }
    });
  }
  Object.defineProperty(forgedResult, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC, {
    value: Object.freeze({ providerAttemptCount: 1 })
  });
  assert.equal(isTrustedUnderstandingResult(forgedResult), false);
  assert.equal(forgedAccessorReads, 0, "trust rejection must not inspect forged result fields");

  let overrideCalls = 0;
  const overrideError = await captureError(() => callOpenAIUnderstandingV1(input, {
    ...options(async () => {
      overrideCalls += 1;
      return successfulResponse();
    }),
    model: "gpt-4.1-mini"
  }));
  assert.equal(overrideCalls, 0, "caller model override must fail before transport");
  assert.equal(overrideError.code, "MODEL_IDENTITY_MISMATCH");

  const mismatchError = await captureError(() => callOpenAIUnderstandingV1(input, options(async () => (
    structuredResponse(providerOutput(), "completed", "req-model-mismatch", "gpt-4.1-mini")
  ))));
  assert.equal(mismatchError.code, "MODEL_IDENTITY_MISMATCH");
  assert.equal(mismatchError[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].requestedModel, "gpt-5.6-luna");
  assert.equal(mismatchError[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].resolvedModel, "gpt-4.1-mini");

  const reasoningResult = await callOpenAIUnderstandingV1(input, options(async () => response(200, JSON.stringify({
    model: "gpt-5.6-luna",
    status: "completed",
    output: [
      { type: "reasoning", content: [], encrypted_content: null, summary: [] },
      { type: "reasoning", content: [], encrypted_content: null, summary: [] },
      { type: "message", status: "completed", content: [{ type: "output_text", text: JSON.stringify(providerOutput()) }] }
    ]
  }))));
  assert.equal(reasoningResult.validatedUnits.length, 1);

  const reasoningWithoutContentResult = await callOpenAIUnderstandingV1(input, options(async () => response(200, JSON.stringify({
    model: "gpt-5.6-luna",
    status: "completed",
    output: [
      { id: "rs_safe", type: "reasoning", encrypted_content: null, summary: [] },
      { type: "message", status: "completed", content: [{ type: "output_text", text: JSON.stringify(providerOutput()) }] }
    ]
  }))));
  assert.equal(reasoningWithoutContentResult.validatedUnits.length, 1, "bounded Luna reasoning item may omit content");

  const reasoningOnlyError = await captureError(() => callOpenAIUnderstandingV1(
    input,
    options(async () => response(200, JSON.stringify({
      model: "gpt-5.6-luna", status: "completed", output: [{ type: "reasoning", content: [] }]
    })))
  ));
  assert.equal(reasoningOnlyError.code, "UNDERSTANDING_SCHEMA_INVALID");
  assert.equal(reasoningOnlyError[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].resolvedModel, "gpt-5.6-luna");

  for (const output of [
    [{ type: "reasoning", content: [] }],
    [{ type: "reasoning", content: [] },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(providerOutput()) }] },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(providerOutput()) }] }],
    [{ type: "reasoning", content: [] },
      { type: "message", content: [{ type: "refusal", refusal: "no" }] }],
    [{ type: "tool_call", content: [] },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(providerOutput()) }] }]
  ]) {
    const unsafeEnvelope = await captureError(() => callOpenAIUnderstandingV1(
      input,
      options(async () => response(200, JSON.stringify({
        model: "gpt-5.6-luna", status: "completed", output
      })))
    ));
    assert.equal(unsafeEnvelope.code, "UNDERSTANDING_SCHEMA_INVALID");
  }

  console.log(JSON.stringify({
    suite: "new-core-openai-adapter-contract",
    classification: "FAKE_INTEGRATION",
    provider: "STRUCTURED/FAKE",
    caseCount: 51,
    status: "PASS"
  }));
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
