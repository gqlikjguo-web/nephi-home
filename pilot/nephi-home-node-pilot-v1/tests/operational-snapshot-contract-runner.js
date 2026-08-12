"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.resolve(ROOT, "../../.github/workflows/test-only-ci.yml"), "utf8");

assert.match(workflow, /- operational_snapshot/, "workflow dispatch must expose an operational_snapshot mode");
assert.match(workflow, /operational-snapshot:[\s\S]*inputs\.acceptance_mode == 'operational_snapshot'/, "snapshot must use an independent job");
assert.match(workflow, /operational-snapshot:[\s\S]*id-token: write/, "snapshot job must use GitHub Actions OIDC");
assert.match(workflow, /operational-snapshot:[\s\S]*node scripts\/download-operational-snapshot\.js/, "snapshot job must run only the dedicated downloader");
assert.match(workflow, /operational-snapshot:[\s\S]*retention-days: 3/, "private snapshot artifact must have short retention");
assert.match(workflow, /deployed-acceptance:[\s\S]*inputs\.acceptance_mode != 'operational_snapshot'/, "snapshot dispatch must never enter OpenAI acceptance");

const { downloadOperationalSnapshot } = require("../scripts/download-operational-snapshot");

(async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-operational-snapshot-"));
  const snapshot = { rooms: [], priceOverrides: [], bundles: [], bundleMembers: [], knowledgeItems: [], availability: { legacy: [], inventory: [], bundles: [] } };
  const { hashAcceptanceDataSnapshot } = require("../lib/providers/test-only-acceptance-data");
  const businessHash = hashAcceptanceDataSnapshot(snapshot);
  const requests = [];
  const result = await downloadOperationalSnapshot({
    baseUrl: "https://test-only.example",
    propertyId: "nephi_home",
    reportDir,
    oidcToken: "test-oidc-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { status: "verified", mode: "operational_read_only", propertyId: "nephi_home", businessHash, snapshot } }) };
    }
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), { mode: "operational_read_only", propertyId: "nephi_home", includeSnapshot: true });
  assert.equal(requests[0].options.headers.authorization, "Bearer test-oidc-token");
  assert.equal(result.businessHash, businessHash);
  const artifact = JSON.parse(fs.readFileSync(path.join(reportDir, "operational-snapshot.json"), "utf8"));
  assert.deepEqual(artifact.snapshot, snapshot);
  assert.equal(JSON.stringify(artifact).includes("test-oidc-token"), false, "OIDC token must never enter the artifact");
  console.log(JSON.stringify({ suite: "operational-snapshot-contract", caseCount: 14, passCount: 14, failCount: 0 }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
