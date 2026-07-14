"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const net = require("node:net");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const IMPORT_MODULE = path.join(PILOT_ROOT, "lib/friendly-property-import.js");
const START_SCRIPT = path.join(PILOT_ROOT, "scripts/start-test-line-pilot.ps1");
const STOP_SCRIPT = path.join(PILOT_ROOT, "scripts/stop-test-line-pilot.ps1");
const TEMPLATE = path.join(PILOT_ROOT, "fixtures/friendly-property-template.json");

assert.ok(fs.existsSync(IMPORT_MODULE), "friendly property importer must exist");
assert.ok(fs.existsSync(START_SCRIPT), "one-command PowerShell start script must exist");
assert.ok(fs.existsSync(STOP_SCRIPT), "reversible PowerShell stop script must exist");
assert.ok(fs.existsSync(TEMPLATE), "friendly property template must exist");

const { importFriendlyProperty, validateFriendlyProperty } = require(IMPORT_MODULE);
const { createJsonProviders } = require(path.join(PILOT_ROOT, "lib/providers/json-providers"));
const { createApp } = require(path.join(PILOT_ROOT, "server"));

function validInput(overrides = {}) {
  return {
    propertyId: "friendly_homestay_003",
    propertyName: "友好旅宿三號",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    rooms: [
      { name: "山景雙人房", capacity: 2 },
      { name: "家庭四人房", capacity: 4 }
    ],
    pricing: { weekday: "雙人房 2800 元起", holiday: "雙人房 3600 元起" },
    parking: "提供一房一車位",
    bbq: "可預約使用烤肉區",
    selfCheckIn: true,
    paymentMethod: "匯款或現場付款",
    cancellationPolicy: "入住七日前可免費取消",
    humanHandoffSituations: ["付款確認", "取消或改期", "提早入住或晚退房"],
    faqs: Array.from({ length: 12 }, (_, index) => ({
      question: `常見問題 ${index + 1}`,
      answer: `業者確認回答 ${index + 1}`
    })),
    ...overrides
  };
}

