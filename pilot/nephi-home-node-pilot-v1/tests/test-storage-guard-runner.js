"use strict";
// STRUCTURED_CONTRACT_TEST. Isolated filesystem fixtures; no network/provider calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const guard = require("../scripts/test-storage-guard");

function stats({ freeBytes, totalBytes = 4 * 1024 ** 3, freeInodes = 100000 }) {
  return { bsize: 4096, blocks: totalBytes / 4096, bavail: freeBytes / 4096, files: 1000000, ffree: freeInodes };
}

function run() {
  let passed = 0;
  const check = (name, fn) => { fn(); passed++; console.log("PASS " + name); };
  check("preflight blocks before a low-space test run", () => {
    assert.throws(() => guard.preflight("/does/not/write", { statfs: () => stats({ freeBytes: 128 * 1024 ** 2 }) }), /DISK_PREFLIGHT_BLOCKED_SPACE/);
  });
  check("preflight blocks inode exhaustion independently", () => {
    assert.throws(() => guard.preflight("/does/not/write", { statfs: () => stats({ freeBytes: 2 * 1024 ** 3, freeInodes: 99 }) }), /DISK_PREFLIGHT_BLOCKED_INODES/);
  });
  check("healthy filesystem returns auditable capacity", () => {
    const result = guard.preflight("/does/not/write", { statfs: () => stats({ freeBytes: 2 * 1024 ** 3 }) });
    assert.equal(result.status, "PASS"); assert.equal(result.freeBytes, 2 * 1024 ** 3);
  });
  check("both formal deterministic executors require managed preflight and cleanup", () => {
    for (const file of ["capability-guard-execution.js", "core-reliability-gate.js"]) {
      const source = fs.readFileSync(path.join(__dirname, "../scripts", file), "utf8");
      assert.ok(source.includes('require("./test-storage-guard")'), file + " storage authority");
      assert.ok(source.includes("withManagedScratch("), file + " lifecycle");
      assert.ok(source.includes("assertScratchWithinLimit("), file + " cache limit");
    }
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-storage-guard-test-"));
  try {
    check("managed scratch is marked and removed after completion", () => {
      const scratch = guard.startManagedScratch(root, "gate-one", { now: () => 1000, pid: 123 });
      fs.writeFileSync(path.join(scratch, "regenerable.bin"), Buffer.alloc(1024));
      const result = guard.finishManagedScratch(scratch, { now: () => 2000 });
      assert.equal(result.removed, true); assert.equal(fs.existsSync(scratch), false);
    });
    check("cleanup refuses an unmarked directory", () => {
      const unsafe = path.join(root, "evidence"); fs.mkdirSync(unsafe); fs.writeFileSync(path.join(unsafe, "receipt.json"), "keep");
      assert.throws(() => guard.finishManagedScratch(unsafe), /MANAGED_TEST_TEMP_MARKER_REQUIRED/);
      assert.equal(fs.readFileSync(path.join(unsafe, "receipt.json"), "utf8"), "keep");
    });
    check("cache limit blocks oversized managed scratch", () => {
      const scratch = guard.startManagedScratch(root, "gate-two", { now: () => 1000, pid: 123 });
      fs.writeFileSync(path.join(scratch, "large.bin"), Buffer.alloc(2048));
      assert.throws(() => guard.assertScratchWithinLimit(scratch, 1024), /TEST_TEMP_LIMIT_EXCEEDED/);
      guard.finishManagedScratch(scratch);
    });
    check("retention removes completed markers only and preserves unfinished evidence", () => {
      const completed = guard.startManagedScratch(root, "old-complete", { now: () => 1000, pid: 123 });
      guard.markManagedScratchComplete(completed, { now: () => 2000 });
      const active = guard.startManagedScratch(root, "unfinished", { now: () => 1000, pid: 123 });
      const result = guard.pruneCompletedManagedScratch(root, { now: () => 10_000, retentionMs: 1000 });
      assert.deepEqual(result.removed, [completed]); assert.equal(fs.existsSync(active), true);
      guard.finishManagedScratch(active);
    });
    check("failed formal runs preserve their marked scratch for review", () => {
      const result = guard.withManagedScratch(root, "failed-run", ({ scratch }) => {
        fs.writeFileSync(path.join(scratch, "failure-evidence.txt"), "preserve");
        return { status: "STOP", scratch };
      }, { now: () => 1000, pid: 123 });
      assert.equal(fs.readFileSync(path.join(result.scratch, "failure-evidence.txt"), "utf8"), "preserve");
      assert.equal(JSON.parse(fs.readFileSync(path.join(result.scratch, guard.MARKER), "utf8")).status, "RUNNING");
      guard.markManagedScratchComplete(result.scratch, { now: () => 2000 });
      assert.deepEqual(guard.pruneCompletedManagedScratch(root, { now: () => 4000, retentionMs: 1000 }).removed, [result.scratch]);
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log(JSON.stringify({ classification: "STRUCTURED_CONTRACT_TEST", passed, openAiCalls: 0 }));
}

try { run(); } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
