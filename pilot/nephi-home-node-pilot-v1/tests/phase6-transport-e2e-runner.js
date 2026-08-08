"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { migrateFakePlannerOutput } = require("./helpers/fake-planner-semantic-ledger");
const { attachPropertyScopedLineBinding } = require("./helpers/property-scoped-line-webhook");

const secret = "phase6-channel-secret";
const propertyId = "demo_homestay_a";
const channelId = "line";
const lineUserId = "u";
const property = { propertyId, displayName: "Test", timezone: "Asia/Taipei", currency: "TWD", rooms: [], commonAnswers: { parkingRule: "Parking is available." }, semanticCatalog: { aliases: { parking: ["parking"] }, amenities: [] } };

function plannerFor(kind) {
  return { classify: async ({ sourceEvents }) => {
    const source = sourceEvents[0];
    const relation = (candidateIndex) => ({ candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: source.eventId, startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }] });
    const finalize = (value) => migrateFakePlannerOutput(value);
    const base = { schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations: [], stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "test" };
    if (kind === "handoff") throw new Error("planner failure");
    if (kind === "no_reply") {
      const task = { taskId: "ack", candidateIndex: 0, type: "unknown", sourceText: "acknowledgement", detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: false, stayCandidate: null, entity: { category: "other", rawText: "acknowledgement", canonicalCandidate: null, confidence: 0.99 }, confidence: 0.99 };
      return finalize({ ...base, discourse: { relation: "acknowledgement", confidence: 0.99 }, shouldIgnore: true, tasks: [task], contextRelationCandidates: [relation(0)] });
    }
    if (kind === "clarification") {
      const task = { taskId: "availability", candidateIndex: 0, type: "availability", sourceText: "availability", requestedOutputs: ["availability"], dependsOnStayContext: true, stayCandidate: base.stay, entity: { category: "room", rawText: "", canonicalCandidate: null, confidence: 0.99 }, confidence: 0.99 };
      return finalize({ ...base, tasks: [task], contextRelationCandidates: [relation(0)] });
    }
    const task = { taskId: "parking", candidateIndex: 0, type: "amenity", sourceText: "parking", requestedOutputs: ["answer"], dependsOnStayContext: false, stayCandidate: null, entity: { category: "amenity", rawText: "parking", canonicalCandidate: "parking", confidence: 0.99 }, confidence: 0.99 };
    return finalize({ ...base, tasks: [task], contextRelationCandidates: [relation(0)] });
  } };
}

