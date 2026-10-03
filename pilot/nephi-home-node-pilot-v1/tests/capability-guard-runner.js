"use strict";
// STRUCTURED_CONTRACT_TEST: governance only; no provider execution.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const location = path.join(__dirname, "../scripts/capability-guard.js");
const guard = fs.existsSync(location) ? require(location) : {};
const A = "pilot/nephi-home-node-pilot-v1";
const node = (id, files, dependsOn, capabilities) => ({ id, files, dependsOn, capabilities,
  responsibility: id, authority: id, forbiddenAuthorities: ["operational-data"] });
const manifest = { schemaVersion: 1, nodes: [node("context", ["context.js"], [], ["stay"]),
  node("application", ["application.js"], ["context"], ["policy", "multi"]),
  node("admin", ["admin.js"], [], ["admin"])], nonRuntimePaths: ["task.json"] };
const baseline = { schemaVersion: 1, capabilities: ["stay", "policy", "multi", "admin"].map(id => ({ id,
  status: "CONTRACT_BASELINE", runners: [`tests/${id}.js`] })) };
const task = { allowedPaths: ["context.js"], impact: { safeModificationPoints: ["context.js"], authorities: ["context"] } };
function call(name, ...args) { assert.equal(typeof guard[name], "function", `${name} must be installed in external governance`); return guard[name](...args); }
function entry(text) { return { mode: "100644", sha256: call("hash", text) }; }
const report = (lock, ids) => ({ status: "PASS", candidateDigest: lock, openAiCalls: 0,
  results: ids.map(id => ({ id, status: "PASS", exitCode: 0, candidateDigest: lock, log: "ok", logSha256: call("hash", "ok") })) });
