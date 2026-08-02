"use strict";

const assert = require("node:assert/strict");
const { recentDateKeys, monthsForDateKeys, availabilityRangeForSelection, availabilityLoadPlan } = require("../public/assets/admin-availability-window");

const dates = recentDateKeys("2026-07-30", 15);
assert.equal(dates.length, 15);
assert.equal(dates[0], "2026-07-30");
assert.equal(dates[14], "2026-08-13");
assert.deepEqual(monthsForDateKeys(dates), ["2026-07", "2026-08"]);
assert.deepEqual(recentDateKeys("2026-12-25", 15).slice(-1), ["2027-01-08"]);
assert.deepEqual(availabilityRangeForSelection("2026-08-18", "rolling"), { startDate: "2026-08-18", endDate: "2026-09-16", dateKeys: recentDateKeys("2026-08-18", 30) });
assert.deepEqual(availabilityRangeForSelection("2026-08-18", "2026-08"), { startDate: "2026-08-18", endDate: "2026-08-31", dateKeys: recentDateKeys("2026-08-18", 14) });
assert.deepEqual(availabilityRangeForSelection("2026-08-18", "2026-09"), { startDate: "2026-09-01", endDate: "2026-09-30", dateKeys: recentDateKeys("2026-09-01", 30) });
assert.deepEqual(availabilityLoadPlan("2026-08-18", "rolling"), {
  selection: "rolling",
  months: ["2026-08", "2026-09"],
  dateKeys: recentDateKeys("2026-08-18", 30)
});
assert.deepEqual(availabilityLoadPlan("2026-08-18", "2026-08"), {
  selection: "2026-08",
  months: ["2026-08"],
  dateKeys: recentDateKeys("2026-08-18", 14)
});

console.log(JSON.stringify({ suite: "admin-availability-window", pass: true, assertions: 5 }));
