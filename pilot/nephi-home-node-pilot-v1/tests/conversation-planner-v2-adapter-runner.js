"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { TestOnlyOpenAiConversationPlanner, instructions } = require("../lib/providers/test-only-openai-conversation-planner");
const { TestOnlyOpenAiControlledComposer } = require("../lib/providers/test-only-openai-controlled-composer");
const { runtimeConfig } = require("../config/runtime");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { validatePlannerOutput, applyPlannerSemanticContract } = require("../lib/conversation-engine-v2/planner-schema");
const { compileSemanticCandidates, validateSemanticCandidates, semanticCandidateDiagnosticSummary } = require("../lib/conversation-engine-v2/semantic-candidate-contract");
const { encodeFakePlannerOutput, migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");
const POOL_CANDIDATE_ID = "71000000-0000-4000-8000-000000000001";
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");
const PARKING_CANDIDATE_ID = "71000000-0000-4000-8000-000000000002";
const ROOM302_CANDIDATE_ID = "71000000-0000-4000-8000-000000000003";
const ROOM402_CANDIDATE_ID = "71000000-0000-4000-8000-000000000004";
const TEMPORAL_CANDIDATE_ID = "71000000-0000-4000-8000-000000000005";
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { evidenceRefsFailureCodes } = require("../lib/conversation-engine-v2/understanding-validator");
const OPAQUE_REPAIR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const { mentionedFaqSubjects } = require("../lib/conversation-engine-v2/entity-resolver");

const output = { schemaVersion: 2, discourse: { relation: "new_request", confidence: 1 }, stateOperations: [], stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, tasks: [{ taskId: "1", type: "property_fact", sourceText: "你好", requestedOutputs: ["greeting"], dependsOnStayContext: false, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, confidence: 1 }], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "greeting" };
let requestBody;
let contextLinkerBody;
const providerBoundaryDiagnostics = [];
const planner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", onDiagnostic: (item) => providerBoundaryDiagnostics.push(item), fetchImpl: async (_url, options) => { const body = JSON.parse(options.body); if (body.text.format.name === "junzan_context_link_v1") contextLinkerBody = body; else requestBody = body; return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(output) }) }; } });

(async () => {
  const recentConversation = [
    { guestMessage: "包棟多少錢", replyText: "請補充入住日期。", createdAt: "2026-08-18T09:50:00.000Z", requestCycleRefs: ["price-cycle"] },
    { guestMessage: "9/5", replyText: "12人包棟共18,000 TWD。", createdAt: "2026-08-18T09:50:16.000Z", requestCycleRefs: ["price-cycle"] }
  ];
  const result = await planner.classify({ traceId: "trace-history-boundary", currentMessage: "費用多少", currentMessages: ["費用多少"], recentConversation, sourceEvents: [{ eventId: "current-event", messageText: "費用多少" }], eventTimestamp: 1, catalog: { propertyId: "p1", rooms: [] }, contextSnapshot: { scope: { propertyId: "p1", channelId: "line", userId: "must-not-leak" }, cycles: [{ requestCycleId: "orphan-availability-cycle", requestKind: "availability", status: "pending" }, { requestCycleId: "price-cycle", requestKind: "pricing", status: "answered" }] }, conversationState: { schemaVersion: 2 } });
  assert.equal(result.schemaVersion, 2);
  assert.equal(Array.isArray(result[Symbol.for("junzan.plannerProviderDiagnostic")].semanticLedgerBoundaries), true, "direct provider output must retain semantic-ledger boundary diagnostics");
  assert.equal(requestBody.text.format.name, "junzan_conversation_plan_v2");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.text.format.schema.properties.tasks.minItems, 1);
  assert.equal(Object.hasOwn(requestBody.text.format.schema.properties, "contextRelationCandidates"), false, "first-phase Planner schema must contain task semantics without relation selection");
  assert.equal(contextLinkerBody.text.format.name, "junzan_context_link_v1");
  assert.deepEqual(Object.keys(contextLinkerBody.text.format.schema.properties), ["relations"], "second-phase schema must be limited to context linking");
  const taskPlannerInstructions = requestBody.input[0].content[0].text;
  const plannerInstructions = instructions();
  assert.doesNotMatch(taskPlannerInstructions, /supplement_existing|candidateHistoryTurnRefs/, "first-phase Planner instructions must not decide context relation or history turn");
  assert.deepEqual(requestBody.input.map((item) => item.role), ["system", "developer", "user", "assistant", "user", "assistant", "user"], "Responses API input must use native multi-turn roles with the current guest as the final user message");
  assert.equal(requestBody.input.at(-1).content[0].text, "費用多少", "current guest text must be the final user message rather than JSON context");
  const plannerInput = JSON.parse(requestBody.input[1].content[0].text);
  assert.equal(Object.hasOwn(plannerInput, "recentConversation"), false, "developer metadata must not embed dialogue history as a JSON field");
  assert.equal(Object.hasOwn(plannerInput, "currentMessage"), false, "current guest text must not be duplicated as a JSON field");
  assert.equal(Object.hasOwn(plannerInput, "currentMessages"), false, "current guest burst must remain represented by sourceEvents and the final user message");
  assert.deepEqual(plannerInput.conversationLineage.turns, [
    { historyTurn: 1, createdAt: "2026-08-18T09:50:00.000Z", cycleCount: 1 },
    { historyTurn: 2, createdAt: "2026-08-18T09:50:16.000Z", cycleCount: 1 }
  ]);
  assert.deepEqual(plannerInput.conversationLineage.latestTurnRefs, [2]);
  assert.equal(plannerInput.contextSnapshot.cycles.length, 1, "orphan cycles without bounded-turn lineage must not reach Planner candidates");
  assert.equal(Object.hasOwn(plannerInput.contextSnapshot.cycles[0], "requestCycleId"), false, "provider metadata must not expose internal requestCycleId authority");
  assert.deepEqual(plannerInput.contextSnapshot.cycles[0].historyTurns, [1, 2], "every exposed cycle must identify its bounded history turns");
  assert.equal(JSON.stringify(plannerInput).includes("price-cycle"), false, "no internal requestCycleId may cross the OpenAI provider boundary");
  assert.deepEqual(plannerInput.sourceEvents, [{ eventId: "current-event", messageText: "費用多少" }]);
  assert.equal(plannerInput.propertyCatalog.propertyId, "p1");
  const shortHash = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
  assert.deepEqual(providerBoundaryDiagnostics[0], {
    traceId: "trace-history-boundary",
    propertyId: "p1",
    stage: "planner_provider_input",
    loadSuccess: true,
    count: 2,
    cycleCount: 1,
    reasonCode: "provider_input_ready",
    items: [
      { createdAt: "2026-08-18T09:50:00.000Z", guestMessageHash: shortHash("包棟多少錢"), replyTextHash: shortHash("請補充入住日期。") },
      { createdAt: "2026-08-18T09:50:16.000Z", guestMessageHash: shortHash("9/5"), replyTextHash: shortHash("12人包棟共18,000 TWD。") }
    ]
  }, "provider must emit the exact hashed history sequence immediately before fetch");
  assert.doesNotMatch(JSON.stringify(providerBoundaryDiagnostics[0]), /包棟多少錢|入住日期|18,000|must-not-leak/, "provider-boundary diagnostic must not retain dialogue, user, or cycle identity");
  let diagnosticFailureFetchCalled = false;
  const diagnosticFailurePlanner = new TestOnlyOpenAiConversationPlanner({
    apiKey: "test-key",
    model: "test-model",
    onDiagnostic: () => { throw new Error("diagnostic_failure_must_be_isolated"); },
    fetchImpl: async () => {
      diagnosticFailureFetchCalled = true;
      return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(output) }) };
    }
  });
  const diagnosticFailureResult = await diagnosticFailurePlanner.classify({ traceId: "trace-diagnostic-failure", currentMessage: "你好", currentMessages: ["你好"], recentConversation, eventTimestamp: 1, catalog: { propertyId: "p1", rooms: [] }, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(diagnosticFailureFetchCalled, true, "diagnostic failure must not prevent the provider fetch");
  assert.equal(diagnosticFailureResult.schemaVersion, result.schemaVersion, "diagnostic failure must not alter Planner output");
  assert.match(plannerInstructions, /preceding user and assistant messages.*semantic understanding.*not.*fact.*not.*evidence/i, "native conversation history must be explicitly non-authoritative semantic context");
  assert.match(plannerInstructions, /sourceEvents.*only.*evidence/i, "current sourceEvents must remain the sole evidence authority");
  assert.match(plannerInstructions, /relation.*capability.*independent/i, "Planner must classify follow-up relation independently from capability");
  assert.match(plannerInstructions, /omits the subject.*conversationLineage.*historyTurn/i, "subject-omitting follow-ups must cite the intended bounded history turn");
  assert.doesNotMatch(plannerInstructions, /A supplement adds a missing value/i, "supplement_existing must not be restricted to missing-slot updates");
  assert.equal((plannerInstructions.match(/supplement_existing means/gi) || []).length, 1, "instructions must define supplement_existing exactly once");
  assert.match(plannerInstructions, /new_request means.*semantically independent.*does not (?:need|require).*prior-turn context/i, "new_request must be independent from prior-turn context");
  assert.match(plannerInstructions, /supplement_existing means.*any follow-up.*uses prior-turn context.*without modifying or removing.*confirmed (?:slot or product|condition)/i, "supplement_existing must cover all non-modifying contextual follow-ups");
  assert.match(plannerInstructions, /supplying a missing slot.*same capability.*another capability.*same lodging context/i, "supplement_existing must explicitly cover missing-slot, same-capability, and cross-capability follow-ups");
  assert.match(plannerInstructions, /modify_existing means.*explicitly modifies or removes.*confirmed (?:slot or product|condition)/i, "modify_existing must be reserved for explicit confirmed-condition changes");
  assert.match(plannerInstructions, /end_existing means.*ends.*referenced turn/i, "end_existing must end the request from the referenced turn");
  assert.match(plannerInstructions, /ambiguous.*relation_uncertain/i, "ambiguous relations must fail closed as relation_uncertain");
  assert.match(plannerInstructions, /immediately preceding turn.*natural antecedent.*conversationLineage\.latestTurnRefs.*earlier historyTurn.*semantic(?:s|ally).*earlier turn/i, "lineage selection must prefer the natural latest antecedent and use older turns only when explicit semantics require it");
  const relationContractSchema = JSON.stringify(requestBody.text.format.schema);
  const followupPlanner = async ({ message, type, cycleId, history, extraCycles = [], historyTurn = history.length, cycleRequestKind = "pricing", entity = { category: "other", rawText: "", canonicalCandidate: null, confidence: 0.99 }, cycleEntityId = "bundle-all" }) => {
    const evidenceRef = { eventId: `event-${type}`, messageRef: "", startOffset: 0, endOffset: message.length, quote: message };
    const planned = migrateFakePlannerOutput({
      schemaVersion: 2,
      discourse: { relation: "continue", confidence: 0.99 },
      stateOperations: [],
      stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
      tasks: [{
        candidateIndex: 0,
        taskId: `followup-${type}`,
        type,
        sourceText: message,
        detailIntent: "general",
        requestedOutputs: [type === "price" ? "price" : "availability"],
        eligibilityEvidence: { kind: "none", sourceText: "" },
        dependsOnStayContext: true,
        entity,
        stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
        confidence: 0.99
      }],
      contextRelationCandidates: [{ candidateIndex: 0, kind: "supplement_existing", candidateHistoryTurnRefs: [historyTurn], candidateRequestCycleRefs: ["model-cycle-id-must-be-ignored"], evidenceRefs: [evidenceRef] }],
      ambiguities: [],
      missingInformation: [],
      needsHuman: false,
      shouldIgnore: false,
      reason: "semantic follow-up"
    });
    planned.semanticCandidates = planned.semanticCandidates.map((candidate) => ({
      ...candidate,
      coverageStatus: "bound",
      provenanceRelationCandidateIndexes: [0],
      evidenceRefs: []
    }));
    const followup = new TestOnlyOpenAiConversationPlanner({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        if (body.text.format.name === "junzan_context_link_v1") {
          return { ok: true, json: async () => ({ output_text: JSON.stringify({ relations: [{ candidateIndex: 0, kind: "supplement_existing", historyTurn }] }) }) };
        }
        assert.equal(JSON.stringify(body.text.format.schema), relationContractSchema, "relation instruction changes must not alter the strict Planner schema");
        const providerInput = JSON.parse(body.input.find((item) => item.role === "developer").content[0].text);
        assert.equal(Object.hasOwn(providerInput, "recentConversation"), false);
        assert.deepEqual(body.input.filter((item) => item.role === "user").map((item) => item.content[0].text), [...history.map((item) => item.guestMessage), message]);
        assert.equal(providerInput.contextSnapshot.cycles.every((cycle) => !Object.hasOwn(cycle, "requestCycleId")), true, "OpenAI must receive cycle semantics without internal identities");
        assert.deepEqual(providerInput.conversationLineage.latestTurnRefs, [history.length], "the latest completed turn must be identified by bounded turn ordinal");
        assert.equal(JSON.stringify(providerInput).includes(cycleId), false, "internal requestCycleId must remain adapter-private");
        return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(planned) }) };
      }
    });
    return followup.classify({
      currentMessage: message,
      currentMessages: [message],
      recentConversation: history,
      sourceEvents: [{ eventId: `event-${type}`, messageText: message }],
      eventTimestamp: Date.parse("2026-08-18T09:53:11.000Z"),
      catalog: { propertyId: "p1", rooms: [], bundles: [] },
      contextSnapshot: {
        scope: { propertyId: "p1", channelId: "line", userId: "private" },
        generatedAt: "2026-08-18T09:53:11.000Z",
        cycles: [...extraCycles, { requestCycleId: cycleId, requestKind: cycleRequestKind, status: "answered", confirmedInputs: { stay: { checkIn: "2026-10-02", checkOut: "2026-10-03" }, inventory: { mode: "bundle_only", entityId: cycleEntityId } }, contextReuseExpiresAt: "2026-08-19T09:52:56.000Z" }]
      }
    });
  };
  const relationAHistory = [
    { guestMessage: "older availability", replyText: "older reply", createdAt: "2026-08-18T09:40:00.000Z", requestCycleRefs: ["older-availability-a"] },
    { guestMessage: "包棟多少錢", replyText: "請補充入住日期。", createdAt: "2026-08-18T09:50:00.000Z", requestCycleRefs: ["answered-price-a"] },
    { guestMessage: "9/25", replyText: "12人包棟共18,000 TWD。", createdAt: "2026-08-18T09:50:16.000Z", requestCycleRefs: ["answered-price-a"] }
  ];
  const relationA = await followupPlanner({ message: "費用多少", type: "price", cycleId: "answered-price-a", history: relationAHistory, extraCycles: [{ requestCycleId: "older-availability-a", requestKind: "availability", status: "pending", confirmedInputs: { stay: { checkIn: null, checkOut: null }, inventory: { mode: "any", entityId: null } }, contextReuseExpiresAt: "2026-08-19T09:00:00.000Z" }] });
  assert.equal(relationA.tasks[0].type, "price", "same-capability follow-up must preserve price");
  assert.deepEqual(relationA.contextRelationCandidates[0].candidateRequestCycleRefs, ["answered-price-a"]);
  assert.equal(relationA.contextRelationCandidates[0].kind, "supplement_existing");
  const relationBHistory = [
    { guestMessage: "older availability", replyText: "older reply", createdAt: "2026-08-18T09:40:00.000Z", requestCycleRefs: ["older-orphan-availability"] },
    { guestMessage: "10/2 包棟多少錢", replyText: "12人包棟共18,000 TWD。", createdAt: "2026-08-18T09:52:56.000Z", requestCycleRefs: ["answered-price-b"] }
  ];
  const relationB = await followupPlanner({
    message: "還能預訂嗎？",
    type: "availability",
    cycleId: "answered-price-b",
    history: relationBHistory,
    extraCycles: [{ requestCycleId: "older-orphan-availability", requestKind: "availability", status: "pending", confirmedInputs: { stay: { checkIn: null, checkOut: null }, inventory: { mode: "any", entityId: null } }, contextReuseExpiresAt: "2026-08-19T09:00:00.000Z" }]
  });
  assert.equal(relationB.tasks[0].type, "availability", "cross-capability follow-up must preserve its current capability");
  assert.deepEqual(relationB.contextRelationCandidates[0].candidateRequestCycleRefs, ["answered-price-b"]);
  assert.equal(relationB.contextRelationCandidates[0].kind, "supplement_existing");

  const linkerHistory = [
    { guestMessage: "prior bundle price", replyText: "priced reply", createdAt: "2026-08-18T10:00:00.000Z", requestCycleRefs: ["linker-price-cycle"] }
  ];
  const linkerCases = [
    { message: "same capability follow-up", type: "price" },
    { message: "cross capability follow-up", type: "availability" }
  ];
  for (const linkerCase of linkerCases) {
    let providerCall = 0;
    let linkerSchemaSeen = false;
    const firstPhase = migrateFakePlannerOutput({
      ...JSON.parse(JSON.stringify(output)),
      discourse: { relation: "new_request", confidence: 0.99 },
      tasks: [{
        candidateIndex: 0,
        taskId: `linker-${linkerCase.type}`,
        type: linkerCase.type,
        sourceText: linkerCase.message,
        detailIntent: "general",
        requestedOutputs: [linkerCase.type === "price" ? "price" : "availability"],
        eligibilityEvidence: { kind: "none", sourceText: "" },
        dependsOnStayContext: true,
        entity: { category: "bundle", rawText: "bundle", canonicalCandidate: null, confidence: 0.99 },
        stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
        confidence: 0.99
      }],
      contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateHistoryTurnRefs: [], evidenceRefs: [{ eventId: "linker-current", messageRef: "", startOffset: 0, endOffset: linkerCase.message.length, quote: linkerCase.message }] }]
    });
    const linkerPlanner = new TestOnlyOpenAiConversationPlanner({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: async (_url, options) => {
        providerCall += 1;
        const body = JSON.parse(options.body);
        if (providerCall === 1) return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(firstPhase) }) };
        linkerSchemaSeen = body.text.format.name === "junzan_context_link_v1"
          && JSON.stringify(Object.keys(body.text.format.schema.properties)) === JSON.stringify(["relations"]);
        if (!linkerSchemaSeen) return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(firstPhase) }) };
        return { ok: true, json: async () => ({ output_text: JSON.stringify({ relations: [{ candidateIndex: 0, kind: "supplement_existing", historyTurn: 1 }] }) }) };
      }
    });
    const linkerResult = await linkerPlanner.classify({
      currentMessage: linkerCase.message,
      currentMessages: [linkerCase.message],
      recentConversation: linkerHistory,
      sourceEvents: [{ eventId: "linker-current", messageText: linkerCase.message }],
      eventTimestamp: Date.parse("2026-08-18T10:01:00.000Z"),
      catalog: { propertyId: "p1", rooms: [], bundles: [] },
      contextSnapshot: { scope: {}, cycles: [{ requestCycleId: "linker-price-cycle", requestKind: "pricing", status: "answered", confirmedInputs: { stay: { checkIn: "2026-09-25", checkOut: "2026-09-26" }, inventory: { mode: "bundle_only", entityId: "bundle-all" } }, contextReuseExpiresAt: "2026-08-19T10:00:00.000Z" }] }
    });
    assert.equal(linkerSchemaSeen, true, "referenceable context must separate task semantics from context linking through the narrow schema");
    assert.equal(linkerResult.tasks[0].type, linkerCase.type, "Context Linker must not alter Planner task capability");
    assert.equal(linkerResult.contextRelationCandidates[0].kind, "supplement_existing");
    assert.deepEqual(linkerResult.contextRelationCandidates[0].candidateRequestCycleRefs, ["linker-price-cycle"]);
  }
  const olderTurn = await followupPlanner({ message: "older follow-up", type: "availability", cycleId: "older-orphan-availability", history: relationBHistory, historyTurn: 1, extraCycles: [{ requestCycleId: "answered-price-b", requestKind: "pricing", status: "answered", confirmedInputs: { stay: { checkIn: "2026-10-02", checkOut: "2026-10-03" }, inventory: { mode: "bundle_only", entityId: "bundle-all" } }, contextReuseExpiresAt: "2026-08-19T09:52:56.000Z" }] });
  assert.deepEqual(olderTurn.contextRelationCandidates[0].candidateRequestCycleRefs, ["older-orphan-availability"], "an explicit older-turn relation must resolve through that turn's deterministic lineage");
  const multiCycleHistory = [{ guestMessage: "multi-cycle turn", replyText: "multi-cycle reply", createdAt: "2026-08-18T09:54:00.000Z", requestCycleRefs: ["same-turn-price", "same-turn-availability"] }];
  const capabilitySelected = await followupPlanner({
    message: "contextual follow-up",
    type: "availability",
    cycleId: "same-turn-availability",
    cycleRequestKind: "availability",
    history: multiCycleHistory,
    extraCycles: [{ requestCycleId: "same-turn-price", requestKind: "pricing", status: "answered", confirmedInputs: { stay: { checkIn: "2026-10-02", checkOut: "2026-10-03" }, inventory: { mode: "bundle_only", entityId: "bundle-all" } }, contextReuseExpiresAt: "2026-08-19T09:52:56.000Z" }]
  });
  assert.deepEqual(capabilitySelected.contextRelationCandidates[0].candidateRequestCycleRefs, ["same-turn-availability"], "existing capability contract may uniquely select one cycle within the referenced turn");
  const productSelected = await followupPlanner({
    message: "product-scoped follow-up",
    type: "price",
    cycleId: "same-turn-bundle-b",
    cycleEntityId: "bundle-b",
    entity: { category: "bundle", rawText: "bundle b", canonicalCandidate: "bundle-b", confidence: 0.99 },
    history: [{ guestMessage: "multi-product turn", replyText: "multi-product reply", createdAt: "2026-08-18T09:54:30.000Z", requestCycleRefs: ["same-turn-bundle-a", "same-turn-bundle-b"] }],
    extraCycles: [{ requestCycleId: "same-turn-bundle-a", requestKind: "pricing", status: "answered", confirmedInputs: { stay: { checkIn: "2026-10-02", checkOut: "2026-10-03" }, inventory: { mode: "bundle_only", entityId: "bundle-a" } }, contextReuseExpiresAt: "2026-08-19T09:52:56.000Z" }]
  });
  assert.deepEqual(productSelected.contextRelationCandidates[0].candidateRequestCycleRefs, ["same-turn-bundle-b"], "existing product contract may uniquely select one cycle within the referenced turn");
  const ambiguousCycle = await followupPlanner({
    message: "ambiguous contextual follow-up",
    type: "price",
    cycleId: "same-turn-price-a",
    history: [{ guestMessage: "ambiguous turn", replyText: "ambiguous reply", createdAt: "2026-08-18T09:55:00.000Z", requestCycleRefs: ["same-turn-price-a", "same-turn-price-b"] }],
    extraCycles: [{ requestCycleId: "same-turn-price-b", requestKind: "pricing", status: "answered", confirmedInputs: { stay: { checkIn: "2026-10-02", checkOut: "2026-10-03" }, inventory: { mode: "bundle_only", entityId: "bundle-all" } }, contextReuseExpiresAt: "2026-08-19T09:52:56.000Z" }]
  });
  assert.equal(ambiguousCycle.needsHuman, true, "multiple still-compatible cycles must use the existing safe fallback");
  assert.equal(ambiguousCycle.contextRelationCandidates.some((candidate) => (
    candidate.candidateRequestCycleRefs.includes("same-turn-price-a")
      || candidate.candidateRequestCycleRefs.includes("same-turn-price-b")
      || candidate.candidateRequestCycleRefs.includes("model-cycle-id-must-be-ignored")
  )), false, "an ambiguous history turn must not grant any cycle identity authority");
  const unmatchedProduct = await followupPlanner({
    message: "unmatched product follow-up",
    type: "availability",
    cycleId: "same-turn-availability-a",
    cycleRequestKind: "availability",
    cycleEntityId: "bundle-a",
    entity: { category: "bundle", rawText: "bundle c", canonicalCandidate: "bundle-c", confidence: 0.99 },
    history: [{ guestMessage: "different-product turn", replyText: "different-product reply", createdAt: "2026-08-18T09:55:30.000Z", requestCycleRefs: ["same-turn-availability-a", "same-turn-price-b"] }],
    extraCycles: [{ requestCycleId: "same-turn-price-b", requestKind: "pricing", status: "answered", confirmedInputs: { stay: { checkIn: "2026-10-02", checkOut: "2026-10-03" }, inventory: { mode: "bundle_only", entityId: "bundle-b" } }, contextReuseExpiresAt: "2026-08-19T09:52:56.000Z" }]
  });
  assert.equal(unmatchedProduct.needsHuman, true, "an explicit product absent from every cycle in the referenced turn must fail closed");
  assert.equal(unmatchedProduct.contextRelationCandidates.some((candidate) => candidate.candidateRequestCycleRefs.length > 0), false, "capability alone must not select a cycle that conflicts with explicit product scope");
  const taskSchema = requestBody.text.format.schema.properties.tasks.items;
  const semanticCandidateItems = requestBody.text.format.schema.properties.semanticCandidates.items;
  const semanticCandidateSchema = semanticCandidateItems.anyOf ? semanticCandidateItems.anyOf[0] : semanticCandidateItems;
  const semanticProvenanceSchema = semanticCandidateSchema.properties.provenanceRelationCandidateIndexes;
  const semanticCoverageStatusSchema = semanticCandidateSchema.properties.coverageStatus;
  assert.match(plannerInstructions, /monetary lodging (?:amount|charge|rate)/i, "planner grammar must define price semantically instead of relying on question wording");
  assert.match(plannerInstructions, /type price.*requestedOutputs price.*dependsOnStayContext true/i, "generic and scoped monetary lodging requests must retain the inventory price contract");
  assert.match(plannerInstructions, /policy.*rules or conditions.*not.*monetary/i, "planner grammar must keep property rules separate from price requests");
  assert.match(plannerInstructions, /access credentials.*authentication secrets.*type high_risk.*never.*policy/i, "sensitive access disclosure must remain a high-risk handoff capability");
  assert.match(plannerInstructions, /before returning.*verify.*substantive request.*matching task/i, "planner must self-check semantic task coverage before returning structured output");
  assert.match(taskSchema.properties.type.description, /monetary lodging.*price/i, "the strict task schema must carry the shared price-vs-policy grammar into structured generation");
  assert.match(taskSchema.properties.type.description, /access credentials.*high_risk/i, "the strict task schema must preserve sensitive-access routing");
  assert.match(taskSchema.properties.requestedOutputs.description, /price task.*price/i, "the strict task schema must keep price output coupled to a price task");
  assert.match(taskSchema.properties.stayCandidate.description, /dependsOnStayContext is true.*structured object.*empty candidate fields/i, "stay-dependent tasks must retain an explicit empty candidate when dates are missing");
  assert.match(plannerInstructions, /preserve every stated nights, guest count, and feature even when a date is missing/i);
  assert.match(plannerInstructions, /explicit calendar expression/i);
  assert.match(plannerInstructions, /direct requests for the property's location, address, map, or navigation/i, "planner must recognize direct property location requests");
  assert.match(plannerInstructions, /relationship between the property and (?:an|any) external place/i, "planner must recognize location relationships as one shared semantic concept");
  assert.match(plannerInstructions, /proximity, near, far, distance, duration, directions, navigation, or nearby existence/i, "planner must cover proximity semantics rather than a fixed list of place names");
  assert.match(plannerInstructions, /never search for, recommend, invent, or identify a nearby place/i, "planner must not create unapproved nearby-place facts");
  assert.match(plannerInstructions, /every coordinated subject or requested fact/i, "planner must retain each subject in a multi-question message");
  assert.match(plannerInstructions, /patchInvalidSemanticUnits.*only replacement.*runtime owns.*validated siblings/i, "a bounded invalid-unit repair must leave validated siblings under runtime ownership");
  assert.match(plannerInstructions, /pure social acknowledgement/i, "planner must classify non-actionable acknowledgements without inventing a task");
  assert.match(requestBody.input[0].content[0].text, /punctuation or emoji/i, "planner must classify non-semantic punctuation and emoji by dialogue act");
  assert.match(requestBody.input[0].content[0].text, /price or total price/i, "planner must distinguish pricing from availability and policy");
  assert.match(contextLinkerBody.input[0].content[0].text, /modify_existing.*changes or removes a confirmed condition/i, "Context Linker must express multi-turn replacement through the formal relation contract");
  assert.match(contextLinkerBody.input[0].content[0].text, /new_request.*semantically independent/i, "Context Linker must not attach stale state to an independent request");
  assert.match(plannerInstructions, /EvidenceRefs are a source-coordinate contract/i, "planner must receive the validator's source-coordinate evidence contract");
  assert.match(plannerInstructions, /at least one non-empty eventId or messageRef/i, "planner must receive the source identity requirement");
  assert.match(plannerInstructions, /0-based UTF-16 JavaScript string index inclusive.*endOffset is exclusive/i, "planner must receive exact JavaScript offset semantics");
  assert.match(plannerInstructions, /messageText\.slice\(startOffset, endOffset\)/i, "planner must receive exact quote reconstruction semantics");
  assert.equal(Object.hasOwn(semanticCandidateSchema.properties, "evidenceRefs"), true, "pending coverage candidates retain raw source provenance");
  assert.equal(semanticProvenanceSchema.minItems, 0, "the required provenance field must represent pending_task with an empty array");
  assert.equal(semanticProvenanceSchema.items.type, "integer", "relation provenance must be candidate indexes");
  assert.ok(semanticCandidateSchema.required.includes("evidenceRefs"), "OpenAI strict schema must require the lifecycle evidence field");
  assert.ok(semanticCandidateSchema.required.includes("provenanceRelationCandidateIndexes"), "OpenAI strict schema must require the lifecycle provenance field");
  assert.deepEqual(semanticCoverageStatusSchema.enum, ["bound", "pending_task"], "the provider schema must distinguish bound and pending coverage candidates");
  assert.equal(JSON.stringify(requestBody).includes("test-key"), false);
  const rawEvidenceMessage = "Ask about the lodging policy.";
  const rawEvidenceInput = {
    currentMessage: rawEvidenceMessage,
    currentMessages: [rawEvidenceMessage],
    sourceEvents: [{ eventId: "raw-evidence-event", messageRef: "raw-evidence-message", messageText: rawEvidenceMessage }],
    catalog: { propertyId: "raw-evidence-property", rooms: [], amenities: [], policies: [], faqs: [], propertyFacts: [], transportFacts: [] }
  };
  const validRawEvidenceCandidate = {
    semanticKind: "capability",
    capability: "policy",
    canonicalIdentityCandidate: "policy",
    coverageStatus: "bound",
    provenanceRelationCandidateIndexes: [0],
    evidenceRefs: [{ eventId: "raw-evidence-event", messageRef: "raw-evidence-message", startOffset: 0, endOffset: rawEvidenceMessage.length, quote: rawEvidenceMessage }],
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: null
  };
  const validRawEvidenceOutput = {
    tasks: [{ candidateIndex: 0, taskId: "raw-policy", type: "policy", sourceText: rawEvidenceMessage, detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: false, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, stayCandidate: null, confidence: 1 }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: validRawEvidenceCandidate.evidenceRefs.map((ref) => ({ ...ref })) }],
    semanticCandidates: [validRawEvidenceCandidate]
  };
  assert.deepEqual(semanticCandidateDiagnosticSummary(validRawEvidenceOutput, rawEvidenceInput, { raw: true }), {
    candidateCount: 1,
    validCandidateCount: 1,
    invalidCandidateCount: 0,
    ownershipCount: 0,
    failureCodes: [],
    evidenceFailureCodes: []
  }, "a raw semantic candidate with exact source coordinates must be accepted before compilation");
  assert.equal(validateSemanticCandidates(compileSemanticCandidates(validRawEvidenceOutput, rawEvidenceInput), rawEvidenceInput).validCandidates.length, 1, "the exact raw evidence contract must remain valid after deterministic compilation");
  const invalidRawEvidenceOutput = {
    ...validRawEvidenceOutput,
    semanticCandidates: [{ ...validRawEvidenceCandidate, evidenceRefs: [{ ...validRawEvidenceCandidate.evidenceRefs[0], quote: "paraphrased policy request" }] }]
  };
  assert.deepEqual(semanticCandidateDiagnosticSummary(invalidRawEvidenceOutput, rawEvidenceInput, { raw: true }), {
    candidateCount: 1,
    validCandidateCount: 0,
    invalidCandidateCount: 1,
    ownershipCount: 0,
    failureCodes: ["evidence_refs"],
    evidenceFailureCodes: ["quote_slice_mismatch"]
  }, "a raw semantic candidate with a non-slice quote must fail closed as evidence_refs");
  assert.equal(validateSemanticCandidates(compileSemanticCandidates(invalidRawEvidenceOutput, rawEvidenceInput), rawEvidenceInput).validCandidates.length, 1, "deterministic compilation must replace raw model coordinates only with verified relation evidence");
  const diagnosticCandidate = (outputValue, options = {}) => semanticCandidateDiagnosticSummary(outputValue, rawEvidenceInput, {
    includeCandidates: true,
    ...options
  }).candidates[0];
  const boundMissingProvenance = JSON.parse(JSON.stringify(validRawEvidenceOutput));
  delete boundMissingProvenance.semanticCandidates[0].provenanceRelationCandidateIndexes;
  const boundMissingCompiled = compileSemanticCandidates(boundMissingProvenance, rawEvidenceInput);
  assert.equal(diagnosticCandidate(boundMissingCompiled, { originOutput: boundMissingProvenance }).missingRefsReason, "bound_missing_provenance", "diagnostics must distinguish missing bound provenance");
  const boundUnknownProvenance = JSON.parse(JSON.stringify(validRawEvidenceOutput));
  boundUnknownProvenance.semanticCandidates[0].provenanceRelationCandidateIndexes = [99];
  assert.equal(diagnosticCandidate(compileSemanticCandidates(boundUnknownProvenance, rawEvidenceInput), { originOutput: boundUnknownProvenance }).missingRefsReason, "bound_unknown_provenance_relation", "diagnostics must distinguish unknown provenance relations");
  const boundInvalidRelationEvidence = JSON.parse(JSON.stringify(validRawEvidenceOutput));
  boundInvalidRelationEvidence.contextRelationCandidates[0].evidenceRefs[0].quote = "not the source slice";
  const invalidRelationEvidenceDiagnostic = diagnosticCandidate(compileSemanticCandidates(boundInvalidRelationEvidence, rawEvidenceInput), { originOutput: boundInvalidRelationEvidence });
  assert.equal(invalidRelationEvidenceDiagnostic.missingRefsReason, "bound_relation_evidence_invalid", "diagnostics must distinguish invalid relation evidence");
  assert.deepEqual(invalidRelationEvidenceDiagnostic.provenanceRelations, [{ candidateIndex: 0, relationExists: true, relationContextValid: false, relationEvidenceValid: false, evidenceFailureCodes: ["quote_slice_mismatch"] }]);
  const boundInvalidRelationContext = JSON.parse(JSON.stringify(validRawEvidenceOutput));
  boundInvalidRelationContext.contextRelationCandidates[0].kind = "supplement_existing";
  const invalidRelationContextDiagnostic = diagnosticCandidate(compileSemanticCandidates(boundInvalidRelationContext, rawEvidenceInput), { originOutput: boundInvalidRelationContext });
  assert.equal(invalidRelationContextDiagnostic.missingRefsReason, "bound_relation_context_invalid", "diagnostics must distinguish a relation whose evidence is valid but understanding context is invalid");
  assert.deepEqual(invalidRelationContextDiagnostic.provenanceRelations, [{ candidateIndex: 0, relationExists: true, relationContextValid: false, relationEvidenceValid: true, evidenceFailureCodes: [] }]);
  const pendingInvalidRaw = JSON.parse(JSON.stringify(invalidRawEvidenceOutput));
  pendingInvalidRaw.semanticCandidates[0].coverageStatus = "pending_task";
  pendingInvalidRaw.semanticCandidates[0].provenanceRelationCandidateIndexes = [];
  pendingInvalidRaw.tasks.push({ ...pendingInvalidRaw.tasks[0], candidateIndex: 1, taskId: "raw-policy-alternative" });
  pendingInvalidRaw.contextRelationCandidates.push({ ...pendingInvalidRaw.contextRelationCandidates[0], candidateIndex: 1 });
  assert.equal(diagnosticCandidate(compileSemanticCandidates(pendingInvalidRaw, rawEvidenceInput), { originOutput: pendingInvalidRaw }).missingRefsReason, "pending_invalid_raw_evidence", "diagnostics must distinguish invalid pending raw evidence");
  const compiledLoss = compileSemanticCandidates(validRawEvidenceOutput, rawEvidenceInput);
  compiledLoss.semanticCandidates[0] = { ...compiledLoss.semanticCandidates[0], evidenceRefs: [] };
  const compiledLossDiagnostic = diagnosticCandidate(compiledLoss, { originOutput: validRawEvidenceOutput });
  assert.equal(compiledLossDiagnostic.missingRefsReason, "compiled_evidence_lost", "diagnostics must identify a raw-valid candidate whose verified compiled evidence disappears");
  assert.deepEqual({
    coverageStatus: compiledLossDiagnostic.coverageStatus,
    lifecycle: compiledLossDiagnostic.lifecycle,
    provenancePresent: compiledLossDiagnostic.provenancePresent,
    provenanceCount: compiledLossDiagnostic.provenanceCount,
    provenanceRelationCandidateIndexes: compiledLossDiagnostic.provenanceRelationCandidateIndexes,
    verifiedRelationCount: compiledLossDiagnostic.verifiedRelationCount,
    evidenceRefCount: compiledLossDiagnostic.evidenceRefCount,
    valid: compiledLossDiagnostic.valid,
    failureCodes: compiledLossDiagnostic.failureCodes
  }, {
    coverageStatus: "bound",
    lifecycle: "bound",
    provenancePresent: true,
    provenanceCount: 1,
    provenanceRelationCandidateIndexes: [0],
    verifiedRelationCount: 1,
    evidenceRefCount: 0,
    valid: false,
    failureCodes: ["evidence_refs"]
  }, "candidate diagnostics must expose only bounded lifecycle/provenance/relation counts and codes");
  const productionSnapshot = JSON.stringify(validRawEvidenceOutput);
  semanticCandidateDiagnosticSummary(validRawEvidenceOutput, rawEvidenceInput, { raw: true, includeCandidates: true });
  assert.equal(JSON.stringify(validRawEvidenceOutput), productionSnapshot, "diagnostic projection must not mutate production output");
  const providerOutput = (candidate, relationEvidence) => ({
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 1 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: validRawEvidenceOutput.tasks.map((task) => ({ ...task })),
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ ...relationEvidence }] }],
    semanticCandidates: [{ ...candidate }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "provider coordinate drift regression"
  });
  const classifyProviderOutput = async (providerValue) => new TestOnlyOpenAiConversationPlanner({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(providerValue) }) })
  }).classify(rawEvidenceInput);
  const exactProviderResult = await classifyProviderOutput(providerOutput(validRawEvidenceCandidate, validRawEvidenceCandidate.evidenceRefs[0]));
  for (const { driftedEvidence, expectedRawFailure } of [
    { driftedEvidence: { ...validRawEvidenceCandidate.evidenceRefs[0], quote: "paraphrased policy request" }, expectedRawFailure: "quote_slice_mismatch" },
    { driftedEvidence: { ...validRawEvidenceCandidate.evidenceRefs[0], endOffset: rawEvidenceMessage.length + 7 }, expectedRawFailure: "out_of_bounds" },
    { driftedEvidence: { ...validRawEvidenceCandidate.evidenceRefs[0], eventId: "model-invented-event", messageRef: "" }, expectedRawFailure: "unknown_event_id" }
  ]) {
    const driftResult = await classifyProviderOutput(providerOutput(
      { ...validRawEvidenceCandidate, evidenceRefs: [{ ...driftedEvidence }] },
      driftedEvidence
    ));
    const driftLedger = validateSemanticCandidates(driftResult, rawEvidenceInput);
    assert.equal(driftLedger.validCandidates.length, 1, "bound provider coordinate drift must compile from the uniquely identified verified relation");
    assert.deepEqual(driftResult.semanticCandidates[0].evidenceRefs, validRawEvidenceCandidate.evidenceRefs, "bound final evidence must be the canonical verified relation evidence, never the model coordinates");
    assert.deepEqual(driftResult.tasks[0].semanticCandidateIds, [driftResult.semanticCandidates[0].candidateId], "canonical relation evidence must retain deterministic task ownership");
    assert.deepEqual(driftResult.semanticCandidates, exactProviderResult.semanticCandidates, "equivalent bound semantics must compile identically across raw coordinate quality");
    assert.deepEqual(driftResult.tasks, exactProviderResult.tasks, "equivalent bound semantics must retain identical ownership across raw coordinate quality");
    const driftBoundaries = driftResult[Symbol.for("junzan.plannerProviderDiagnostic")].semanticLedgerBoundaries;
    assert.deepEqual(driftBoundaries[0].evidenceFailureCodes, [expectedRawFailure], "the recorded raw boundary must retain the provider coordinate failure reason");
    assert.equal(driftBoundaries[2].validCandidateCount, 1, "provider contract normalization must supply verified relation evidence before the first compile");
    assert.deepEqual(driftBoundaries[2].evidenceFailureCodes, [], "compile_after must not convert recoverable provider drift into missing_refs");
    assert.equal(driftBoundaries[3].ownershipCount, 1, "final validation must retain bound task ownership");
  }
  const invalidPendingCandidate = {
    ...validRawEvidenceCandidate,
    coverageStatus: "pending_task",
    provenanceRelationCandidateIndexes: [],
    evidenceRefs: [{ ...validRawEvidenceCandidate.evidenceRefs[0], quote: "paraphrased policy request" }]
  };
  const invalidPendingResult = await classifyProviderOutput(providerOutput(invalidPendingCandidate, validRawEvidenceCandidate.evidenceRefs[0]));
  assert.equal(invalidPendingResult.semanticCandidates.length, 1, "classify must retain a candidate whose existing task ownership is uniquely proven by the verified relation");
  assert.deepEqual(invalidPendingResult.semanticCandidates[0].evidenceRefs, validRawEvidenceCandidate.evidenceRefs, "classify must use only the verified relation evidence for controlled bound ownership");
  assert.deepEqual(invalidPendingResult.tasks[0].semanticCandidateIds, [invalidPendingResult.semanticCandidates[0].candidateId], "classify must preserve the compiler-established ownership instead of deleting the mislabelled candidate");
  const secondCompiledExact = compileSemanticCandidates(exactProviderResult, rawEvidenceInput);
  assert.deepEqual(secondCompiledExact.semanticCandidates, exactProviderResult.semanticCandidates, "second compile must preserve verified evidence and candidate identity");
  assert.deepEqual(secondCompiledExact.tasks, exactProviderResult.tasks, "second compile must preserve verified ownership");
  const alternateEvidenceSourceEvents = [...rawEvidenceInput.sourceEvents, { eventId: "alternate-event", messageRef: "alternate-message", messageText: "Alternate source." }];
  const evidenceReasonCases = [
    { refs: [], expected: ["missing_refs"] },
    { refs: new Array(13).fill(validRawEvidenceCandidate.evidenceRefs[0]), expected: ["too_many_refs"] },
    { refs: [null], expected: ["invalid_evidence_ref"] },
    { refs: [{ eventId: "", messageRef: "", startOffset: 0, endOffset: 1, quote: "A" }], expected: ["missing_source_identity"] },
    { refs: [{ eventId: "unknown", messageRef: "", startOffset: 0, endOffset: 1, quote: "A" }], expected: ["unknown_event_id"] },
    { refs: [{ eventId: "raw-evidence-event", messageRef: "unknown", startOffset: 0, endOffset: 1, quote: "A" }], expected: ["unknown_message_ref"] },
    { refs: [{ eventId: "raw-evidence-event", messageRef: "alternate-message", startOffset: 0, endOffset: 1, quote: "A" }], sourceEvents: alternateEvidenceSourceEvents, expected: ["identity_conflict"] },
    { refs: [{ eventId: "raw-evidence-event", messageRef: "raw-evidence-message", startOffset: 1.5, endOffset: 2, quote: "s" }], expected: ["invalid_offset"] },
    { refs: [{ eventId: "raw-evidence-event", messageRef: "raw-evidence-message", startOffset: 0, endOffset: 1, quote: "" }], expected: ["invalid_quote"] },
    { refs: [{ eventId: "raw-evidence-event", messageRef: "raw-evidence-message", startOffset: 0, endOffset: rawEvidenceMessage.length + 1, quote: rawEvidenceMessage }], expected: ["out_of_bounds"] },
    { refs: invalidRawEvidenceOutput.semanticCandidates[0].evidenceRefs, expected: ["quote_slice_mismatch"] }
  ];
  for (const item of evidenceReasonCases) assert.deepEqual(evidenceRefsFailureCodes(item.refs, item.sourceEvents || rawEvidenceInput.sourceEvents), item.expected, "diagnostic evidence reason must mirror the existing fail-closed predicate");
  const coverageCatalog = buildPropertyCatalog({
    propertyId: "coverage-property",
    displayName: "Coverage Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    propertyFacts: [{ canonicalId: "pool", category: "amenity", status: "available", publicText: "Pool information." }],
    faqs: [{ knowledgeKey: "pool", question: "戲水池", answer: "正式戲水池資料" }],
    semanticCatalog: { aliases: { pool: ["戲水池"] } }
  });
  const coverageMessage = "Ask for the lodging price and confirm the pool.";
  const priceSourceText = "lodging price";
  const poolSourceText = "pool";
  const coverageEvidence = (sourceText) => [{ eventId: "coverage", messageRef: "coverage-message", startOffset: coverageMessage.indexOf(sourceText), endOffset: coverageMessage.indexOf(sourceText) + sourceText.length, quote: sourceText }];
  const omittedPool = JSON.parse(JSON.stringify(output));
  omittedPool.tasks[0] = { ...omittedPool.tasks[0], candidateIndex: 0, taskId: "price", type: "price", sourceText: priceSourceText, detailIntent: "general", requestedOutputs: ["price"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true, entity: { category: "bundle", rawText: "", canonicalCandidate: null, confidence: 1 }, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null } };
  omittedPool.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: coverageEvidence(priceSourceText) }];
  omittedPool.semanticCandidates = [
    { semanticKind: "capability", capability: "price", canonicalIdentityCandidate: "price", coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: coverageEvidence(priceSourceText), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: null },
    { semanticKind: "catalog_subject", capability: "amenity", canonicalIdentityCandidate: "pool", coverageStatus: "pending_task", evidenceRefs: coverageEvidence(poolSourceText), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: "pool" }
  ];
  const repairedPool = JSON.parse(JSON.stringify(output));
  repairedPool.tasks[0] = { ...repairedPool.tasks[0], candidateIndex: 0, taskId: "pool", type: "amenity", sourceText: poolSourceText, detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: false, entity: { category: "amenity", rawText: poolSourceText, canonicalCandidate: "pool", confidence: 1 }, stayCandidate: null };
  const repairedPoolCanonicalIdentity = repairedPool.tasks[0].entity.canonicalCandidate;
  repairedPool.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: coverageEvidence(poolSourceText) }];
  repairedPool.semanticCandidates = [{ ...JSON.parse(JSON.stringify(omittedPool.semanticCandidates[1])), coverageStatus: "bound", provenanceRelationCandidateIndexes: [0] }];  let coverageCalls = 0;
  const coverageBodies = [];
  const coveragePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async (_url, options) => {
    coverageCalls += 1;
    coverageBodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(coverageCalls === 1 ? omittedPool : repairedPool) }) };
  } });
  const coverageResult = await coveragePlanner.classify({ currentMessage: coverageMessage, currentMessages: [coverageMessage], sourceEvents: [{ eventId: "coverage", messageRef: "coverage-message", messageText: coverageMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(coverageCalls, 2, "one bounded repair attempt may fill a missing formal subject");
  assert.equal(coverageResult.tasks.length, 2, "repair must merge with rather than replace the first valid task collection");
  const { semanticCandidateIds: priceTaskCandidateIds, lodgingScopeId: priceTaskScopeId, ...priceTaskSemantics } = coverageResult.tasks[0];
  assert.deepEqual(priceTaskSemantics, omittedPool.tasks[0], "coverage repair must preserve every first-round price-task semantic field");
  const priceCandidate = coverageResult.semanticCandidates.find((candidate) => candidate.capability === "price"
    && candidate.canonicalIdentityCandidate === "price"
    && candidate.propertyCatalogIdentity === null
    && JSON.stringify(candidate.evidenceRefs) === JSON.stringify(omittedPool.semanticCandidates[0].evidenceRefs));
  const poolCandidate = coverageResult.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool");
  assert.ok(priceCandidate, "the compiled ledger must retain the first-round price semantic candidate");
  assert.ok(poolCandidate, "the repair ledger must retain the pool semantic candidate");
  assert.deepEqual(priceTaskCandidateIds, [priceCandidate.candidateId], "the price task must own exactly its compiled price candidate");
  assert.equal(priceTaskCandidateIds.includes(poolCandidate.candidateId), false, "the pool repair candidate must not take ownership of the price task");
  assert.equal(priceTaskScopeId, null, "an unscoped price task must remain explicitly unscoped");
  assert.equal(coverageResult.tasks[1].entity.canonicalCandidate, "pool");
  assert.deepEqual(validatePlannerOutput(coverageResult).errors, [], "the task-level merge must remain a valid Planner contract");
  const coverageDiagnostic = coverageResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(coverageDiagnostic.providerAttemptCount, 2);
  assert.equal(coverageDiagnostic.retryPerformed, false, "a semantic coverage supplement is not a provider-error retry");
  assert.equal(coverageDiagnostic.retrySucceeded, false, "coverage repair must not be reported as a recovered provider failure");
  assert.equal(coverageDiagnostic.coverageRepairPerformed, true);
  assert.equal(coverageDiagnostic.coverageRepairSucceeded, true);
  assert.equal(coverageDiagnostic.coverageRepairFallback, false);
  assert.equal(Array.isArray(coverageDiagnostic.semanticLedgerBoundaries), true, "coverage merge must retain first-round semantic-ledger boundaries");
  assert.equal(Array.isArray(coverageDiagnostic.repairLinks), true, "coverage repair must record private task-to-correlation provenance");
  assert.deepEqual(coverageDiagnostic.repairLinks.map((item) => item.kind), ["coverage_repair"]);
  assert.equal(coverageDiagnostic.repairLinks[0].taskId, coverageResult.tasks[1].taskId);
  assert.match(coverageDiagnostic.repairLinks[0].correlationId, OPAQUE_REPAIR_ID);
  assert.doesNotMatch(coverageDiagnostic.repairLinks[0].correlationId, /pool|price|coverage|property/i, "opaque repair IDs must not derive from semantic task data");
  const repairInput = JSON.parse(coverageBodies[1].input[1].content[0].text);
  assert.equal(coverageResult.semanticCandidates.some((candidate) => candidate.candidateId === poolCandidate.candidateId), true, "the missing pool candidate must exist in the compiled ledger");
  assert.notEqual(poolCandidate.candidateId, priceCandidate.candidateId, "the missing pool candidate must not be the price candidate");
  assert.deepEqual(repairInput.coverageRepair.missingCandidateIds, [poolCandidate.candidateId], "coverage repair must request exactly the compiled pool candidate that first-round tasks do not own");
  assert.equal(repairInput.coverageRepair.missingSemanticCandidates[0].propertyCatalogIdentity, "pool");
  assert.deepEqual(repairInput.coverageRepair.missingSemanticCandidates[0].evidenceRefs, poolCandidate.evidenceRefs, "coverage repair must retain the compiled pool candidate evidence exactly");
  assert.deepEqual(repairInput.coverageRepair.preservedTaskIds, ["price"]);

  const invalidLedgerFirst = JSON.parse(JSON.stringify(omittedPool));
  invalidLedgerFirst.semanticCandidates = [JSON.parse(JSON.stringify(omittedPool.semanticCandidates[0]))];
  delete invalidLedgerFirst.semanticCandidates[0].provenanceRelationCandidateIndexes;
  const invalidLedgerRepair = JSON.parse(JSON.stringify(omittedPool));
  invalidLedgerRepair.semanticCandidates = [JSON.parse(JSON.stringify(omittedPool.semanticCandidates[0]))];
  let invalidLedgerCalls = 0;
  const invalidLedgerBodies = [];
  const invalidLedgerPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async (_url, options) => {
    invalidLedgerCalls += 1;
    const body = JSON.parse(options.body);
    invalidLedgerBodies.push(body);
    const repairInput = invalidLedgerCalls > 1 ? JSON.parse(body.input[1].content[0].text).coverageRepair : null;
    const repairOutput = repairInput && repairInput.patchInvalidSemanticUnits
      ? {
          ...invalidLedgerRepair,
          repairPatchTargets: repairInput.invalidSemanticUnits.map((unit) => ({ targetCandidateId: unit.candidateId, patchTaskId: unit.taskId }))
        }
      : invalidLedgerRepair;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(invalidLedgerCalls === 1 ? invalidLedgerFirst : repairOutput) }) };
  } });
  const invalidLedgerResult = await invalidLedgerPlanner.classify({ currentMessage: coverageMessage, currentMessages: [coverageMessage], sourceEvents: [{ eventId: "coverage", messageRef: "coverage-message", messageText: coverageMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(invalidLedgerCalls, 2, "an invalid first-round semantic ledger must receive one bounded full repair");
  assert.deepEqual(validatePlannerOutput(invalidLedgerResult).errors, [], "only a fully validated repaired ledger may replace the invalid first result");
  assert.equal(invalidLedgerResult.tasks[0].type, "price");
  const invalidLedgerRepairInput = JSON.parse(invalidLedgerBodies[1].input[1].content[0].text);
  assert.equal(invalidLedgerRepairInput.coverageRepair.patchInvalidSemanticUnits, true);
  assert.equal(invalidLedgerRepairInput.coverageRepair.invalidCandidateIds.length, 1);
  assert.equal(invalidLedgerRepairInput.coverageRepair.invalidSemanticUnits.length, 1);
  const invalidLedgerDiagnostic = invalidLedgerResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(invalidLedgerDiagnostic.coverageRepairPerformed, true);
  assert.equal(invalidLedgerDiagnostic.coverageRepairSucceeded, true);
  assert.equal(invalidLedgerDiagnostic.coverageRepairFallback, false);
  assert.equal(Array.isArray(invalidLedgerDiagnostic.semanticLedgerBoundaries), true, "full repair success must retain first-round semantic-ledger boundaries");

  let invalidLedgerFallbackCalls = 0;
  const invalidLedgerFallbackPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    invalidLedgerFallbackCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(invalidLedgerFirst) }) };
  } });
  const invalidLedgerFallbackResult = await invalidLedgerFallbackPlanner.classify({ currentMessage: coverageMessage, currentMessages: [coverageMessage], sourceEvents: [{ eventId: "coverage", messageRef: "coverage-message", messageText: coverageMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(invalidLedgerFallbackCalls, 2, "invalid full repair must use its one bounded repair call");
  const invalidLedgerFallbackDiagnostic = invalidLedgerFallbackResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(invalidLedgerFallbackDiagnostic.coverageRepairFallback, true);
  assert.equal(Array.isArray(invalidLedgerFallbackDiagnostic.semanticLedgerBoundaries), true, "full repair fallback must retain first-round semantic-ledger boundaries");

  const wholeMessageText = "Ask the lodging price and confirm the pool";
  const wholeMessageCatalog = buildPropertyCatalog({
    propertyId: "whole-message-property",
    displayName: "Whole Message Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    propertyFacts: [{ canonicalId: "pool", category: "amenity", status: "available", publicText: "Pool information." }],
    semanticCatalog: { aliases: { pool: ["pool"] } }
  });
  const wholeMessagePrice = JSON.parse(JSON.stringify(omittedPool));
  wholeMessagePrice.tasks[0] = { ...wholeMessagePrice.tasks[0], sourceText: wholeMessageText, entity: { ...wholeMessagePrice.tasks[0].entity, rawText: "lodging" } };
  wholeMessagePrice.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "whole-message", messageRef: "", startOffset: 0, endOffset: wholeMessageText.length, quote: wholeMessageText }] }];
  wholeMessagePrice.semanticCandidates.find((candidate) => candidate.capability === "price" && candidate.canonicalIdentityCandidate === "price").evidenceRefs = wholeMessagePrice.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref }));
  const wholeMessagePool = JSON.parse(JSON.stringify(repairedPool));
  wholeMessagePool.tasks[0] = { ...wholeMessagePool.tasks[0], sourceText: wholeMessageText, entity: { ...wholeMessagePool.tasks[0].entity, rawText: "pool", canonicalCandidate: "pool" } };
  wholeMessagePool.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "whole-message", messageRef: "", startOffset: 0, endOffset: wholeMessageText.length, quote: wholeMessageText }] }];
  wholeMessagePool.semanticCandidates[0].evidenceRefs = wholeMessagePool.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref }));
  wholeMessagePrice.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool" && candidate.capability === "amenity").evidenceRefs = wholeMessagePool.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref }));
  let wholeMessageCalls = 0;
  const wholeMessagePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    wholeMessageCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(wholeMessageCalls === 1 ? wholeMessagePrice : wholeMessagePool) }) };
  } });
  const wholeMessageResult = await wholeMessagePlanner.classify({ currentMessage: wholeMessageText, currentMessages: [wholeMessageText], sourceEvents: [{ eventId: "whole-message", messageText: wholeMessageText }], eventTimestamp: 1, catalog: wholeMessageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(wholeMessageCalls, 2, "a whole-message price task must not suppress an omitted independent formal subject");
  assert.equal(wholeMessageResult.tasks.length, 2);
  const { semanticCandidateIds: wholePoolTaskCandidateIds, lodgingScopeId: wholePoolTaskScopeId, ...wholePoolTaskSemantics } = wholeMessageResult.tasks[1];
  assert.deepEqual(wholePoolTaskSemantics, { ...wholeMessagePool.tasks[0], candidateIndex: 1 }, "coverage repair may only add bookkeeping to the verified pool task");
  const wholePoolCandidate = wholeMessageResult.semanticCandidates.find((candidate) => candidate.capability === "amenity"
    && candidate.canonicalIdentityCandidate === "pool"
    && candidate.propertyCatalogIdentity === "pool"
    && JSON.stringify(candidate.evidenceRefs) === JSON.stringify(wholeMessagePool.contextRelationCandidates[0].evidenceRefs));
  assert.ok(wholePoolCandidate, "the repair pool candidate must exist in the compiled ledger");
  assert.deepEqual(wholePoolTaskCandidateIds, [wholePoolCandidate.candidateId], "the repaired pool task must own exactly its compiled pool candidate");
  assert.equal(wholePoolTaskScopeId, null, "the repaired unscoped pool task must remain explicitly unscoped");
  const contradictoryWholeMessagePrice = JSON.parse(JSON.stringify(wholeMessagePrice));
  contradictoryWholeMessagePrice.tasks[0].entity.canonicalCandidate = "pool";
  let contradictoryWholeMessageCalls = 0;
  const contradictoryWholeMessagePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    contradictoryWholeMessageCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(contradictoryWholeMessageCalls === 1 ? contradictoryWholeMessagePrice : wholeMessagePool) }) };
  } });
  const contradictoryWholeMessageResult = await contradictoryWholeMessagePlanner.classify({ currentMessage: wholeMessageText, currentMessages: [wholeMessageText], sourceEvents: [{ eventId: "whole-message", messageText: wholeMessageText }], eventTimestamp: 1, catalog: wholeMessageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(contradictoryWholeMessageCalls, 2, "an incompatible pool canonical candidate on a lodging-price task must not suppress the independent pool sibling");
  const { semanticCandidateIds: contradictoryPriceCandidateIds, lodgingScopeId: contradictoryPriceScopeId, ...contradictoryPriceSemantics } = contradictoryWholeMessageResult.tasks[0];
  assert.deepEqual(contradictoryPriceSemantics, contradictoryWholeMessagePrice.tasks[0], "coverage repair must preserve the contradictory price-task semantics");
  const contradictoryPriceCandidate = contradictoryWholeMessageResult.semanticCandidates.find((candidate) => candidate.capability === "price"
    && candidate.canonicalIdentityCandidate === "price"
    && candidate.propertyCatalogIdentity === null
    && JSON.stringify(candidate.evidenceRefs) === JSON.stringify(wholeMessagePrice.contextRelationCandidates[0].evidenceRefs));
  assert.ok(contradictoryPriceCandidate, "the contradictory price task must retain its compiled price candidate");
  assert.deepEqual(contradictoryPriceCandidateIds, [contradictoryPriceCandidate.candidateId]);
  assert.equal(contradictoryPriceScopeId, null);
  assert.equal(contradictoryWholeMessageResult.tasks.length, 2);


  const multiFormalText = "Ask the fee for the pool and confirm parking";
  const multiFormalCatalog = buildPropertyCatalog({
    propertyId: "multi-formal-property",
    displayName: "Multi Formal Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    propertyFacts: [
      { canonicalId: "pool", category: "amenity", status: "available", publicText: "Pool information." },
      { canonicalId: "parking", category: "amenity", status: "available", publicText: "Parking information." }
    ],
    semanticCatalog: { aliases: { pool: ["pool"], parking: ["parking"] } }
  });
  const multiFormalPrice = JSON.parse(JSON.stringify(wholeMessagePrice));
  multiFormalPrice.tasks[0] = { ...multiFormalPrice.tasks[0], sourceText: multiFormalText, entity: { category: "policy", rawText: "pool", canonicalCandidate: "pool", confidence: 1 } };
  multiFormalPrice.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "multi-formal", messageRef: "", startOffset: 0, endOffset: multiFormalText.length, quote: multiFormalText }] }];
  const multiFormalRepair = JSON.parse(JSON.stringify(repairedPool));
  multiFormalRepair.tasks = [
    { ...multiFormalRepair.tasks[0], candidateIndex: 0, taskId: "repair-pool", sourceText: "pool", entity: { ...multiFormalRepair.tasks[0].entity, rawText: "pool", canonicalCandidate: "pool" } },
    { ...multiFormalRepair.tasks[0], candidateIndex: 1, taskId: "repair-parking", sourceText: "parking", entity: { ...multiFormalRepair.tasks[0].entity, rawText: "parking", canonicalCandidate: "parking" } }
  ];
  multiFormalRepair.contextRelationCandidates = [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "multi-formal", messageRef: "", startOffset: 20, endOffset: 24, quote: "pool" }] },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "multi-formal", messageRef: "", startOffset: 37, endOffset: 44, quote: "parking" }] }
  ];
  let multiFormalCalls = 0;
  multiFormalPrice.semanticCandidates = [
    { semanticKind: "capability", capability: "price", canonicalIdentityCandidate: "price", coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: multiFormalPrice.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: null },
    { semanticKind: "catalog_subject", capability: "amenity", canonicalIdentityCandidate: "pool", coverageStatus: "pending_task", evidenceRefs: multiFormalRepair.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: "pool" },
    { semanticKind: "catalog_subject", capability: "amenity", canonicalIdentityCandidate: "parking", coverageStatus: "pending_task", evidenceRefs: multiFormalRepair.contextRelationCandidates[1].evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: "parking" }
  ];
  multiFormalRepair.semanticCandidates = multiFormalPrice.semanticCandidates.slice(1).map((candidate, index) => ({ ...candidate, coverageStatus: "bound", provenanceRelationCandidateIndexes: [index], evidenceRefs: candidate.evidenceRefs.map((ref) => ({ ...ref })) }));
  const multiFormalPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    multiFormalCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(multiFormalCalls === 1 ? multiFormalPrice : multiFormalRepair) }) };
  } });
  const multiFormalResult = await multiFormalPlanner.classify({ currentMessage: multiFormalText, currentMessages: [multiFormalText], sourceEvents: [{ eventId: "multi-formal", messageText: multiFormalText }], eventTimestamp: 1, catalog: multiFormalCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(multiFormalCalls, 2);
  const { semanticCandidateIds: multiFormalPriceCandidateIds, lodgingScopeId: multiFormalPriceScopeId, ...multiFormalPriceSemantics } = multiFormalResult.tasks[0];
  assert.deepEqual(multiFormalPriceSemantics, multiFormalPrice.tasks[0], "multi-formal repair must preserve first-round price-task semantics");
  const multiFormalPriceCandidate = multiFormalResult.semanticCandidates.find((candidate) => candidate.capability === "price" && candidate.canonicalIdentityCandidate === "price" && candidate.propertyCatalogIdentity === null);
  assert.ok(multiFormalPriceCandidate, "multi-formal ledger must retain the raw price semantic candidate");
  assert.deepEqual(multiFormalPriceCandidateIds, [multiFormalPriceCandidate.candidateId]);
  assert.equal(multiFormalPriceScopeId, null);
  assert.deepEqual(new Set(multiFormalResult.tasks.slice(1).map((task) => task.entity.canonicalCandidate)), new Set(["pool", "parking"]), "one fee-drift task must not suppress another formal subject in the same source");

  let incompleteCalls = 0;
  const incompletePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    incompleteCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(incompleteCalls === 1 ? omittedPool : repairedPool) }) };
  } });
  const incompleteResult = await incompletePlanner.classify({ currentMessage: coverageMessage, currentMessages: [coverageMessage], sourceEvents: [{ eventId: "coverage", messageRef: "coverage-message", messageText: coverageMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(incompleteCalls, 2);
  const conditionalPoolMessage = "not using the pool, is the lodging price 7000";
  const conditionalPoolPrice = JSON.parse(JSON.stringify(wholeMessagePrice));
  conditionalPoolPrice.tasks[0] = { ...conditionalPoolPrice.tasks[0], sourceText: conditionalPoolMessage, entity: { category: "amenity", rawText: "pool", canonicalCandidate: "pool", confidence: 1 } };
  conditionalPoolPrice.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "conditional-pool", messageRef: "", startOffset: 0, endOffset: conditionalPoolMessage.length, quote: conditionalPoolMessage }] }];
  const conditionalPoolRepair = JSON.parse(JSON.stringify(repairedPool));
  conditionalPoolRepair.tasks[0] = { ...conditionalPoolRepair.tasks[0], sourceText: "not using the pool", entity: { ...conditionalPoolRepair.tasks[0].entity, rawText: "pool" } };
  conditionalPoolRepair.contextRelationCandidates[0].evidenceRefs = [{ eventId: "conditional-pool", messageRef: "", startOffset: 0, endOffset: 18, quote: "not using the pool" }];
  conditionalPoolPrice.semanticCandidates.find((candidate) => candidate.capability === "price" && candidate.canonicalIdentityCandidate === "price").evidenceRefs = conditionalPoolPrice.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref }));
  conditionalPoolPrice.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool" && candidate.capability === "amenity").evidenceRefs = conditionalPoolRepair.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref }));
  conditionalPoolRepair.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool" && candidate.capability === "amenity").evidenceRefs = conditionalPoolRepair.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref }));
  let conditionalPoolCalls = 0;
  const conditionalPoolPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(++conditionalPoolCalls === 1 ? conditionalPoolPrice : conditionalPoolRepair) }) }) });
  const conditionalPoolResult = await conditionalPoolPlanner.classify({ currentMessage: conditionalPoolMessage, currentMessages: [conditionalPoolMessage], sourceEvents: [{ eventId: "conditional-pool", messageText: conditionalPoolMessage }], eventTimestamp: 1, catalog: wholeMessageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(conditionalPoolCalls, 2, "a facility usage condition must not be swallowed as the target of a lodging-price task");
  assert.equal(conditionalPoolResult.tasks.length, 2);
  const suffixPoolMessage = "the pool will not be used, is the lodging price 7000";
  const suffixPoolPrice = JSON.parse(JSON.stringify(conditionalPoolPrice));
  suffixPoolPrice.tasks[0] = { ...suffixPoolPrice.tasks[0], sourceText: suffixPoolMessage };
  suffixPoolPrice.contextRelationCandidates[0].evidenceRefs = [{ eventId: "suffix-pool", messageRef: "", startOffset: 0, endOffset: suffixPoolMessage.length, quote: suffixPoolMessage }];
  const suffixPoolRepair = JSON.parse(JSON.stringify(conditionalPoolRepair));
  suffixPoolRepair.tasks[0] = { ...suffixPoolRepair.tasks[0], sourceText: "the pool will not be used" };
  suffixPoolRepair.contextRelationCandidates[0].evidenceRefs = [{ eventId: "suffix-pool", messageRef: "", startOffset: 0, endOffset: 25, quote: "the pool will not be used" }];
  let suffixPoolCalls = 0;
  suffixPoolPrice.semanticCandidates.find((candidate) => candidate.capability === "price" && candidate.canonicalIdentityCandidate === "price").evidenceRefs = suffixPoolPrice.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref }));
  suffixPoolPrice.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool" && candidate.capability === "amenity").evidenceRefs = suffixPoolRepair.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref }));
  suffixPoolRepair.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool" && candidate.capability === "amenity").evidenceRefs = suffixPoolRepair.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref }));
  const suffixPoolPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(++suffixPoolCalls === 1 ? suffixPoolPrice : suffixPoolRepair) }) }) });
  const suffixPoolResult = await suffixPoolPlanner.classify({ currentMessage: suffixPoolMessage, currentMessages: [suffixPoolMessage], sourceEvents: [{ eventId: "suffix-pool", messageText: suffixPoolMessage }], eventTimestamp: 1, catalog: wholeMessageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(suffixPoolCalls, 2, "a postpositive facility usage condition must not be swallowed by lodging price");
  assert.equal(suffixPoolResult.tasks.length, 2);

  const lodgingCatalog = buildPropertyCatalog({
    propertyId: "lodging-coverage-property",
    displayName: "Lodging Coverage Property",
    timezone: "Asia/Taipei",
    rooms: [
      { id: "room301", name: "301 \u96d9\u4eba\u623f", type: "\u96d9\u4eba\u623f", capacity: 2, enabled: true },
      { id: "room302", name: "302 \u56db\u4eba\u623f", type: "\u56db\u4eba\u623f", capacity: 4, enabled: true },
      { id: "room401", name: "401 \u96d9\u4eba\u623f", type: "\u96d9\u4eba\u623f", capacity: 2, enabled: true },
      { id: "room402", name: "402 \u56db\u4eba\u623f", type: "\u56db\u4eba\u623f", capacity: 4, enabled: true },
      { id: "whole-house", name: "\u56db\u623f\u5305\u68df", type: "\u5305\u68df", inventoryType: "bundle", capacity: 10, enabled: true, memberRoomIds: ["room301", "room302", "room401", "room402"] }
    ],
    commonAnswers: {},
    semanticCatalog: { aliases: { room301: ["301"], room302: ["302"], room401: ["401"], room402: ["402"], "whole-house": ["\u5305\u68df"] } }
  });
  const lodgingMessage = "\u60f3\u4e86\u89e37\u6708\u9031\u516d\u56db\u4eba\u623f\u50f9\u683c";
  const lodgingPriceOutput = JSON.parse(JSON.stringify(wholeMessagePrice));
  lodgingPriceOutput.tasks[0] = { ...lodgingPriceOutput.tasks[0], sourceText: lodgingMessage, entity: { category: "room", rawText: "\u56db\u4eba\u623f", canonicalCandidate: null, confidence: 1 }, stayCandidate: { dateExpression: { rawText: "7\u6708\u9031\u516d", kind: "weekend", anchor: "message_time" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null } };
  lodgingPriceOutput.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "lodging-coverage", messageRef: "", startOffset: 0, endOffset: lodgingMessage.length, quote: lodgingMessage }] }];
  const lodgingRepairOutput = JSON.parse(JSON.stringify(lodgingPriceOutput));
  lodgingRepairOutput.tasks = [
    { ...lodgingPriceOutput.tasks[0], candidateIndex: 0, taskId: "room302", sourceText: "\u56db\u4eba\u623f", entity: { category: "room", rawText: "\u56db\u4eba\u623f", canonicalCandidate: "room302", confidence: 1 } },
    { ...lodgingPriceOutput.tasks[0], candidateIndex: 1, taskId: "room402", sourceText: "\u56db\u4eba\u623f", entity: { category: "room", rawText: "\u56db\u4eba\u623f", canonicalCandidate: "room402", confidence: 1 } }
  ];
  lodgingRepairOutput.tasks[0].semanticCandidateIds = [ROOM302_CANDIDATE_ID];
  lodgingRepairOutput.tasks[1].semanticCandidateIds = [ROOM402_CANDIDATE_ID];
  const quadOffset = lodgingMessage.indexOf("\u56db\u4eba\u623f");
  lodgingRepairOutput.tasks.push({ ...lodgingPriceOutput.tasks[0], candidateIndex: 2, taskId: "repair-temporal", type: "availability", sourceText: lodgingMessage, requestedOutputs: ["availability"], entity: { category: "room", rawText: "\u56db\u4eba\u623f", canonicalCandidate: null, confidence: 1 }, semanticCandidateIds: [TEMPORAL_CANDIDATE_ID], lodgingScopeId: null });
  lodgingRepairOutput.contextRelationCandidates = lodgingRepairOutput.tasks.map((task) => ({ candidateIndex: task.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "lodging-coverage", messageRef: "", startOffset: quadOffset, endOffset: quadOffset + 3, quote: "\u56db\u4eba\u623f" }] }));
  let lodgingCoverageCalls = 0;
  lodgingRepairOutput.contextRelationCandidates[2] = { candidateIndex: 2, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "lodging-coverage", messageRef: "", startOffset: 0, endOffset: lodgingMessage.length, quote: lodgingMessage }] };
  lodgingPriceOutput.semanticCandidates = [
    {
      candidateId: ROOM302_CANDIDATE_ID,
      semanticKind: "catalog_subject",
      capability: "price",
      canonicalIdentityCandidate: "room302",
      coverageStatus: "pending_task",
      evidenceRefs: lodgingRepairOutput.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })),
      lodgingScopeCandidate: null,
      temporalSemanticCandidate: null,
      propertyCatalogIdentity: "room302"
    },
    {
      candidateId: ROOM402_CANDIDATE_ID,
      semanticKind: "catalog_subject",
      capability: "price",
      canonicalIdentityCandidate: "room402",
      coverageStatus: "pending_task",
      evidenceRefs: lodgingRepairOutput.contextRelationCandidates[1].evidenceRefs.map((ref) => ({ ...ref })),
      lodgingScopeCandidate: null,
      temporalSemanticCandidate: null,
      propertyCatalogIdentity: "room402"
    },
    {
      candidateId: TEMPORAL_CANDIDATE_ID,
      semanticKind: "temporal_pattern",
      capability: "availability",
      canonicalIdentityCandidate: "temporal_pattern",
      coverageStatus: "pending_task",
      evidenceRefs: lodgingRepairOutput.contextRelationCandidates[2].evidenceRefs.map((ref) => ({ ...ref })),
      lodgingScopeCandidate: null,
      temporalSemanticCandidate: { ...lodgingPriceOutput.tasks[0].stayCandidate.dateExpression },
      propertyCatalogIdentity: null
    }
  ];
  lodgingPriceOutput.semanticCandidates.unshift({ semanticKind: "capability", capability: "price", canonicalIdentityCandidate: "price", coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: lodgingPriceOutput.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: null });
  lodgingPriceOutput.semanticCandidates = lodgingPriceOutput.semanticCandidates.map((candidate) => { const { candidateId, ...intent } = candidate; return intent; });
  lodgingRepairOutput.semanticCandidates = lodgingPriceOutput.semanticCandidates.slice(1).map((candidate, index) => ({ ...candidate, coverageStatus: "bound", provenanceRelationCandidateIndexes: [index], evidenceRefs: candidate.evidenceRefs.map((ref) => ({ ...ref })) }));  const lodgingCoverageBodies = [];
  const lodgingCoveragePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async (_url, options) => { lodgingCoverageBodies.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(++lodgingCoverageCalls === 1 ? lodgingPriceOutput : lodgingRepairOutput) }) }; } });
  const lodgingCoverageResult = await lodgingCoveragePlanner.classify({ currentMessage: lodgingMessage, currentMessages: [lodgingMessage], sourceEvents: [{ eventId: "lodging-coverage", messageText: lodgingMessage }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(lodgingCoverageCalls, 2, "an omitted explicit lodging inventory set must enter the bounded coverage round");
  assert.deepEqual(JSON.parse(lodgingCoverageBodies[1].input[1].content[0].text).coverageRepair.missingCandidateIds, lodgingCoverageResult.semanticCandidates.filter((candidate) => ["room302", "room402", "temporal_pattern"].includes(candidate.propertyCatalogIdentity || candidate.canonicalIdentityCandidate)).map((candidate) => candidate.candidateId));
  assert.equal(lodgingCoverageResult.tasks.some((task) => ["availability", "bundle_availability", "room_options"].includes(task.type)), true, "a broad date-dependent room price must retain a date-clarification capability");
  const resolvedLodgingPrice = JSON.parse(JSON.stringify(lodgingPriceOutput));
  resolvedLodgingPrice.tasks[0].sourceText = "7\u6708\u9031\u516d302\u50f9\u683c";
  resolvedLodgingPrice.tasks[0].entity = { category: "room", rawText: "302", canonicalCandidate: "room302", confidence: 1 };
  resolvedLodgingPrice.contextRelationCandidates[0].evidenceRefs = [{ eventId: "resolved-lodging", messageRef: "", startOffset: 0, endOffset: resolvedLodgingPrice.tasks[0].sourceText.length, quote: resolvedLodgingPrice.tasks[0].sourceText }];
  resolvedLodgingPrice.tasks.push({ ...resolvedLodgingPrice.tasks[0], candidateIndex: 1, taskId: "resolved-date-availability", type: "availability", requestedOutputs: ["availability"] });
  resolvedLodgingPrice.contextRelationCandidates.push({ ...resolvedLodgingPrice.contextRelationCandidates[0], candidateIndex: 1, evidenceRefs: resolvedLodgingPrice.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })) });
  resolvedLodgingPrice.semanticCandidates = [{ semanticKind: "capability", capability: "price", canonicalIdentityCandidate: "price", coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: resolvedLodgingPrice.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: null }, { semanticKind: "catalog_subject", capability: "availability", canonicalIdentityCandidate: "room302", coverageStatus: "bound", provenanceRelationCandidateIndexes: [1], evidenceRefs: resolvedLodgingPrice.contextRelationCandidates[1].evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: "room302" }];
  let resolvedLodgingCalls = 0;
  const resolvedLodgingPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((resolvedLodgingCalls += 1) && resolvedLodgingPrice) }) }) });
  const resolvedLodgingResult = await resolvedLodgingPlanner.classify({ currentMessage: resolvedLodgingPrice.tasks[0].sourceText, currentMessages: [resolvedLodgingPrice.tasks[0].sourceText], sourceEvents: [{ eventId: "resolved-lodging", messageText: resolvedLodgingPrice.tasks[0].sourceText }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(resolvedLodgingCalls, 1, "a resolved inventory subject must not spend a second provider call");
  assert.equal(resolvedLodgingResult.tasks.some((task) => ["availability", "bundle_availability"].includes(task.type)), true, "date clarification must not depend on a missing inventory subject");
  const resolvedLodgingDiagnostic = resolvedLodgingResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  const recurringDateTask = resolvedLodgingResult.tasks.find((task) => ["availability", "bundle_availability"].includes(task.type));
  assert.equal(recurringDateTask.semanticCandidateIds.length, 1, "first-round availability must directly own exactly one semantic candidate");
  const recurringCandidateId = recurringDateTask.semanticCandidateIds[0];
  const recurringCandidates = resolvedLodgingResult.semanticCandidates.filter((candidate) => candidate.candidateId === recurringCandidateId);
  assert.equal(recurringCandidates.length, 1, "the owned candidate ID must join uniquely to the ledger");
  assert.equal(recurringCandidates[0].capability, recurringDateTask.type);
  const recurringRelation = resolvedLodgingResult.contextRelationCandidates.find((relation) => relation.candidateIndex === recurringDateTask.candidateIndex);
  assert.deepEqual(recurringCandidates[0].evidenceRefs, recurringRelation.evidenceRefs, "candidate and first-round task must share direct evidence ownership");
  assert.notEqual(resolvedLodgingDiagnostic.coverageRepairPerformed, true, "a first-round sibling must not be labeled as repair");
  assert.equal(Array.isArray(resolvedLodgingDiagnostic.repairLinks) ? resolvedLodgingDiagnostic.repairLinks.length : 0, 0, "a first-round sibling must not receive repair provenance");
  const alternateDateShape = JSON.parse(JSON.stringify(resolvedLodgingPrice));
  alternateDateShape.tasks[0].stayCandidate.dateExpression.kind = "absolute";
  let alternateDateCalls = 0;
  const alternateDatePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((alternateDateCalls += 1) && alternateDateShape) }) }) });
  const alternateDateResult = await alternateDatePlanner.classify({ currentMessage: alternateDateShape.tasks[0].sourceText, currentMessages: [alternateDateShape.tasks[0].sourceText], sourceEvents: [{ eventId: "resolved-lodging", messageText: alternateDateShape.tasks[0].sourceText }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(alternateDateCalls, 1);
  assert.equal(alternateDateResult.tasks.some((task) => ["availability", "bundle_availability"].includes(task.type)), true, "verified month-qualified recurring evidence must survive a legal Planner date-kind drift");
  const omittedDateShape = JSON.parse(JSON.stringify(resolvedLodgingPrice));
  omittedDateShape.tasks[0].stayCandidate.dateExpression = { rawText: "", kind: "none", anchor: "none" };
  let omittedDateCalls = 0;
  const omittedDatePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((omittedDateCalls += 1) && omittedDateShape) }) }) });
  const omittedDateResult = await omittedDatePlanner.classify({ currentMessage: omittedDateShape.tasks[0].sourceText, currentMessages: [omittedDateShape.tasks[0].sourceText], sourceEvents: [{ eventId: "resolved-lodging", messageText: omittedDateShape.tasks[0].sourceText }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(omittedDateCalls, 1, "catalog-grounded recurring-date coverage must not spend the bounded provider supplement call");
  assert.equal(omittedDateResult.tasks.some((task) => ["availability", "bundle_availability"].includes(task.type)), true, "verified recurring evidence in the current message must survive an omitted Planner date expression");
  const mixedLodgingMessage = "7\u6708\u9031\u516d301\u50f9\u683c\uff0c\u53e6\u5916302\u660e\u5929\u6709\u7a7a\u55ce";
  const mixedLodgingOutput = JSON.parse(JSON.stringify(resolvedLodgingPrice));
  mixedLodgingOutput.tasks[0] = { ...mixedLodgingOutput.tasks[0], sourceText: "7\u6708\u9031\u516d301\u50f9\u683c", entity: { category: "room", rawText: "301", canonicalCandidate: "room301", confidence: 1 } };
  mixedLodgingOutput.tasks[1] = { ...mixedLodgingOutput.tasks[0], candidateIndex: 1, taskId: "room301-recurring", type: "availability", requestedOutputs: ["availability"] };
  mixedLodgingOutput.tasks.push({ ...mixedLodgingOutput.tasks[0], candidateIndex: 2, taskId: "room302-tomorrow", type: "availability", sourceText: "302\u660e\u5929\u6709\u7a7a\u55ce", requestedOutputs: ["availability"], entity: { category: "room", rawText: "302", canonicalCandidate: "room302", confidence: 1 }, stayCandidate: { dateExpression: { rawText: "\u660e\u5929", kind: "relative", anchor: "message_time" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null } });
  mixedLodgingOutput.semanticCandidates = [];
  mixedLodgingOutput.contextRelationCandidates = mixedLodgingOutput.tasks.map((task) => { const startOffset = mixedLodgingMessage.indexOf(task.sourceText); return { candidateIndex: task.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "mixed-lodging", messageRef: "", startOffset, endOffset: startOffset + task.sourceText.length, quote: task.sourceText }] }; });
  let mixedLodgingCalls = 0;
  const mixedLodgingPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((mixedLodgingCalls += 1) && mixedLodgingOutput) }) }) });
  const mixedLodgingResult = await mixedLodgingPlanner.classify({ currentMessage: mixedLodgingMessage, currentMessages: [mixedLodgingMessage], sourceEvents: [{ eventId: "mixed-lodging", messageText: mixedLodgingMessage }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(mixedLodgingCalls, 1);
  assert.equal(mixedLodgingResult.tasks.filter((task) => task.entity && task.entity.canonicalCandidate === "room301" && task.type === "availability").length, 1, "an unrelated room availability task must not suppress the recurring-date companion");
  assert.equal(mixedLodgingResult.tasks.some((task) => task.taskId === "room302-tomorrow"), true, "the unrelated availability task must remain unchanged");

  const alreadyClarifiedOutput = JSON.parse(JSON.stringify(resolvedLodgingPrice));
  alreadyClarifiedOutput.tasks.push({ ...alreadyClarifiedOutput.tasks[0], candidateIndex: 1, taskId: "existing-date-clarification", type: "availability", requestedOutputs: ["availability"] });
  alreadyClarifiedOutput.contextRelationCandidates.push({ ...alreadyClarifiedOutput.contextRelationCandidates[0], candidateIndex: 1 });
  alreadyClarifiedOutput.tasks = alreadyClarifiedOutput.tasks.slice(0, 2);
  alreadyClarifiedOutput.contextRelationCandidates = alreadyClarifiedOutput.contextRelationCandidates.slice(0, 2);
  let alreadyClarifiedCalls = 0;
  const alreadyClarifiedPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((alreadyClarifiedCalls += 1) && alreadyClarifiedOutput) }) }) });
  const alreadyClarifiedResult = await alreadyClarifiedPlanner.classify({ currentMessage: resolvedLodgingPrice.tasks[0].sourceText, currentMessages: [resolvedLodgingPrice.tasks[0].sourceText], sourceEvents: [{ eventId: "resolved-lodging", messageText: resolvedLodgingPrice.tasks[0].sourceText }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(alreadyClarifiedCalls, 1);
  assert.equal(alreadyClarifiedResult.tasks.filter((task) => task.type === "availability").length, 1, "the same source, inventory, recurring date, and relation must not receive a duplicate clarification");

  for (const removalMessage of [
    "\u4e0d\u8981 301\uff0c\u53ea\u8981 302",
    "not 301, use 302",
    "not room 301, use room 302",
    "do not use room 301, use room 302",
    "\u4e0d\u8981\u623f\u9593 301\uff0c\u53ea\u8981 302",
    "\u4e0d\u8981\u4f4f 301\uff0c\u53ea\u8981 302"
  ]) {
    const removalOutput = JSON.parse(JSON.stringify(resolvedLodgingPrice));
    removalOutput.tasks[0] = { ...removalOutput.tasks[0], type: "availability", requestedOutputs: ["availability"], sourceText: removalMessage, entity: { category: "room", rawText: "302", canonicalCandidate: "room302", confidence: 1 }, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null } };
    removalOutput.contextRelationCandidates[0].evidenceRefs = [{ eventId: "inventory-removal", messageRef: "", startOffset: 0, endOffset: removalMessage.length, quote: removalMessage }];
    let removalCalls = 0;
    const removalPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((removalCalls += 1) && removalOutput) }) }) });
    const removalResult = await removalPlanner.classify({ currentMessage: removalMessage, currentMessages: [removalMessage], sourceEvents: [{ eventId: "inventory-removal", messageText: removalMessage }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
    assert.equal(removalCalls, 1, "a removed inventory mention must not trigger additive coverage");
    assert.deepEqual(new Set(removalResult.tasks.map((task) => task.entity && task.entity.canonicalCandidate).filter(Boolean)), new Set(["room302"]));
  }

  const twoRecurringPricesMessage = "301 7\u6708\u9031\u516d\u591a\u5c11\u9322\uff0c302 7\u6708\u9031\u516d\u591a\u5c11\u9322";
  const twoRecurringPricesOutput = JSON.parse(JSON.stringify(resolvedLodgingPrice));
  twoRecurringPricesOutput.tasks = ["301", "302"].map((roomNumber, candidateIndex) => ({
    ...twoRecurringPricesOutput.tasks[0],
    candidateIndex,
    taskId: `recurring-price-${roomNumber}`,
    sourceText: `${roomNumber} 7\u6708\u9031\u516d\u591a\u5c11\u9322`,
    entity: { category: "room", rawText: roomNumber, canonicalCandidate: `room${roomNumber}`, confidence: 1 }
  }));
  const recurringAvailabilityTaskIds = ["72000000-0000-4000-8000-000000000001", "72000000-0000-4000-8000-000000000002"];
  twoRecurringPricesOutput.tasks.push(...twoRecurringPricesOutput.tasks.map((task, index) => ({ ...task, candidateIndex: index + 2, taskId: recurringAvailabilityTaskIds[index], type: "availability", requestedOutputs: ["availability"] })));
  twoRecurringPricesOutput.semanticCandidates = [];

  twoRecurringPricesOutput.contextRelationCandidates = twoRecurringPricesOutput.tasks.map((task) => { const startOffset = twoRecurringPricesMessage.indexOf(task.sourceText); return { candidateIndex: task.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "two-recurring-prices", messageRef: "", startOffset, endOffset: startOffset + task.sourceText.length, quote: task.sourceText }] }; });
  let twoRecurringPricesCalls = 0;
  const twoRecurringPricesPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((twoRecurringPricesCalls += 1) && twoRecurringPricesOutput) }) }) });
  const twoRecurringPricesResult = await twoRecurringPricesPlanner.classify({ currentMessage: twoRecurringPricesMessage, currentMessages: [twoRecurringPricesMessage], sourceEvents: [{ eventId: "two-recurring-prices", messageText: twoRecurringPricesMessage }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(twoRecurringPricesCalls, 1);
  assert.deepEqual(new Set(twoRecurringPricesResult.tasks.filter((task) => task.type === "availability").map((task) => task.entity.canonicalCandidate)), new Set(["room301", "room302"]), "every independently scoped recurring-price task needs its own clarification companion");

  const duplicateRecurringPriceOutput = JSON.parse(JSON.stringify(resolvedLodgingPrice));
  duplicateRecurringPriceOutput.tasks.push({ ...duplicateRecurringPriceOutput.tasks[0], candidateIndex: 2, taskId: "72000000-0000-4000-8000-000000000003" });
  duplicateRecurringPriceOutput.contextRelationCandidates.push({ ...duplicateRecurringPriceOutput.contextRelationCandidates[0], candidateIndex: 2 });
  duplicateRecurringPriceOutput.semanticCandidates = [];
  let duplicateRecurringPriceCalls = 0;
  const duplicateRecurringPricePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((duplicateRecurringPriceCalls += 1) && duplicateRecurringPriceOutput) }) }) });
  const duplicateRecurringPriceResult = await duplicateRecurringPricePlanner.classify({ currentMessage: resolvedLodgingPrice.tasks[0].sourceText, currentMessages: [resolvedLodgingPrice.tasks[0].sourceText], sourceEvents: [{ eventId: "resolved-lodging", messageText: resolvedLodgingPrice.tasks[0].sourceText }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(duplicateRecurringPriceCalls, 1);
  assert.equal(duplicateRecurringPriceResult.tasks.filter((task) => task.type === "availability").length, 1, "duplicate price tasks with the same semantic scope must share one clarification companion");

  const numberedMessage = "7/16-7/17 \u4e94\u4f4d\u5927\u4eba \u5305\u68df\u9700\u6c42 (301/302)";
  const numberedFirst = JSON.parse(JSON.stringify(lodgingPriceOutput));
  numberedFirst.tasks[0] = { ...numberedFirst.tasks[0], taskId: "bundle", type: "availability", sourceText: numberedMessage, requestedOutputs: ["availability"], entity: { category: "bundle", rawText: "\u5305\u68df", canonicalCandidate: "whole-house", confidence: 1 }, stayCandidate: { dateExpression: { rawText: "7/16-7/17", kind: "range", anchor: "message_time" }, checkInCandidate: "2026-07-16", checkOutCandidate: "2026-07-17", nightsCandidate: 1, guestCountCandidate: 5 } };
  numberedFirst.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "numbered-coverage", messageRef: "", startOffset: 0, endOffset: numberedMessage.length, quote: numberedMessage }] }];
  const numberedLodgingScope = { bundleCanonicalCandidate: "whole-house", roomCanonicalCandidates: ["room301", "room302"], guestCountCandidate: 5 };
  const bundleStartOffset = numberedMessage.indexOf("\u5305\u68df");
  numberedFirst.semanticCandidates = [{
    semanticKind: "lodging_scope",
    capability: "bundle_availability",
    canonicalIdentityCandidate: "whole-house",
    coverageStatus: "bound",
    provenanceRelationCandidateIndexes: [0],
    evidenceRefs: [{ eventId: "numbered-coverage", messageRef: "", startOffset: bundleStartOffset, endOffset: bundleStartOffset + 2, quote: "\u5305\u68df" }],
    lodgingScopeCandidate: numberedLodgingScope,
    temporalSemanticCandidate: { ...numberedFirst.tasks[0].stayCandidate.dateExpression },
    propertyCatalogIdentity: "whole-house"
  }, ...["301", "302"].map((roomNumber) => {
    const startOffset = numberedMessage.indexOf(roomNumber);
    return {
      semanticKind: "lodging_scope",
      capability: "availability",
      canonicalIdentityCandidate: `room${roomNumber}`,
      coverageStatus: "pending_task",
      evidenceRefs: [{ eventId: "numbered-coverage", messageRef: "", startOffset, endOffset: startOffset + roomNumber.length, quote: roomNumber }],
      lodgingScopeCandidate: numberedLodgingScope,
      temporalSemanticCandidate: { ...numberedFirst.tasks[0].stayCandidate.dateExpression },
      propertyCatalogIdentity: `room${roomNumber}`
    };
  })];
  const numberedRepairOutput = () => {
    const repaired = JSON.parse(JSON.stringify(lodgingRepairOutput));
    repaired.tasks = ["301", "302"].map((roomNumber, index) => ({
      ...repaired.tasks[index],
      candidateIndex: index,
      taskId: ["74000000-0000-4000-8000-000000000001", "74000000-0000-4000-8000-000000000002"][index],
      type: "availability",
      sourceText: roomNumber,
      requestedOutputs: ["availability"],
      entity: { category: "room", rawText: roomNumber, canonicalCandidate: `room${roomNumber}`, confidence: 1 },
      stayCandidate: numberedFirst.tasks[0].stayCandidate
    }));
    repaired.contextRelationCandidates = repaired.tasks.map((task) => { const startOffset = numberedMessage.indexOf(task.sourceText); return { candidateIndex: task.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "numbered-coverage", messageRef: "", startOffset, endOffset: startOffset + task.sourceText.length, quote: task.sourceText }] }; });
    repaired.semanticCandidates = numberedFirst.semanticCandidates.filter((candidate) => candidate.propertyCatalogIdentity && candidate.propertyCatalogIdentity.startsWith("room")).map((candidate, index) => ({ ...candidate, coverageStatus: "bound", provenanceRelationCandidateIndexes: [index], evidenceRefs: candidate.evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: { ...candidate.lodgingScopeCandidate, roomCanonicalCandidates: [...candidate.lodgingScopeCandidate.roomCanonicalCandidates] }, temporalSemanticCandidate: { ...candidate.temporalSemanticCandidate } }));
    return repaired;
  };
  let numberedCalls = 0;
  const numberedPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => { numberedCalls += 1; return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(numberedCalls === 1 ? numberedFirst : numberedRepairOutput()) }) }; } });
  const numberedResult = await numberedPlanner.classify({ currentMessage: numberedMessage, currentMessages: [numberedMessage], sourceEvents: [{ eventId: "numbered-coverage", messageText: numberedMessage }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(numberedCalls, 2, "room numbers stated beside a bundle must receive additive inventory coverage");
  assert.deepEqual(new Set(numberedResult.tasks.map((task) => task.entity && task.entity.canonicalCandidate).filter(Boolean)), new Set(["whole-house", "room301", "room302"]));
  let numberedFallbackCalls = 0;
  const numberedFallbackPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((numberedFallbackCalls += 1) === 1 ? numberedFirst : numberedRepairOutput()) }) }) });
  const numberedFallbackResult = await numberedFallbackPlanner.classify({ currentMessage: numberedMessage, currentMessages: [numberedMessage], sourceEvents: [{ eventId: "numbered-coverage", messageText: numberedMessage }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(numberedFallbackCalls, 2, "explicit inventory coverage remains bounded to one supplement call when the second legal shape repeats the omission");
  assert.deepEqual(new Set(numberedFallbackResult.tasks.map((task) => task.entity && task.entity.canonicalCandidate).filter(Boolean)), new Set(["whole-house", "room301", "room302"]), "explicit inventory siblings must survive a repeated omission from the second Planner output");
  const numberedFallbackDiagnostic = numberedFallbackResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(numberedFallbackDiagnostic.repairLinks.filter((link) => ["room301", "room302"].some((id) => numberedFallbackResult.tasks.some((task) => task.taskId === link.taskId && task.entity.canonicalCandidate === id))).length, 2, "each deterministic inventory sibling must retain its own direct repair provenance");
  assert.equal(numberedFallbackDiagnostic.coverageRepairSucceeded, true, "post-merge deterministic room coverage must report the completed canonical coverage truthfully");


  const capacityMessage = "3/6-3/7 \u4eba\u6578\u5927\u69826-8\u4eba";
  const capacityFirst = JSON.parse(JSON.stringify(numberedFirst));
  capacityFirst.tasks[0] = { ...capacityFirst.tasks[0], taskId: "capacity-availability", sourceText: capacityMessage, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, stayCandidate: { dateExpression: { rawText: "3/6-3/7", kind: "range", anchor: "message_time" }, checkInCandidate: "2026-03-06", checkOutCandidate: "2026-03-07", nightsCandidate: 1, guestCountCandidate: 8 } };
  capacityFirst.stay = { dateExpression: { rawText: "2099-01-01", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2099-01-01", checkOutCandidate: "2099-01-02", nightsCandidate: 1, guestCountCandidate: 1 };
  capacityFirst.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "capacity-coverage", messageRef: "", startOffset: 0, endOffset: capacityMessage.length, quote: capacityMessage }] }];
  const capacityRepair = JSON.parse(JSON.stringify(capacityFirst));
  capacityRepair.tasks[0] = { ...capacityFirst.tasks[0], taskId: "whole-house", type: "bundle_availability", sourceText: "6-8\u4eba", requestedOutputs: ["availability"], entity: { category: "bundle", rawText: "\u5305\u68df", canonicalCandidate: "whole-house", confidence: 1 } };
  const capacityOffset = capacityMessage.indexOf("6-8\u4eba");
  capacityRepair.contextRelationCandidates[0].evidenceRefs = [{ eventId: "capacity-coverage", messageRef: "", startOffset: capacityOffset, endOffset: capacityOffset + 4, quote: "6-8\u4eba" }];
  const capacityEvidenceRefs = [{ eventId: "capacity-coverage", messageRef: "", startOffset: capacityOffset, endOffset: capacityOffset + 4, quote: "6-8\u4eba" }];
  capacityFirst.semanticCandidates = [{
    semanticKind: "capability",
    capability: "availability",
    canonicalIdentityCandidate: "availability",
    coverageStatus: "bound",
    provenanceRelationCandidateIndexes: [0],
    coverageStatus: "bound",
    provenanceRelationCandidateIndexes: [0],
    evidenceRefs: capacityFirst.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })),
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: { ...capacityFirst.tasks[0].stayCandidate.dateExpression },
    propertyCatalogIdentity: null
  }, {
    semanticKind: "lodging_scope",
    capability: "bundle_availability",
    canonicalIdentityCandidate: "whole-house",
    coverageStatus: "pending_task",
    evidenceRefs: capacityEvidenceRefs.map((ref) => ({ ...ref })),
    lodgingScopeCandidate: { bundleCanonicalCandidate: "whole-house", roomCanonicalCandidates: [], guestCountCandidate: 8 },
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: "whole-house"
  }];
  capacityRepair.tasks[0].taskId = "76000000-0000-4000-8000-000000000001";
  delete capacityRepair.tasks[0].semanticCandidateIds;
  delete capacityRepair.tasks[0].lodgingScopeId;
  capacityRepair.tasks[0].stayCandidate = { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: 8 };
  capacityRepair.semanticCandidates = capacityFirst.semanticCandidates.filter((candidate) => candidate.propertyCatalogIdentity === "whole-house").map((candidate) => ({ ...candidate, coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: candidate.evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: { ...candidate.lodgingScopeCandidate, roomCanonicalCandidates: [...candidate.lodgingScopeCandidate.roomCanonicalCandidates] } }));
  let capacityScopeCalls = 0;
  const capacityScopePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(++capacityScopeCalls === 1 ? capacityFirst : capacityRepair) }) }) });
  const capacityScopeResult = await capacityScopePlanner.classify({ currentMessage: capacityMessage, currentMessages: [capacityMessage], sourceEvents: [{ eventId: "capacity-coverage", messageText: capacityMessage }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(capacityScopeCalls, 2, "a guest count above every individual room capacity must preserve the uniquely eligible bundle scope");
  assert.equal(capacityScopeResult.tasks.some((task) => task.entity && task.entity.canonicalCandidate === "whole-house"), true);
  let capacityFallbackCalls = 0;
  const capacityFallbackPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((capacityFallbackCalls += 1) === 1 ? capacityFirst : capacityRepair) }) }) });
  const capacityFallbackResult = await capacityFallbackPlanner.classify({ currentMessage: capacityMessage, currentMessages: [capacityMessage], sourceEvents: [{ eventId: "capacity-coverage", messageText: capacityMessage }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(capacityFallbackCalls, 2, "the bounded provider repair remains limited to one supplement call");
  assert.equal(capacityFallbackResult.tasks.some((task) => task.type === "bundle_availability" && task.entity && task.entity.canonicalCandidate === "whole-house"), true, "a uniquely catalog-grounded capacity scope must survive an unusable second Planner shape");
  const capacityFallbackTask = capacityFallbackResult.tasks.find((task) => task.type === "bundle_availability" && task.entity && task.entity.canonicalCandidate === "whole-house");
  assert.equal(capacityFallbackTask.stayCandidate.checkInCandidate, null, "deterministic inventory coverage must not copy an unrelated top-level stay");
  assert.match(capacityFallbackTask.taskId, OPAQUE_REPAIR_ID, "deterministic coverage task IDs must be opaque");
  const capacityFallbackDiagnostic = capacityFallbackResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(capacityFallbackDiagnostic.coverageRepairSucceeded, true, "post-merge deterministic bundle coverage must report the completed canonical coverage truthfully");
  const capacityFallbackLink = capacityFallbackDiagnostic.repairLinks.find((link) => link.taskId === capacityFallbackTask.taskId);
  assert.match(capacityFallbackLink.correlationId, OPAQUE_REPAIR_ID, "deterministic coverage provenance must directly join to the repaired task");
  const featureMessage = "double room with bathtub";
  const multiCapacityFirst = JSON.parse(JSON.stringify(capacityFirst));
  multiCapacityFirst.tasks = ["availability-alpha", "availability-beta", "availability-gamma"].map((taskId, candidateIndex) => ({ ...capacityFirst.tasks[0], taskId, candidateIndex }));
  multiCapacityFirst.contextRelationCandidates = multiCapacityFirst.tasks.map((task) => ({ ...capacityFirst.contextRelationCandidates[0], candidateIndex: task.candidateIndex }));
  multiCapacityFirst.semanticCandidates = [0, 1, 2].map((candidateIndex) => ({ ...capacityFirst.semanticCandidates[0], coverageStatus: "bound", provenanceRelationCandidateIndexes: [candidateIndex] })).concat([capacityFirst.semanticCandidates[1]]);
  let multiCapacityCalls = 0;
  const multiCapacityPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((multiCapacityCalls += 1) === 1 ? multiCapacityFirst : capacityRepair) }) }) });
  const multiCapacityResult = await multiCapacityPlanner.classify({ currentMessage: capacityMessage, currentMessages: [capacityMessage], sourceEvents: [{ eventId: "capacity-coverage", messageText: capacityMessage }], eventTimestamp: 1, catalog: lodgingCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(multiCapacityCalls, 2);
  assert.equal(multiCapacityResult.tasks.some((task) => task.type === "bundle_availability" && task.entity.canonicalCandidate === "whole-house"), true, "a unique capacity bundle must survive when several legal unresolved siblings are preserved");
  assert.deepEqual(multiCapacityResult.tasks.slice(0, 3).map((task) => task.taskId), ["availability-alpha", "availability-beta", "availability-gamma"], "capacity coverage must not consume or rewrite legal siblings");
  const multiCapacitySemantic = applyPlannerSemanticContract(multiCapacityResult, { catalog: lodgingCatalog, sourceEvents: [{ eventId: "capacity-coverage", messageText: capacityMessage }] });
  const multiCapacityTask = multiCapacitySemantic.tasks.find((task) => task.entity && task.entity.canonicalCandidate === "whole-house");
  assert.equal(Boolean(multiCapacityTask), true, "the trusted bundle scope must survive Semantic");

  const featureCatalog = buildPropertyCatalog({
    propertyId: "feature-coverage-property",
    timezone: "Asia/Taipei",
    rooms: [
      { id: "alpha-room", name: "Alpha double room", type: "double room", capacity: 2, enabled: true },
      { id: "beta-room", name: "Beta double room", type: "double room", shortFeature: "bathtub", capacity: 2, enabled: true }
    ],
    commonAnswers: {},
    semanticCatalog: { aliases: { "alpha-room": ["Alpha"], "beta-room": ["Beta"] } }
  });
  const featureFirst = JSON.parse(JSON.stringify(lodgingPriceOutput));
  featureFirst.tasks[0] = { ...featureFirst.tasks[0], taskId: "feature-availability", type: "availability", sourceText: featureMessage, requestedOutputs: ["availability"], entity: { category: "room", rawText: "double room", canonicalCandidate: null, confidence: 1 } };
  featureFirst.contextRelationCandidates[0].evidenceRefs = [{ eventId: "feature-coverage", messageRef: "", startOffset: 0, endOffset: featureMessage.length, quote: featureMessage }];
  const featureOffset = featureMessage.indexOf("bathtub");
  featureFirst.semanticCandidates = [{
    semanticKind: "capability",
    capability: "availability",
    canonicalIdentityCandidate: "availability",
    coverageStatus: "bound",
    provenanceRelationCandidateIndexes: [0],
    evidenceRefs: featureFirst.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })),
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: null
  }, {
    semanticKind: "catalog_subject",
    capability: "property_fact",
    canonicalIdentityCandidate: "bathtub",
    coverageStatus: "pending_task",
    evidenceRefs: [{ eventId: "feature-coverage", messageRef: "", startOffset: featureOffset, endOffset: featureOffset + "bathtub".length, quote: "bathtub" }],
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: null
  }];
  const featureRepair = JSON.parse(JSON.stringify(featureFirst));
  featureRepair.tasks[0] = { ...featureRepair.tasks[0], candidateIndex: 0, taskId: "78000000-0000-4000-8000-000000000001", type: "property_fact", sourceText: "bathtub", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "room_feature", rawText: "bathtub", canonicalCandidate: null, confidence: 1 }, stayCandidate: null };
  delete featureRepair.tasks[0].semanticCandidateIds;
  delete featureRepair.tasks[0].lodgingScopeId;
  featureRepair.semanticCandidates = featureFirst.semanticCandidates.filter((candidate) => candidate.capability === "property_fact").map((candidate) => ({ ...candidate, coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: candidate.evidenceRefs.map((ref) => ({ ...ref })) }));
  featureRepair.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: featureRepair.semanticCandidates[0].evidenceRefs.map((ref) => ({ ...ref })) }];


  let featureCalls = 0;
  const featurePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((featureCalls += 1) === 1 ? featureFirst : featureRepair) }) }) });
  const featureResult = await featurePlanner.classify({ currentMessage: featureMessage, currentMessages: [featureMessage], sourceEvents: [{ eventId: "feature-coverage", messageText: featureMessage }], eventTimestamp: 1, catalog: featureCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(featureCalls, 2);
  assert.equal(featureResult.tasks.some((task) => task.taskId === "feature-availability"), true, "the legal availability sibling must survive feature coverage");
  const featureTask = featureResult.tasks.find((task) => task.type === "property_fact" && task.sourceText === "bathtub");
  assert.equal(Boolean(featureTask), true, "a catalog-recognized lodging feature must retain its own semantic subject");
  assert.equal(featureTask.entity.canonicalCandidate, null, "feature coverage must not guess one inventory entity");
  assert.equal(featureResult.contextRelationCandidates.find((relation) => relation.candidateIndex === featureTask.candidateIndex).evidenceRefs[0].quote, "bathtub");
  const featureDiagnostic = featureResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  const featureLink = featureDiagnostic.repairLinks.find((link) => link.taskId === featureTask.taskId);
  assert.equal(featureLink.kind, "coverage_repair");
  assert.match(featureLink.correlationId, OPAQUE_REPAIR_ID, "feature provenance must directly join to its canonical evidence task");
  const semanticFeatureResult = applyPlannerSemanticContract(featureResult, { catalog: featureCatalog });
  const semanticFeatureTask = semanticFeatureResult.tasks.find((task) => task.taskId === featureTask.taskId);
  const canonicalFeature = canonicalizeExecutionItem({
    item: { candidateIndex: semanticFeatureTask.candidateIndex, requestCycleId: semanticFeatureTask.taskId, task: semanticFeatureTask, transition: { approvedProduct: { productType: "any" } } },
    relation: semanticFeatureResult.contextRelationCandidates.find((candidate) => candidate.candidateIndex === semanticFeatureTask.candidateIndex),
    contextSnapshot: { cycles: [] }, catalog: featureCatalog, guestMessage: featureMessage, eventTimestamp: 1
  }).canonicalRequest;
  assert.equal(canonicalFeature.capability, "property_fact", "feature semantic coverage must remain canonically representable");
  assert.equal(canonicalFeature.canonicalEntity.category, "room_feature", "Canonical must preserve the trusted semantic category");
  assert.equal(canonicalFeature.canonicalEntity.canonicalId, "beta-room", "a unique catalog feature mapping is trusted canonical evidence, not an inferred lodging product");
  assert.equal(canonicalFeature.lodgingProduct.productType, "any", "unresolved feature coverage must remain fail closed for lodging scope");
  const faqFeatureMessage = "I need a double room with a soaking tub";
  const faqFeatureCatalog = buildPropertyCatalog({
    propertyId: "faq-feature-coverage-property",
    timezone: "Asia/Taipei",
    rooms: [
      { id: "alpha-room", name: "Alpha double room", type: "double room", capacity: 2, enabled: true },
      { id: "beta-room", name: "Beta double room", type: "double room", capacity: 2, enabled: true }
    ],
    faqs: [{ knowledgeKey: "bathing_fixture_info", question: "Which rooms include a soaking tub?", answer: "Beta double room includes a soaking tub." }],
    commonAnswers: {}
  });
  const faqFeatureFirst = JSON.parse(JSON.stringify(featureFirst));
  faqFeatureFirst.tasks[0] = { ...faqFeatureFirst.tasks[0], taskId: "faq-feature-availability", sourceText: faqFeatureMessage, entity: { category: "room", rawText: "double room", canonicalCandidate: null, confidence: 1 } };
  faqFeatureFirst.contextRelationCandidates[0].evidenceRefs = [{ eventId: "faq-feature-coverage", messageRef: "", startOffset: 0, endOffset: faqFeatureMessage.length, quote: faqFeatureMessage }];
  const faqFeatureOffset = faqFeatureMessage.indexOf("soaking tub");
  faqFeatureFirst.semanticCandidates = [{
    semanticKind: "capability",
    capability: "availability",
    canonicalIdentityCandidate: "availability",
    coverageStatus: "bound",
    provenanceRelationCandidateIndexes: [0],
    evidenceRefs: faqFeatureFirst.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })),
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: null
  }, {
    semanticKind: "catalog_subject",
    capability: "property_fact",
    canonicalIdentityCandidate: "bathing_fixture_info",
    coverageStatus: "pending_task",
    evidenceRefs: [{ eventId: "faq-feature-coverage", messageRef: "", startOffset: faqFeatureOffset, endOffset: faqFeatureOffset + "soaking tub".length, quote: "soaking tub" }],
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: "bathing_fixture_info"
  }];
  const faqFeatureRepair = JSON.parse(JSON.stringify(faqFeatureFirst));
  faqFeatureRepair.tasks[0] = { ...faqFeatureRepair.tasks[0], candidateIndex: 0, taskId: "7a000000-0000-4000-8000-000000000001", type: "property_fact", sourceText: "soaking tub", requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "soaking tub", canonicalCandidate: "bathing_fixture_info", confidence: 1 }, stayCandidate: null };
  delete faqFeatureRepair.tasks[0].semanticCandidateIds;
  delete faqFeatureRepair.tasks[0].lodgingScopeId;
  faqFeatureRepair.semanticCandidates = faqFeatureFirst.semanticCandidates.filter((candidate) => candidate.capability === "property_fact").map((candidate) => ({ ...candidate, coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: candidate.evidenceRefs.map((ref) => ({ ...ref })) }));
  faqFeatureRepair.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: faqFeatureRepair.semanticCandidates[0].evidenceRefs.map((ref) => ({ ...ref })) }];
  let faqFeatureCalls = 0;
  const faqFeaturePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((faqFeatureCalls += 1) === 1 ? faqFeatureFirst : faqFeatureRepair) }) }) });
  const faqFeatureResult = await faqFeaturePlanner.classify({ currentMessage: faqFeatureMessage, currentMessages: [faqFeatureMessage], sourceEvents: [{ eventId: "faq-feature-coverage", messageText: faqFeatureMessage }], eventTimestamp: 1, catalog: faqFeatureCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  const faqFeatureTask = faqFeatureResult.tasks.find((task) => task.type === "property_fact" && task.entity && task.entity.canonicalCandidate === "bathing_fixture_info");
  assert.equal(Boolean(faqFeatureTask), true, "a subject uniquely present in the guest message and a formal FAQ question and answer must retain an independent sibling");
  assert.equal(faqFeatureResult.tasks.some((task) => task.taskId === "faq-feature-availability"), true, "FAQ coverage must not consume a legal lodging sibling");
  const faqFeatureDiagnostic = faqFeatureResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(faqFeatureDiagnostic.repairLinks.some((link) => link.taskId === faqFeatureTask.taskId && link.kind === "coverage_repair"), true, "catalog-compiled FAQ coverage must retain direct repair provenance");
  const faqFeatureSemantic = applyPlannerSemanticContract(faqFeatureResult, { catalog: faqFeatureCatalog, sourceEvents: [{ eventId: "faq-feature-coverage", messageText: faqFeatureMessage }] });
  const faqFeatureSemanticTask = faqFeatureSemantic.tasks.find((task) => task.taskId === faqFeatureTask.taskId);
  const faqFeatureCanonical = canonicalizeExecutionItem({
    item: { candidateIndex: faqFeatureSemanticTask.candidateIndex, requestCycleId: faqFeatureSemanticTask.taskId, task: faqFeatureSemanticTask, transition: { approvedProduct: { productType: "any" } } },
    relation: faqFeatureSemantic.contextRelationCandidates.find((candidate) => candidate.candidateIndex === faqFeatureSemanticTask.candidateIndex),
    contextSnapshot: { cycles: [] }, catalog: faqFeatureCatalog, guestMessage: faqFeatureMessage, eventTimestamp: 1
  }).canonicalRequest;
  assert.equal(faqFeatureCanonical.capability, "property_fact", "the repaired FAQ subject must survive Semantic as formal canonical evidence");
  assert.equal(faqFeatureCanonical.canonicalEntity.canonicalId, "bathing_fixture_info");
  assert.equal(faqFeatureCanonical.lodgingProduct.productType, "any", "a FAQ feature must not guess one lodging product");

  for (const casePreservingMessage of ["I need a double room with a Soaking Tub", "I need a double room with a SOAKING TUB"]) {
    const casePreservingHit = mentionedFaqSubjects(faqFeatureCatalog, casePreservingMessage)[0];
    assert.equal(Boolean(casePreservingHit), true, "a controlled FAQ subject alias must match case-insensitively");
    assert.equal(casePreservingHit.mention, casePreservingMessage.slice(casePreservingHit.startOffset, casePreservingHit.endOffset), "FAQ evidence must preserve the exact guest-source substring and offsets");
    const casePreservingFirst = JSON.parse(JSON.stringify(faqFeatureFirst));
    casePreservingFirst.tasks[0] = { ...casePreservingFirst.tasks[0], sourceText: casePreservingMessage };
    casePreservingFirst.contextRelationCandidates[0].evidenceRefs = [{ eventId: "faq-case-coverage", messageRef: "", startOffset: 0, endOffset: casePreservingMessage.length, quote: casePreservingMessage }];
    const casePreservingEvidence = [{ eventId: "faq-case-coverage", messageRef: "", startOffset: casePreservingHit.startOffset, endOffset: casePreservingHit.endOffset, quote: casePreservingHit.mention }];
    casePreservingFirst.semanticCandidates = [{ ...faqFeatureFirst.semanticCandidates.find((candidate) => candidate.capability === "availability"), evidenceRefs: casePreservingFirst.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })) }, { ...faqFeatureFirst.semanticCandidates.find((candidate) => candidate.capability === "property_fact"), evidenceRefs: casePreservingEvidence.map((ref) => ({ ...ref })) }];
    const casePreservingRepair = JSON.parse(JSON.stringify(faqFeatureRepair));
    casePreservingRepair.tasks[0] = { ...casePreservingRepair.tasks[0], sourceText: casePreservingHit.mention, entity: { ...casePreservingRepair.tasks[0].entity, rawText: casePreservingHit.mention } };
    casePreservingRepair.contextRelationCandidates[0].evidenceRefs = casePreservingEvidence.map((ref) => ({ ...ref }));
    casePreservingRepair.semanticCandidates = casePreservingFirst.semanticCandidates.filter((candidate) => candidate.capability === "property_fact").map((candidate) => ({ ...candidate, coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: candidate.evidenceRefs.map((ref) => ({ ...ref })) }));


    let casePreservingCalls = 0;
    const casePreservingPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((casePreservingCalls += 1) === 1 ? casePreservingFirst : casePreservingRepair) }) }) });
    const casePreservingResult = await casePreservingPlanner.classify({ currentMessage: casePreservingMessage, currentMessages: [casePreservingMessage], sourceEvents: [{ eventId: "faq-case-coverage", messageText: casePreservingMessage }], eventTimestamp: 1, catalog: faqFeatureCatalog, contextSnapshot: { scope: {}, cycles: [] } });
    const casePreservingTask = casePreservingResult.tasks.find((task) => task.entity && task.entity.canonicalCandidate === "bathing_fixture_info");
    assert.equal(Boolean(casePreservingTask), true, "case drift must not prevent deterministic FAQ coverage");
    const casePreservingDiagnostic = casePreservingResult[Symbol.for("junzan.plannerProviderDiagnostic")];
    assert.equal((casePreservingDiagnostic.repairLinks || []).some((link) => link.taskId === casePreservingTask.taskId && link.kind === "coverage_repair"), true, "case-preserving FAQ coverage must retain direct repair provenance");
  }



  const boundaryFaqMessage = "poolside parking, is the pool open?";
  const boundaryFaqCatalog = buildPropertyCatalog({
    propertyId: "boundary-faq-property", timezone: "Asia/Taipei",
    rooms: [{ id: "base-room", name: "Base room", type: "double room", capacity: 2, enabled: true }],
    faqs: [{ knowledgeKey: "pool_open", question: "Is the pool open?", answer: "The pool is open." }], commonAnswers: {}
  });
  const boundaryFaqHit = mentionedFaqSubjects(boundaryFaqCatalog, boundaryFaqMessage)[0];
  assert.equal(boundaryFaqHit.startOffset, boundaryFaqMessage.lastIndexOf("pool"), "controlled FAQ evidence must bind to the independent word, not an earlier identifier prefix");
  assert.equal(boundaryFaqHit.mention, "pool");
  const boundaryFaqFirst = JSON.parse(JSON.stringify(faqFeatureFirst));
  boundaryFaqFirst.tasks[0] = { ...boundaryFaqFirst.tasks[0], sourceText: boundaryFaqMessage };
  boundaryFaqFirst.contextRelationCandidates[0].evidenceRefs = [{ eventId: "faq-boundary-coverage", messageRef: "", startOffset: 0, endOffset: boundaryFaqMessage.length, quote: boundaryFaqMessage }];
  const boundaryFaqEvidence = [{ eventId: "faq-boundary-coverage", messageRef: "", startOffset: boundaryFaqHit.startOffset, endOffset: boundaryFaqHit.endOffset, quote: boundaryFaqHit.mention }];
  boundaryFaqFirst.semanticCandidates = [{
    semanticKind: "capability",
    capability: "availability",
    canonicalIdentityCandidate: "availability",
    coverageStatus: "bound",
    provenanceRelationCandidateIndexes: [0],
    evidenceRefs: boundaryFaqFirst.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })),
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: null
  }, {
    semanticKind: "catalog_subject",
    capability: "property_fact",
    canonicalIdentityCandidate: "pool_open",
    coverageStatus: "pending_task",
    evidenceRefs: boundaryFaqEvidence.map((ref) => ({ ...ref })),
    lodgingScopeCandidate: null,
    temporalSemanticCandidate: null,
    propertyCatalogIdentity: "pool_open"
  }];
  const boundaryFaqRepair = JSON.parse(JSON.stringify(boundaryFaqFirst));
  boundaryFaqRepair.tasks[0] = { ...boundaryFaqRepair.tasks[0], candidateIndex: 0, taskId: "7c000000-0000-4000-8000-000000000001", type: "property_fact", sourceText: boundaryFaqHit.mention, requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: boundaryFaqHit.mention, canonicalCandidate: "pool_open", confidence: 1 }, stayCandidate: null };
  delete boundaryFaqRepair.tasks[0].semanticCandidateIds;
  delete boundaryFaqRepair.tasks[0].lodgingScopeId;
  boundaryFaqRepair.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: boundaryFaqEvidence.map((ref) => ({ ...ref })) }];
  boundaryFaqRepair.semanticCandidates = boundaryFaqFirst.semanticCandidates.filter((candidate) => candidate.capability === "property_fact").map((candidate) => ({ ...candidate, coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: candidate.evidenceRefs.map((ref) => ({ ...ref })) }));
  let boundaryFaqCalls = 0;
  const boundaryFaqPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((boundaryFaqCalls += 1) === 1 ? boundaryFaqFirst : boundaryFaqRepair) }) }) });
  const boundaryFaqResult = await boundaryFaqPlanner.classify({ currentMessage: boundaryFaqMessage, currentMessages: [boundaryFaqMessage], sourceEvents: [{ eventId: "faq-boundary-coverage", messageText: boundaryFaqMessage }], eventTimestamp: 1, catalog: boundaryFaqCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  const boundaryFaqTask = boundaryFaqResult.tasks.find((task) => task.entity && task.entity.canonicalCandidate === "pool_open");
  assert.equal(Boolean(boundaryFaqTask), true, "an independent controlled FAQ subject must create coverage despite an earlier identifier prefix");
  assert.equal((boundaryFaqResult[Symbol.for("junzan.plannerProviderDiagnostic")].repairLinks || []).some((link) => link.taskId === boundaryFaqTask.taskId && link.kind === "coverage_repair"), true, "boundary-safe FAQ coverage must retain direct repair provenance");

  const ambiguousFaqCatalog = buildPropertyCatalog({
    propertyId: "ambiguous-faq-feature-property",
    timezone: "Asia/Taipei",
    rooms: [{ id: "only-room", name: "Only room", type: "double room", capacity: 2, enabled: true }],
    faqs: [
      { knowledgeKey: "fixture_alpha", question: "Does the room include a soaking tub?", answer: "The room includes a soaking tub." },
      { knowledgeKey: "fixture_beta", question: "When is the soaking tub available?", answer: "The soaking tub is available during the stay." }
    ],
    commonAnswers: {}
  });
  let ambiguousFaqCalls = 0;
  const ambiguousFaqPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((ambiguousFaqCalls += 1) && faqFeatureFirst) }) }) });
  const ambiguousFaqResult = await ambiguousFaqPlanner.classify({ currentMessage: faqFeatureMessage, currentMessages: [faqFeatureMessage], sourceEvents: [{ eventId: "faq-feature-coverage", messageText: faqFeatureMessage }], eventTimestamp: 1, catalog: ambiguousFaqCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(ambiguousFaqResult.tasks.some((task) => task.entity && ["fixture_alpha", "fixture_beta"].includes(task.entity.canonicalCandidate)), false, "one source subject shared by multiple formal FAQs must remain fail closed");
  const inventoryOnlyFaqCatalog = buildPropertyCatalog({
    propertyId: "inventory-only-faq-property",
    timezone: "Asia/Taipei",
    rooms: [
      { id: "base-room", name: "Base room", type: "double room", capacity: 2, enabled: true },
      { id: "full-property", name: "Full-property bundle", type: "bundle", capacity: 2, enabled: true, inventoryType: "bundle", memberRoomIds: ["base-room"] }
    ],
    faqs: [{ knowledgeKey: "bundle_equipment", question: "What equipment comes with the full-property bundle?", answer: "The full-property bundle includes games." }],
    commonAnswers: {}
  });
  assert.deepEqual(mentionedFaqSubjects(inventoryOnlyFaqCatalog, "I need the full-property bundle"), [], "an inventory label alone must not be reinterpreted as the subject of a related FAQ");

  const genericPredicateFaqCatalog = buildPropertyCatalog({
    propertyId: "generic-predicate-faq-property",
    timezone: "Asia/Taipei",
    rooms: [{ id: "base-room", name: "Base room", type: "double room", capacity: 2, enabled: true }],
    faqs: [
      { knowledgeKey: "parking", question: "Is parking available?", answer: "Parking is available." },
      { knowledgeKey: "breakfast", question: "Is breakfast provided?", answer: "Breakfast is provided." },
      { knowledgeKey: "games", question: "Are games included?", answer: "Games are included." },
      { knowledgeKey: "parking_zh", question: "????????", answer: "???????" }
    ],
    commonAnswers: {}
  });
  assert.deepEqual(mentionedFaqSubjects(genericPredicateFaqCatalog, "Is WiFi available?"), [], "a generic availability predicate must not identify an unrelated FAQ subject");
  assert.deepEqual(mentionedFaqSubjects(genericPredicateFaqCatalog, "Are towels provided?"), [], "a generic provision predicate must not identify an unrelated FAQ subject");
  assert.deepEqual(mentionedFaqSubjects(genericPredicateFaqCatalog, "Are meals included?"), [], "a generic inclusion predicate must not identify an unrelated FAQ subject");
  assert.deepEqual(mentionedFaqSubjects(genericPredicateFaqCatalog, "???????"), [], "a compact-script generic predicate must not identify an unrelated FAQ subject");

  const predicateOnlyFaqCases = [
    { canonicalId: "parking_allowed", question: "Is parking allowed?", answer: "Parking is allowed.", message: "Is late checkout allowed?" },
    { canonicalId: "charging_supported", question: "Is EV charging supported?", answer: "EV charging is supported.", message: "Is Apple Pay supported?" },
    { canonicalId: "pool_accessible", question: "Is the pool accessible?", answer: "The pool is accessible.", message: "Is the rooftop accessible?" },
    { canonicalId: "parking_used", question: "Can parking be used?", answer: "Parking can be used.", message: "Can Apple Pay be used?" },
    { canonicalId: "parking_cost", question: "Does parking cost extra?", answer: "Parking can cost extra.", message: "Does breakfast cost extra?" }
  ];
  for (const predicateCase of predicateOnlyFaqCases) {
    const predicateCatalog = buildPropertyCatalog({
      propertyId: `predicate-only-${predicateCase.canonicalId}`,
      timezone: "Asia/Taipei",
      rooms: [{ id: "base-room", name: "Base room", type: "double room", capacity: 2, enabled: true }],
      faqs: [{ knowledgeKey: predicateCase.canonicalId, question: predicateCase.question, answer: predicateCase.answer }],
      commonAnswers: {}
    });
    assert.deepEqual(mentionedFaqSubjects(predicateCatalog, predicateCase.message), [], "an unregistered single-word predicate must not identify a FAQ subject");
    const predicateFirst = JSON.parse(JSON.stringify(faqFeatureFirst));
    predicateFirst.tasks[0] = { ...predicateFirst.tasks[0], sourceText: predicateCase.message };
    predicateFirst.contextRelationCandidates[0].evidenceRefs = [{ eventId: "predicate-only", messageRef: "", startOffset: 0, endOffset: predicateCase.message.length, quote: predicateCase.message }];
    let predicateCalls = 0;
    const predicatePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((predicateCalls += 1) && predicateFirst) }) }) });
    const predicateResult = await predicatePlanner.classify({ currentMessage: predicateCase.message, currentMessages: [predicateCase.message], sourceEvents: [{ eventId: "predicate-only", messageText: predicateCase.message }], eventTimestamp: 1, catalog: predicateCatalog, contextSnapshot: { scope: {}, cycles: [] } });
    assert.equal(predicateResult.tasks.some((task) => task.entity && task.entity.canonicalCandidate === predicateCase.canonicalId), false, "predicate-only overlap must not create a FAQ coverage task");
    const predicateDiagnostic = predicateResult[Symbol.for("junzan.plannerProviderDiagnostic")];
    assert.equal((predicateDiagnostic.repairLinks || []).some((link) => predicateResult.tasks.some((task) => task.taskId === link.taskId && task.entity && task.entity.canonicalCandidate === predicateCase.canonicalId)), false, "predicate-only overlap must not create joinable repair provenance");
  }

  let duplicateFeatureCalls = 0;
  const duplicateFeatureFirst = JSON.parse(JSON.stringify(featureFirst));
  duplicateFeatureFirst.contextRelationCandidates[0].evidenceRefs = [{ eventId: "feature-current", messageRef: "", startOffset: 0, endOffset: featureMessage.length, quote: featureMessage }];
  duplicateFeatureFirst.semanticCandidates = [{ ...featureFirst.semanticCandidates.find((candidate) => candidate.capability === "property_fact"), evidenceRefs: [{ eventId: "feature-current", messageRef: "", startOffset: featureOffset, endOffset: featureOffset + "bathtub".length, quote: "bathtub" }] }];

  const duplicateFeaturePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((duplicateFeatureCalls += 1) && duplicateFeatureFirst) }) }) });
  const duplicateFeatureResult = await duplicateFeaturePlanner.classify({ currentMessage: featureMessage, currentMessages: [featureMessage], sourceEvents: [{ eventId: "feature-old", messageText: featureMessage }, { eventId: "feature-current", messageText: featureMessage }], eventTimestamp: 1, catalog: featureCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(duplicateFeatureCalls, 2);
  assert.equal(duplicateFeatureResult.tasks.some((item) => item.type === "property_fact" && item.sourceText === "bathtub"), false, "duplicate source events must not authorize feature canonical evidence");
  assert.equal(duplicateFeatureResult.tasks.some((item) => item.entity && ["alpha-room", "beta-room"].includes(item.entity.canonicalCandidate)), false, "duplicate source events must not authorize inventory canonical evidence");


  const { semanticCandidateIds: incompletePriceCandidateIds, lodgingScopeId: incompletePriceScopeId, ...incompletePriceSemantics } = incompleteResult.tasks[0];
  assert.deepEqual(incompletePriceSemantics, omittedPool.tasks[0], "an incomplete second attempt must not erase the first valid task semantics");
  assert.equal(incompletePriceCandidateIds.length, 1);
  assert.equal(incompletePriceScopeId, null);
  const incompletePoolTask = incompleteResult.tasks.find((task) => task.type === "amenity" && task.entity && task.entity.canonicalCandidate === repairedPoolCanonicalIdentity);
  assert.equal(Boolean(incompletePoolTask), true, "a directly repaired low-risk subject must remain canonically representable beside the preserved price task");
  const incompletePoolCandidate = incompleteResult.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool" && candidate.capability === "amenity");
  assert.ok(incompletePoolCandidate, "the compiled repair ledger must retain the pool candidate");
  assert.deepEqual(incompletePoolTask.semanticCandidateIds, [incompletePoolCandidate.candidateId], "the repaired task must directly own the compiled missing semantic candidate ID");
  assert.equal(incompleteResult.semanticCandidates.filter((candidate) => candidate.candidateId === incompletePoolCandidate.candidateId).length, 1, "the repaired candidate ID must join uniquely to the ledger");
  assert.deepEqual(validatePlannerOutput(incompleteResult).errors, [], "the repaired subject must remain structurally executable beside preserved tasks");
  const incompleteDiagnostic = incompleteResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(incompleteDiagnostic.coverageRepairSucceeded, true);
  assert.equal(incompleteDiagnostic.coverageRepairFallback, false);
  assert.equal(incompleteDiagnostic.repairLinks.some((link) => link.taskId === incompletePoolTask.taskId && link.kind === "coverage_repair"), true, "the direct candidate repair must retain joinable provenance");
  let duplicateCoverageCalls = 0;
  const duplicateCoverageMessage = wholeMessageText;
  const duplicateCoverageOutput = JSON.parse(JSON.stringify(wholeMessagePrice));
  duplicateCoverageOutput.contextRelationCandidates[0].evidenceRefs = [{ eventId: "coverage-current", messageRef: "", startOffset: 0, endOffset: duplicateCoverageMessage.length, quote: duplicateCoverageMessage }];
  duplicateCoverageOutput.semanticCandidates = [{ ...wholeMessagePrice.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool" && candidate.capability === "amenity"), evidenceRefs: [{ eventId: "coverage-current", messageRef: "", startOffset: 0, endOffset: duplicateCoverageMessage.length, quote: duplicateCoverageMessage }] }];

  const duplicateCoveragePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput((duplicateCoverageCalls += 1) && duplicateCoverageOutput) }) }) });
  const duplicateCoverageResult = await duplicateCoveragePlanner.classify({ currentMessage: duplicateCoverageMessage, currentMessages: [duplicateCoverageMessage], sourceEvents: [{ eventId: "coverage-old", messageText: duplicateCoverageMessage }, { eventId: "coverage-current", messageText: duplicateCoverageMessage }], eventTimestamp: 1, catalog: wholeMessageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(duplicateCoverageCalls, 2);
  assert.equal(duplicateCoverageResult.tasks.map((item) => item.entity && item.entity.canonicalCandidate).includes("pool"), false, "duplicate source events must not authorize deterministic formal coverage");


  const partialMessage = "Ask the lodging price; arrange an unsupported request";
  const partialOutput = JSON.parse(JSON.stringify(omittedPool));
  partialOutput.tasks[0] = {
    ...partialOutput.tasks[0],
    sourceText: "Ask the lodging price",
    entity: { ...partialOutput.tasks[0].entity, rawText: "lodging" }
  };
  partialOutput.tasks.push({
    ...repairedPool.tasks[0],
    candidateIndex: 1,
    taskId: "invalid-sibling",
    type: "unsupported_task",
    sourceText: "arrange an unsupported request",
    entity: { category: "other", rawText: "unsupported request", canonicalCandidate: null, confidence: 1 }
  });
  partialOutput.contextRelationCandidates = [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "partial", messageRef: "", startOffset: 0, endOffset: 21, quote: "Ask the lodging price" }] },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "partial", messageRef: "", startOffset: 23, endOffset: partialMessage.length, quote: "arrange an unsupported request" }] }
  ];
  partialOutput.semanticCandidates = [
    { semanticKind: "capability", capability: "price", canonicalIdentityCandidate: "price", coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: partialOutput.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: null },
    { semanticKind: "capability", capability: "human_help", canonicalIdentityCandidate: "human_help", coverageStatus: "pending_task", evidenceRefs: partialOutput.contextRelationCandidates[1].evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: null }
  ];
  assert.equal(validatePlannerOutput(partialOutput).ok, false, "the provider fixture must begin with one structurally invalid sibling");
  let partialCalls = 0;
  const partialPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    partialCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(partialOutput) }) };
  } });
  const partialInput = { currentMessage: partialMessage, currentMessages: [partialMessage], sourceEvents: [{ eventId: "partial", messageText: partialMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  const partialResult = await partialPlanner.classify(partialInput);
  assert.equal(partialCalls, 1, "a local task-contract failure must not retry the provider");
  const { semanticCandidateIds: partialPriceCandidateIds, lodgingScopeId: partialPriceScopeId, ...partialPriceSemantics } = partialResult.tasks[0];
  assert.deepEqual(partialPriceSemantics, partialOutput.tasks[0], "a structurally valid source-bound task must survive an invalid sibling semantically unchanged");
  assert.equal(partialPriceCandidateIds.length, 1);
  assert.equal(partialPriceScopeId, null);
  assert.equal(partialResult.tasks[1].type, "human_help", "only the invalid source-bound sibling must become a scoped handoff");
  assert.equal(partialResult.tasks[1].sourceText, "arrange an unsupported request");
  assert.deepEqual(validatePlannerOutput(partialResult).errors, [], "the task-level fallback collection must be structurally executable");
  assert.equal(validateUnderstandingContext(partialResult, partialInput.contextSnapshot, { sourceEvents: partialInput.sourceEvents }).ok, true, "the task-level fallback collection must retain verified source authority");
  const partialDiagnostic = partialResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(partialDiagnostic.retryPerformed, false);
  assert.equal(partialDiagnostic.taskCollectionRepairPerformed, true);
  assert.equal(partialDiagnostic.preservedTaskCount, 1);
  assert.equal(partialDiagnostic.fallbackTaskCount, 1);
  assert.equal(Array.isArray(partialDiagnostic.repairLinks), true, "task collection repair must record private direct-join links");
  assert.deepEqual(
    new Set(partialDiagnostic.repairLinks.map((item) => item.taskId)),
    new Set([partialResult.tasks[1].taskId]),
    "task collection provenance must identify only the task actually replaced by repair, not a preserved sibling"
  );
  assert.ok(partialDiagnostic.repairLinks.every((item) => item.kind === "task_collection_repair" && OPAQUE_REPAIR_ID.test(item.correlationId)));
  assert.equal(new Set(partialDiagnostic.repairLinks.map((item) => item.correlationId)).size, partialDiagnostic.repairLinks.length, "each affected task must have one unique per-turn correlation ID");

  const copiedSourceOutput = JSON.parse(JSON.stringify(partialOutput));
  copiedSourceOutput.tasks[1].sourceText = partialOutput.tasks[0].sourceText;
  copiedSourceOutput.contextRelationCandidates[1].evidenceRefs = JSON.parse(JSON.stringify(partialOutput.contextRelationCandidates[0].evidenceRefs));
  const copiedSourcePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(copiedSourceOutput) }) }) });
  const copiedSourceResult = await copiedSourcePlanner.classify(partialInput);
  assert.equal(copiedSourceResult.tasks[1].type, "human_help");
  assert.notEqual(copiedSourceResult.tasks[1].sourceText, partialOutput.tasks[0].sourceText, "an invalid task must not borrow a valid sibling's source clause");
  assert.equal(copiedSourceResult.tasks[1].sourceText, "arrange an unsupported request", "an unbound candidate may use only the event span left unclaimed by preserved siblings");
  assert.equal(copiedSourceResult.contextRelationCandidates[1].evidenceRefs[0].startOffset, 23);
  assert.equal(copiedSourceResult.missingInformation.includes("unscoped_task_contract_failure"), true, "the inferred unclaimed span must remain explicitly marked unscoped");

  const duplicateClauseMessage = "Repeat this request; Repeat this request";
  const duplicateClauseOutput = JSON.parse(JSON.stringify(partialOutput));
  duplicateClauseOutput.tasks[0].sourceText = "Repeat this request";
  duplicateClauseOutput.tasks[0].entity.rawText = "request";
  duplicateClauseOutput.tasks[1].sourceText = "Repeat this request";
  duplicateClauseOutput.contextRelationCandidates = [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "duplicate-clause", messageRef: "", startOffset: 0, endOffset: 19, quote: "Repeat this request" }] },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "duplicate-clause", messageRef: "", startOffset: 21, endOffset: 40, quote: "Repeat this request" }] }
  ];
  duplicateClauseOutput.semanticCandidates = duplicateClauseOutput.semanticCandidates.map((candidate, index) => ({ ...candidate, evidenceRefs: duplicateClauseOutput.contextRelationCandidates[index].evidenceRefs.map((ref) => ({ ...ref })) }));
  const duplicateClauseInput = { currentMessage: duplicateClauseMessage, currentMessages: [duplicateClauseMessage], sourceEvents: [{ eventId: "duplicate-clause", messageText: duplicateClauseMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  const duplicateClausePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(duplicateClauseOutput) }) }) });
  const duplicateClauseResult = await duplicateClausePlanner.classify(duplicateClauseInput);
  assert.equal(duplicateClauseResult.tasks[1].sourceText, "Repeat this request", "a repeated clause must stay scoped by its independently verified evidence offset");
  assert.equal(duplicateClauseResult.contextRelationCandidates[1].evidenceRefs[0].startOffset, 21);

  const containedEvidenceOutput = JSON.parse(JSON.stringify(partialOutput));
  containedEvidenceOutput.tasks[0].sourceText = partialMessage;
  containedEvidenceOutput.contextRelationCandidates[0].evidenceRefs = [{ eventId: "partial", messageRef: "", startOffset: 0, endOffset: partialMessage.length, quote: partialMessage }];
  const containedEvidencePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(containedEvidenceOutput) }) }) });
  const containedEvidenceResult = await containedEvidencePlanner.classify(partialInput);
  assert.equal(containedEvidenceResult.tasks[1].type, "unsupported_task", "a contained invalid evidence span must leave the whole collection fail-closed for the engine validator");
  assert.equal(validatePlannerOutput(containedEvidenceResult).ok, false);
  assert.notEqual(containedEvidenceResult[Symbol.for("junzan.plannerProviderDiagnostic")].taskCollectionRepairPerformed, true);

  const partialOverlapMessage = "Preserved overlap tail request";
  const partialOverlapOutput = JSON.parse(JSON.stringify(partialOutput));
  partialOverlapOutput.tasks[0].sourceText = "Preserved overlap";
  partialOverlapOutput.tasks[0].entity.rawText = "Preserved";
  partialOverlapOutput.tasks[1].sourceText = "overlap tail request";
  partialOverlapOutput.contextRelationCandidates = [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "partial-overlap", messageRef: "", startOffset: 0, endOffset: 17, quote: "Preserved overlap" }] },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "partial-overlap", messageRef: "", startOffset: 10, endOffset: partialOverlapMessage.length, quote: "overlap tail request" }] }
  ];
  partialOverlapOutput.semanticCandidates = partialOverlapOutput.semanticCandidates.map((candidate, index) => ({ ...candidate, evidenceRefs: partialOverlapOutput.contextRelationCandidates[index].evidenceRefs.map((ref) => ({ ...ref })) }));
  const partialOverlapInput = { currentMessage: partialOverlapMessage, currentMessages: [partialOverlapMessage], sourceEvents: [{ eventId: "partial-overlap", messageText: partialOverlapMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  const partialOverlapPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(partialOverlapOutput) }) }) });
  const partialOverlapResult = await partialOverlapPlanner.classify(partialOverlapInput);
  assert.equal(partialOverlapResult.tasks[1].sourceText, "tail request", "an overlapping candidate may retain only the event span not claimed by a preserved sibling");
  assert.equal(partialOverlapResult.contextRelationCandidates[1].evidenceRefs[0].startOffset, 18);
  assert.equal(partialOverlapResult.missingInformation.includes("unscoped_task_contract_failure"), true);

  const crossIdentityOutput = JSON.parse(JSON.stringify(partialOverlapOutput));
  crossIdentityOutput.contextRelationCandidates[0].evidenceRefs[0] = { ...crossIdentityOutput.contextRelationCandidates[0].evidenceRefs[0], messageRef: "", eventId: "cross-identity" };
  crossIdentityOutput.contextRelationCandidates[1].evidenceRefs[0] = { ...crossIdentityOutput.contextRelationCandidates[1].evidenceRefs[0], messageRef: "cross-identity-ref", eventId: "" };
  crossIdentityOutput.semanticCandidates = crossIdentityOutput.semanticCandidates.map((candidate, index) => ({ ...candidate, evidenceRefs: crossIdentityOutput.contextRelationCandidates[index].evidenceRefs.map((ref) => ({ ...ref })) }));
  const crossIdentityInput = { ...partialOverlapInput, sourceEvents: [{ eventId: "cross-identity", messageRef: "cross-identity-ref", messageText: partialOverlapMessage }] };
  const crossIdentityPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(crossIdentityOutput) }) }) });
  const crossIdentityResult = await crossIdentityPlanner.classify(crossIdentityInput);
  assert.equal(crossIdentityResult.tasks[1].sourceText, "tail request", "eventId-only and messageRef-only refs for the same source must still enforce interval overlap");
  assert.equal(crossIdentityResult.contextRelationCandidates[1].evidenceRefs[0].startOffset, 18);
  assert.equal(crossIdentityResult.missingInformation.includes("unscoped_task_contract_failure"), true);

  const breakfastCatalog = buildPropertyCatalog({
    propertyId: "breakfast-property",
    displayName: "Breakfast Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: { breakfastRule: "Breakfast is provided." },
    faqs: [{ knowledgeKey: "breakfast", question: "Is breakfast provided?", answer: "Yes." }],
    semanticCatalog: { aliases: { breakfast: ["早餐", "breakfast"] } }
  });
  const faqOnlyBreakfastCatalog = buildPropertyCatalog({
    propertyId: "faq-breakfast-property",
    displayName: "FAQ Breakfast Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    faqs: [{ knowledgeKey: "breakfast", question: "Is breakfast provided?", answer: "Yes." }],
    semanticCatalog: { aliases: { breakfast: ["早餐", "breakfast"] } }
  });
  for (const [externalMessage, externalCatalog] of [["附近早餐店在哪裡", breakfastCatalog], ["早餐店推薦", faqOnlyBreakfastCatalog]]) {
    const externalOutput = JSON.parse(JSON.stringify(output));
    externalOutput.tasks[0] = {
      ...externalOutput.tasks[0],
      candidateIndex: 0,
      taskId: "external-place",
      type: "human_help",
      sourceText: externalMessage,
      detailIntent: "general",
      requestedOutputs: ["answer"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 },
      stayCandidate: null
    };
    externalOutput.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "external-place", messageRef: "", startOffset: 0, endOffset: externalMessage.length, quote: externalMessage }] }];
    let externalCalls = 0;
    const externalPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
      externalCalls += 1;
      return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(externalOutput) }) };
    } });
    const externalResult = await externalPlanner.classify({ currentMessage: externalMessage, currentMessages: [externalMessage], sourceEvents: [{ eventId: "external-place", messageText: externalMessage }], eventTimestamp: 1, catalog: externalCatalog, contextSnapshot: { scope: {}, cycles: [] } });
    assert.equal(externalCalls, 1, "an external place phrase must not start formal property-fact coverage repair");
    assert.equal(externalResult.tasks.some((task) => task.entity && task.entity.canonicalCandidate === "breakfast"), false);
  }

  const adversarialCoverageMessage = "想問價格，也想確認有戲水池嗎";
  const adversarialPriceEvidence = [{ eventId: "coverage", messageRef: "", startOffset: 0, endOffset: 4, quote: "想問價格" }];
  const adversarialPoolOffset = adversarialCoverageMessage.indexOf("戲水池");
  const adversarialPoolEvidence = [{ eventId: "coverage", messageRef: "", startOffset: adversarialPoolOffset, endOffset: adversarialPoolOffset + 3, quote: "戲水池" }];
  const adversarialFirst = JSON.parse(JSON.stringify(omittedPool));
  adversarialFirst.tasks[0] = { ...adversarialFirst.tasks[0], sourceText: "想問價格" };
  adversarialFirst.contextRelationCandidates[0].evidenceRefs = adversarialPriceEvidence.map((ref) => ({ ...ref }));
  adversarialFirst.semanticCandidates.find((candidate) => candidate.capability === "price").evidenceRefs = adversarialPriceEvidence.map((ref) => ({ ...ref }));
  adversarialFirst.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool").evidenceRefs = adversarialPoolEvidence.map((ref) => ({ ...ref }));
  const validAdversarialPoolRepair = JSON.parse(JSON.stringify(repairedPool));
  validAdversarialPoolRepair.tasks[0] = { ...validAdversarialPoolRepair.tasks[0], sourceText: "戲水池", entity: { ...validAdversarialPoolRepair.tasks[0].entity, rawText: "戲水池" } };
  validAdversarialPoolRepair.contextRelationCandidates[0].evidenceRefs = adversarialPoolEvidence.map((ref) => ({ ...ref }));
  validAdversarialPoolRepair.semanticCandidates = [JSON.parse(JSON.stringify(adversarialFirst.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool")))];
  const mismatchedEvidencePool = JSON.parse(JSON.stringify(validAdversarialPoolRepair));
  mismatchedEvidencePool.contextRelationCandidates[0].evidenceRefs = adversarialPriceEvidence.map((ref) => ({ ...ref }));
  let mismatchedEvidenceCalls = 0;
  const mismatchedEvidencePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    mismatchedEvidenceCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(mismatchedEvidenceCalls === 1 ? adversarialFirst : mismatchedEvidencePool) }) };
  } });
  const mismatchedEvidenceResult = await mismatchedEvidencePlanner.classify({ currentMessage: adversarialCoverageMessage, currentMessages: [adversarialCoverageMessage], sourceEvents: [{ eventId: "coverage", messageText: adversarialCoverageMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(mismatchedEvidenceCalls, 2, "mismatched repair evidence must consume at most the one bounded repair call");
  const { semanticCandidateIds: mismatchedPriceCandidateIds, lodgingScopeId: mismatchedPriceScopeId, ...mismatchedPriceSemantics } = mismatchedEvidenceResult.tasks[0];
  assert.deepEqual(mismatchedPriceSemantics, adversarialFirst.tasks[0]);
  assert.equal(mismatchedPriceCandidateIds.length, 1);
  assert.equal(mismatchedPriceScopeId, null);
  assert.equal(mismatchedEvidenceResult.tasks.some((task) => task.entity && task.entity.canonicalCandidate === repairedPoolCanonicalIdentity), false, "evidence from another clause must fail closed instead of synthesizing a subject");
  const mismatchedEvidenceDiagnostic = mismatchedEvidenceResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(mismatchedEvidenceDiagnostic.coverageRepairSucceeded, false);
  assert.equal(mismatchedEvidenceDiagnostic.coverageRepairFallback, true);
  assert.equal((mismatchedEvidenceDiagnostic.repairLinks || []).some((link) => link.kind === "coverage_repair"), false, "rejected repair evidence must not receive provenance");

  const invalidRelationPool = JSON.parse(JSON.stringify(validAdversarialPoolRepair));
  invalidRelationPool.contextRelationCandidates[0].kind = "supplement_existing";
  invalidRelationPool.contextRelationCandidates[0].candidateRequestCycleRefs = ["invented-cycle"];
  let invalidRelationCalls = 0;
  const invalidRelationPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    invalidRelationCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(invalidRelationCalls === 1 ? adversarialFirst : invalidRelationPool) }) };
  } });
  const invalidRelationInput = { currentMessage: adversarialCoverageMessage, currentMessages: [adversarialCoverageMessage], sourceEvents: [{ eventId: "coverage", messageText: adversarialCoverageMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  const invalidRelationResult = await invalidRelationPlanner.classify(invalidRelationInput);
  assert.equal(invalidRelationCalls, 2, "an invalid relation must consume at most the one bounded repair call");
  const { semanticCandidateIds: invalidRelationPriceCandidateIds, lodgingScopeId: invalidRelationPriceScopeId, ...invalidRelationPriceSemantics } = invalidRelationResult.tasks[0];
  assert.deepEqual(invalidRelationPriceSemantics, adversarialFirst.tasks[0]);
  assert.equal(invalidRelationPriceCandidateIds.length, 1);
  assert.equal(invalidRelationPriceScopeId, null);
  assert.equal(invalidRelationResult.tasks.some((task) => task.entity && task.entity.canonicalCandidate === repairedPoolCanonicalIdentity), false, "an invented cycle must fail closed instead of synthesizing canonical coverage");
  assert.equal(validateUnderstandingContext(invalidRelationResult, invalidRelationInput.contextSnapshot, { sourceEvents: invalidRelationInput.sourceEvents }).ok, true, "discarding invalid repair output must preserve the context contract");
  const invalidRelationDiagnostic = invalidRelationResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(invalidRelationDiagnostic.coverageRepairSucceeded, false);
  assert.equal(invalidRelationDiagnostic.coverageRepairFallback, true);
  assert.equal((invalidRelationDiagnostic.repairLinks || []).some((link) => link.kind === "coverage_repair"), false, "an invalid relation must not receive repair provenance");

  const wrongTaskCanonical = JSON.parse(JSON.stringify(adversarialFirst));
  wrongTaskCanonical.tasks[0].entity.canonicalCandidate = "pool";
  let wrongTaskCalls = 0;
  const wrongTaskPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    wrongTaskCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(wrongTaskCalls === 1 ? wrongTaskCanonical : validAdversarialPoolRepair) }) };
  } });
  const wrongTaskResult = await wrongTaskPlanner.classify(invalidRelationInput);
  assert.equal(wrongTaskCalls, 2, "a canonical candidate attached to another task source must not suppress formal-subject repair");
  assert.equal(wrongTaskResult.tasks[1].entity.canonicalCandidate, "pool");

  const capacityOutput = JSON.parse(JSON.stringify(adversarialFirst));
  capacityOutput.tasks = Array.from({ length: 12 }, (_, index) => ({ ...adversarialFirst.tasks[0], candidateIndex: index, taskId: `price-${index}` }));
  capacityOutput.contextRelationCandidates = Array.from({ length: 12 }, (_, index) => ({ ...adversarialFirst.contextRelationCandidates[0], candidateIndex: index }));
  capacityOutput.semanticCandidates = [
    ...capacityOutput.tasks.map((task) => ({
      ...adversarialFirst.semanticCandidates.find((candidate) => candidate.capability === "price"),
      coverageStatus: "bound",
      provenanceRelationCandidateIndexes: [task.candidateIndex]
    })),
    adversarialFirst.semanticCandidates.find((candidate) => candidate.propertyCatalogIdentity === "pool")
  ];
  let capacityCalls = 0;
  const capacityPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    capacityCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(capacityOutput) }) };
  } });
  const capacityResult = await capacityPlanner.classify(invalidRelationInput);
  assert.equal(capacityCalls, 2, "capacity overflow must remain bounded to one repair call");
  assert.equal(capacityResult.tasks.length, 12, "an unusable repair must preserve every first-round sibling without synthesizing a thirteenth subject");
  assert.equal(capacityResult.tasks.slice(0, 12).every((taskValue, index) => taskValue.taskId === `price-${index}`), true);
  assert.equal(capacityResult.tasks.some((task) => task.entity && task.entity.canonicalCandidate === repairedPoolCanonicalIdentity), false);
  assert.deepEqual(validatePlannerOutput(capacityResult).errors, []);
  assert.equal(capacityResult.needsHuman, true);
  assert.equal(capacityResult.missingInformation.includes("semantic_candidate_coverage_unresolved"), true);
  const capacityDiagnostic = capacityResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(capacityDiagnostic.coverageRepairSucceeded, false);
  assert.equal(capacityDiagnostic.coverageRepairFallback, true);

  const twoSubjectCatalog = buildPropertyCatalog({
    propertyId: "two-subject-property",
    displayName: "Two Subject Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    propertyFacts: [
      { canonicalId: "pool", category: "amenity", status: "available", publicText: "Pool information." },
      { canonicalId: "parking", category: "amenity", status: "available", publicText: "Parking information." }
    ],
    faqs: [
      { knowledgeKey: "pool", question: "戲水池", answer: "正式戲水池資料" },
      { knowledgeKey: "parking", question: "停車場", answer: "正式停車資料" }
    ],
    semanticCatalog: { aliases: { pool: ["戲水池"], parking: ["停車場"] } }
  });
  const elevenTaskOutput = JSON.parse(JSON.stringify(capacityOutput));
  elevenTaskOutput.tasks = elevenTaskOutput.tasks.slice(0, 11);
  elevenTaskOutput.contextRelationCandidates = elevenTaskOutput.contextRelationCandidates.slice(0, 11);
  const twoSubjectMessage = "想問價格，也想確認有戲水池和停車場嗎";
  const twoSubjectInput = { currentMessage: twoSubjectMessage, currentMessages: [twoSubjectMessage], sourceEvents: [{ eventId: "two-subject", messageText: twoSubjectMessage }], eventTimestamp: 1, catalog: twoSubjectCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  elevenTaskOutput.contextRelationCandidates.forEach((relation) => {
    relation.evidenceRefs = [{ eventId: "two-subject", messageRef: "", startOffset: 0, endOffset: 4, quote: "想問價格" }];
  });
  const twoSubjectIdentities = [{ id: "pool", mention: "\u6232\u6c34\u6c60" }, { id: "parking", mention: "\u505c\u8eca\u5834" }];
  elevenTaskOutput.semanticCandidates = [...elevenTaskOutput.tasks.map((task) => ({ semanticKind: "capability", capability: "price", canonicalIdentityCandidate: "price", coverageStatus: "bound", provenanceRelationCandidateIndexes: [task.candidateIndex], evidenceRefs: elevenTaskOutput.contextRelationCandidates[task.candidateIndex].evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: null })), ...twoSubjectIdentities.map((identity) => {
    const startOffset = twoSubjectMessage.indexOf(identity.mention);
    return {
      semanticKind: "catalog_subject",
      capability: "amenity",
      canonicalIdentityCandidate: identity.id,
      coverageStatus: "pending_task",
      evidenceRefs: [{ eventId: "two-subject", messageRef: "", startOffset, endOffset: startOffset + identity.mention.length, quote: identity.mention }],
      lodgingScopeCandidate: null,
      temporalSemanticCandidate: null,
      propertyCatalogIdentity: identity.id
    };
  })];
  const twoSubjectRepair = JSON.parse(JSON.stringify(multiFormalRepair));
  twoSubjectRepair.tasks = twoSubjectIdentities.map((identity, index) => ({ ...twoSubjectRepair.tasks[index], candidateIndex: index, taskId: ["7d000000-0000-4000-8000-000000000001", "7d000000-0000-4000-8000-000000000002"][index], type: "amenity", sourceText: identity.mention, requestedOutputs: ["answer"], dependsOnStayContext: false, entity: { category: "amenity", rawText: identity.mention, canonicalCandidate: identity.id, confidence: 1 }, stayCandidate: null }));
  twoSubjectRepair.tasks.forEach((task) => { delete task.semanticCandidateIds; delete task.lodgingScopeId; });
  twoSubjectRepair.contextRelationCandidates = twoSubjectRepair.tasks.map((task) => { const startOffset = twoSubjectMessage.indexOf(task.sourceText); return { candidateIndex: task.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "two-subject", messageRef: "", startOffset, endOffset: startOffset + task.sourceText.length, quote: task.sourceText }] }; });
  twoSubjectRepair.semanticCandidates = elevenTaskOutput.semanticCandidates.filter((candidate) => candidate.capability === "amenity").map((candidate, index) => ({ ...candidate, coverageStatus: "bound", provenanceRelationCandidateIndexes: [index], evidenceRefs: candidate.evidenceRefs.map((ref) => ({ ...ref })) }));

  let twoSubjectCalls = 0;
  const twoSubjectPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    twoSubjectCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(twoSubjectCalls === 1 ? elevenTaskOutput : twoSubjectRepair) }) };
  } });
  const twoSubjectResult = await twoSubjectPlanner.classify(twoSubjectInput);
  assert.equal(twoSubjectResult.tasks.length, 13, "both missing subjects must become executable canonical siblings without evicting eleven tasks");
  assert.deepEqual(new Set(twoSubjectResult.tasks.slice(11).map((taskValue) => taskValue.entity.canonicalCandidate)), new Set(["pool", "parking"]));
  assert.deepEqual(validatePlannerOutput(twoSubjectResult).errors, []);
  assert.equal(twoSubjectCalls, 2, "two missing subjects must use exactly the one bounded repair call");
  const twoSubjectCompiledCandidates = twoSubjectResult.semanticCandidates.filter((candidate) => ["pool", "parking"].includes(candidate.propertyCatalogIdentity));
  assert.deepEqual(new Set(twoSubjectResult.tasks.slice(11).flatMap((task) => task.semanticCandidateIds)), new Set(twoSubjectCompiledCandidates.map((candidate) => candidate.candidateId)));
  assert.equal(twoSubjectCompiledCandidates.every((candidate) => twoSubjectResult.semanticCandidates.filter((item) => item.candidateId === candidate.candidateId).length === 1), true, "each repaired candidate must join uniquely to the ledger");
  const twoSubjectDiagnostic = twoSubjectResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(twoSubjectDiagnostic.coverageRepairSucceeded, true);
  assert.equal(twoSubjectDiagnostic.coverageRepairFallback, false);
  assert.equal(twoSubjectDiagnostic.repairLinks.filter((link) => link.kind === "coverage_repair" && twoSubjectResult.tasks.slice(11).some((task) => task.taskId === link.taskId)).length, 2, "each repaired subject must retain its own direct provenance link");

  const blankRawPool = JSON.parse(JSON.stringify(repairedPool));
  const blankRawMessage = "戲水池要收費嗎？";
  blankRawPool.tasks[0] = { ...omittedPool.tasks[0], sourceText: blankRawMessage, entity: { category: "policy", rawText: "", canonicalCandidate: "pool", confidence: 1 } };
  blankRawPool.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "blank-raw", messageRef: "", startOffset: 0, endOffset: blankRawMessage.length, quote: blankRawMessage }] }];
  blankRawPool.semanticCandidates = [{ semanticKind: "catalog_subject", capability: "price", canonicalIdentityCandidate: "pool", coverageStatus: "bound", provenanceRelationCandidateIndexes: [0], evidenceRefs: blankRawPool.contextRelationCandidates[0].evidenceRefs.map((ref) => ({ ...ref })), lodgingScopeCandidate: null, temporalSemanticCandidate: null, propertyCatalogIdentity: "pool" }];
  let blankRawCalls = 0;
  const blankRawPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    blankRawCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(blankRawPool) }) };
  } });
  const blankRawInput = { currentMessage: blankRawMessage, currentMessages: [blankRawMessage], sourceEvents: [{ eventId: "blank-raw", messageText: blankRawMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  const blankRawResult = await blankRawPlanner.classify(blankRawInput);
  assert.equal(blankRawCalls, 1, "a verified formal subject that Semantic Contract can normalize must not trigger a duplicate repair sibling");
  const blankRawSemantic = applyPlannerSemanticContract(blankRawResult, { catalog: coverageCatalog, sourceEvents: blankRawInput.sourceEvents });
  assert.equal(blankRawSemantic.tasks[0].type, "price", "semantic core must preserve the Planner capability rather than reinterpret source wording");
  assert.equal(blankRawSemantic.tasks[0].entity.canonicalCandidate, "pool");
  const missingTaskDate = JSON.parse(JSON.stringify(omittedPool));
  missingTaskDate.tasks[0] = { ...missingTaskDate.tasks[0], sourceText: "7/20想問價格" };
  let temporalCalls = 0;
  const temporalPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async (_url, options) => {
    temporalCalls += 1;
    return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(missingTaskDate) }) };
  } });
  const temporalResult = await temporalPlanner.classify({ currentMessage: "7/20想問價格", currentMessages: ["7/20想問價格"], sourceEvents: [{ eventId: "temporal", messageText: "7/20想問價格" }], eventTimestamp: Date.parse("2026-08-06T08:00:00Z"), catalog: { propertyId: "temporal-property", rooms: [], policies: [], amenities: [], transportFacts: [], aliases: {} }, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(temporalCalls, 1, "temporal candidates must be validated by the canonical temporal authority, not by retrying the Planner provider");
  assert.equal(temporalResult.tasks[0].stayCandidate.dateExpression.kind, "none");
  assert.equal(runtimeConfig({ TEST_ONLY_CONVERSATION_ENGINE_V2: "true" }).testOnlyConversationEngineV2, true);
  assert.equal(runtimeConfig({}).testOnlyConversationEngineV2, false);
  let composerRequest;
  const composerOutput = { sections: [{ taskId: "1", responseMode: "answer", text: "已確認住宿資訊。" }] };
  const composer = new TestOnlyOpenAiControlledComposer({ apiKey: "test-key", model: "test-model", fetchImpl: async (_url, options) => { composerRequest = JSON.parse(options.body); return { ok: true, json: async () => ({ output_text: encodeFakePlannerOutput(composerOutput) }) }; } });
  const composed = await composer.compose({ sections: [{ taskId: "1", responseMode: "answer", facts: { answer: "已確認住宿資訊。" } }] });
  assert.deepEqual(composed, composerOutput);
  assert.equal(composerRequest.text.format.name, "junzan_controlled_reply_v2");
  assert.deepEqual(composerRequest.text.format.schema.properties.sections.items.properties.responseMode.enum, ["answer", "clarification", "handoff"]);
  assert.deepEqual(JSON.parse(composerRequest.input[1].content[0].text), {
    sections: [{ taskId: "1", responseMode: "answer", exactText: "已確認住宿資訊。" }]
  });
  assert.deepEqual(composerRequest.text.format.schema.properties.sections.items.properties.text.enum, ["已確認住宿資訊。"]);
  assert.match(composerRequest.input[0].content[0].text, /copy taskId, responseMode, and exactText without changing/i);
  assert.equal(JSON.stringify(composerRequest).includes("test-key"), false);
  console.log("conversation planner v2 adapter: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
