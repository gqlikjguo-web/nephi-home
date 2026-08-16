"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT_PATH = path.resolve(__dirname, "../scripts/task-preflight.js");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with exit ${result.status}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function git(repo, args, options = {}) {
  return run("git", ["-C", repo, ...args], options);
}

function createRepository() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-task-preflight-"));
  git(repo, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "tracked.txt"), "baseline\n", "utf8");
  git(repo, ["add", "--", "tracked.txt"]);
  git(repo, [
    "-c", "user.name=JunZan Test",
    "-c", "user.email=junzan-test@example.invalid",
    "commit", "-m", "fixture baseline"
  ]);
  return repo;
}

function gitSnapshot(repo) {
  const branchResult = git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    allowFailure: true
  });
  assert.ok(branchResult.status === 0 || branchResult.status === 1);
  return {
    head: git(repo, ["rev-parse", "HEAD"]).stdout.trim(),
    branch: branchResult.status === 0 ? branchResult.stdout.trim() : "未掛分支",
    status: git(repo, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout
  };
}

function executePreflight(cwd) {
  return run(process.execPath, [SCRIPT_PATH], { cwd, allowFailure: true });
}

function assertCommonOutput(result, repo, cwd, expectedBranch) {
  const head = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
  assert.match(result.stdout, new RegExp(`Repository root: ${escapeRegExp(path.resolve(repo))}`));
  assert.match(result.stdout, new RegExp(`目前工作位置: ${escapeRegExp(path.resolve(cwd))}`));
  assert.match(result.stdout, new RegExp(`HEAD: ${head}`));
  assert.match(result.stdout, new RegExp(`Branch: ${escapeRegExp(expectedBranch)}`));
  assert.match(result.stdout, /Tracked 未提交:/);
  assert.match(result.stdout, /Staged:/);
  assert.match(result.stdout, /Untracked:/);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runCase(name, arrange, expected) {
  const repo = createRepository();
  try {
    const cwd = arrange(repo) || repo;
    const before = gitSnapshot(repo);
    const result = executePreflight(cwd);
    const after = gitSnapshot(repo);

    assert.deepEqual(after, before, `${name}: preflight must be read-only`);
    assert.equal(result.status, expected.exitCode, `${name}: ${result.stderr}`);
    assertCommonOutput(result, repo, cwd, expected.branch || "main");
    assert.match(result.stdout, expected.resultPattern);
    for (const expectedPath of expected.paths || []) {
      assert.match(result.stdout, new RegExp(`- ${escapeRegExp(expectedPath)}(?:\\r?\\n|$)`));
    }
    process.stdout.write(`PASS task-preflight ${name}\n`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

runCase("clean repo", (repo) => {
  const cwd = path.join(repo, "nested");
  fs.mkdirSync(cwd);
  return cwd;
}, {
  exitCode: 0,
  resultPattern: /PASS: Git working tree clean/
});

runCase("tracked dirty", (repo) => {
  fs.appendFileSync(path.join(repo, "tracked.txt"), "dirty\n", "utf8");
}, {
  exitCode: 1,
  resultPattern: /BLOCKED: Git working tree has changes/,
  paths: ["tracked.txt"]
});

runCase("staged dirty", (repo) => {
  fs.writeFileSync(path.join(repo, "staged.txt"), "staged\n", "utf8");
  git(repo, ["add", "--", "staged.txt"]);
}, {
  exitCode: 1,
  resultPattern: /BLOCKED: Git working tree has changes/,
  paths: ["staged.txt"]
});

runCase("untracked", (repo) => {
  fs.writeFileSync(path.join(repo, "untracked.txt"), "untracked\n", "utf8");
}, {
  exitCode: 1,
  resultPattern: /BLOCKED: Git working tree has changes/,
  paths: ["untracked.txt"]
});

runCase("detached clean", (repo) => {
  const head = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
  git(repo, ["update-ref", "--no-deref", "HEAD", head]);
}, {
  exitCode: 0,
  branch: "未掛分支",
  resultPattern: /PASS: Git working tree clean/
});

process.stdout.write("PASS task-preflight runner\n");
