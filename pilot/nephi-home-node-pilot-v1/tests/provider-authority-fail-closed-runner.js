"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");

const factoryPath = path.resolve(__dirname, "../lib/providers/provider-factory.js");

function loadFactoryFromSource(source) {
  const loaded = new Module(factoryPath, module);
  loaded.filename = factoryPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(factoryPath));
  loaded._compile(source, factoryPath);
  return loaded.exports;
}

function expectDatabaseUrlRequired(fn) {
  assert.throws(
    fn,
    (error) => error && error.code === "DATABASE_URL_REQUIRED"
      && /databaseUrl|DATABASE_URL|PostgreSQL/i.test(error.message),
    "production provider selection must fail closed with DATABASE_URL_REQUIRED"
  );
}

const source = fs.readFileSync(factoryPath, "utf8");
if (process.env.JUNZAN_PROVIDER_AUTHORITY_MUTATION === "json_fallback") {
  const mutated = source.replace(
    "throw databaseUrlRequired();",
    "return { kind: \"json\", mutationFallback: true };"
  );
  assert.notEqual(mutated, source, "JSON fallback mutation must alter the factory");
  expectDatabaseUrlRequired(() => loadFactoryFromSource(mutated).createProviders({}));
}

const { createProviders } = require("../lib/providers/provider-factory");
expectDatabaseUrlRequired(() => createProviders({}));

const originalDatabaseUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
try {
  expectDatabaseUrlRequired(() => createApp({}));
} finally {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
}

const pgliteDir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-authority-pglite-"));
const postgresProviders = createProviders({
  postgresConnection: { kind: "pglite", dataDir: pgliteDir }
});
assert.equal(postgresProviders.kind, "postgres");
postgresProviders.close();

const jsonTemp = fs.mkdtempSync(path.join(os.tmpdir(), "provider-authority-json-"));
const jsonProviders = createJsonProviders({
  dataFile: path.join(jsonTemp, "store.json"),
  seedFile: path.resolve(__dirname, "../fixtures/seed.json")
});
const isolatedApp = createApp({ providers: jsonProviders, adminAuthRequired: false });
assert.equal(isolatedApp.providers.kind, "json");

assert.doesNotMatch(source, /createJsonProviders|json-providers/);
const mutation = spawnSync(process.execPath, [__filename], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: "",
    JUNZAN_PROVIDER_AUTHORITY_MUTATION: "json_fallback"
  },
  encoding: "utf8"
});
assert.notEqual(mutation.status, 0, "restoring a JSON fallback must be rejected by the provider authority Gate");

fs.rmSync(pgliteDir, { recursive: true, force: true });
fs.rmSync(jsonTemp, { recursive: true, force: true });
console.log(JSON.stringify({
  suite: "provider-authority-fail-closed",
  pass: true,
  mutation: "json_fallback_rejected"
}));
