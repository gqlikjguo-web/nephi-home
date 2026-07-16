"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { migratePostgres } = require(path.join(ROOT, "lib/providers/postgres-migrate"));
const { openPostgres } = require(path.join(ROOT, "lib/providers/postgres-client"));
const { createPostgresProviders } = require(path.join(ROOT, "lib/providers/postgres-providers"));
const { upsertAdminUser } = require(path.join(ROOT, "lib/admin-auth"));
const { createApp } = require(path.join(ROOT, "server"));

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
      await client.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,$2,'2026-07-17','available',1)", [propertyId, roomId]);
    }
    await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES('test_home_a','room_a2','測試家庭房 A2',4,'family','',1)");
    await client.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES('test_home_a','room_a2','2026-07-16','available',1),('test_home_a','room_a2','2026-07-17','available',1)");
  } finally {
    await client.close();
  }
}

async function json(url, options = {}) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

async function runApiChecks(connection) {
  await upsertAdminUser(connection, {
    propertyId: "test_home_a",
    username: "owner_a",
    email: "owner-a@example.test",
    password: "test-owner-a-password"
  });
  await upsertAdminUser(connection, {
    propertyId: "test_home_b",
    username: "owner_b",
    email: "owner-b@example.test",
    password: "test-owner-b-password"
  });

  const app = createApp({ providers: createPostgresProviders(connection), structuredClassifier: null });
  const started = await app.start(0, "127.0.0.1");
  const base = started.url;
  const putNote = (cookie, body) => json(`${base}/api/availability/day-note`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const setStatus = (cookie, body) => json(`${base}/api/availability/day`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const month = (cookie, propertyId = "test_home_a") => json(`${base}/api/availability/month?propertyId=${propertyId}&year=2026&month=7`, { headers: { cookie } });

  try {
    let result = await putNote("", { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-16", note: "未登入" });
    assert.equal(result.response.status, 401);

    const login = await json(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner-a@example.test", password: "test-owner-a-password" })
    });
    assert.equal(login.response.status, 200);
    const cookieA = login.response.headers.get("set-cookie").split(";")[0];

    result = await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-16", note: "  等待訂金  " });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.note.note, "等待訂金");

    result = await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-16", note: "客人晚到" });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.note.note, "客人晚到");

    await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a2", date: "2026-07-16", note: "房間維修" });
    await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-17", note: "清潔提醒" });
    result = await month(cookieA);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.notesByDate["2026-07-16"].room_a.note, "客人晚到");
    assert.equal(result.body.data.notesByDate["2026-07-16"].room_a2.note, "房間維修");
    assert.equal(result.body.data.notesByDate["2026-07-17"].room_a.note, "清潔提醒");

    result = await setStatus(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-16", status: "closed" });
    assert.equal(result.response.status, 200);
    result = await month(cookieA);
    assert.equal(result.body.data.rows.find((row) => row.date === "2026-07-16").room_a, "closed");
    assert.equal(result.body.data.notesByDate["2026-07-16"].room_a.note, "客人晚到");

    result = await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-16", note: "" });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.note, null);
    result = await month(cookieA);
    assert.equal(result.body.data.notesByDate["2026-07-16"].room_a, undefined);
    assert.equal(result.body.data.rows.find((row) => row.date === "2026-07-16").room_a, "closed");

    assert.equal((await putNote(cookieA, { propertyId: "test_home_b", roomTypeId: "room_b", date: "2026-07-16", note: "越權" })).response.status, 403);
    assert.equal((await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_b", date: "2026-07-16", note: "錯誤房型" })).response.status, 400);
    assert.equal((await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-02-30", note: "錯誤日期" })).response.status, 400);
    assert.equal((await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-16", note: { text: "錯誤格式" } })).response.status, 400);
    assert.equal((await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-16", note: "x".repeat(1001) })).response.status, 400);
    assert.equal((await month(cookieA, "test_home_b")).response.status, 403);

    const guest = await json(`${base}/api/public/availability?propertyId=test_home_a&checkIn=2026-07-16`);
    assert.equal(JSON.stringify(guest.body).includes("房間維修"), false);
    assert.equal(/notesByDate|internalNote|dailyRoomNotes/.test(JSON.stringify(guest.body)), false);
  } finally {
    await app.stop();
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
    const mode = process.argv[2] || "--all";
    if (mode === "--provider-only" || mode === "--all") {
      await runProviderChecks(connection);
      console.log("每日房型備註 provider：8/8 PASS");
    }
    if (mode === "--api-only" || mode === "--all") {
      await runApiChecks(connection);
      console.log("每日房型備註 API：23/23 PASS");
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
