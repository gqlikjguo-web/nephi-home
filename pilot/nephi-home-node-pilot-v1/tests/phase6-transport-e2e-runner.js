"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");

const secret = "phase6-secret";
const propertyId = "demo_homestay_a";
const property = { propertyId, displayName: "Test", timezone: "Asia/Taipei", currency: "TWD", rooms: [], commonAnswers: { parkingRule: "Parking is available." }, semanticCatalog: { aliases: { parking: ["parking"] }, amenities: [] } };
const comparableDecision = (trace) => ({ decision: trace.decision, reasonCode: trace.reasonCode });

function plannerFor(kind) {
  return { classify: async ({ sourceEvents }) => {
    const source = sourceEvents[0];
    const relation = (candidateIndex) => ({ candidateIndex, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: source.eventId, startOffset: 0, endOffset: source.messageText.length, quote: source.messageText }] });
    const base = { schemaVersion: 2, discourse: { relation: "new_request", confidence: 0.99 }, stateOperations: [], stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "test" };
    if (kind === "handoff") throw new Error("planner failure");
    if (kind === "no_reply") {
      const task = { taskId: "ack", candidateIndex: 0, type: "unknown", sourceText: "acknowledgement", detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: false, stayCandidate: null, entity: { category: "other", rawText: "acknowledgement", canonicalCandidate: null, confidence: 0.99 }, confidence: 0.99 };
      return { ...base, discourse: { relation: "acknowledgement", confidence: 0.99 }, shouldIgnore: true, tasks: [task], contextRelationCandidates: [relation(0)] };
    }
    if (kind === "clarification") {
      const task = { taskId: "availability", candidateIndex: 0, type: "availability", sourceText: "availability", requestedOutputs: ["availability"], dependsOnStayContext: true, stayCandidate: base.stay, entity: { category: "room", rawText: "", canonicalCandidate: null, confidence: 0.99 }, confidence: 0.99 };
      return { ...base, tasks: [task], contextRelationCandidates: [relation(0)] };
    }
    const task = { taskId: "parking", candidateIndex: 0, type: "amenity", sourceText: "parking", requestedOutputs: ["answer"], dependsOnStayContext: false, stayCandidate: null, entity: { category: "amenity", rawText: "parking", canonicalCandidate: "parking", confidence: 0.99 }, confidence: 0.99 };
    return { ...base, tasks: [task], contextRelationCandidates: [relation(0)] };
  } };
}

async function run(kind, mode, { callbackThrows = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "phase6-transport-"));
  const engineDiagnostics = [], transportDiagnostics = [], calls = [];
  const app = createApp({
    dataFile: path.join(temp, "store.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"),
    lineChannelSecret: secret, lineChannelAccessToken: "token", conversationDebounceMs: 1, lineChannelIdentityGuardRequired: false,
    testOnlyOverrides: { planner: plannerFor(kind), getProperty: () => property, onDiagnostic: (entry) => engineDiagnostics.push(entry) },
    testOnlyTransportDiagnostic: (entry) => { transportDiagnostics.push(entry); if (callbackThrows) throw new Error("diagnostic failure"); },
    lineReplyClientFactory: () => ({ replyMessageWithHttpInfo: async (body) => { calls.push(body); if (mode === "failure") { const error = new Error("failed"); error.status = 500; throw error; } return { httpResponse: { status: 200 } }; } })
  });
  const running = await app.start(0, "127.0.0.1");
  try {
    const eventId = `${kind}-${mode}${callbackThrows ? "-callback-throws" : ""}`;
    const event = { type: "message", webhookEventId: eventId, replyToken: "token", timestamp: Date.now(), source: { userId: "u" }, message: { type: "text", id: `m-${eventId}`, text: kind } };
    const raw = JSON.stringify({ destination: "line", events: [event] });
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    const response = await fetch(`${running.url}/api/test-line/webhook?customerId=${propertyId}`, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": signature }, body: raw });
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const records = app.providers.persistence.listMessageLogs(propertyId);
    return { eventId, engineDiagnostics, transportDiagnostics, calls, records };
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function assertRecordAlignment(result, kind) {
  const main = result.records.find((entry) => entry.eventId === result.eventId);
  assert.ok(main, "main message record must retain the webhook event id");
  assert.equal(main.needsReview, kind === "handoff");
  assert.equal(main.humanHandoff, kind === "handoff");
  if (kind === "handoff") assert.ok(result.records.some((entry) => entry.eventId.startsWith(`${result.eventId}:review:`)), "handoff must persist a scoped review record");
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
    assert.deepEqual(comparableDecision(successFinal), comparableDecision(failureFinal));
    assertRecordAlignment(success, kind);
    assertRecordAlignment(failure, kind);
  }
  const silent = await run("no_reply", "success");
  assert.equal(silent.engineDiagnostics.find((entry) => entry.stage === "final_decision").decision, "no_reply");
  assert.deepEqual(silent.transportDiagnostics, [{ traceId: silent.transportDiagnostics[0].traceId, propertyId, stage: "line_transport", decision: "no_reply", reasonCode: "no_reply_gate_hit", attempted: false, delivered: false }]);
  assert.equal(silent.calls.length, 0);
  assertRecordAlignment(silent, "no_reply");
  const callbackFailure = await run("reply", "success", { callbackThrows: true });
  assert.equal(callbackFailure.calls.length, 1, "a diagnostic callback failure must not suppress the LINE reply");
  assert.equal(callbackFailure.records.find((entry) => entry.eventId === callbackFailure.eventId).processingStatus, "reply_succeeded");
  console.log("phase6 transport e2e: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
