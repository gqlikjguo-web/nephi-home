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
function validateDiff(changed, task, policy, contractReceipt) {
  const outside = changed.filter(p => !task.allowedPaths.includes(p));
  insist(!outside.length, "OUTSIDE_APPROVED_SCOPE: " + outside.join(","));
  const contracts = changed.filter(p => policy.protectedPaths.includes(p));
  insist(!contracts.length || contractReceipt && require("./core-contract-approval").matches(contractReceipt, changed, task, policy), "CONTRACT_CHANGE_REQUIRED: " + contracts.join(","));
  const governance = changed.filter(p => policy.governancePaths.includes(p));
  insist(!governance.length || task.gateChangeAllowed === true && !changed.some(p => policy.capabilities.some(c => c.paths.some(prefix => p.startsWith(prefix)))), "GATE_CHANGE_REQUIRES_REVIEW");
}
function selectRunners(changed, policy) {
  const runners = [...policy.requiredRunners, ...policy.incidents.flatMap(i => i.runners)];
  for (const capability of policy.capabilities) if (changed.some(p => capability.paths.some(prefix => p.startsWith(prefix)))) runners.push(...capability.runners);
  return [...new Set(runners)].sort();
}
function classifyRealE2e({ root, baseline, candidate, changed, policy }) {
  const manifest = policy.realE2e;
  // Old trusted policies keep their existing behavior during installation.
  if (!manifest) return { required: changed.some(p => policy.capabilities.some(c => c.paths.some(prefix => p.startsWith(prefix)))), source: "legacy-trusted-policy", requiredPaths: [], reviewedPaths: [] };
  insist(manifest.schemaVersion === 1 && Array.isArray(manifest.requiredPaths) && manifest.requiredPaths.length && manifest.requiredPaths.every(exact) && Array.isArray(manifest.reviewedTransitions), "INVALID_REAL_E2E_POLICY");
  for (const entry of manifest.reviewedTransitions) {
    insist(exact(entry.path) && /^[a-f0-9]{64}$/.test(entry.beforeSha256) && /^[a-f0-9]{64}$/.test(entry.afterSha256) && typeof entry.reason === "string" && entry.reason.trim(), "INVALID_REAL_E2E_REVIEW");
    if (entry.candidateFiles !== undefined) insist(Array.isArray(entry.candidateFiles) && entry.candidateFiles.length > 0 && entry.candidateFiles.every(file => file && exact(file.path) && /^[a-f0-9]{64}$/.test(file.sha256)) && new Set(entry.candidateFiles.map(file => file.path)).size === entry.candidateFiles.length, "INVALID_REAL_E2E_REVIEW_FILES");
  }
  const requiredPaths = [], reviewedPaths = [];
  const includesFile = (entry, file) => entry.path === file || (entry.candidateFiles || []).some(guard => guard.path === file);
  const read = (ref, file) => {
    // Exact regular-file contents. A symlink, deleted file or executable cannot
    // inherit approval; no source regex or candidate skip flag is trusted.
    insist(git(root, ["ls-tree", ref, "--", file]).startsWith("100644 blob "), "REAL_E2E_NOT_REGULAR_FILE");
    return digest(execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  };
  for (const file of changed.filter(p => manifest.requiredPaths.some(prefix => p.startsWith(prefix)) || manifest.reviewedTransitions.some(entry => includesFile(entry, p)))) {
    const reviewed = manifest.reviewedTransitions.filter(entry => includesFile(entry, file)).some(entry => {
      try {
        // Bind the entire reviewed attachment graph, not only server.js. Later
        // helper-only edits also require REAL unless separately reviewed.
        return read(baseline, entry.path) === entry.beforeSha256 && read(candidate, entry.path) === entry.afterSha256 && (entry.candidateFiles || []).every(guard => read(candidate, guard.path) === guard.sha256);
      } catch { return false; }
    });
    (reviewed ? reviewedPaths : requiredPaths).push(file);
  }
  return { required: requiredPaths.length > 0, source: "trusted-baseline-diff-policy", requiredPaths, reviewedPaths };
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

function validRealEvidence(real, candidate, plan = null) {
  if (plan) {
    const usage=real?.usage,results=real?.results;
    return Boolean(real && real.candidateSha===candidate && real.status==="PASS" && real.provider==="REAL_OPENAI_AND_POSTGRESQL" &&
      real.candidateDigest===plan.candidateDigest && real.planDigest===plan.planDigest && real.lineDelivery==="NOT_RUN" && real.quotaWrites===0 &&
      real.turns===plan.ids.length && Array.isArray(results) && JSON.stringify(results.map(r=>r.id))===JSON.stringify(plan.ids) &&
      results.every(r=>r.status==="PASS"&&Number.isInteger(r.calls)&&r.calls>=1&&r.calls<=2) &&
      usage?.status==="PASS" && usage.candidateDigest===plan.candidateDigest && usage.planDigest===plan.planDigest &&
      JSON.stringify(usage.completedCases)===JSON.stringify(plan.ids) && real.realCalls===usage.calls &&
      real.realCalls===results.reduce((n,r)=>n+r.calls,0) && real.realCalls<=plan.budget.maxCalls &&
      Number.isSafeInteger(usage.tokens)&&usage.tokens>=0 && real.totalTokens===usage.tokens && real.totalTokens<=plan.budget.maxTokens);
  }
  return Boolean(real && real.candidateSha === candidate && real.status === "PASS" && real.provider === "REAL_OPENAI_AND_POSTGRESQL" &&
    real.turns === 13 && Number.isInteger(real.realCalls) && real.realCalls >= 13 && real.realCalls <= 26 && real.lineDelivery === "NOT_RUN" && real.quotaWrites === 0);
}
function realRequirement({ installation, capabilityProtection, realClassification, force = false }) {
  return Boolean(installation.requireReal || realClassification.required || capabilityProtection?.plan.modelPathChanged || force);
}
function productParityRequired(changed, policy, protection) {
  return Boolean(protection && changed.some(file => !policy.governancePaths.includes(file) && !protection.product.metadata.includes(file)));
}
function validateReleaseEvidence(e, baseline, candidate, required, requireReal, realPlan = null) {
  validateEvidence(e, baseline, candidate, required);
  insist(e.realE2eRequired === requireReal, "REAL_REQUIREMENT_MISMATCH");
  insist(!requireReal || validRealEvidence(e.real, candidate, realPlan), "REAL_QUALIFICATION_NOT_PASS");
}

function runCommands({ root, cwd, candidate, baseline, commands, evidenceDir, protection = null }) {
  insist(!fs.existsSync(path.join(evidenceDir, "report.json")), "EVIDENCE_ALREADY_EXISTS");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const report = { schemaVersion: 1, baselineSha: baseline, candidateSha: candidate, status: "RUNNING", required: commands.map(c => c.id), results: [], stopPreservesWork: true };
  fs.writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(report, null, 2));
  const checkContent = () => {
    if (!protection) return;
    const c = require("./capability-guard-content");
    insist(c.contentDigest(c.workspaceTree(root, protection.ignored)) === protection.digest, "CANDIDATE_CONTENT_DRIFT");
  };
  for (const [index, command] of commands.entries()) {
    try { checkContent(); }
    catch (error) { report.status = "STOP"; report.reason = error.message; report.blockedRunner = command.id; break; }
    const r = spawnSync(command.argv[0], command.argv.slice(1), { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000,
      env: protection ? require("./capability-guard-execution").offlineEnvironment(path.join(evidenceDir, "network.jsonl"), protection.scratch) : { ...process.env, OPENAI_API_KEY: "", OPENAI_TEST_API_KEY: "", CORE_GATE_OPENAI_API_KEY: "", CORE_GATE_GITHUB_READ_TOKEN: "", LINE_CHANNEL_ACCESS_TOKEN: "" } });
    const log = String(r.stdout || "") + String(r.stderr || "") + (r.error ? "\n" + r.error.message : "");
    const logFile = `${String(index).padStart(3, "0")}.log`;
    fs.writeFileSync(path.join(evidenceDir, logFile), log);
    const skipped = /(?:^|\n)# skipped [1-9]|"status"\s*:\s*"(?:SKIP|NOT_RUN|NOT_EXECUTABLE)"/.test(log);
    const externalNetwork = protection && fs.existsSync(path.join(evidenceDir, "network.jsonl")) && fs.statSync(path.join(evidenceDir, "network.jsonl")).size > 0;
    let ok = r.status === 0 && !r.error && !skipped && !externalNetwork;
    try { checkContent(); }
    catch (error) { ok = false; report.reason = error.message; }
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
async function main(argv) {
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
  let contractReceipt;
  const requiresGovernanceReview = policy.capabilityProtection?.required === true && changed.some(p=>policy.governancePaths.includes(p));
  if (a["contract-review"] === "github" && (requiresGovernanceReview || changed.some(p => policy.protectedPaths.includes(p)))) {
    insist(!a["bootstrap-policy"], "CONTRACT_BOOTSTRAP_FORBIDDEN");
    const approval = require("./core-contract-approval");
    const descriptor = approval.describe({ root, baseline, candidate, task, policy, context: {
      repository: process.env.GITHUB_REPOSITORY, pullRequest: Number(process.env.CORE_CONTRACT_PR),
      runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT)
    } });
    contractReceipt = await approval.authorize(descriptor, policy, process.env.CORE_GATE_GITHUB_READ_TOKEN);
    verifyCheckout(root, candidate, task.preExistingUntracked || []);
  }
  if(requiresGovernanceReview)insist(require("./core-contract-approval").matchesGovernance(contractReceipt,changed,task,policy),"GOVERNANCE_APPROVAL_REQUIRED");
  validateDiff(changed, task, policy, contractReceipt);
  const coreChanged = changed.some(p => policy.capabilities.some(c => c.paths.some(prefix => p.startsWith(prefix))));
  const realClassification = classifyRealE2e({ root, baseline, candidate, changed, policy });
  const installation = require("./core-contract-approval").requirements(contractReceipt, policy);
  const runners = [...new Set([...selectRunners(changed, policy), ...installation.runners])].sort();
  const cwd = path.join(root, APP);
  for (const runner of runners) insist(exact(runner) && fs.existsSync(path.join(cwd, runner)), "MISSING_RUNNER: " + runner);
  const commands = runners.map(runner => ({ id: runner, argv: [process.execPath, runner] }));
  let capabilityProtection;
  if (policy.capabilityProtection?.required === true) {
    const guard = require("./capability-guard-execution");
    capabilityProtection = guard.trustedCommands({ root, trustedRoot: path.resolve(__dirname, "../../.."), baseline, task, contractReceipt });
    const ordered = [...capabilityProtection.commands, ...commands];
    commands.splice(0, commands.length, ...ordered.filter((c, i) => ordered.findIndex(x => x.id === c.id) === i));
  }
  if (installation.installationId) commands.unshift({ id: "git-diff-check", argv: ["git", "diff", "--check", baseline, candidate, "--"] });
  // Extract the trusted baseline lifecycle, so candidate package changes cannot
  // silently drop checks. Deduplicate explicit runner commands across all groups.
  const scripts = JSON.parse(git(root, ["show", `${baseline}:${APP}/package.json`])).scripts;
  for (const stage of policy.lifecycle) for (const command of (scripts[stage] || "").split(" && ")) {
    insist(/^node [a-zA-Z0-9./_-]+\.js$/.test(command), "UNSUPPORTED_LIFECYCLE_COMMAND: " + command);
    const runner = command.slice(5);
    if (!commands.some(c => c.id === runner)) commands.push({ id: runner, argv: [process.execPath, runner] });
  }
  const lockedContent = capabilityProtection ? require("./capability-guard-content").contentDigest(capabilityProtection.candidate) : null;
  const protection = capabilityProtection ? { digest: lockedContent, ignored: task.preExistingUntracked || [], scratch: path.join(path.resolve(a.evidence), "scratch") } : null;
  if (protection) fs.mkdirSync(protection.scratch, { recursive: true });
  const report = runCommands({ root, cwd, candidate, baseline, commands, evidenceDir: path.resolve(a.evidence), protection });
  if (capabilityProtection) {
    report.capabilityProtection = { impact: capabilityProtection.plan, candidateDigest: lockedContent, openAiCalls: 0 };
    const content = require("./capability-guard-content");
    insist(content.contentDigest(content.workspaceTree(root, task.preExistingUntracked || [])) === lockedContent, "CANDIDATE_CONTENT_DRIFT");
  }
  report.changedPaths = changed; report.coreChanged = coreChanged; report.approvedScopeDigest = a["approved-scope-digest"];
  if (contractReceipt) report.contractApproval = contractReceipt;
  report.realClassification = realClassification;
  const requireReal = realRequirement({ installation, capabilityProtection, realClassification, force: a["require-real"] === "true" });
  let realPlan = null;
  report.realE2eRequired = requireReal;
  if (installation.installationId) report.contractInstallation = installation;
  if (!report.realE2eRequired) report.real = { status: "NOT_REQUIRED", candidateSha: candidate, realCalls: 0, reason: realClassification.source };
  if (report.status === "PASS") {
    try {
      verifyCheckout(root, candidate, task.preExistingUntracked || []);
      validateEvidence(report, baseline, candidate, commands.map(c => c.id));
      for (const r of report.results) insist(digest(fs.readFileSync(path.join(path.resolve(a.evidence), r.logFile), "utf8")) === r.logSha256, "LOG_DIGEST_MISMATCH");
    } catch (e) { report.status = "STOP"; report.reason = e.message; }
  }
  if (report.status === "PASS" && report.realE2eRequired && capabilityProtection) {
    try {
      const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, "../tests/fixtures/core-reliability-real-cases.json"), "utf8"));
      const budgetGuard=require("./capability-guard-budget"),content=require("./capability-guard-content");
      const selection=budgetGuard.selectRealCases(capabilityProtection.plan,capabilityProtection.verification,oracle);
      const productDigest=content.contentDigest(capabilityProtection.candidate,capabilityProtection.product.mustMatch);
      budgetGuard.authorizeReal(task.realBudget, {deterministic:true,scopeApproved:process.env.CORE_GATE_REAL_APPROVED==="true",
        candidateDigest:productDigest,modelPathChanged:capabilityProtection.plan.modelPathChanged,affectedCases:selection.ids});
      insist(JSON.stringify(task.realBudget.cases)===JSON.stringify(selection.ids),"REAL_AFFECTED_SET_MISMATCH");
      insist(Number.isInteger(task.realBudget.maxOutputTokensPerCall)&&task.realBudget.maxOutputTokensPerCall>0,"REAL_OUTPUT_BUDGET_REQUIRED");
      realPlan={...selection,candidateDigest:productDigest,budget:task.realBudget,candidateSha:candidate};
      realPlan.planDigest=content.hash(realPlan);report.realPlan=realPlan;
      fs.writeFileSync(path.join(path.resolve(a.evidence),"real-plan.json"),JSON.stringify(realPlan,null,2),{flag:"wx"});
    } catch (error) { report.status = "BLOCKED_REAL_BUDGET"; report.reason = error.message; }
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
      env: { ...process.env, CORE_GATE_CANDIDATE_SHA: candidate, CORE_GATE_EVIDENCE_DIR: realDir, ...(realPlan ? { CORE_GATE_REAL_PLAN_FILE: path.join(path.resolve(a.evidence),"real-plan.json") } : {}) } });
    fs.writeFileSync(path.join(path.resolve(a.evidence), "real-execution.log"), String(result.stdout || "") + String(result.stderr || ""));
    if (result.status !== 0) report.status = "STOP";
    else {
      const real = JSON.parse(fs.readFileSync(path.join(realDir, "real-report.json"), "utf8"));
      const valid = validRealEvidence(real, candidate, realPlan) && (!realPlan || real.usage?.usageSha256 === require("./capability-guard-content").hash(fs.readFileSync(path.join(realDir,"usage.jsonl"))));
      report.status = valid ? "PASS" : "STOP";
      report.real = real;
    }
  }
  if (report.status === "PASS") {
    try {
      verifyCheckout(root, candidate, task.preExistingUntracked || []);
      validateReleaseEvidence(report, baseline, candidate, commands.map(c => c.id), requireReal, realPlan);
      if (productParityRequired(changed, policy, capabilityProtection)) {
        const content = require("./capability-guard-content");
        insist(task.productValidation?.testCommit && task.productValidation?.lock, "ACCEPTED_TEST_CONTENT_LOCK_REQUIRED");
        report.productParity = content.promotion(content.gitTree(root, task.productValidation.testCommit),
          content.workspaceTree(root, task.preExistingUntracked || []), capabilityProtection.product, task.productValidation.lock);
        insist(capabilityProtection.product.physicalSchema?.status === "MATCH"
          && capabilityProtection.product.physicalSchema.productionDigest === capabilityProtection.product.physicalSchema.testDigest
          && capabilityProtection.product.physicalSchema.productionDigest, "SCHEMA_PARITY_UNPROVEN");
      }
    }
    catch (e) { report.status = "STOP"; report.reason = e.message; }
  }
  fs.writeFileSync(path.join(path.resolve(a.evidence), "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (report.status !== "PASS") process.exitCode = 1;
}
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error("RELIABILITY_GATE_STOP: " + e.message); process.exitCode = 1; });
module.exports = { digest, changedPaths, verifyCheckout, validateTask, validateDiff, selectRunners, validateEvidence, validateReleaseEvidence, validRealEvidence, realRequirement, productParityRequired, runCommands };
