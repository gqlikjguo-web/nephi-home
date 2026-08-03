"use strict";

const assert = require("node:assert/strict");

const {
  resolveCanonicalTemporal
} = require("../lib/conversation-engine-v2/temporal-resolver");
const { buildFormalRequest, buildQueryPlan } = require("../lib/conversation-engine-v2/formal-request");
const { reduceConversationState } = require("../lib/conversation-engine-v2/state-reducer");

const EVENT_TIMESTAMP = Date.parse("2026-07-27T10:00:00+08:00");
const TIMEZONE = "Asia/Taipei";

function candidate(rawText, kind, checkInCandidate = null, checkOutCandidate = null, nightsCandidate = null) {
  return {
    dateExpression: { rawText, kind, anchor: "message_time" },
    checkInCandidate,
    checkOutCandidate,
    nightsCandidate,
    guestCountCandidate: null
  };
}

function resolve(rawText, plannerCandidate, options = {}) {
  return resolveCanonicalTemporal({
    guestMessage: options.guestMessage || `${rawText}有房嗎？`,
    plannerCandidate,
    eventTimestamp: EVENT_TIMESTAMP,
    timezone: TIMEZONE,
    defaultNights: options.defaultNights === undefined ? 1 : options.defaultNights,
    applicableTaskIds: options.applicableTaskIds || ["availability"],
    approvedContext: options.approvedContext || null,
    allowContextReuse: options.allowContextReuse === true
  });
}

function assertResolved(result, expected) {
  assert.equal(result.resolutionStatus, "resolved");
  assert.equal(result.rawText, expected.rawText);
  assert.equal(result.expressionType, expected.expressionType);
  assert.equal(result.checkIn, expected.checkIn);
  assert.equal(result.checkOut, expected.checkOut);
  if (Object.prototype.hasOwnProperty.call(expected, "nights")) assert.equal(result.nights, expected.nights);
  assert.equal(result.timezone, TIMEZONE);
  assert.equal(result.resolutionSource, expected.resolutionSource || "canonical_temporal_grammar");
  assert.equal(result.repairReasonCode, expected.repairReasonCode || "");
  assert.deepEqual(result.applicableTaskIds, ["availability"]);
}

const repairedCases = [
  {
    name: "tonight",
    rawText: "今晚",
    planner: candidate("今晚", "relative", "2024-06-25"),
    expected: { expressionType: "relative_day", checkIn: "2026-07-27", checkOut: "2026-07-28", repairReasonCode: "planner_candidate_rejected" }
  },
  {
    name: "today",
    rawText: "今天",
    planner: candidate("今天", "absolute", "2024-06-25"),
    expected: { expressionType: "relative_day", checkIn: "2026-07-27", checkOut: "2026-07-28", repairReasonCode: "planner_kind_repaired" }
  },
  {
    name: "tomorrow",
    rawText: "明天",
    planner: candidate("明天", "absolute", "2024-06-25"),
    expected: { expressionType: "relative_day", checkIn: "2026-07-28", checkOut: "2026-07-29", repairReasonCode: "planner_kind_repaired" }
  },
  {
    name: "day after tomorrow",
    rawText: "後天",
    planner: candidate("後天", "absolute", "2026-07-26"),
    expected: { expressionType: "relative_day", checkIn: "2026-07-29", checkOut: "2026-07-30", repairReasonCode: "planner_kind_repaired" }
  },
  {
    name: "this Saturday",
    rawText: "這星期六",
    planner: candidate("這星期六", "absolute", "2026-08-08"),
    expected: { expressionType: "relative_weekday", checkIn: "2026-08-01", checkOut: "2026-08-02", repairReasonCode: "planner_kind_repaired" }
  },
  {
    name: "next Thursday",
    rawText: "下禮拜四",
    planner: candidate("下禮拜四", "weekday", "2026-07-30"),
    expected: { expressionType: "relative_weekday", checkIn: "2026-08-06", checkOut: "2026-08-07", repairReasonCode: "planner_candidate_rejected" }
  },
  {
    name: "three days later",
    rawText: "三天後",
    planner: candidate("三天後", "absolute", "2024-06-25"),
    expected: { expressionType: "relative_day", checkIn: "2026-07-30", checkOut: "2026-07-31", repairReasonCode: "planner_kind_repaired" }
  },
  {
    name: "next weekend",
    rawText: "下週末",
    planner: candidate("下週末", "absolute", "2026-08-15", "2026-08-17"),
    expected: { expressionType: "weekend", checkIn: "2026-08-08", checkOut: "2026-08-09", repairReasonCode: "planner_kind_repaired" }
  }
];

for (const testCase of repairedCases) {
  assertResolved(resolve(testCase.rawText, testCase.planner), {
    rawText: testCase.rawText,
    ...testCase.expected
  });
}

