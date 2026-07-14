"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runtimeConfig } = require("../config/runtime");
const { createJsonProviders } = require("../lib/providers/json-providers");
const { importAvailabilityDays } = require("../lib/availability-days-import");

function main(argv = process.argv.slice(2)) {
  const inputPath = String(argv[0] || "").trim();
  if (!inputPath) throw new Error("Usage: node scripts/import-availability-days.js <availability-json-path>");
  const absolutePath = path.resolve(inputPath);
  const input = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const config = runtimeConfig();
  const providers = createJsonProviders({ dataFile: config.dataFile, seedFile: config.seedFile });
  const result = importAvailabilityDays(input, { providers });
  console.log("AVAILABILITY_IMPORT=OK");
  console.log(`PROPERTY_ID=${result.propertyId}`);
  console.log(`IMPORTED_DAYS=${result.importedDays}`);
  console.log(`DATES=${result.dates.join(",")}`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`AVAILABILITY_IMPORT=FAIL ${error.message}`);
    process.exit(1);
  }
}

module.exports = { main };
