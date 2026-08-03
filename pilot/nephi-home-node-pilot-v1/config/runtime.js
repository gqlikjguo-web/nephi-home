"use strict";

const path = require("node:path");
const PILOT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CLASSIFIER_TIMEOUT_MS = 15000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function runtimeConfig(env = process.env) {
  return {
    host: env.NEPHI_PILOT_HOST || (env.PORT ? "0.0.0.0" : "127.0.0.1"),
    port: Number(env.NEPHI_PILOT_PORT || env.PORT || 4275),
    databaseUrl: env.DATABASE_URL || "",
    dataFile: env.NEPHI_PILOT_DATA_FILE || path.join(PILOT_ROOT, ".runtime", "store.json"),
    seedFile: env.NEPHI_PILOT_SEED_FILE || path.join(PILOT_ROOT, "fixtures", "seed.json"),
    timeZone: env.NEPHI_PILOT_TIME_ZONE || "Asia/Taipei",
    conversationDebounceMs: Number(env.NEPHI_PILOT_DEBOUNCE_MS || 2000),
    conversationTtlMs: Number(env.NEPHI_PILOT_CONVERSATION_TTL_MS || 30 * 60 * 1000),
    recentMessageLimit: Number(env.NEPHI_PILOT_RECENT_MESSAGE_LIMIT || 10),
    recentMessageWindowMs: Number(env.NEPHI_PILOT_RECENT_MESSAGE_WINDOW_MS || 30 * 60 * 1000),
    classifierTimeoutMs: positiveInteger(env.NEPHI_PILOT_CLASSIFIER_TIMEOUT_MS, DEFAULT_CLASSIFIER_TIMEOUT_MS),
    classifierMinConfidence: Number(env.NEPHI_PILOT_CLASSIFIER_MIN_CONFIDENCE || 0.7)
    ,testOnlyConversationEngineV2: /^(?:1|true|yes)$/i.test(String(env.TEST_ONLY_CONVERSATION_ENGINE_V2 || ""))
    ,testOnlyConversationTraceV2: /^(?:1|true|yes)$/i.test(String(env.TEST_ONLY_CONVERSATION_TRACE_V2 || ""))
    ,testOnlyEnvironment: /^(?:1|true|yes)$/i.test(String(env.TEST_ONLY_ENVIRONMENT || ""))
    ,testOnlyLineMessageTraceEnabled: /^(?:1|true|yes)$/i.test(String(env.TEST_ONLY_LINE_MESSAGE_TRACE_ENABLED || ""))
    ,testOnlyLineMessageTracePropertyId: String(env.TEST_ONLY_LINE_MESSAGE_TRACE_PROPERTY_ID || "").trim()
    ,testOnlyLineMessageTraceTargetSha256: String(env.TEST_ONLY_LINE_MESSAGE_TRACE_TARGET_SHA256 || "").trim().toLowerCase()
  };
}

module.exports = { PILOT_ROOT, runtimeConfig, DEFAULT_CLASSIFIER_TIMEOUT_MS };
