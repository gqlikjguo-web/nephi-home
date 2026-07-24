"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ConversationEngineV2, normalizePlannerOutput } = require("../lib/conversation-engine-v2/engine");
const { plannerJsonSchema, validatePlannerOutput } = require("../lib/conversation-engine-v2/planner-schema");
const { createApp } = require("../server");

const property = { propertyId: "demo_homestay_a", timezone: "Asia/Taipei", rooms: [], commonAnswers: { checkInTime: "15:00" } };

function validPlannerOutput() {
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 1 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [{ candidateIndex: 0, taskId: "t", type: "policy", sourceText: "check in", detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: false, entity: { category: "policy", rawText: "check in", canonicalCandidate: "check_in", confidence: 1 }, confidence: 1 }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "test-event", startOffset: 0, endOffset: 4, quote: "test" }] }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "test"
  };
}

async function engineResult(output) {
  const logs = [];
  const engine = new ConversationEngineV2({
    planner: { classify: async () => output },
    persistence: { getConversationState: () => null, setConversationState: () => {}, appendMessageLog: (_propertyId, item) => { logs.push(item); return { reviewId: "r" }; } },
    getProperty: () => property,
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => []
  });
  const result = await engine.process({ customerId: property.propertyId, channelId: "test", lineUserId: "guest", eventId: String(output), eventTimestamp: 1, messageText: "test" });
  assert.equal(result.shouldReply, true);
  assert.ok(result.replyText.length > 0);
  assert.equal(logs.at(-1).decisionReason, "planner_empty_output");
}

function invalidRelationOutput() {
  return {
    ...validPlannerOutput(),
    tasks: [{ candidateIndex: 0, taskId: "availability", type: "availability", sourceText: "availability", detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, confidence: 1 }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: "supplement_existing", candidateRequestCycleRefs: ["not-in-snapshot"], evidenceRefs: [{ eventId: "invalid-relation-event", startOffset: 0, endOffset: 7, quote: "invalid" }] }]
  };
}

async function sendWebhook(url, secret, eventId, text) {
  const payload = JSON.stringify({ destination: "line", events: [{ type: "message", webhookEventId: eventId, replyToken: `token-${eventId}`, timestamp: 1, source: { userId: "guest" }, message: { type: "text", id: `m-${eventId}`, text } }] });
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64");
  const response = await fetch(`${url}/api/test-line/webhook?customerId=demo_homestay_a`, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": signature }, body: payload });
  assert.equal(response.status, 200);
}

async function main() {
  for (const output of [null, undefined, "not-an-object", { schemaVersion: 2 }]) await engineResult(output);

  const strict = plannerJsonSchema().properties.tasks.items;
  assert.ok(strict.required.includes("detailIntent"));
  assert.ok(strict.required.includes("eligibilityEvidence"));
  const valid = validPlannerOutput();
  assert.equal(validatePlannerOutput(valid).ok, true);
  valid.tasks[0].detailIntent = "free_text";
  assert.equal(validatePlannerOutput(valid).ok, false);
  const normalized = normalizePlannerOutput({ ...valid, tasks: [{ ...valid.tasks[0], detailIntent: "general" }, { ...valid.tasks[0], taskId: "t2", detailIntent: "free_text" }] });
  assert.equal(normalized.tasks.length, 2);
  assert.equal(normalized.tasks[1].detailIntent, "general");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "planner-failure-safety-"));
  const dataFile = path.join(temp, "store.json");
  const secret = "planner-failure-secret";
  const replies = [];
  const app = createApp({
    dataFile,
    seedFile: path.resolve(__dirname, "../fixtures/seed.json"),
    lineChannelSecret: secret,
    lineChannelAccessToken: "token",
    conversationDebounceMs: 1,
    lineChannelIdentityGuardRequired: false,
    conversationPlannerV2: { classify: async ({ currentMessage }) => currentMessage === "invalid relation" ? invalidRelationOutput() : null },
    lineReplyClientFactory: () => ({ replyMessageWithHttpInfo: async (body) => { replies.push(body); return { httpResponse: { status: 200 } }; } })
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    await sendWebhook(running.url, secret, "planner-null-event", "test");
    await sendWebhook(running.url, secret, "invalid-relation-event", "invalid relation");
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(replies.length, 2);
    replies.forEach((body) => assert.ok(body.messages[0].text.length > 0, "contract failure must be delivered as a non-empty safe reply"));
    assert.ok(replies.every((body) => !body.messages[0].text.includes("SECRET_UNAUTHORIZED_FACT")), "unapproved facts must not enter the reply");

    const saved = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    const records = (saved.messageLogs.demo_homestay_a || []).filter((item) => String(item.eventId || "").startsWith("invalid-relation-event"));
    assert.ok(records.length > 0, "the invalid-relation event must have persisted records");
    assert.ok(records.every((item) => item.processingStatus !== "processing_failed"), "contract failure must not be persisted as processing_failed");
    const delivered = records.find((item) => item.eventId === "invalid-relation-event");
    assert.equal(delivered.processingStatus, "reply_succeeded", "the event must complete normal delivery");
    assert.equal(delivered.replyDelivered, true);
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("planner failure safety: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
