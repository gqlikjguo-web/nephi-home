"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createMvpService } = require("../lib/mvp-service");
const { createProviders } = require("../lib/providers/provider-factory");

const PROPERTY_ID = "nephi_home";
const TIMEZONE = "Asia/Taipei";
const FIXED_NOW = "2026-07-17T10:00:00+08:00";
const EVENT_TIMESTAMP = Date.parse(FIXED_NOW);
const LINE_SECRET = "relative-date-test-secret";
const EMPTY_STAY = Object.freeze({
  dateExpression: { rawText: "", kind: "none", anchor: "none" },
  checkInCandidate: null,
  checkOutCandidate: null,
  nightsCandidate: null,
  guestCountCandidate: null
});

const CASES = Object.freeze([
  { id: "today", message: "今天有房嗎？", rawText: "今天", kind: "relative", expectedCheckIn: "2026-07-17" },
  { id: "tomorrow", message: "明天有房嗎？", rawText: "明天", kind: "relative", expectedCheckIn: "2026-07-18" },
  { id: "day-after-tomorrow", message: "後天有房嗎？", rawText: "後天", kind: "relative", expectedCheckIn: "2026-07-19" },
  { id: "absolute", message: "8/6 有房嗎？", rawText: "8/6", kind: "absolute", expectedCheckIn: "2026-08-06" }
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function plannerOutputFor(testCase, sourceEvent) {
  const temporalCandidate = {
    dateExpression: {
      rawText: testCase.rawText,
      kind: testCase.kind,
      anchor: "message_time"
    },
    checkInCandidate: testCase.kind === "absolute" ? testCase.expectedCheckIn : null,
    checkOutCandidate: null,
    nightsCandidate: null,
    guestCountCandidate: null
  };
  const taskStayCandidate = testCase.kind === "absolute"
    ? clone(temporalCandidate)
    : clone(EMPTY_STAY);
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: temporalCandidate,
    tasks: [{
      candidateIndex: 0,
      taskId: `availability-${testCase.id}`,
      type: "availability",
      sourceText: testCase.message,
      detailIntent: "general",
      requestedOutputs: ["availability"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: true,
      entity: {
        category: "other",
        rawText: "",
        canonicalCandidate: null,
        confidence: 0.99
      },
      stayCandidate: taskStayCandidate,
      confidence: 0.99
    }],
    contextRelationCandidates: [{
      candidateIndex: 0,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [{
        eventId: sourceEvent.eventId,
        messageRef: sourceEvent.messageRef || "",
        startOffset: 0,
        endOffset: sourceEvent.messageText.length,
        quote: sourceEvent.messageText
      }]
    }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "relative_date_production_replay"
  };
}

function seed() {
  return {
    testOnly: true,
    seedDays: 240,
    homestays: [{
      customerId: PROPERTY_ID,
      name: "尼腓的家",
      lineUrl: "https://lin.ee/test-only",
      safeFacts: {
        checkInTime: "15:00",
        checkOutTime: "11:00",
        parkingRule: "民宿旁空地可停車。",
        bbqRule: "可依正式規則使用烤肉區。"
      },
      rooms: [
        { id: "room301", name: "301 雙人房", type: "double", capacity: 2, enabled: true, mondayThursdayPrice: 1500 },
        { id: "room302", name: "302 四人房", type: "quad", capacity: 4, enabled: true, mondayThursdayPrice: 2200 },
        { id: "room401", name: "401 雙人房", type: "double", capacity: 2, enabled: true, mondayThursdayPrice: 1700 },
        { id: "room402", name: "402 四人房", type: "quad", capacity: 4, enabled: true, mondayThursdayPrice: 2600 }
      ]
    }],
    messageLogs: { [PROPERTY_ID]: [] }
  };
}

function waitForResult(results, eventId, timeoutMs = 3000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (results.has(eventId)) return resolve(results.get(eventId));
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error(`engine result timeout: ${eventId}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function runCase(testCase) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `relative-date-${testCase.id}-`));
  const seedFile = path.join(temp, "seed.json");
  const dataFile = path.join(temp, "data.json");
  fs.writeFileSync(seedFile, JSON.stringify(seed()));
  const now = () => new Date(FIXED_NOW);
  const providers = createProviders({ dataFile, seedFile, now });
  const service = createMvpService(providers, { now });
  const diagnostics = [];
  const availabilityCalls = [];
  const lineCalls = [];
  const engineResults = new Map();
  let plannerCandidate = null;
  const planner = {
    classify: async ({ sourceEvents }) => {
      plannerCandidate = plannerOutputFor(testCase, sourceEvents[0]);
      return clone(plannerCandidate);
    }
  };
  const property = {
    ...providers.customerSettings.getProperty(PROPERTY_ID),
    timezone: TIMEZONE
  };
  const app = createApp({
    providers,
    now,
    lineChannelSecret: LINE_SECRET,
    lineChannelAccessToken: "test-only-token",
    lineChannelIdentityGuardRequired: false,
    conversationDebounceMs: 1,
    testOnlyOverrides: {
      planner,
      getProperty: () => property,
      availabilityResolver: (query) => {
        availabilityCalls.push(clone(query));
        return service.searchAvailability(query);
      },
      onDiagnostic: (entry) => diagnostics.push(clone(entry))
    },
    lineReplyClientFactory: () => ({
      replyMessageWithHttpInfo: async (body) => {
        lineCalls.push(clone(body));
        return { httpResponse: { status: 200 } };
      }
    })
  });
  app.conversationEngineV2.diagnosticDetail = true;
  const processEngine = app.conversationEngineV2.process.bind(app.conversationEngineV2);
  app.conversationEngineV2.process = async (input) => {
    const stateBefore = providers.persistence.getConversationState(
      input.customerId,
      input.channelId,
      input.lineUserId
    );
    const result = await processEngine(input);
    engineResults.set(input.eventId, { result: clone(result), stateBefore: clone(stateBefore) });
    return result;
  };
  const running = await app.start(0, "127.0.0.1");
  try {
    const eventId = `relative-date-${testCase.id}`;
    const event = {
      type: "message",
      webhookEventId: eventId,
      replyToken: `reply-${testCase.id}`,
      timestamp: EVENT_TIMESTAMP,
      source: { userId: `fresh-${testCase.id}` },
      message: { type: "text", id: `message-${testCase.id}`, text: testCase.message }
    };
    const raw = JSON.stringify({ destination: "relative-date-line", events: [event] });
    const signature = crypto.createHmac("sha256", LINE_SECRET).update(raw).digest("base64");
    const response = await fetch(
      `${running.url}/api/test-line/webhook?customerId=${PROPERTY_ID}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-line-signature": signature
        },
        body: raw
      }
    );
    assert.equal(response.status, 200);
    const completed = await waitForResult(engineResults, eventId);
    const stage = (name) => diagnostics.filter((entry) => entry.stage === name).at(-1) || null;
    return {
      id: testCase.id,
      message: testCase.message,
      expectedCheckIn: testCase.expectedCheckIn,
      plannerTemporalCandidate: {
        topLevel: clone(plannerCandidate.stay),
        task: clone(plannerCandidate.tasks[0].stayCandidate)
      },
      temporal: stage("temporal"),
      stateBefore: completed.stateBefore,
      stateAfter: completed.result.state || null,
      formalRequest: stage("formal_request"),
      queryPlan: stage("query_plan"),
      queryDateRanges: availabilityCalls.map((call) => ({
        checkIn: call.checkIn,
        checkOut: call.checkOut
      })),
      executor: stage("executor"),
      finalDecision: completed.result.finalDecision,
      lineCallCount: lineCalls.length
    };
  } finally {
    await app.stop();
    if (typeof providers.close === "function") await providers.close();
  }
}

