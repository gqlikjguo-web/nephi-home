"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createMvpService } = require("../lib/mvp-service");
const { createProviders } = require("../lib/providers/provider-factory");

const PROPERTY_ID = "golden_property_alpha";
const TIMEZONE = "Asia/Taipei";
const FIXED_NOW = "2026-07-27T10:00:00+08:00";
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
  { id: "today", message: "今天有房嗎？", availabilityText: "今天有房嗎？", rawText: "今天", kind: "absolute", expectedCheckIn: "2026-07-27", expectedCheckOut: "2026-07-28", extras: [] },
  { id: "tomorrow", message: "明天有房嗎？", availabilityText: "明天有房嗎？", rawText: "明天", kind: "absolute", expectedCheckIn: "2026-07-28", expectedCheckOut: "2026-07-29", extras: [] },
  { id: "day-after-tomorrow", message: "後天有房嗎？", availabilityText: "後天有房嗎？", rawText: "後天", kind: "absolute", expectedCheckIn: "2026-07-29", expectedCheckOut: "2026-07-30", extras: [] },
  { id: "big-day-after-tomorrow", message: "大後天有房嗎？", availabilityText: "大後天有房嗎？", rawText: "大後天", kind: "relative", expectedCheckIn: "2026-07-30", expectedCheckOut: "2026-07-31", extras: [] },
  { id: "three-days-later", message: "三天後有房嗎？", availabilityText: "三天後有房嗎？", rawText: "三天後", kind: "relative", expectedCheckIn: "2026-07-30", expectedCheckOut: "2026-07-31", extras: [] },
  { id: "five-days-later", message: "五天後有房嗎？", availabilityText: "五天後有房嗎？", rawText: "五天後", kind: "relative", expectedCheckIn: "2026-08-01", expectedCheckOut: "2026-08-02", extras: [] },
  { id: "one-week-later", message: "一週後有房嗎？", availabilityText: "一週後有房嗎？", rawText: "一週後", kind: "relative", expectedCheckIn: "2026-08-03", expectedCheckOut: "2026-08-04", extras: [] },
  { id: "two-weeks-later", message: "兩週後有房嗎？", availabilityText: "兩週後有房嗎？", rawText: "兩週後", kind: "relative", expectedCheckIn: "2026-08-10", expectedCheckOut: "2026-08-11", extras: [] },
  { id: "this-saturday", message: "這星期六有房嗎？", availabilityText: "這星期六有房嗎？", rawText: "這星期六", kind: "weekday", expectedCheckIn: "2026-08-01", expectedCheckOut: "2026-08-02", extras: [] },
  { id: "next-wednesday", message: "下禮拜三有房嗎？", availabilityText: "下禮拜三有房嗎？", rawText: "下禮拜三", kind: "weekday", expectedCheckIn: "2026-08-05", expectedCheckOut: "2026-08-06", extras: [] },
  { id: "next-thursday", message: "下禮拜四有房嗎？", availabilityText: "下禮拜四有房嗎？", rawText: "下禮拜四", kind: "weekday", expectedCheckIn: "2026-08-06", expectedCheckOut: "2026-08-07", extras: [] },
  { id: "following-thursday", message: "下下週四有房嗎？", availabilityText: "下下週四有房嗎？", rawText: "下下週四", kind: "weekday", expectedCheckIn: "2026-08-13", expectedCheckOut: "2026-08-14", extras: [] },
  { id: "this-weekend", message: "這週末有房嗎？", availabilityText: "這週末有房嗎？", rawText: "這週末", kind: "weekend", expectedCheckIn: "2026-08-01", expectedCheckOut: "2026-08-02", extras: [] },
  { id: "next-weekend", message: "下週末有房嗎？", availabilityText: "下週末有房嗎？", rawText: "下週末", kind: "weekend", expectedCheckIn: "2026-08-08", expectedCheckOut: "2026-08-09", extras: [] },
  { id: "near-absolute", message: "7/28 有房嗎？", availabilityText: "7/28 有房嗎？", rawText: "7/28", kind: "absolute", expectedCheckIn: "2026-07-28", expectedCheckOut: "2026-07-29", extras: [] },
  { id: "absolute", message: "8/6 有房嗎？", availabilityText: "8/6 有房嗎？", rawText: "8/6", kind: "absolute", expectedCheckIn: "2026-08-06", expectedCheckOut: "2026-08-07", extras: [] },
  { id: "month-name-absolute", message: "8月6日有房嗎？", availabilityText: "8月6日有房嗎？", rawText: "8月6日", kind: "absolute", expectedCheckIn: "2026-08-06", expectedCheckOut: "2026-08-07", extras: [] },
  { id: "full-absolute", message: "2026年8月6日有房嗎？", availabilityText: "2026年8月6日有房嗎？", rawText: "2026年8月6日", kind: "absolute", expectedCheckIn: "2026-08-06", expectedCheckOut: "2026-08-07", extras: [] },
  { id: "two-nights", message: "下週四住兩晚有房嗎？", availabilityText: "下週四住兩晚有房嗎？", rawText: "下週四住兩晚", kind: "range", expectedCheckIn: "2026-08-06", expectedCheckOut: "2026-08-08", extras: [] },
  { id: "explicit-checkout", message: "這星期六入住、星期日退房", availabilityText: "這星期六入住、星期日退房", rawText: "這星期六入住、星期日退房", kind: "range", expectedCheckIn: "2026-08-01", expectedCheckOut: "2026-08-02", extras: [] },
  { id: "today-parking", message: "今天有房嗎？有車位嗎？", availabilityText: "今天有房嗎？", rawText: "今天", kind: "absolute", expectedCheckIn: "2026-07-27", expectedCheckOut: "2026-07-28", extras: ["parking"] },
  { id: "next-thursday-bbq", message: "下禮拜四有房嗎？可以烤肉嗎？", availabilityText: "下禮拜四有房嗎？", rawText: "下禮拜四", kind: "absolute", expectedCheckIn: "2026-08-06", expectedCheckOut: "2026-08-07", extras: ["bbq"] },
  { id: "this-saturday-pool", message: "這星期六有雙人房嗎？有戲水池嗎？", availabilityText: "這星期六有雙人房嗎？", rawText: "這星期六", kind: "absolute", expectedCheckIn: "2026-08-01", expectedCheckOut: "2026-08-02", extras: ["pool"] },
  { id: "absolute-mixed", message: "8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？", availabilityText: "8/6 有雙人房嗎？", rawText: "8/6", kind: "absolute", expectedCheckIn: "2026-08-06", expectedCheckOut: "2026-08-07", extras: ["parking", "bbq"] },
  { id: "planner-omits-day-after-tomorrow-span", message: "後天有房嗎？", availabilityText: "後天有房嗎？", rawText: "", kind: "none", expectedCheckIn: "2026-07-29", expectedCheckOut: "2026-07-30", extras: [] },
  { id: "planner-misroutes-explicit-weekend", message: "下週末有房嗎？", availabilityText: "下週末有房嗎？", rawText: "下週末", kind: "weekend", expectedCheckIn: "2026-08-08", expectedCheckOut: "2026-08-09", extras: [], plannerTaskType: "available_dates" }
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
    checkInCandidate: "2030-01-01",
    checkOutCandidate: null,
    nightsCandidate: null,
    guestCountCandidate: null
  };
  const taskStayCandidate = clone(temporalCandidate);
  const factDefinitions = {
    parking: { type: "amenity", sourceText: "有車位嗎？", requestedOutputs: ["amenity"], category: "amenity", rawText: "車位" },
    bbq: { type: "policy", sourceText: "可以烤肉嗎？", requestedOutputs: ["policy"], category: "policy", rawText: "烤肉" },
    pool: { type: "amenity", sourceText: "有戲水池嗎？", requestedOutputs: ["amenity"], category: "amenity", rawText: "戲水池" }
  };
  const tasks = [{
    candidateIndex: 0,
    taskId: `availability-${testCase.id}`,
    type: testCase.plannerTaskType || "availability",
    sourceText: testCase.availabilityText,
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
  }, ...testCase.extras.map((fact, index) => {
    const definition = factDefinitions[fact];
    return {
      candidateIndex: index + 1,
      taskId: `${fact}-${testCase.id}`,
      type: definition.type,
      sourceText: definition.sourceText,
      detailIntent: "general",
      requestedOutputs: definition.requestedOutputs,
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: {
        category: definition.category,
        rawText: definition.rawText,
        canonicalCandidate: fact,
        confidence: 0.99
      },
      stayCandidate: null,
      confidence: 0.99
    };
  })];
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 0.99 },
    stateOperations: [],
    stay: temporalCandidate,
    tasks,
    contextRelationCandidates: tasks.map((task) => ({
      candidateIndex: task.candidateIndex,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [{
        eventId: sourceEvent.eventId,
        messageRef: sourceEvent.messageRef || "",
        startOffset: 0,
        endOffset: sourceEvent.messageText.length,
        quote: sourceEvent.messageText
      }]
    })),
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
      name: "Golden Property Alpha",
      lineUrl: "https://lin.ee/test-only",
      safeFacts: {
        checkInTime: "15:00",
        checkOutTime: "11:00",
        parkingRule: "民宿旁空地可停車。",
        bbqRule: "可依正式規則使用烤肉區。"
      },
      faqs: [{
        knowledgeKey: "pool",
        question: "戲水池",
        answer: "設有戲水池，請依現場安全規範使用。"
      }],
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
      expectedCheckOut: testCase.expectedCheckOut,
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
      composer: stage("composer"),
      taskResults: clone(completed.result.taskResults),
      claimValidation: clone(completed.result.claimValidation),
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
      status: result.status,
      factSource: result.facts && result.facts.source || ""
    })),
    composerValidation: trace.composer && trace.composer.validationResult,
    claimValidation: {
      ok: trace.claimValidation.ok,
      errors: trace.claimValidation.errors
    },
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
      [{ checkIn: trace.expectedCheckIn, checkOut: trace.expectedCheckOut }],
      `${trace.message}: QueryPlan must reach the real availability service with the canonical range`
    );
    assert.equal(trace.formalRequest.items[0].readiness, "ready", `${trace.message}: FormalRequest must be ready`);
    assert.ok(trace.executor.results[0], `${trace.message}: Executor must produce a task result`);
    assert.ok(trace.taskResults.every((item) => item.status === "answered"), `${trace.message}: every task must be independently answered`);
    for (const fact of CASES.find((item) => item.id === trace.id).extras) {
      assert.equal(
        trace.taskResults.find((item) => item.taskId.startsWith(`${fact}-`)).facts.source,
        "property_catalog",
        `${trace.message}: ${fact} must use the property catalog`
      );
    }
    assert.equal(trace.composer.validationResult, "accepted", `${trace.message}: Composer must accept the grounded sections`);
    assert.equal(trace.claimValidation.ok, true, `${trace.message}: Claim Validator must pass`);
    assert.deepEqual(trace.claimValidation.errors, [], `${trace.message}: Claim Validator errors must be empty`);
    assert.equal(trace.finalDecision.action, "reply", `${trace.message}: FinalDecision must reply`);
    assert.equal(trace.lineCallCount, 1, `${trace.message}: signed webhook must reach the existing LINE mock once`);
  }
  console.log("relative date availability: PASS (relative/weekday/absolute + mixed property facts)");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
