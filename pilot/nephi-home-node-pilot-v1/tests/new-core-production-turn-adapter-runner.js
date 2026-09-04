"use strict";

const assert = require("node:assert/strict");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const {
  createNewCoreProductionTurnAdapter,
  bindProductionHistoryToCycles
} = require("../lib/new-core/production-turn-adapter");
const { formatNewCoreProductionTrace } = require("../lib/new-core/production-safe-trace");

const NOW = "2026-09-03T03:00:00.000Z";
const PROPERTY_A = Object.freeze({ propertyId: "property_a", timezone: "Asia/Taipei", rooms: [], propertyFacts: [], commonAnswers: {}, businessProfile: {} });
const PROPERTY_B = Object.freeze({ propertyId: "property_b", timezone: "Asia/Taipei", rooms: [], propertyFacts: [], commonAnswers: {}, businessProfile: {} });

function state(scope, revision = 1) {
  return createConversationStateV3({ ...scope, revision, tasks: [], createdAt: NOW, updatedAt: NOW, expiresAt: "2026-09-04T03:00:00.000Z" });
}

function result(action, nextState) {
  return {
    state: nextState,
    finalDecision: { action, reasonCode: `${action}_reason`, taskIds: [], missingFields: [], reviewRequired: action === "handoff" },
    finalResponse: { action, shouldReply: action !== "no_reply", replyText: action === "no_reply" ? "" : `${action} response` },
    traceId: "trace-from-core",
    artifacts: {
      canonicalItems: [{ requestCycleId: "cycle-answer" }],
      adapted: { taskCreations: [], canonicalTaskBindings: [] },
      executionOutcomes: []
    }
  };
}

function fixture({ executeTurn, providerConfig = { apiKey: "test-provider-key" }, diagnosticSink } = {}) {
  const stored = new Map();
  const writes = [];
  const historyCalls = [];
  const resolverCalls = [];
  const diagnostics = [];
  const persistence = {
    getConversationState(propertyId, channelId, lineUserId) {
      return stored.get(`${propertyId}:${channelId}:${lineUserId}`) || null;
    },
    setConversationState(propertyId, channelId, lineUserId, value) {
      writes.push({ propertyId, channelId, lineUserId, value });
      stored.set(`${propertyId}:${channelId}:${lineUserId}`, value);
      return value;
    },
    listRecentMessages(propertyId, channelId, lineUserId) {
      historyCalls.push({ propertyId, channelId, lineUserId });
      return [{
        eventId: "prior-event",
        eventTimestamp: "2026-09-03T02:55:00.000Z",
        guestMessage: "prior question",
        requestCycleRefs: []
      }];
    }
  };
  const customerSettings = {
    getProperty(propertyId) { return propertyId === "property_a" ? PROPERTY_A : propertyId === "property_b" ? PROPERTY_B : null; },
    listInventoryPriceOverrides(propertyId) { resolverCalls.push({ kind: "price", propertyId }); return []; },
    listDatePriceClassifications(propertyId) { resolverCalls.push({ kind: "dates", propertyId }); return []; }
  };
  const service = {
    searchAvailability(query) { resolverCalls.push({ kind: "availability", propertyId: query.customerId }); return { customerId: query.customerId, rooms: [] }; },
    searchAvailableDates(query) { resolverCalls.push({ kind: "availableDates", propertyId: query.customerId }); return { status: "answered", dates: [] }; }
  };
  const customReplies = { list(propertyId) { resolverCalls.push({ kind: "custom", propertyId }); return []; } };
  const adapter = createNewCoreProductionTurnAdapter({
    persistence,
    customerSettings,
    service,
    customReplies,
    providerConfig,
    publicBaseUrl: "https://example.invalid",
    now: () => new Date(NOW),
    executeTurn
    , onDiagnostic: diagnosticSink || ((entry) => diagnostics.push(entry))
  });
  return { adapter, stored, writes, historyCalls, resolverCalls, diagnostics };
}

function input(overrides = {}) {
  return {
    customerId: "property_a",
    channelId: "line-binding:abc",
    lineUserId: "line-user-a",
    eventId: "event-current",
    eventTimestamp: NOW,
    messageText: "guest message",
    ...overrides
  };
}

(async () => {
  const safeC01 = formatNewCoreProductionTrace({
    traceId: "trace-safe", stage: "new_core_c01", input: {
      propertyScope: { propertyId: "property_a", channel: "private-channel", userId: "private-user" },
      capabilityCatalog: ["availability"], publicSubjectCatalog: [{ catalogIdentity: "room301", kind: "room", publicName: "Private room name" }],
      sourceEvents: [{ eventId: "private-event", messageRef: "private-message", timestamp: NOW, messageKind: "text", messageText: "guest private text" }],
      recentConversation: [], referenceableCycles: []
    }
  });
  const serializedSafeC01 = JSON.stringify(safeC01);
  assert.equal(safeC01.sourceEvents[0].messageExcerpt, "guest private text",
    "the approved production trace policy must retain the complete bounded guest text");
  for (const forbidden of ["Private room name", "private-channel", "private-user", "private-event", "private-message", "Bearer ", "apiKey"]) {
    assert.equal(serializedSafeC01.includes(forbidden), false, `production trace leaked ${forbidden}`);
  }

  const safeRejection = formatNewCoreProductionTrace({
    traceId: "trace-safe", stage: "new_core_failure", failureCode: "UNDERSTANDING_SCHEMA_INVALID",
    schemaViolation: { validationErrorCode: "UNDERSTANDING_SCHEMA_INVALID", fieldPath: "understandingOutput.units.0.temporalCandidate.rawText", expected: "exact substring", actual: "string:not_grounded" },
    rejectedEvidence: {
      fieldPath: "understandingOutput.units.0.temporalCandidate.rawText", validationReason: "string:not_grounded", rejectedUnitIndex: 0,
      semantic: { purpose: "lodging_question", capability: "availability", subject: { kind: "room", catalogIdentity: "room401" }, confidenceBand: "high" },
      temporalCandidate: { rawText: "2026-09-23 Bearer must-not-leak", kind: "date_range", checkInCandidate: "2026-09-23", checkOutCandidate: "2026-09-25", nightsCandidate: 2 },
      evidenceRefs: [{ eventId: "private-event", messageRef: "private-message", startOffset: 5, endOffset: 15, quote: "2026/09/23 sk-must-not-leak", sourceExcerpt: "2026/09/23 sk-must-not-leak", quoteMatchesSource: true }],
      rawTextInSource: false, rawTextInEvidenceQuote: false
    }
  });
  assert.equal(safeRejection.rejectedEvidence.temporalCandidate.rawText.includes("2026-09-23"), true);
  assert.equal(safeRejection.rejectedEvidence.evidenceRefs[0].quote.includes("2026/09/23"), true);
  assert.deepEqual(safeRejection.rejectedEvidence.evidenceRefs[0], {
    eventRef: "h:cfbf5b0f7ca2c200808eaa80ac0575371f0da30ed268f91e5880a46f7813be67",
    messageRef: "h:02008a5273e2edf50966b15323284e4cb081497b17e707dced8db5ae58d811fb",
    startOffset: 5, endOffset: 15, quote: "2026/09/23 [REDACTED]", sourceExcerpt: "2026/09/23 [REDACTED]", quoteMatchesSource: true
  });
  for (const forbidden of ["must-not-leak", "private-event", "private-message", "Bearer ", "sk-"]) {
    assert.equal(JSON.stringify(safeRejection).includes(forbidden), false, `rejection trace leaked ${forbidden}`);
  }

  const safeC08ConstructionFailure = formatNewCoreProductionTrace({
    traceId: "trace-c08", stage: "new_core_c08", items: [{
      unitId: "private-unit-id",
      sourceItem: {
        capability: "availability",
        subject: { kind: "matched_room_set", catalogIdentity: "matched-room-set-safe" },
        temporalCandidate: { kind: "date_range", checkInCandidate: "2026-10-04", checkOutCandidate: "2026-10-05", nightsCandidate: 1 },
        verifiedSlotInputs: [],
        canonicalSet: []
      },
      creationResult: { ok: false, code: "CANONICAL_INPUT_INCOMPLETE", errors: ["semanticFields"],
        diagnostic: { semanticValidationErrors: ["stayDependent"], slotValidationErrors: [] } },
      input: null,
      result: null,
      failure: { layer: "C08", failureCode: "CANONICAL_INPUT_INCOMPLETE", errors: ["semanticFields"] }
    }]
  });
  assert.deepEqual(safeC08ConstructionFailure.items[0].sourceItem, {
    capability: "availability",
    subject: { kind: "matched_room_set", catalogIdentity: "matched-room-set-safe" },
    temporal: { kind: "date_range", resolutionStatus: "", checkIn: "2026-10-04", checkOut: "2026-10-05", searchFrom: "", searchTo: "", nights: 1, timezone: "" },
    canonicalSet: [],
    verifiedSlotInputs: []
  });
  assert.deepEqual(safeC08ConstructionFailure.items[0].validation, {
    semanticFields: false,
    verifiedSlotInputs: true,
    provenance: true,
    catalogProvenance: true,
    validationErrors: ["semanticFields"],
    failedPredicate: "semanticFields",
    fieldPath: "stayDependent",
    semanticValidationErrors: ["stayDependent"],
    slotValidationErrors: [],
    failureCode: "CANONICAL_INPUT_INCOMPLETE"
  });
  const safeC08Secret = formatNewCoreProductionTrace({
    traceId: "trace-c08-secret", stage: "new_core_c08", items: [{
      unitId: "private-unit-id",
      sourceItem: { capability: "availability", subject: null, temporalCandidate: null,
        canonicalSet: [], verifiedSlotInputs: [{ slot: "product", operation: "SET", value: "sk-c08-must-not-leak" }] },
      creationResult: { ok: false, code: "CANONICAL_INPUT_INCOMPLETE", errors: ["verifiedSlotInputs"] }
    }]
  });
  assert.match(safeC08Secret.items[0].sourceItem.verifiedSlotInputs[0].value, /^h:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(safeC08Secret).includes("sk-c08-must-not-leak"), false);

  const safeCoverage = formatNewCoreProductionTrace({
    traceId: "trace-coverage", stage: "new_core_c08", items: [{
      unitId: "unit-coverage",
      sourceItem: {
        capability: "availability",
        subject: { kind: "matched_room_set", catalogIdentity: "matched-room-set-safe" },
        temporalCandidate: { kind: "date_range", checkInCandidate: "2026-10-04", checkOutCandidate: "2026-10-05" },
        verifiedSlotInputs: [], canonicalSet: []
      },
      executionDiagnostic: {
        compatibilityMapping: {
          entity: { category: "room", canonicalCandidate: null },
          approvedProduct: { productType: "any", productId: null },
          temporal: { eventTimestamp: NOW, stayCandidate: { checkInCandidate: "2026-10-04", checkOutCandidate: "2026-10-05" } }
        },
        canonicalizerCalled: true,
        canonicalizerResult: { canonicalRequest: { taskId: "task-coverage", capability: "availability", canonicalEntity: { status: "matched_set", category: "room", canonicalSet: ["room-a", "room-b"] } } },
        canonicalSubject: { status: "matched_set", category: "room", canonicalSet: ["room-a", "room-b"] },
        canonicalSet: ["room-a", "room-b"], requiredFields: ["stay.checkIn"], missingFields: [],
        errors: [], failureCode: null, exactCondition: "SUCCESS"
      },
      result: { ok: true, value: { unitId: "unit-coverage", canonicalRequest: { taskId: "task-coverage", capability: "availability", canonicalEntity: { status: "matched_set", category: "room", canonicalSet: ["room-a", "room-b"] } } } }
    }]
  });
  assert.deepEqual(safeCoverage.items[0].execution.compatibilityMapping.approvedProduct,
    { productType: "any", productId: "", roomTypeId: "", bundleId: "" });
  assert.deepEqual(safeCoverage.items[0].execution.canonicalSet, ["room-a", "room-b"]);
  assert.equal(safeCoverage.items[0].execution.exactCondition, "SUCCESS");

  const safeUnsupported = formatNewCoreProductionTrace({
    traceId: "trace-unsupported", stage: "new_core_understanding", rawUnits: [{
      unitId: "unit-unsupported", purpose: "unknown", capability: "unsupported", subject: { kind: "property", catalogIdentity: "" },
      evidenceRefs: [{ eventId: "event-private", messageRef: "message-private", startOffset: 0, endOffset: 17,
        quote: "訂金規則 sk-secret-value", sourceExcerpt: "訂金規則 sk-secret-value" }]
    }], rawContextLinks: [], validatedUnits: [], failedUnits: [{ boundary: "C03", failureCode: "UNIT_MEANING_UNSUPPORTED" }], contextLinks: []
  });
  assert.equal(safeUnsupported.rawUnits[0].evidenceRefs[0].quote, "訂金規則 [REDACTED]");
  assert.equal(JSON.stringify(safeUnsupported).includes("sk-secret-value"), false);

  const safeResolver = formatNewCoreProductionTrace({
    traceId: "trace-resolver", stage: "new_core_resolver", requests: [{
      formalRequestId: "formal-a", taskId: "task-a", capability: "availability", operation: "availability_resolver", propertyId: "property_a",
      resolverTask: { propertyId: "property_a", taskType: "availability", productType: "room_type", productId: "room-a", checkIn: "2026-10-04", checkOut: "2026-10-05", guestCount: 2, roomTypeSet: ["room-a"] },
      conditions: { stay: { checkIn: "2026-10-04", checkOut: "2026-10-05", nights: 1 }, inventory: { mode: "room_only", entityId: "room-a", entityIds: ["room-a"] } },
      entity: { status: "resolved", category: "room", canonicalId: "room-a" }
    }], results: [{ taskId: "task-a", type: "availability", outcome: "answered", resolverAttempted: true,
      facts: { source: "availability_provider", propertyId: "property_a", checkIn: "2026-10-04", checkOut: "2026-10-05", availableRoomIds: ["room-a"] } }]
  });
  assert.deepEqual(safeResolver.requests[0].resolverTask, { propertyId: "property_a", taskType: "availability", productType: "room_type", productId: "room-a", checkIn: "2026-10-04", checkOut: "2026-10-05", guestCount: 2, searchFrom: "", searchTo: "", nights: null, roomTypeSet: ["room-a"] });
  assert.deepEqual(safeResolver.requests[0].inventory, { mode: "room_only", entityId: "room-a", entityIds: ["room-a"] });
  assert.equal(safeResolver.results[0].resolverAttempted, true);
  assert.deepEqual(safeResolver.results[0].facts.availableRoomIds, ["room-a"]);

  const safeFinal = formatNewCoreProductionTrace({ traceId: "trace-final", stage: "new_core_final",
    finalDecision: { action: "reply", reasonCode: "execution_answered", taskIds: ["task-a"], missingFields: [], reviewRequired: false },
    finalResponse: { action: "reply", shouldReply: true, replyText: "正式回答 Bearer top-secret sk-final-secret" } });
  assert.equal(safeFinal.finalResponse.replyText, "正式回答 [REDACTED] [REDACTED]");
  assert.equal(JSON.stringify(safeFinal).includes("top-secret"), false);

  const safeInbound = formatNewCoreProductionTrace({ traceId: "trace-inbound", stage: "line_inbound",
    propertyId: "property_a", channelHash: "channel-a", userHash: "user-a", eventHash: "event-a",
    guestMessage: "完整客人問題 test@example.com 0912-345-678 sk-inbound-secret" });
  assert.equal(safeInbound.guestMessage, "完整客人問題 [REDACTED] [REDACTED] [REDACTED]");
  const safeTransport = formatNewCoreProductionTrace({ traceId: "trace-line", stage: "line_transport",
    propertyId: "property_a", decision: "reply", reasonCode: "reply_failed", attempted: true, delivered: false,
    deliveryErrorCode: "line_reply_http_error_500", replyText: "【AI】回答 Bearer transport-secret" });
  assert.equal(safeTransport.replyText, "【AI】回答 [REDACTED]");
  assert.equal(safeTransport.deliveryErrorCode, "line_reply_http_error_500");

  const longGuestMessage = "完整問題".repeat(600);
  const longFinalResponse = "完整回覆".repeat(600);
  assert.equal(formatNewCoreProductionTrace({ stage: "line_inbound", guestMessage: longGuestMessage }).guestMessage,
    longGuestMessage, "bounded LINE-sized guest text must be retained in full");
  assert.equal(formatNewCoreProductionTrace({ stage: "new_core_final",
    finalResponse: { action: "reply", shouldReply: true, replyText: longFinalResponse } }).finalResponse.replyText,
    longFinalResponse, "bounded LINE-sized FinalResponse text must be retained in full");

  const safeState = formatNewCoreProductionTrace({ traceId: "trace-state", stage: "state_before", state: {
    revision: 7, tasks: [{ taskId: "task-a", type: "availability", status: "pending", missingFields: ["stay.checkIn"], knownFields: ["subject"], subject: { kind: "room", catalogIdentity: "room-a" } }]
  }, snapshot: { referenceableCycles: [{ requestCycleId: "cycle-a", requestKind: "availability", capability: "availability", status: "pending", subject: { kind: "room", catalogIdentity: "room-a" }, missingFields: ["stay.checkIn"], confirmedValues: { checkIn: "", checkOut: "", guestCount: null } }] } });
  assert.deepEqual(safeState.state.tasks[0].missingFields, ["stay.checkIn"]);
  assert.deepEqual(safeState.state.tasks[0].knownFields, ["subject"]);

  assert.doesNotThrow(() => fixture({
    providerConfig: {},
    executeTurn: async (args) => result("reply", state(args.scope, args.state.revision + 1))
  }), "an explicitly injected execution dependency must not require an unused OpenAI key");
  assert.throws(() => fixture({ providerConfig: {} }), /provider_api_key_required/,
    "default real execution must fail closed without an OpenAI key");
  assert.doesNotThrow(() => fixture({ providerConfig: { apiKey: "configured-production-key" } }),
    "default real execution may be constructed with a configured OpenAI key");

  const seen = [];
  const fx = fixture({ executeTurn: async (args) => {
    seen.push(args);
    args.resolver.priceOverrides();
    args.resolver.dateClassifications();
    args.resolver.customReplies();
    args.resolver.availability({ customerId: args.scope.propertyId });
    return result("reply", state(args.scope, args.state.revision + 1));
  } });
  const answer = await fx.adapter.process(input());
  assert.equal(answer.finalDecision.action, "reply");
  assert.equal(answer.finalResponse.replyText, "reply response");
  assert.deepEqual(answer.requestCycleRefs, ["cycle-answer"]);
  assert.equal(seen.length, 1, "one event must invoke exactly one new-core turn");
  assert.deepEqual(seen[0].scope, { propertyId: "property_a", channel: "line-binding:abc", userId: "line-user-a" });
  assert.equal(seen[0].property, PROPERTY_A);
  assert.equal(seen[0].input.message, "guest message");
  assert.equal(seen[0].input.sourceEvents[0].eventId, "event-current");
  assert.equal(seen[0].input.recentConversation[0].eventId, "prior-event");
  assert.equal(fx.writes.length, 1, "next ConversationStateV3 must be persisted once");
  assert.deepEqual(fx.resolverCalls.map((item) => item.propertyId), ["property_a", "property_a", "property_a", "property_a"]);
  assert.ok(fx.diagnostics.some((entry) => entry.stage === "line_inbound"));
  assert.ok(fx.diagnostics.some((entry) => entry.stage === "state_before"));
  assert.ok(fx.diagnostics.some((entry) => entry.stage === "new_core_final"));
  assert.equal(new Set(fx.diagnostics.map((entry) => entry.traceId)).size, 1,
    "one production turn must use one traceId across inbound, state, and result boundaries");

  for (const action of ["clarification", "handoff", "no_reply"]) {
    const current = fixture({ executeTurn: async (args) => result(action, state(args.scope, args.state.revision + 1)) });
    const output = await current.adapter.process(input());
    assert.equal(output.finalDecision.action, action);
    assert.equal(output.finalResponse.shouldReply, action !== "no_reply");
    assert.equal(current.writes.length, 1);
  }

  const failed = fixture({ executeTurn: async () => {
    const error = new Error("provider exploded");
    error.code = "UNDERSTANDING_PROVIDER_FAILURE";
    error.rejectedEvidence = safeRejection.rejectedEvidence;
    throw error;
  } });
  const safe = await failed.adapter.process(input());
  assert.equal(safe.finalDecision.action, "handoff");
  assert.equal(safe.finalDecision.reviewRequired, true);
  assert.equal(safe.finalResponse.action, "handoff");
  assert.equal(safe.finalResponse.shouldReply, true);
  assert.equal(failed.writes.length, 0, "runtime failure must not overwrite the prior state");
  assert.ok(failed.diagnostics.some((entry) => entry.stage === "new_core_failure"
    && entry.failureCode === "UNDERSTANDING_PROVIDER_FAILURE"
    && entry.rejectedEvidence.rawTextInEvidenceQuote === false));

  const traceFailure = fixture({
    diagnosticSink: () => { throw new Error("trace sink unavailable"); },
    executeTurn: async (args) => result("reply", state(args.scope, args.state.revision + 1))
  });
  const traceFailureResult = await traceFailure.adapter.process(input());
  assert.equal(traceFailureResult.finalDecision.action, "reply", "trace failure must not alter business decision");
  assert.equal(traceFailureResult.finalResponse.replyText, "reply response", "trace failure must not alter business response");

  const isolated = fixture({ executeTurn: async (args) => {
    assert.equal(args.scope.propertyId, "property_b");
    args.resolver.priceOverrides();
    args.resolver.customReplies();
    return result("reply", state(args.scope, args.state.revision + 1));
  } });
  await isolated.adapter.process(input({ customerId: "property_b", lineUserId: "line-user-b" }));
  assert.deepEqual(isolated.resolverCalls.map((item) => item.propertyId), ["property_b", "property_b"]);
  await assert.rejects(() => isolated.adapter.process(input({ customerId: "missing_property" })), (error) => error && error.code === "PROPERTY_NOT_FOUND");

  const history = bindProductionHistoryToCycles([
    { eventId: "event-a", eventTimestamp: NOW, guestMessage: "hello", requestCycleRefs: ["cycle-a", "cycle-other"] },
    { eventId: "event-b", eventTimestamp: NOW, guestMessage: "", requestCycleRefs: ["cycle-a"] }
  ], [{ requestCycleId: "cycle-a" }]);
  assert.deepEqual(history, [{
    eventId: "event-a",
    messageRef: "event-a",
    role: "guest",
    timestamp: NOW,
    messageKind: "text",
    messageText: "hello",
    referenceableCycleIds: ["cycle-a"]
  }]);

  process.stdout.write("new-core production turn adapter: 24/24 PASS\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
