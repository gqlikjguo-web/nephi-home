"use strict";

const assert = require("node:assert/strict");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const {
  OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC,
  callOpenAIUnderstandingV1
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
        status: "active",
        expiresAt: "2026-08-30T08:00:00.000Z",
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
    replyCandidate: { disposition: "NO_REPLY", reasonClass: "acknowledgement" },
    slotCandidates: [],
    confidenceBand: "high",
    ...overrides
  };
}

function link(overrides = {}) {
  return {
    contextLinkCandidateId: "link-a",
    unitId: "unit-a",
    actionCandidate: "NONE",
    targetRequestCycleId: null,
    evidenceRefs: [evidence()],
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

function response(status, body, requestId = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === "x-request-id" ? requestId : null },
    text: async () => String(body)
  };
}

function successfulResponse(value = providerOutput(), requestId = "req-understanding-a") {
  return response(200, JSON.stringify({ output_text: JSON.stringify(value) }), requestId);
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
    model: "gpt-4.1-mini",
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
  assert.equal(body.model, "gpt-4.1-mini");
  assert.equal(Object.hasOwn(body, "temperature"), false);
  assert.equal(Object.hasOwn(body, "top_p"), false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "junzan_understanding_v1");
  assert.equal(body.text.format.strict, true);
  strictObjectAudit(body.text.format.schema);
  assert.deepEqual(body.text.format.schema.required.sort(), ["contextLinkCandidates", "understandingOutput"]);
  assert.deepEqual(
    body.text.format.schema.properties.understandingOutput.required.sort(),
    ["schemaVersion", "turnId", "units"]
  );
  assert.deepEqual(
    body.text.format.schema.properties.understandingOutput.properties.units.items.required.sort(),
    ["capability", "confidenceBand", "contextLinkCandidateId", "evidenceRefs", "purpose", "replyCandidate", "slotCandidates", "stayDependent", "subject", "temporalCandidate", "unitId"].sort()
  );
  assert.deepEqual(
    body.text.format.schema.properties.contextLinkCandidates.items.required.sort(),
    ["actionCandidate", "contextLinkCandidateId", "evidenceRefs", "targetRequestCycleId", "unitId"].sort()
  );
  assert.deepEqual(
    body.text.format.schema.properties.understandingOutput.properties.units.items.properties.evidenceRefs.items.required.sort(),
    ["endOffset", "eventId", "messageRef", "quote", "startOffset"].sort()
  );
  assert.equal(JSON.stringify(body.input).includes("must-not-leak"), false);
  assert.deepEqual(
    JSON.parse(body.input[1].content[0].text),
    input,
    "the sole provider developer input must be exact bounded C01"
  );
  assert.deepEqual(result.understandingOutput, providerOutput().understandingOutput);
  assert.deepEqual(result.contextLinkCandidates, providerOutput().contextLinkCandidates);
  assert.equal(result.validatedUnits.length, 1);
  assert.equal(result.validatedContextLinks.length, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.understandingOutput), true);
  assert.deepEqual(diagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C03_SEMANTIC_UNIT_VALIDATED",
    "C05_CONTEXT_LINK_VALIDATED"
  ]);
  assert.equal(result[OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC].providerAttemptCount, 1);

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
  const semanticError = await captureError(() => callOpenAIUnderstandingV1(input, options(async () => {
    semanticCalls += 1;
    return successfulResponse(providerOutput({
      understandingOutput: {
        ...providerOutput().understandingOutput,
        units: [unit({
          purpose: "lodging_question",
          capability: "availability",
          subject: { kind: "property", catalogIdentity: "property-a" },
          stayDependent: true,
          replyCandidate: { disposition: "ANSWER", reasonClass: "lodging_need" }
        })]
      }
    }));
  }, { onDiagnostic: (event) => semanticDiagnostics.push(event) })));
  assert.equal(semanticCalls, 1);
  assert.equal(semanticError.code, "CAPABILITY_SUBJECT_CONFLICT");
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
  const duplicateLinkError = await captureError(() => callOpenAIUnderstandingV1(input, options(async () => {
    duplicateLinkCalls += 1;
    return successfulResponse(providerOutput({
      contextLinkCandidates: [link(), link({ unitId: "unit-b" })]
    }));
  }, { onDiagnostic: (event) => duplicateLinkDiagnostics.push(event) })));
  assert.equal(duplicateLinkCalls, 1);
  assert.equal(duplicateLinkError.code, "CONTEXT_LINK_DUPLICATE");
  assert.deepEqual(duplicateLinkDiagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C03_SEMANTIC_UNIT_VALIDATED",
    "C05_CONTEXT_LINK_REJECTED"
  ]);
  assert.equal(duplicateLinkDiagnostics.at(-1).inputUnitIds.length, 2, "C05 diagnostics must retain unit IDs from both C02 and the duplicate C05 collection");

  // A duplicate link owned by another unit retains that unit's evidence and
  // diagnostic attribution; matching only the shared link ID would blame the
  // C02 unit for the foreign C05 evidence failure.
  const foreignLinkDiagnostics = [];
  const foreignLinkError = await captureError(() => callOpenAIUnderstandingV1(input, options(async () =>
    successfulResponse(providerOutput({
      contextLinkCandidates: [
        link(),
        link({ unitId: "unit-b", evidenceRefs: [evidence({ quote: "不存在" })] })
      ]
    })), { onDiagnostic: (event) => foreignLinkDiagnostics.push(event) })));
  assert.equal(foreignLinkError.code, "EVIDENCE_QUOTE_MISMATCH");
  assert.deepEqual(foreignLinkDiagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C04_SOURCE_EVIDENCE_REJECTED"
  ]);
  assert.notEqual(
    foreignLinkDiagnostics.at(-1).inputUnitIds[0],
    foreignLinkDiagnostics[0].inputUnitIds[0],
    "the C04 failure must identify foreign C05 unit-b rather than C02 unit-a"
  );

  // C04 and C05 own their own fail-closed boundary codes and markers, with no
  // provider resampling after a parseable response.
  const evidenceDiagnostics = [];
  const evidenceError = await captureError(() => callOpenAIUnderstandingV1(input, options(async () =>
    successfulResponse(providerOutput({
      understandingOutput: {
        ...providerOutput().understandingOutput,
        units: [unit({ evidenceRefs: [evidence({ quote: "不存在" })] })]
      }
    })), { onDiagnostic: (event) => evidenceDiagnostics.push(event) })));
  assert.equal(evidenceError.code, "EVIDENCE_QUOTE_MISMATCH");
  assert.deepEqual(evidenceDiagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_REJECTED"
  ]);
  const contextDiagnostics = [];
  const contextError = await captureError(() => callOpenAIUnderstandingV1(input, options(async () =>
    successfulResponse(providerOutput({
      contextLinkCandidates: [link({ actionCandidate: "CONTINUE", targetRequestCycleId: "cycle-missing" })]
    })), { onDiagnostic: (event) => contextDiagnostics.push(event) })));
  assert.equal(contextError.code, "CONTEXT_TARGET_UNAVAILABLE");
  assert.deepEqual(contextDiagnostics.map((event) => event.targetMarker), [
    "C02_UNDERSTANDING_RECEIVED",
    "C04_SOURCE_EVIDENCE_VALIDATED",
    "C03_SEMANTIC_UNIT_VALIDATED",
    "C05_CONTEXT_LINK_REJECTED"
  ]);

  // Refusal, outer response parse failure, provider schema failure, and local
  // contract failure are non-transport failures. Each stops after one call.
  const nonRetryableCases = [
    ["refusal", async () => response(200, JSON.stringify({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })), "UNDERSTANDING_SCHEMA_INVALID"],
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

  console.log(JSON.stringify({
    suite: "new-core-openai-adapter-contract",
    classification: "FAKE_INTEGRATION",
    provider: "STRUCTURED/FAKE",
    caseCount: 19,
    status: "PASS"
  }));
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
