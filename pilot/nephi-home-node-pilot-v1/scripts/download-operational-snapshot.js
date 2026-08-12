"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const AUDIENCE = "junzan-test-only-acceptance";
const SNAPSHOT_KEYS = ["availability", "bundleMembers", "bundles", "knowledgeItems", "priceOverrides", "rooms"];

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function snapshotHash(snapshot) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(snapshot))).digest("hex");
}

async function githubOidcToken({ requestUrl, requestToken, fetchImpl }) {
  if (!requestUrl || !requestToken) throw new Error("github_oidc_request_environment_required");
  const url = new URL(requestUrl);
  url.searchParams.set("audience", AUDIENCE);
  const response = await fetchImpl(url, { headers: { accept: "application/json", authorization: `Bearer ${requestToken}` } });
  if (!response.ok) throw new Error(`github_oidc_request_failed:${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload.value !== "string" || !payload.value) throw new Error("github_oidc_token_missing");
  return payload.value;
}

async function downloadOperationalSnapshot({ baseUrl, propertyId, reportDir, oidcToken, fetchImpl = globalThis.fetch }) {
  if (propertyId !== "nephi_home") throw new Error("operational_snapshot_property_scope_rejected");
  const response = await fetchImpl(`${String(baseUrl || "").replace(/\/$/, "")}/api/admin/test-only/acceptance-data-integrity`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${oidcToken}` },
    body: JSON.stringify({ mode: "operational_read_only", propertyId, includeSnapshot: true })
  });
  const payload = await response.json().catch(() => null);
  const result = payload && payload.data;
  if (!response.ok || !result || result.status !== "verified" || result.mode !== "operational_read_only" || result.propertyId !== propertyId) {
    throw new Error(`operational_snapshot_request_failed:${response.status}`);
  }
  if (!result.snapshot || JSON.stringify(Object.keys(result.snapshot).sort()) !== JSON.stringify(SNAPSHOT_KEYS)) throw new Error("operational_snapshot_shape_invalid");
  if (snapshotHash(result.snapshot) !== result.businessHash) throw new Error("operational_snapshot_hash_mismatch");
  fs.mkdirSync(reportDir, { recursive: true });
  const artifact = { capturedAt: new Date().toISOString(), propertyId, businessHash: result.businessHash, snapshot: result.snapshot };
  fs.writeFileSync(path.join(reportDir, "operational-snapshot.json"), `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return artifact;
}

async function main() {
  const fetchImpl = globalThis.fetch;
  const oidcToken = await githubOidcToken({ requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL, requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, fetchImpl });
  const result = await downloadOperationalSnapshot({
    baseUrl: process.env.TEST_ONLY_ACCEPTANCE_BASE_URL,
    propertyId: process.env.TEST_ONLY_ACCEPTANCE_PROPERTY_ID,
    reportDir: process.env.TEST_ONLY_OPERATIONAL_SNAPSHOT_REPORT_DIR,
    oidcToken,
    fetchImpl
  });
  console.log(JSON.stringify({ status: "verified", mode: "operational_snapshot", propertyId: result.propertyId, businessHash: result.businessHash }));
}

if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ status: "failed", code: String(error && error.message || "operational_snapshot_failed").split(":")[0] })); process.exitCode = 1; });

module.exports = { downloadOperationalSnapshot, githubOidcToken, snapshotHash };
