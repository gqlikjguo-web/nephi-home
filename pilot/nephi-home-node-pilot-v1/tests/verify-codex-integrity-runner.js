"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const gatePath = path.join(projectRoot, "scripts", "verify-codex-integrity.js");
const requiredContractRunners = [
  "test-only-conversation-acceptance-api-runner.js",
  "planner-boundary-contract-runner.js",
  "canonical-request-contract-runner.js",
  "conversation-state-v3-runtime-reducer-runner.js",
  "planner-failure-safety-runner.js",
  "planner-semantic-contract-runner.js",
  "v2-runtime-uniqueness-runner.js"
];

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function createFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-integrity-"));
  const agents = options.agents === undefined
    ? [
      "# JunZan AI Codex Integrity Rules",
      "INTEGRITY_FAILURE",
      "## Trust Boundaries and Evidence",
      "Do not claim commands, tests, reviews, commits, pushes, deployments, or external actions without recorded evidence.",
      "## Test Classification",
      "UNIT_TEST STRUCTURED_CONTRACT_TEST FAKE_INTEGRATION RECORDED_REPRODUCTION RUNTIME_COMPONENT_TEST REAL_OPENAI_PLANNER REAL_POSTGRESQL_PROVIDER REAL_LINE REAL_RENDER_DEPLOYMENT",
      "## Blocker Protocol",
      "BLOCKED",
      "## Integrity Gate Scope",
      "This gate validates repository files and does not run OpenAI, PostgreSQL, LINE, or Render providers.",
      "IMPLEMENTED_LOCAL_VERIFIED"
    ].join("\n")
    : options.agents;
  if (agents !== null) writeFile(root, "AGENTS.md", agents);

  const packageScript = options.packageScript === undefined
    ? "node scripts/verify-codex-integrity.js"
    : options.packageScript;
  writeFile(root, "package.json", JSON.stringify({ scripts: { "verify:codex-integrity": packageScript } }, null, 2));

  if (!options.omitGateScript) writeFile(root, "scripts/verify-codex-integrity.js", "\"use strict\";\nconsole.log(\"fixture\");\n");
  if (!options.omitWorkflow) writeFile(root, ".github/workflows/codex-integrity.yml", [
    "name: codex-integrity",
    "jobs:",
    "  verify:",
    "    steps:",
    "      - run: npm ci",
    "      - run: npm run verify:codex-integrity"
  ].join("\n"));
  for (const runner of requiredContractRunners) writeFile(root, `tests/${runner}`, "\"use strict\";\n");
  writeFile(root, "lib/safe.js", options.source || "\"use strict\";\nmodule.exports = true;\n");
  return root;
}

function runGate(root) {
  return spawnSync(process.execPath, [gatePath, "--root", root], { encoding: "utf8" });
}

function expectsPass(root, label) {
  const result = runGate(root);
  assert.equal(result.status, 0, `${label} should pass: ${result.stderr || result.stdout}`);
  assert.match(result.stdout, /PASS codex-integrity/, `${label} should print PASS`);
}

function expectsFailure(root, label) {
  const result = runGate(root);
  assert.equal(result.status, 1, `${label} should fail with exit code 1`);
  assert.match(result.stderr, /INTEGRITY_FAILURE/, `${label} should report INTEGRITY_FAILURE`);
}

expectsPass(createFixture(), "valid fixture");
expectsFailure(createFixture({ agents: null }), "missing AGENTS.md");
expectsFailure(createFixture({ agents: "# incomplete" }), "missing integrity rules");
expectsFailure(createFixture({ packageScript: "node scripts/not-the-gate.js" }), "wrong package script");
expectsFailure(createFixture({ omitGateScript: true }), "missing gate script");
expectsFailure(createFixture({ omitWorkflow: true }), "missing integrity CI workflow");
expectsFailure(createFixture({ source: "test.skip(\"disabled\", () => {});\n" }), "forbidden skipped test");
expectsFailure(createFixture({ source: "process.exit(0);\n" }), "forbidden forced success exit");
expectsFailure(createFixture({ source: "const token = \"sk-live-0123456789abcdef0123456789abcdef0123456789\";\n" }), "embedded secret-like value");
expectsFailure(createFixture({ source: "if (source.includes(alias)) return true;\n" }), "forbidden semantic shortcut");

const missingContractRoot = createFixture();
fs.rmSync(path.join(missingContractRoot, "tests", requiredContractRunners[0]));
expectsFailure(missingContractRoot, "missing required contract runner");

console.log(JSON.stringify({ suite: "verify-codex-integrity", caseCount: 11, passCount: 11, failCount: 0 }));
