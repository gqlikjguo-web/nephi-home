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

function storageGovernanceRoutingFixture(includeRuntime = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-governance-routing-"));
  const g = (...args) => cp.execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const policyPath = ".github/core-reliability-policy.json";
  const storagePaths = [
    "pilot/nephi-home-node-pilot-v1/scripts/test-storage-guard.js",
    "pilot/nephi-home-node-pilot-v1/tests/test-storage-guard-runner.js"
  ];
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  write(policyPath, "trusted policy\n"); write("runtime.js", "trusted runtime\n");
  g("init", "-q"); g("config", "user.name", "Governance routing test"); g("config", "user.email", "test@example.invalid");
  g("add", "."); g("commit", "-qm", "trusted governance baseline"); const base = g("rev-parse", "HEAD");
  const scope = { schemaVersion: 1, baseline: base, objective: "exact storage governance paths", allowedPaths: [taskPath, policyPath, ...storagePaths, ...(includeRuntime ? ["runtime.js"] : [])], contractChangeAllowed: false, gateChangeAllowed: true, affectedCapabilities: ["governance"] };
  write(taskPath, JSON.stringify(scope)); write(policyPath, "candidate policy\n");
  for (const file of storagePaths) write(file, "governance only\n");
  if (includeRuntime) write("runtime.js", "masquerading runtime\n");
  g("add", "."); g("commit", "-qm", "governance routing candidate");
  const installed = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../.github/core-reliability-policy.json"), "utf8"));
  const routingPolicy = { ...installed, contractReview: policy.contractReview, capabilities: [{ paths: ["runtime.js"], runners: [] }] };
  return { root: dir, baseline: base, candidate: g("rev-parse", "HEAD"), task: scope, policy: routingPolicy, context };
}
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
  assert.ok(url.startsWith("https://api.github.com/repos/owner/repo/"));
  const suffix = url.slice("https://api.github.com/repos/owner/repo".length);
  assert.ok(Object.hasOwn(replies, suffix), suffix);
  return { ok: true, json: async () => structuredClone(replies[suffix]) };
};

