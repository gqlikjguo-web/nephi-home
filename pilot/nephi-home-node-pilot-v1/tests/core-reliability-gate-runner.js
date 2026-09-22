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
// REAL admission is separate from deterministic impact. Expectations below are
// literal release contracts; candidate declarations never select qualification.
function verifyRealClassification() {
  const installedPolicy = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../.github/core-reliability-policy.json"), "utf8"));
  const examples = [
    { name: "transport keeps deterministic checks without REAL", file: "lib/line-transport.js", required: false },
    { name: "operator UI", file: "public/admin.js", required: false },
    { name: "image storage", file: "lib/property-image-store.js", required: false },
    { name: "image attachments", file: "lib/property-image-attachments.js", required: false },
    { name: "Understanding cannot skip", file: "lib/new-core/understanding.js", required: true },
    { name: "Context cannot skip", file: "lib/new-core/context.js", required: true },
    { name: "CanonicalRequest cannot skip", file: "lib/new-core/canonical.js", required: true },
    { name: "OpenAI Contract cannot skip", file: "lib/providers/openai-understanding-v1.js", required: true },
    { name: "persisted Context/history cannot skip", file: "lib/providers/postgres-worker.js", required: true },
    { name: "composition root cannot skip", file: "lib/v2-composition-root.js", required: true },
    { name: "property interpretation cannot skip", file: "lib/property-facts.js", required: true },
    { name: "JSON property projection cannot skip", file: "lib/providers/json-providers.js", required: true },
    { name: "PostgreSQL property projection cannot skip", file: "lib/providers/postgres-providers.js", required: true },
    { name: "server core wiring cannot skip", file: "server.js", required: true },
    { name: "conversation Contract cannot skip", file: "lib/conversation-contracts/conversation-state-v3.js", required: true },
    { name: "runtime configuration cannot skip", file: "config/runtime.json", required: true },
    { name: "decision boundary cannot skip", file: "lib/conversation-engine-v2/final-decision.js", required: true },
    { name: "reviewed attachment-only bridge", file: "lib/conversation-engine-v2/claim-validator.js", required: false, reviewed: true },
    { name: "core edit hidden beside approved attachment", file: "lib/conversation-engine-v2/claim-validator.js", required: true, reviewed: true, tampered: true },
    { name: "bridge removal is not an exemption", file: "lib/conversation-engine-v2/claim-validator.js", required: true, reviewed: true, deleted: true },
    { name: "core rename into image path", file: "lib/new-core/understanding.js", required: true, renamed: true },
    { name: "forced REAL remains available", file: "public/admin.js", required: true, force: true },
    { name: "candidate policy forgery fails", file: "lib/new-core/understanding.js", policyForgery: true },
    { name: "transport runner failure still stops", file: "lib/line-transport.js", runnerFails: true }
  ];
  for (const example of examples) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-real-admission-"));
    const g = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const write = (name, content) => { const target = path.join(dir, name); fs.mkdirSync(path.dirname(target), {recursive:true}); fs.writeFileSync(target, content); };
    const file = app + "/" + example.file, before = "module.exports = {decision: 'unchanged'};\n", approved = before + "// approved attachment metadata\n";
    const manifest = { protectedPaths: [], governancePaths: [".github/core-reliability-policy.json"],
      capabilities: [{paths:[app + "/"], runners:["tests/check.js"]}], incidents: [], requiredRunners:["tests/check.js"], lifecycle:["test"],
      realE2e: { schemaVersion:1, requiredPaths:installedPolicy.realE2e.requiredPaths,
        reviewedTransitions: example.reviewed ? [{path:file, beforeSha256:gate.digest(before), afterSha256:gate.digest(approved), reason:"independently reviewed attachment-only bridge"}] : [] } };
    write(file, before); write(app+"/tests/check.js", "require('node:assert/strict').equal(true," + String(!example.runnerFails) + ");\n");
    write(app+"/package.json", JSON.stringify({scripts:{test:"node tests/check.js"}}));
    write(".github/core-reliability-policy.json", JSON.stringify(manifest));
    g("init","-q");g("config","user.email","gate@example.invalid");g("config","user.name","Gate isolated classification");g("add",".");g("commit","-qm","trusted admission policy");
    const base=g("rev-parse","HEAD");
    const changed = [file,".github/core-reliability-task.json"];
    if(example.renamed){ const renamed=app+"/lib/property-image-renamed.js";fs.renameSync(path.join(dir,file),path.join(dir,renamed));changed.push(renamed); }
    else if(example.deleted)fs.unlinkSync(path.join(dir,file));
    else write(file, example.tampered ? approved.replace("'unchanged'","'wrong decision'") : approved);
    if(example.policyForgery){write(".github/core-reliability-policy.json",JSON.stringify({...manifest,realE2e:{schemaVersion:1,requiredPaths:[],reviewedTransitions:[]}}));changed.push(".github/core-reliability-policy.json");}
    const scope={schemaVersion:1,baseline:base,objective:example.name,allowedPaths:changed,contractChangeAllowed:false,affectedCapabilities:[],realE2eRequired:false,skipRealE2e:true};
    write(".github/core-reliability-task.json",JSON.stringify(scope));g("add",".");g("commit","-qm","candidate");const head=g("rev-parse","HEAD");
    const evidenceDir=fs.mkdtempSync(path.join(os.tmpdir(),"junzan-real-admission-evidence-"));
    const execution=spawnSync(process.execPath,[gatePath,"--root",dir,"--baseline",base,"--candidate",head,"--approved-scope-digest",gate.digest(scope),"--evidence",evidenceDir,"--require-real",String(Boolean(example.force))],{encoding:"utf8",env:{...process.env,CORE_GATE_OPENAI_API_KEY:""}});
    if(example.policyForgery){assert.equal(execution.status,1);assert.match(execution.stderr,/GATE_CHANGE_REQUIRES_REVIEW/);cases++;continue;}
    const report=JSON.parse(fs.readFileSync(path.join(evidenceDir,"report.json"),"utf8"));
    if(example.runnerFails){assert.equal(execution.status,1);assert.equal(report.status,"STOP");assert.equal(report.results[0].status,"FAIL");cases++;continue;}
    assert.equal(report.status,example.required?"BLOCKED_CREDENTIAL":"PASS",example.name);
    assert.equal(execution.status,example.required?1:0,example.name);
    assert.equal(report.realE2eRequired,example.required,example.name);
    assert.equal(report.results.length,1,"deterministic affected runner still executes exactly once");
    assert.equal(report.results[0].status,"PASS");assert.equal(report.candidateSha,head);
    assert.equal(report.real.status,example.required?"BLOCKED_CREDENTIAL":"NOT_REQUIRED");
    assert.equal(report.real.realCalls,0);cases++;
  }
}
verifyRealClassification();
// Actual independently reviewed room-gallery transition, not a server filename
// exemption. The fixture is the original candidate's exact Git diff. This
// historical baseline is permanent evidence, not the current runtime snapshot.
function verifyRoomGalleryRouteClassification() {
  const repo = path.resolve(__dirname, "../../..");
  const serverPath = app + "/server.js";
  const fixturePath = app + "/tests/fixtures/room-gallery-server-route.patch";
  const installed = JSON.parse(fs.readFileSync(path.join(repo, ".github/core-reliability-policy.json"), "utf8"));
  const original = execFileSync("git", ["show", "df393f7bd3c23554c5f433c9cc9a80181ad6a7be:" + serverPath], {cwd:repo,encoding:"utf8"});
  const patch = fs.readFileSync(path.join(repo, fixturePath), "utf8");
  const modulesPath = app + "/tests/fixtures/room-gallery-reviewed-modules.json";
  const modules = JSON.parse(fs.readFileSync(path.join(repo, modulesPath), "utf8"));
  const helperPath = app + "/lib/room-gallery-routes.js";
  const r2devFixture = app + "/tests/fixtures/room-gallery-r2dev-approved.patch";
  const r2devPatch = fs.readFileSync(path.join(repo,r2devFixture),"utf8");
  const probes = [
    {name:"approved r2.dev policy transition",required:false,r2dev:true},
    {name:"r2.dev plus unreviewed adapter byte",required:true,r2dev:true,dependency:app+"/lib/room-gallery-r2.js"},
    {name:"r2.dev plus AI Context",required:true,r2dev:true,serverCore:true},
    {name:"approved actual room-gallery route",required:false},
    {name:"same server with unreviewed handler",required:true,helper:true},
    {name:"later handler edit with unchanged server",required:true,helper:true,later:true},
    ...["room-gallery-runtime.js", "room-gallery-store.js", "room-gallery-r2.js"].map(file=>({name:"altered reviewed dependency "+file,required:true,dependency:app+"/lib/"+file})),
    {name:"executable handler cannot inherit approval",required:true,helperExecutable:true},
    {name:"missing reviewed handler",required:true,missingHelper:true},
    {name:"symlink reviewed handler",required:true,helperSymlink:true},
    {name:"route plus server AI Context wiring",required:true,serverCore:true},
    {name:"route plus Understanding change",required:true,coreFile:"lib/new-core/understanding.js"},
    {name:"route plus OpenAI provider change",required:true,coreFile:"lib/providers/openai-understanding-v1.js"},
    {name:"route plus CanonicalRequest change",required:true,coreFile:"lib/conversation-contracts/canonical-request.js"},
    {name:"route plus FinalDecision change",required:true,coreFile:"lib/conversation-engine-v2/final-decision.js"},
    {name:"unreviewed extra route byte cannot reuse approval",required:true,extra:true},
    {name:"different server baseline cannot reuse approval",required:true,wrongBase:true},
    {name:"server symlink cannot reuse approval",required:true,symlink:true},
    {name:"candidate cannot rewrite reviewed manifest",forged:true}
  ];
  for(const probe of probes) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"junzan-gallery-gate-"));
    const g=(...args)=>execFileSync("git",args,{cwd:dir,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
    const write=(name,value)=>{const p=path.join(dir,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);};
    const policy={protectedPaths:[],governancePaths:[".github/core-reliability-policy.json",fixturePath],capabilities:[{paths:[app+"/"],runners:["tests/check.js"]}],incidents:[],requiredRunners:["tests/check.js"],lifecycle:["test"],realE2e:installed.realE2e};
    write(serverPath,original+(probe.wrongBase?"\n// different base\n":""));
    write(app+"/tests/check.js","require('node:assert/strict').equal(2 + 2, 4);\n");
    write(app+"/package.json",JSON.stringify({scripts:{test:"node tests/check.js"}}));
    write(".github/core-reliability-policy.json",JSON.stringify(policy));
    g("init","-q");g("config","user.email","gate@example.invalid");g("config","user.name","Gallery gate isolated");g("add",".");g("commit","-qm","trusted policy");
    let base=g("rev-parse","HEAD");
    execFileSync("git",["apply","--whitespace=error"],{cwd:dir,input:patch,stdio:["pipe","pipe","pipe"]});
    for(const [file,contents] of Object.entries(modules)) write(file,contents);
    if(probe.r2dev) execFileSync("git",["apply","--whitespace=error"],{cwd:dir,input:r2devPatch,stdio:["pipe","pipe","pipe"]});
    if(probe.later){g("add",".");g("commit","-qm","reviewed gallery installed");base=g("rev-parse","HEAD");}
    const changed=[serverPath,...Object.keys(modules),".github/core-reliability-task.json"];
    if(probe.helper) fs.appendFileSync(path.join(dir,helperPath),"\n// unreviewed handler change\n");
    if(probe.dependency) fs.appendFileSync(path.join(dir,probe.dependency),"\n// unreviewed dependency change\n");
    if(probe.helperExecutable) fs.chmodSync(path.join(dir,helperPath),0o755);
    if(probe.missingHelper) fs.unlinkSync(path.join(dir,helperPath));
    if(probe.helperSymlink){fs.renameSync(path.join(dir,helperPath),path.join(dir,helperPath+".target"));fs.symlinkSync("room-gallery-routes.js.target",path.join(dir,helperPath));changed.push(helperPath+".target");}
    if(probe.serverCore){const p=path.join(dir,serverPath),s=fs.readFileSync(p,"utf8");assert.ok(s.includes("useConversationContext: false"));fs.writeFileSync(p,s.replace("useConversationContext: false","useConversationContext: true"));}
    if(probe.coreFile){write(app+"/"+probe.coreFile,"module.exports = {changed: true};\n");changed.push(app+"/"+probe.coreFile);}
    if(probe.extra)fs.appendFileSync(path.join(dir,serverPath),"\n// additional unreviewed change\n");
    if(probe.symlink){fs.renameSync(path.join(dir,serverPath),path.join(dir,serverPath+".target"));fs.symlinkSync("server.js.target",path.join(dir,serverPath));changed.push(serverPath+".target");}
    if(probe.forged){write(".github/core-reliability-policy.json",JSON.stringify({...policy,realE2e:{...policy.realE2e,requiredPaths:[]}}));changed.push(".github/core-reliability-policy.json");}
    const scope={schemaVersion:1,baseline:base,objective:probe.name,allowedPaths:changed,contractChangeAllowed:false,affectedCapabilities:[],skipRealE2e:true};
    write(".github/core-reliability-task.json",JSON.stringify(scope));g("add",".");g("commit","-qm","candidate");const head=g("rev-parse","HEAD");
    const evidenceDir=fs.mkdtempSync(path.join(os.tmpdir(),"junzan-gallery-classification-"));
    const execution=spawnSync(process.execPath,[gatePath,"--root",dir,"--baseline",base,"--candidate",head,"--approved-scope-digest",gate.digest(scope),"--evidence",evidenceDir],{encoding:"utf8",env:{...process.env,CORE_GATE_OPENAI_API_KEY:""}});
    if(probe.forged){assert.equal(execution.status,1);assert.match(execution.stderr,/GATE_CHANGE_REQUIRES_REVIEW/);cases++;continue;}
    const report=JSON.parse(fs.readFileSync(path.join(evidenceDir,"report.json"),"utf8"));
    assert.equal(report.realE2eRequired,probe.required,probe.name);
    assert.equal(report.status,probe.required?"BLOCKED_CREDENTIAL":"PASS",probe.name);
    assert.equal(execution.status,probe.required?1:0,probe.name);
    assert.equal(report.results.length,1);assert.equal(report.results[0].status,"PASS");
    assert.equal(report.real.realCalls,0);assert.equal(report.candidateSha,head);cases++;
  }
  assert.ok(installed.governancePaths.includes(fixturePath),"reviewed diff fixture must remain governance-protected");cases++;
  assert.ok(installed.governancePaths.includes(modulesPath),"reviewed module fixture must remain governance-protected");cases++;
  assert.ok(installed.governancePaths.includes(r2devFixture),"approved URL policy fixture must remain governance-protected");cases++;
}
verifyRoomGalleryRouteClassification();
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
