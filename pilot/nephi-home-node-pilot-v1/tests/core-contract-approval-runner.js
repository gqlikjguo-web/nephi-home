"use strict";
// STRUCTURED_CONTRACT_TEST: temporary Git history and GitHub API doubles, no network.
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), cp = require("node:child_process");
const helperPath = path.resolve(__dirname, "../scripts/core-contract-approval.js");
assert.ok(fs.existsSync(helperPath), "RED: externally verified Contract-change admission is required");
const contract = require(helperPath), gate = require("../scripts/core-reliability-gate");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-contract-admission-"));
const git = (...args) => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const a = "pilot/nephi-home-node-pilot-v1/tests/a.js", b = "pilot/nephi-home-node-pilot-v1/tests/b.js", taskPath = ".github/core-reliability-task.json";
fs.mkdirSync(path.dirname(path.join(root, a)), { recursive: true }); fs.mkdirSync(path.join(root, ".github"));
for (const file of [a, b, "runtime.js"]) fs.writeFileSync(path.join(root, file), "original\n");
git("init", "-q"); git("config", "user.name", "Isolated contract test"); git("config", "user.email", "test@example.invalid"); git("add", "."); git("commit", "-qm", "baseline");
const baseline = git("rev-parse", "HEAD");
const task = { schemaVersion: 1, baseline, objective: "approved A only", allowedPaths: [taskPath, a], contractChangeAllowed: true, gateChangeAllowed: false, affectedCapabilities: [] };
fs.writeFileSync(path.join(root, taskPath), JSON.stringify(task)); fs.writeFileSync(path.join(root, a), "approved update\n"); git("add", "."); git("commit", "-qm", "candidate");
const candidate = git("rev-parse", "HEAD"), changed = [taskPath, a];
const policy = { protectedPaths: [a, b], governancePaths: ["policy.json"], capabilities: [{ paths: ["runtime.js"], runners: [] }], contractReview: { repository: "owner/repo", environment: "core-scope-approval", environmentId: 12, reviewerId: 34, workflow: ".github/workflows/core-reliability.yml" } };
const context = { repository: "owner/repo", pullRequest: 5, runId: 6, runAttempt: 1 };
const descriptor = contract.describe({ root, baseline, candidate, task, policy, context });
let cases = 0;
function fails(fn, pattern) { assert.throws(fn, pattern); cases++; }
fails(() => gate.validateDiff(changed, task, policy), /CONTRACT_CHANGE_REQUIRED/);
fails(() => gate.validateDiff(changed, { ...task, contractChangeAllowed: true }, policy, { verified: true }), /CONTRACT_CHANGE_REQUIRED/);
fails(() => contract.describe({ root, baseline, candidate, task: { ...task, contractChangeAllowed: false }, policy, context }), /CONTRACT_REQUEST_REQUIRED/);
assert.deepEqual(descriptor.protectedPaths, [a]); cases++;
assert.equal(descriptor.diffSha256, require("node:crypto").createHash("sha256").update(cp.execFileSync("git", ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", "--no-renames", baseline, candidate, "--"], { cwd: root })).digest("hex")); cases++;
let replies;
function resetResponses() {
  replies = {
    "/actions/runs/6": { id: 6, run_attempt: 1, event: "pull_request_target", path: policy.contractReview.workflow, head_sha: candidate, repository: { full_name: "owner/repo" } },
    "/pulls/5": { state: "open", head: { sha: candidate, repo: { full_name: "owner/repo" } }, base: { sha: baseline, ref: "production" } },
    "/branches/production": { commit: { sha: baseline } },
    "/actions/runs/6/approvals": [{ state: "approved", comment: `CONTRACT_CHANGE_APPROVED ${contract.digest(descriptor)} REVIEW_SHA256=${"a".repeat(64)}`, environments: [{ id: 12, name: "core-scope-approval" }], user: { id: 34 } }]
  };
}
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
  assert.ok(url.startsWith("https://api.github.com/repos/owner/repo/"));
  const suffix = url.slice("https://api.github.com/repos/owner/repo".length);
  assert.ok(Object.hasOwn(replies, suffix), suffix);
  return { ok: true, json: async () => structuredClone(replies[suffix]) };
};
(async () => {
  resetResponses();
  await assert.rejects(() => contract.authorize(descriptor, policy, ""), /GITHUB_REVIEW_CREDENTIAL_REQUIRED/); cases++;
  const receipt = await contract.authorize(descriptor, policy, "fixture-read-only");
  gate.validateDiff(changed, task, policy, receipt); cases++;
  fails(() => gate.validateDiff([taskPath, b], { ...task, allowedPaths: [taskPath, b] }, policy, receipt), /CONTRACT_CHANGE_REQUIRED/);
  fails(() => gate.validateDiff(changed, task, policy, JSON.parse(JSON.stringify(receipt))), /CONTRACT_CHANGE_REQUIRED/);
  for (const alter of [
    () => { replies["/actions/runs/6/approvals"] = []; },
    () => { replies["/actions/runs/6/approvals"][0].comment = "approved"; },
    () => { replies["/actions/runs/6/approvals"][0].comment = `CONTRACT_CHANGE_APPROVED ${"0".repeat(64)} REVIEW_SHA256=${"a".repeat(64)}`; },
    () => { replies["/actions/runs/6/approvals"][0].state = "rejected"; },
    () => { replies["/actions/runs/6/approvals"][0].user.id = 99; },
    () => { replies["/actions/runs/6/approvals"][0].environments[0].id = 99; },
    () => { replies["/actions/runs/6"].run_attempt = 2; },
    () => { replies["/actions/runs/6"].path = "candidate-workflow.yml"; },
    () => { replies["/actions/runs/6"].event = "workflow_dispatch"; },
    () => { replies["/pulls/5"].head.sha = "b".repeat(40); },
    () => { replies["/branches/production"].commit.sha = "b".repeat(40); }
  ]) { resetResponses(); alter(); await assert.rejects(() => contract.authorize(descriptor, policy, "fixture-read-only"), /CONTRACT_/); cases++; }
  resetResponses();
  await assert.rejects(() => contract.authorize({ ...descriptor, candidateSha: "b".repeat(40) }, policy, "fixture-read-only"), /CONTRACT_/); cases++;
  await assert.rejects(() => contract.authorize({ ...descriptor, diffSha256: "b".repeat(64) }, policy, "fixture-read-only"), /CONTRACT_APPROVAL_REQUIRED/); cases++;
  fs.writeFileSync(path.join(root, "runtime.js"), "unapproved runtime\n"); git("add", "."); git("commit", "-qm", "mixed runtime negative candidate");
  fails(() => contract.describe({ root, baseline, candidate: git("rev-parse", "HEAD"), task, policy, context }), /CONTRACT_ONLY_CHANGE_REQUIRED/);
  const workflow = fs.readFileSync(path.resolve(__dirname, "../../../.github/workflows/core-reliability.yml"), "utf8");
  assert.match(workflow, /core-contract-approval\.js describe/); assert.match(workflow, /actions: read/); assert.match(workflow, /CORE_GATE_GITHUB_READ_TOKEN: \$\{\{ github\.token \}\}/); cases++;
  console.log(JSON.stringify({ classification: "STRUCTURED_CONTRACT_TEST", cases, passed: cases, realNetworkCalls: 0, preservedFixture: root }));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });
