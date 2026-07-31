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
