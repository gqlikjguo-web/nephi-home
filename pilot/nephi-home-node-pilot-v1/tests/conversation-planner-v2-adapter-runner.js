"use strict";
const assert = require("node:assert/strict");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");
const { TestOnlyOpenAiControlledComposer } = require("../lib/providers/test-only-openai-controlled-composer");
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
  assert.match(requestBody.input[0].content[0].text, /preserve every stated nights, guest count, and feature even when a date is missing/i);
  assert.match(requestBody.input[0].content[0].text, /explicit calendar expression/i);
  assert.match(requestBody.input[0].content[0].text, /relationship between the property and any external place/i, "planner must recognize location relationships as one shared semantic concept");
  assert.match(requestBody.input[0].content[0].text, /proximity, near, far, distance, duration, directions, or nearby existence/i, "planner must cover proximity semantics rather than a fixed list of place names");
  assert.match(requestBody.input[0].content[0].text, /takes precedence over a general FAQ or place topic/i, "location relationships must win when a place topic would otherwise compete");
  assert.equal(JSON.stringify(requestBody).includes("test-key"), false);
  assert.equal(runtimeConfig({ TEST_ONLY_CONVERSATION_ENGINE_V2: "true" }).testOnlyConversationEngineV2, true);
  assert.equal(runtimeConfig({}).testOnlyConversationEngineV2, false);
  let composerRequest;
  const composerOutput = { sections: [{ taskId: "1", responseMode: "answer", text: "已確認住宿資訊。" }] };
  const composer = new TestOnlyOpenAiControlledComposer({ apiKey: "test-key", model: "test-model", fetchImpl: async (_url, options) => { composerRequest = JSON.parse(options.body); return { ok: true, json: async () => ({ output_text: JSON.stringify(composerOutput) }) }; } });
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
