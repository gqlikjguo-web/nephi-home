"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function findSourceFiles(root, relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...findSourceFiles(root, relativePath));
    else if (/\.(?:js|cjs|mjs|ps1)$/i.test(entry.name)) files.push(relativePath);
  }
  return files;
}

function parseAuthorityRows(source) {
  const rows = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/^`|`$/g, ""));
    if (cells.length !== 4 || cells[0] === "Authority" || cells.every((cell) => /^-+$/.test(cell))) continue;
    rows.push({ authority: cells[0], scope: cells[1], status: cells[2], conflictAction: cells[3] });
  }
  return rows;
}

function verify(root) {
  const failures = [];
  const projectPrefix = fs.existsSync(path.join(root, "pilot", "nephi-home-node-pilot-v1", "package.json"))
    ? path.join("pilot", "nephi-home-node-pilot-v1")
    : "";
  const projectPath = (...segments) => path.join(projectPrefix, ...segments);
  const requireFile = (relativePath, message) => {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) failures.push(message);
    return filePath;
  };

  const agentsPath = requireFile("AGENTS.md", "missing repository-root AGENTS.md");
  if (fs.existsSync(agentsPath)) {
    const agents = readText(agentsPath);
    for (const requiredText of [
      "INTEGRITY_FAILURE",
      "Trust Boundaries",
      "Test Classification",
      "REAL_OPENAI_PLANNER",
      "REAL_POSTGRESQL_PROVIDER",
      "REAL_LINE",
      "REAL_RENDER_DEPLOYMENT",
      "Blocker Protocol",
      "BLOCKED",
      "Integrity Gate Scope",
      "does not run OpenAI, PostgreSQL, LINE, or Render providers",
      "IMPLEMENTED_LOCAL_VERIFIED"
    ]) {
      if (!agents.includes(requiredText)) failures.push(`AGENTS.md is missing required integrity content: ${requiredText}`);
    }
    const rootIndexLink = "pilot/nephi-home-node-pilot-v1/docs/RULES_INDEX.md";
    if (!agents.includes(`](${rootIndexLink})`)) failures.push(`repository-root AGENTS.md must link to ${rootIndexLink}`);
  }

  const projectAgentsPath = requireFile(projectPath("AGENTS.md"), "missing project AGENTS.md");
  if (fs.existsSync(projectAgentsPath)) {
    const projectAgents = readText(projectAgentsPath);
    const projectIndexLink = "docs/RULES_INDEX.md";
    if (!projectAgents.includes(`](${projectIndexLink})`)) failures.push(`project AGENTS.md must link to ${projectIndexLink}`);
    if (!projectAgents.includes("不得弱化") && !projectAgents.includes("must not weaken")) {
      failures.push("project AGENTS.md must forbid weakening repository integrity rules");
    }
    const indexPosition = projectAgents.indexOf(projectIndexLink);
    for (const otherDocument of ["docs/PROJECT_MEMORY.md", "docs/PRODUCT_BASELINE.md", "docs/JUNZAN_AI_CONSTITUTION.md", "docs/DECISIONS.md", "docs/SECURITY.md", "docs/NEXT_TASKS.md"]) {
      const position = projectAgents.indexOf(otherDocument);
      if (position !== -1 && (indexPosition === -1 || position < indexPosition)) {
        failures.push(`project AGENTS.md must require ${projectIndexLink} before ${otherDocument}`);
      }
    }
  }

  const rulesIndexPath = requireFile(projectPath("docs", "RULES_INDEX.md"), "missing docs/RULES_INDEX.md");
  const requiredAuthorities = [
    "docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md",
    "docs/JUNZAN_AI_CONSTITUTION.md",
    "docs/SECURITY.md",
    "docs/PRODUCT_BASELINE.md",
    "docs/DECISIONS.md",
    "docs/PROJECT_MEMORY.md",
    "docs/NEXT_TASKS.md",
    "docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md"
  ];
  if (fs.existsSync(rulesIndexPath)) {
    const rulesIndex = readText(rulesIndexPath);
    for (const requiredText of ["## 優先順序", "Authority", "Scope", "Status", "Supersedes/Conflict action", "衝突", "停止"]) {
      if (!rulesIndex.includes(requiredText)) failures.push(`RULES_INDEX.md is missing required structure: ${requiredText}`);
    }
    const rows = parseAuthorityRows(rulesIndex);
    const activeScopes = new Map();
    for (const row of rows) {
      if (!row.authority || !row.scope || !row.conflictAction) failures.push("RULES_INDEX.md contains an incomplete authority row");
      if (!new Set(["active", "historical", "superseded"]).has(row.status)) failures.push(`RULES_INDEX.md has invalid status for ${row.authority}: ${row.status}`);
      const authorityPath = path.join(root, projectPath(...row.authority.split("/")));
      if (!fs.existsSync(authorityPath) || !fs.statSync(authorityPath).isFile()) failures.push(`RULES_INDEX.md authority does not resolve to a file: ${row.authority}`);
      if (row.status === "active") {
        const owners = activeScopes.get(row.scope) || [];
        owners.push(row.authority);
        activeScopes.set(row.scope, owners);
      }
    }
    for (const [scope, owners] of activeScopes.entries()) {
      if (owners.length !== 1) failures.push(`RULES_INDEX.md has conflicting active authorities for scope ${scope}: ${owners.join(", ")}`);
    }
    for (const authority of requiredAuthorities) {
      const matching = rows.filter((row) => row.authority === authority && row.status === "active");
      if (matching.length !== 1) failures.push(`RULES_INDEX.md must contain exactly one active authority row for ${authority}`);
    }
  }

  const contractPath = requireFile(projectPath("docs", "CODEX_EXECUTION_INTEGRITY_CONTRACT.md"), "missing docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md");
  if (fs.existsSync(contractPath)) {
    const contract = readText(contractPath);
    const requiredContractText = [
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
      "## 12. 權威衝突與停止條件",
      "UNIT_TEST",
      "STRUCTURED_CONTRACT_TEST",
      "FAKE_INTEGRATION",
      "RECORDED_REPRODUCTION",
      "RUNTIME_COMPONENT_TEST",
      "REAL_OPENAI_PLANNER",
      "REAL_POSTGRESQL_PROVIDER",
      "REAL_LINE",
      "REAL_RENDER_DEPLOYMENT",
      "production entry point",
      "provider selection",
      "resolver",
      "writer",
      "FinalDecision",
      "FinalResponse",
      "transport",
      "DATABASE_URL_REQUIRED",
      "postgresConnection",
      "createJsonProviders",
      "DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION"
    ];
    for (const requiredText of requiredContractText) {
      if (!contract.includes(requiredText)) failures.push(`integrity contract is missing required invariant text: ${requiredText}`);
    }
    const numberedHeadings = contract.match(/^## (?:[1-9]|1[0-2])\. /gm) || [];
    if (numberedHeadings.length !== 12) failures.push(`integrity contract must contain exactly 12 numbered invariants, found ${numberedHeadings.length}`);
  }

  const packagePath = requireFile(projectPath("package.json"), "missing package.json");
  if (fs.existsSync(packagePath)) {
    try {
      const packageJson = JSON.parse(readText(packagePath));
      if (packageJson.scripts?.["verify:codex-integrity"] !== "node scripts/verify-codex-integrity.js") {
        failures.push("package.json must define verify:codex-integrity as node scripts/verify-codex-integrity.js");
      }
    } catch {
      failures.push("package.json is not valid JSON");
    }
  }

  const gatePath = requireFile(projectPath("scripts", "verify-codex-integrity.js"), "missing scripts/verify-codex-integrity.js");
  const forcedSuccessText = "process" + ".exit(0)";
  if (fs.existsSync(gatePath) && readText(gatePath).includes(forcedSuccessText)) {
    failures.push("the integrity gate must not force a successful exit");
  }

  const workflowPath = requireFile(".github/workflows/codex-integrity.yml", "missing .github/workflows/codex-integrity.yml");
  if (fs.existsSync(workflowPath)) {
    const workflow = readText(workflowPath);
    if (!workflow.includes("npm ci")) failures.push("integrity CI workflow must install locked dependencies with npm ci");
    if (!workflow.includes("npm run verify:codex-integrity")) failures.push("integrity CI workflow must run npm run verify:codex-integrity");
  }

  for (const runner of [
    "test-only-conversation-acceptance-api-runner.js",
    "planner-boundary-contract-runner.js",
    "canonical-request-contract-runner.js",
    "conversation-state-v3-runtime-reducer-runner.js",
    "planner-failure-safety-runner.js",
    "planner-semantic-contract-runner.js",
    "v2-runtime-uniqueness-runner.js"
  ]) requireFile(projectPath("tests", runner), `missing required contract runner: ${runner}`);

  const skippedTestPattern = /(?:\.skip\s*\(|describe\.skip\s*\(|it\.skip\s*\(|test\.skip\s*\()/;
  const forcedSuccessPattern = /process\.exit\(0\)/;
  const forbiddenSemanticShortcutPattern = /source\.includes\(\s*alias\s*\)|canonicalCandidate\s*===\s*["'](?:parking|pool|location)["']/;
  const secretPattern = /(?:^|[^A-Za-z0-9_])sk-[A-Za-z0-9_-]{32,}|(?:OPENAI_API_KEY|LINE_CHANNEL_ACCESS_TOKEN|LINE_CHANNEL_SECRET|DATABASE_URL|POSTGRES(?:QL)?_PASSWORD)\s*[:=]\s*["'][^"']{8,}["']|postgres(?:ql)?:\/\/[^\s/:]+:[^\s@]+@/i;
  const excludedFiles = new Set([projectPath("tests", "verify-codex-integrity-runner.js").split(path.sep).join("/")]);
  for (const relativePath of ["lib", "scripts", "tests"].flatMap((directory) => findSourceFiles(root, projectPath(directory)))) {
    const normalizedRelativePath = relativePath.split(path.sep).join("/");
    if (excludedFiles.has(normalizedRelativePath)) continue;
    const source = readText(path.join(root, relativePath));
    if (skippedTestPattern.test(source)) failures.push(`forbidden skipped test marker in ${relativePath}`);
    if (forcedSuccessPattern.test(source)) failures.push(`forbidden forced-success exit in ${relativePath}`);
    if (forbiddenSemanticShortcutPattern.test(source)) failures.push(`forbidden semantic shortcut in ${relativePath}`);
    if (secretPattern.test(source)) failures.push(`embedded credential-like value in ${relativePath}`);
  }

  return failures;
}

const rootFlag = process.argv.indexOf("--root");
const root = rootFlag === -1
  ? path.resolve(__dirname, "..", "..", "..")
  : path.resolve(process.argv[rootFlag + 1] || "");
const failures = verify(root);
if (failures.length) {
  for (const failure of failures) console.error(`INTEGRITY_FAILURE: ${failure}`);
  process.exitCode = 1;
} else {
  console.log("PASS codex-integrity");
}
