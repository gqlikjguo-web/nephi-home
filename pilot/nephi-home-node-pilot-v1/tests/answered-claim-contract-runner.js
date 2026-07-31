"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { TestOnlyOpenAiControlledComposer } = require("../lib/providers/test-only-openai-controlled-composer");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeSection } = require("../lib/conversation-engine-v2/controlled-composer");
const { validateClaims } = require("../lib/conversation-engine-v2/claim-validator");
const { buildFinalDecision } = require("../lib/conversation-engine-v2/final-decision");

const PROPERTY_ID = "demo_homestay_a";
const FIXED_NOW = "2026-07-17T10:00:00+08:00";
const LINE_SECRET = "answered-claim-contract-secret";
const EMPTY_STAY = Object.freeze({
  dateExpression: { rawText: "", kind: "none", anchor: "none" },
  checkInCandidate: null,
  checkOutCandidate: null,
  nightsCandidate: null,
  guestCountCandidate: null
});
const DATE_STAY = Object.freeze({
  dateExpression: { rawText: "8/6", kind: "absolute", anchor: "message_time" },
  checkInCandidate: "2026-08-06",
  checkOutCandidate: null,
  nightsCandidate: 1,
  guestCountCandidate: null
});

const property = {
  propertyId: PROPERTY_ID,
  displayName: "Claim Contract Test",
  timezone: "Asia/Taipei",
  currency: "TWD",
  rooms: [
    { id: "double", name: "雙人房", type: "雙人房", capacity: 2, enabled: true }
  ],
  commonAnswers: {
    parkingRule: "民宿旁有正式停車空間。",
    bbqRule: "可在業者指定區域烤肉。"
  },
  faqs: [
    { knowledgeKey: "pool", question: "有戲水池嗎？", answer: "有季節性戲水池。" }
  ],
  semanticCatalog: {
    aliases: {
      double: ["雙人房"],
      parking: ["車位"],
      bbq: ["烤肉"],
      pool: ["戲水池"]
    },
    amenities: []
  }
};

const CASES = Object.freeze([
  {
    id: "availability",
    message: "8/6 有房嗎？",
    tasks: [{
      taskId: "availability",
      type: "availability",
      sourceText: "8/6 有房嗎？",
      requestedOutputs: ["availability"],
      dependsOnStayContext: true,
      entity: { category: "room", rawText: "", canonicalCandidate: null, confidence: 0.99 },
      stayCandidate: DATE_STAY
    }],
    stay: DATE_STAY,
    expectedSource: "availability_resolver"
  },
  {
    id: "parking",
    message: "有車位嗎？",
    tasks: [{
      taskId: "parking",
      type: "amenity",
      sourceText: "有車位嗎？",
      requestedOutputs: ["answer"],
      dependsOnStayContext: false,
      entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 },
      stayCandidate: null
    }],
    stay: EMPTY_STAY,
    expectedSource: "property_catalog"
  },
  {
    id: "bbq",
    message: "可以烤肉嗎？",
    tasks: [{
      taskId: "bbq",
      type: "policy",
      sourceText: "可以烤肉嗎？",
      requestedOutputs: ["answer"],
      dependsOnStayContext: false,
      entity: { category: "policy", rawText: "烤肉", canonicalCandidate: "bbq", confidence: 0.99 },
      stayCandidate: null
    }],
    stay: EMPTY_STAY,
    expectedSource: "property_catalog"
  },
  {
    id: "pool",
    message: "有戲水池嗎？",
    tasks: [{
      taskId: "pool",
      type: "amenity",
      sourceText: "有戲水池嗎？",
      requestedOutputs: ["answer"],
      dependsOnStayContext: false,
      entity: { category: "amenity", rawText: "戲水池", canonicalCandidate: "pool", confidence: 0.99 },
      stayCandidate: null
    }],
    stay: EMPTY_STAY,
    expectedSource: "property_catalog"
  },
  {
    id: "mixed",
    message: "8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？",
    tasks: [
      {
        taskId: "availability",
        type: "availability",
        sourceText: "8/6 有雙人房嗎？",
        requestedOutputs: ["availability"],
        dependsOnStayContext: true,
        entity: { category: "room", rawText: "雙人房", canonicalCandidate: null, confidence: 0.99 },
        stayCandidate: DATE_STAY
      },
      {
        taskId: "parking",
        type: "availability",
        sourceText: "有車位嗎？",
        requestedOutputs: ["availability", "policy"],
        dependsOnStayContext: false,
        entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 0.99 },
        stayCandidate: null
      },
      {
        taskId: "bbq",
        type: "policy",
        sourceText: "可以烤肉嗎？",
        requestedOutputs: ["answer"],
        dependsOnStayContext: false,
        entity: { category: "policy", rawText: "烤肉", canonicalCandidate: "bbq", confidence: 0.99 },
        stayCandidate: null
      }
    ],
    stay: DATE_STAY,
    expectedSource: null
  }
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function plannerFor(testCase) {
  return {
    classify: async ({ sourceEvents }) => {
      const source = sourceEvents[0];
      const tasks = testCase.tasks.map((task, candidateIndex) => ({
        detailIntent: "general",
        eligibilityEvidence: { kind: "none", sourceText: "" },
        confidence: 0.99,
        ...clone(task),
        candidateIndex
      }));
      return {
        schemaVersion: 2,
        discourse: { relation: "new_request", confidence: 0.99 },
        stateOperations: [],
        stay: clone(testCase.stay),
        tasks,
        contextRelationCandidates: tasks.map((task) => ({
          candidateIndex: task.candidateIndex,
          kind: "new_request",
          candidateRequestCycleRefs: [],
          evidenceRefs: [{
            eventId: source.eventId,
            messageRef: source.messageRef || "",
            startOffset: 0,
            endOffset: source.messageText.length,
            quote: source.messageText
          }]
        })),
        ambiguities: [],
        missingInformation: [],
        needsHuman: false,
        shouldIgnore: false,
        reason: "answered_claim_contract"
      };
    }
  };
}

