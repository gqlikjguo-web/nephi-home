"use strict";
// STRUCTURED_CONTRACT_TEST: real isolated Git commits and real affected runner subprocesses; no providers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const script = path.resolve(__dirname, "../scripts/core-ui-fast-path.js");
assert.ok(fs.existsSync(script), "RED: trusted actual-diff UI fast-path classifier is missing");
const { classify, verifyFast } = require(script);
const app = "pilot/nephi-home-node-pilot-v1/";
const guest = app + "public/assets/guest.js";
const css = app + "public/assets/guest.css";
const taskPath = ".github/core-reliability-task.json";
const baseGuest = 'const endpoint="/api/public/availability"; const message={textContent:""}; function renderResult(data){message.textContent=data.empty?"No rooms":"";return message.textContent}\n';
const baseCss = "body{color:#111}\n";
let cases = 0;

function fixture(edits, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-ui-fast-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (name, value) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
  write(guest, options.baseGuest || baseGuest);
  write(css, options.baseCss || baseCss);
  write(app + "server.js", "module.exports=1;\n");
  write(app + "migrations/001.sql", "select 1;\n");
  write(app + "lib/new-core/context/state.js", "module.exports=1;\n");
  write(app + "lib/line-transport.js", "module.exports=1;\n");
  write(app + "tests/first-version-public-admin-runner.js", options.runnerFails ? "process.exitCode=1;\n" : 'console.log("PASS affected UI");\n');
  write(taskPath, "{}\n");
  git("init", "-q"); git("config", "user.email", "fast@example.invalid"); git("config", "user.name", "Fast path fixture");
  git("add", "."); git("commit", "-qm", "baseline");
  const baseline = git("rev-parse", "HEAD");
  for (const [name, value] of Object.entries(edits)) write(name, value);
  const changed = Object.keys(edits).filter((name) => name !== taskPath);
  const task = { schemaVersion: 1, baseline, objective: "isolated UI display change", allowedPaths: options.allowedPaths || [taskPath, ...changed], contractChangeAllowed: false, gateChangeAllowed: false, affectedCapabilities: [] };
  write(taskPath, JSON.stringify(options.taskMutation ? options.taskMutation(task) : task));
  git("add", "."); git("commit", "-qm", "candidate");
  return { root, baseline, candidate: git("rev-parse", "HEAD") };
}
function check(name, edits, fast, options) {
  const result = classify(fixture(edits, options));
  assert.equal(result.fast, fast, name + ": wrong admission");
  if (fast) {
    assert.deepEqual(result.runners, ["tests/first-version-public-admin-runner.js"], name + ": affected runner");
    assert.equal(result.productPaths.length > 0, true, name + ": product diff required");
  }
  cases++;
}

