"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runtimeConfig } = require("../config/runtime");
const { importFriendlyProperty } = require("../lib/friendly-property-import");

function run(filePath, options = {}) {
  const absolutePath = path.resolve(filePath || "");
  if (!filePath || !fs.existsSync(absolutePath)) throw new Error("friendly property JSON file not found");
  const input = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const config = runtimeConfig(options.env || process.env);
  return importFriendlyProperty(input, {
    dataFile: options.dataFile || config.dataFile,
    seedFile: options.seedFile || config.seedFile,
    now: options.now || (() => new Date())
  });
}

if (require.main === module) {
  try {
    const result = run(process.argv[2]);
    console.log(`PROPERTY_IMPORT=OK`);
    console.log(`PROPERTY_ID=${result.propertyId}`);
    console.log(`ACTION=${result.created ? "CREATED" : "UPDATED"}`);
  } catch (error) {
    console.error(`PROPERTY_IMPORT=FAILED`);
    console.error(`REASON=${String(error && error.message || "invalid property data")}`);
    process.exit(1);
  }
}

module.exports = { run };
