"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PILOT_ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const IMPORTER_PATH = path.join(PILOT_ROOT, "lib/availability-days-import.js");
const SCHEMA_PATH = path.join(PILOT_ROOT, "fixtures/availability-days.schema.json");
assert.ok(fs.existsSync(IMPORTER_PATH), "availability importer must exist");
assert.ok(fs.existsSync(SCHEMA_PATH), "availability JSON schema must exist");

const { importAvailabilityDays, validateAvailabilityDays } = require(IMPORTER_PATH);
const { createJsonProviders } = require(path.join(PILOT_ROOT, "lib/providers/json-providers"));
const { importFriendlyProperty } = require(path.join(PILOT_ROOT, "lib/friendly-property-import"));

function validInput(date = "2026-07-19") {
  return {
    propertyId: "nephi_home",
    days: [{ date, 301: "open", 302: "open", 401: "open", 402: "open" }]
  };
}

const LEGACY_INVENTORY_ALIASES = ["301", "302", "401", "402"];

(async () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["propertyId", "days"]);
  assert.deepEqual(schema.properties.days.items.required, ["date"]);
  assert.equal(schema.properties.days.items.additionalProperties, false);
  assert.deepEqual(schema.properties.days.items.patternProperties["^(?!date$)[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$"].enum, ["open", "closed"]);

  const tempDir = fs.mkdtempSync(path.join(__dirname, ".tmp-availability-import-"));
  const dataFile = path.join(tempDir, "store.json");
  const seedFile = path.join(PILOT_ROOT, "fixtures/seed.json");
  const now = () => new Date("2026-07-14T00:00:00.000Z");
  try {
    const nephiInput = JSON.parse(fs.readFileSync(path.join(PILOT_ROOT, "fixtures/nephi-home-property.json"), "utf8"));
    importFriendlyProperty(nephiInput, { dataFile, seedFile, now });
    const providers = createJsonProviders({ dataFile, seedFile, now });
    const nephi = providers.customerSettings.getProperty("nephi_home");
    const importProviders = providers;

    providers.persistence.createGuest("demo_homestay_a", { name: "保留客戶", lineUserId: "U_preserve" });
    providers.persistence.createGuest("nephi_home", { name: "尼腓保留客戶", lineUserId: "U_nephi_preserve" });
    providers.persistence.appendMessageLog("demo_homestay_a", {
      eventId: "preserve-message",
      guestMessage: "保留訊息",
      needsReview: true,
      status: "pending",
      createdAt: now().toISOString()
    });
    providers.persistence.appendMessageLog("nephi_home", {
      eventId: "nephi-preserve-review",
      guestMessage: "尼腓保留審核",
      needsReview: true,
      status: "pending",
      createdAt: now().toISOString()
    });
    const before = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    const demoAvailabilityBefore = JSON.stringify(before.availability.demo_homestay_a);
    const guestsBefore = JSON.stringify(before.guests);
    const logsBefore = JSON.stringify(before.messageLogs);

    const first = importAvailabilityDays(validInput(), { providers: importProviders });
    assert.deepEqual(first, { propertyId: "nephi_home", importedDays: 1, dates: ["2026-07-19"] });
    let row = providers.availability.getRows("nephi_home", "2026-07-19", "2026-07-20")[0];
    assert.deepEqual(row, {
      date: "2026-07-19",
      room301: "available",
      room302: "available",
      room401: "available",
      room402: "available"
    });

    const replacement = validInput();
    replacement.days[0][301] = "closed";
    replacement.days[0][402] = "closed";
    const second = importAvailabilityDays(replacement, { providers: importProviders });
    assert.equal(second.importedDays, 1);
    row = providers.availability.getRows("nephi_home", "2026-07-19", "2026-07-20")[0];
    assert.equal(row.room301, "closed");
    assert.equal(row.room302, "available");
    assert.equal(row.room401, "available");
    assert.equal(row.room402, "closed");
    assert.equal(Object.hasOwn(row, "wholeHouse"), false);
    assert.equal(providers.availability.getRows("nephi_home", "2026-07-19", "2026-07-20").length, 1);

    const after = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    assert.equal(JSON.stringify(after.availability.demo_homestay_a), demoAvailabilityBefore);
    assert.equal(JSON.stringify(after.guests), guestsBefore);
    assert.equal(JSON.stringify(after.messageLogs), logsBefore);

    assert.throws(
      () => validateAvailabilityDays(
        { propertyId: "nephi_home", days: [{ date: "2026-07-20", 301: "open" }] },
        { inventoryAliases: LEGACY_INVENTORY_ALIASES }
      ),
      /days\[0\]\.302/
    );
    assert.throws(() => validateAvailabilityDays({ ...validInput(), unexpected: true }), /additional property/);
    const unknownRoom = validInput();
    unknownRoom.days[0][501] = "open";
    assert.throws(() => validateAvailabilityDays(unknownRoom, { inventoryAliases: LEGACY_INVENTORY_ALIASES }), /additional property/);
    const badStatus = validInput();
    badStatus.days[0][301] = "maybe";
    assert.throws(() => validateAvailabilityDays(badStatus), /open or closed/);
    const badDate = validInput("2026-02-30");
    assert.throws(() => validateAvailabilityDays(badDate), /valid YYYY-MM-DD/);
    assert.throws(() => importAvailabilityDays({ ...validInput(), propertyId: "missing_property" }, { providers: importProviders }), /Unknown propertyId/);

    const missingRoomProperty = { ...nephi, rooms: nephi.rooms.filter((room) => room.id !== "room402") };
    const missingRoomProviders = {
      ...providers,
      customerSettings: {
        ...providers.customerSettings,
        getProperty: (propertyId) => propertyId === "nephi_home" ? missingRoomProperty : providers.customerSettings.getProperty(propertyId)
      }
    };
    assert.throws(() => importAvailabilityDays(validInput(), { providers: missingRoomProviders }), /402/);

    const cliInputPath = path.join(tempDir, "availability.json");
    fs.writeFileSync(cliInputPath, JSON.stringify(validInput("2026-07-21")), "utf8");
    const cli = childProcess.spawnSync(process.execPath, [path.join(PILOT_ROOT, "scripts/import-availability-days.js"), cliInputPath], {
      cwd: PILOT_ROOT,
      env: { ...process.env, NEPHI_PILOT_DATA_FILE: dataFile },
      encoding: "utf8"
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /AVAILABILITY_IMPORT=OK/);
    assert.match(cli.stdout, /PROPERTY_ID=nephi_home/);
    assert.equal(providers.availability.getRows("nephi_home", "2026-07-21", "2026-07-22").length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ caseCount: 16, passCount: 16, failCount: 0 }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
