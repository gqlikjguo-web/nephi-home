"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createCustomReplyService } = require("../lib/custom-reply-rules");

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "custom-replies-pg-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "db") };
  let providers;
  try {
    const migration = await migratePostgres(connection);
    assert.ok(migration.files.includes("018_property_custom_replies.sql"));
    const client = await openPostgres(connection);
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2),($3,$4)", ["property_alpha", "Alpha", "property_beta", "Beta"]);
    await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,position) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)", ["property_alpha", "alpha_room", "Alpha Room", 2, 0, "property_beta", "beta_room", "Beta Room", 4, 0]);
    await client.close();

    providers = createPostgresProviders(connection);
    const service = createCustomReplyService({
      provider: providers.customReplies,
      customerSettings: providers.customerSettings,
      now: () => new Date("2026-07-30T04:00:00.000Z")
    });
    const saved = service.create("property_alpha", {
      name: "九月公告",
      topic: "booking_open",
      scope: "all",
      stayStartDate: "2026-09-01",
      stayEndDate: "2026-09-30",
      effectiveStartDate: "2026-07-01",
      effectiveEndDate: "2026-09-30",
      approvedReply: "九月尚未開放預訂。",
      enabled: true
    });
    assert.equal(service.list("property_alpha").items[0].approvedReply, "九月尚未開放預訂。");
    assert.equal(service.list("property_beta").used, 0);
    assert.equal(service.setEnabled("property_alpha", saved.ruleId, false).state, "disabled");
    assert.equal(service.remove("property_alpha", saved.ruleId), true);
    assert.equal(service.list("property_alpha").used, 0);

    const inspection = await openPostgres(connection);
    const columns = await inspection.query("SELECT column_name FROM information_schema.columns WHERE table_name='property_custom_replies' ORDER BY ordinal_position");
    await inspection.close();
    assert.deepEqual(columns.rows.map((row) => row.column_name), [
      "rule_id", "property_id", "name", "topic", "scope", "room_type_id",
      "stay_start_date", "stay_end_date", "effective_start_date", "effective_end_date",
      "approved_reply", "enabled", "created_at", "updated_at"
    ]);
    console.log(JSON.stringify({ suite: "custom-reply-rules-postgres", pass: true, assertions: 7 }));
  } finally {
    if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
