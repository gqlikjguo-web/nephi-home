"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const gatePath = path.join(projectRoot, "scripts", "verify-codex-integrity.js");
const PROJECT_PREFIX = "pilot/nephi-home-node-pilot-v1";
const projectPath = (relativePath) => `${PROJECT_PREFIX}/${relativePath}`;
const requiredContractRunners = [
  "test-only-conversation-acceptance-api-runner.js",
  "planner-boundary-contract-runner.js",
  "canonical-request-contract-runner.js",
  "conversation-state-v3-runtime-reducer-runner.js",
  "planner-failure-safety-runner.js",
  "planner-semantic-contract-runner.js",
  "v2-runtime-uniqueness-runner.js"
];

const validRootAgents = [
  "# JunZan AI Codex Integrity Rules",
  "Read [the project RULES_INDEX](pilot/nephi-home-node-pilot-v1/docs/RULES_INDEX.md) before project work.",
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
].join("\n");

const validProjectAgents = [
  "# JunZan AI project rules",
  "Read [RULES_INDEX](docs/RULES_INDEX.md) before every other project document.",
  "Project rules may be stricter but must not weaken repository integrity rules. Conflicts stop work."
].join("\n");

const validRulesIndex = [
  "# Rule Authority Index",
  "## 優先順序",
  "1. Current explicit user instruction",
  "2. Repository-root AGENTS.md",
  "3. Project AGENTS.md",
  "4. docs/RULES_INDEX.md",
  "5. The active authority for the scope",
  "同層衝突：停止並回報。",
  "## Authority registry",
  "| Authority | Scope | Status | Supersedes/Conflict action |",
  "|---|---|---|---|",
  "| docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md | Codex execution integrity | active | Stop on conflict |",
  "| docs/JUNZAN_AI_CONSTITUTION.md | Product architecture principles | active | Stop on conflict |",
  "| docs/SECURITY.md | Security and external services | active | Stop on conflict |",
  "| docs/PRODUCT_BASELINE.md | Accepted product behavior | active | Stop on conflict |",
  "| docs/DECISIONS.md | Architecture decisions | active | Use status and crosswalk |",
  "| docs/PROJECT_MEMORY.md | Current project facts | active | Stop on conflict |",
  "| docs/NEXT_TASKS.md | Unfinished work queue | active | Stop on conflict |",
  "| docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md | Core architecture acceptance | active | Immutable in this task |"
].join("\n");

const contractHeadings = [
  "## 1. 禁止假資料冒充真實結果",
  "## 2. 核心驗收與 runtime 同路徑",
  "## 3. 禁止寫死答案與特例旁路",
  "## 4. 驗收標準不可被改考卷",
  "## 5. 必須完整完成原始任務",
  "## 6. 新路徑完成必須封閉舊旁路",
  "## 7. 完成聲明必須有可核對證據鏈",
  "## 8. 誠實 BLOCKED 與未完成",
  "## 9. 核心封口的獨立審查",
  "## 10. 最小必要流程",
  "## 11. 外部系統與部署授權",
  "## 12. 權威衝突與停止條件"
];

const validContract = [
  "# Codex Execution Integrity Contract",
  ...contractHeadings,
  "Required invariant.",
  "## 測試分類與證據邊界",
  "UNIT_TEST STRUCTURED_CONTRACT_TEST FAKE_INTEGRATION RECORDED_REPRODUCTION RUNTIME_COMPONENT_TEST REAL_OPENAI_PLANNER REAL_POSTGRESQL_PROVIDER REAL_LINE REAL_RENDER_DEPLOYMENT",
  "Core acceptance, runtime component, signed webhook E2E and REAL_LINE evidence use the production entry point, provider selection, resolver, writer, FinalDecision, FinalResponse and transport.",
  "Isolated unit tests cannot be expanded into full runtime evidence.",
  "Without databaseUrl or valid postgresConnection, createProviders throws DATABASE_URL_REQUIRED.",
  "createJsonProviders is isolated-test injection only.",
  "DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION"
].join("\n");

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function createFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-integrity-"));
  const agents = options.agents === undefined
    ? validRootAgents
    : options.agents;
  if (agents !== null) writeFile(root, "AGENTS.md", agents);

  const projectAgents = options.projectAgents === undefined ? validProjectAgents : options.projectAgents;
  if (projectAgents !== null) writeFile(root, projectPath("AGENTS.md"), projectAgents);
  if (!options.omitRulesIndex) writeFile(root, projectPath("docs/RULES_INDEX.md"), options.rulesIndex || validRulesIndex);
  if (!options.omitContract) writeFile(root, projectPath("docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md"), validContract);
  for (const authority of [
    "JUNZAN_AI_CONSTITUTION.md",
    "SECURITY.md",
    "PRODUCT_BASELINE.md",
    "DECISIONS.md",
    "PROJECT_MEMORY.md",
    "NEXT_TASKS.md",
    "CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md"
  ]) writeFile(root, projectPath(`docs/${authority}`), `fixture:${authority}\n`);
  if (options.additionalAuthority) writeFile(root, projectPath(options.additionalAuthority), "fixture:additional authority\n");

  const packageScript = options.packageScript === undefined
    ? "node scripts/verify-codex-integrity.js"
    : options.packageScript;
  writeFile(root, projectPath("package.json"), JSON.stringify({ scripts: { "verify:codex-integrity": packageScript } }, null, 2));

  if (!options.omitGateScript) writeFile(root, projectPath("scripts/verify-codex-integrity.js"), "\"use strict\";\nconsole.log(\"fixture\");\n");
  if (!options.omitWorkflow) writeFile(root, ".github/workflows/codex-integrity.yml", [
    "name: codex-integrity",
    "jobs:",
    "  verify:",
    "    steps:",
    "      - run: npm ci",
    "      - run: npm run verify:codex-integrity"
  ].join("\n"));
  for (const runner of requiredContractRunners) writeFile(root, projectPath(`tests/${runner}`), "\"use strict\";\n");
  writeFile(root, projectPath("lib/safe.js"), options.source || "\"use strict\";\nmodule.exports = true;\n");
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
expectsFailure(createFixture({ projectAgents: null }), "missing project AGENTS.md");
expectsFailure(createFixture({ agents: validRootAgents.replace("pilot/nephi-home-node-pilot-v1/docs/RULES_INDEX.md", "docs/RULES_INDEX.md") }), "wrong root RULES_INDEX path");
expectsFailure(createFixture({ projectAgents: validProjectAgents.replace("docs/RULES_INDEX.md", "pilot/nephi-home-node-pilot-v1/docs/RULES_INDEX.md") }), "wrong project RULES_INDEX path");
expectsFailure(createFixture({ omitRulesIndex: true }), "missing RULES_INDEX.md");
expectsFailure(createFixture({ omitContract: true }), "missing integrity contract");
expectsFailure(createFixture({
  rulesIndex: `${validRulesIndex}\n| docs/SECOND_AUTHORITY.md | Codex execution integrity | active | Stop on conflict |`,
  additionalAuthority: "docs/SECOND_AUTHORITY.md"
}), "duplicate active authority scope");

const missingContractRoot = createFixture();
fs.rmSync(path.join(missingContractRoot, projectPath(`tests/${requiredContractRunners[0]}`)));
expectsFailure(missingContractRoot, "missing required contract runner");

console.log(JSON.stringify({ suite: "verify-codex-integrity", caseCount: 17, passCount: 17, failCount: 0 }));
