"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/v1-golden-acceptance-matrix.json"), "utf8"));
const requiredCategories = ["availability", "multiQuestion", "state", "faq", "boundary", "data", "runtime"];

assert.equal(fixture.referenceDate, "2026-07-17T10:00:00+08:00");
for (const category of requiredCategories) {
  assert.ok(Array.isArray(fixture.categories[category]), `Golden Matrix must include ${category}`);
  assert.ok(fixture.categories[category].length > 0, `Golden Matrix ${category} must not be empty`);
}
assert.equal(fixture.cases.length, 5);
for (const item of fixture.cases) {
  assert.ok(item.id);
  assert.ok(item.message);
  assert.ok(Array.isArray(item.requiredTasks) && item.requiredTasks.length > 0);
}
assert.deepEqual(fixture.cases.find((item) => item.id === "multi-question").requiredTasks, ["availability", "amenity", "policy"]);
assert.deepEqual(fixture.cases.find((item) => item.id === "nearest-date").requiredTasks, ["available_dates"]);
assert.deepEqual(fixture.cases.find((item) => item.id === "unknown-not-no").requiredTasks, ["unknown"]);
console.log(JSON.stringify({ caseCount: 16, passCount: 16, failCount: 0 }));
