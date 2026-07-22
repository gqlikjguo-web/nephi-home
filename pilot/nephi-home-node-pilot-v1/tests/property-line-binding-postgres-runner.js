"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createProviders } = require("../lib/providers/provider-factory");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createLineBindingService } = require("../lib/line-binding-service");

(async () => {
  const runtime = path.join(__dirname, "../.runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const temp = fs.mkdtempSync(path.join(runtime, "line-binding-pg-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "db") };
  const secret = "database-channel-secret";
  const token = "database-channel-access-token";
  const env = { JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64") };
  let providers;
  try {
    await migratePostgres(connection);
    const client = await openPostgres(connection);
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2),($3,$4)", ["line_property_a", "Line A", "line_property_b", "Line B"]);
    await client.close();

    providers = createProviders({ databaseUrl: "pglite:test", postgresConnection: connection });
    const service = createLineBindingService({ provider: providers.lineBindings, env });
    const saved = service.upsert("line_property_a", { channelSecret: secret, channelAccessToken: token, enabled: true });
    assert.equal(saved.enabled, true);
    assert.equal(service.resolve(saved.webhookKey).propertyId, "line_property_a");

    const inspection = await openPostgres(connection);
    const raw = await inspection.query("SELECT channel_secret_encrypted::text AS secret,channel_access_token_encrypted::text AS token FROM property_line_bindings WHERE property_id=$1", ["line_property_a"]);
    await inspection.close();
    assert.equal(raw.rows.length, 1);
    assert.doesNotMatch(JSON.stringify(raw.rows[0]), new RegExp(`${secret}|${token}`));
    assert.match(raw.rows[0].secret, /aes-256-gcm/);

    const unchangedKey = service.upsert("line_property_a", { channelSecret: "replacement-secret", channelAccessToken: "replacement-token", enabled: true });
    assert.equal(unchangedKey.webhookKey, saved.webhookKey, "credential rotation must not silently change the webhook URL");
    assert.equal(service.status("line_property_b"), null);
    console.log("property-scoped LINE binding PostgreSQL: PASS");
  } finally {
    if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
