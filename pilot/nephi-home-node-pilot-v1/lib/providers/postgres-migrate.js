"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { openPostgres } = require("./postgres-client");

async function migratePostgres(connection) {
  const client = await openPostgres(connection);
  try {
    await client.exec(fs.readFileSync(path.resolve(__dirname, "../../migrations/001_initial.sql"), "utf8"));
    return { migrated: true };
  } finally { await client.close(); }
}
module.exports = { migratePostgres };
