"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { cleanInput } = require("../lib/onboarding-service");
const { SAFE_HANDOFF_TEXT } = require("../lib/conversation-engine-v2/final-response-renderer");
const { attachPropertyScopedLineBinding } = require("./helpers/property-scoped-line-webhook");

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

function updateAiName(providers, propertyId, aiName) {
  const property = providers.customerSettings.getProperty(propertyId);
  providers.customerSettings.updatePropertyProfile(propertyId, {
    displayName: property.displayName,
    commonAnswers: property.commonAnswers,
    businessProfile: { ...(property.businessProfile || {}), aiName },
    contactLink: property.contactLink
  });
}

async function send(binding, url, propertyId, text, eventId) {
  const raw = JSON.stringify({ destination: "line", events: [{
    type: "message", webhookEventId: eventId, replyToken: `token-${eventId}`,
    timestamp: Date.now(), source: { userId: `user-${propertyId}` },
    message: { type: "text", id: `message-${eventId}`, text }
  }] });
  const response = await binding.post(url, raw);
  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 180));
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-name-line-prefix-"));
  const providers = { kind: "json", ...createJsonProviders({
    dataFile: path.join(temp, "store.json"),
    seedFile: path.resolve(__dirname, "../fixtures/seed.json")
  }) };
  const alphaId = "demo_homestay_a", betaId = "demo_homestay_b", calls = [];
  assert.equal(cleanInput({ propertyName: "AI test", aiName: "小比", contactName: "Owner", phone: "0900", email: "owner@example.test", address: "Address", checkInTime: "15:00", checkOutTime: "11:00", rooms: [], bundles: [], propertyFacts: [], knowledge: [] }).aiName, "小比");
  updateAiName(providers, alphaId, "小比");
  updateAiName(providers, betaId, "");
  const alpha = attachPropertyScopedLineBinding({ providers, propertyId: alphaId, channelSecret: "alpha-channel-secret-123", channelAccessToken: "alpha-channel-access-token-123", encryptionKey });
  const beta = attachPropertyScopedLineBinding({ providers, propertyId: betaId, channelSecret: "beta-channel-secret-1234", channelAccessToken: "beta-channel-access-token-1234", encryptionKey });
  const app = createApp({
    providers, lineBindingEnv: alpha.lineBindingEnv, conversationDebounceMs: 1,
    lineReplyClientFactory: ({ channelAccessToken }) => ({ replyMessageWithHttpInfo: async (body) => { calls.push({ channelAccessToken, body }); return { httpResponse: { status: 200 } }; } })
  });
  app.conversationEngineV2.process = async (input) => {
    const silent = input.messageText === "silent", action = input.messageText === "clarify" ? "clarification" : input.messageText === "handoff" ? "handoff" : silent ? "no_reply" : "reply";
    return {
      traceId: input.eventId,
      finalDecision: { action, reasonCode: silent ? "no_reply" : "answered", reviewRequired: action === "handoff" },
      finalResponse: { action, shouldReply: !silent, replyText: silent ? "" : action === "handoff" ? SAFE_HANDOFF_TEXT : "正式回答" }
    };
  };
  const running = await app.start(0, "127.0.0.1");
  try {
    await send(alpha, running.url, alphaId, "first", "alpha-first");
    await send(beta, running.url, betaId, "first", "beta-first");
    await send(alpha, running.url, alphaId, "clarify", "alpha-clarification");
    await send(alpha, running.url, alphaId, "handoff", "alpha-handoff");
    await send(alpha, running.url, alphaId, "silent", "alpha-silent");
    app.service.updatePropertyProfile({ customerId: alphaId, propertyName: "山嵐示範民宿", aiName: "新名字", address: "", googleMapsUrl: "", lineUrl: "", contactInfo: "", checkInTime: "15:00", latestArrivalTime: "", checkOutTime: "11:00" });
    assert.equal(app.service.getPropertyProfile(alphaId).aiName, "新名字");
    await send(alpha, running.url, alphaId, "second", "alpha-second");
    assert.deepEqual(calls.map((call) => call.body.messages[0].text), ["【AI小比】正式回答", "【AI】正式回答", "【AI小比】正式回答", "【AI小比】請稍候，將盡快回覆您。", "【AI新名字】正式回答"]);
    assert.equal(calls.every((call) => (call.body.messages[0].text.match(/【AI[^】]*】/g) || []).length === 1), true);
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("ai name line prefix: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
