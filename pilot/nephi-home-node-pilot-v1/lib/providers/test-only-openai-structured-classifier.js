"use strict";

const { StructuredClassifierProvider } = require("./contracts");

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const FIELD_NAMES = [
  "checkInDate", "checkOutDate", "nights", "guestCount", "roomType", "bookingType"
];

function decisionSchema(input) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "intent", "route", "confidence", "reason", "extractedFields",
      "missingFields", "shouldIgnore", "needsHuman", "queryMode"
    ],
    properties: {
      intent: { type: "string", enum: input.availableIntents },
      route: { type: "string", enum: input.availableRoutes },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string", pattern: "^[a-z0-9][a-z0-9_.-]{0,119}$" },
      queryMode: { type: "string", enum: ["bundle_only", "room_only", "any"] },
      extractedFields: {
        type: "object",
        additionalProperties: false,
        required: FIELD_NAMES,
        properties: {
          checkInDate: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          checkOutDate: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          nights: { type: ["integer", "null"], minimum: 1, maximum: 50 },
          guestCount: { type: ["integer", "null"], minimum: 1, maximum: 50 },
          roomType: { type: ["string", "null"], minLength: 1, maxLength: 80, pattern: ".*\\S.*" },
          bookingType: { type: ["string", "null"], minLength: 1, maxLength: 80, pattern: ".*\\S.*" }
        }
      },
      missingFields: { type: "array", items: { type: "string", enum: FIELD_NAMES } },
      shouldIgnore: { type: "boolean" },
      needsHuman: { type: "boolean" }
    }
  };
}

function classifierInstructions() {
  return [
    "You are the first semantic decision gate for a Taiwan homestay test pilot.",
    "Return only the supplied strict structured schema.",
    "Never write customer-visible prose, a suggested reply, or instructions for the guest.",
    "Use only allowed intents and routes. Do not invent facts or unavailable fields.",
    "Extract dates as YYYY-MM-DD only when reliable; otherwise leave null.",
    "The input includes currentDate and timeZone. Resolve today, tomorrow, and the day after tomorrow from that runtime context.",
    "For a month/day without a year, choose the nearest reasonable future date relative to currentDate; never reuse an obsolete training-example year.",
    "When checkInDate and nights are reliable, include the matching checkOutDate; one night means the next calendar date.",
    "Distinguish an early check-in or late checkout policy question from an actual request tied to today, tomorrow, an existing stay, or a stated date. Actual requests use early_checkin_late_checkout_request and require human handoff.",
    "Use the specific policy intents breakfast, drinking_water, laundry, elevator, baby_supplies, pet_rule, self_checkin, and equipment when the guest asks those low-risk FAQ topics.",
    "New message fields override the same accumulated field; preserve other accumulated fields.",
    "Set queryMode=bundle_only for an explicit bundle/whole-property request, room_only for an explicit individual-room request, and any when neither is specified.",
    "Use a short lowercase snake_case reason code with no sensitive or verbatim model output.",
    "Acknowledgements, meaningless content, repetition, spam, and non-actionable supplements may be silent ignore.",
    "Payment, refund, cancellation, reschedule, platform orders, door access, complaints, special requests, unknown intent, and low certainty need human handling.",
    "Do not decide availability, price, policy facts, or customer-visible wording; only classify and extract."
  ].join("\n");
}

function classifierContext(input) {
  return JSON.stringify({
    currentDate: String(input.currentDate || ""),
    timeZone: String(input.timeZone || ""),
    scope: {
      propertyId: String(input.propertyId || ""),
      channelId: String(input.channelId || "")
    },
    currentMessage: String(input.currentMessage || ""),
    currentMessages: Array.isArray(input.currentMessages) ? input.currentMessages : [],
    recentMessages: Array.isArray(input.recentMessages) ? input.recentMessages.map((item) => ({
      guestMessage: String(item && item.guestMessage || ""),
      createdAt: String(item && item.createdAt || "")
    })) : [],
    conversationState: input.conversationState || {},
    accumulatedFields: input.accumulatedFields || {},
    allowedIntents: input.availableIntents || [],
    allowedRoutes: input.availableRoutes || []
  });
}

