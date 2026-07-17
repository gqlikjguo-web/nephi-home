"use strict";
const assert = require("node:assert/strict");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");
const { runtimeConfig } = require("../config/runtime");

const output = { schemaVersion: 2, discourse: { relation: "new_request", confidence: 1 }, stateOperations: [], stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, tasks: [{ taskId: "1", type: "property_fact", sourceText: "你好", requestedOutputs: ["greeting"], dependsOnStayContext: false, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, confidence: 1 }], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "greeting" };
let requestBody;
const planner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", fetchImpl: async (_url, options) => { requestBody = JSON.parse(options.body); return { ok: true, json: async () => ({ output_text: JSON.stringify(output) }) }; } });

(async () => {
  const result = await planner.classify({ currentMessage: "你好", currentMessages: ["你好"], eventTimestamp: 1, catalog: { propertyId: "p1", rooms: [] }, conversationState: { schemaVersion: 2 } });
  assert.equal(result.schemaVersion, 2);
  assert.equal(requestBody.text.format.name, "junzan_conversation_plan_v2");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.text.format.schema.properties.tasks.minItems, 1);
  assert.equal(JSON.stringify(requestBody).includes("test-key"), false);
  assert.equal(runtimeConfig({ TEST_ONLY_CONVERSATION_ENGINE_V2: "true" }).testOnlyConversationEngineV2, true);
  assert.equal(runtimeConfig({}).testOnlyConversationEngineV2, false);
  console.log("conversation planner v2 adapter: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