(async () => {
  assert.equal(validateFriendlyProperty(validInput()).propertyId, "friendly_homestay_003");
  assert.throws(() => validateFriendlyProperty(validInput({ propertyId: "" })), /propertyId/);
  assert.throws(() => validateFriendlyProperty(validInput({ faqs: [] })), /10.*20/);
  assert.throws(() => validateFriendlyProperty(validInput({ rooms: [{ name: "錯誤房型", capacity: 0 }] })), /capacity/);

  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-friendly-onboarding-"));
  const dataFile = path.join(tempDir, "store.json");
  const seedFile = path.join(PILOT_ROOT, "fixtures/seed.json");
  const now = () => new Date("2026-07-14T00:00:00.000Z");
  try {
    const first = importFriendlyProperty(validInput(), { dataFile, seedFile, now });
    assert.equal(first.created, true);
    assert.equal(first.propertyId, "friendly_homestay_003");

    let providers = createJsonProviders({ dataFile, seedFile, now });
    let property = providers.customerSettings.getProperty("friendly_homestay_003");
    assert.equal(property.displayName, "友好旅宿三號");
    assert.equal(property.rooms[0].name, "山景雙人房");
    assert.equal(property.rooms[1].capacity, 4);
    assert.equal(property.commonAnswers.checkInTime, "15:00");
    assert.equal(property.commonAnswers.parkingRule, "提供一房一車位");
    assert.equal(property.faqs.length, 12);
    assert.equal(property.humanHandoffSituations.length, 3);
    assert.equal(property.pricing.weekday, "雙人房 2800 元起");

    const rows = providers.availability.getRows("friendly_homestay_003", "2026-07-14", "2026-07-17");
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.room301 === "closed" && row.room302 === "closed"));

    providers.persistence.appendMessageLog("friendly_homestay_003", {
      eventId: "preserve-on-reimport", guestMessage: "保留紀錄", createdAt: now().toISOString()
    });
    providers.availability.setDay("friendly_homestay_003", "2026-07-15", "room301", "available");
    const second = importFriendlyProperty(validInput({ propertyName: "友好旅宿三號更新" }), { dataFile, seedFile, now });
    assert.equal(second.created, false);

    providers = createJsonProviders({ dataFile, seedFile, now });
    property = providers.customerSettings.getProperty("friendly_homestay_003");
    assert.equal(property.displayName, "友好旅宿三號更新");
    assert.equal(providers.availability.getRows("friendly_homestay_003", "2026-07-15", "2026-07-16")[0].room301, "available");
    assert.equal(providers.persistence.findMessageByEventId("friendly_homestay_003", "preserve-on-reimport").guestMessage, "保留紀錄");
    assert.equal(providers.customerSettings.getProperty("demo_homestay_a").displayName, "山嵐示範民宿");

    const app = createApp({ providers, structuredClassifier: null });
    const running = await app.start(0, "127.0.0.1");
    try {
      const response = await fetch(`${running.url}/api/health`);
      assert.equal(response.status, 200);
      const health = await response.json();
      assert.equal(health.data.status, "ready");
      assert.equal(health.data.testOnly, true);
    } finally {
      await app.stop();
    }

    const env = { ...process.env };
    for (const name of [
      "OPENAI_TEST_API_KEY", "OPENAI_TEST_MODEL",
      "NEPHI_PILOT_LINE_CHANNEL_SECRET", "NEPHI_PILOT_LINE_CHANNEL_ACCESS_TOKEN"
    ]) delete env[name];
    const readiness = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", START_SCRIPT
    ], { cwd: path.dirname(PILOT_ROOT), env, encoding: "utf8" });
    assert.notEqual(readiness.status, 0);
    for (const name of [
      "OPENAI_TEST_API_KEY", "OPENAI_TEST_MODEL",
      "NEPHI_PILOT_LINE_CHANNEL_SECRET", "NEPHI_PILOT_LINE_CHANNEL_ACCESS_TOKEN"
    ]) assert.match(`${readiness.stdout}\n${readiness.stderr}`, new RegExp(`${name}.*MISSING`));

    const listener = net.createServer();
    await new Promise((resolve, reject) => listener.listen(0, "127.0.0.1", resolve).once("error", reject));
    try {
      const occupiedPort = listener.address().port;
      const occupiedEnv = {
        ...process.env,
        OPENAI_TEST_API_KEY: "sensitive-openai-marker",
        OPENAI_TEST_MODEL: "test-model",
        NEPHI_PILOT_LINE_CHANNEL_SECRET: "sensitive-line-secret-marker",
        NEPHI_PILOT_LINE_CHANNEL_ACCESS_TOKEN: "sensitive-line-token-marker",
        NEPHI_PILOT_PORT: String(occupiedPort)
      };
      const occupied = spawnSync("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", START_SCRIPT
      ], { cwd: path.dirname(PILOT_ROOT), env: occupiedEnv, encoding: "utf8" });
      const occupiedOutput = `${occupied.stdout}\n${occupied.stderr}`;
      assert.notEqual(occupied.status, 0);
      assert.match(occupiedOutput, /PORT_IN_USE/);
      assert.equal(listener.listening, true, "occupied-port process must not be stopped");
      assert.equal(occupiedOutput.includes("sensitive-openai-marker"), false);
      assert.equal(occupiedOutput.includes("sensitive-line-secret-marker"), false);
      assert.equal(occupiedOutput.includes("sensitive-line-token-marker"), false);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const startSource = fs.readFileSync(START_SCRIPT, "utf8");
  assert.match(startSource, /PORT_IN_USE/);
  assert.match(startSource, /\/api\/health/);
  assert.match(startSource, /\/api\/test-line\/webhook/);
  assert.match(startSource, /customerId=\{\{propertyId\}\}/);
  assert.doesNotMatch(startSource, /Write-(?:Host|Output).*OPENAI_TEST_API_KEY.*\$/);

  console.log(JSON.stringify({ caseCount: 13, passCount: 13, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
