"use strict";
// Trusted-base release governance only. Never imported by application runtime.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const gate = require("./core-reliability-gate");

const APP = "pilot/nephi-home-node-pilot-v1";
const TASK = ".github/core-reliability-task.json";
const GUEST = `${APP}/public/assets/guest.js`;
const CSS = `${APP}/public/assets/guest.css`;
const AFFECTED = "tests/first-version-public-admin-runner.js";
const DISPLAY_STRING_PREFIXES = Object.freeze([
  'const INVALID_LINK_MESSAGE="',
  'price.textContent="',
  'total.textContent="',
  'copy.textContent="',
  'link.textContent="',
  'message.textContent="',
  'message.textContent=data.empty?"'
]);
const UNSAFE_CSS = /@import\b|@namespace\b|@font-face\b|url\s*\(|expression\s*\(|-moz-binding\b|behavior\s*:|<\/style\b/i;
const SHA = /^[a-f0-9]{40}$/;

function git(root, args, encoding = "utf8") {
  return execFileSync("git", args, { cwd: root, encoding, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function blob(root, ref, file) {
  if (!git(root, ["ls-tree", ref, "--", file]).startsWith("100644 blob ")) return null;
  const bytes = git(root, ["show", `${ref}:${file}`], null);
  if (bytes.length > 512 * 1024 || bytes.includes(0)) return null;
  const source = bytes.toString("utf8");
  return Buffer.from(source, "utf8").equals(bytes) ? source : null;
}
function maskDisplayStrings(source) {
  let cursor = 0, masked = "", values = [];
  while (cursor < source.length) {
    let found = null;
    for (const prefix of DISPLAY_STRING_PREFIXES) {
      const index = source.indexOf(prefix, cursor);
      if (index !== -1 && (!found || index < found.index || index === found.index && prefix.length > found.prefix.length)) found = { index, prefix };
    }
    if (!found) break;
    const start = found.index + found.prefix.length;
    let end = start;
    while (end < source.length) {
      if (source[end] === "\\") { end += 2; continue; }
      if (source[end] === '"') break;
      if (source[end] === "\n" || source[end] === "\r") return null;
      end++;
    }
    if (end >= source.length) return null;
    masked += source.slice(cursor, start) + "\u0000";
    values.push(source.slice(start, end));
    cursor = end;
  }
  return { masked: masked + source.slice(cursor), values };
}
function pureGuestText(before, after) {
  const old = maskDisplayStrings(before), next = maskDisplayStrings(after);
  return Boolean(old && next && old.masked === next.masked && old.values.length === next.values.length
    && old.values.some((value, index) => value !== next.values[index]));
}
function pureCss(before, after) {
  if (before === after || UNSAFE_CSS.test(after) || /[\\\0]/.test(after) || /<(?:script|iframe|object)\b/i.test(after)) return false;
  let depth = 0;
  for (const char of after) {
    if (char === "{") depth++;
    if (char === "}" && --depth < 0) return false;
  }
  return depth === 0;
}
function classify({ root, baseline, candidate }) {
  if (!SHA.test(baseline || "") || !SHA.test(candidate || "")) throw new Error("INVALID_SHA");
  root = path.resolve(root);
  git(root, ["merge-base", "--is-ancestor", baseline, candidate]);
  const changedPaths = git(root, ["diff", "--no-renames", "--name-only", "-z", baseline, candidate]).split("\0").filter(Boolean).sort();
  const productPaths = changedPaths.filter(file => file !== TASK);
  const fallback = reason => ({ fast: false, reason, baselineSha: baseline, candidateSha: candidate, changedPaths, productPaths, runners: [] });
  if (!changedPaths.includes(TASK) || !productPaths.length) return fallback("TASK_OR_PRODUCT_DIFF_MISSING");
  if (productPaths.some(file => file !== GUEST && file !== CSS)) return fallback("NON_WHITELIST_PATH");
  for (const file of productPaths) {
    const before = blob(root, baseline, file), after = blob(root, candidate, file);
    if (before === null || after === null) return fallback("NON_REGULAR_OR_INVALID_BLOB");
    if (file === GUEST && !pureGuestText(before, after)) return fallback("JS_NOT_DISPLAY_TEXT_ONLY");
    if (file === CSS && !pureCss(before, after)) return fallback("CSS_NOT_PURE_STYLE");
  }
  let task;
  try { task = JSON.parse(git(root, ["show", `${candidate}:${TASK}`])); }
  catch { return fallback("TASK_INVALID"); }
  if (task.schemaVersion !== 1 || task.baseline !== baseline || !String(task.objective || "").trim()
      || task.contractChangeAllowed !== false || task.gateChangeAllowed !== false
      || !Array.isArray(task.affectedCapabilities) || !Array.isArray(task.allowedPaths)
      || JSON.stringify([...task.allowedPaths].sort()) !== JSON.stringify(changedPaths)) return fallback("TASK_SCOPE_MISMATCH");
  const diffSha256 = sha256(git(root, ["diff", "--binary", "--no-renames", baseline, candidate], null));
  return { fast: true, reason: "TRUSTED_ACTUAL_DIFF", baselineSha: baseline, candidateSha: candidate, diffSha256, changedPaths, productPaths, runners: [AFFECTED] };
}
function verifyFast({ root, baseline, candidate, evidenceDir }) {
  const classified = classify({ root, baseline, candidate });
  if (!classified.fast) throw new Error("FAST_PATH_NOT_ELIGIBLE: " + classified.reason);
  gate.verifyCheckout(root, candidate);
  const commands = [
    { id: "git-diff-check", argv: ["git", "-C", path.resolve(root), "diff", "--check", baseline, candidate] },
    ...classified.runners.map(runner => ({ id: runner, argv: [process.execPath, runner] }))
  ];
  const report = gate.runCommands({ root, cwd: path.join(root, APP), candidate, baseline, commands, evidenceDir });
  Object.assign(report, { fastPath: true, diffSha256: classified.diffSha256, changedPaths: classified.changedPaths, productPaths: classified.productPaths });
  if (report.status === "PASS") {
    gate.verifyCheckout(root, candidate);
    gate.validateEvidence(report, baseline, candidate, commands.map(command => command.id));
    for (const result of report.results) {
      if (sha256(fs.readFileSync(path.join(evidenceDir, result.logFile))) !== result.logSha256) throw new Error("LOG_DIGEST_MISMATCH");
    }
  }
  fs.writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(report, null, 2));
  return report;
}
function argsFor(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || !argv[i + 1]) throw new Error("INVALID_ARGUMENTS");
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}
if (require.main === module) {
  try {
    const [command, ...rest] = process.argv.slice(2), args = argsFor(rest);
    const input = { root: args.root, baseline: args.baseline, candidate: args.candidate };
    if (command === "classify") {
      const result = classify(input);
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `fast=${result.fast}\n`);
      console.log(JSON.stringify(result));
    } else if (command === "verify") {
      if (!args.evidence) throw new Error("EVIDENCE_REQUIRED");
      const report = verifyFast({ ...input, evidenceDir: args.evidence });
      console.log(JSON.stringify(report));
      if (report.status !== "PASS") process.exitCode = 1;
    } else throw new Error("INVALID_COMMAND");
  } catch (error) { console.error("FAST_PATH_STOP: " + error.message); process.exitCode = 1; }
}
module.exports = { classify, pureGuestText, pureCss, verifyFast };
