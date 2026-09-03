"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPublicBrand } = require("../config/public-brand");

const EXPECTED_BASE_URL = "https://test.junzanai.com";
const renderYamlPath = path.resolve(__dirname, "../../../render.yaml");
const renderYaml = fs.readFileSync(renderYamlPath, "utf8");
const serviceMatch = renderYaml.match(
  /(?:^|\n)  - type: web\r?\n    name: nephi-home-node-pilot-test-only\r?\n([\s\S]*?)(?=\r?\n  - type:|\s*$)/
);

assert.ok(serviceMatch, "test-only Render service must exist");
const service = serviceMatch[0];
const startCommand = service.match(/^\s+startCommand:\s*(.+)$/m)?.[1]?.trim() || "";
const publicBaseUrl = service.match(
  /^\s+- key: PUBLIC_BASE_URL\r?\n\s+value:\s*(.+)$/m
)?.[1]?.trim() || "";

assert.equal(startCommand, "npm run migrate:postgres && npm start");
assert.doesNotMatch(startCommand, /\bseed(?::postgres)?\b/i);
assert.equal(publicBaseUrl, EXPECTED_BASE_URL);
assert.doesNotMatch(service, /https:\/\/app\.junzanai\.com/);

const brand = createPublicBrand({ PUBLIC_BASE_URL: publicBaseUrl });
assert.equal(brand.publicBaseUrl, EXPECTED_BASE_URL);

const serverSource = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
const urlContracts = [
  ["inviteUrl", "/onboarding?invite="],
  ["resumeUrl", "/onboarding?resume="],
  ["adminSetupUrl", "/admin/setup?token="]
];

for (const [field, pathFragment] of urlContracts) {
  assert.match(
    serverSource,
    new RegExp(
      `${field}:\\x60\\$\\{publicBrand\\.publicBaseUrl\\}${pathFragment.replace(/[?]/g, "\\?")}`
    ),
    `${field} must be generated from the environment public base URL`
  );
  const generatedUrl = `${brand.publicBaseUrl}${pathFragment}redacted-test-token`;
  assert.equal(new URL(generatedUrl).origin, EXPECTED_BASE_URL);
  assert.doesNotMatch(generatedUrl, /app\.junzanai\.com/);
}

console.log("test-only onboarding deployment contract: PASS (15 checks)");
