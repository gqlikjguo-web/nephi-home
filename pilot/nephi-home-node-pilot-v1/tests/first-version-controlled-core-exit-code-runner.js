"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const runnerPath = path.resolve(__dirname, "first-version-controlled-core-runner.js");

function invoke(mainBody) {
  return spawnSync(process.execPath, [
    "-e",
    `require(${JSON.stringify(runnerPath)}).run(async () => { ${mainBody} });`
  ], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    timeout: 30000
  });
}

const success = invoke("");
assert.equal(success.error, undefined, success.error && success.error.message);
assert.equal(success.status, 0, `all assertions passing must exit 0\n${success.stderr}`);

const failure = invoke("require('node:assert/strict').equal(1, 2, 'intentional runner regression failure')");
assert.equal(failure.error, undefined, failure.error && failure.error.message);
assert.notEqual(failure.status, 0, "an assertion or rejected main must exit non-zero");
assert.match(failure.stderr, /intentional runner regression failure/, "the runner must report the original failure");
assert.doesNotMatch(failure.stdout, /first-version controlled core: PASS/, "a failing injected main must not print PASS");

console.log("first-version controlled core exit code: PASS");
