"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { openPostgres } = require("./postgres-client");

async function migratePostgres(connection) {
  const client = await openPostgres(connection);
  try {
    const directory = path.resolve(__dirname, "../../migrations");
    const files = fs.readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.transaction(async (transaction) => {
      await transaction.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
      const executed = [];
      for (const file of files) {
        const existing = await transaction.query("SELECT 1 FROM schema_migrations WHERE filename=$1", [file]);
        if (existing.rows.length) continue;
        await transaction.exec(fs.readFileSync(path.join(directory, file), "utf8"));
        await transaction.query("INSERT INTO schema_migrations(filename) VALUES($1)", [file]);
        executed.push(file);
      }
      return executed;
    });
    return { migrated: true, files, applied };
  } finally { await client.close(); }
}
module.exports = { migratePostgres };