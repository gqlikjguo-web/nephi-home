"use strict";

const assert = require("node:assert/strict");

const {
  resolveCanonicalTemporal
} = require("../lib/conversation-engine-v2/temporal-resolver");
const {
  buildFormalRequest,
  buildQueryPlan
} = require("../lib/conversation-engine-v2/formal-request");

const EVENT_TIMESTAMP = Date.parse("2026-07-27T10:00:00+08:00");
const TIMEZONE = "Asia/Taipei";

const CASES = Object.freeze([
  { rawText: "7/28-29", checkIn: "2026-07-28", checkOut: "2026-07-29", nights: 1 },
  { rawText: "7/28-30", checkIn: "2026-07-28", checkOut: "2026-07-30", nights: 2 },
  { rawText: "7/28～30", checkIn: "2026-07-28", checkOut: "2026-07-30", nights: 2 },
  { rawText: "7/28到30號", checkIn: "2026-07-28", checkOut: "2026-07-30", nights: 2 },
  { rawText: "7月28日到30日", checkIn: "2026-07-28", checkOut: "2026-07-30", nights: 2 },
  { rawText: "7/28-7/30", checkIn: "2026-07-28", checkOut: "2026-07-30", nights: 2 },
  { rawText: "7/28到8/2", checkIn: "2026-07-28", checkOut: "2026-08-02", nights: 5 },
  { rawText: "2026/7/28-30", checkIn: "2026-07-28", checkOut: "2026-07-30", nights: 2 },
  { rawText: "2026年7月28日到30日", checkIn: "2026-07-28", checkOut: "2026-07-30", nights: 2 },
  { rawText: "7/31-2", checkIn: "2026-07-31", checkOut: "2026-08-02", nights: 2 },
  { rawText: "12/31-2", checkIn: "2026-12-31", checkOut: "2027-01-02", nights: 2 }
]);

for (const testCase of CASES) {
  const actual = resolveCanonicalTemporal({
    guestMessage: `${testCase.rawText} 有房嗎？`,
    plannerCandidate: {
      dateExpression: {
        rawText: testCase.rawText,
        kind: "range",
        anchor: "message_time"
      },
      checkInCandidate: "2099-01-01",
      checkOutCandidate: "2099-01-02",
      nightsCandidate: null,
      guestCountCandidate: null
    },
    eventTimestamp: EVENT_TIMESTAMP,
    timezone: TIMEZONE,
    defaultNights: 1,
    applicableTaskIds: ["availability"]
  });

  assert.deepEqual(
    {
      resolutionStatus: actual.resolutionStatus,
      checkIn: actual.checkIn,
      checkOut: actual.checkOut,
      nights: actual.nights
    },
    {
      resolutionStatus: "resolved",
      checkIn: testCase.checkIn,
      checkOut: testCase.checkOut,
      nights: testCase.nights
    },
    `${testCase.rawText} must resolve as an explicit stay range`
  );
  assert.equal(actual.repairReasonCode, "planner_candidate_rejected");

  const formalRequest = buildFormalRequest({
    property: { propertyId: "range_property" },
    task: {
      taskId: "availability",
      candidateIndex: 0,
      type: "availability",
      detailIntent: "general",
      requestedOutputs: ["availability"],
      entity: { category: "other", rawText: "", canonicalCandidate: null }
    },
    requestCycleId: `range-${testCase.rawText}`,
    temporalResult: actual,
    confirmedInputs: {
      stay: {
        checkIn: "2098-12-01",
        checkOut: "2098-12-02",
        nights: 1
      }
    },
    resolvedEntity: null
  });
  assert.equal(formalRequest.readiness.status, "ready", testCase.rawText);
  assert.deepEqual(
    {
      checkIn: formalRequest.stay.checkIn,
      checkOut: formalRequest.stay.checkOut,
      nights: formalRequest.stay.nights
    },
    {
      checkIn: testCase.checkIn,
      checkOut: testCase.checkOut,
      nights: testCase.nights
    },
    `${testCase.rawText} must replace stale stay state`
  );
  const queryPlan = buildQueryPlan(formalRequest);
  assert.deepEqual(
    {
      checkIn: queryPlan.conditions.stay.checkIn,
      checkOut: queryPlan.conditions.stay.checkOut,
      nights: queryPlan.conditions.stay.nights
    },
    {
      checkIn: testCase.checkIn,
      checkOut: testCase.checkOut,
      nights: testCase.nights
    },
    `${testCase.rawText} QueryPlan must use only canonical dates`
  );
}

const MONTH_SEARCH_RANGE_CASES = Object.freeze([
  { rawText: "9月", from: "2026-09-01", to: "2026-10-01" },
  { rawText: "10月", from: "2026-10-01", to: "2026-11-01" },
  { rawText: "1月", from: "2027-01-01", to: "2027-02-01" }
]);

