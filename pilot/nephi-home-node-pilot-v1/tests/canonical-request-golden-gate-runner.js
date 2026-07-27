"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNNERS = Object.freeze([
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

const evidence = [];
for (const [runner, passMarker] of RUNNERS) {
  const result = spawnSync(process.execPath, [path.join("tests", runner)], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (result.status !== 0 || !stdout.includes(passMarker)) {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  }
  assert.equal(result.status, 0, `${runner} must exit 0`);
  assert.equal(result.signal, null, `${runner} must not be terminated by a signal`);
  assert.equal(stdout.includes(passMarker), true, `${runner} must emit its PASS marker`);
  evidence.push({ runner, exitCode: result.status, passMarker });
}

assert.equal(evidence.length, RUNNERS.length);
console.log(JSON.stringify({ suite: "canonical-request-golden-gate", evidence }, null, 2));
console.log("canonical request golden gate: PASS");
