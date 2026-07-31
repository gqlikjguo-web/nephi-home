"use strict";

const { composeSection } = require("../conversation-engine-v2/controlled-composer");

const RESPONSES_URL = "https://api.openai.com/v1/responses";
function outputText(payload) { if (payload && typeof payload.output_text === "string") return payload.output_text; for (const item of payload && payload.output || []) for (const part of item.content || []) if (part.type === "output_text") return part.text || ""; return ""; }
function exactComposerPlan(responsePlan) {
  return {
    sections: (responsePlan.sections || []).map((section) => ({
      taskId: section.taskId,
      responseMode: section.responseMode,
      exactText: composeSection(section)
    }))
  };
}
function outputSchema(composerPlan) {
  const taskIds = [...new Set(composerPlan.sections.map((section) => section.taskId))];
  const exactTexts = [...new Set(composerPlan.sections.map((section) => section.exactText))];
  return { type: "object", additionalProperties: false, required: ["sections"], properties: { sections: { type: "array", minItems: composerPlan.sections.length, maxItems: composerPlan.sections.length, items: { type: "object", additionalProperties: false, required: ["taskId", "responseMode", "text"], properties: { taskId: { type: "string", enum: taskIds, maxLength: 80 }, responseMode: { type: "string", enum: ["answer", "clarification", "handoff"] }, text: { type: "string", enum: exactTexts, minLength: 1, maxLength: 1200 } } } } } };
}

class TestOnlyOpenAiControlledComposer {
  constructor({ apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) { this.apiKey = apiKey; this.model = model; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  async compose(responsePlan) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const composerPlan = exactComposerPlan(responsePlan);
      const response = await this.fetchImpl(RESPONSES_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, signal: controller.signal, body: JSON.stringify({ model: this.model, input: [{ role: "system", content: [{ type: "input_text", text: "Return every supplied section exactly once, in the supplied order. Copy taskId, responseMode, and exactText without changing, adding, removing, paraphrasing, or translating any content. Put exactText in the output text field." }] }, { role: "user", content: [{ type: "input_text", text: JSON.stringify(composerPlan) }] }], text: { format: { type: "json_schema", name: "junzan_controlled_reply_v2", strict: true, schema: outputSchema(composerPlan) } } }) });
      if (!response.ok) throw new Error("composer_http_error"); return JSON.parse(outputText(await response.json()));
    } finally { clearTimeout(timer); }
  }
}
function createTestOnlyOpenAiControlledComposerFromEnv({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) { const apiKey = String(env.OPENAI_TEST_API_KEY || "").trim(), model = String(env.OPENAI_TEST_MODEL || "").trim(); return apiKey && model ? new TestOnlyOpenAiControlledComposer({ apiKey, model, fetchImpl, timeoutMs }) : null; }
module.exports = { TestOnlyOpenAiControlledComposer, createTestOnlyOpenAiControlledComposerFromEnv };
