"use strict";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const OUTPUT_SCHEMA = { type: "object", additionalProperties: false, required: ["sections"], properties: { sections: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["taskId", "responseMode", "text"], properties: { taskId: { type: "string", maxLength: 80 }, responseMode: { type: "string", enum: ["answer", "clarification", "handoff"] }, text: { type: "string", minLength: 1, maxLength: 600 } } } } } };
function outputText(payload) { if (payload && typeof payload.output_text === "string") return payload.output_text; for (const item of payload && payload.output || []) for (const part of item.content || []) if (part.type === "output_text") return part.text || ""; return ""; }

class TestOnlyOpenAiControlledComposer {
  constructor({ apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) { this.apiKey = apiKey; this.model = model; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  async compose(responsePlan) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(RESPONSES_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, signal: controller.signal, body: JSON.stringify({ model: this.model, input: [{ role: "system", content: [{ type: "input_text", text: "Write one concise, natural Traditional Chinese Taiwan lodging reply section for every response-plan section. Return every taskId exactly once and keep responseMode unchanged. Follow the supplied order: lodging need, lodging conditions, price, amenities, policies, then other information. Use only that section's trusted facts. An answer section must answer and must not ask a clarification question. A clarification section may ask only its supplied question. A handoff section must preserve its boundary. Never invent facts, promises, actions, or internal details. Make adjacent sections read naturally without FAQ labels or generic closing filler." }] }, { role: "user", content: [{ type: "input_text", text: JSON.stringify(responsePlan) }] }], text: { format: { type: "json_schema", name: "junzan_controlled_reply_v2", strict: true, schema: OUTPUT_SCHEMA } } }) });
      if (!response.ok) throw new Error("composer_http_error"); return JSON.parse(outputText(await response.json()));
    } finally { clearTimeout(timer); }
  }
}
function createTestOnlyOpenAiControlledComposerFromEnv({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) { const apiKey = String(env.OPENAI_TEST_API_KEY || "").trim(), model = String(env.OPENAI_TEST_MODEL || "").trim(); return apiKey && model ? new TestOnlyOpenAiControlledComposer({ apiKey, model, fetchImpl, timeoutMs }) : null; }
module.exports = { TestOnlyOpenAiControlledComposer, createTestOnlyOpenAiControlledComposerFromEnv };
