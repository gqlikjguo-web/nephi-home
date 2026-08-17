"use strict";

const crypto = require("node:crypto");
const { sha256 } = require("../test-only-line-message-trace");

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_PROVIDER_TIMEOUT_MS = 30000;
const MAX_MISSING_REQUESTS = 24;
const MAX_SOURCE_EVENTS = 24;
const MAX_COVERED_REQUESTS = 24;
const MAX_EVIDENCE_REFS = 12;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COVERAGE_CRITIC_DIAGNOSTIC = Symbol.for("junzan.coverageCriticDiagnostic");

function coverageCriticInstructions() {
  return [
    "You are an independent semantic coverage critic.",
    "Compare the supplied guest sourceEvents with the already covered request representations and report only missing substantive request spans.",
    "Judge meaning semantically across colloquial language, typos, mixed language, and missing punctuation. Do not use keyword, regex, punctuation-splitting, alias, or fuzzy-string rules.",
    "A missing request is a substantive guest request that is present in sourceEvents but is not represented by any covered request evidence span.",
    "Return the smallest exact source span that preserves the complete missing request meaning. Copy eventId and messageRef only from the same supplied sourceEvents item.",
    "Offsets are 0-based UTF-16 JavaScript string indexes: startOffset is inclusive and endOffset is exclusive. quote must exactly equal messageText.slice(startOffset, endOffset).",
    "You must not choose a capability, category, canonical identity, task type, action, confidence-based business decision, or property fact.",
    "You must not answer the guest, rewrite covered requests, alter siblings, infer property data, or produce customer-visible text.",
    "If every substantive request is already represented, return missingRequests as an empty array.",
    "Return only the strict schema."
  ].join("\n");
}

function evidenceRefSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["eventId", "messageRef", "startOffset", "endOffset", "quote"],
    properties: {
      eventId: { type: "string", maxLength: 120 },
      messageRef: { type: "string", maxLength: 120 },
      startOffset: { type: "integer", minimum: 0, maximum: 1000000 },
      endOffset: { type: "integer", minimum: 1, maximum: 1000000 },
      quote: { type: "string", minLength: 1, maxLength: 500 }
    }
  };
}

function coverageCriticSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["missingRequests"],
    properties: {
      missingRequests: {
        type: "array",
        minItems: 0,
        maxItems: MAX_MISSING_REQUESTS,
        items: evidenceRefSchema()
      }
    }
  };
}

function boundedString(value, maximum) {
  return String(value === undefined || value === null ? "" : value).slice(0, maximum);
}

function safeEvidenceRefs(value) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_EVIDENCE_REFS).map((ref) => ({
    eventId: boundedString(ref && ref.eventId, 120),
    messageRef: boundedString(ref && ref.messageRef, 120),
    startOffset: Number.isInteger(ref && ref.startOffset) ? ref.startOffset : -1,
    endOffset: Number.isInteger(ref && ref.endOffset) ? ref.endOffset : -1,
    quote: boundedString(ref && ref.quote, 500)
  }));
}

function safeCriticInput(input = {}) {
  return {
    sourceEvents: (Array.isArray(input.sourceEvents) ? input.sourceEvents : []).slice(0, MAX_SOURCE_EVENTS).map((event) => ({
      eventId: boundedString(event && event.eventId, 120),
      messageRef: boundedString(event && event.messageRef, 120),
      messageText: boundedString(event && event.messageText, 8000)
    })),
    coveredRequests: (Array.isArray(input.coveredRequests) ? input.coveredRequests : []).slice(0, MAX_COVERED_REQUESTS).map((request) => ({
      sourceText: boundedString(request && request.sourceText, 500),
      evidenceRefs: safeEvidenceRefs(request && request.evidenceRefs)
    }))
  };
}

function outputText(payload) {
  if (payload && typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload && payload.output || []) {
    for (const part of item && Array.isArray(item.content) ? item.content : []) {
      if (part && part.type === "output_text") return String(part.text || "");
    }
  }
  return "";
}

async function readPayload(response) {
  if (response && typeof response.text === "function") {
    const text = String(await response.text() || "");
    if (!text) return null;
    try { return JSON.parse(text); }
    catch { throw criticFailure("coverage_critic_parse_error", "json_parse"); }
  }
  try { return await response.json(); }
  catch { throw criticFailure("coverage_critic_parse_error", "json_parse"); }
}

