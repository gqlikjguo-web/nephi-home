"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { sessionTokenHash } = require("../lib/admin-auth");
const { sha256 } = require("../lib/test-only-line-message-trace");

const TARGET_MESSAGE = "8/6 有雙人房嗎？";
const PROPERTY_ID = "demo_homestay_a";
const ADMIN_TOKEN = "trace-admin-session";
const LINE_SECRET = "test-only-line-secret";
const LINE_TOKEN = "test-only-line-token";
const NOW = "2026-08-01T12:00:00.000Z";

function plannerOutput(sourceEvent) {
  const stay = {
    dateExpression: { rawText: "8/6", kind: "absolute", anchor: "message_time" },
    checkInCandidate: "2026-08-06",
    checkOutCandidate: "2026-08-07",
    nightsCandidate: 1,
    guestCountCandidate: 2
  };
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay,
    tasks: [{
      candidateIndex: 0,
      taskId: "availability-double",
      type: "availability",
      sourceText: TARGET_MESSAGE,
      detailIntent: "general",
      requestedOutputs: ["availability"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: true,
      entity: { category: "room", rawText: "雙人房", canonicalCandidate: null, confidence: 0.99 },
      stayCandidate: stay,
      confidence: 0.99
    }],
    contextRelationCandidates: [{
      candidateIndex: 0,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [{ eventId: sourceEvent.eventId, messageRef: "", startOffset: 0, endOffset: TARGET_MESSAGE.length, quote: TARGET_MESSAGE }]
    }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "dual_user_trace_http_contract"
  };
}

function extendPersistence(providers) {
  const traces = new Map();
  let deleteCalls = 0;
  const originalDelete = providers.persistence.deleteConversationState.bind(providers.persistence);
  providers.persistence.deleteConversationState = (...args) => { deleteCalls += 1; return originalDelete(...args); };
  providers.persistence.upsertTestOnlyLineTrace = (record) => {
    const key = `${record.propertyId}:${record.eventId}`;
    const previous = traces.get(key) || {};
    traces.set(key, {
      ...previous,
      ...structuredClone(record),
      stages: { ...(previous.stages || {}), ...(structuredClone(record.stages) || {}) }
    });
    return traces.get(key);
  };
  providers.persistence.listTestOnlyLineTraces = ({ propertyId, eventId = "", traceId = "", messageTextHash = "", now, limit = 20 }) => [...traces.values()]
    .filter((record) => record.propertyId === propertyId)
    .filter((record) => !eventId || record.eventId === eventId)
    .filter((record) => !traceId || record.traceId === traceId)
    .filter((record) => !messageTextHash || record.messageTextHash === messageTextHash)
    .filter((record) => Date.parse(record.expiresAt) > Date.parse(now))
    .slice(0, limit)
    .map((record) => structuredClone(record));
  return { traces, deleteCalls: () => deleteCalls };
}

function webhookBody(eventId, lineUserId, text = TARGET_MESSAGE) {
  return JSON.stringify({
    destination: "test-only-destination",
    events: [{
      type: "message",
      webhookEventId: eventId,
      replyToken: `reply-${eventId}`,
      timestamp: Date.parse(NOW),
      source: { type: "user", userId: lineUserId },
      message: { type: "text", id: `message-${eventId}`, text }
    }]
  });
}

function signature(body) {
  return crypto.createHmac("sha256", LINE_SECRET).update(body).digest("base64");
}

async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for persisted LINE trace");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function traceGet(baseUrl, propertyId = PROPERTY_ID, cookie = `nephi_admin_session=${ADMIN_TOKEN}`) {
  return fetch(`${baseUrl}/api/test-only/line-message-traces?propertyId=${encodeURIComponent(propertyId)}&messageTextHash=${sha256(TARGET_MESSAGE)}`, {
    headers: cookie ? { cookie } : {}
  });
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-line-trace-http-"));
  let app;
  let disabled;
  try {
    const disabledProviders = createJsonProviders({ dataFile: path.join(temp, "disabled.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), now: () => new Date(NOW) });
    extendPersistence(disabledProviders);
    disabled = createApp({
      providers: disabledProviders,
      adminAuthRequired: false,
      testOnlyEnvironment: true,
      testOnlyLineMessageTraceEnabled: true,
      testOnlyLineMessageTracePropertyId: PROPERTY_ID,
      testOnlyLineMessageTraceTargetSha256: sha256(TARGET_MESSAGE),
      lineChannelIdentityGuardRequired: false,
      now: () => new Date(NOW)
    });
    const disabledRunning = await disabled.start(0, "127.0.0.1");
    assert.equal((await traceGet(disabledRunning.url)).status, 404, "the trace route must not exist when existing admin authentication is unavailable");
    await disabled.stop();
    disabled = null;

    const providers = createJsonProviders({ dataFile: path.join(temp, "enabled.json"), seedFile: path.resolve(__dirname, "../fixtures/seed.json"), now: () => new Date(NOW) });
    const persistenceState = extendPersistence(providers);
    providers.persistence.getAdminSession = (tokenHash) => tokenHash === sessionTokenHash(ADMIN_TOKEN)
      ? { propertyId: PROPERTY_ID, username: "trace-admin", properties: [{ propertyId: PROPERTY_ID }] }
      : null;
    const replies = [];
    app = createApp({
      providers,
      adminAuthRequired: true,
      testOnlyEnvironment: true,
      testOnlyLineMessageTraceEnabled: true,
      testOnlyLineMessageTracePropertyId: PROPERTY_ID,
      testOnlyLineMessageTraceTargetSha256: sha256(TARGET_MESSAGE),
      lineChannelSecret: LINE_SECRET,
      lineChannelAccessToken: LINE_TOKEN,
      lineChannelIdentityGuardRequired: false,
      conversationDebounceMs: 1,
      now: () => new Date(NOW),
      conversationPlannerV2: { classify: async ({ sourceEvents }) => plannerOutput(sourceEvents[0]) },
      lineReplyClientFactory: ({ channelAccessToken }) => ({
        replyMessageWithHttpInfo: async (body) => {
          replies.push({ channelAccessToken, body: structuredClone(body) });
          return { httpResponse: { status: 200 } };
        }
      })
    });
    const running = await app.start(0, "127.0.0.1");

    assert.equal((await traceGet(running.url, PROPERTY_ID, "")).status, 401, "existing admin authentication must protect trace reads");
    assert.equal((await traceGet(running.url, "demo_homestay_b")).status, 403, "an admin must not read a different property trace");

    const targetBody = webhookBody("event-a", "U-real-user-a");
    const webhook = await fetch(`${running.url}/api/test-line/webhook?customerId=${PROPERTY_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": signature(targetBody) },
      body: targetBody
    });
    assert.equal(webhook.status, 200);
    await waitFor(() => replies.length === 1 && [...persistenceState.traces.values()].some((record) => record.stages.line_transport && record.stages.line_transport.delivered === true));

    const response = await traceGet(running.url);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.items.length, 1);
    const record = payload.data.items[0];
    assert.equal(record.lineUserHash, sha256("U-real-user-a"));
    assert.equal(record.eventId, "event-a");
    for (const stage of ["state_before", "planner", "validation", "context_validation", "canonical_request", "temporal", "context_execution", "executor", "final_decision", "final_response", "line_transport"]) {
      assert.ok(record.stages[stage], `trace must include ${stage}`);
    }
    assert.equal(record.stages.canonical_request.items[0].temporalState.checkIn, "2026-08-06");
    assert.equal(record.stages.temporal.items[0].resolutionSource, "canonical_temporal_grammar");
    assert.equal(record.stages.executor.resolverCalls.length, 1);
    assert.equal(record.stages.executor.resolverCalls[0].request.customerId, PROPERTY_ID);
    assert.equal(record.stages.executor.resolverCalls[0].request.checkIn, "2026-08-06");
    assert.equal(record.stages.executor.resolverCalls[0].response.customerId, PROPERTY_ID);
    assert.equal(record.stages.executor.resolverCalls[0].response.availabilityReliable, true);
    assert.ok(record.stages.executor.resolverCalls[0].response.rooms.length > 0);
    assert.equal(record.stages.final_response.shouldReply, true);
    assert.equal(record.stages.line_transport.attempted, true);
    assert.equal(record.stages.line_transport.delivered, true);
    assert.equal(record.stages.line_transport.replyText, replies[0].body.messages[0].text, "trace must retain the exact text actually submitted to LINE");
    assert.equal(persistenceState.deleteCalls(), 0, "tracing must never clear conversation state");
    assert.ok(providers.persistence.getConversationState(PROPERTY_ID, "test-only-destination", "U-real-user-a"), "the real conversation state must remain present");

    const unrelatedBody = webhookBody("event-other", "U-unrelated", "你好");
    assert.equal((await fetch(`${running.url}/api/test-line/webhook?customerId=${PROPERTY_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": signature(unrelatedBody) },
      body: unrelatedBody
    })).status, 200);
    await waitFor(() => replies.length === 2);
    assert.equal(persistenceState.traces.size, 1, "unrelated LINE messages must not create diagnostic records");

    const serialized = JSON.stringify(record);
    for (const forbidden of ["U-real-user-a", "test-only-destination", TARGET_MESSAGE, LINE_SECRET, LINE_TOKEN, "DATABASE_URL", "Bearer "]) {
      assert.equal(serialized.includes(forbidden), false, `authenticated trace response leaked ${forbidden}`);
    }

    console.log("test-only LINE message trace HTTP: PASS");
  } finally {
    if (app) await app.stop();
    if (disabled) await disabled.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
