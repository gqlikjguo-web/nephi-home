"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

function runGit(args, allowedStatuses = [0]) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (result.error || !allowedStatuses.includes(result.status)) {
    const error = new Error(`git ${args[0]} failed`);
    error.code = "GIT_INSPECTION_FAILED";
    throw error;
  }
  return result;
}

function lines(value) {
  return value.split(/\r?\n/).filter(Boolean);
}

function printPaths(label, values) {
  process.stdout.write(`${label}:\n`);
  if (values.length === 0) {
    process.stdout.write("- （空）\n");
    return;
  }
  for (const value of values) process.stdout.write(`- ${value}\n`);
}

function main() {
  const repositoryRoot = path.resolve(runGit(["rev-parse", "--show-toplevel"]).stdout.trim());
  const currentWorkingDirectory = path.resolve(process.cwd());
  const head = runGit(["rev-parse", "HEAD"]).stdout.trim();
  const branchResult = runGit(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    [0, 1]
  );
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : "未掛分支";
  const tracked = lines(runGit(["diff", "--no-ext-diff", "--name-only"]).stdout);
  const staged = lines(runGit(["diff", "--cached", "--no-ext-diff", "--name-only"]).stdout);
  const untracked = lines(runGit(["ls-files", "--others", "--exclude-standard"]).stdout);

  process.stdout.write(`Repository root: ${repositoryRoot}\n`);
  process.stdout.write(`目前工作位置: ${currentWorkingDirectory}\n`);
  process.stdout.write(`HEAD: ${head}\n`);
  process.stdout.write(`Branch: ${branch}\n`);
  printPaths("Tracked 未提交", tracked);
  printPaths("Staged", staged);
  printPaths("Untracked", untracked);

  if (tracked.length === 0 && staged.length === 0 && untracked.length === 0) {
    process.stdout.write("PASS: Git working tree clean\n");
    return 0;
  }
  process.stdout.write("BLOCKED: Git working tree has changes\n");
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`BLOCKED: ${error.code || "GIT_INSPECTION_FAILED"}\n`);
  process.exitCode = 1;
}
