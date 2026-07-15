"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { openPostgres } = require("./postgres-client");

async function migratePostgres(connection) {
  const client = await openPostgres(connection);
  try {
    const directory = path.resolve(__dirname, "../../migrations");
    const files = fs.readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) await client.exec(fs.readFileSync(path.join(directory, file), "utf8"));
    return { migrated: true, files };
  } finally { await client.close(); }
}
module.exports = { migratePostgres };
