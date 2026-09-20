"use strict";
// External verification only. Never imported by the application runtime.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const APP = "pilot/nephi-home-node-pilot-v1";
const POLICY = ".github/core-reliability-policy.json";
const TASK = ".github/core-reliability-task.json";
function insist(ok, code) { if (!ok) throw new Error(code); }
function digest(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function git(root, args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function exact(p) { return typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") && !/[\x00-\x1f*?\[\]]/.test(p) && path.posix.normalize(p) === p && !p.split("/").includes(".."); }
function changedPaths(root, baseline, candidate) {
  insist(/^[a-f0-9]{40}$/.test(baseline) && /^[a-f0-9]{40}$/.test(candidate), "INVALID_SHA");
  git(root, ["merge-base", "--is-ancestor", baseline, candidate]);
  // --no-renames exposes both removed and added paths; rename cannot evade scope.
  return git(root, ["diff", "--no-renames", "--name-only", "-z", baseline, candidate]).split("\0").filter(Boolean).sort();
}
function verifyCheckout(root, candidate, allowedUntracked = []) {
  insist(git(root, ["rev-parse", "HEAD"]) === candidate && !git(root, ["diff", "HEAD", "--name-only"]), "CANDIDATE_CHECKOUT_MISMATCH");
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  insist(!untracked.some(p => !allowedUntracked.some(a => p === a || a.endsWith("/") && p.startsWith(a))), "UNTRACKED_CANDIDATE_FILES");
}
function validateTask(task, baseline, approvedDigest) {
  insist(task && digest(task) === approvedDigest, "APPROVAL_MISMATCH");
  insist(task.schemaVersion === 1 && task.baseline === baseline, "BASELINE_MISMATCH");
  insist(typeof task.objective === "string" && task.objective.trim().length > 0, "MISSING_APPROVED_OBJECTIVE");
  insist(Array.isArray(task.allowedPaths) && task.allowedPaths.length && task.allowedPaths.every(exact) && new Set(task.allowedPaths).size === task.allowedPaths.length, "INVALID_EXACT_SCOPE");
  insist(typeof task.contractChangeAllowed === "boolean" && Array.isArray(task.affectedCapabilities), "MISSING_TASK_FIELDS");
  return task;
}
function validateDiff(changed, task, policy) {
  const outside = changed.filter(p => !task.allowedPaths.includes(p));
  insist(!outside.length, "OUTSIDE_APPROVED_SCOPE: " + outside.join(","));
  const contracts = changed.filter(p => policy.protectedPaths.includes(p));
  insist(!contracts.length, "CONTRACT_CHANGE_REQUIRED: " + contracts.join(","));
  const governance = changed.filter(p => policy.governancePaths.includes(p));
  insist(!governance.length || task.gateChangeAllowed === true && !changed.some(p => policy.capabilities.some(c => c.paths.some(prefix => p.startsWith(prefix)))), "GATE_CHANGE_REQUIRES_REVIEW");
}
function selectRunners(changed, policy) {
  const runners = [...policy.requiredRunners, ...policy.incidents.flatMap(i => i.runners)];
  for (const capability of policy.capabilities) if (changed.some(p => capability.paths.some(prefix => p.startsWith(prefix)))) runners.push(...capability.runners);
  return [...new Set(runners)].sort();
}
function validateEvidence(e, baseline, candidate, required) {
  insist(e && e.candidateSha === candidate && e.baselineSha === baseline, "STALE_CANDIDATE_EVIDENCE");
  insist(e.status === "PASS", "GATE_NOT_PASS");
  insist(Array.isArray(e.results) && new Set(e.results.map(r => r.runner)).size === e.results.length, "INVALID_RUNNER_EVIDENCE");
  insist(Array.isArray(e.required) && JSON.stringify([...e.required].sort()) === JSON.stringify([...required].sort()), "REQUIRED_SET_MISMATCH");
  for (const runner of required) {
    const r = e.results.find(x => x.runner === runner);
    insist(r, "MISSING_RUNNER_EVIDENCE: " + runner);
    insist(r.candidateSha === candidate && r.exitCode === 0 && r.status === "PASS" && /^[a-f0-9]{64}$/.test(r.logSha256), "RUNNER_NOT_PASS: " + runner);
  }
  insist(JSON.stringify(e.results.map(r => r.runner).sort()) === JSON.stringify([...required].sort()), "RESULT_SET_MISMATCH");
}
function runCommands({ root, cwd, candidate, baseline, commands, evidenceDir }) {
  insist(!fs.existsSync(path.join(evidenceDir, "report.json")), "EVIDENCE_ALREADY_EXISTS");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const report = { schemaVersion: 1, baselineSha: baseline, candidateSha: candidate, status: "RUNNING", required: commands.map(c => c.id), results: [], stopPreservesWork: true };
  fs.writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(report, null, 2));
  for (const [index, command] of commands.entries()) {
    const r = spawnSync(command.argv[0], command.argv.slice(1), { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000,
      env: { ...process.env, OPENAI_API_KEY: "", OPENAI_TEST_API_KEY: "", CORE_GATE_OPENAI_API_KEY: "", LINE_CHANNEL_ACCESS_TOKEN: "" } });
    const log = String(r.stdout || "") + String(r.stderr || "") + (r.error ? "\n" + r.error.message : "");
    const logFile = `${String(index).padStart(3, "0")}.log`;
    fs.writeFileSync(path.join(evidenceDir, logFile), log);
    const skipped = /(?:^|\n)# skipped [1-9]|"status"\s*:\s*"(?:SKIP|NOT_RUN|NOT_EXECUTABLE)"/.test(log);
    const ok = r.status === 0 && !r.error && !skipped;
    report.results.push({ runner: command.id, candidateSha: candidate, exitCode: r.status, status: ok ? "PASS" : "FAIL", logFile, logSha256: digest(log) });
    if (!ok) report.status = "STOP";
    fs.writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(report, null, 2));
    if (!ok) break; // Do not repair, retry, reset, restore, or remove any work.
  }
  if (report.status === "RUNNING") report.status = "PASS";
  fs.writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(report, null, 2));
  return report;
}
function argumentsFor(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) { insist(argv[i].startsWith("--") && argv[i + 1], "INVALID_GATE_ARGUMENT"); result[argv[i].slice(2)] = argv[i + 1]; }
  return result;
}
function main(argv) {
  const a = argumentsFor(argv), root = path.resolve(a.root || path.join(__dirname, "../../.."));
  const baseline = a.baseline, candidate = a.candidate;
  const changed = changedPaths(root, baseline, candidate);
  const task = JSON.parse(git(root, ["show", `${candidate}:${TASK}`]));
  validateTask(task, baseline, a["approved-scope-digest"]);
  verifyCheckout(root, candidate, task.preExistingUntracked || []);
  // Normal CI supplies the base commit's policy. Bootstrap is explicit, never an
  // implicit fallback to a candidate that can rewrite its own protection.
  const policyText = a["bootstrap-policy"] ? fs.readFileSync(a["bootstrap-policy"], "utf8") : git(root, ["show", `${baseline}:${POLICY}`]);
  insist(!a["bootstrap-policy"] || a["bootstrap-policy-digest"] === digest(policyText), "BOOTSTRAP_REVIEW_REQUIRED");
  const policy = JSON.parse(policyText);
  validateDiff(changed, task, policy);
  const coreChanged = changed.some(p => policy.capabilities.some(c => c.paths.some(prefix => p.startsWith(prefix))));
  const runners = selectRunners(changed, policy);
  const cwd = path.join(root, APP);
  for (const runner of runners) insist(exact(runner) && fs.existsSync(path.join(cwd, runner)), "MISSING_RUNNER: " + runner);
  const commands = runners.map(runner => ({ id: runner, argv: [process.execPath, runner] }));
  // Extract the trusted baseline lifecycle, so candidate package changes cannot
  // silently drop checks. Deduplicate explicit runner commands across all groups.
  const scripts = JSON.parse(git(root, ["show", `${baseline}:${APP}/package.json`])).scripts;
  for (const stage of policy.lifecycle) for (const command of (scripts[stage] || "").split(" && ")) {
    insist(/^node [a-zA-Z0-9./_-]+\.js$/.test(command), "UNSUPPORTED_LIFECYCLE_COMMAND: " + command);
    const runner = command.slice(5);
    if (!commands.some(c => c.id === runner)) commands.push({ id: runner, argv: [process.execPath, runner] });
  }
  const report = runCommands({ root, cwd, candidate, baseline, commands, evidenceDir: path.resolve(a.evidence) });
  report.changedPaths = changed; report.coreChanged = coreChanged; report.approvedScopeDigest = a["approved-scope-digest"];
  report.realE2eRequired = coreChanged || a["require-real"] === "true";
  if (report.status === "PASS") {
    try {
      verifyCheckout(root, candidate, task.preExistingUntracked || []);
      validateEvidence(report, baseline, candidate, commands.map(c => c.id));
      for (const r of report.results) insist(digest(fs.readFileSync(path.join(path.resolve(a.evidence), r.logFile), "utf8")) === r.logSha256, "LOG_DIGEST_MISMATCH");
    } catch (e) { report.status = "STOP"; report.reason = e.message; }
  }
  if (report.status === "PASS" && report.realE2eRequired) {
    if (!process.env.CORE_GATE_OPENAI_API_KEY) {
      report.status = "BLOCKED_CREDENTIAL";
      report.real = { status: "BLOCKED_CREDENTIAL", candidateSha: candidate, realCalls: 0 };
    }
  }
  if (report.status === "PASS" && report.realE2eRequired) {
    report.status = "RUNNING";
    fs.writeFileSync(path.join(path.resolve(a.evidence), "report.json"), JSON.stringify(report, null, 2));
    // Evidence is produced by this invocation, never accepted from a candidate's
    // uploaded JSON. The runtime PR cannot modify this protected harness/oracle.
    const realDir = path.join(path.resolve(a.evidence), "real");
    const result = spawnSync(process.execPath, ["scripts/run-core-reliability-real.js"], { cwd, encoding: "utf8", timeout: 1200000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CORE_GATE_CANDIDATE_SHA: candidate, CORE_GATE_EVIDENCE_DIR: realDir } });
    fs.writeFileSync(path.join(path.resolve(a.evidence), "real-execution.log"), String(result.stdout || "") + String(result.stderr || ""));
    if (result.status !== 0) report.status = "STOP";
    else {
      const real = JSON.parse(fs.readFileSync(path.join(realDir, "real-report.json"), "utf8"));
      const valid = real.candidateSha === candidate && real.status === "PASS" && real.provider === "REAL_OPENAI_AND_POSTGRESQL" && real.turns === 13 && real.realCalls >= 13 && real.realCalls <= 26 && real.lineDelivery === "NOT_RUN" && real.quotaWrites === 0;
      report.status = valid ? "PASS" : "STOP";
      report.real = real;
    }
  }
  if (report.status === "PASS") {
    try { verifyCheckout(root, candidate, task.preExistingUntracked || []); }
    catch (e) { report.status = "STOP"; report.reason = e.message; }
  }
  fs.writeFileSync(path.join(path.resolve(a.evidence), "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (report.status !== "PASS") process.exitCode = 1;
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error("RELIABILITY_GATE_STOP: " + e.message); process.exitCode = 1; } }
module.exports = { digest, changedPaths, verifyCheckout, validateTask, validateDiff, selectRunners, validateEvidence, runCommands };