function traceSummary(trace) {
  const stateCycle = trace.stateAfter && trace.stateAfter.requestCycles && trace.stateAfter.requestCycles[0];
  return {
    id: trace.id,
    message: trace.message,
    plannerTemporalCandidate: trace.plannerTemporalCandidate,
    temporal: {
      resolutionStatus: trace.temporal.items[0].resolutionStatus,
      checkIn: trace.temporal.items[0].fields.checkIn.value,
      checkOut: trace.temporal.items[0].fields.checkOut.value
    },
    stateBefore: trace.stateBefore,
    stateAfter: stateCycle && {
      stay: stateCycle.confirmedInputs.stay,
      temporalResolutionStatus: stateCycle.temporalResult.resolutionStatus
    },
    formalRequestReadiness: trace.formalRequest.items[0].readiness,
    queryDateRanges: trace.queryDateRanges,
    executorOutcomes: trace.executor.results.map((result) => ({
      taskId: result.taskId,
      status: result.status
    })),
    finalDecision: {
      action: trace.finalDecision.action,
      reasonCode: trace.finalDecision.reasonCode
    }
  };
}

(async () => {
  const traces = [];
  for (const testCase of CASES) traces.push(await runCase(testCase));
  console.log(JSON.stringify({
    suite: "relative-date-availability",
    traces: traces.map(traceSummary)
  }, null, 2));

  for (const trace of traces) {
    assert.equal(trace.stateBefore, null, `${trace.message}: conversation must start fresh`);
    assert.equal(
      trace.temporal.items[0].resolutionStatus,
      "resolved",
      `${trace.message}: temporal candidate must resolve before state merge`
    );
    assert.equal(
      trace.temporal.items[0].fields.checkIn.value,
      trace.expectedCheckIn,
      `${trace.message}: canonical check-in must use the fixed Asia/Taipei clock`
    );
    assert.deepEqual(
      trace.queryDateRanges,
      [{ checkIn: trace.expectedCheckIn, checkOut: new Date(Date.parse(`${trace.expectedCheckIn}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) }],
      `${trace.message}: QueryPlan must reach the real availability service with a one-night range`
    );
    assert.equal(trace.formalRequest.items[0].readiness, "ready", `${trace.message}: FormalRequest must be ready`);
    assert.ok(trace.executor.results[0], `${trace.message}: Executor must produce a task result`);
    assert.equal(trace.finalDecision.action, "reply", `${trace.message}: FinalDecision must reply`);
    assert.equal(trace.lineCallCount, 1, `${trace.message}: signed webhook must reach the existing LINE mock once`);
  }
  console.log("relative date availability: PASS (today/tomorrow/day-after/absolute)");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
