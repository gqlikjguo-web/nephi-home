"use strict";

const { createPostgresProviders } = require("./postgres-providers");

function databaseUrlRequired() {
  const error = new Error(
    "A non-empty databaseUrl/DATABASE_URL or an explicit PostgreSQL/PGlite connection is required"
  );
  error.code = "DATABASE_URL_REQUIRED";
  return error;
}

function createProviders(options = {}) {
  const databaseUrl = String(options.databaseUrl || "").trim();
  const postgresConnection = options.postgresConnection || null;
  if (!databaseUrl && !postgresConnection) throw databaseUrlRequired();
  const connection = postgresConnection || { kind: "pg", databaseUrl };
  return createPostgresProviders(connection);
}

module.exports = { createProviders };