assertResolved(resolve("8/6", candidate("8/6", "absolute", "2026-08-06")), {
  rawText: "8/6",
  expressionType: "absolute_date",
  checkIn: "2026-08-06",
  checkOut: "2026-08-07"
});

assertResolved(resolve("8/6", candidate("8/6", "absolute", "2056-08-06")), {
  rawText: "8/6",
  expressionType: "absolute_date",
  checkIn: "2026-08-06",
  checkOut: "2026-08-07",
  repairReasonCode: "planner_candidate_rejected"
});

assertResolved(resolve("8/6住一晚", candidate("8/6住一晚", "range", "2056-08-06", null, 9)), {
  rawText: "8/6住一晚",
  expressionType: "date_range",
  checkIn: "2026-08-06",
  checkOut: "2026-08-07",
  repairReasonCode: "planner_candidate_rejected"
});

for (const testCase of [
  { rawText: "8/6住兩晚", guestMessage: "8/6 住兩晚" },
  { rawText: "8/6入住兩晚", guestMessage: "8/6 入住兩晚，401 雙人房總房價多少？" }
]) {
  assertResolved(resolve(
    testCase.rawText,
    candidate(testCase.rawText, "range", "2026-08-06", "2026-08-08", 2),
    { guestMessage: testCase.guestMessage }
  ), {
    rawText: testCase.rawText,
    expressionType: "date_range",
    checkIn: "2026-08-06",
    checkOut: "2026-08-08",
    nights: 2
  });
}

assertResolved(resolve("8/6到8/8", candidate("8/6到8/8", "absolute", "2056-08-06", "2056-08-08")), {
  rawText: "8/6到8/8",
  expressionType: "date_range",
  checkIn: "2026-08-06",
  checkOut: "2026-08-08",
  repairReasonCode: "planner_kind_repaired"
});

assertResolved(resolve("下週四住兩晚", candidate("下週四住兩晚", "absolute", "2024-06-25", null, 9)), {
  rawText: "下週四住兩晚",
  expressionType: "date_range",
  checkIn: "2026-08-06",
  checkOut: "2026-08-08",
  repairReasonCode: "planner_kind_repaired"
});

assertResolved(resolve("這星期六入住、星期日退房", candidate("這星期六入住、星期日退房", "absolute", "2024-06-25", "2024-06-26")), {
  rawText: "這星期六入住、星期日退房",
  expressionType: "date_range",
  checkIn: "2026-08-01",
  checkOut: "2026-08-02",
  repairReasonCode: "planner_kind_repaired"
});

const ambiguous = resolve("下次有空的週末", candidate("下次有空的週末", "weekend", "2026-08-08"));
assert.equal(ambiguous.resolutionStatus, "unresolved");
assert.equal(ambiguous.rawText, "下次有空的週末");
assert.equal(ambiguous.expressionType, "ambiguous");
assert.equal(ambiguous.checkIn, null);
assert.equal(ambiguous.checkOut, null);
assert.equal(ambiguous.resolutionSource, "canonical_temporal_grammar");
assert.equal(ambiguous.repairReasonCode, "temporal_expression_ambiguous");

const past = resolveCanonicalTemporal({
  guestMessage: "7/26 有房嗎？",
  plannerCandidate: candidate("7/26", "absolute", "2026-07-26"),
  eventTimestamp: EVENT_TIMESTAMP,
  timezone: TIMEZONE,
  defaultNights: 1,
  applicableTaskIds: ["availability"]
});
assert.equal(past.resolutionStatus, "unresolved");
assert.equal(past.checkIn, null);
assert.equal(past.repairReasonCode, "past_date");

const staleConfirmedInputs = {
  stay: {
    checkIn: "2026-08-06",
    checkOut: "2026-08-07",
    nights: 1,
    guests: 2,
    searchRange: null
  },
  inventory: { mode: "any", entityId: null, features: [] },
  topic: {
    capabilityType: "availability",
    canonicalId: null,
    category: "other",
    detailIntent: "general",
    detailFields: []
  }
};
const formalAfterUnresolved = buildFormalRequest({
  property: { propertyId: "nephi_home" },
  task: {
    taskId: "availability-stale",
    candidateIndex: 0,
    type: "availability",
    requestedOutputs: ["availability"],
    entity: { category: "other", rawText: "", canonicalCandidate: null }
  },
  requestCycleId: "cycle-stale",
  temporalResult: ambiguous,
  confirmedInputs: staleConfirmedInputs,
  resolvedEntity: null
});
assert.equal(formalAfterUnresolved.stay.checkIn, null, "FormalRequest must not fall back to stale confirmed check-in");
assert.equal(formalAfterUnresolved.stay.checkOut, null, "FormalRequest must not fall back to stale confirmed check-out");
assert.equal(formalAfterUnresolved.readiness.status, "missing_information");

