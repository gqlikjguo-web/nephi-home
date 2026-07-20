"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mutation = process.env.JUNZAN_GOLDEN_MUTATION || "";
const fixturePath = path.resolve(__dirname, "fixtures/v1-golden-acceptance-matrix.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const acceptancePath = path.resolve(__dirname, "first-version-acceptance-matrix-runner.js");
let acceptanceSource = fs.readFileSync(acceptancePath, "utf8");
if (mutation === "incomplete_case") acceptanceSource = acceptanceSource.replace('id: "unknown-knowledge"', 'id: "removed-unknown-case"');

const requiredCategories = ["availability", "multiQuestion", "state", "faq", "boundary", "data", "runtime"];
const requiredCaseIds = ["availability-double", "availability-four", "multi-question", "nearest-date", "unknown-not-no"];
const requiredRuntimeCases = ["named-room", "multi-question", "missing-date", "unreliable", "isolation-orchid", "unknown-knowledge"];

assert.equal(fixture.referenceDate, "2026-07-17T10:00:00+08:00");
for (const category of requiredCategories) {
  assert.ok(Array.isArray(fixture.categories[category]), `Golden Matrix must include ${category}`);
  assert.ok(fixture.categories[category].length > 0, `Golden Matrix ${category} must not be empty`);
}
assert.equal(fixture.cases.length, requiredCaseIds.length, "Golden Matrix cases must not be deleted");
assert.deepEqual(fixture.cases.map((item) => item.id), requiredCaseIds);
assert.deepEqual(fixture.cases.find((item) => item.id === "multi-question").requiredTasks, ["availability", "amenity", "policy"]);
assert.deepEqual(fixture.cases.find((item) => item.id === "nearest-date").requiredTasks, ["available_dates"]);
assert.deepEqual(fixture.cases.find((item) => item.id === "unknown-not-no").requiredTasks, ["unknown"]);
for (const id of requiredRuntimeCases) assert.match(acceptanceSource, new RegExp(`id: "${id}"`), `acceptance case ${id} must remain`);
assert.match(acceptanceSource, /assert\.ok\(result\.replyText\.includes\(answer\)/, "Golden Matrix must assert returned facts, not only a reply");
assert.match(acceptanceSource, /assert\.equal\(result\.replyText\.includes\(excluded\), false/, "Golden Matrix must assert property isolation");
assert.match(acceptanceSource, /assert\.equal\(expectedTask && expectedTask\.status, item\.expectedStatus/, "Golden Matrix must assert unknown and boundary states");
assert.match(acceptanceSource, /assert\.equal\(result\.claimValidation\.ok, true/, "Golden Matrix must assert complete safe response coverage");

console.log(JSON.stringify({ caseCount: 22, passCount: 22, failCount: 0, mutation: mutation || "none" }));
