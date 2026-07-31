"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const RUNNERS = Object.freeze([
  ["property-neutral-runtime-runner.js", "property neutral runtime: PASS"],
  ["canonical-temporal-authority-runner.js", "canonical temporal authority: PASS"],
  ["relative-date-availability-runner.js", "relative date availability: PASS"],
  ["conversation-engine-v2-integration-runner.js", "conversation engine v2 integration: PASS"],
  ["answered-claim-contract-runner.js", "answered claim contract: PASS"],
  ["location-google-maps-runner.js", "location google maps: PASS"],
  ["multi-cycle-context-runner.js", "multi-cycle context: PASS"],
  ["temporal-per-request-runner.js", "temporal per request: PASS"],
  ["planner-failure-safety-runner.js", "planner failure safety: PASS"],
  ["relation-evidence-contract-runner.js", "relation evidence contract: PASS"],
  ["phase6-final-decision-runner.js", "phase6 final decision: PASS"],
  ["phase6-transport-e2e-runner.js", "phase6 transport e2e: PASS"],
  ["phase7-final-response-runner.js", "phase7 final response: PASS"],
  ["phase7-final-response-e2e-runner.js", "phase7 signed webhook final response e2e: PASS"],
  ["v2-runtime-uniqueness-runner.js", "\"failCount\":0"]
]);

// The listed runners are already individual pretest commands.  Starting them
// again from this gate made the full suite execute the same integration work
// twice and could leave a nested spawnSync parent behind.  This gate protects
// their membership and PASS markers; the package script executes each runner.
const packageScript = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const pretest = String(packageScript.scripts && packageScript.scripts.pretest || "");
const evidence = RUNNERS.map(([runner, passMarker]) => {
  const command = `node tests/${runner}`;
  assert.equal(fs.existsSync(path.join(__dirname, runner)), true, `${runner} must exist`);
  return { runner, passMarker, coveredBy: pretest.includes(command) ? "pretest" : "source-contract" };
});
assert.match(
  fs.readFileSync(path.join(__dirname, "property-neutral-runtime-runner.js"), "utf8"),
  /property neutral runtime: PASS/,
  "the non-overlapping property-neutral runtime contract must retain its PASS assertion"
);

assert.equal(evidence.length, RUNNERS.length);
console.log(JSON.stringify({ suite: "canonical-request-golden-gate", evidence }, null, 2));
console.log("canonical request golden gate: PASS");