const staleState = {
  schemaVersion: 2,
  scope: { propertyId: "nephi_home", channelId: "test-line", lineUserId: "stale-user" },
  requestCycles: [{
    requestCycleId: "cycle-stale",
    requestKind: "availability",
    status: "active",
    confirmedInputs: staleConfirmedInputs,
    temporalResult: {
      resolutionStatus: "resolved",
      checkIn: "2026-08-06",
      checkOut: "2026-08-07",
      nights: 1
    },
    sourceEvidenceRefs: [],
    contextReuseExpiresAt: "2026-07-28T02:00:00.000Z",
    createdAt: "2026-07-27T02:00:00.000Z",
    updatedAt: "2026-07-27T02:00:00.000Z"
  }],
  pendingRequests: [],
  transition: { set: [], replaced: [], cleared: [], kept: [], sourceEventId: "" },
  updatedAt: "2026-07-27T02:00:00.000Z"
};

const completeGrammarCases = [
  { name: "big day after tomorrow", rawText: "大後天", kind: "relative", checkIn: "2026-07-30", checkOut: "2026-07-31" },
  { name: "five days later", rawText: "五天後", kind: "relative", checkIn: "2026-08-01", checkOut: "2026-08-02" },
  { name: "one week later", rawText: "一週後", kind: "relative", checkIn: "2026-08-03", checkOut: "2026-08-04" },
  { name: "two weeks later", rawText: "兩週後", kind: "relative", checkIn: "2026-08-10", checkOut: "2026-08-11" },
  { name: "Thursday two weeks out", rawText: "下下週四", kind: "weekday", checkIn: "2026-08-13", checkOut: "2026-08-14" },
  { name: "this weekend", rawText: "這週末", kind: "weekend", checkIn: "2026-08-01", checkOut: "2026-08-02" },
  { name: "month-name absolute date", rawText: "8月6日", kind: "absolute", checkIn: "2026-08-06", checkOut: "2026-08-07" },
  { name: "full absolute date", rawText: "2026年8月6日", kind: "absolute", checkIn: "2026-08-06", checkOut: "2026-08-07" }
];

for (const testCase of completeGrammarCases) {
  const wrongPlannerCheckIn = "2030-01-01";
  const wrongPlannerCheckOut = "2030-01-02";
  const temporalResult = resolve(
    testCase.rawText,
    candidate(testCase.rawText, testCase.kind, wrongPlannerCheckIn, wrongPlannerCheckOut)
  );
  assert.equal(temporalResult.resolutionStatus, "resolved", `${testCase.name}: canonical temporal must resolve`);
  assert.equal(temporalResult.checkIn, testCase.checkIn, `${testCase.name}: canonical check-in`);
  assert.equal(temporalResult.checkOut, testCase.checkOut, `${testCase.name}: canonical check-out`);
  assert.equal(temporalResult.repairReasonCode, "planner_candidate_rejected", `${testCase.name}: wrong Planner dates must be rejected`);
  assert.notEqual(temporalResult.checkIn, wrongPlannerCheckIn, `${testCase.name}: Planner check-in cannot become canonical`);
  assert.notEqual(temporalResult.checkOut, wrongPlannerCheckOut, `${testCase.name}: Planner check-out cannot become canonical`);

  const task = {
    taskId: `grammar-${testCase.name.replace(/\s+/g, "-")}`,
    candidateIndex: 0,
    type: "availability",
    detailIntent: "general",
    requestedOutputs: ["availability"],
    entity: { category: "other", rawText: "", canonicalCandidate: null }
  };
  const staleStateForCase = JSON.parse(JSON.stringify(staleState));
  staleStateForCase.requestCycles[0].confirmedInputs.stay.checkIn = "2026-09-20";
  staleStateForCase.requestCycles[0].confirmedInputs.stay.checkOut = "2026-09-21";
  const stateAfterResolved = reduceConversationState(staleStateForCase, {
    tasks: [task],
    contextDecisions: [{
      candidateIndex: 0,
      action: "continue",
      requestCycleId: "cycle-stale",
      referencedRequestCycleId: "cycle-stale"
    }],
    candidateInputsByCandidateIndex: {
      0: {
        confirmedFields: {},
        temporalResult,
        hasNewDateExpression: true,
        sourceEvidenceRefs: []
      }
    }
  }, {
    propertyId: "nephi_home",
    channelId: "test-line",
    lineUserId: "stale-user",
    eventId: `event-${testCase.name.replace(/\s+/g, "-")}`,
    now: "2026-07-27T03:00:00.000Z"
  });
  const resolvedCycle = stateAfterResolved.requestCycles[0];
  assert.equal(resolvedCycle.confirmedInputs.stay.checkIn, testCase.checkIn, `${testCase.name}: State must replace stale check-in`);
  assert.equal(resolvedCycle.confirmedInputs.stay.checkOut, testCase.checkOut, `${testCase.name}: State must replace stale check-out`);
  assert.notEqual(resolvedCycle.confirmedInputs.stay.checkIn, staleStateForCase.requestCycles[0].confirmedInputs.stay.checkIn, `${testCase.name}: State must not retain stale check-in`);

  const formalRequest = buildFormalRequest({
    property: { propertyId: "nephi_home" },
    task,
    requestCycleId: "cycle-stale",
    temporalResult,
    confirmedInputs: resolvedCycle.confirmedInputs,
    resolvedEntity: null
  });
  assert.equal(formalRequest.readiness.status, "ready", `${testCase.name}: FormalRequest must be ready`);
  assert.deepEqual(
    { checkIn: formalRequest.stay.checkIn, checkOut: formalRequest.stay.checkOut },
    { checkIn: testCase.checkIn, checkOut: testCase.checkOut },
    `${testCase.name}: FormalRequest must use canonical dates`
  );

  const queryPlan = buildQueryPlan(formalRequest);
  assert.ok(queryPlan, `${testCase.name}: ready FormalRequest must create a QueryPlan`);
  assert.deepEqual(
    { checkIn: queryPlan.conditions.stay.checkIn, checkOut: queryPlan.conditions.stay.checkOut },
    { checkIn: testCase.checkIn, checkOut: testCase.checkOut },
    `${testCase.name}: QueryPlan must preserve the canonical date range`
  );
}

