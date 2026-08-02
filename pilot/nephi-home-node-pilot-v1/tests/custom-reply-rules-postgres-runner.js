"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createCustomReplyService } = require("../lib/custom-reply-rules");

let completed = false;
process.once("beforeExit", () => {
  if (!completed) {
    process.stderr.write("[custom-reply-pg] ERROR: runner exited before completing all assertions\n");
    process.exitCode = 1;
  }
});
function phase(name, action) {
  return Promise.resolve().then(action);
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "custom-replies-pg-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "db") };
  let providers;
  try {
    const migration = await phase("migration", () => migratePostgres(connection));
    assert.ok(migration.files.includes("018_property_custom_replies.sql"));
    const client = await phase("seed-open", () => openPostgres(connection));
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2),($3,$4)", ["property_alpha", "Alpha", "property_beta", "Beta"]);
    await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,position) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)", ["property_alpha", "alpha_room", "Alpha Room", 2, 0, "property_beta", "beta_room", "Beta Room", 4, 0]);
    await phase("seed-close", () => client.close());

    providers = await phase("providers-create", () => createPostgresProviders(connection));
    const bundle = providers.customerSettings.createBundle("property_alpha", {
      name: "Alpha bundle", capacity: 2, memberRoomIds: ["alpha_room"],
      mondayThursdayPrice: 1000, fridayPrice: 1100, saturdayHolidayPrice: 1200, sundayPrice: 1050,
      enabled: true, entertainmentAmenities: []
    });
    const bundleAvailability = await openPostgres(connection);
    await bundleAvailability.query("INSERT INTO bundle_availability_days(property_id,bundle_id,stay_date,status) VALUES($1,$2,$3,$4)", ["property_alpha", bundle.id, "2026-09-03", "available"]);
    await bundleAvailability.close();
    const updatedBundle = providers.customerSettings.updateBundle("property_alpha", bundle.id, {
      ...bundle, name: "Alpha bundle updated", capacity: 3, mondayThursdayPrice: 1300, fridayPrice: 1400, saturdayHolidayPrice: 1500, sundayPrice: 1350,
      enabled: false, entertainmentAmenities: [{ key: "singing", displayName: "KTV", provided: true, source: "preset", position: 0 }]
    });
    assert.equal(updatedBundle.name, "Alpha bundle updated");
    assert.equal(updatedBundle.mondayThursdayPrice, 1300);
    assert.equal(updatedBundle.memberRoomIds[0], "alpha_room");
    assert.throws(() => providers.customerSettings.updateBundle("property_alpha", bundle.id, { ...updatedBundle, memberRoomIds: ["beta_room"] }), (error) => error && error.code === "BUNDLE_MEMBERS_LOCKED" && error.status === 409);
    const bundleInspection = await openPostgres(connection);
    const preservedAvailability = await bundleInspection.query("SELECT status FROM bundle_availability_days WHERE property_id=$1 AND bundle_id=$2 AND stay_date=$3", ["property_alpha", bundle.id, "2026-09-03"]);
    await bundleInspection.close();
    assert.deepEqual(preservedAvailability.rows, [{ status: "available" }]);
    const service = createCustomReplyService({
      provider: providers.customReplies,
      customerSettings: providers.customerSettings,
      now: () => new Date("2026-07-30T04:00:00.000Z")
    });
    const saved = await phase("custom-reply-crud", () => service.create("property_alpha", {
      name: "九月公告",
      topic: "booking_open",
      scope: "all",
      stayStartDate: "2026-09-01",
      stayEndDate: "2026-09-30",
      effectiveStartDate: "2026-07-01",
      effectiveEndDate: "2026-09-30",
      approvedReply: "九月尚未開放預訂。",
      enabled: true
    }));
    assert.equal(service.list("property_alpha").items[0].approvedReply, "九月尚未開放預訂。");
    assert.equal(service.list("property_beta").used, 0);
    assert.equal(service.setEnabled("property_alpha", saved.ruleId, false).state, "disabled");
    assert.equal(service.remove("property_alpha", saved.ruleId), true);
    assert.equal(service.list("property_alpha").used, 0);

    const inspection = await phase("inspection-open", () => openPostgres(connection));
    const columns = await inspection.query("SELECT column_name FROM information_schema.columns WHERE table_name='property_custom_replies' ORDER BY ordinal_position");
    await phase("inspection-close", () => inspection.close());
    assert.deepEqual(columns.rows.map((row) => row.column_name), [
      "rule_id", "property_id", "name", "topic", "scope", "room_type_id",
      "stay_start_date", "stay_end_date", "effective_start_date", "effective_end_date",
      "approved_reply", "enabled", "created_at", "updated_at"
    ]);
    completed = true;
    console.log(JSON.stringify({ suite: "custom-reply-rules-postgres", pass: true, assertions: 13 }));
  } finally {
    if (providers) await phase("providers-close", () => providers.close());
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
