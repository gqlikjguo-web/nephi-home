"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { seedNephiPostgres } = require("./helpers/nephi-postgres-seed");
const { createProviders } = require("../lib/providers/provider-factory");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");

(async () => {
  const runtimeRoot = path.join(__dirname, "../.runtime");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(runtimeRoot, "phase1-knowledge-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  try {
    await migratePostgres(connection);
    await seedNephiPostgres(connection);
    const rawClient = require("../lib/providers/postgres-client");
    const client = await rawClient.openPostgres(connection);
    const mapUrl = "https://maps.app.goo.gl/PostgresLocation";
    await client.query("UPDATE property_settings SET settings=settings || jsonb_build_object('commonAnswers',COALESCE(settings->'commonAnswers','{}'::jsonb)||jsonb_build_object('transport',$2::text)) WHERE property_id=$1", ["nephi_home", `導航與周邊位置請開啟 Google 地圖：\n${mapUrl}`]);
    await client.close();
    const providers = createProviders({ databaseUrl: "pglite:phase1", postgresConnection: connection });
    const property = providers.customerSettings.getProperty("nephi_home");
    assert.equal(property.commonAnswers.cancellationRule, "退款、退費、退訂、取消、改期、延期、天災或臨時狀況相關問題，一律由真人客服確認。");
    const singing = property.faqs.find((item) => item.knowledgeKey === "singing");
    assert.ok(singing);
    assert.ok(singing.knowledgeId, "provider must preserve stable materialized knowledge ID");
    const catalog = buildPropertyCatalog(property);
    assert.equal(catalog.faqs.find((item) => item.canonicalId === "singing").answer, singing.answer);
    assert.equal(catalog.policies.find((item) => item.canonicalId === "cancellation").answer, property.commonAnswers.cancellationRule);
    const rematerializeClient = await rawClient.openPostgres(connection);
    await rematerializeClient.query("UPDATE knowledge_items SET knowledge_key=NULL WHERE property_id=$1 AND question=$2", ["nephi_home", singing.question]);
    await rematerializeClient.close();
    const mapCatalog = buildPropertyCatalog(providers.customerSettings.getProperty("nephi_home"));
    assert.equal(mapCatalog.policies.find((item) => item.canonicalId === "location").answer, mapUrl, "a legacy PostgreSQL transport map URL must materialize as the property-scoped Google Maps fact");
    await seedNephiPostgres(connection);
    const rematerialized = providers.customerSettings.getProperty("nephi_home").faqs.find((item) => item.question === singing.question);
    assert.equal(rematerialized.knowledgeKey, "singing", "existing property facts must receive their property-provided canonical key");
    providers.close();
    console.log("hospitality knowledge Phase 1 PostgreSQL: PASS");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
