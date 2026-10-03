"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const content = require("./capability-guard-content");
const { impact, requiredRunners, verifyEvidence } = require("./capability-guard-impact");
const APP = "pilot/nephi-home-node-pilot-v1";
const manifests = ["capability-baseline", "core-impact-manifest", "core-verification-manifest", "product-content-policy"];
function read(root, name) { return JSON.parse(fs.readFileSync(path.join(root, ".github", name + ".json"), "utf8")); }
function validateImports(tree, dependency, changedPaths) {
  const owners = new Map(dependency.nodes.flatMap(n => n.files.map(p => [p,n])));
  for (const file of changedPaths.filter(p => owners.has(p) && p.endsWith(".js"))) {
    const source = tree.get(file)?.content?.toString(); if (!source) continue;
    // Static JS import paths only; never guest text or natural-language semantics.
    for (const match of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!match[1].startsWith(".")) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      const resolved = [target, target + ".js", target + ".json", target + "/index.js"].find(p => owners.has(p));
      content.insist(!resolved || owners.get(file).dependsOn.includes(owners.get(resolved).id), "UNDECLARED_DEPENDENCY: " + file);
      content.insist(![target, target + ".js", target + ".json"].some(p => p.includes("/tests/") || p.includes("test-support/")), "TEST_DATA_RUNTIME_IMPORT");
    }
  }
}
function prepare({ root, trustedRoot, baseline, task, contractReceipt = null, localDraft = false }) {
  const [capabilities, dependency, verification, product] = manifests.map(name => read(trustedRoot, name));
  const before = content.gitTree(root, baseline), candidate = content.workspaceTree(root, task.preExistingUntracked || []);
  const changedPaths = content.changed(before, candidate), plan = impact(dependency, capabilities, changedPaths, task);
  const reviewedGovernance = !localDraft && require("./core-contract-approval").matchesGovernance(contractReceipt,changedPaths,task,read(trustedRoot,"core-reliability-policy"));
  for (const name of manifests) if (!localDraft && !reviewedGovernance) content.assertTrustedManifest(read(trustedRoot,name),read(root,name));
  validateImports(candidate, dependency, changedPaths);
  const baselineInputs = new Set([...before.keys()].filter(p => p.startsWith(APP + "/tests/") || p.startsWith("tests/")));
  for (const file of changedPaths) if (baselineInputs.has(file) && !localDraft)
    content.insist(reviewedGovernance || contractReceipt && require("./core-contract-approval").matches(contractReceipt, changedPaths, task, read(trustedRoot, "core-reliability-policy")), "BASELINE_EXPECTATION_CHANGE_REQUIRES_TRUSTED_CONTRACT_REVIEW");
  content.insist(plan.CHANGED_COMPONENTS.length === 0 || Array.isArray(task.redRunners) && task.redRunners.length, "RED_RUNNER_DECLARATION_REQUIRED");
  return { candidate, changedPaths, plan, verification, product, commands: requiredRunners(plan, verification, task.redRunners || []) };
}
function offlineEnvironment(audit, scratch) {
  const env = {};
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "SHELL", "NODE_PATH", "PLAYWRIGHT_MODULE", "PLAYWRIGHT_BROWSERS_PATH", "LD_LIBRARY_PATH"])
    if (process.env[key]) env[key] = process.env[key];
  env.TMPDIR = scratch; env.CAPABILITY_NETWORK_AUDIT = audit;
  env.NODE_OPTIONS = "--require=" + path.join(__dirname, "capability-guard-offline.cjs");
  return env;
}
function runnerCommand(root, runner, approvedRunners) {
  content.insist(approvedRunners.includes(runner), "UNAPPROVED_RUNNER");
  if (runner === "diff") return { executable: "git", argv: ["diff", "--check"] };
  content.insist(typeof runner === "string" && !path.posix.isAbsolute(runner), "INVALID_RUNNER_PATH");
  const relative = path.posix.normalize(path.posix.join(APP, runner));
  content.insist(content.exact(relative) && path.posix.relative(APP, relative) === runner && relative.endsWith(".js"), "INVALID_RUNNER_PATH");
  const file = path.join(root, relative);
  content.insist(fs.existsSync(file) && fs.lstatSync(file).isFile(), "MISSING_RUNNER");
  const actual = path.relative(fs.realpathSync(root), fs.realpathSync(file));
  content.insist(content.exact(actual), "RUNNER_OUTSIDE_REPOSITORY");
  return { executable: process.execPath, argv: [runner] };
}
function execute({ root, task, prepared, evidenceDir }) {
  content.insist(!fs.existsSync(evidenceDir), "EVIDENCE_ALREADY_EXISTS_PRESERVE_STOP");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const scratch = path.join(evidenceDir, "scratch"); fs.mkdirSync(scratch);
  const audit = path.join(evidenceDir, "network.jsonl"), lockPath = path.join(evidenceDir, "candidate-lock.json");
  const lock = content.writeLock(lockPath, prepared.candidate);
  const report = { classification: "STRUCTURED_CONTRACT_TEST/FAKE_INTEGRATION", installation: "LOCAL_ONLY_UNTIL_TRUSTED_INSTALL", candidateDigest: lock.candidateDigest,
    status: "RUNNING", openAiCalls: 0, required: prepared.commands, impact: prepared.plan, results: [], stopPreservesWork: true };
  const save = () => fs.writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(report, null, 2));
  save();
  for (const [index, runner] of prepared.commands.entries()) {
    let command;
    try {
      content.checkLock(lockPath, content.workspaceTree(root, task.preExistingUntracked || []));
      command = runnerCommand(root, runner, prepared.commands);
    } catch (error) {
      report.status = "STOP"; report.blockedRunner = runner; report.reason = error.message;
      save(); return report;
    }
    const logfile = path.join(evidenceDir, `${String(index + 1).padStart(3,"0")}.log`), fd = fs.openSync(logfile, "wx");
    const start = Date.now();
    const run = spawnSync(command.executable, command.argv, { cwd: path.join(root, APP), stdio: ["ignore", fd, fd], timeout: 600000,
      env: offlineEnvironment(audit, scratch) }); fs.closeSync(fd);
    const log = fs.readFileSync(logfile, "utf8");
    const skipped = /(?:^|\n)# skipped [1-9]|"status"\s*:\s*"(?:SKIP|NOT_RUN|NOT_EXECUTABLE)"/.test(log);
    const violation = fs.existsSync(audit) && fs.statSync(audit).size > 0;
    const row = { id: runner, candidateDigest: lock.candidateDigest, exitCode: run.status,
      status: run.status === 0 && !run.error && !skipped && !violation ? "PASS" : "FAIL", logFile: path.basename(logfile), logSha256: content.hash(log), durationMs: Date.now()-start };
    report.results.push(row);
    try { content.checkLock(lockPath, content.workspaceTree(root, task.preExistingUntracked || [])); }
    catch (e) { row.status = "FAIL"; report.reason = e.message; }
    if (row.status !== "PASS") report.status = "STOP";
    save(); process.stdout.write(JSON.stringify({ index:index+1, total:prepared.commands.length, ...row }) + "\n");
    if (report.status === "STOP") return report;
  }
  report.status = "PASS";
  verifyEvidence({ ...report, results: report.results.map(r => ({ ...r, log: fs.readFileSync(path.join(evidenceDir, r.logFile), "utf8") })) }, lock.candidateDigest, report.required);
  save(); return report;
}
function trustedCommands({ root, trustedRoot, baseline, task, contractReceipt }) {
  const prepared = prepare({ root, trustedRoot, baseline, task, contractReceipt });
  return { ...prepared, commands: prepared.commands.map(id => {
    const command = runnerCommand(root, id, prepared.commands);
    return { id, argv: [command.executable, ...command.argv] };
  }) };
}
function cli(argv) {
  const args = {}; for (let i=0;i<argv.length;i+=2) { content.insist(argv[i]?.startsWith("--") && argv[i+1], "ARGUMENT_REQUIRED"); args[argv[i].slice(2)] = argv[i+1]; }
  const root = path.resolve(args.root || "."), trustedRoot = path.resolve(args["trusted-root"] || root);
  const task = read(root,"core-reliability-task");
  const prepared = prepare({ root, trustedRoot, baseline:task.baseline, task, localDraft:args["local-draft"] === "true" });
  if (args.mode === "plan") { console.log(JSON.stringify(prepared.plan,null,2)); return; }
  content.insist(args.mode === "verify" && args.evidence, "EXPLICIT_VERIFY_EVIDENCE_REQUIRED");
  const report = execute({ root, task, prepared, evidenceDir:path.resolve(args.evidence) });
  if (report.status !== "PASS") process.exitCode=1;
}
if (require.main === module) { try { cli(process.argv.slice(2)); } catch(e) { console.error("CAPABILITY_GUARD_STOP: " + e.message); process.exitCode=1; } }
module.exports = { prepare, execute, offlineEnvironment, trustedCommands, validateImports, runnerCommand };