function outputText(payload) {
  if (payload && typeof payload.output_text === "string") return payload.output_text;
  if (!payload || !Array.isArray(payload.output)) return "";
  for (const item of payload.output) {
    if (!item || !Array.isArray(item.content)) continue;
    const content = item.content.find((part) => part && part.type === "output_text" && typeof part.text === "string");
    if (content) return content.text;
  }
  return "";
}

function normalizeStructuredDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (!value.extractedFields || typeof value.extractedFields !== "object" || Array.isArray(value.extractedFields)) {
    return value;
  }
  const extractedFields = Object.fromEntries(
    Object.entries(value.extractedFields).filter(([, fieldValue]) => fieldValue !== null)
  );
  return { ...value, extractedFields };
}

function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

class TestOnlyOpenAiStructuredClassifier extends StructuredClassifierProvider {
  constructor({ apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = 15000, onDiagnostic } = {}) {
    super();
    if (!apiKey || !model) throw new Error("test_openai_not_configured");
    if (typeof fetchImpl !== "function") throw new Error("test_openai_fetch_unavailable");
    this.apiKey = String(apiKey);
    this.model = String(model);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1, Number(timeoutMs || 15000));
    this.onDiagnostic = typeof onDiagnostic === "function" ? onDiagnostic : null;
  }

  reportDiagnostic(code, httpStatus = null) {
    if (!this.onDiagnostic) return;
    try {
      this.onDiagnostic({ code, httpStatus: safeHttpStatus(httpStatus) });
    } catch {
      // Diagnostics must never change classifier behavior.
    }
  }

  fail(code, httpStatus = null, errorCode = code) {
    this.reportDiagnostic(code, httpStatus);
    throw safeError(errorCode);
  }

  async classify(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response;
      try {
        response = await this.fetchImpl(RESPONSES_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.model,
            input: [
              { role: "system", content: [{ type: "input_text", text: classifierInstructions() }] },
              { role: "user", content: [{ type: "input_text", text: classifierContext(input) }] }
            ],
            text: {
              format: {
                type: "json_schema",
                name: "nephi_home_structured_decision",
                strict: true,
                schema: decisionSchema(input)
              }
            }
          })
        });
      } catch (error) {
        if (controller.signal.aborted || error && error.name === "AbortError") {
          this.fail("openai_timeout", null, "structured_classifier_timeout");
        }
        this.fail("openai_transport_error");
      }
      const httpStatus = safeHttpStatus(response && response.status);
      if (!response || !response.ok) this.fail("openai_http_error", httpStatus);
      let payload;
      try {
        payload = await response.json();
      } catch {
        this.fail("openai_parse_error", httpStatus);
      }
      if (payload && payload.status && payload.status !== "completed") {
        this.fail("openai_schema_error", httpStatus);
      }
      const text = outputText(payload);
      if (!text) this.fail("openai_schema_error", httpStatus);
      try {
        const decision = normalizeStructuredDecision(JSON.parse(text));
        this.reportDiagnostic("openai_response_ok", httpStatus);
        return decision;
      } catch {
        this.fail("openai_parse_error", httpStatus);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function createTestOnlyOpenAiStructuredClassifierFromEnv({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  onDiagnostic
} = {}) {
  const apiKey = String(env.OPENAI_TEST_API_KEY || "").trim();
  const model = String(env.OPENAI_TEST_MODEL || "").trim();
  if (!apiKey || !model) return null;
  return new TestOnlyOpenAiStructuredClassifier({ apiKey, model, fetchImpl, timeoutMs, onDiagnostic });
}

module.exports = {
  TestOnlyOpenAiStructuredClassifier,
  createTestOnlyOpenAiStructuredClassifierFromEnv,
  decisionSchema,
  normalizeStructuredDecision
};
