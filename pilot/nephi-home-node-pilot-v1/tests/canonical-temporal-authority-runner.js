"use strict";

const assert = require("node:assert/strict");

const {
  resolveCanonicalTemporal
} = require("../lib/conversation-engine-v2/temporal-resolver");
const { buildFormalRequest } = require("../lib/conversation-engine-v2/formal-request");
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
