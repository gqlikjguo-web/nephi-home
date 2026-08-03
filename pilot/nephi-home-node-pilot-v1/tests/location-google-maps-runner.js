"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { attachPropertyScopedLineBinding } = require("./helpers/property-scoped-line-webhook");
const { instructions } = require("../lib/providers/test-only-openai-conversation-planner");

function plan(relation = "new_request") {
  return { schemaVersion: 2, discourse: { relation, confidence: 1 }, stateOperations: [], stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, tasks: [{ candidateIndex: 0, taskId: "location", type: "property_fact", sourceText: "location request", detailIntent: "general", requestedOutputs: ["map_url"], dependsOnStayContext: false, entity: { category: "transport", rawText: "location", canonicalCandidate: relation === "continue" ? null : "location", confidence: 1 }, confidence: 1 }], contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "fixture", startOffset: 0, endOffset: 1, quote: "x" }] }], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "location" };
}

function withExplicitRelation(output, sourceEvents, contextSnapshot) {
  const source = sourceEvents[0];
  const kind = output.discourse.relation === "continue" ? "supplement_existing" : "new_request";
  const cycle = contextSnapshot.cycles[0] && contextSnapshot.cycles[0].requestCycleId;
  return { ...output, contextRelationCandidates: output.tasks.map((task) => {
    const taskStart = source.messageText.indexOf(task.sourceText);
    const startOffset = taskStart >= 0 ? taskStart : 0;
    const quote = taskStart >= 0 ? task.sourceText : source.messageText;
    return {
      candidateIndex: task.candidateIndex,
      kind,
      candidateRequestCycleRefs: kind === "new_request" ? [] : cycle ? [cycle] : [],
      evidenceRefs: [{
        eventId: source.eventId,
        startOffset,
        endOffset: startOffset + quote.length,
        quote
      }]
    };
  }) };
}

function memory() {
  const states = new Map(), logs = [];
  return { logs, getConversationState: (p, c, u) => states.get(`${p}:${c}:${u}`) || null, setConversationState: (p, c, u, value) => states.set(`${p}:${c}:${u}`, value), appendMessageLog: (_p, value) => { logs.push(value); return { reviewId: `review-${logs.length}` }; }, updateMessageEvent: () => {} };
}

async function runEngine(property, messages, diagnostics = []) {
  const persistence = memory();
  const planner = { classify: async ({ currentMessage, sourceEvents, contextSnapshot }) => withExplicitRelation(messages.get(currentMessage), sourceEvents, contextSnapshot) };
  const engine = new ConversationEngineV2({ planner, persistence, getProperty: () => property, availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }), listPriceOverrides: () => [], onDiagnostic: (entry) => diagnostics.push(entry), diagnosticMetadata: { providerType: "test" } });
  const output = [];
  for (const [index, message] of [...messages].entries()) output.push(await engine.process({ customerId: property.propertyId, channelId: "line", lineUserId: "guest", eventId: `event-${index}`, eventTimestamp: Date.UTC(2026, 6, 21), messageText: message[0] }));
  return output;
}

