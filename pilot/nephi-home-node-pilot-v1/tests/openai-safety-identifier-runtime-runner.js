"use strict";

const assert = require("node:assert/strict");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");
const { TestOnlyOpenAiCoverageCritic } = require("../lib/providers/test-only-openai-coverage-critic");
const { TestOnlyOpenAiControlledComposer } = require("../lib/providers/test-only-openai-controlled-composer");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");

const lineUserId = "U-safety-identifier-guest";
const expectedSafetyIdentifier = "1752f633bd113f7e38c22b0fa821b909221797be7978fc2187f5f1d1111dfb8d";
const messageText = "有車位嗎";
const sourceRef = { eventId: "safety-event", messageRef: "", startOffset: 0, endOffset: messageText.length, quote: messageText };
const plannerOutput = {
  schemaVersion: 2,
  discourse: { relation: "new_request", confidence: 1 },
  stateOperations: [],
  stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
  tasks: [{ taskId: "parking", type: "amenity", sourceText: messageText, requestedOutputs: ["amenity"], dependsOnStayContext: false, entity: { category: "amenity", rawText: "車位", canonicalCandidate: "parking", confidence: 1 }, confidence: 1 }],
  ambiguities: [],
  missingInformation: [],
  needsHuman: false,
  shouldIgnore: false,
  reason: "greeting"
};

function providerResponse(output) {
  const payload = { output_text: JSON.stringify(output) };
  return {
    ok: true,
    status: 200,
    headers: { get: () => "" },
    text: async () => JSON.stringify(payload),
    json: async () => payload
  };
}

(async () => {
  const requestBodies = { planner: [], critic: [], composer: [] };
  let internalContextSnapshot = null;
  let internalPlannerInput = null;
  const critic = new TestOnlyOpenAiCoverageCritic({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      requestBodies.critic.push(JSON.parse(options.body));
      return providerResponse({ missingRequests: [] });
    }
  });
  const planner = new TestOnlyOpenAiConversationPlanner({
    apiKey: "test-key",
    model: "test-model",
    coverageCritic: critic,
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      requestBodies.planner.push(JSON.parse(options.body));
      return providerResponse(plannerOutput);
    }
  });
  const composer = new TestOnlyOpenAiControlledComposer({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requestBodies.composer.push(body);
      const plan = JSON.parse(body.input[1].content[0].text);
      return providerResponse({ sections: plan.sections.map((section) => ({ taskId: section.taskId, responseMode: section.responseMode, text: section.exactText })) });
    }
  });
  const enginePlanner = {
    classify: async (input) => {
      internalPlannerInput = input;
      internalContextSnapshot = input.contextSnapshot;
      const output = await planner.classify(input);
      const tasks = output.tasks.map((task, candidateIndex) => ({ ...task, candidateIndex }));
      return migrateFakePlannerOutput({
        ...output,
        tasks,
        contextRelationCandidates: tasks.map((task) => ({ candidateIndex: task.candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [sourceRef] }))
      });
    }
  };
  const states = new Map();
  const engine = new ConversationEngineV2({
    planner: enginePlanner,
    composer,
    persistence: {
      getConversationState: (propertyId, channelId, userId) => states.get(`${propertyId}:${channelId}:${userId}`) || null,
      setConversationState: (propertyId, channelId, userId, state) => states.set(`${propertyId}:${channelId}:${userId}`, state),
      appendMessageLog: (_propertyId, value) => ({ ...value, reviewId: value.needsReview ? "review-safety" : "" })
    },
    getProperty: () => ({ propertyId: "safety-property", displayName: "Safety Property", timezone: "Asia/Taipei", currency: "TWD", rooms: [], commonAnswers: { parkingRule: "提供一個停車位" }, semanticCatalog: { aliases: { parking: ["車位"] }, amenities: [] } }),
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [], lineUrl: "" }),
    availableDatesResolver: () => ({ status: "answered", dates: [] }),
    listPriceOverrides: () => [],
    listDatePriceClassifications: () => [],
    listCustomReplies: () => [],
    now: () => new Date("2026-08-17T00:00:00.000Z")
  });

  await engine.process({ customerId: "safety-property", channelId: "safety-channel", lineUserId, eventId: "safety-event", eventTimestamp: Date.parse("2026-08-17T00:00:00.000Z"), messageText });

  const missingSafetyIdentifiers = [];
  for (const [consumer, bodies] of Object.entries(requestBodies)) {
    assert.equal(bodies.length, 1, `${consumer} must issue exactly one request through the existing Engine/provider path`);
    if (bodies[0].safety_identifier !== expectedSafetyIdentifier) missingSafetyIdentifiers.push(consumer);
  }
  assert.deepEqual(missingSafetyIdentifiers, [], `requests missing sha256(lineUserId) safety_identifier: ${missingSafetyIdentifiers.join(", ")}`);
  assert.equal(new Set(Object.values(requestBodies).map(([body]) => body.safety_identifier)).size, 1, "all three requests must use the same guest safety_identifier");
  const plannerInput = JSON.parse(requestBodies.planner[0].input[1].content[0].text);
  assert.equal(Object.hasOwn(plannerInput.contextSnapshot.scope, "userId"), false, "Planner OpenAI input must omit raw contextSnapshot.scope.userId");
  assert.equal(JSON.stringify(requestBodies.planner[0]).includes(lineUserId), false, "Planner OpenAI payload must not contain raw lineUserId");
  assert.equal(internalContextSnapshot.scope.userId, lineUserId, "provider serialization must not mutate the Engine contextSnapshot");

  await planner.requestOnce({ ...internalPlannerInput, lineUserId: "" }, 1);
  await critic.review({ sourceEvents: [], coveredRequests: [], lineUserId: "" });
  await composer.compose({ sections: [] }, { lineUserId: "" });
  for (const [consumer, bodies] of Object.entries(requestBodies)) {
    assert.equal(bodies.length, 2, `${consumer} must issue one identified and one anonymous request`);
    assert.equal(Object.hasOwn(bodies[1], "safety_identifier"), false, `${consumer} must omit safety_identifier without lineUserId`);
  }

  console.log(JSON.stringify({ caseCount: 13, passCount: 13, failCount: 0, requests: Object.fromEntries(Object.entries(requestBodies).map(([key, value]) => [key, value.length])) }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
