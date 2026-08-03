"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const gatePath = path.join(projectRoot, "scripts", "verify-protected-acceptance.js");
const MANIFEST_PATH = ".github/protected-acceptance.json";
const APPROVED_PATHS = Object.freeze([
  "pilot/nephi-home-node-pilot-v1/docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md",
  "pilot/nephi-home-node-pilot-v1/tests/fixtures/v1-golden-acceptance-matrix.json",
  "pilot/nephi-home-node-pilot-v1/tests/v1-golden-acceptance-matrix-runner.js",
  "pilot/nephi-home-node-pilot-v1/tests/first-version-acceptance-matrix-runner.js",
  "pilot/nephi-home-node-pilot-v1/tests/canonical-request-golden-gate-runner.js",
  "pilot/nephi-home-node-pilot-v1/tests/v2-runtime-uniqueness-runner.js",
  "pilot/nephi-home-node-pilot-v1/scripts/verify-codex-integrity.js",
  "pilot/nephi-home-node-pilot-v1/tests/verify-codex-integrity-runner.js",
  "pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js",
  "pilot/nephi-home-node-pilot-v1/tests/verify-protected-acceptance-runner.js",
  ".github/workflows/codex-integrity.yml",
  MANIFEST_PATH,
  ".github/CODEOWNERS"
]);
const IMMUTABLE_PATHS = new Set([
  APPROVED_PATHS[0],
  APPROVED_PATHS[1],
  APPROVED_PATHS[2],
  APPROVED_PATHS[3]
]);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function writeManifest(root, manifest) {
  writeFile(root, MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function createFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "protected-acceptance-"));
  const protectedFiles = [];
  for (const relativePath of APPROVED_PATHS.filter((item) => item !== MANIFEST_PATH)) {
    const content = `fixture:${relativePath}\n`;
    writeFile(root, relativePath, content);
    protectedFiles.push({
      path: relativePath,
      sha256: sha256(content),
      baseline: IMMUTABLE_PATHS.has(relativePath) ? "immutable" : "accepted-current"
    });
  }
  const manifest = {
    schemaVersion: 1,
    baselineCommit: "5a7c018c4a409ec5b429fb191c1ad6ab84e47696",
    protectedPaths: [...APPROVED_PATHS],
    protectedFiles,
    manifestControl: { selfHash: false }
  };
  if (typeof options.mutateManifest === "function") options.mutateManifest(manifest);
  writeManifest(root, manifest);
  if (typeof options.afterManifest === "function") options.afterManifest(root, manifest);
  return root;
}

function runGit(root, args) {
  const result = spawnSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function createCrlfCheckoutFixture() {
  const root = createFixture();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), "utf8"));
  const checkoutHashPath = ".github/CODEOWNERS";
  const checkoutHashLfText = fs.readFileSync(path.join(root, checkoutHashPath), "utf8");
  manifest.protectedFiles.find((item) => item.path === checkoutHashPath).sha256 = sha256(
    checkoutHashLfText.replace(/\r?\n/g, "\r\n")
  );

  const intentionalCrlfPath = ".github/workflows/codex-integrity.yml";
  const intentionalCrlfText = fs.readFileSync(path.join(root, intentionalCrlfPath), "utf8")
    .replace(/\r?\n/g, "\r\n");
  writeFile(root, intentionalCrlfPath, intentionalCrlfText);
  manifest.protectedFiles.find((item) => item.path === intentionalCrlfPath).sha256 = sha256(intentionalCrlfText);
  writeManifest(root, manifest);
  runGit(root, ["init"]);
  runGit(root, ["add", "--", "."]);

  const checkoutConvertedPath = APPROVED_PATHS[0];
  const checkoutConvertedTarget = path.join(root, checkoutConvertedPath);
  const authoritativeLfText = fs.readFileSync(checkoutConvertedTarget, "utf8");
  fs.writeFileSync(checkoutConvertedTarget, authoritativeLfText.replace(/\r?\n/g, "\r\n"), "utf8");
  return root;
}

function updateProtectedHash(root, manifest, relativePath, content) {
  writeFile(root, relativePath, content);
  const entry = manifest.protectedFiles.find((item) => item.path === relativePath);
  assert.ok(entry, `missing fixture manifest entry for ${relativePath}`);
  entry.sha256 = sha256(content);
  writeManifest(root, manifest);
}