test("transitive impact includes policy and multi-unit consumers without permitting admin edits", () => {
 const r = call("impact", manifest, baseline, ["context.js"], task);
 assert.deepEqual(r.DIRECTLY_AFFECTED_CAPABILITIES, ["stay"]);
 assert.deepEqual(r.TRANSITIVE_AFFECTED_CAPABILITIES, ["multi", "policy"]);
 assert.deepEqual(r.OUT_OF_SCOPE_FILES, []);
});
test("an actual out-of-scope path cannot be hidden by a task capability declaration", () => {
 assert.throws(() => call("impact", manifest, baseline, ["context.js", "admin.js"], task), /OUT_OF_SCOPE/);
});
test("safe modification point and authority are independent requirements", () => {
 assert.throws(() => call("impact", manifest, baseline, ["context.js"], { ...task, impact: { safeModificationPoints: [], authorities: ["context"] } }), /SAFE_POINT/);
 assert.throws(() => call("impact", manifest, baseline, ["context.js"], { ...task, impact: { safeModificationPoints: ["context.js"], authorities: [] } }), /AUTHORITY/);
});
test("unmapped new modules and missing dependency nodes fail closed", () => {
 assert.throws(() => call("impact", manifest, baseline, ["new.js"], { allowedPaths: ["new.js"] }), /UNMAPPED/);
 assert.throws(() => call("impact", { ...manifest, nodes: [node("x", ["context.js"], ["missing"], ["stay"])] }, baseline, ["context.js"], task), /DEPENDENCY/);
});
test("trusted storage governance mapping accepts only registered non-runtime paths", () => {
 const root = path.resolve(__dirname,"../../..");
 const installed = name => JSON.parse(fs.readFileSync(path.join(root,".github",name+".json")));
 const dependency = installed("core-impact-manifest"), capabilities = installed("capability-baseline"), policy = installed("core-reliability-policy");
 const storagePaths = [
  A + "/scripts/test-storage-guard.js",
  A + "/tests/test-storage-guard-runner.js"
 ];
 assert.ok(storagePaths.every(file => policy.governancePaths.includes(file)), "storage paths require exact governance registration");
 const storageTask = { allowedPaths: storagePaths };
 const storageImpact = call("impact", dependency, capabilities, storagePaths, storageTask);
 assert.deepEqual(storageImpact.CHANGED_COMPONENTS, [], "governance files are not product components");
 const runtime = A + "/lib/new-core/application-service.js";
 assert.throws(() => call("impact", dependency, capabilities, [...storagePaths, runtime], { allowedPaths: [...storagePaths, runtime] }), /SAFE_POINT|AUTHORITY/,
  "product runtime cannot masquerade as governance");
 assert.throws(() => call("impact", dependency, capabilities, [A + "/scripts/unregistered-storage-helper.js"], { allowedPaths: [A + "/scripts/unregistered-storage-helper.js"] }), /UNMAPPED/,
  "unregistered governance-looking paths fail closed");
});
test("incomplete, skipped, failed and forged successful evidence is rejected", () => {
 const r = report("locked", ["a", "b"]);
 assert.equal(call("verifyEvidence", r, "locked", ["a", "b"]), true);
 for (const broken of [{ ...r, results: r.results.slice(1) }, { ...r, status: "STOP" },
  { ...r, results: [{ ...r.results[0], exitCode: 1 }, r.results[1]] },
  { ...r, results: [{ ...r.results[0], log: "forged" }, r.results[1]] }])
  assert.throws(() => call("verifyEvidence", broken, "locked", ["a", "b"]));
});
test("candidate source drift invalidates evidence and exposes required affected revalidation", () => {
 const r = report("old", ["a"]);
 assert.throws(() => call("verifyEvidence", r, "new", ["a"]), /DIGEST/);
});
test("content lock is exclusive and cannot be overwritten", () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capability-lock-"));
 const file = path.join(dir, "lock.json");
 const tree = new Map([["runtime.js", entry("v1")]]);
 call("writeLock", file, tree);
 assert.throws(() => call("writeLock", file, tree), /exist|EEXIST/);
 assert.equal(call("checkLock", file, tree), true);
 assert.throws(() => call("checkLock", file, new Map([["runtime.js", entry("v2")]])), /DRIFT/);
});
test("product parity requires accepted lock; prototype paths cannot disappear", () => {
 const p = { schemaVersion: 1, mustMatch: ["runtime.js", "__proto__"], testOnly: {}, metadata: [] };
 const t = new Map([["runtime.js", entry("x")], ["__proto__", entry("y")]]);
 const digest = call("contentDigest", t, p.mustMatch);
 assert.equal(call("promotion", t, t, p, { productDigest: digest, policyDigest: call("hash", p) }).ok, true);
 assert.throws(() => call("promotion", t, t, p, null), /LOCK/);
 const bad = new Map(t); bad.set("__proto__", entry("drift"));
 assert.throws(() => call("promotion", bad, t, p, { productDigest: digest, policyDigest: call("hash", p) }), /DRIFT/);
});
test("unknown product paths and unpinned test overlay content fail closed", () => {
 const t = new Map([["runtime.js", entry("x")]]);
 const p = { schemaVersion: 1, mustMatch: ["runtime.js"], testOnly: { "test.cjs": call("hash", "approved") }, metadata: [] };
 const lock = { productDigest: call("contentDigest", t, p.mustMatch), policyDigest: call("hash", p) };
 assert.throws(() => call("promotion", new Map([...t, ["unknown.js", entry("x")]]), t, p, lock), /UNCLASSIFIED/);
 assert.throws(() => call("promotion", new Map([...t, ["test.cjs", entry("other")]]), t, p, lock), /OVERLAY/);
});
test("unapproved baseline changes cannot manufacture a new PASS", () => {
 assert.throws(() => call("assertTrustedManifest", { a: "old" }, { a: "new" }), /GOVERNANCE_REVIEW/);
});
test("REAL defaults to zero and candidate self-approval has no authority", () => {
 assert.throws(() => call("authorizeReal", { maxCalls: 2, cases: ["a"] }, { deterministic: true, scopeApproved: false, affectedCases: ["a"] }), /APPROVAL/);
 assert.throws(() => call("authorizeReal", null, { deterministic: true, scopeApproved: true, affectedCases: ["a"] }), /DEFAULT_DENY/);
});
test("REAL requires deterministic green, affected cases, exact digest and finite budget", () => {
 const b = { mode: "AFFECTED_REAL", candidateDigest: "c", cases: ["a"], maxCalls: 2, maxTokens: 100, reason: "admission changed" };
 const c = { deterministic: true, scopeApproved: true, candidateDigest: "c", affectedCases: ["a"], modelPathChanged: true };
 assert.equal(call("authorizeReal", b, c), true);
 for (const v of [{ ...c, deterministic: false }, { ...c, candidateDigest: "other" }, { ...c, modelPathChanged: false }, { ...c, affectedCases: [] }])
  assert.throws(() => call("authorizeReal", b, v));
});
test("each REAL case max2, completed case replay and unrecorded usage are rejected", () => {
 const b = { cases: ["a"], maxCalls: 2, maxTokens: 100, candidateDigest: "c" };
 const good = { caseId: "a", attempt: 1, calls: 1, tokens: 20, completed: true, candidateDigest: "c" };
 assert.equal(call("validateRealLedger", b, [good]).calls, 1);
 assert.throws(() => call("validateRealLedger", b, [good, { ...good, attempt: 2 }]), /REPLAY/);
 assert.throws(() => call("validateRealLedger", b, [{ ...good, calls: 3 }]), /CALL/);
 assert.throws(() => call("validateRealLedger", b, [{ ...good, tokens: null }]), /USAGE/);
});
test("canary activation refuses missing architecture/scope evidence and never routes customers", () => {
 const r = call("canaryReadiness", { enabled: true, ownerScopes: [] });
 assert.equal(r.ok, false); assert.equal(r.routingActivated, false);
 const p = { enabled: false, ownerScopes: [{ propertyId: "p", channel: "line", userId: "u" }], evidence: {} };
 assert.equal(call("canaryReadiness", p).ok, false);
 assert.equal(call("matchesCanaryScope", p.ownerScopes, { propertyId: "p", channel: "line", userId: "u" }), true);
 for (const v of [{ propertyId: "q", channel: "line", userId: "u" }, { propertyId: "p", channel: "web", userId: "u" }, { propertyId: "p", channel: "line", userId: "v" }])
  assert.equal(call("matchesCanaryScope", p.ownerScopes, v), false);
});
test("installed manifest dry-run includes policy, amenity, Context and multi-unit without runtime edits", () => {
 const root = path.resolve(__dirname,"../../..");
 const load = name => JSON.parse(fs.readFileSync(path.join(root,".github",name+".json")));
 const m = load("core-impact-manifest"), b = load("capability-baseline");
 const files = ["lib/new-core/unit-reply-router.js", "lib/new-core/lifecycle-manager.js", "lib/new-core/context-link-validator.js", "lib/conversation-contracts/conversation-state-v3.js"].map(f => A + "/" + f);
 const t = { allowedPaths: files, impact: { safeModificationPoints: files, authorities: [...new Set(m.nodes.filter(n=>files.includes(n.id)).map(n=>n.authority))] } };
 const r = call("impact",m,b,files,t), all = [...r.DIRECTLY_AFFECTED_CAPABILITIES,...r.TRANSITIVE_AFFECTED_CAPABILITIES];
 for (const id of ["travel_subsidy","parking","multi_unit","date_nights_context","policy_lodging","amenity_lodging","max_two_calls"])
  assert.ok(all.includes(id), id + " must remain protected");
});
test("new source imports cannot silently widen an approved component boundary", () => {
 const { validateImports } = require("../scripts/capability-guard-execution");
 const m = { nodes: [{ id:"lib/a.js", files:["lib/a.js"], dependsOn:[] }, { id:"lib/b.js", files:["lib/b.js"], dependsOn:[] }] };
 const t = new Map([["lib/a.js", {content:Buffer.from('require("./b")')}]]);
 assert.throws(()=>validateImports(t,m,["lib/a.js"]),/UNDECLARED_DEPENDENCY/);
});
test("manifest evidence never labels fixture-only results as production proof", () => {
 const root = path.resolve(__dirname,"../../..");
 const b = JSON.parse(fs.readFileSync(path.join(root,".github/capability-baseline.json")));
 const e = require("./fixtures/production-capability-evidence.json");
 assert.equal(b.capabilities.length,28);
 for (const c of b.capabilities) {
  assert.equal(c.externalOpenAiCalls,0);
  if(c.status !== "PROVEN") { assert.equal(c.status,"CONTRACT_BASELINE"); assert.equal(c.productionEvidence,null); continue; }
  const trace = e.traces.find(x=>x.traceId===c.productionEvidence.traceId);
  assert.ok(trace); assert.equal(trace.productionSha,c.productionEvidence.productionSha);
  assert.ok(trace.final.every(x=>x.earliestFailure===null));
  assert.ok(trace.attempts.every(x=>x.totalUnderstandingCalls<=2));
  assert.ok(trace.c03.flat().every(x=>x.status==="SUCCESS"));
 }
});

test("reviewed repository runner resolves from app without escaping source boundary", () => {
 const { runnerCommand } = require("../scripts/capability-guard-execution");
 const root = path.resolve(__dirname,"../../..");
 const id = "../../tests/pilot-nephi-home-node-pilot-v1-onboarding-existing-property-apply-runner.js";
 const command = runnerCommand(root,id,[id]);
 assert.equal(command.executable,process.execPath);
 assert.equal(path.resolve(root,A,command.argv[0]),path.resolve(root,"tests/pilot-nephi-home-node-pilot-v1-onboarding-existing-property-apply-runner.js"));
 for (const unsafe of ["../../../outside.js", "/etc/passwd", "../../tests/../AGENTS.md", "tests/not-a-runner.txt"])
  assert.throws(()=>runnerCommand(root,unsafe,[unsafe]));
 assert.throws(()=>runnerCommand(root,id,[]),/UNAPPROVED_RUNNER/);
});
test("existing diff evidence command runs exact git diff check instead of Node source", () => {
 const { runnerCommand } = require("../scripts/capability-guard-execution");
 const command = runnerCommand(path.resolve(__dirname,"../../.."),"diff",["diff"]);
 assert.deepEqual(command,{executable:"git",argv:["diff","--check"]});
});
