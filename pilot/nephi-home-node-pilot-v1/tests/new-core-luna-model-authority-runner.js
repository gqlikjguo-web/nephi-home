"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const authorityPath = path.join(root, "lib/new-core/openai-model-authority.js");
const providerPath = path.join(root, "lib/providers/openai-understanding-v1.js");
const shadowPath = path.join(root, "lib/new-core/shadow-core.js");
const task14Path = path.join(root, "scripts/run-new-core-openai-shadow-acceptance.js");

assert.equal(fs.existsSync(authorityPath), true, "RED: sole new-core model authority must exist");
const { NEW_CORE_OPENAI_MODEL } = require(authorityPath);
assert.equal(NEW_CORE_OPENAI_MODEL, "gpt-5.6-luna");

const provider = fs.readFileSync(providerPath, "utf8");
const shadow = fs.readFileSync(shadowPath, "utf8");
assert.equal(fs.existsSync(task14Path), true, "RED: Luna-only Task 14 runner must exist");
const task14 = fs.readFileSync(task14Path, "utf8");

assert.equal(provider.includes("options.model"), false, "provider must not accept model override");
assert.equal(shadow.includes("providerConfig.model"), false, "Shadow must not forward model authority");
assert.equal(task14.includes("process.env.OPENAI_MODEL"), false, "Task 14 must not read OPENAI_MODEL");
assert.equal(task14.includes("process.env.JUNZAN_OPENAI_MODEL"), false, "Task 14 must not read a fallback model");
assert.equal(provider.includes("MODEL_IDENTITY_MISMATCH"), true, "provider must enforce response model identity");
assert.equal(provider.includes("requestedModel"), true, "provider must record requested model");
assert.equal(provider.includes("resolvedModel"), true, "provider must record response-envelope model");

console.log(JSON.stringify({
  suite: "new-core-luna-model-authority",
  classification: "STRUCTURED_CONTRACT_TEST",
  caseCount: 7,
  status: "PASS"
}));