function runGate(root, args = [], env = {}) {
  return spawnSync(process.execPath, [gatePath, "--root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function expectsPass(root, label) {
  const result = runGate(root);
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  assert.match(result.stdout, /PASS protected-acceptance/);
  return { label, expected: "pass", status: result.status };
}

function expectsFailure(root, label, args = [], env = {}) {
  const result = runGate(root, args, env);
  assert.equal(result.status, 1, `${label} must exit 1: ${result.stderr || result.stdout}`);
  assert.match(result.stderr, /INTEGRITY_FAILURE/);
  return { label, expected: "failure", status: result.status };
}

const evidence = [];
evidence.push(expectsPass(createFixture(), "valid manifest"));
evidence.push(expectsPass(
  createCrlfCheckoutFixture(),
  "Git index authority preserves intentional line endings across a CRLF checkout"
));

const missingFileRoot = createFixture();
fs.rmSync(path.join(missingFileRoot, APPROVED_PATHS[4]));
evidence.push(expectsFailure(missingFileRoot, "missing protected file"));

const changedFileRoot = createFixture();
fs.appendFileSync(path.join(changedFileRoot, APPROVED_PATHS[5]), "changed\n", "utf8");
evidence.push(expectsFailure(changedFileRoot, "changed protected file"));

const changedGoldenRoot = createFixture();
fs.appendFileSync(path.join(changedGoldenRoot, APPROVED_PATHS[1]), "mutated expected result\n", "utf8");
evidence.push(expectsFailure(changedGoldenRoot, "changed Golden expected value"));

evidence.push(expectsFailure(createFixture({
  mutateManifest(manifest) {
    manifest.protectedPaths.push(manifest.protectedPaths[0]);
  }
}), "duplicate protected path"));

evidence.push(expectsFailure(createFixture({
  mutateManifest(manifest) {
    manifest.protectedPaths[0] = "pilot/nephi-home-node-pilot-v1/tests/**";
  }
}), "glob protected path"));

const directoryRoot = createFixture();
const directoryPath = path.join(directoryRoot, APPROVED_PATHS[6]);
fs.rmSync(directoryPath);
fs.mkdirSync(directoryPath);
evidence.push(expectsFailure(directoryRoot, "directory is not a protected file"));

evidence.push(expectsFailure(createFixture({
  mutateManifest(manifest) {
    manifest.protectedFiles.push({
      path: MANIFEST_PATH,
      sha256: "0".repeat(64),
      baseline: "accepted-current"
    });
    manifest.manifestControl.selfHash = true;
  }
}), "manifest self-hash"));

evidence.push(expectsFailure(createFixture(), "bootstrap bypass", ["--bootstrap"]));
evidence.push(expectsFailure(createFixture(), "update bypass", ["--update"]));
evidence.push(expectsFailure(createFixture(), "skip bypass", ["--skip"]));
evidence.push(expectsFailure(createFixture(), "override environment", [], { CODEX_ACCEPTANCE_OVERRIDE: "1" }));

evidence.push(expectsFailure(createFixture({
  mutateManifest(manifest) {
    manifest.allowedBranches = ["codex/execution-integrity-rules"];
  }
}), "branch allowlist"));

evidence.push(expectsFailure(createFixture({
  mutateManifest(manifest) {
    manifest.allowedShas = [manifest.baselineCommit];
  }
}), "SHA allowlist"));

const forcedSuccessRoot = createFixture({
  afterManifest(root, manifest) {
    updateProtectedHash(
      root,
      manifest,
      "pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js",
      `"use strict";\n${"process"}.exit(0);\n`
    );
  }
});
evidence.push(expectsFailure(forcedSuccessRoot, "forced-success protected Gate source"));

const ordinaryUnitRoot = createFixture();
writeFile(ordinaryUnitRoot, "pilot/nephi-home-node-pilot-v1/tests/new-unit-runner.js", "unit addition\n");
evidence.push(expectsPass(ordinaryUnitRoot, "ordinary unit test addition"));

console.log(JSON.stringify({
  suite: "verify-protected-acceptance",
  caseCount: evidence.length,
  passCount: evidence.length,
  failCount: 0,
  evidence
}));
