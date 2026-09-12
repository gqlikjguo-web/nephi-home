"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const manifest = require("./fixtures/test-baseline-cleanup.json");
const app = path.resolve(__dirname, "..");
const repo = path.resolve(app, "../..");
const packageJson = require("../package.json");

function lifecycleCommands(scripts) {
  return ["pretest", "test", "posttest"].flatMap(stage =>
    String(scripts[stage] || "").split(" && ").filter(Boolean));
}

function assertCoverage(scripts, files) {
  const commands = lifecycleCommands(scripts);
  assert.equal(new Set(commands).size, commands.length, "duplicate lifecycle execution");
  for (const command of manifest.originalLifecycleCommands) {
    assert.ok(commands.includes(command), `lost original lifecycle coverage: ${command}`);
  }
  for (const file of manifest.retainedRunnerFiles) {
    assert.ok(files.has(file), `lost retained regression: ${file}`);
  }
  for (const retirement of manifest.retired) {
    for (const replacement of retirement.replacements) {
      assert.ok(files.has(`pilot/nephi-home-node-pilot-v1/${replacement}`),
        `missing retirement replacement: ${replacement}`);
      assert.ok(commands.includes(`node ${replacement}`)
        || String(scripts["test:baseline-replacements"] || "").split(" && ").includes(`node ${replacement}`),
      `replacement has no explicit test entry: ${replacement}`);
    }
  }
}

const files = new Set(manifest.retainedRunnerFiles.filter(file => fs.existsSync(path.join(repo, file))));
const positive = { pretest: manifest.originalLifecycleCommands.join(" && "), test: "", posttest: "",
  "test:baseline-replacements": [...new Set(manifest.retired.flatMap(r => r.replacements))].map(f => `node ${f}`).join(" && ") };
assertCoverage(positive, new Set(manifest.retainedRunnerFiles));
assert.throws(() => assertCoverage({ ...positive, test: manifest.originalLifecycleCommands[0] }, files), /duplicate lifecycle/);
assert.throws(() => assertCoverage({ ...positive, pretest: manifest.originalLifecycleCommands.slice(1).join(" && ") }, files), /lost original lifecycle/);
const missing = new Set(manifest.retainedRunnerFiles);
missing.delete(manifest.retainedRunnerFiles[0]);
assert.throws(() => assertCoverage(positive, missing), /lost retained regression/);
assert.throws(() => assertCoverage({ ...positive, "test:baseline-replacements": "" }, files), /replacement has no explicit test entry/);
assertCoverage(packageJson.scripts, files);

console.log(JSON.stringify({ suite: "test-baseline-cleanup", evidenceLevel: "STRUCTURED_CONTRACT_TEST",
  cases: 6, passed: 6, originalUniqueCommands: manifest.originalLifecycleCommands.length,
  retainedRunnerFiles: manifest.retainedRunnerFiles.length, realProviderCalls: 0 }));
