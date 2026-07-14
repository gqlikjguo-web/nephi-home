"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PILOT_ROOT = path.join(ROOT, "pilot/nephi-home-node-pilot-v1");
const BLUEPRINT = path.join(ROOT, "render.yaml");
const INITIALIZER = path.join(PILOT_ROOT, "scripts/initialize-render-data.js");
const { runtimeConfig } = require(path.join(PILOT_ROOT, "config/runtime"));
const SECRET_NAMES = [
  "OPENAI_TEST_API_KEY",
  "OPENAI_TEST_MODEL",
  "NEPHI_PILOT_LINE_CHANNEL_SECRET",
  "NEPHI_PILOT_LINE_CHANNEL_ACCESS_TOKEN"
];

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

(async () => {
  assert.equal(fs.existsSync(BLUEPRINT), true, "render.yaml must exist at repository root");
  assert.equal(fs.existsSync(INITIALIZER), true, "Render initializer must exist");

  const yaml = fs.readFileSync(BLUEPRINT, "utf8");
  assert.match(yaml, /rootDir:\s*pilot\/nephi-home-node-pilot-v1/);
  assert.match(yaml, /buildCommand:\s*npm install --omit=dev/);
  assert.match(yaml, /startCommand:\s*node scripts\/initialize-render-data\.js && npm start/);
  assert.match(yaml, /healthCheckPath:\s*\/api\/health/);
  assert.match(yaml, /mountPath:\s*\/var\/data/);
  assert.match(yaml, /key:\s*NEPHI_PILOT_DATA_FILE[\s\S]*?value:\s*\/var\/data\/store\.json/);
  assert.match(yaml, /key:\s*NEPHI_PILOT_HOST[\s\S]*?value:\s*0\.0\.0\.0/);
  assert.doesNotMatch(yaml, /key:\s*NEPHI_PILOT_PORT/);
  assert.equal(runtimeConfig({ PORT: "10000" }).port, 10000);
  for (const name of SECRET_NAMES) {
    assert.match(yaml, new RegExp(`key:\\s*${name}\\s*\\n\\s*sync:\\s*false`));
  }
  assert.doesNotMatch(yaml, /sk-[A-Za-z0-9_-]+|Bearer\s+\S+/i);

  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-render-init-"));
  const dataFile = path.join(tempDir, "store.json");
  try {
    const run = spawnSync(process.execPath, [INITIALIZER], {
      cwd: PILOT_ROOT,
      env: { ...process.env, NEPHI_PILOT_DATA_FILE: dataFile },
      encoding: "utf8"
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /RENDER_DATA_INITIALIZED/);

    const state = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    const property = state.homestays.find((item) => item.customerId === "nephi_home");
    assert.ok(property);
    assert.equal(property.faqs.length >= 10, true);
    assert.ok(state.availability.nephi_home["2026-07-14"]);
    assert.ok(state.availability.nephi_home["2026-08-31"]);
    assert.equal(Object.values(state.messageLogs).every((items) => items.length === 0), true);
    assert.equal(Object.values(state.guests).every((items) => items.length === 0), true);
    assert.equal(Object.values(state.notes).every((items) => items.length === 0), true);
    assert.deepEqual(state.conversationStates, {});
    assert.equal(fs.existsSync(`${dataFile}.event-claims`), false);

    const before = hash(dataFile);
    const rerun = spawnSync(process.execPath, [INITIALIZER], {
      cwd: PILOT_ROOT,
      env: { ...process.env, NEPHI_PILOT_DATA_FILE: dataFile },
      encoding: "utf8"
    });
    assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
    assert.match(rerun.stdout, /RENDER_DATA_ALREADY_EXISTS/);
    assert.equal(hash(dataFile), before);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 24, passCount: 24, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