// Atomic installation fixtures retain independent Git histories; no release files are mutated.
function atomicFixture(change, observabilityOnly = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-atomic-contract-"));
  const g = (...args) => cp.execFileSync("git", args, {cwd:dir,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true}); fs.writeFileSync(path.join(dir,file),text); };
  write(a,"old specification\n"); write("runtime.js","old runtime\n");
  g("init","-q");g("config","user.name","Atomic test");g("config","user.email","test@example.invalid");g("add",".");g("commit","-qm","original product");
  const sourceBaseline=g("rev-parse","HEAD");
  write("policy.json","reviewed governance\n");
  if(change==="baseline-drift")write("unreviewed-runtime.js","changed before release\n");
  g("add",".");g("commit","-qm","governance installation");const base=g("rev-parse","HEAD");
  const additions={[a]:"new specification\n","runtime.js":"new runtime\n",[b]:"new regression\n"};
  const registration={id:"reviewed-release",sourceBaseline,baselineGovernancePaths:["policy.json",taskPath],
    protectedPaths:[a,b],requireReal:!observabilityOnly,
    ...(observabilityOnly ? { semanticImpact:"OBSERVABILITY_ONLY" } : {}),
    requiredRunners:["tests/a.js","tests/b.js"],
    files:Object.entries(additions).map(([file,text])=>({path:file,beforeSha256:file===b?null:contract.digest(file===a?"old specification\n":"old runtime\n"),afterSha256:contract.digest(text)})).sort((x,y)=>x.path.localeCompare(y.path))};
  const trusted={...structuredClone(policy),atomicContractInstallations:[registration],
    ...(observabilityOnly ? {realE2e:{schemaVersion:1,requiredPaths:["runtime.js"],reviewedTransitions:[{
      path:"runtime.js",beforeSha256:contract.digest("old runtime\n"),afterSha256:contract.digest("new runtime\n"),reason:"exact independently reviewed observability-only transition"
    }]}} : {})};
  const scope={schemaVersion:1,baseline:base,objective:"exact reviewed combination",allowedPaths:[taskPath,...Object.keys(additions)].sort(),contractChangeAllowed:true,gateChangeAllowed:false,affectedCapabilities:[],contractInstallationId:registration.id};
  for(const [file,text] of Object.entries(additions))write(file,text);
  if(change==="content")write("runtime.js","unreviewed runtime\n");
  if(change==="extra"){write("other-runtime.js","extra\n");scope.allowedPaths.push("other-runtime.js");}
  if(change==="governance"){write("policy.json","candidate approval policy\n");scope.allowedPaths.push("policy.json");}
  if(change==="mode")fs.chmodSync(path.join(dir,"runtime.js"),0o755);
  if(change==="symlink"){fs.unlinkSync(path.join(dir,"runtime.js"));fs.symlinkSync(a,path.join(dir,"runtime.js"));}
  if(change==="deleted")fs.unlinkSync(path.join(dir,"runtime.js"));
  if(change==="missing-spec")fs.unlinkSync(path.join(dir,b));
  write(taskPath,JSON.stringify(scope));g("add",".");g("commit","-qm","reviewed combination");
  const head=g("rev-parse","HEAD");
  return {root:dir,baseline:base,candidate:head,task:scope,policy:trusted,context,registration};
}
async function verifyAtomicInstallation() {
  const f=atomicFixture(),d=contract.describe(f);
  assert.equal(d.installationId,"reviewed-release");assert.equal(d.installationDigest,contract.digest(f.registration));
  assert.deepEqual(d.files,f.registration.files);cases++;
  const reset=()=>{
    replies={
      "/actions/runs/6":{id:6,run_attempt:1,event:"pull_request_target",path:policy.contractReview.workflow,head_sha:f.candidate,repository:{full_name:"owner/repo"}},
      "/pulls/5":{state:"open",head:{sha:f.candidate,repo:{full_name:"owner/repo"}},base:{sha:f.baseline,ref:"production"}},
      "/branches/production":{commit:{sha:f.baseline}},
      "/actions/runs/6/approvals":[{state:"approved",comment:`CONTRACT_RUNTIME_INSTALL_APPROVED ${contract.digest(d)} REVIEW_SHA256=${"c".repeat(64)}`,environments:[{id:12,name:"core-scope-approval"}],user:{id:34}}]
    };
  };
  reset();const receipt=await contract.authorize(d,f.policy,"fixture-read-only");
  gate.validateDiff(d.changedPaths,f.task,f.policy,receipt);cases++;
  assert.deepEqual(contract.requirements(receipt,f.policy),{installationId:"reviewed-release",runners:f.registration.requiredRunners,requireReal:true});cases++;
  fails(()=>contract.requirements(JSON.parse(JSON.stringify(receipt)),f.policy),/CONTRACT_RECEIPT_REQUIRED/);
  fails(()=>gate.validateDiff(d.changedPaths,f.task,f.policy,{verified:true}),/CONTRACT_CHANGE_REQUIRED/);
  for(const alteration of [
    ()=>{replies["/actions/runs/6/approvals"]=[];},
    ()=>{replies["/actions/runs/6/approvals"][0].comment="approved";},
    ()=>{replies["/actions/runs/6/approvals"][0].comment=`CONTRACT_CHANGE_APPROVED ${contract.digest(d)} REVIEW_SHA256=${"c".repeat(64)}`;},
    ()=>{replies["/actions/runs/6/approvals"][0].user.id=99;},
    ()=>{replies["/actions/runs/6/approvals"][0].environments[0].id=99;},
    ()=>{replies["/actions/runs/6"].run_attempt=2;},
    ()=>{replies["/actions/runs/6"].head_sha=f.baseline;},
    ()=>{replies["/pulls/5"].head.sha=f.baseline;},
    ()=>{replies["/branches/production"].commit.sha=f.candidate;}
  ]) {reset();alteration();await assert.rejects(()=>contract.authorize(d,f.policy,"fixture-read-only"),/CONTRACT_/);cases++;}
  for(const key of ["diffSha256","taskDigest","policyDigest","installationDigest"]){
    reset();await assert.rejects(()=>contract.authorize({...d,[key]:"b".repeat(64)},f.policy,"fixture-read-only"),/CONTRACT_/);cases++;
  }
  for(const change of ["content","extra","governance","mode","symlink","deleted","missing-spec","baseline-drift"]){
    fails(()=>contract.describe(atomicFixture(change)),/ATOMIC_/);
  }
  for(const mutation of [
    x=>{delete x.policy.atomicContractInstallations;},
    x=>{x.task.contractInstallationId="candidate-invented";},
    x=>{x.task.gateChangeAllowed=true;},
    x=>{x.task.allowedPaths.push("unreviewed.js");},
    x=>{x.policy.atomicContractInstallations[0].files[0].path="tests/**";},
    x=>{x.policy.atomicContractInstallations[0].requireReal=false;},
    x=>{x.policy.atomicContractInstallations[0].requiredRunners=[];}
  ]){const probe=structuredClone(f);mutation(probe);fails(()=>contract.describe(probe),/ATOMIC_/);}
  const changedPolicy=structuredClone(f.policy);changedPolicy.atomicContractInstallations[0].files[0].afterSha256="d".repeat(64);
  fails(()=>gate.validateDiff(d.changedPaths,f.task,changedPolicy,receipt),/CONTRACT_CHANGE_REQUIRED/);
  fails(()=>contract.requirements(receipt,changedPolicy),/CONTRACT_RECEIPT_REQUIRED/);
  const returned=contract.requirements(receipt,f.policy);returned.runners.length=0;
  assert.equal(contract.requirements(receipt,f.policy).runners.length,2);cases++;

  const observation=atomicFixture(undefined,true),od=contract.describe(observation);
  replies={
    "/actions/runs/6":{id:6,run_attempt:1,event:"pull_request_target",path:policy.contractReview.workflow,head_sha:observation.candidate,repository:{full_name:"owner/repo"}},
    "/pulls/5":{state:"open",head:{sha:observation.candidate,repo:{full_name:"owner/repo"}},base:{sha:observation.baseline,ref:"production"}},
    "/branches/production":{commit:{sha:observation.baseline}},
    "/actions/runs/6/approvals":[{state:"approved",comment:`CONTRACT_RUNTIME_INSTALL_APPROVED ${contract.digest(od)} REVIEW_SHA256=${"e".repeat(64)}`,environments:[{id:12,name:"core-scope-approval"}],user:{id:34}}]
  };
  const observationReceipt=await contract.authorize(od,observation.policy,"fixture-read-only");
  const observationRequirement=contract.requirements(observationReceipt,observation.policy);
  assert.equal(observationRequirement.requireReal,false);
  assert.equal(observationRequirement.semanticImpact,"OBSERVABILITY_ONLY");
  assert.equal(gate.realRequirement({installation:observationRequirement,capabilityProtection:{plan:{modelPathChanged:true}},realClassification:{required:true}}),false);
  assert.equal(gate.realRequirement({installation:observationRequirement,capabilityProtection:{plan:{modelPathChanged:true}},realClassification:{required:true},force:true}),true);cases++;
  const unreviewed=atomicFixture(undefined,true);unreviewed.policy.realE2e.reviewedTransitions=[];
  fails(()=>contract.describe(unreviewed),/ATOMIC_/);
}

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
  const governanceRouting = storageGovernanceRoutingFixture();
  assert.equal(contract.describe(governanceRouting).kind, "GOVERNANCE_CHANGE"); cases++;
  fails(() => contract.describe(storageGovernanceRoutingFixture(true)), /GOVERNANCE_ONLY_CHANGE_REQUIRED/);
  const workflow = fs.readFileSync(path.resolve(__dirname, "../../../.github/workflows/core-reliability.yml"), "utf8");
  assert.match(workflow, /core-contract-approval\.js describe/); assert.match(workflow, /actions: read/); assert.match(workflow, /CORE_GATE_GITHUB_READ_TOKEN: \$\{\{ github\.token \}\}/); cases++;
  await verifyAtomicInstallation();
  console.log(JSON.stringify({ classification: "STRUCTURED_CONTRACT_TEST", cases, passed: cases, realNetworkCalls: 0, preservedFixture: root }));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });
