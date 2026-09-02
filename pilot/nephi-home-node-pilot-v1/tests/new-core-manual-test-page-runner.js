"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const manualTestService = require("../lib/new-core/manual-test-service");
const { bindRecentConversationToCycles, buildManualTestFailureDiagnostics, noExecutionDecision, normalizeManualTestFailureRefs, turnStateSnapshot } = manualTestService;
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { resolveEntity } = require("../lib/conversation-engine-v2/entity-resolver");
const { aggregateUnitOutcomes } = require("../lib/new-core/unit-aggregator");
const { publicAvailabilityUrlForProperty } = require("../lib/public-property-routing");

const root = path.resolve(__dirname, "..");
const now = () => new Date("2026-08-29T12:00:00.000Z");
let calls = 0;
const historyLengths = [];
let factsPropertyName = "";
let observedPublicBaseUrl = "";

function nextState(state, timestamp) {
  calls += 1;
  return state;
}

async function fakeTurn({ input, state, property, publicBaseUrl, sideEffectGuard, now: timestamp }) {
  factsPropertyName = property.displayName;
  observedPublicBaseUrl = publicBaseUrl;
  historyLengths.push(input.recentConversation.length);
  if (input.message === "provider failure") { const error = new Error("failed"); error.code = "UNDERSTANDING_PROVIDER_FAILURE"; throw error; }
  if (input.message === "side effect") sideEffectGuard.lineSend();
  if (input.message === "diagnostic failure") return {
    state, understanding: { summary: "", units: [] }, lifecycle: [], routing: [],
    resolver: { name: "existing canonical Resolver", foundOfficialData: false, status: "NOT_APPLICABLE" },
    finalDecision: { action: "no_reply", reasonCode: "new_core_no_reply", taskIds: [], missingFields: [], reviewRequired: false, executionSummary: {} },
    finalResponse: { action: "no_reply", shouldReply: false, replyText: "" },
    earliestFailure: { layer: "C03", failureCode: "CAPABILITY_SUBJECT_CONFLICT" },
    failedUnitDiagnostics: [{
      unitId: "unit-diagnostic", purpose: "lodging_question", capability: "availability",
      subject: { kind: "room", catalogIdentity: null }, temporalCandidate: { rawText: "8/31", kind: "partial", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null },
      safetyCandidate: null, readiness: null,
      failureCodes: { C03: "CAPABILITY_SUBJECT_CONFLICT", C06: null, C07: null },
      earliestFailure: { layer: "C03", failureCode: "CAPABILITY_SUBJECT_CONFLICT" }
    }],
    c08Diagnostics: [{
      unitId: "unit-diagnostic",
      input: { capability: "availability", subject: { kind: "room", catalogIdentity: "room302" }, productSlots: [], groundingEvidence: [] },
      compatibilityMapping: { context: { ok: true, cycle: null }, entity: null, approvedProduct: { productType: "room_type", productId: "room302", roomTypeId: "room302", bundleId: null }, sources: [], temporal: {}, guestOperation: null },
      canonicalizerCalled: false, canonicalizerResult: null, canonicalSubject: null, canonicalSet: [], requiredFields: [], missingFields: [], errors: ["compatibilityMapping", "entity"], failureCode: "CANONICAL_INPUT_INCOMPLETE", exactCondition: "compatibilityMapping:entity"
    }],
    contextRelationDiagnostics: {
      traceId: input.traceId,
      candidates: [{
        contextLinkCandidateId: "link-diagnostic", unitId: "unit-diagnostic",
        relationKind: "SUPPLEMENT", resolvedTargetRequestCycleId: "pending-price-bundle",
        currentSourceEvidenceRefs: [{ eventId: input.turnId, messageRef: input.turnId, startOffset: 0, endOffset: 2, quote: "測試" }],
        referencedHistoryEventRefs: [{ eventId: "event-history", messageRef: "message-history" }]
      }],
      referenceableCycles: [{
        requestCycleId: "pending-price-bundle", status: "pending", capability: "price",
        subject: { kind: "bundle", catalogIdentity: "bundle_all" }
      }]
    },
    requestedModel: "gpt-5.6-luna", resolvedModel: "gpt-5.6-luna"
  };
  const continuation = calls > 0;
  return { state: nextState(state, timestamp), understanding: { summary: continuation ? "補充日期，承接正式 pending cycle" : "詢問包棟價格，缺日期", units: [{ purpose: "lodging_question", capability: "price", subject: { kind: "bundle", catalogIdentity: "bundle_all" } }] }, lifecycle: [continuation ? "CONTINUE" : "START"], routing: [continuation ? "ANSWER" : "CLARIFY"], resolver: { name: "existing canonical Resolver", foundOfficialData: continuation, status: continuation ? "answered" : "NOT_APPLICABLE" }, finalDecision: continuation ? { action: "reply", reasonCode: "execution_answered", taskIds: ["formal-cycle-1"], missingFields: [], reviewRequired: false, executionSummary: {} } : { action: "clarification", reasonCode: "missing_information", taskIds: ["formal-cycle-1"], missingFields: ["checkIn", "checkOut"], reviewRequired: false, executionSummary: { notReadyTaskIds: ["formal-cycle-1"] } }, finalResponse: continuation ? { action: "reply", shouldReply: true, replyText: "正式資料預計回覆" } : { action: "clarification", shouldReply: true, replyText: "請提供入住日期。" }, earliestFailure: null, requestedModel: "gpt-5.6-luna", resolvedModel: "gpt-5.6-luna",
    stateTransitionDiagnostics: {
      traceId: input.traceId,
      c09Outcomes: [{ unitId: "unit-start", purpose: "lodging_question", capability: "price", subject: { kind: "bundle", catalogIdentity: "bundle_all" }, lifecycle: { action: continuation ? "CONTINUE" : "START", targetRequestCycleId: continuation ? "formal-cycle-1" : null }, routing: { disposition: continuation ? "ANSWER" : "CLARIFY", requiresCanonicalExecution: continuation, missingGuestFields: continuation ? [] : ["stay.checkIn", "stay.checkOut"] }, canonicalItemPresent: continuation, failureCode: null }],
      taskCreations: continuation ? [] : [{ unitId: "unit-start", taskIdCandidate: "unit-start", capability: "price", productType: "bundle", productId: "bundle_all", expectedStatus: "needs_clarification", missingFields: ["checkIn", "checkOut"] }],
      taskCreationCount: continuation ? 0 : 1,
      reducerTaskCreationInputCount: continuation ? 0 : 1,
      lifecycleOperationCount: 0,
      reducerInputTaskCount: continuation ? 1 : 0,
      reducerOutputTaskCount: continuation ? 1 : 1,
      zeroCreationReason: continuation ? { reason: "NO_START_CLARIFY_OUTCOME", failureCode: null } : null
    }
  };
}

