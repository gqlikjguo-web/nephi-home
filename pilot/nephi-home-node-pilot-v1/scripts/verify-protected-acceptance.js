"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const BASELINE_COMMIT = "5a7c018c4a409ec5b429fb191c1ad6ab84e47696";
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
const TOP_LEVEL_KEYS = Object.freeze([
  "baselineCommit",
  "manifestControl",
  "protectedFiles",
  "protectedPaths",
  "schemaVersion"
]);
const PROTECTED_FILE_KEYS = Object.freeze(["baseline", "path", "sha256"]);

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function lineEndingVariants(bytes) {
  const lfBytes = Buffer.allocUnsafe(bytes.length);
  let lfLength = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) continue;
    lfBytes[lfLength] = bytes[index];
    lfLength += 1;
  }
  const lf = lfBytes.subarray(0, lfLength);
  let lineFeedCount = 0;
  for (const byte of lf) if (byte === 10) lineFeedCount += 1;
  const crlf = Buffer.allocUnsafe(lf.length + lineFeedCount);
  let crlfOffset = 0;
  for (const byte of lf) {
    if (byte === 10) crlf[crlfOffset++] = 13;
    crlf[crlfOffset++] = byte;
  }
  return [bytes, lf, crlf];
}

function sha256Variants(bytes) {
  return [...new Set(lineEndingVariants(bytes).map((variant) => (
    crypto.createHash("sha256").update(variant).digest("hex")
  )))];
}

function createAuthorityReader(root) {
  try {
    const gitRoot = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    }).trim();
    const resolvedRoot = path.resolve(root);
    const resolvedGitRoot = path.resolve(gitRoot);
    const sameRoot = process.platform === "win32"
      ? resolvedRoot.toLowerCase() === resolvedGitRoot.toLowerCase()
      : resolvedRoot === resolvedGitRoot;
    if (sameRoot) {
      return (relativePath) => execFileSync("git", ["-C", root, "show", `:${relativePath}`], {
        encoding: null,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      });
    }
  } catch {
    // Standalone fixture roots intentionally use their on-disk bytes.
  }
  return (relativePath) => path.join(root, ...relativePath.split("/"));
}

function readAuthorityBytes(reader, relativePath) {
  const result = reader(relativePath);
  return Buffer.isBuffer(result) ? result : fs.readFileSync(result);
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validatePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath) return "path must be a non-empty string";
  if (relativePath.includes("\\")) return `path must use forward slashes: ${relativePath}`;
  if (relativePath.includes("*") || relativePath.includes("?")) return `glob path is forbidden: ${relativePath}`;
  if (path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) return `absolute path is forbidden: ${relativePath}`;
  const segments = relativePath.split("/");
  if (segments.includes("..") || segments.includes(".")) return `relative traversal is forbidden: ${relativePath}`;
  if (path.posix.normalize(relativePath) !== relativePath) return `path is not normalized: ${relativePath}`;
  return "";
}

function validateManifest(manifest) {
  const failures = [];
  if (!hasExactKeys(manifest, TOP_LEVEL_KEYS)) {
    failures.push("manifest must contain only the approved top-level keys");
    return failures;
  }
  if (manifest.schemaVersion !== 1) failures.push("manifest schemaVersion must be 1");
  if (manifest.baselineCommit !== BASELINE_COMMIT) failures.push(`manifest baselineCommit must be ${BASELINE_COMMIT}`);
  if (!hasExactKeys(manifest.manifestControl, ["selfHash"]) || manifest.manifestControl.selfHash !== false) {
    failures.push("manifestControl must be exactly { selfHash: false }");
  }
  if (!Array.isArray(manifest.protectedPaths)) {
    failures.push("protectedPaths must be an array");
  } else {
    const seen = new Set();
    for (const relativePath of manifest.protectedPaths) {
      const pathFailure = validatePath(relativePath);
      if (pathFailure) failures.push(pathFailure);
      if (seen.has(relativePath)) failures.push(`duplicate protected path: ${relativePath}`);
      seen.add(relativePath);
    }
    if (manifest.protectedPaths.length !== APPROVED_PATHS.length
      || manifest.protectedPaths.some((relativePath, index) => relativePath !== APPROVED_PATHS[index])) {
      failures.push("protectedPaths must exactly equal the approved protected acceptance list");
    }
  }
  if (!Array.isArray(manifest.protectedFiles)) {
    failures.push("protectedFiles must be an array");
    return failures;
  }
  const expectedHashedPaths = APPROVED_PATHS.filter((item) => item !== MANIFEST_PATH);
  const seenFiles = new Set();
  for (const entry of manifest.protectedFiles) {
    if (!hasExactKeys(entry, PROTECTED_FILE_KEYS)) {
      failures.push("every protectedFiles entry must contain only path, sha256 and baseline");
      continue;
    }
    const pathFailure = validatePath(entry.path);
    if (pathFailure) failures.push(pathFailure);
    if (seenFiles.has(entry.path)) failures.push(`duplicate protected file: ${entry.path}`);
    seenFiles.add(entry.path);
    if (entry.path === MANIFEST_PATH) failures.push("the manifest must not self-hash");
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) failures.push(`invalid lowercase SHA-256 for ${entry.path}`);
    const expectedBaseline = IMMUTABLE_PATHS.has(entry.path) ? "immutable" : "accepted-current";
    if (entry.baseline !== expectedBaseline) failures.push(`invalid baseline classification for ${entry.path}`);
  }
  if (manifest.protectedFiles.length !== expectedHashedPaths.length
    || expectedHashedPaths.some((relativePath) => !seenFiles.has(relativePath))
    || [...seenFiles].some((relativePath) => !expectedHashedPaths.includes(relativePath))) {
    failures.push("protectedFiles must hash every approved path except the manifest itself, and no others");
  }
  return failures;
}

