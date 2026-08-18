"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.resolve(__dirname, "../scripts/verify-core-change-preflight.js");

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
}

function git(repo, args) {
  const result = run("git", ["-C", repo, ...args], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function write(repo, relativePath, value) {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value, "utf8");
}

function repository() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-core-preflight-"));
  git(repo, ["init", "-b", "main"]);
  write(repo, "lib/core.js", "function targetFunction() {}\nfunction callerFunction() {}\nmodule.exports={targetFunction,callerFunction};\n");
  write(repo, "tests/affected.js", "process.exitCode=0;\n");
  write(repo, "tests/red.js", "throw new Error('expected contract failure');\n");
  write(repo, "tests/pass.js", "process.exitCode=0;\n");
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.name=JunZan Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline"]);
  const head = git(repo, ["rev-parse", "HEAD"]);
  return { repo, head };
}

function manifest(head) {
  return {
    schemaVersion: 1,
    expectedHead: head,
    baseline: head,
    earliestFailure: {
      transition: "decideContextExecutionV3 -> plannerTaskFromState",
      file: "lib/core.js",
      functions: ["targetFunction"]
    },
    proposedChanges: [{ path: "lib/core.js", functions: ["targetFunction"] }],
    productionCallers: [{ path: "lib/core.js", function: "callerFunction" }],
    productionConsumers: [{ name: "canonicalizer", path: "lib/core.js", function: "callerFunction" }],
    affectedPasses: [{ name: "same-capability continuation", runner: "tests/affected.js" }],
    lessons: [{ commit: head, purpose: "fixture history" }],
    redCommand: [process.execPath, "tests/red.js"],
    allowedCoreFiles: ["lib/core.js"]
  };
}

function execute(repo, value) {
  const manifestPath = path.join(repo, "CORE_CHANGE_PREFLIGHT.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return run(process.execPath, [SCRIPT, "--repo", repo, "--manifest", manifestPath], repo);
}

function check(name, mutate, expectedStatus, expectedOutput) {
  const { repo, head } = repository();
  try {
    const value = manifest(head);
    mutate({ repo, head, value });
    const result = execute(repo, value);
    assert.equal(result.status, expectedStatus, `${name}: ${JSON.stringify({ error: result.error && result.error.message, signal: result.signal, stderr: result.stderr, stdout: result.stdout })}`);
    assert.equal(result.stderr, "", `${name}: stderr must stay empty`);
    assert.equal(result.stdout.trim(), expectedOutput, `${name}: output must be one controlled line`);
    process.stdout.write(`PASS core-change-preflight ${name}\n`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

check("valid manifest", () => {}, 0, "CORE_CHANGE_PREFLIGHT=PASS");
check("head mismatch", ({ value }) => { value.expectedHead = "0".repeat(40); }, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=HEAD_MISMATCH");
check("invalid baseline", ({ value }) => { value.baseline = "0".repeat(40); }, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=BASELINE_INVALID");
check("missing proposed file", ({ value }) => { value.proposedChanges[0].path = "lib/missing.js"; }, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=PROPOSED_FILE_MISSING");
check("missing proposed function", ({ value }) => { value.proposedChanges[0].functions = ["missingFunction"]; }, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=PROPOSED_FUNCTION_MISSING");
check("empty production callers", ({ value }) => { value.productionCallers = []; }, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=PRODUCTION_CALLERS_EMPTY");
check("empty production consumers", ({ value }) => { value.productionConsumers = []; }, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=PRODUCTION_CONSUMERS_EMPTY");
check("missing affected runner", ({ value }) => { value.affectedPasses[0].runner = "tests/missing.js"; }, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=AFFECTED_TEST_MISSING");
check("missing lesson commit", ({ value }) => { value.lessons[0].commit = "1".repeat(40); }, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=LESSON_COMMIT_MISSING");
check("red must fail", ({ value }) => { value.redCommand = [process.execPath, "tests/pass.js"]; }, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=RED_DID_NOT_FAIL");
check("undeclared core modification", ({ repo }) => { write(repo, "lib/undeclared.js", "module.exports=true;\n"); }, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=UNDECLARED_CORE_CHANGE");
check("core file outside allowlist", ({ repo, value }) => {
  write(repo, "lib/declared.js", "function declaredFunction() {}\n");
  value.proposedChanges.push({ path: "lib/declared.js", functions: ["declaredFunction"] });
}, 1, "CORE_CHANGE_PREFLIGHT=FAIL reason=CORE_FILE_OUTSIDE_ALLOWLIST");

process.stdout.write("PASS core-change-preflight runner\n");