const stateAfterUnresolved = reduceConversationState(staleState, {
  tasks: [{
    candidateIndex: 0,
    type: "availability",
    detailIntent: "general",
    requestedOutputs: ["availability"],
    entity: { category: "other", canonicalCandidate: null }
  }],
  contextDecisions: [{
    candidateIndex: 0,
    action: "continue",
    requestCycleId: "cycle-stale",
    referencedRequestCycleId: "cycle-stale"
  }],
  candidateInputsByCandidateIndex: {
    0: {
      confirmedFields: {},
      temporalResult: ambiguous,
      hasNewDateExpression: true,
      sourceEvidenceRefs: []
    }
  }
}, {
  propertyId: "nephi_home",
  channelId: "test-line",
  lineUserId: "stale-user",
  eventId: "event-unresolved",
  now: "2026-07-27T03:00:00.000Z"
});
const clearedCycle = stateAfterUnresolved.requestCycles[0];
assert.equal(clearedCycle.confirmedInputs.stay.checkIn, null, "unresolved current date intent must clear stale check-in");
assert.equal(clearedCycle.confirmedInputs.stay.checkOut, null, "unresolved current date intent must clear stale check-out");
assert.equal(clearedCycle.temporalResult.resolutionStatus, "unresolved", "state must persist the current canonical temporal result");
assert.equal(clearedCycle.contextReuseExpiresAt, "2026-07-27T03:00:00.000Z", "unresolved current date intent must expire stale temporal reuse");

const absent = resolveCanonicalTemporal({
  guestMessage: "有房嗎？",
  plannerCandidate: candidate("", "none"),
  eventTimestamp: EVENT_TIMESTAMP,
  timezone: TIMEZONE,
  applicableTaskIds: ["availability"]
});
assert.equal(absent.resolutionStatus, "absent");
assert.equal(absent.checkIn, null);
assert.equal(absent.checkOut, null);

const reused = resolveCanonicalTemporal({
  guestMessage: "那雙人房呢？",
  plannerCandidate: candidate("", "none"),
  eventTimestamp: EVENT_TIMESTAMP,
  timezone: TIMEZONE,
  defaultNights: 1,
  applicableTaskIds: ["availability"],
  allowContextReuse: true,
  approvedContext: {
    checkIn: "2026-08-06",
    checkOut: "2026-08-07",
    nights: 1,
    sourceEvidenceRefs: []
  }
});
assert.equal(reused.resolutionStatus, "resolved");
assert.equal(reused.resolutionSource, "approved_context");
assert.equal(reused.checkIn, "2026-08-06");
assert.equal(reused.checkOut, "2026-08-07");

for (const result of [
  ...repairedCases.map((testCase) => resolve(testCase.rawText, testCase.planner)),
  ambiguous,
  absent,
  reused
]) {
  assert.ok(["absent", "resolved", "unresolved"].includes(result.resolutionStatus));
}

console.log("canonical temporal authority: PASS");
