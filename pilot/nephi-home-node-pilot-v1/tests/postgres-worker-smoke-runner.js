"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");

const ROOT = path.resolve(__dirname, "..");
const DIRECT_MIGRATION_TIMEOUT_MS = process.platform === "win32" ? 90000 : 30000;

async function run() {
  const directMigration = spawnSync(
    process.execPath,
    ["-e", "require('./lib/providers/postgres-migrate').migratePostgres({kind:'pglite',dataDir:require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'pglite-direct-'))}).then(()=>console.log('migration-complete')).catch(error=>{console.error(error.stack||error);process.exit(1)})"],
    { cwd: ROOT, encoding: "utf8", timeout: DIRECT_MIGRATION_TIMEOUT_MS }
  );
  assert.equal(directMigration.status, 0, "a direct PGlite migration must complete instead of letting Node exit before its promise settles");
  assert.match(directMigration.stdout, /migration-complete/, "a direct PGlite migration must reach its completion marker");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-worker-smoke-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  let providers;
  try {
    await migratePostgres(connection);
    providers = createPostgresProviders(connection);
    assert.deepEqual(
      providers.customerSettings.listProperties(),
      [],
      "the production provider must spawn the real worker and complete a read-only RPC"
    );
  } finally {
    if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const missingConnection = spawnSync(
    process.execPath,
    ["-e", "require('./lib/providers/postgres-providers').createPostgresProviders()"],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 15000
    }
  );
  assert.equal(missingConnection.status, 1, "missing connection must fail with a non-zero exit");
  assert.equal(missingConnection.signal, null, "missing connection must fail without hanging or being killed");
  assert.match(
    `${missingConnection.stdout}\n${missingConnection.stderr}`,
    /postgres connection is required/,
    "missing connection must expose a bounded safe configuration error"
  );
  console.log(JSON.stringify({ caseCount: 3, passCount: 3, failCount: 0 }));
  console.log("postgres worker smoke: PASS");
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