function hashesEqual(expected, actual) {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

function verifyProtectedAcceptance(root, manifest, authorityReader = createAuthorityReader(root)) {
  const failures = validateManifest(manifest);
  if (failures.length) return failures;
  for (const relativePath of manifest.protectedPaths) {
    const target = path.join(root, ...relativePath.split("/"));
    if (!fs.existsSync(target)) {
      failures.push(`missing protected path: ${relativePath}`);
      continue;
    }
    if (!fs.statSync(target).isFile()) failures.push(`protected path is not a file: ${relativePath}`);
  }
  for (const entry of manifest.protectedFiles) {
    const target = path.join(root, ...entry.path.split("/"));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    let actualVariants;
    try {
      actualVariants = sha256Variants(readAuthorityBytes(authorityReader, entry.path));
    } catch (error) {
      failures.push(`cannot read protected Git authority for ${entry.path}: ${error.message}`);
      continue;
    }
    if (!actualVariants.some((actual) => hashesEqual(entry.sha256, actual))) {
      failures.push(`SHA-256 mismatch for ${entry.path}: expected ${entry.sha256}, actual variants ${actualVariants.join(", ")}`);
    }
  }
  const protectedGatePath = path.join(root, ..."pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js".split("/"));
  if (fs.existsSync(protectedGatePath) && fs.statSync(protectedGatePath).isFile()) {
    const forcedSuccessText = "process" + ".exit(0)";
    const protectedGateSource = readAuthorityBytes(
      authorityReader,
      "pilot/nephi-home-node-pilot-v1/scripts/verify-protected-acceptance.js"
    ).toString("utf8");
    if (protectedGateSource.includes(forcedSuccessText)) {
      failures.push("protected acceptance Gate must not force a successful exit");
    }
  }
  return failures;
}

function parseRoot(args) {
  if (args.length === 0) return path.resolve(__dirname, "..", "..", "..");
  if (args.length === 2 && args[0] === "--root" && args[1]) return path.resolve(args[1]);
  throw new Error(`unsupported argument(s): ${args.join(" ") || "<empty>"}`);
}

function main() {
  const failures = [];
  let root;
  try {
    root = parseRoot(process.argv.slice(2));
  } catch (error) {
    failures.push(error.message);
  }
  if (Object.prototype.hasOwnProperty.call(process.env, "CODEX_ACCEPTANCE_OVERRIDE")) {
    failures.push("CODEX_ACCEPTANCE_OVERRIDE is forbidden");
  }
  if (!failures.length) {
    const manifestPath = path.join(root, ...MANIFEST_PATH.split("/"));
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
      failures.push(`missing protected acceptance manifest: ${MANIFEST_PATH}`);
    } else {
      try {
        const authorityReader = createAuthorityReader(root);
        const manifest = JSON.parse(readAuthorityBytes(authorityReader, MANIFEST_PATH).toString("utf8"));
        failures.push(...verifyProtectedAcceptance(root, manifest, authorityReader));
      } catch (error) {
        failures.push(`cannot read protected acceptance manifest: ${error.message}`);
      }
    }
  }
  if (failures.length) {
    for (const failure of failures) console.error(`INTEGRITY_FAILURE: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("PASS protected-acceptance");
}

if (require.main === module) main();

module.exports = {
  createAuthorityReader,
  lineEndingVariants,
  sha256File,
  validateManifest,
  verifyProtectedAcceptance
};
