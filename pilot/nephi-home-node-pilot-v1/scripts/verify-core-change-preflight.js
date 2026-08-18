"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function fail(reason) {
  process.stdout.write(`CORE_CHANGE_PREFLIGHT=FAIL reason=${reason}\n`);
  return 1;
}

function git(repo, args, allowed = [0]) {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || !allowed.includes(result.status)) return null;
  return result.stdout.trim();
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] || null;
}

function repositoryPath(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/");
  if (!normalized || path.posix.isAbsolute(normalized)) return null;
  const clean = path.posix.normalize(normalized);
  if (clean === "." || clean === ".." || clean.startsWith("../")) return null;
  return clean;
}

function fileExists(repo, relativePath) {
  const normalized = repositoryPath(relativePath);
  return normalized && fs.existsSync(path.join(repo, normalized))
    && fs.statSync(path.join(repo, normalized)).isFile();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceHasFunction(repo, relativePath, functionName) {
  if (!fileExists(repo, relativePath) || !String(functionName || "").trim()) return false;
  const source = fs.readFileSync(path.join(repo, repositoryPath(relativePath)), "utf8");
  const name = escapeRegExp(String(functionName).trim());
  return [
    new RegExp(`\\bfunction\\s+${name}\\s*\\(`),
    new RegExp(`\\bclass\\s+${name}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`),
    new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?${name}\\s*\\(`)
  ].some((pattern) => pattern.test(source));
}

function changedPaths(repo) {
  const values = [];
  for (const args of [
    ["diff", "--name-only", "-z", "--relative"],
    ["diff", "--cached", "--name-only", "-z", "--relative"],
    ["ls-files", "--others", "--exclude-standard", "-z"]
  ]) {
    const output = git(repo, args);
    if (output === null) return null;
    values.push(...output.split("\0").filter(Boolean).map(repositoryPath).filter(Boolean));
  }
  return [...new Set(values)].sort();
}

function isCorePath(relativePath) {
  if (/^(?:tests|scripts|docs|\.github)\//.test(relativePath)) return false;
  if (["package.json", "package-lock.json", "CORE_CHANGE_PREFLIGHT.json"].includes(relativePath)) return false;
  return /\.(?:js|cjs|mjs|ts|json)$/i.test(relativePath);
}

function loadManifest(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && value.schemaVersion === 1 ? value : null;
  } catch {
    return null;
  }
}

function verify(repo, manifest) {
  const head = git(repo, ["rev-parse", "HEAD"]);
  if (!head) return "GIT_INSPECTION_FAILED";
  const expectedHead = git(repo, ["rev-parse", "--verify", `${manifest.expectedHead}^{commit}`]);
  if (!expectedHead || head !== expectedHead) return "HEAD_MISMATCH";
  const baseline = git(repo, ["rev-parse", "--verify", `${manifest.baseline}^{commit}`]);
  if (!baseline || git(repo, ["merge-base", "--is-ancestor", baseline, head]) === null) {
    return "BASELINE_INVALID";
  }

  const earliest = manifest.earliestFailure;
  if (!earliest || !String(earliest.transition || "").trim()
    || !fileExists(repo, earliest.file)
    || !Array.isArray(earliest.functions) || earliest.functions.length === 0) {
    return "EARLIEST_FAILURE_INVALID";
  }
  if (earliest.functions.some((name) => !sourceHasFunction(repo, earliest.file, name))) {
    return "EARLIEST_FAILURE_FUNCTION_MISSING";
  }

  if (!Array.isArray(manifest.proposedChanges) || manifest.proposedChanges.length === 0) {
    return "PROPOSED_CHANGES_EMPTY";
  }
  for (const proposed of manifest.proposedChanges) {
    if (!proposed || !fileExists(repo, proposed.path)) return "PROPOSED_FILE_MISSING";
    if (!Array.isArray(proposed.functions) || proposed.functions.length === 0
      || proposed.functions.some((name) => !sourceHasFunction(repo, proposed.path, name))) {
      return "PROPOSED_FUNCTION_MISSING";
    }
  }

  if (!Array.isArray(manifest.productionCallers) || manifest.productionCallers.length === 0) {
    return "PRODUCTION_CALLERS_EMPTY";
  }
  if (!Array.isArray(manifest.productionConsumers) || manifest.productionConsumers.length === 0) {
    return "PRODUCTION_CONSUMERS_EMPTY";
  }
  for (const entry of [...manifest.productionCallers, ...manifest.productionConsumers]) {
    if (!entry || !String(entry.name || entry.function || "").trim()
      || !fileExists(repo, entry.path)
      || entry.function && !sourceHasFunction(repo, entry.path, entry.function)) {
      return "PRODUCTION_CONSUMER_INVALID";
    }
  }

  if (!Array.isArray(manifest.affectedPasses) || manifest.affectedPasses.length === 0) {
    return "AFFECTED_PASSES_EMPTY";
  }
  for (const affected of manifest.affectedPasses) {
    if (!affected || !String(affected.name || "").trim() || !fileExists(repo, affected.runner)) {
      return "AFFECTED_TEST_MISSING";
    }
  }

  if (!Array.isArray(manifest.lessons) || manifest.lessons.length === 0) return "LESSONS_EMPTY";
  for (const lesson of manifest.lessons) {
    if (!lesson || !String(lesson.purpose || "").trim()
      || !git(repo, ["rev-parse", "--verify", `${lesson.commit}^{commit}`])) {
      return "LESSON_COMMIT_MISSING";
    }
  }

  const changes = changedPaths(repo);
  if (!changes) return "GIT_INSPECTION_FAILED";
  const declaredCore = new Set(manifest.proposedChanges.map((item) => repositoryPath(item.path)).filter(Boolean));
  const allowedCore = new Set((manifest.allowedCoreFiles || []).map(repositoryPath).filter(Boolean));
  const changedCore = changes.filter(isCorePath);
  if (changedCore.some((relativePath) => !declaredCore.has(relativePath))) {
    return "UNDECLARED_CORE_CHANGE";
  }
  if (changedCore.some((relativePath) => !allowedCore.has(relativePath))) {
    return "CORE_FILE_OUTSIDE_ALLOWLIST";
  }

  if (!Array.isArray(manifest.redCommand) || manifest.redCommand.length < 2
    || manifest.redCommand.some((part) => typeof part !== "string" || !part)) {
    return "RED_COMMAND_INVALID";
  }
  const red = spawnSync(manifest.redCommand[0], manifest.redCommand.slice(1), {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (red.error || red.signal || !Number.isInteger(red.status)) return "RED_COMMAND_ERROR";
  if (red.status === 0) return "RED_DID_NOT_FAIL";
  return null;
}

function main() {
  const repoOption = option(process.argv.slice(2), "--repo");
  const repo = path.resolve(repoOption || process.cwd());
  if (!git(repo, ["rev-parse", "--show-toplevel"])) return fail("GIT_INSPECTION_FAILED");
  const manifestOption = option(process.argv.slice(2), "--manifest");
  const manifestPath = path.resolve(manifestOption || path.join(repo, "CORE_CHANGE_PREFLIGHT.json"));
  const manifest = loadManifest(manifestPath);
  if (!manifest) return fail("MANIFEST_INVALID");
  const reason = verify(repo, manifest);
  if (reason) return fail(reason);
  process.stdout.write("CORE_CHANGE_PREFLIGHT=PASS\n");
  return 0;
}

process.exitCode = main();
