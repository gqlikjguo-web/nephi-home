"use strict";
// STRUCTURED_CONTRACT_TEST: execute bootstrap Actions scripts with GitHub API doubles.
// Breaks caught: unapproved scope/head/base, reusable bootstrap, or false success publication.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../..");
const workflowPath = path.join(root, ".github/workflows/core-reliability-bootstrap.yml");
assert.ok(fs.existsSync(workflowPath), "RED: first installation needs a bounded bootstrap workflow");
const source = fs.readFileSync(workflowPath, "utf8");
const blocks = [...source.matchAll(/          script: \|\n((?: {12}[^\n]*\n|\n)+)/g)].map(m => m[1].split("\n").map(line => line.slice(12)).join("\n"));
assert.equal(blocks.length, 2);
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const prepare = new AsyncFunction("github", "context", "core", "require", "process", blocks[0]);
const publish = new AsyncFunction("github", "context", "process", blocks[1]);
const base = "8f1719c71dd590d85e9a4d1b47f1f08bb8a4af70";
const head = "a".repeat(40);
const task = JSON.parse(fs.readFileSync(path.join(root, ".github/core-reliability-task.json")));
let cases = 0;
function fixture() {
  const pr = { number: 1, state: "open", draft: false, merged: false, base: { sha: base, ref: "production" }, head: { sha: head, ref: "chore/core-reliability-gate-20260920", repo: { full_name: "gqlikjguo-web/nephi-home" } } };
  const context = { runId: 10, repo: { owner: "gqlikjguo-web", repo: "nephi-home" }, payload: { pull_request: pr } };
  const data = { current: structuredClone(pr), branch: base, task: structuredClone(task), statuses: [], outputs: {} };
  const github = { rest: { pulls: { get: async () => ({ data: data.current }) }, repos: {
    getBranch: async () => ({ data: { commit: { sha: data.branch } } }),
    getContent: async request => { assert.equal(request.ref, head); return { data: { content: Buffer.from(JSON.stringify(data.task)).toString("base64") } }; },
    createCommitStatus: async status => { data.statuses.push(status); }
  } } };
  const summary = { addHeading() { return this; }, addRaw() { return this; }, addCodeBlock() { return this; }, async write() {} };
  const core = { summary, setOutput: (key, value) => { data.outputs[key] = value; } };
  return { context, data, github, core, process: { env: { GITHUB_RUN_ATTEMPT: "1", SCOPE_RESULT: "success", GATE_RESULT: "success" } } };
}
async function run() {
  const valid = fixture();
  await prepare(valid.github, valid.context, valid.core, require, valid.process);
  assert.equal(valid.data.outputs.candidate, head);
  assert.equal(valid.data.outputs.baseline, base); cases++;
  for (const change of [
    x => { x.context.payload.pull_request.number = 2; },
    x => { x.context.payload.pull_request.draft = true; },
    x => { x.context.payload.pull_request.base.sha = head; },
    x => { x.context.payload.pull_request.head.repo.full_name = "untrusted/fork"; },
    x => { x.context.payload.pull_request.head.ref = "other-work"; },
    x => { x.data.current.head.sha = "b".repeat(40); },
    x => { x.data.current.state = "closed"; },
    x => { x.data.branch = head; },
    x => { x.data.task.allowedPaths.push("unapproved-runtime.js"); },
    x => { x.data.task.contractChangeAllowed = true; },
    x => { x.process.env.GITHUB_RUN_ATTEMPT = "2"; }
  ]) {
    const x = fixture(); change(x);
    await assert.rejects(() => prepare(x.github, x.context, x.core, require, x.process), /BOOTSTRAP_/); cases++;
  }
  for (const [change, expected] of [
    [() => {}, "success"],
    [x => { x.process.env.GATE_RESULT = "failure"; }, "failure"],
    [x => { x.process.env.GATE_RESULT = "skipped"; }, "failure"],
    [x => { x.process.env.SCOPE_RESULT = "failure"; }, "failure"],
    [x => { x.data.current.head.sha = "b".repeat(40); }, "failure"],
    [x => { x.data.branch = head; }, "failure"],
    [x => { x.process.env.GITHUB_RUN_ATTEMPT = "2"; }, "failure"],
    [x => { x.data.current.state = "closed"; }, "failure"]
  ]) {
    const x = fixture(); change(x);
    await publish(x.github, x.context, x.process);
    assert.equal(x.data.statuses.length, 1);
    assert.equal(x.data.statuses[0].state, expected);
    assert.equal(x.data.statuses[0].sha, head);
    assert.equal(x.data.statuses[0].context, "Core Reliability Gate / candidate"); cases++;
  }
  console.log(JSON.stringify({ classification: "STRUCTURED_CONTRACT_TEST", cases, passed: cases, realOpenaiCalls: 0 }));
}
run().catch(e => { console.error(e); process.exitCode = 1; });
