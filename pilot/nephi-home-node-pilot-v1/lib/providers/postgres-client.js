"use strict";

async function openPostgres(connection) {
  if (connection && connection.kind === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const { NodeFS } = await import("@electric-sql/pglite/nodefs");
    const db = await PGlite.create({ fs: new NodeFS(connection.dataDir) });
    return { query: (text, params) => db.query(text, params), exec: (text) => db.exec(text), close: () => db.close() };
  }
  const { Pool } = require("pg");
  const hostname = new URL(connection.databaseUrl).hostname;
  const ssl = connection.ssl === false || hostname.endsWith(".internal")
    ? false
    : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: connection.databaseUrl, ssl });
  return { query: (text, params) => pool.query(text, params), exec: (text) => pool.query(text), close: () => pool.end() };
}

module.exports = { openPostgres };
