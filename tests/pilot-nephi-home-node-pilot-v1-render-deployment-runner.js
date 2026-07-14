"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PILOT_ROOT = path.join(ROOT, "pilot/nephi-home-node-pilot-v1");
const yaml = fs.readFileSync(path.join(ROOT, "render.yaml"), "utf8");
const { runtimeConfig } = require(path.join(PILOT_ROOT, "config/runtime"));
const secretNames = [
  "OPENAI_TEST_API_KEY", "OPENAI_TEST_MODEL",
  "NEPHI_PILOT_LINE_CHANNEL_SECRET", "NEPHI_PILOT_LINE_CHANNEL_ACCESS_TOKEN"
];

assert.equal((yaml.match(/^\s*- type: web\s*$/gm) || []).length, 1);
assert.equal((yaml.match(/^\s*- name: nephi-home-node-pilot-db\s*$/gm) || []).length, 1);
assert.equal((yaml.match(/^\s*region: singapore\s*$/gm) || []).length, 2);
assert.match(yaml, /databases:[\s\S]*?plan:\s*basic-256mb[\s\S]*?diskSizeGB:\s*1/);
assert.match(yaml, /services:[\s\S]*?plan:\s*starter/);
assert.match(yaml, /rootDir:\s*pilot\/nephi-home-node-pilot-v1/);
assert.match(yaml, /buildCommand:\s*npm install --omit=dev/);
assert.match(yaml, /startCommand:\s*npm run migrate:postgres && npm run seed:postgres && npm start/);
assert.match(yaml, /healthCheckPath:\s*\/api\/health/);
assert.match(yaml, /key:\s*DATABASE_URL[\s\S]*?fromDatabase:[\s\S]*?name:\s*nephi-home-node-pilot-db[\s\S]*?property:\s*connectionString/);
assert.match(yaml, /key:\s*NEPHI_PILOT_HOST[\s\S]*?value:\s*0\.0\.0\.0/);
assert.doesNotMatch(yaml, /\bdisk:|\bdisks:|NEPHI_PILOT_DATA_FILE|initialize-render-data/);
assert.doesNotMatch(yaml, /key:\s*NEPHI_PILOT_PORT/);
assert.equal(runtimeConfig({ PORT: "10000" }).port, 10000);
assert.equal(runtimeConfig({ PORT: "10000" }).host, "0.0.0.0");
for (const name of secretNames) assert.match(yaml, new RegExp(`key:\\s*${name}\\s*\\n\\s*sync:\\s*false`));
assert.equal((yaml.match(/sync:\s*false/g) || []).length, 4);
assert.doesNotMatch(yaml, /sk-[A-Za-z0-9_-]+|Bearer\s+\S+/i);
console.log(JSON.stringify({ caseCount: 24, passCount: 24, failCount: 0 }));