(async () => {
  assert.match(instructions(), /canonicalCandidate location/, "planner must use the shared location canonical fact rather than question-specific routing");
  const alphaUrl = "https://maps.app.goo.gl/AlphaLocation";
  const betaUrl = "https://maps.app.goo.gl/BetaLocation";
  const alpha = { propertyId: "location_alpha", displayName: "Alpha", businessProfile: { googleMapsUrl: alphaUrl }, rooms: [], commonAnswers: { parkingRule: "Alpha parking fact." } };
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
  for (const message of [
    "民宿在哪裡？",
    "民宿地址在哪？",
    "可以給我 Google Maps 嗎？",
    "地圖連結給我。",
    "怎麼導航到民宿？",
    "夜市在哪裡？",
    "附近有夜市嗎？",
    "車站在哪裡？",
    "附近有便利商店嗎？",
    "最近的便利商店在哪？",
    "附近有早餐店嗎？",
    "附近有餐廳嗎？",
    "附近有加油站嗎？",
    "附近有景點嗎？",
    "離某個地點多遠？",
    "從某個地點怎麼到民宿？",
    "開車或走路要多久？"
  ]) {
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

  const mixedPlan = plan();
  mixedPlan.tasks = [
    {
      ...mixedPlan.tasks[0],
      candidateIndex: 0,
      sourceText: "民宿在哪裡？",
      eligibilityEvidence: { kind: "none", sourceText: "" },
      stayCandidate: null
    },
    {
      ...mixedPlan.tasks[0],
      candidateIndex: 1,
      taskId: "parking",
      type: "amenity",
      sourceText: "有車位嗎？",
      requestedOutputs: ["answer"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      stayCandidate: null,
      entity: {
        category: "amenity",
        rawText: "車位",
        canonicalCandidate: "parking",
        confidence: 1
      }
    }
  ];
  const mixedDiagnostics = [];
  const [mixed] = await runEngine(
    alpha,
    new Map([["民宿在哪裡？有車位嗎？", mixedPlan]]),
    mixedDiagnostics
  );
  assert.deepEqual(
    mixed.taskResults.map((item) => item.status),
    ["answered", "answered"],
    `location must not suppress another valid property-scoped task; stages=${mixedDiagnostics.map((item) => `${item.stage}:${JSON.stringify(item.rejectionReasons || item.errors || [])}`).join(",")}`
  );
  assert.ok(mixed.replyText.includes(alphaUrl));
  assert.ok(mixed.replyText.includes("Alpha parking fact."));

  const locationRelationCases = [
    "\u6c11\u5bbf\u96e2\u591c\u5e02\u8fd1\u55ce", "\u96e2\u8d85\u5e02\u9060\u4e0d\u9060", "\u8eca\u7ad9\u5728\u9644\u8fd1\u55ce", "\u6d77\u908a\u96e2\u4f60\u5011\u8fd1\u55ce", "\u5e02\u5340\u6703\u5f88\u9060\u55ce",
    "\u53bb\u8eca\u7ad9\u8981\u5e7e\u5206\u9418", "\u96e2\u67d0\u666f\u9ede\u591a\u9060", "\u958b\u8eca\u904e\u53bb\u8981\u591a\u4e45", "\u5468\u908a\u6709\u9910\u5ef3\u55ce", "\u9644\u8fd1\u6709\u91ab\u9662\u55ce", "\u6709\u6c92\u6709\u591c\u5e02\u5728\u9644\u8fd1",
    "\u5230\u5b8c\u5168\u672a\u5217\u8209\u7684\u862d\u967d\u535a\u7269\u9928\u600e\u9ebc\u8d70"
  ];
  for (const message of locationRelationCases) {
    const [result] = await runEngine(alpha, new Map([[message, plan()]]));
    assert.equal(result.taskResults[0].status, "answered", `${message} must complete through the shared location fact`);
    assert.ok(result.replyText.includes(alphaUrl), `${message} must retain the property-scoped map URL`);
  }
  for (const message of ["\u591c\u5e02\u53ef\u4ee5\u70e4\u8089\u55ce", "\u8d85\u5e02\u53ef\u4ee5\u5237\u5361\u55ce", "\u8eca\u7ad9\u6709\u7f6e\u7269\u6ac3\u55ce", "\u6211\u559c\u6b61\u901b\u591c\u5e02"]) {
    const notLocation = { ...plan(), tasks: [{ ...plan().tasks[0], taskId: "not-location", sourceText: message, entity: { category: "other", rawText: message, canonicalCandidate: null, confidence: 1 } }] };
    const [result] = await runEngine(alpha, new Map([[message, notLocation]]));
    assert.equal(result.replyText.includes(alphaUrl), false, `${message} must not become location merely because it names a place`);
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "location-chain-"));
  const seedFile = path.join(temp, "seed.json"), dataFile = path.join(temp, "store.json"), secret = "location-chain-secret", replies = [];
  fs.writeFileSync(seedFile, JSON.stringify({ testOnly: true, homestays: [{ customerId: "location_line", name: "Line location", businessProfile: { googleMapsUrl: alphaUrl }, safeFacts: {}, rooms: [] }], messageLogs: { location_line: [] } }));
  const providers = { kind: "json", ...createJsonProviders({ dataFile, seedFile }) };
  const binding = attachPropertyScopedLineBinding({ providers, propertyId: "location_line", channelSecret: secret, channelAccessToken: "token-token-token-token" });
  const app = createApp({ providers, lineBindingEnv: binding.lineBindingEnv, conversationDebounceMs: 1, conversationPlannerV2: { classify: async ({ sourceEvents, contextSnapshot }) => withExplicitRelation(plan(), sourceEvents, contextSnapshot) }, lineReplyClientFactory: () => ({ replyMessageWithHttpInfo: async (body) => { replies.push(body); return { httpResponse: { status: 200 } }; } }) });
  const running = await app.start(0, "127.0.0.1");
  try {
    const payload = JSON.stringify({ destination: "line", events: [{ type: "message", webhookEventId: "location-event", replyToken: "token", timestamp: 1, source: { userId: "guest" }, message: { type: "text", id: "m1", text: "我要怎麼導航過去？" } }] });
    assert.equal((await binding.post(running.url, payload)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(replies.length, 1);
    assert.ok(replies[0].messages[0].text.includes(alphaUrl));
    assert.ok(replies[0].messages[0].text.trim());
  } finally { await app.stop(); fs.rmSync(temp, { recursive: true, force: true }); }
  console.log("location google maps: PASS");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
