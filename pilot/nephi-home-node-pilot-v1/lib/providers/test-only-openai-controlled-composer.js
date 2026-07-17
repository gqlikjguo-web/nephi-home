"use strict";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const OUTPUT_SCHEMA = { type: "object", additionalProperties: false, required: ["replyText", "factTaskIds"], properties: { replyText: { type: "string", minLength: 1, maxLength: 1200 }, factTaskIds: { type: "array", items: { type: "string", maxLength: 80 } } } };
function outputText(payload) { if (payload && typeof payload.output_text === "string") return payload.output_text; for (const item of payload && payload.output || []) for (const part of item.content || []) if (part.type === "output_text") return part.text || ""; return ""; }

class TestOnlyOpenAiControlledComposer {
  constructor({ apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) { this.apiKey = apiKey; this.model = model; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  async compose(responsePlan) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(RESPONSES_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, signal: controller.signal, body: JSON.stringify({ model: this.model, input: [{ role: "system", content: [{ type: "input_text", text: "Write one concise, natural Traditional Chinese Taiwan lodging service reply. Use only facts in the response plan. Answer every section, preserve unknown/handoff boundaries, never invent facts or promises, never mention internal systems, and never claim an action unless reviewActions proves it." }] }, { role: "user", content: [{ type: "input_text", text: JSON.stringify(responsePlan) }] }], text: { format: { type: "json_schema", name: "junzan_controlled_reply_v1", strict: true, schema: OUTPUT_SCHEMA } } }) });
      if (!response.ok) throw new Error("composer_http_error"); return JSON.parse(outputText(await response.json()));
    } finally { clearTimeout(timer); }
  }
}
function createTestOnlyOpenAiControlledComposerFromEnv({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) { const apiKey = String(env.OPENAI_TEST_API_KEY || "").trim(), model = String(env.OPENAI_TEST_MODEL || "").trim(); return apiKey && model ? new TestOnlyOpenAiControlledComposer({ apiKey, model, fetchImpl, timeoutMs }) : null; }
module.exports = { TestOnlyOpenAiControlledComposer, createTestOnlyOpenAiControlledComposerFromEnv };