function waitForResult(results, eventId, timeoutMs = 3000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (results.has(eventId)) return resolve(results.get(eventId));
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error(`engine result timeout: ${eventId}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function runCase(testCase) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `answered-claim-${testCase.id}-`));
  const diagnostics = [];
  const providerRequests = [];
  const providerCandidates = [];
  const lineCalls = [];
  const engineResults = new Map();
  const composer = new TestOnlyOpenAiControlledComposer({
    apiKey: "test-only-key",
    model: "test-only-model",
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      providerRequests.push(request);
      const inputPlan = JSON.parse(request.input[1].content[0].text);
      const hasExactContract = inputPlan.sections.every((section) => typeof section.exactText === "string");
      const sections = inputPlan.sections.map((section) => ({
        taskId: section.taskId,
        responseMode: section.responseMode,
        text: hasExactContract ? section.exactText : `回覆：${composeSection(section)}`
      }));
      providerCandidates.push(clone(sections));
      return {
        ok: true,
        json: async () => ({ output_text: JSON.stringify({ sections }) })
      };
    }
  });
  const app = createApp({
    dataFile: path.join(temp, "store.json"),
    seedFile: path.resolve(__dirname, "../fixtures/seed.json"),
    now: () => new Date(FIXED_NOW),
    lineChannelSecret: LINE_SECRET,
    lineChannelAccessToken: "test-only-token",
    lineChannelIdentityGuardRequired: false,
    conversationDebounceMs: 1,
    testOnlyOverrides: {
      planner: plannerFor(testCase),
      composer,
      getProperty: () => property,
      availabilityResolver: (query) => ({
        ...query,
        availabilityReliable: true,
        rooms: property.rooms,
        lineUrl: ""
      }),
      onDiagnostic: (entry) => diagnostics.push(clone(entry))
    },
    lineReplyClientFactory: () => ({
      replyMessageWithHttpInfo: async (body) => {
        lineCalls.push(clone(body));
        return { httpResponse: { status: 200 } };
      }
    })
  });
  app.conversationEngineV2.diagnosticDetail = true;
  const processEngine = app.conversationEngineV2.process.bind(app.conversationEngineV2);
  app.conversationEngineV2.process = async (input) => {
    const result = await processEngine(input);
    engineResults.set(input.eventId, clone(result));
    return result;
  };
  const running = await app.start(0, "127.0.0.1");
  try {
    const eventId = `answered-claim-${testCase.id}`;
    const raw = JSON.stringify({
      destination: "answered-claim-line",
      events: [{
        type: "message",
        webhookEventId: eventId,
        replyToken: `reply-${testCase.id}`,
        timestamp: Date.parse(FIXED_NOW),
        source: { userId: `guest-${testCase.id}` },
        message: { type: "text", id: `message-${testCase.id}`, text: testCase.message }
      }]
    });
    const signature = crypto.createHmac("sha256", LINE_SECRET).update(raw).digest("base64");
    const response = await fetch(`${running.url}/api/test-line/webhook?customerId=${PROPERTY_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": signature },
      body: raw
    });
    assert.equal(response.status, 200);
    const result = await waitForResult(engineResults, eventId);
    const stage = (name) => diagnostics.find((entry) => entry.stage === name);
    const executor = stage("executor");
    const responsePlan = stage("response_plan");
    const composerTrace = stage("composer");
    const claimTrace = stage("claim_validator");
    return {
      id: testCase.id,
      result,
      plannerPassed: Boolean(stage("planner") && stage("semantic_contract")),
      contextPassed: Boolean(stage("context_validation") && !stage("fallback")),
      executor,
      responsePlan,
      composerTrace,
      claimTrace,
      providerRequest: providerRequests[0],
      providerCandidate: providerCandidates[0],
      lineCalls
    };
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function evidence(trace) {
  return {
    id: trace.id,
    plannerPassed: trace.plannerPassed,
    contextPassed: trace.contextPassed,
    executor: trace.executor.results.map((item) => ({
      taskId: item.taskId,
      status: item.status,
      factSource: item.facts && item.facts.source
    })),
    responsePlan: trace.responsePlan.sections.map((section) => ({
      taskId: section.taskId,
      responseMode: section.responseMode,
      factSource: section.facts && section.facts.source,
      allowedFacts: section.allowedFacts
    })),
    deterministicReply: trace.composerTrace.finalOutput,
    providerCandidate: trace.providerCandidate,
    composer: {
      validationResult: trace.composerTrace.validationResult,
      rejectionReasonCodes: trace.composerTrace.rejectionReasonCodes,
      claimedTaskIds: trace.composerTrace.coveredTaskIds,
      missingTaskIds: trace.composerTrace.missingTaskIds
    },
    claimValidation: {
      ok: trace.result.claimValidation.ok,
      errors: trace.result.claimValidation.errors,
      coveredTaskIds: trace.result.claimValidation.coveredTaskIds,
      missingTaskIds: trace.result.claimValidation.missingTaskIds
    },
    finalDecision: trace.result.finalDecision
  };
}

function assertSafetyContracts() {
  const groundedPlan = buildResponsePlan({
    propertyId: PROPERTY_ID,
    taskResults: [{
      taskId: "parking",
      type: "amenity",
      status: "answered",
      facts: { subject: "停車", answer: "有正式停車資料。", source: "property_catalog" }
    }],
    inputTaskIds: ["parking"]
  });
  const exact = composeSection(groundedPlan.sections[0]);
  assert.equal(validateClaims(exact, groundedPlan, ["parking"], [{
    taskId: "parking", responseMode: "answer", text: exact
  }]).ok, true);

  const missingSourcePlan = buildResponsePlan({
    propertyId: PROPERTY_ID,
    taskResults: [{
      taskId: "missing-source",
      type: "amenity",
      status: "answered",
      facts: { subject: "設施", answer: "有設施。" }
    }],
    inputTaskIds: ["missing-source"]
  });
  assert.deepEqual(
    validateClaims(composeSection(missingSourcePlan.sections[0]), missingSourcePlan, ["missing-source"]).errors,
    ["missing_fact_source"]
  );
  assert.ok(validateClaims(exact, groundedPlan, []).errors.includes("incomplete_task_coverage"));
  assert.ok(validateClaims(`${exact}另有未經證實的私人接送。`, groundedPlan, ["parking"], [{
    taskId: "parking",
    responseMode: "answer",
    text: `${exact}另有未經證實的私人接送。`
  }]).errors.includes("ungrounded_section_text"));

  const answered = { taskId: "answered", outcome: "answered" };
  assert.equal(buildFinalDecision({ executionOutcomes: [answered, { taskId: "unknown", outcome: "unknown", reason: "property_fact_unknown" }] }).action, "reply");
  assert.equal(buildFinalDecision({ executionOutcomes: [answered, { taskId: "technical", outcome: "technical_error", reason: "resolver_exception" }] }).action, "handoff");
  assert.equal(buildFinalDecision({ executionOutcomes: [answered, { taskId: "invalid", outcome: "invalid_query_plan", reason: "property_scope_mismatch" }] }).action, "handoff");
  assert.equal(buildFinalDecision({ executionOutcomes: [answered, { taskId: "risk", outcome: "unknown", reason: "high_risk", type: "high_risk" }] }).action, "handoff");
  assert.equal(buildFinalDecision({ executionOutcomes: [], plannerFailure: "context_relation_invalid" }).action, "handoff");
  assert.equal(buildFinalDecision({ executionOutcomes: [], plannerFailure: "planner_parse_failed" }).action, "handoff");
}

(async () => {
  const traces = [];
  for (const testCase of CASES) traces.push(await runCase(testCase));
  console.log(JSON.stringify({
    suite: "answered-claim-contract",
    traces: traces.map(evidence)
  }, null, 2));

  for (const trace of traces.slice(0, 4)) {
    const testCase = CASES.find((item) => item.id === trace.id);
    assert.equal(trace.plannerPassed, true, `${trace.id}: Planner and semantic contract must pass`);
    assert.equal(trace.contextPassed, true, `${trace.id}: context validation must pass`);
    assert.equal(trace.executor.results.length, 1);
    assert.equal(trace.executor.results[0].status, "answered");
    assert.equal(trace.executor.results[0].facts.source, testCase.expectedSource);
    assert.equal(trace.responsePlan.sections.length, 1);
    assert.ok(trace.composerTrace.finalOutput, `${trace.id}: deterministic reply must exist`);
    assert.equal(trace.providerRequest.input[1].content[0].text.includes("\"exactText\""), true);
    assert.equal(trace.composerTrace.validationResult, "accepted");
    assert.deepEqual(trace.composerTrace.rejectionReasonCodes, []);
    assert.equal(trace.result.claimValidation.ok, true);
    assert.deepEqual(trace.result.claimValidation.errors, []);
    assert.deepEqual(trace.result.claimValidation.coveredTaskIds, [trace.executor.results[0].taskId]);
    assert.deepEqual(trace.result.claimValidation.missingTaskIds, []);
    assert.equal(trace.result.finalDecision.action, "reply");
    assert.equal(trace.result.finalDecision.reasonCode, "execution_answered");
    assert.equal(trace.result.replyText.includes("部分內容無法安全確認"), false);
    assert.equal(trace.lineCalls.length, 1);
  }

  const mixed = traces.find((trace) => trace.id === "mixed");
  assert.deepEqual(mixed.executor.results.map((item) => item.status), ["answered", "answered", "answered"]);
  assert.deepEqual(mixed.executor.results.map((item) => item.facts.source), ["availability_resolver", "property_catalog", "property_catalog"]);
  assert.equal(mixed.composerTrace.validationResult, "accepted");
  assert.equal(mixed.result.claimValidation.ok, true);
  assert.deepEqual(mixed.result.claimValidation.missingTaskIds, []);
  assert.equal(mixed.result.finalDecision.action, "reply");
  assert.equal(mixed.result.finalDecision.reasonCode, "execution_answered");
  assertSafetyContracts();
  console.log("answered claim contract: PASS (4 single answers + mixed and safety guards)");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
