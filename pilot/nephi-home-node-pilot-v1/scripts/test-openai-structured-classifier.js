"use strict";

const {
  createTestOnlyOpenAiStructuredClassifierFromEnv
} = require("../lib/providers/test-only-openai-structured-classifier");
const {
  createAiFirstDecisionPipeline,
  DEFAULT_INTENTS,
  DEFAULT_ROUTES
} = require("../lib/ai-first-decision-pipeline");
const { runtimeConfig } = require("../config/runtime");
const { runtimeCalendarContext } = require("../lib/runtime-calendar");

function fixedReplySourceFor(decision) {
  if (decision.needsHuman || decision.route === "human_handoff_required") return "fixed_human_handoff_template";
  if (decision.shouldIgnore || decision.route === "no_reply_silent_ignore") return "no_reply";
  if (decision.intent === "availability") {
    return decision.missingFields.length ? "fixed_clarification_template" : "availability_result_formatter";
  }
  if (decision.intent === "price") return "owner_confirmed_price_formatter";
  if (["parking", "bbq", "checkin_rule", "pet_rule", "equipment"].includes(decision.intent)) {
    return "owner_confirmed_knowledge";
  }
  if (["greeting", "room_type_capacity"].includes(decision.intent)) return "fixed_reply_template";
  return "fixed_human_handoff_template";
}

function mergeFields(previous, extracted) {
  return Object.fromEntries(Object.entries({ ...previous, ...extracted }).filter(([, value]) => value !== null && value !== ""));
}

function inferredDiagnostic(decision, diagnostic) {
  if (diagnostic && diagnostic.code === "openai_response_ok") {
    return decision.reason === "classifier_invalid_schema"
      ? { code: "openai_schema_error", httpStatus: diagnostic.httpStatus }
      : null;
  }
  if (diagnostic) return diagnostic;
  const code = {
    classifier_not_configured: "openai_not_configured",
    classifier_timeout: "openai_timeout",
    classifier_exception: "openai_transport_error",
    classifier_invalid_schema: "openai_schema_error"
  }[decision.reason];
  return code ? { code, httpStatus: null } : null;
}

function formatSafeResult(decision, diagnostic = null) {
  const result = {
    intent: decision.intent,
    route: decision.route,
    confidence: decision.confidence,
    reason: decision.reason,
    extractedFields: decision.extractedFields,
    missingFields: decision.missingFields,
    shouldIgnore: decision.shouldIgnore,
    needsHuman: decision.needsHuman,
    finalReplySource: fixedReplySourceFor(decision)
  };
  const safeDiagnostic = inferredDiagnostic(decision, diagnostic);
  if (safeDiagnostic) result.diagnostic = safeDiagnostic;
  return result;
}

async function run(messages, options = {}) {
  const env = options.env || process.env;
  const now = options.now || (() => new Date());
  const calendarContext = runtimeCalendarContext(now, options.timeZone || runtimeConfig(env).timeZone);
  const timeoutMs = Number(env.NEPHI_PILOT_CLASSIFIER_TIMEOUT_MS || 15000);
  let latestDiagnostic = null;
  const classifier = createTestOnlyOpenAiStructuredClassifierFromEnv({
    env,
    timeoutMs,
    onDiagnostic: (diagnostic) => { latestDiagnostic = diagnostic; }
  });
  if (!classifier) throw new Error("OPENAI_TEST_API_KEY and OPENAI_TEST_MODEL are required");
  const pipeline = createAiFirstDecisionPipeline({
    classifier,
    timeoutMs,
    minConfidence: Number(env.NEPHI_PILOT_CLASSIFIER_MIN_CONFIDENCE || 0.7),
    onValidationDiagnostic: (diagnostic) => {
      latestDiagnostic = {
        code: "openai_schema_error",
        httpStatus: latestDiagnostic && latestDiagnostic.httpStatus || null,
        invalidFields: diagnostic.invalidFields
      };
    }
  });
  let accumulatedFields = {};
  const recentMessages = [];
  for (const message of messages) {
    latestDiagnostic = null;
    const decision = await pipeline.decide({
      propertyId: "local_test_property",
      channelId: "local_test_channel",
      lineUserId: "local_test_user",
      currentMessage: message,
      currentMessages: [message],
      recentMessages: recentMessages.slice(-10),
      conversationState: { ...accumulatedFields },
      accumulatedFields: { ...accumulatedFields },
      currentDate: calendarContext.currentDate,
      timeZone: calendarContext.timeZone,
      availableIntents: DEFAULT_INTENTS,
      availableRoutes: DEFAULT_ROUTES,
      property: { rooms: [] }
    });
    accumulatedFields = mergeFields(accumulatedFields, decision.extractedFields);
    recentMessages.push({ guestMessage: message, createdAt: now().toISOString() });
    console.log(JSON.stringify(formatSafeResult(decision, latestDiagnostic), null, 2));
  }
}

if (require.main === module) {
  const messages = process.argv.slice(2).map((item) => item.trim()).filter(Boolean);
  if (!messages.length) {
    console.error("Usage: node scripts/test-openai-structured-classifier.js \"guest message\" [\"next message\"]");
    process.exit(1);
  }
  run(messages).catch(() => {
    console.error("Test-only structured classification failed safely; no raw provider response was printed.");
    process.exit(1);
  });
}

module.exports = { fixedReplySourceFor, formatSafeResult, run };
