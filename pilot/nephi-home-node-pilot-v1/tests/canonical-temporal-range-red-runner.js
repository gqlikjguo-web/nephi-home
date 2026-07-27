"use strict";

const assert = require("node:assert/strict");

const {
  resolveCanonicalTemporal
} = require("../lib/conversation-engine-v2/temporal-resolver");

const EVENT_TIMESTAMP = Date.parse("2026-07-27T10:00:00+08:00");
const TIMEZONE = "Asia/Taipei";

const CASES = Object.freeze([
  { message: "7/28-29 有房嗎？", rawText: "7/28-29", checkIn: "2026-07-28", checkOut: "2026-07-29" },
  { message: "7/28-30 有房嗎？", rawText: "7/28-30", checkIn: "2026-07-28", checkOut: "2026-07-30" },
  { message: "7/28～30 有房嗎？", rawText: "7/28～30", checkIn: "2026-07-28", checkOut: "2026-07-30" },
  { message: "7/28到30號有房嗎？", rawText: "7/28到30號", checkIn: "2026-07-28", checkOut: "2026-07-30" },
  { message: "7月28日到30日有房嗎？", rawText: "7月28日到30日", checkIn: "2026-07-28", checkOut: "2026-07-30" }
]);

for (const testCase of CASES) {
  const actual = resolveCanonicalTemporal({
    guestMessage: testCase.message,
    plannerCandidate: {
      dateExpression: {
        rawText: testCase.rawText,
        kind: "range",
        anchor: "message_time"
      },
      checkInCandidate: null,
      checkOutCandidate: null,
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
      checkOut: actual.checkOut
    },
    {
      resolutionStatus: "resolved",
      checkIn: testCase.checkIn,
      checkOut: testCase.checkOut
    },
    `${testCase.rawText} must resolve as an explicit stay range`
  );
}

console.log("canonical temporal range RED: unexpectedly GREEN");
