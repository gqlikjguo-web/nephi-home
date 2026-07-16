"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { migratePostgres } = require(path.join(ROOT, "lib/providers/postgres-migrate"));
const { openPostgres } = require(path.join(ROOT, "lib/providers/postgres-client"));
const { createPostgresProviders } = require(path.join(ROOT, "lib/providers/postgres-providers"));

async function seedTestProperties(connection) {
  const client = await openPostgres(connection);
  try {
    for (const [propertyId, displayName, roomId, roomName] of [
      ["test_home_a", "測試旅宿 A", "room_a", "測試雙人房 A"],
      ["test_home_b", "測試旅宿 B", "room_b", "測試雙人房 B"]
    ]) {
      await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [propertyId, displayName]);
      await client.query("INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb)", [propertyId]);
      await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,$2,$3,2,'double','',0)", [propertyId, roomId, roomName]);
      await client.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,$2,'2026-07-16','available',1)", [propertyId, roomId]);
    }
  } finally {
    await client.close();
  }
}

async function runProviderChecks(connection) {
  const providers = createPostgresProviders(connection);
  try {
    const availability = providers.availability;
    assert.deepEqual(availability.getDayNotes("test_home_a", "2026-07-01", "2026-08-01"), []);

    const created = availability.setDayNote("test_home_a", "room_a", "2026-07-16", "  等待訂金  ");
    assert.equal(created.note, "等待訂金");
    assert.equal(created.propertyId, "test_home_a");
    assert.equal(created.roomTypeId, "room_a");

    const updated = availability.setDayNote("test_home_a", "room_a", "2026-07-16", "更新備註");
    assert.equal(updated.note, "更新備註");
    assert.equal(availability.getDayNotes("test_home_a", "2026-07-01", "2026-08-01").length, 1);
    assert.deepEqual(availability.getDayNotes("test_home_b", "2026-07-01", "2026-08-01"), []);

    assert.throws(
      () => availability.setDayNote("test_home_a", "room_b", "2026-07-16", "不得跨旅宿"),
      /foreign key|violates/i
    );

    assert.equal(availability.setDayNote("test_home_a", "room_a", "2026-07-16", "   "), null);
    assert.deepEqual(availability.getDayNotes("test_home_a", "2026-07-01", "2026-08-01"), []);
  } finally {
    await providers.close();
  }
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-daily-room-notes-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  try {
    await migratePostgres(connection);
    await migratePostgres(connection);
    await seedTestProperties(connection);
    await runProviderChecks(connection);
    console.log("每日房型備註 provider：8/8 PASS");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
