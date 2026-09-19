"use strict";
// STRUCTURED_CONTRACT_TEST: real temporary Git repositories; no providers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const gatePath = path.resolve(__dirname, "../scripts/core-reliability-gate.js");
assert.ok(fs.existsSync(gatePath), "RED: a trusted external reliability gate must exist");
const gate = require(gatePath);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-gate-negative-"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
git("init", "-q"); git("config", "user.email", "gate@example.invalid"); git("config", "user.name", "Gate isolated test");
for (const [p, text] of Object.entries({ "runtime.js": "module.exports=1;\n", "contract.js": "require('node:assert/strict').equal(1,1);\n", "other.js": "protected\n" })) fs.writeFileSync(path.join(root, p), text);
git("add", "."); git("commit", "-qm", "isolated baseline");
const baseline = git("rev-parse", "HEAD");
const policy = { protectedPaths: ["contract.js"], governancePaths: ["policy.json"], capabilities: [{ id: "core", paths: ["runtime.js"], runners: ["contract.js"] }], incidents: [{ id: "incident", runners: ["contract.js"] }], requiredRunners: [], lifecycle: [] };
const task = { schemaVersion: 1, baseline, objective: "approved isolated runtime change", allowedPaths: ["runtime.js"], contractChangeAllowed: false, affectedCapabilities: ["core"] };
const approval = gate.digest(task);
let cases = 0;
function fails(fn, code) { assert.throws(fn, e => String(e.message).includes(code)); cases++; }
assert.deepEqual(gate.validateTask(task, baseline, approval), task); cases++;
fails(() => gate.validateTask({ ...task, allowedPaths: ["**"] }, baseline, approval), "APPROVAL_MISMATCH");
fails(() => gate.validateTask(task, baseline, "forged"), "APPROVAL_MISMATCH");
fails(() => gate.validateTask({ ...task, baseline: "0".repeat(40) }, baseline, gate.digest({ ...task, baseline: "0".repeat(40) })), "BASELINE_MISMATCH");
fs.writeFileSync(path.join(root, "runtime.js"), "module.exports=2;\n");
git("add", "."); git("commit", "-qm", "legal candidate"); const candidate = git("rev-parse", "HEAD");
const diff = gate.changedPaths(root, baseline, candidate);
assert.deepEqual(diff, ["runtime.js"]); gate.validateDiff(diff, task, policy); cases++;
fails(() => gate.validateDiff(["other.js"], task, policy), "OUTSIDE_APPROVED_SCOPE");
fails(() => gate.validateDiff(["runtime.js", "contract.js"], { ...task, allowedPaths: ["runtime.js", "contract.js"] }, policy), "CONTRACT_CHANGE_REQUIRED");
fails(() => gate.validateDiff(["contract.js"], { ...task, allowedPaths: ["contract.js"], contractChangeAllowed: true }, policy), "CONTRACT_CHANGE_REQUIRED");
fails(() => gate.validateDiff(["policy.json"], { ...task, allowedPaths: ["policy.json"] }, policy), "GATE_CHANGE_REQUIRES_REVIEW");
assert.deepEqual(gate.selectRunners(diff, policy), ["contract.js"]); cases++;
const evidence = { candidateSha: candidate, baselineSha: baseline, status: "PASS", required: ["contract.js"], results: [{ runner: "contract.js", exitCode: 0, status: "PASS", candidateSha: candidate, logSha256: "a".repeat(64) }] };
gate.validateEvidence(evidence, baseline, candidate, ["contract.js"]); cases++;
fails(() => gate.validateEvidence(evidence, baseline, baseline, ["contract.js"]), "STALE_CANDIDATE_EVIDENCE");
fails(() => gate.validateEvidence({ ...evidence, results: [] }, baseline, candidate, ["contract.js"]), "MISSING_RUNNER_EVIDENCE");
fails(() => gate.validateEvidence({ ...evidence, results: [{ ...evidence.results[0], status: "SKIP" }] }, baseline, candidate, ["contract.js"]), "RUNNER_NOT_PASS");
fs.writeFileSync(path.join(root, "work-in-progress.txt"), "must survive STOP\n");
const before = git("status", "--porcelain");
const result = gate.runCommands({ root, cwd: root, candidate, baseline, commands: [{ id: "pass", argv: [process.execPath, "-e", "console.log('PASS')"] }, { id: "failure", argv: [process.execPath, "-e", "process.exitCode=1"] }, { id: "must-not-run", argv: [process.execPath, "-e", "throw Error('no')"] }], evidenceDir: path.join(root, "evidence") });
assert.equal(result.status, "STOP"); assert.equal(result.results.length, 2); assert.equal(result.results[1].exitCode, 1);
assert.equal(fs.readFileSync(path.join(root, "work-in-progress.txt"), "utf8"), "must survive STOP\n");
assert.ok(git("status", "--porcelain").includes(before)); assert.ok(fs.existsSync(path.join(root, "evidence", "report.json"))); cases++;
// Release evidence must cover the whole command set, not just selected entries.
fails(() => gate.validateEvidence({ ...evidence, required: [] }, baseline, candidate, ["contract.js"]), "REQUIRED_SET_MISMATCH");
fails(() => gate.validateEvidence({ ...evidence, results: [...evidence.results, { ...evidence.results[0], runner: "extra.js" }] }, baseline, candidate, ["contract.js"]), "RESULT_SET_MISMATCH");
// Never overwrite a failed attempt with a later passing sample.
fails(() => gate.runCommands({ root, cwd: root, candidate, baseline, commands: [], evidenceDir: path.join(root, "evidence") }), "EVIDENCE_ALREADY_EXISTS");
fails(() => gate.verifyCheckout(root, baseline, []), "CANDIDATE_CHECKOUT_MISMATCH");
fails(() => gate.verifyCheckout(root, candidate, []), "UNTRACKED_CANDIDATE_FILES");
gate.verifyCheckout(root, candidate, ["work-in-progress.txt", "evidence/"] ); cases++;
fs.appendFileSync(path.join(root, "runtime.js"), "// changed after verification\n");
fails(() => gate.verifyCheckout(root, candidate, ["work-in-progress.txt", "evidence/"]), "CANDIDATE_CHECKOUT_MISMATCH");
// Exercise the complete CLI with trusted baseline policy and a committed head.
const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-gate-cli-"));
const cliGit = (...args) => execFileSync("git", args, { cwd: cliRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const app = "pilot/nephi-home-node-pilot-v1";
fs.mkdirSync(path.join(cliRoot, app, "tests"), { recursive: true });
fs.mkdirSync(path.join(cliRoot, ".github"));
fs.writeFileSync(path.join(cliRoot, app, "tests/contract.js"), "require('node:assert/strict').equal(1, 1);\n");
fs.writeFileSync(path.join(cliRoot, app, "package.json"), JSON.stringify({ scripts: { pretest: "node tests/contract.js", test: "node tests/contract.js", posttest: "node tests/contract.js" } }));
fs.writeFileSync(path.join(cliRoot, ".github/core-reliability-policy.json"), JSON.stringify({ protectedPaths: [app + "/tests/contract.js"], governancePaths: [], capabilities: [], incidents: [], requiredRunners: ["tests/contract.js"], lifecycle: ["pretest", "test", "posttest"] }));
cliGit("init", "-q"); cliGit("config", "user.email", "gate@example.invalid"); cliGit("config", "user.name", "Gate isolated CLI");
cliGit("add", "."); cliGit("commit", "-qm", "trusted gate fixture");
const cliBase = cliGit("rev-parse", "HEAD");
const cliTask = { schemaVersion: 1, baseline: cliBase, objective: "legal documentation change", allowedPaths: ["README.md", ".github/core-reliability-task.json"], contractChangeAllowed: false, affectedCapabilities: [] };
fs.writeFileSync(path.join(cliRoot, ".github/core-reliability-task.json"), JSON.stringify(cliTask));
fs.writeFileSync(path.join(cliRoot, "README.md"), "approved documentation\n");
cliGit("add", "."); cliGit("commit", "-qm", "legal candidate fixture");
const cliHead = cliGit("rev-parse", "HEAD");
for (const requiredReal of [false, true]) {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-gate-cli-evidence-"));
  const execution = spawnSync(process.execPath, [gatePath, "--root", cliRoot, "--baseline", cliBase, "--candidate", cliHead, "--approved-scope-digest", gate.digest(cliTask), "--evidence", evidenceDir, "--require-real", String(requiredReal)], { encoding: "utf8", env: { ...process.env, CORE_GATE_OPENAI_API_KEY: "" } });
  const evidence = JSON.parse(fs.readFileSync(path.join(evidenceDir, "report.json"), "utf8"));
  assert.equal(execution.status, requiredReal ? 1 : 0, execution.stderr);
  assert.equal(evidence.status, requiredReal ? "BLOCKED_CREDENTIAL" : "PASS");
  assert.equal(evidence.candidateSha, cliHead); assert.equal(evidence.baselineSha, cliBase);
  assert.equal(evidence.results.length, 1, "npm lifecycle and required runners are deduplicated");
  if (requiredReal) assert.equal(evidence.real.realCalls, 0);
  cases++;
}
async function verifyWorkflow() {
  const workflow = fs.readFileSync(path.resolve(__dirname, "../../../.github/workflows/core-reliability.yml"), "utf8");
  const blocks = [...workflow.matchAll(/          script: \|\n((?: {12}[^\n]*\n|\n)+)/g)].map(m => m[1].split("\n").map(line => line.slice(12)).join("\n"));
  assert.equal(blocks.length, 2);
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const scopeScript = new AsyncFunction("github", "context", "core", "require", "process", blocks[0]);
  const statusScript = new AsyncFunction("github", "context", "process", blocks[1]);
  // Match github-script@v7: runId exists; context.runAttempt does not.
  const context = { runId: 1, repo: { owner: "gate-owner", repo: "gate-repo" }, payload: {} };
  context.payload.pull_request = { number: 1, base: { sha: cliBase }, head: { sha: cliHead, repo: { full_name: "gate-owner/gate-repo" } } };
  let head = cliHead, base = cliBase;
  const statuses = [], outputs = {};
  const github = { rest: { repos: {}, pulls: {} } };
  github.rest.repos.getBranch = async () => ({ data: { commit: { sha: base } } });
  github.rest.repos.getContent = async () => ({ data: { content: Buffer.from(JSON.stringify(cliTask)).toString("base64") } });
  github.rest.repos.createCommitStatus = async value => { statuses.push(value); };
  github.rest.pulls.get = async () => ({ data: { head: { sha: head } } });
  const summary = { addHeading() { return this; }, addRaw() { return this; }, addCodeBlock() { return this; }, async write() {} };
  const core = { summary, setOutput: (name, value) => { outputs[name] = value; } };
  await scopeScript(github, context, core, require, { env: { GITHUB_RUN_ATTEMPT: "1" } });
  assert.equal(outputs.digest, gate.digest(cliTask)); cases++;
  await assert.rejects(() => scopeScript(github, context, core, require, { env: { GITHUB_RUN_ATTEMPT: "2" } }), /Repeated release attempts/); cases++;
  for (const probe of [
    { attempt: "1", head: cliHead, base: cliBase, state: "success" },
    { attempt: "2", head: cliHead, base: cliBase, state: "failure" },
    { attempt: "1", head: cliBase, base: cliBase, state: "failure" },
    { attempt: "1", head: cliHead, base: cliHead, state: "failure" }
  ]) {
    head = probe.head; base = probe.base;
    await statusScript(github, context, { env: { GITHUB_RUN_ATTEMPT: probe.attempt, SCOPE_RESULT: "success", GATE_RESULT: "success" } });
    assert.equal(statuses.at(-1).state, probe.state); assert.equal(statuses.at(-1).sha, cliHead); cases++;
  }
}
verifyWorkflow().then(() => console.log(JSON.stringify({ classification: "STRUCTURED_CONTRACT_TEST", cases, passed: cases, temporaryRepositoryPreserved: root, realOpenaiCalls: 0 }))).catch(e => { console.error(e); process.exitCode = 1; });
