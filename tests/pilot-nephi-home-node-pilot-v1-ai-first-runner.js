"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const contracts = require(path.join(PILOT_ROOT, "lib/providers/contracts"));
const { createAiFirstDecisionPipeline } = require(path.join(PILOT_ROOT, "lib/ai-first-decision-pipeline"));
const { createApp } = require(path.join(PILOT_ROOT, "server"));
const { createJsonProviders } = require(path.join(PILOT_ROOT, "lib/providers/json-providers"));
const { attachPropertyScopedLineBinding } = require(path.join(PILOT_ROOT, "tests/helpers/property-scoped-line-webhook"));

const SECRET = "pilot-ai-first-test-secret";
const TOKEN = "pilot-ai-first-test-token";

function lineEvent(id, replyToken, userId, text) {
  return {
    type: "message",
    webhookEventId: id,
    timestamp: Date.now(),
    replyToken,
    source: { type: "user", userId },
    message: { id: `message-${id}`, type: "text", text }
  };
}

async function sendLine(bindings, url, propertyId, event, channelId = "line-channel-a") {
  const raw = JSON.stringify({ destination: channelId, events: [event] });
  const response = await bindings[propertyId].post(url, raw);
  return { status: response.status, payload: await response.json() };
}

function wait(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DeterministicFakeAi extends contracts.StructuredClassifierProvider {
  constructor() {
    super();
    this.inputs = [];
  }

  async classify(input) {
    this.inputs.push(structuredClone(input));
    const messages = input.currentMessages || [input.currentMessage];
    const text = messages.join("\n");
    if (text === "TEST_INVALID_SCHEMA") {
      return validDecision({ suggested_reply: "MODEL_RAW_OUTPUT_MUST_NOT_BE_STORED" });
    }
    if (text === "今天可以提早入住嗎？" || text === "我們明天想晚一點退房") {
      return validDecision({
        intent: "early_checkin_late_checkout_request",
        route: "human_handoff_required",
        reason: "actual_stay_timing_request",
        needsHuman: true
      });
    }
    if (text === "可以提早入住嗎？") {
      return validDecision({ intent: "checkin_rule", reason: "early_checkin_policy_question" });
    }
    if (/付款/.test(text)) return validDecision({ intent: "payment", reason: "payment_topic" });
    if (/低信心/.test(text)) return validDecision({ confidence: 0.2, reason: "uncertain_meaning" });
    if (/未知/.test(text)) return validDecision({ intent: "unknown", reason: "unknown_intent" });
    if (/^(?:\.\.\.|謝謝|感謝)$/.test(text.trim())) {
      return validDecision({
        intent: "acknowledgement",
        route: "no_reply_silent_ignore",
        reason: "non_actionable_message",
        shouldIgnore: true
      });
    }
    if (/停車/.test(text)) return validDecision({ intent: "parking", reason: "parking_question" });

    const extractedFields = {};
    const iso = /(20\d{2})-(\d{1,2})-(\d{1,2})/.exec(text);
    const short = /(?:^|[^\d])(\d{1,2})\/(\d{1,2})/.exec(text);
    if (iso) extractedFields.checkInDate = `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
    if (!iso && short) extractedFields.checkInDate = `2026-${String(Number(short[1])).padStart(2, "0")}-${String(Number(short[2])).padStart(2, "0")}`;
    if (extractedFields.checkInDate) {
      const checkout = new Date(`${extractedFields.checkInDate}T00:00:00.000Z`);
      checkout.setUTCDate(checkout.getUTCDate() + 1);
      extractedFields.checkOutDate = checkout.toISOString().slice(0, 10);
      extractedFields.nights = 1;
    }
    const numericGuests = /(\d{1,2})\s*(?:人|位)/.exec(text);
    const chineseGuests = /([一二兩三四五六七八九十])\s*(?:人|位)/.exec(text);
    const chinese = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    if (numericGuests) extractedFields.guestCount = Number(numericGuests[1]);
    if (!numericGuests && chineseGuests) extractedFields.guestCount = chinese[chineseGuests[1]];
    const room = /room(301|302|401|402)|\b(301|302|401|402)\b/.exec(text);
    if (room) extractedFields.roomType = `room${room[1] || room[2]}`;
    const accumulated = { ...(input.accumulatedFields || {}), ...extractedFields };
    const missingFields = ["checkInDate", "guestCount", "roomType"].filter((key) => !accumulated[key]);
    return validDecision({
      intent: "availability",
      route: missingFields.length ? "clarification_needed" : "auto_reply_allowed",
      reason: missingFields.length ? "availability_missing_fields" : "availability_complete",
      extractedFields,
      missingFields
    });
  }
}

assert.equal(
  typeof contracts.StructuredClassifierProvider,
  "function",
  "StructuredClassifierProvider must be an explicit provider contract"
);

const baseInput = {
  propertyId: "demo_homestay_a",
  channelId: "line-channel-a",
  lineUserId: "U_ai_first",
  currentMessage: "完整問題",
  currentMessages: ["完整問題"],
  recentMessages: [{ guestMessage: "前一則", createdAt: "2026-07-12T00:00:00.000Z" }],
  conversationState: { checkInDate: null, guestCount: null, roomType: null },
  accumulatedFields: { checkInDate: null, guestCount: null, roomType: null },
  currentDate: "2026-07-14",
  timeZone: "Asia/Taipei",
  availableIntents: ["availability", "parking", "checkin_rule", "early_checkin_late_checkout_request", "unknown"],
  availableRoutes: ["auto_reply_allowed", "clarification_needed", "human_handoff_required", "no_reply_silent_ignore"],
  property: { rooms: [{ id: "room301", capacity: 2 }] }
};

function validDecision(overrides = {}) {
  return {
    intent: "parking",
    route: "auto_reply_allowed",
    confidence: 0.95,
    reason: "owner_confirmed_parking_fact",
    extractedFields: {},
    missingFields: [],
    shouldIgnore: false,
    needsHuman: false,
    ...overrides
  };
}

(async () => {
  let received;
  const validPipeline = createAiFirstDecisionPipeline({
    classifier: { async classify(input) { received = input; return validDecision(); } },
    timeoutMs: 50,
    minConfidence: 0.7
  });
  const valid = await validPipeline.decide(baseInput);
  assert.equal(valid.intent, "parking");
  assert.equal(valid.needsHuman, false);
  assert.equal(received.currentMessage, "完整問題");
  assert.equal(received.recentMessages.length, 1);
  assert.equal(received.propertyId, "demo_homestay_a");
  assert.equal(received.channelId, "line-channel-a");
  assert.deepEqual(received.accumulatedFields, baseInput.accumulatedFields);
  assert.deepEqual(received.availableRoutes, baseInput.availableRoutes);
  assert.equal(received.currentDate, "2026-07-14");
  assert.equal(received.timeZone, "Asia/Taipei");

  const pastDate = await createAiFirstDecisionPipeline({
    classifier: {
      async classify() {
        return validDecision({
          intent: "availability",
          reason: "availability_complete",
          extractedFields: {
            checkInDate: "2024-07-19",
            checkOutDate: "2024-07-20",
            nights: 1,
            guestCount: 2,
            roomType: "room301"
          }
        });
      }
    }
  }).decide(baseInput);
  assert.equal(pastDate.route, "human_handoff_required");
  assert.equal(pastDate.needsHuman, true);
  assert.equal(pastDate.reason, "past_check_in_date");

  const policyQuestion = await createAiFirstDecisionPipeline({
    classifier: { async classify() { return validDecision({ intent: "checkin_rule", reason: "early_checkin_policy_question" }); } }
  }).decide(baseInput);
  assert.equal(policyQuestion.route, "auto_reply_allowed");
  assert.equal(policyQuestion.needsHuman, false);

  const oneNight = await createAiFirstDecisionPipeline({
    classifier: {
      async classify() {
        return validDecision({
          intent: "availability",
          reason: "one_night_stay",
          extractedFields: { checkInDate: "2026-07-19", nights: 1 },
          missingFields: ["checkOutDate"]
        });
      }
    }
  }).decide(baseInput);
  assert.equal(oneNight.extractedFields.checkOutDate, "2026-07-20");
  assert.equal(oneNight.missingFields.includes("checkOutDate"), false);

  for (const reason of ["early_checkin_request", "late_checkout_request"]) {
    const actualRequest = await createAiFirstDecisionPipeline({
      classifier: {
        async classify() {
          return validDecision({
            intent: "early_checkin_late_checkout_request",
            route: "auto_reply_allowed",
            reason
          });
        }
      }
    }).decide(baseInput);
    assert.equal(actualRequest.intent, "early_checkin_late_checkout_request");
    assert.equal(actualRequest.route, "human_handoff_required");
    assert.equal(actualRequest.needsHuman, true);
    assert.equal(actualRequest.reason, "high_risk_early_checkin_late_checkout_request");
  }

  const cases = [
    {
      name: "classifier_not_configured",
      pipeline: createAiFirstDecisionPipeline({ classifier: null, timeoutMs: 10 }),
      expectedReason: "classifier_not_configured"
    },
    {
      name: "classifier_exception",
      pipeline: createAiFirstDecisionPipeline({ classifier: { async classify() { throw new Error("sensitive model error"); } }, timeoutMs: 10 }),
      expectedReason: "classifier_exception"
    },
    {
      name: "classifier_timeout",
      pipeline: createAiFirstDecisionPipeline({ classifier: { classify() { return new Promise(() => {}); } }, timeoutMs: 10 }),
      expectedReason: "classifier_timeout"
    },
    {
      name: "classifier_invalid_schema",
      pipeline: createAiFirstDecisionPipeline({ classifier: { async classify() { return validDecision({ suggested_reply: "模型敏感原文" }); } }, timeoutMs: 10 }),
      expectedReason: "classifier_invalid_schema"
    },
    {
      name: "classifier_low_confidence",
      pipeline: createAiFirstDecisionPipeline({ classifier: { async classify() { return validDecision({ confidence: 0.3 }); } }, timeoutMs: 10 }),
      expectedReason: "classifier_low_confidence"
    }
  ];

  for (const item of cases) {
    const result = await item.pipeline.decide(baseInput);
    assert.equal(result.route, "human_handoff_required", item.name);
    assert.equal(result.needsHuman, true, item.name);
    assert.equal(result.reason, item.expectedReason, item.name);
    assert.equal(JSON.stringify(result).includes("sensitive model error"), false, item.name);
    assert.equal(JSON.stringify(result).includes("模型敏感原文"), false, item.name);
  }

  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-pilot-ai-first-"));
  const dataFile = path.join(tempDir, "store.json");
  const seedFile = path.join(PILOT_ROOT, "fixtures/seed.json");
  let currentTime = new Date("2026-07-13T16:30:00.000Z");
  const now = () => new Date(currentTime);
  const providers = createJsonProviders({ dataFile, seedFile, now });
  const encryptionKey = crypto.randomBytes(32).toString("base64");
  const bindings = {
    demo_homestay_a: attachPropertyScopedLineBinding({ providers, propertyId: "demo_homestay_a", channelSecret: SECRET, channelAccessToken: TOKEN, encryptionKey }),
    demo_homestay_b: attachPropertyScopedLineBinding({ providers, propertyId: "demo_homestay_b", channelSecret: "pilot-ai-first-secret-b", channelAccessToken: "pilot-ai-first-token-b", encryptionKey })
  };
  const bindingChannel = (binding) => `line-binding:${crypto.createHash("sha256").update(binding.binding.webhookKey).digest("hex").slice(0, 24)}`;
  const channelA = bindingChannel(bindings.demo_homestay_a);
  const channelB = bindingChannel(bindings.demo_homestay_b);
  const fakeAi = new DeterministicFakeAi();
  const replies = [];
  const appOptions = {
    providers,
    now,
    structuredClassifier: fakeAi,
    classifierTimeoutMs: 30,
    recentMessageLimit: 3,
    recentMessageWindowMs: 5 * 60 * 1000,
    conversationDebounceMs: 15,
    lineBindingEnv: bindings.demo_homestay_a.lineBindingEnv,
    lineReplyFetch: async (url, options) => {
      replies.push({ url, options });
      return { ok: true, status: 200, text: async () => "{}" };
    }
  };
  let app = createApp(appOptions);
  let running = await app.start(0, "127.0.0.1");
  try {
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("complete-1", "token-complete", "U_complete", "2026-07-19 2人 301空房"));
    await wait();
    assert.equal(replies.length, 1, "complete availability must reply once");
    assert.match(JSON.parse(replies.at(-1).options.body).messages[0].text, /2026-07-19/);
    assert.equal(fakeAi.inputs.at(-1).propertyId, "demo_homestay_a");
    assert.equal(fakeAi.inputs.at(-1).channelId, channelA);
    assert.equal(fakeAi.inputs.at(-1).currentDate, "2026-07-14");
    assert.equal(fakeAi.inputs.at(-1).timeZone, "Asia/Taipei");
    assert.deepEqual(fakeAi.inputs.at(-1).availableRoutes.sort(), [
      "auto_reply_allowed", "clarification_needed", "human_handoff_required", "no_reply_silent_ignore"
    ]);

    await Promise.all([
      sendLine(bindings, running.url, "demo_homestay_a", lineEvent("split-1", "token-split-1", "U_split", "有空房嗎")),
      sendLine(bindings, running.url, "demo_homestay_a", lineEvent("split-2", "token-split-2", "U_split", "7/19")),
      sendLine(bindings, running.url, "demo_homestay_a", lineEvent("split-3", "token-split-3", "U_split", "兩人 301"))
    ]);
    await wait();
    assert.equal(replies.length, 2, "split messages must produce one trailing reply");
    const splitState = providers.persistence.getConversationState("demo_homestay_a", channelA, "U_split");
    assert.equal(splitState.checkInDate, "2026-07-19");
    assert.equal(splitState.guestCount, 2);
    assert.equal(splitState.roomType, "room301");

    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("overwrite-1", "token-overwrite", "U_split", "改成7/20"));
    await wait();
    const overwritten = providers.persistence.getConversationState("demo_homestay_a", channelA, "U_split");
    assert.equal(overwritten.checkInDate, "2026-07-20", "new date must overwrite only the old date fields");
    assert.equal(overwritten.guestCount, 2);
    assert.equal(overwritten.roomType, "room301");

    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("isolate-user", "token-isolate-user", "U_other", "7/21 2人 302空房"));
    await sendLine(bindings, running.url, "demo_homestay_b", lineEvent("isolate-property", "token-isolate-property", "U_split", "7/22 2人 301空房"));
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("isolate-channel", "token-isolate-channel", "U_split", "7/23 2人 301空房"), "line-channel-b");
    await wait();
    assert.equal(providers.persistence.getConversationState("demo_homestay_a", channelA, "U_other").checkInDate, "2026-07-21");
    assert.equal(providers.persistence.getConversationState("demo_homestay_b", channelB, "U_split").checkInDate, "2026-07-22");
    assert.equal(providers.persistence.getConversationState("demo_homestay_a", channelA, "U_split").checkInDate, "2026-07-23", "payload destination must not create a second property channel authority");

    const repliesBeforeSilent = replies.length;
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("silent-meaningless", "token-silent-1", "U_silent", "..."));
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("silent-thanks", "token-silent-2", "U_thanks", "謝謝"));
    await wait();
    assert.equal(replies.length, repliesBeforeSilent, "silent ignore must not call Reply API");
    for (const eventId of ["silent-meaningless", "silent-thanks"]) {
      const log = providers.persistence.findMessageByEventId("demo_homestay_a", eventId);
      assert.equal(log.noReply, true);
      assert.equal(log.silentIgnore, true);
      assert.equal(log.shouldReply, false);
    }

    const reviewsBefore = providers.persistence.listMessageLogs("demo_homestay_a").filter((item) => item.needsReview).length;
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("risk-payment", "token-risk", "U_risk", "付款問題"));
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("risk-low", "token-low", "U_low", "低信心問題"));
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("risk-unknown", "token-unknown", "U_unknown", "未知問題"));
    await wait();
    const riskLogs = ["risk-payment", "risk-low", "risk-unknown"].map((id) => providers.persistence.findMessageByEventId("demo_homestay_a", id));
    assert.ok(riskLogs.every((item) => item.humanHandoff && item.needsReview && item.replyType === "human_handoff"));
    assert.ok(riskLogs.every((item) => item.replyText === "請稍候，將由真人客服協助確認。"));
    assert.equal(providers.persistence.listMessageLogs("demo_homestay_a").filter((item) => item.needsReview).length, reviewsBefore + 3);

    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("early-policy", "token-early-policy", "U_early_policy", "可以提早入住嗎？"));
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("early-request", "token-early-request", "U_early_request", "今天可以提早入住嗎？"));
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("late-request", "token-late-request", "U_late_request", "我們明天想晚一點退房"));
    await wait();
    const policyLog = providers.persistence.findMessageByEventId("demo_homestay_a", "early-policy");
    assert.equal(policyLog.detectedIntent, "checkin_rule");
    assert.equal(policyLog.needsReview, false);
    for (const eventId of ["early-request", "late-request"]) {
      const requestLog = providers.persistence.findMessageByEventId("demo_homestay_a", eventId);
      assert.equal(requestLog.detectedIntent, "early_checkin_late_checkout_request");
      assert.equal(requestLog.replyText, "請稍候，將由真人客服協助確認。");
      assert.equal(requestLog.humanHandoff, true);
      assert.equal(requestLog.needsReview, true);
      assert.equal(requestLog.status, "pending");
    }

    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent(
      "invalid-schema-audit", "token-invalid-schema", "U_invalid_schema", "TEST_INVALID_SCHEMA"
    ));
    await wait();
    const invalidSchemaLog = providers.persistence.findMessageByEventId("demo_homestay_a", "invalid-schema-audit");
    assert.equal(invalidSchemaLog.decisionReason, "classifier_invalid_schema");
    assert.equal(invalidSchemaLog.humanHandoff, true);
    assert.equal(invalidSchemaLog.needsReview, true);
    assert.equal(JSON.stringify(invalidSchemaLog).includes("MODEL_RAW_OUTPUT_MUST_NOT_BE_STORED"), false);
    assert.equal(JSON.stringify(providers.persistence.listMessageLogs("demo_homestay_a")).includes("MODEL_RAW_OUTPUT_MUST_NOT_BE_STORED"), false);

    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("missing-availability", "token-missing", "U_missing_data", "2027-12-01 2人 301空房"));
    await wait();
    const missingLog = providers.persistence.findMessageByEventId("demo_homestay_a", "missing-availability");
    assert.equal(missingLog.humanHandoff, true);
    assert.equal(missingLog.needsReview, true);
    assert.match(missingLog.replyText, /無法確認/);
    assert.doesNotMatch(missingLog.replyText, /可詢問房型/);

    for (let index = 0; index < 8; index += 1) {
      providers.persistence.appendMessageLog("demo_homestay_a", {
        channelId: channelA,
        lineUserId: "U_context",
        eventId: `context-${index}`,
        guestMessage: `近期-${index}`,
        createdAt: new Date(currentTime.getTime() - index * 30000).toISOString()
      });
    }
    providers.persistence.appendMessageLog("demo_homestay_a", {
      channelId: channelA, lineUserId: "U_context", eventId: "context-old",
      guestMessage: "過期上下文", createdAt: new Date(currentTime.getTime() - 10 * 60000).toISOString()
    });
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("context-now", "token-context", "U_context", "停車問題"));
    await wait();
    const contextInput = fakeAi.inputs.at(-1);
    assert.equal(contextInput.recentMessages.length, 3, "recent context must respect count limit");
    assert.equal(contextInput.recentMessages.some((item) => item.guestMessage === "過期上下文"), false);

    providers.persistence.setConversationState("demo_homestay_a", channelA, "U_expired", {
      checkInDate: "2026-07-30", guestCount: 9, roomType: "room402",
      updatedAt: currentTime.toISOString(), lastMessageFingerprint: "", lastReplyAt: ""
    });
    currentTime = new Date(currentTime.getTime() + 31 * 60 * 1000);
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("expired-state", "token-expired", "U_expired", "停車問題"));
    await wait();
    const expiredInput = fakeAi.inputs.at(-1);
    assert.equal(expiredInput.conversationState.checkInDate, null, "expired state must not be sent to provider");
    assert.equal(expiredInput.accumulatedFields.guestCount, null);

    const classifierCallsBeforeDuplicate = fakeAi.inputs.length;
    const repliesBeforeDuplicate = replies.length;
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("restart-duplicate", "token-duplicate-1", "U_duplicate", "停車問題"));
    await wait();
    assert.equal(fakeAi.inputs.length, classifierCallsBeforeDuplicate + 1);
    assert.equal(replies.length, repliesBeforeDuplicate + 1);
    await app.stop();

    app = createApp(appOptions);
    running = await app.start(0, "127.0.0.1");
    await sendLine(bindings, running.url, "demo_homestay_a", lineEvent("restart-duplicate", "token-duplicate-2", "U_duplicate", "不同內容也不得重跑"));
    await wait();
    assert.equal(fakeAi.inputs.length, classifierCallsBeforeDuplicate + 1, "persistent duplicate must be rejected before AI");
    assert.equal(replies.length, repliesBeforeDuplicate + 1, "persistent duplicate must not call Reply API after restart");
    assert.equal(providers.persistence.listMessageLogs("demo_homestay_a").filter((item) => item.eventId === "restart-duplicate").length, 1);
  } finally {
    await app.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 31, passCount: 31, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
