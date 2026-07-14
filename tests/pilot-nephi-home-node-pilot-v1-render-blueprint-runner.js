"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const yaml = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
const checks = [
  ["one web service", (yaml.match(/^\s*- type: web\s*$/gm) || []).length === 1],
  ["one postgres database", /^databases:\s*$/m.test(yaml) && (yaml.match(/^\s*- name: nephi-home-node-pilot-db\s*$/gm) || []).length === 1],
  ["singapore region", (yaml.match(/^\s*region: singapore\s*$/gm) || []).length === 2],
  ["paid web plan", /services:[\s\S]*?plan: starter/.test(yaml)],
  ["paid postgres plan", /databases:[\s\S]*?plan: basic-256mb/.test(yaml)],
  ["minimum postgres storage", /^\s*diskSizeGB: 1\s*$/m.test(yaml)],
  ["node root", /^\s*rootDir: pilot\/nephi-home-node-pilot-v1\s*$/m.test(yaml)],
  ["build command", /^\s*buildCommand: npm install --omit=dev\s*$/m.test(yaml)],
  ["start flow", /^\s*startCommand: npm run migrate:postgres && npm run seed:postgres && npm start\s*$/m.test(yaml)],
  ["health check", /^\s*healthCheckPath: \/api\/health\s*$/m.test(yaml)],
  ["host", /key: NEPHI_PILOT_HOST\s*\r?\n\s*value: 0\.0\.0\.0/m.test(yaml)],
  ["database binding", /key: DATABASE_URL\s*\r?\n\s*fromDatabase:\s*\r?\n\s*name: nephi-home-node-pilot-db\s*\r?\n\s*property: connectionString/m.test(yaml)],
  ["four sync false secrets", (yaml.match(/sync: false/g) || []).length === 4],
  ["no disk", !/\bdisk:|\bdisks:|NEPHI_PILOT_DATA_FILE|initialize-render-data/.test(yaml)],
  ["no secret values", !/(OPENAI_TEST_API_KEY|OPENAI_TEST_MODEL|NEPHI_PILOT_LINE_CHANNEL_SECRET|NEPHI_PILOT_LINE_CHANNEL_ACCESS_TOKEN)[\s\S]{0,60}\bvalue:/m.test(yaml)]
];
for (const [name, passed] of checks) assert.equal(passed, true, name);
console.log(`Render Blueprint: ${checks.length}/${checks.length} PASS`);
