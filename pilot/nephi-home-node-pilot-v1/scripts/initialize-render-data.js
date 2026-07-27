"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runtimeConfig } = require("../config/runtime");
const { importFriendlyProperty } = require("../lib/friendly-property-import");
const { importAvailabilityDays } = require("../lib/availability-days-import");
const { createJsonProviders } = require("../lib/providers/json-providers");

const PILOT_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIRECTORY = path.join(PILOT_ROOT, "fixtures");

function readFixture(fileName) {
  const baseName = path.basename(String(fileName || ""));
  if (!baseName || baseName !== fileName) throw new Error("initialization fixture path is invalid");
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIRECTORY, baseName), "utf8"));
}

function initialize(options = {}) {
  const config = runtimeConfig(options.env || process.env);
  const dataFile = path.resolve(options.dataFile || config.dataFile);
  if (fs.existsSync(dataFile)) return { initialized: false, dataFile };

  const destinationDirectory = path.dirname(dataFile);
  fs.mkdirSync(destinationDirectory, { recursive: true });
  const workDirectory = fs.mkdtempSync(path.join(destinationDirectory, ".render-init-"));
  const temporaryDataFile = path.join(workDirectory, "store.json");
  const sanitizedSeedFile = path.join(workDirectory, "seed.json");

  try {
    const manifest = options.manifest || readFixture(options.manifestFile || "postgres-seed.json");
    const seed = JSON.parse(fs.readFileSync(config.seedFile, "utf8"));
    fs.writeFileSync(sanitizedSeedFile, `${JSON.stringify({ ...seed, messageLogs: {} }, null, 2)}\n`, "utf8");

    const property = readFixture(manifest.propertyFile);
    const availabilityInput = readFixture(manifest.availabilityFile);
    importFriendlyProperty(property, {
      dataFile: temporaryDataFile,
      seedFile: sanitizedSeedFile,
      now: options.now || (() => new Date())
    });
    const providers = createJsonProviders({
      dataFile: temporaryDataFile,
      seedFile: sanitizedSeedFile,
      now: options.now || (() => new Date())
    });
    const imported = importAvailabilityDays(availabilityInput, { providers });

    const state = JSON.parse(fs.readFileSync(temporaryDataFile, "utf8"));
    const allowedDates = new Set(imported.dates);
    state.availability[imported.propertyId] = Object.fromEntries(Object.entries(state.availability[imported.propertyId] || {})
      .filter(([date]) => allowedDates.has(date)));
    state.messageLogs = Object.fromEntries((state.homestays || []).map((item) => [item.customerId, []]));
    state.guests = Object.fromEntries((state.homestays || []).map((item) => [item.customerId, []]));
    state.notes = Object.fromEntries((state.homestays || []).map((item) => [item.customerId, []]));
    state.conversationStates = {};
    fs.writeFileSync(temporaryDataFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryDataFile, dataFile);
    return { initialized: true, dataFile, importedDays: imported.importedDays };
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const result = initialize();
    console.log(result.initialized
      ? `RENDER_DATA_INITIALIZED days=${result.importedDays}`
      : "RENDER_DATA_ALREADY_EXISTS");
  } catch (error) {
    console.error(`RENDER_DATA_INITIALIZATION_FAILED ${String(error && error.message || "unknown error")}`);
    process.exit(1);
  }
}

module.exports = { initialize };
