"use strict";

const assert = require("node:assert/strict");
const { recentDateKeys, monthsForDateKeys } = require("../public/assets/admin-availability-window");

const dates = recentDateKeys("2026-07-30", 15);
assert.equal(dates.length, 15);
assert.equal(dates[0], "2026-07-30");
assert.equal(dates[14], "2026-08-13");
assert.deepEqual(monthsForDateKeys(dates), ["2026-07", "2026-08"]);
assert.deepEqual(recentDateKeys("2026-12-25", 15).slice(-1), ["2027-01-08"]);

console.log(JSON.stringify({ suite: "admin-availability-window", pass: true, assertions: 5 }));
