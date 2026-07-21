"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { createApp } = require("../server");
const { instructions } = require("../lib/providers/test-only-openai-conversation-planner");

function plan(relation = "new_request") {
  return { schemaVersion: 2, discourse: { relation, confidence: 1 }, stateOperations: [], stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, tasks: [{ taskId: "location", type: "property_fact", sourceText: "location request", detailIntent: "general", requestedOutputs: ["map_url"], dependsOnStayContext: false, entity: { category: "transport", rawText: "location", canonicalCandidate: relation === "continue" ? null : "location", confidence: 1 }, confidence: 1 }], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "location" };
}

function memory() {
  const states = new Map(), logs = [];
  return { logs, getConversationState: (p, c, u) => states.get(`${p}:${c}:${u}`) || null, setConversationState: (p, c, u, value) => states.set(`${p}:${c}:${u}`, value), appendMessageLog: (_p, value) => { logs.push(value); return { reviewId: `review-${logs.length}` }; }, updateMessageEvent: () => {} };
}

async function runEngine(property, messages, diagnostics = []) {
  const persistence = memory();
  const planner = { classify: async ({ currentMessage }) => messages.get(currentMessage) };
  const engine = new ConversationEngineV2({ planner, persistence, getProperty: () => property, availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }), listPriceOverrides: () => [], onDiagnostic: (entry) => diagnostics.push(entry), diagnosticMetadata: { providerType: "test" } });
  const output = [];
  for (const [index, message] of [...messages].entries()) output.push(await engine.process({ customerId: property.propertyId, channelId: "line", lineUserId: "guest", eventId: `event-${index}`, eventTimestamp: Date.UTC(2026, 6, 21), messageText: message[0] }));
  return output;
}

(async () => {
  assert.match(instructions(), /canonicalCandidate location/, "planner must use the shared location canonical fact rather than question-specific routing");
  const alphaUrl = "https://maps.app.goo.gl/AlphaLocation";
  const betaUrl = "https://maps.app.goo.gl/BetaLocation";
  const alpha = { propertyId: "location_alpha", displayName: "Alpha", businessProfile: { googleMapsUrl: alphaUrl }, rooms: [], commonAnswers: {} };
  const beta = { propertyId: "location_beta", displayName: "Beta", businessProfile: { googleMapsUrl: betaUrl }, rooms: [], commonAnswers: {} };
  const legacy = { propertyId: "location_legacy", displayName: "Legacy", businessProfile: {}, rooms: [], commonAnswers: { transport: `交通與導航請參考 Google 地圖：\n${alphaUrl}` } };
  const legacyDiagnostics = [];
  const [legacyResult] = await runEngine(legacy, new Map([["我要導航", plan()]]), legacyDiagnostics);
  assert.ok(legacyResult.replyText.includes(alphaUrl), "a legacy property-scoped transport answer containing a Google Maps URL must materialize as the location fact");
  const catalogTrace = legacyDiagnostics.find((item) => item.stage === "property_catalog");
  const executorTrace = legacyDiagnostics.find((item) => item.stage === "executor");
  assert.deepEqual(catalogTrace.location, { source: "commonAnswers.transport", profileValuePresent: false, transportValuePresent: true, urlValidation: "pass" });
  assert.equal(executorTrace.results[0].locationFactProvided, true, "trace must confirm that the executor received the location fact without logging its raw value");
  const [transportProse] = await runEngine({ propertyId: "location_transport_prose", displayName: "Transport prose", businessProfile: {}, rooms: [], commonAnswers: { transport: "可詢問業者交通方式" } }, new Map([["我要導航", plan()]]));
  assert.equal(transportProse.taskResults[0].status, "needs_human", "ordinary transport prose must not become a location URL");
  for (const message of ["民宿在哪裡？", "地址可以給我嗎？", "有 Google 地圖嗎？", "可以傳定位給我嗎？", "我要怎麼導航過去？", "附近有夜市嗎？", "最近的超商是哪一家？", "離車站遠嗎？", "附近有什麼景點？", "到羅東夜市要多久？"]) {
    const [result] = await runEngine(alpha, new Map([[message, plan()]]));
    assert.ok(result.replyText.includes(alphaUrl), `${message} must use the current property's map URL`);
    assert.equal(/\b\d+\s*(km|公里|分鐘|min)/i.test(result.replyText), false, `${message} must not estimate distance or time`);
  }
  const questions = new Map([["民宿在哪裡？", plan()], ["那離夜市遠嗎？", plan("continue")]]);
  const [first, followUp] = await runEngine(alpha, questions);
  assert.match(first.replyText, new RegExp(alphaUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(followUp.replyText, new RegExp(alphaUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(/\b\d+\s*(km|公里|分鐘|min)/i.test(`${first.replyText}\n${followUp.replyText}`), false);
  const [betaResult] = await runEngine(beta, new Map([["最近的超商是哪一家？", plan()]]));
  assert.ok(betaResult.replyText.includes(betaUrl));
  assert.equal(betaResult.replyText.includes(alphaUrl), false);
  const [missing] = await runEngine({ propertyId: "location_missing", displayName: "Missing", businessProfile: {}, rooms: [], commonAnswers: {} }, new Map([["有 Google 地圖嗎？", plan()]]));
  assert.equal(missing.taskResults[0].status, "needs_human");
  assert.equal(/https:\/\//.test(missing.replyText), false);
  const [invalid] = await runEngine({ propertyId: "location_invalid", displayName: "Invalid", businessProfile: { googleMapsUrl: "https://example.com/not-a-map" }, rooms: [], commonAnswers: {} }, new Map([["我要導航", plan()]]));
  assert.equal(invalid.taskResults[0].status, "needs_human");
  assert.equal(/https:\/\//.test(invalid.replyText), false);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "location-chain-"));
  const seedFile = path.join(temp, "seed.json"), dataFile = path.join(temp, "store.json"), secret = "location-chain-secret", replies = [];
  fs.writeFileSync(seedFile, JSON.stringify({ testOnly: true, homestays: [{ customerId: "location_line", name: "Line location", businessProfile: { googleMapsUrl: alphaUrl }, safeFacts: {}, rooms: [] }], messageLogs: { location_line: [] } }));
  const app = createApp({ dataFile, seedFile, lineChannelSecret: secret, lineChannelAccessToken: "token", lineChannelIdentityGuardRequired: false, conversationDebounceMs: 1, conversationPlannerV2: { classify: async () => plan() }, lineReplyClientFactory: () => ({ replyMessageWithHttpInfo: async (body) => { replies.push(body); return { httpResponse: { status: 200 } }; } }) });
  const running = await app.start(0, "127.0.0.1");
  try {
    const payload = JSON.stringify({ destination: "line", events: [{ type: "message", webhookEventId: "location-event", replyToken: "token", timestamp: 1, source: { userId: "guest" }, message: { type: "text", id: "m1", text: "我要怎麼導航過去？" } }] });
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64");
    assert.equal((await fetch(`${running.url}/api/test-line/webhook?customerId=location_line`, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": signature }, body: payload })).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(replies.length, 1);
    assert.ok(replies[0].messages[0].text.includes(alphaUrl));
    assert.ok(replies[0].messages[0].text.trim());
  } finally { await app.stop(); fs.rmSync(temp, { recursive: true, force: true }); }
  console.log("location google maps: PASS");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