async function run(kind, mode, { callbackThrows = false, finalResponseOverride = null } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "phase6-transport-"));
  const engineDiagnostics = [], transportDiagnostics = [], calls = [], finalDecisions = new Map(), finalResponses = new Map();
  const providers = { kind: "json", ...createJsonProviders({ dataFile: path.join(temp, "store.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json") }) };
  const binding = attachPropertyScopedLineBinding({ providers, propertyId, channelSecret: secret, channelAccessToken: "phase6-test-token" });
  const app = createApp({
    providers, lineBindingEnv: binding.lineBindingEnv, conversationDebounceMs: 1,
    testOnlyOverrides: { planner: plannerFor(kind), getProperty: () => property, onDiagnostic: (entry) => engineDiagnostics.push(entry) },
    testOnlyTransportDiagnostic: (entry) => { transportDiagnostics.push(entry); if (callbackThrows) throw new Error("diagnostic failure"); },
    lineReplyClientFactory: () => ({ replyMessageWithHttpInfo: async (body) => { calls.push(body); if (mode === "failure") { const error = new Error("failed"); error.status = 500; throw error; } return { httpResponse: { status: 200 } }; } })
  });
  const processEngine = app.conversationEngineV2.process.bind(app.conversationEngineV2);
  app.conversationEngineV2.process = async (input) => {
    const result = await processEngine(input);
    if (finalResponseOverride) result.finalResponse = { ...result.finalResponse, ...finalResponseOverride };
    const finalDecision = JSON.parse(JSON.stringify(result.finalDecision));
    const finalResponse = JSON.parse(JSON.stringify(result.finalResponse));
    for (const eventId of input.eventIds || [input.eventId]) {
      finalDecisions.set(eventId, finalDecision);
      finalResponses.set(eventId, finalResponse);
    }
    return result;
  };
  const running = await app.start(0, "127.0.0.1");
  try {
    const eventId = `${kind}-${mode}${callbackThrows ? "-callback-throws" : ""}`;
    const event = { type: "message", webhookEventId: eventId, replyToken: "token", timestamp: Date.now(), source: { userId: lineUserId }, message: { type: "text", id: `m-${eventId}`, text: kind } };
    const raw = JSON.stringify({ destination: channelId, events: [event] });
    const response = await binding.post(running.url, raw);
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const records = app.providers.persistence.listMessageLogs(propertyId).map((entry) => ({ ...entry, propertyId }));
    const boundChannelId = `line-binding:${crypto.createHash("sha256").update(binding.binding.webhookKey).digest("hex").slice(0, 24)}`;
    return { propertyId, channelId: boundChannelId, lineUserId, eventId, finalDecision: finalDecisions.get(eventId), finalResponse: finalResponses.get(eventId), engineDiagnostics, transportDiagnostics, calls, records };
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function findExactRecord(result, matchesEventId) {
  return result.records.find((entry) => (
    entry.propertyId === result.propertyId
    && entry.channelId === result.channelId
    && entry.lineUserId === result.lineUserId
    && matchesEventId(entry.eventId)
  ));
}

function assertRecordAlignment(result) {
  const main = findExactRecord(result, (eventId) => eventId === result.eventId);
  assert.ok(main, "main message record must retain the webhook event id");
  assert.equal(main.decisionReason, result.finalDecision.reasonCode);
  assert.equal(main.needsReview, result.finalDecision.reviewRequired);
  assert.equal(main.humanHandoff, result.finalDecision.action === "handoff");
  if (result.finalDecision.action === "handoff") {
    assert.ok(findExactRecord(result, (eventId) => eventId.startsWith(`${result.eventId}:review:`)), "handoff must persist a scoped review record");
  }
}

(async () => {
  for (const kind of ["reply", "clarification", "handoff"]) {
    const success = await run(kind, "success");
    const failure = await run(kind, "failure");
    const successFinal = success.engineDiagnostics.find((entry) => entry.stage === "final_decision");
    const failureFinal = failure.engineDiagnostics.find((entry) => entry.stage === "final_decision");
    const successTransport = success.transportDiagnostics.at(-1);
    const failureTransport = failure.transportDiagnostics.at(-1);
    assert.equal(successFinal.decision, kind);
    assert.equal(successTransport.decision, kind);
    assert.equal(successTransport.reasonCode, "reply_succeeded");
    assert.equal(successTransport.delivered, true);
    assert.equal(failureTransport.decision, kind);
    assert.equal(failureTransport.reasonCode, "reply_failed");
    assert.equal(failureTransport.delivered, false);
    assert.equal(success.calls.length, 1);
    assert.equal(failure.calls.length, 1);
    assert.ok(success.finalDecision, "success webhook execution must expose the complete FinalDecision");
    assert.ok(failure.finalDecision, "failure webhook execution must expose the complete FinalDecision");
    assert.deepEqual(failure.finalDecision, success.finalDecision);
    assertRecordAlignment(success);
    assertRecordAlignment(failure);
  }
  const silent = await run("no_reply", "success");
  assert.equal(silent.engineDiagnostics.find((entry) => entry.stage === "final_decision").decision, "no_reply");
  assert.deepEqual(silent.transportDiagnostics, [{ traceId: silent.transportDiagnostics[0].traceId, propertyId, stage: "line_transport", decision: "no_reply", reasonCode: "no_reply_gate_hit", attempted: false, delivered: false }]);
  assert.equal(silent.finalResponse.shouldReply, false);
  assert.equal(silent.finalResponse.replyText.trim(), "");
  assert.equal(silent.calls.length, 0);
  assert.deepEqual(Object.fromEntries(["processingStatus", "shouldReply", "noReply"].map((key) => [key, findExactRecord(silent, (eventId) => eventId === silent.eventId)[key]])), {
    processingStatus: "no_reply", shouldReply: false, noReply: true
  });
  assertRecordAlignment(silent);
  const delivered = await run("reply", "success");
  assert.equal(delivered.finalResponse.shouldReply, true);
  assert.notEqual(delivered.finalResponse.replyText.trim(), "");
  assert.equal(delivered.calls.length, 1);
  assert.equal(delivered.calls[0].messages[0].text, delivered.finalResponse.replyText);
  assert.equal(findExactRecord(delivered, (eventId) => eventId === delivered.eventId).processingStatus, "reply_succeeded");
  assert.equal(findExactRecord(delivered, (eventId) => eventId === delivered.eventId).replyDelivered, true);
  const blank = await run("reply", "success", { finalResponseOverride: { shouldReply: true, replyText: " \t " } });
  const blankRecord = findExactRecord(blank, (eventId) => eventId === blank.eventId);
  assert.equal(blank.calls.length, 0, "a blank FinalResponse must not call the LINE reply API");
  assert.equal(blankRecord.processingStatus, "final_response_contract_failed");
  assert.equal(blankRecord.needsReview, true);
  assert.equal(blankRecord.replyDelivered, false);
  assert.equal(blankRecord.noReply, false);
  assert.equal(blankRecord.deliveryErrorCode, "final_response_empty_reply");
  assert.deepEqual(blank.transportDiagnostics.at(-1), { traceId: blank.transportDiagnostics.at(-1).traceId, propertyId, stage: "line_transport", decision: "reply", reasonCode: "final_response_empty_reply", attempted: false, delivered: false });
  const callbackFailure = await run("reply", "success", { callbackThrows: true });
  assert.equal(callbackFailure.calls.length, 1, "a diagnostic callback failure must not suppress the LINE reply");
  assert.equal(callbackFailure.records.find((entry) => entry.eventId === callbackFailure.eventId).processingStatus, "reply_succeeded");
  console.log("phase6 transport e2e: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