function criticFailure(code, errorCategory, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.errorCategory = errorCategory;
  error.timeout = details.timeout === true;
  error.status = Number.isInteger(details.status) ? details.status : 0;
  error.retryable = false;
  error.safeCoverageCriticFailure = true;
  return error;
}

function structurallyValidMissingRequests(output) {
  if (!output || typeof output !== "object" || Array.isArray(output)
    || Object.keys(output).length !== 1 || !Array.isArray(output.missingRequests)
    || output.missingRequests.length > MAX_MISSING_REQUESTS) return false;
  return output.missingRequests.every((item) => item && typeof item === "object" && !Array.isArray(item)
    && Object.keys(item).length === 5
    && ["eventId", "messageRef", "startOffset", "endOffset", "quote"].every((key) => Object.hasOwn(item, key))
    && typeof item.eventId === "string" && item.eventId.length <= 120
    && typeof item.messageRef === "string" && item.messageRef.length <= 120
    && Number.isInteger(item.startOffset) && item.startOffset >= 0 && item.startOffset <= 1000000
    && Number.isInteger(item.endOffset) && item.endOffset >= 1 && item.endOffset <= 1000000
    && typeof item.quote === "string" && item.quote.length >= 1 && item.quote.length <= 500);
}

function safeCallNumber(value) {
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 1;
}

class TestOnlyOpenAiCoverageCritic {
  constructor({ apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, requestIdFactory = crypto.randomUUID } = {}) {
    if (!apiKey || !model) throw criticFailure("coverage_critic_configuration_error", "unknown");
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.requestIdFactory = typeof requestIdFactory === "function" ? requestIdFactory : crypto.randomUUID;
  }

  async review(input, { callNumber = 1, timeoutMs = this.timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let output;
    try {
      const generatedRequestId = String(this.requestIdFactory() || "");
      const clientRequestId = UUID_PATTERN.test(generatedRequestId) ? generatedRequestId : crypto.randomUUID();
      const response = await this.fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "X-Client-Request-Id": clientRequestId
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          ...(String(input.lineUserId || "").trim() ? { safety_identifier: sha256(input.lineUserId) } : {}),
          input: [
            { role: "system", content: [{ type: "input_text", text: coverageCriticInstructions() }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify(safeCriticInput(input)) }] }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "junzan_coverage_critic_v1",
              strict: true,
              schema: coverageCriticSchema()
            }
          }
        })
      });
      const status = Number(response && (response.status || response.statusCode) || 0);
      if (!response || response.ok !== true) {
        throw criticFailure("coverage_critic_http_error", "invalid_request", { status });
      }
      const payload = await readPayload(response);
      const text = outputText(payload);
      if (!text) throw criticFailure("coverage_critic_empty_response", "empty_response", { status });
      try { output = JSON.parse(text); }
      catch { throw criticFailure("coverage_critic_parse_error", "json_parse", { status }); }
      if (!structurallyValidMissingRequests(output)) {
        throw criticFailure("coverage_critic_structured_output_error", "structured_output", { status });
      }
    } catch (error) {
      if (error && error.safeCoverageCriticFailure) throw error;
      if (error && error.name === "AbortError") {
        throw criticFailure("coverage_critic_timeout", "timeout", { timeout: true });
      }
      throw criticFailure("coverage_critic_network_error", "network");
    } finally {
      clearTimeout(timer);
    }
    Object.defineProperty(output, COVERAGE_CRITIC_DIAGNOSTIC, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        callRole: "coverage_critic",
        callNumber: safeCallNumber(callNumber),
        resultStatus: output.missingRequests.length ? "missing_detected" : "complete",
        reportedMissingSpanCount: output.missingRequests.length
      })
    });
    return output;
  }
}

function createTestOnlyOpenAiCoverageCriticFromEnv({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS } = {}) {
  const apiKey = String(env.OPENAI_TEST_API_KEY || "").trim();
  const model = String(env.OPENAI_TEST_MODEL || "").trim();
  return apiKey && model ? new TestOnlyOpenAiCoverageCritic({ apiKey, model, fetchImpl, timeoutMs }) : null;
}

module.exports = {
  COVERAGE_CRITIC_DIAGNOSTIC,
  TestOnlyOpenAiCoverageCritic,
  createTestOnlyOpenAiCoverageCriticFromEnv,
  coverageCriticInstructions,
  coverageCriticSchema
};
