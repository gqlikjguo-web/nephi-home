"use strict";

const path = require("node:path");
const { seedPostgres, loadSeedManifest } = require("../../lib/providers/postgres-seed");

const seedInput = loadSeedManifest(path.resolve(__dirname, "../../fixtures/postgres-seed.json"));

function seedDemoPostgres(connection) {
  return seedPostgres(connection, seedInput);
}

module.exports = { seedDemoPostgres };