for (const testCase of MONTH_SEARCH_RANGE_CASES) {
  const actual = resolveCanonicalTemporal({
    guestMessage: `${testCase.rawText}有哪些日期可以住？`,
    candidateSourceText: `${testCase.rawText}有哪些日期可以住？`,
    plannerCandidate: {
      dateExpression: { rawText: testCase.rawText, kind: "none", anchor: "message_time" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    },
    eventTimestamp: Date.parse("2026-09-01T21:24:49+08:00"),
    timezone: TIMEZONE,
    defaultSearchRangeDays: 31,
    defaultSearchRangeRuleRef: "temporal:available_dates_default_lookahead",
    applicableTaskIds: ["available-dates"]
  });
  assert.deepEqual(
    {
      resolutionStatus: actual.resolutionStatus,
      checkIn: actual.checkIn,
      checkOut: actual.checkOut,
      searchRange: actual.searchRange
    },
    {
      resolutionStatus: "resolved",
      checkIn: null,
      checkOut: null,
      searchRange: { from: testCase.from, to: testCase.to }
    },
    `${testCase.rawText} must resolve to that calendar month's search range`
  );
}

const EXPLICIT_NIGHT_CASES = Object.freeze([
  { rawText: "8/18、19兩個晚上", checkIn: "2026-08-18", checkOut: "2026-08-20", nights: 2 },
  { rawText: "8/31、9/1兩晚", checkIn: "2026-08-31", checkOut: "2026-09-02", nights: 2 },
  { rawText: "8/18-8/20兩晚", checkIn: "2026-08-18", checkOut: "2026-08-20", nights: 2 },
  { rawText: "8/18入住、8/20退房兩晚", checkIn: "2026-08-18", checkOut: "2026-08-20", nights: 2 },
  { rawText: "8/18住兩晚", checkIn: "2026-08-18", checkOut: "2026-08-20", nights: 2 }
]);

for (const testCase of EXPLICIT_NIGHT_CASES) {
  const actual = resolveCanonicalTemporal({
    guestMessage: testCase.rawText,
    candidateSourceText: testCase.rawText,
    plannerCandidate: {
      dateExpression: { rawText: testCase.rawText, kind: "range", anchor: "message_time" },
      checkInCandidate: testCase.checkIn,
      checkOutCandidate: testCase.checkOut,
      nightsCandidate: testCase.nights,
      guestCountCandidate: null
    },
    eventTimestamp: EVENT_TIMESTAMP,
    timezone: TIMEZONE,
    applicableTaskIds: ["availability"]
  });
  assert.deepEqual(
    { resolutionStatus: actual.resolutionStatus, checkIn: actual.checkIn, checkOut: actual.checkOut, nights: actual.nights },
    { resolutionStatus: "resolved", checkIn: testCase.checkIn, checkOut: testCase.checkOut, nights: testCase.nights },
    `${testCase.rawText} must distinguish occupied-night lists from check-in/check-out boundaries`
  );
}

const UNRESOLVED_CASES = Object.freeze([
  { rawText: "7/30-7/28", reasonCode: "temporal_range_invalid" },
  { rawText: "7/28-29和8/1-2", reasonCode: "temporal_expression_unrecognized" },
  { rawText: "7/28到哪天", reasonCode: "temporal_range_invalid" },
  { rawText: "8/18-8/20三晚", reasonCode: "temporal_range_invalid" },
  { rawText: "8/18入住、8/20退房三晚", reasonCode: "temporal_range_invalid" }
]);

for (const testCase of UNRESOLVED_CASES) {
  const actual = resolveCanonicalTemporal({
    guestMessage: `${testCase.rawText} 有房嗎？`,
    plannerCandidate: {
      dateExpression: {
        rawText: testCase.rawText,
        kind: "range",
        anchor: "message_time"
      },
      checkInCandidate: "2099-01-01",
      checkOutCandidate: "2099-01-02",
      nightsCandidate: 1,
      guestCountCandidate: null
    },
    eventTimestamp: EVENT_TIMESTAMP,
    timezone: TIMEZONE,
    defaultNights: 1,
    applicableTaskIds: ["availability"]
  });
  assert.equal(actual.resolutionStatus, "unresolved", testCase.rawText);
  assert.equal(actual.checkIn, null, testCase.rawText);
  assert.equal(actual.checkOut, null, testCase.rawText);
  if (testCase.reasonCode) assert.equal(actual.repairReasonCode, testCase.reasonCode, testCase.rawText);
}

console.log("canonical temporal range grammar: PASS");