check("one display string", { [guest]: baseGuest.replace('"No rooms"', '"No availability today"') }, true);
const productionGuest = fs.readFileSync(path.resolve(__dirname, "../public/assets/guest.js"), "utf8");
const changedProductionGuest = productionGuest.replace(/(message\.textContent=data\.empty\?")((?:\\.|[^"\\])*)(")/, (_match, start, value, end) => `${start}${value}（測試文字）${end}`);
assert.notEqual(changedProductionGuest, productionGuest, "production guest display anchor must exist");
check("current production empty-state display string", { [guest]: changedProductionGuest }, true, { baseGuest: productionGuest });
check("one CSS declaration", { [css]: "body{color:#222}\n" }, true);
check("nested responsive CSS declaration", { [css]: "body{color:#222}\n@media(max-width:600px){body{color:#333}}\n" }, true);
check("display text and CSS together", { [guest]: baseGuest.replace('"No rooms"', '"Sold out"'), [css]: "body{color:#222}\n" }, true);
check("JS branch logic", { [guest]: baseGuest.replace("data.empty?", "!data.empty?") }, false);
check("API URL string is executable behavior", { [guest]: baseGuest.replace("/api/public/availability", "/api/admin") }, false);
check("display text plus JS logic", { [guest]: baseGuest.replace('"No rooms"', '"Sold out"').replace("data.empty?", "!data.empty?") }, false);
check("API file", { [app + "server.js"]: "module.exports=2;\n" }, false);
check("DB migration", { [app + "migrations/001.sql"]: "select 2;\n" }, false);
check("Context", { [app + "lib/new-core/context/state.js"]: "module.exports=2;\n" }, false);
check("LINE", { [app + "lib/line-transport.js"]: "module.exports=2;\n" }, false);
check("mixed display and API", { [guest]: baseGuest.replace('"No rooms"', '"Sold out"'), [app + "server.js"]: "module.exports=2;\n" }, false);
check("CSS import is outside pure styles", { [css]: '@import url("https://example.invalid/x.css");\n' }, false);
check("escaped CSS resource reference is outside pure styles", { [css]: 'body{background:u\\72l(https://example.invalid/x)}\n' }, false);
check("manifest cannot self-approve extra scope", { [guest]: baseGuest.replace('"No rooms"', '"Sold out"') }, false, { allowedPaths: [taskPath, guest, app + "server.js"] });
check("manifest cannot declare contract change", { [guest]: baseGuest.replace('"No rooms"', '"Sold out"') }, false, { taskMutation: task => ({ ...task, contractChangeAllowed: true }) });

const pass = fixture({ [guest]: baseGuest.replace('"No rooms"', '"Sold out"') });
const passEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-ui-fast-pass-"));
const passed = verifyFast({ ...pass, evidenceDir: passEvidence });
assert.equal(passed.status, "PASS"); assert.equal(passed.candidateSha, pass.candidate);
assert.deepEqual(passed.results.map(item => [item.runner, item.exitCode, item.status]), [["git-diff-check", 0, "PASS"], ["tests/first-version-public-admin-runner.js", 0, "PASS"]]); cases++;
const fail = fixture({ [guest]: baseGuest.replace('"No rooms"', '"Sold out"') }, { runnerFails: true });
const failEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-ui-fast-fail-"));
const stopped = verifyFast({ ...fail, evidenceDir: failEvidence });
assert.equal(stopped.status, "STOP"); assert.equal(stopped.results[0].status, "PASS"); assert.equal(stopped.results[1].exitCode, 1);
assert.ok(fs.existsSync(path.join(failEvidence, "report.json")), "failed evidence must survive STOP"); cases++;
assert.throws(() => verifyFast({ ...fail, evidenceDir: failEvidence }), /EVIDENCE_ALREADY_EXISTS/); cases++;
const coreWorkflow = fs.readFileSync(path.resolve(__dirname, "../../../.github/workflows/core-reliability.yml"), "utf8");
assert.match(coreWorkflow, /  fast:\n[\s\S]*?core-ui-fast-path\.js verify/, "trusted fast verification job must exist");
assert.match(coreWorkflow, /needs: \[scope, gate, fast\]/, "candidate status must require both routed jobs");
assert.match(coreWorkflow, /GATE_RESULT.*needs\.gate\.result/, "full Gate result must remain bound to status");
assert.match(coreWorkflow, /FAST_RESULT.*needs\.fast\.result/, "fast Gate result must bind to status");
cases++;
const statusSource = coreWorkflow.split("  candidate-status:\n")[1].split("          script: |\n")[1]
  .split("\n").map(line => line.startsWith("            ") ? line.slice(12) : line).join("\n");
async function statusCase({ fast, gate, scope = "success", currentSha = "a".repeat(40), branchSha = "b".repeat(40), attempt = "1" }) {
  const posted = [];
  const github = { rest: { pulls: { get: async () => ({ data: { head: { sha: currentSha } } }) }, repos: {
    getBranch: async () => ({ data: { commit: { sha: branchSha } } }),
    createCommitStatus: async value => posted.push(value)
  } } };
  const context = { payload: { pull_request: { number: 1, head: { sha: "a".repeat(40) }, base: { sha: "b".repeat(40) } } }, repo: { owner: "test", repo: "repo" }, runId: 7 };
  const processForScript = { env: { SCOPE_RESULT: scope, GATE_RESULT: gate, FAST_RESULT: fast, FAST_CLASS: fast === "success" ? "true" : "false", GITHUB_RUN_ATTEMPT: attempt } };
  await new Function("github", "context", "process", `return (async()=>{${statusSource}})()`)(github, context, processForScript);
  assert.equal(posted.length, 1);
  cases++;
  return posted[0].state;
}
(async () => {
  assert.equal(await statusCase({ fast: "success", gate: "skipped" }), "success");
  assert.equal(await statusCase({ fast: "skipped", gate: "success" }), "success");
  assert.equal(await statusCase({ fast: "success", gate: "success" }), "failure");
  assert.equal(await statusCase({ fast: "success", gate: "skipped", currentSha: "c".repeat(40) }), "failure");
  assert.equal(await statusCase({ fast: "success", gate: "skipped", branchSha: "c".repeat(40) }), "failure");
  assert.equal(await statusCase({ fast: "success", gate: "skipped", attempt: "2" }), "failure");
  console.log(JSON.stringify({ classification: "STRUCTURED_CONTRACT_TEST", cases, passed: cases, realProviderCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
