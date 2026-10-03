"use strict";
// Governance/test storage only. Never imported by application runtime.
const fs = require("node:fs");
const path = require("node:path");

const MARKER = ".junzan-managed-test-temp.json";
const MIN_FREE_BYTES = 1024 ** 3;
const WARN_FREE_BYTES = 2 * 1024 ** 3;
const MIN_FREE_RATIO = 0.2;
const WARN_FREE_RATIO = 0.3;
const MIN_FREE_INODES = 10_000;
const DEFAULT_SCRATCH_LIMIT = 1024 ** 3;

function existingAncestor(target) {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("DISK_PREFLIGHT_PATH_UNAVAILABLE");
    current = parent;
  }
  return current;
}

function preflight(target, options = {}) {
  const statfs = options.statfs || (value => fs.statfsSync(existingAncestor(value)));
  const value = statfs(target), blockSize = Number(value.bsize || value.frsize);
  const freeBytes = blockSize * Number(value.bavail), totalBytes = blockSize * Number(value.blocks);
  const freeInodes = Number(value.ffree), ratio = totalBytes > 0 ? freeBytes / totalBytes : 0;
  const minBytes = options.minFreeBytes ?? MIN_FREE_BYTES;
  const minRatio = options.minFreeRatio ?? MIN_FREE_RATIO;
  const minInodes = options.minFreeInodes ?? MIN_FREE_INODES;
  if (!Number.isFinite(freeBytes) || freeBytes < minBytes || ratio < minRatio) throw new Error("DISK_PREFLIGHT_BLOCKED_SPACE");
  if (!Number.isFinite(freeInodes) || freeInodes < minInodes) throw new Error("DISK_PREFLIGHT_BLOCKED_INODES");
  return Object.freeze({ status: freeBytes < (options.warnFreeBytes ?? WARN_FREE_BYTES) || ratio < (options.warnFreeRatio ?? WARN_FREE_RATIO) ? "WARN" : "PASS",
    freeBytes, totalBytes, freeRatio: ratio, freeInodes });
}

function safeLabel(value) {
  const label = String(value || "run").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48);
  return label || "run";
}

function markerAt(scratch) { return path.join(scratch, MARKER); }
function readMarker(scratch) {
  let marker;
  try { marker = JSON.parse(fs.readFileSync(markerAt(scratch), "utf8")); } catch { throw new Error("MANAGED_TEST_TEMP_MARKER_REQUIRED"); }
  if (!marker || marker.schemaVersion !== 1 || marker.kind !== "junzan-managed-test-temp" || path.resolve(marker.path) !== path.resolve(scratch))
    throw new Error("MANAGED_TEST_TEMP_MARKER_REQUIRED");
  return marker;
}

function startManagedScratch(parent, label, options = {}) {
  fs.mkdirSync(parent, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(path.resolve(parent), `.junzan-test-tmp-${safeLabel(label)}-`));
  const marker = { schemaVersion: 1, kind: "junzan-managed-test-temp", status: "RUNNING", path: scratch,
    createdAtMs: (options.now || Date.now)(), ownerPid: options.pid ?? process.pid };
  fs.writeFileSync(markerAt(scratch), JSON.stringify(marker), { flag: "wx" });
  return scratch;
}

function markManagedScratchComplete(scratch, options = {}) {
  const marker = readMarker(scratch);
  fs.writeFileSync(markerAt(scratch), JSON.stringify({ ...marker, status: "COMPLETED", completedAtMs: (options.now || Date.now)() }));
  return scratch;
}

function finishManagedScratch(scratch, options = {}) {
  markManagedScratchComplete(scratch, options);
  fs.rmSync(scratch, { recursive: true, force: false, maxRetries: 0 });
  return { removed: true, path: scratch };
}

function directoryBytes(root) {
  let total = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) total += directoryBytes(file); else total += stat.size;
  }
  return total;
}

function assertScratchWithinLimit(scratch, limit = DEFAULT_SCRATCH_LIMIT) {
  readMarker(scratch);
  const bytes = directoryBytes(scratch);
  if (!Number.isSafeInteger(limit) || limit <= 0 || bytes > limit) throw new Error("TEST_TEMP_LIMIT_EXCEEDED");
  return { bytes, limit };
}

function pruneCompletedManagedScratch(root, options = {}) {
  const now = (options.now || Date.now)(), retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1000, removed = [];
  if (!fs.existsSync(root)) return { removed };
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(".junzan-test-tmp-")) continue;
    const scratch = path.join(root, entry.name); let marker;
    try { marker = readMarker(scratch); } catch { continue; }
    if (marker.status !== "COMPLETED" || !Number.isSafeInteger(marker.completedAtMs) || now - marker.completedAtMs < retentionMs) continue;
    fs.rmSync(scratch, { recursive: true, force: false, maxRetries: 0 }); removed.push(scratch);
  }
  return { removed: removed.sort() };
}

function withManagedScratch(parent, label, work, options = {}) {
  const disk = preflight(parent, options), scratch = startManagedScratch(parent, label, options);
  const result = work({ scratch, disk });
  if (result && result.status === "PASS" && fs.existsSync(scratch)) finishManagedScratch(scratch, options);
  return result;
}

module.exports = { MARKER, MIN_FREE_BYTES, MIN_FREE_RATIO, MIN_FREE_INODES, DEFAULT_SCRATCH_LIMIT,
  preflight, startManagedScratch, markManagedScratchComplete, finishManagedScratch,
  assertScratchWithinLimit, pruneCompletedManagedScratch, withManagedScratch };