async function json(url, method = "GET", body, sentCookie = "") {
  const response = await fetch(url, { method, headers: { ...(sentCookie ? { cookie: sentCookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json(); return { status: response.status, body: payload };
}

(async () => {
  assert.equal(typeof noExecutionDecision, "function", "the no-execution FinalDecision boundary must be contract-testable");
  const failedUnitRefs = Object.freeze([Object.freeze({ unitId: "unit-failed", failureCode: "UNIT_MEANING_UNSUPPORTED" })]);
  assert.equal(noExecutionDecision([], ["NO_REPLY"], [], failedUnitRefs).action, "no_reply",
    "a formal C07 NO_REPLY disposition remains authoritative");
  const failedOnlyDecision = noExecutionDecision([], [], [], failedUnitRefs);
  assert.equal(failedOnlyDecision.action, "handoff",
    "failed units without a formal disposition must use the existing FinalDecision handoff authority");
  assert.equal(failedOnlyDecision.reasonCode, "UNIT_MEANING_UNSUPPORTED");
  assert.equal(noExecutionDecision([], ["ANSWER"], [], []).action, "no_reply",
    "an ANSWER disposition without execution cannot fabricate an answer");
  assert.equal(noExecutionDecision([], ["CLARIFY"], ["stay.checkIn"], []).action, "clarification");
  assert.equal(noExecutionDecision([], ["HANDOFF"], [], []).action, "handoff");
  assert.equal(typeof manualTestService.buildManualTestPublicCatalog, "function",
    "manual-test C01 must expose its formal public catalog projection for contract verification");
  assert.equal(typeof manualTestService.buildManualTestCanonicalizerCatalog, "function",
    "manual-test C08 must expose its C01-derived trusted catalog projection for contract verification");
  const locationProperty = {
    propertyId: "property-location", timezone: "Asia/Taipei", rooms: [], propertyFacts: [], commonAnswers: {},
    businessProfile: { address: "approved address", googleMapsUrl: "https://maps.app.goo.gl/AbCdEf123456" }
  };
  const locationCatalog = buildPropertyCatalog(locationProperty);
  const locationC01Catalog = manualTestService.buildManualTestPublicCatalog(locationProperty, locationCatalog);
  assert.deepEqual(locationC01Catalog.publicSubjectCatalog.find((item) => item.catalogIdentity === "location"), {
    catalogIdentity: "location", kind: "external_place", propertyId: "property-location", publicName: "位置與導航"
  });
  const locationC08Catalog = manualTestService.buildManualTestCanonicalizerCatalog({
    propertyScope: { propertyId: "property-location" }, propertyTimezone: "Asia/Taipei",
    publicSubjectCatalog: locationC01Catalog.publicSubjectCatalog
  });
  assert.deepEqual(locationC08Catalog.policies.find((item) => item.canonicalId === "location"), {
    canonicalId: "location", category: "transport", publicName: "位置與導航"
  }, "the C01-derived C08 catalog must preserve the formal transport category");
  const roomGroupProperty = {
    propertyId: "property-room-groups", timezone: "Asia/Taipei", commonAnswers: {},
    rooms: [
      { id: "double-a", name: "A", type: "雙人房", capacity: 2, aliases: ["雙人房"], enabled: true },
      { id: "double-b", name: "B", type: "雙人房", capacity: 2, aliases: ["雙人房"], enabled: true },
      { id: "quad-a", name: "C", type: "四人房", capacity: 4, aliases: ["四人房"], enabled: true },
      { id: "quad-b", name: "D", type: "四人房", capacity: 4, aliases: ["四人房"], enabled: true },
      { id: "quad-disabled", name: "Disabled", type: "四人房", capacity: 4, aliases: ["四人房"], enabled: false },
      { id: "bundle-all", name: "Bundle", type: "四人房", inventoryType: "bundle", enabled: true }
    ]
  };
  const roomGroupOfficialCatalog = buildPropertyCatalog(roomGroupProperty);
  const roomGroupC01Catalog = manualTestService.buildManualTestPublicCatalog(roomGroupProperty, roomGroupOfficialCatalog);
  assert.deepEqual(roomGroupC01Catalog.publicSubjectCatalog
    .filter((item) => item.kind === "matched_room_set")
    .map((item) => item.publicName).sort(), ["四人房", "雙人房"],
  "C01 must publish property-scoped identities for formal repeated room types");
  const roomGroupC08Catalog = manualTestService.buildManualTestCanonicalizerCatalog({
    propertyScope: { propertyId: roomGroupProperty.propertyId },
    propertyTimezone: roomGroupProperty.timezone,
    publicSubjectCatalog: roomGroupC01Catalog.publicSubjectCatalog
  }, roomGroupOfficialCatalog);
  const matchedQuad = resolveEntity(roomGroupC08Catalog, {
    category: "room", rawText: "四人房", canonicalCandidate: null
  });
  assert.equal(matchedQuad.status, "matched_set",
    "the C01-derived trusted C08 catalog must retain formal grouping metadata");
  assert.deepEqual(matchedQuad.entities.map((item) => item.canonicalId).sort(), ["quad-a", "quad-b"]);
  assert.equal(roomGroupC08Catalog.rooms.some((item) => item.canonicalId === "quad-disabled"), false);
  assert.equal(matchedQuad.entities.some((item) => item.canonicalId === "bundle-all"), false);
  assert.equal(publicAvailabilityUrlForProperty("https://test.example/", {
    propertyId: "property-a", businessProfile: { publicSlug: "property-public" }
  }), "https://test.example/propertypublic");
  const pendingState = {
    scope: { propertyId: "nephi_home", channel: "new-core-manual-test", userId: "manual-test:test" },
    tasks: [{
      taskId: "pending-price-bundle", taskType: "pricing", productType: "bundle", productId: "bundle_all",
      roomTypeId: null, bundleId: "bundle_all", checkIn: null, checkOut: null, guestCount: 4,
      searchFrom: null, searchTo: null, entityId: "bundle_all", entityCategory: "bundle", detailIntent: "general",
      knownFields: ["guestCount", "productId"], missingFields: ["checkIn", "checkOut"], status: "needs_clarification",
      createdAt: "2026-08-29T11:59:00.000Z", updatedAt: "2026-08-29T11:59:00.000Z", expiresAt: "2026-08-30T11:59:00.000Z"
    }]
  };
  const pendingSnapshot = turnStateSnapshot(pendingState, pendingState.scope, "2026-08-29T12:00:00.000Z");
  assert.deepEqual(pendingSnapshot.referenceableCycles[0], {
    requestCycleId: "pending-price-bundle", requestKind: "pricing", capability: "price", status: "pending",
    expiresAt: "2026-08-30T11:59:00.000Z", subject: { kind: "bundle", catalogIdentity: "bundle_all" },
    missingFields: ["checkIn", "checkOut"],
    confirmedValues: { checkIn: null, checkOut: null, guestCount: 4, searchFrom: null, searchTo: null },
    slotRefs: ["guestCount", "productId"]
  });
  const answeredLocationState = {
    scope: pendingState.scope,
    tasks: [{
      taskId: "answered-location", taskType: "location", productType: "any", productId: null,
      roomTypeId: null, bundleId: null, checkIn: null, checkOut: null, guestCount: null,
      searchFrom: null, searchTo: null, entityId: "location", entityCategory: "transport", detailIntent: "general",
      knownFields: [], missingFields: [], status: "answered",
      createdAt: "2026-08-29T11:59:00.000Z", updatedAt: "2026-08-29T11:59:00.000Z", expiresAt: "2026-08-30T11:59:00.000Z"
    }]
  };
  const answeredLocationSnapshot = turnStateSnapshot(answeredLocationState, answeredLocationState.scope, "2026-08-29T12:00:00.000Z");
  assert.equal(answeredLocationSnapshot.referenceableCycles[0].subject.kind, "external_place",
    "an answered location task must project the formal C01 external_place subject kind on the next turn");
  const boundHistory = bindRecentConversationToCycles([{ turnId: "prior-turn", timestamp: "2026-08-29T11:59:00.000Z", input: "想了解包棟價格" }], pendingState, pendingSnapshot.referenceableCycles);
  assert.deepEqual(boundHistory[0].referenceableCycleIds, ["pending-price-bundle"]);

  const mappedFailures = normalizeManualTestFailureRefs([
    { unitId: "unit-availability", failureCode: "ROUTE_PURPOSE_CONFLICT" },
    { unitId: "unit-availability", failureCode: "ROUTE_PURPOSE_CONFLICT" }
  ]);
  assert.deepEqual(mappedFailures, [
    { unitId: "unit-availability", failureCode: "ROUTE_PURPOSE_CONFLICT" }
  ]);
  assert.equal(Object.isFrozen(mappedFailures), true);
  assert.equal(Object.isFrozen(mappedFailures[0]), true);
  const mappedAggregation = aggregateUnitOutcomes({
    turnId: "turn-manual-upstream-failure",
    validatedUnits: [],
    lifecycleDecisions: [],
    routingDecisions: [],
    failedUnits: mappedFailures
  });
  assert.equal(mappedAggregation.ok, true, mappedAggregation.code);
  assert.equal(mappedAggregation.value.failedUnits[0].failureCode, "ROUTE_PURPOSE_CONFLICT");

  const failedUnit = {
    unitId: "unit-availability", evidenceRefs: [], purpose: "lodging_question", capability: "availability",
    subject: { kind: "property", catalogIdentity: null }, stayDependent: true,
    temporalCandidate: { rawText: "今天", kind: "relative_date", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null },
    contextLinkCandidateId: "link-availability", safetyCandidate: null,
    slotCandidates: [], confidenceBand: "high"
  };
  const failureDiagnostics = buildManualTestFailureDiagnostics({
    understanding: {
      understandingOutput: { schemaVersion: 1, turnId: "turn-failure", units: [failedUnit] },
      failedUnits: []
    },
    outcomes: [{
      unit: failedUnit,
      readiness: { unitId: "unit-availability", status: "READY", missingGuestFields: [] },
      failure: { layer: "C07", failureCode: "ROUTING_READINESS_INVALID" }
    }]
  });
  assert.deepEqual(failureDiagnostics, [{
    unitId: "unit-availability",
    purpose: "lodging_question",
    capability: "availability",
    subject: { kind: "property", catalogIdentity: null },
    temporalCandidate: { rawText: "今天", kind: "relative_date", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null },
    safetyCandidate: null,
    readiness: { status: "READY", missingGuestFields: [] },
    failureCodes: { C03: null, C06: null, C07: "ROUTING_READINESS_INVALID" },
    earliestFailure: { layer: "C07", failureCode: "ROUTING_READINESS_INVALID" }
  }]);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-manual-page-"));
  const providers = createJsonProviders({ dataFile: path.join(temp, "data.json"), seedFile: path.join(root, "fixtures/seed.json"), now });
  const factsProviders = createJsonProviders({ dataFile: path.join(temp, "facts-data.json"), seedFile: path.join(root, "fixtures/seed.json"), now });
  const demoProperty = providers.customerSettings.getProperty("demo_homestay_a");
  const originalGetProperty = providers.customerSettings.getProperty.bind(providers.customerSettings);
  providers.customerSettings.getProperty = (id) => id === "nephi_home" ? { ...demoProperty, propertyId: "nephi_home" } : originalGetProperty(id);
  const factsDemoProperty = factsProviders.customerSettings.getProperty("demo_homestay_a");
  const factsOriginalGetProperty = factsProviders.customerSettings.getProperty.bind(factsProviders.customerSettings);
  factsProviders.customerSettings.getProperty = (id) => id === "nephi_home" ? { ...factsDemoProperty, propertyId: "nephi_home", displayName: "正式 facts authority" } : factsOriginalGetProperty(id);
  providers.persistence.getAdminSession = async (hash) => hash && hash.length === 64 ? { userId: "admin-owner", propertyId: "nephi_home", username: "owner", properties: [{ propertyId: "nephi_home" }] } : null;
  const app = createApp({ providers, newCoreManualTestFactsProviders: factsProviders, adminAuthRequired: true, testOnlyEnvironment: true, now, runtimeEnv: { OPENAI_API_KEY: Array(33).join("x") }, publicBrandEnv: { PUBLIC_BASE_URL: "https://test.example" }, newCoreManualTestExecuteTurn: fakeTurn, lineBindingEnv: {} });
  const running = await app.start(0, "127.0.0.1");
  try {
    const page = await fetch(`${running.url}/admin/new-core-test`); assert.equal(page.status, 200); const html = await page.text(); assert.match(html, /JunZan AI 新核心測試/); assert.match(html, /gpt-5\.6-luna/); assert.doesNotMatch(html, /model.*select/iu);
    const adminPage = await fetch(`${running.url}/admin`); assert.equal(adminPage.status, 200); assert.match(await adminPage.text(), /業者登入/, "the normal admin page must remain a login surface");
    const adminSessionDenied = await json(`${running.url}/api/admin/session`); assert.equal(adminSessionDenied.status, 401, "test-only public manual test access must not bypass other admin APIs");
    const forged = await json(`${running.url}/api/admin/new-core-test/sessions`, "POST", { propertyId: "other" }); assert.equal(forged.status, 403);
    const created = await json(`${running.url}/api/admin/new-core-test/sessions`, "POST", {}); assert.equal(created.status, 201, JSON.stringify(created.body)); const id = created.body.data.testSessionId; assert.match(id, /^[0-9a-f-]{36}$/i);
    const diagnosticFailure = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "diagnostic failure" }); assert.equal(diagnosticFailure.status, 201, JSON.stringify(diagnosticFailure.body));
    assert.deepEqual(diagnosticFailure.body.data.diagnostic.failedUnits[0], {
      unitId: "unit-diagnostic", purpose: "lodging_question", capability: "availability",
      subject: { kind: "room", catalogIdentity: null }, temporalCandidate: { rawText: "8/31", kind: "partial", checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null },
      safetyCandidate: null, readiness: null,
      failureCodes: { C03: "CAPABILITY_SUBJECT_CONFLICT", C06: null, C07: null },
      earliestFailure: { layer: "C03", failureCode: "CAPABILITY_SUBJECT_CONFLICT" }
    });
    assert.deepEqual(diagnosticFailure.body.data.diagnostic.c08, [{
      unitId: "unit-diagnostic",
      input: { capability: "availability", subject: { kind: "room", catalogIdentity: "room302" }, productSlots: [], groundingEvidence: [] },
      compatibilityMapping: { context: { ok: true, cycle: null }, entity: null, approvedProduct: { productType: "room_type", productId: "room302", roomTypeId: "room302", bundleId: null }, sources: [], temporal: {}, guestOperation: null },
      canonicalizerCalled: false, canonicalizerResult: null, canonicalSubject: null, canonicalSet: [], requiredFields: [], missingFields: [], errors: ["compatibilityMapping", "entity"], failureCode: "CANONICAL_INPUT_INCOMPLETE", exactCondition: "compatibilityMapping:entity"
    }]);
    assert.deepEqual(diagnosticFailure.body.data.diagnostic.contextRelations, {
      traceId: diagnosticFailure.body.data.traceId,
      candidates: [{
        contextLinkCandidateId: "link-diagnostic", unitId: "unit-diagnostic",
        relationKind: "SUPPLEMENT", resolvedTargetRequestCycleId: "pending-price-bundle",
        currentSourceEvidenceRefs: [{ eventId: diagnosticFailure.body.data.turnId, messageRef: diagnosticFailure.body.data.turnId, startOffset: 0, endOffset: 2, quote: "測試" }],
        referencedHistoryEventRefs: [{ eventId: "event-history", messageRef: "message-history" }]
      }],
      referenceableCycles: [{
        requestCycleId: "pending-price-bundle", status: "pending", capability: "price",
        subject: { kind: "bundle", catalogIdentity: "bundle_all" }
      }]
    });
    const persistedDiagnostic = await json(`${running.url}/api/admin/new-core-test/records/${diagnosticFailure.body.data.traceId}`);
    assert.deepEqual(persistedDiagnostic.body.data.diagnostic.failedUnits, diagnosticFailure.body.data.diagnostic.failedUnits);
    assert.deepEqual(persistedDiagnostic.body.data.diagnostic.c08, diagnosticFailure.body.data.diagnostic.c08);
    const first = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "想了解包棟價格" }); assert.equal(first.status, 201, JSON.stringify(first.body)); assert.equal(first.body.data.diagnostic.context[0], "START"); assert.equal(first.body.data.diagnostic.finalResponse.action, "clarification");
    assert.deepEqual(first.body.data.diagnostic.stateTransition, {
      traceId: first.body.data.traceId,
      c09Outcomes: [{ unitId: "unit-start", purpose: "lodging_question", capability: "price", subject: { kind: "bundle", catalogIdentity: "bundle_all" }, lifecycle: { action: "START", targetRequestCycleId: null }, routing: { disposition: "CLARIFY", requiresCanonicalExecution: false, missingGuestFields: ["stay.checkIn", "stay.checkOut"] }, canonicalItemPresent: false, failureCode: null }],
      taskCreations: [{ unitId: "unit-start", taskIdCandidate: "unit-start", capability: "price", productType: "bundle", productId: "bundle_all", expectedStatus: "needs_clarification", missingFields: ["checkIn", "checkOut"] }],
      taskCreationCount: 1,
      reducerTaskCreationInputCount: 1,
      lifecycleOperationCount: 0,
      reducerInputTaskCount: 0,
      reducerOutputTaskCount: 1,
      zeroCreationReason: null
    });
    assert.equal(factsPropertyName, "正式 facts authority", "manual test must read property facts from the dedicated facts authority");
    assert.equal(observedPublicBaseUrl, "https://test.example", "manual test must receive the existing runtime public URL authority");
    const second = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "9/20" }); assert.equal(second.status, 201); assert.equal(second.body.data.diagnostic.context[0], "CONTINUE"); assert.equal(second.body.data.predictedResponse, "正式資料預計回覆");
    assert.deepEqual(second.body.data.diagnostic.sideEffectCounters, { LINE_SEND: 0, PRODUCTION_STATE_WRITE: 0, PRODUCTION_MESSAGE_WRITE: 0, PRODUCTION_REVIEW_WRITE: 0, BOOKING_MUTATION: 0, FACTS_PROPERTY_MUTATION: 0 });
    const injected = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "x", model: "gpt-4.1-mini" }); assert.equal(injected.status, 400);
    const reviewed = await json(`${running.url}/api/admin/new-core-test/turns/${second.body.data.turnId}/review`, "PATCH", { status: "PROBLEM", problemCategory: "Context承接錯", note: "人工備註" }); assert.equal(reviewed.status, 200); assert.equal(reviewed.body.data.manualReview.status, "PROBLEM");
    const records = await json(`${running.url}/api/admin/new-core-test/records?filter=problem`); assert.equal(records.status, 200); assert.equal(records.body.data.items.length, 1);
    const trace = await json(`${running.url}/api/admin/new-core-test/records/${second.body.data.traceId}`); assert.equal(trace.status, 200); assert.equal(trace.body.data.traceId, second.body.data.traceId);
    const reset = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/new-conversation`, "POST", {}); assert.equal(reset.status, 200); assert.equal(reset.body.data.generation, 2);
    const afterReset = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "新對話" }); assert.equal(afterReset.status, 201); assert.equal(historyLengths.at(-1), 0, "new generation must not send old turns to C01");
    const providerFailure = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "provider failure" }); assert.equal(providerFailure.status, 201); assert.equal(providerFailure.body.data.diagnostic.failureCode, "UNDERSTANDING_PROVIDER_FAILURE"); assert.equal(providerFailure.body.data.diagnostic.finalResponse.action, "handoff");
    const sideEffect = await json(`${running.url}/api/admin/new-core-test/sessions/${id}/turns`, "POST", { input: "side effect" }); assert.equal(sideEffect.status, 201); assert.equal(sideEffect.body.data.diagnostic.failureCode, "TEST_LINE_SEND_FORBIDDEN"); assert.equal(sideEffect.body.data.diagnostic.sideEffectCounters.LINE_SEND, 1);
    assert.equal(calls, 3);
    const source = fs.readFileSync(path.join(root, "lib/new-core/manual-test-service.js"), "utf8"); assert.match(source, /callOpenAIUnderstandingV1/); assert.match(source, /reduceConversationStateV3/); assert.match(source, /executeCanonicalQueryPlans/); assert.match(source, /buildFinalDecision/); assert.match(source, /buildFinalResponse/); assert.doesNotMatch(source, /gpt-4\.1-mini|process\.env\.OPENAI_MODEL|messagingApi|appendMessageLog|setConversationState/);
    const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
    assert.match(serverSource, /NEW_CORE_MANUAL_TEST_FACTS_DATABASE_URL/);
    assert.match(serverSource, /NEW_CORE_MANUAL_TEST_FACTS_AUTHORITY_REQUIRED/);
    for (const secret of ["apiKey", "authorization", "cookie", "reasoning", "prompt", "databaseUrl"]) assert.equal(JSON.stringify(second.body.data.diagnostic).includes(secret), false);
    const productionApp = createApp({ providers, newCoreManualTestFactsProviders: factsProviders, adminAuthRequired: true, testOnlyEnvironment: false, now, runtimeEnv: { OPENAI_API_KEY: Array(33).join("x") }, newCoreManualTestExecuteTurn: fakeTurn, lineBindingEnv: {} });
    const productionRunning = await productionApp.start(0, "127.0.0.1");
    try {
      const productionDenied = await fetch(`${productionRunning.url}/admin/new-core-test`);
      assert.equal(productionDenied.status, 401, "non-test-only manual test page must retain admin authentication");
      const productionApiDenied = await json(`${productionRunning.url}/api/admin/new-core-test/sessions`, "POST", {});
      assert.equal(productionApiDenied.status, 401, "non-test-only manual test API must retain admin authentication");
    } finally { await productionApp.stop(); }
    console.log(JSON.stringify({ suite: "new-core-manual-test-page", caseCount: 39, passCount: 39, fakeIntegration: true, realOpenAICalls: 0, sideEffects: second.body.data.diagnostic.sideEffectCounters }));
  } finally { await app.stop(); }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
