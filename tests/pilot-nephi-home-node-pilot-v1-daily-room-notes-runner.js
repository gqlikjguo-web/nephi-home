"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { migratePostgres } = require(path.join(ROOT, "lib/providers/postgres-migrate"));
const { openPostgres } = require(path.join(ROOT, "lib/providers/postgres-client"));
const { createPostgresProviders } = require(path.join(ROOT, "lib/providers/postgres-providers"));
const { JsonFileRepository } = require(path.join(ROOT, "lib/json-repository"));
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
    await client.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled) VALUES('test_home_a','bundle_a','測試包棟 A',6,6000,6000,6500,7200,6200,true),('test_home_b','bundle_b','測試包棟 B',2,3000,3000,3300,3600,3100,true)");
    await client.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES('test_home_a','bundle_a','room_a',0),('test_home_a','bundle_a','room_a2',1),('test_home_b','bundle_b','room_b',0)");
    await client.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled) VALUES('test_home_a','bundle_note_only','Note-only bundle',2,3000,3000,3300,3600,3100,true)");
    await client.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES('test_home_a','bundle_note_only','room_a',0)");
    await client.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES('test_home_a','bundle_a','2026-07-16','available',1),('test_home_a','bundle_a','2026-07-17','available',1),('test_home_b','bundle_b','2026-07-16','available',1)");
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

    result = await putNote(cookieA, { propertyId: "test_home_a", inventoryType: "room", inventoryId: "room_a", date: "2026-07-16", note: "  等待訂金  " });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.note.note, "等待訂金");

    result = await putNote(cookieA, { propertyId: "test_home_a", inventoryType: "room", inventoryId: "room_a", date: "2026-07-16", note: "客人晚到" });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.note.note, "客人晚到");

    await putNote(cookieA, { propertyId: "test_home_a", inventoryType: "room", inventoryId: "room_a2", date: "2026-07-16", note: "房間維修" });
    await putNote(cookieA, { propertyId: "test_home_a", inventoryType: "room", inventoryId: "room_a", date: "2026-07-17", note: "清潔提醒" });
    result = await putNote(cookieA, { propertyId: "test_home_a", inventoryType: "bundle", inventoryId: "bundle_a", date: "2026-07-16", note: "包棟等待訂金" });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.note.inventoryType, "bundle");
    assert.equal(result.body.data.note.inventoryId, "bundle_a");
    result = await month(cookieA);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.notesByDate["2026-07-16"]["room:room_a"].note, "客人晚到");
    assert.equal(result.body.data.notesByDate["2026-07-16"]["room:room_a2"].note, "房間維修");
    assert.equal(result.body.data.notesByDate["2026-07-16"]["bundle:bundle_a"].note, "包棟等待訂金");
    assert.equal(result.body.data.notesByDate["2026-07-17"]["room:room_a"].note, "清潔提醒");

    result = await setStatus(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-16", status: "closed" });
    assert.equal(result.response.status, 200);
    result = await month(cookieA);
    assert.equal(result.body.data.rows.find((row) => row.date === "2026-07-16").room_a, "closed");
    assert.equal(result.body.data.notesByDate["2026-07-16"]["room:room_a"].note, "客人晚到");

    result = await putNote(cookieA, { propertyId: "test_home_a", inventoryType: "room", inventoryId: "room_a", date: "2026-07-16", note: "" });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.note, null);
    result = await month(cookieA);
    assert.equal(result.body.data.notesByDate["2026-07-16"]["room:room_a"], undefined);
    assert.equal(result.body.data.rows.find((row) => row.date === "2026-07-16").room_a, "closed");

    assert.equal((await putNote(cookieA, { propertyId: "test_home_b", inventoryType: "bundle", inventoryId: "bundle_b", date: "2026-07-16", note: "越權" })).response.status, 403);
    assert.equal((await putNote(cookieA, { propertyId: "test_home_a", inventoryType: "bundle", inventoryId: "bundle_b", date: "2026-07-16", note: "錯誤方案" })).response.status, 400);
    assert.equal((await putNote(cookieA, { propertyId: "test_home_a", inventoryType: "other", inventoryId: "bundle_a", date: "2026-07-16", note: "錯誤類型" })).response.status, 400);
    assert.equal((await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-02-30", note: "錯誤日期" })).response.status, 400);
    assert.equal((await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-16", note: { text: "錯誤格式" } })).response.status, 400);
    assert.equal((await putNote(cookieA, { propertyId: "test_home_a", roomTypeId: "room_a", date: "2026-07-16", note: "x".repeat(1001) })).response.status, 400);
    assert.equal((await month(cookieA, "test_home_b")).response.status, 403);

    const pricingBefore = await json(`${base}/api/room-pricing?customerId=test_home_a`, { headers: { cookie: cookieA } });
    const priceUpdate = await json(`${base}/api/room-pricing`, {
      method: "PUT", headers: { cookie: cookieA, "content-type": "application/json" },
      body: JSON.stringify({ propertyId: "test_home_a", rooms: [
        { roomTypeId: "room_a", mondayThursdayPrice: 2100, fridayPrice: 2200, saturdayHolidayPrice: 2500, sundayPrice: 2150 },
        { roomTypeId: "room_a2", mondayThursdayPrice: 4100, fridayPrice: 4300, saturdayHolidayPrice: 4800, sundayPrice: 4200 }
      ] })
    });
    assert.equal(priceUpdate.response.status, 200);
    assert.equal(priceUpdate.body.data.rooms.find((room) => room.id === "room_a").mondayThursdayPrice, 2100);
    assert.equal(priceUpdate.body.data.rooms.find((room) => room.id === "room_a2").sundayPrice, 4200);
    const invalidPriceUpdate = await json(`${base}/api/room-pricing`, {
      method: "PUT", headers: { cookie: cookieA, "content-type": "application/json" },
      body: JSON.stringify({ propertyId: "test_home_a", rooms: [
        { roomTypeId: "room_a", mondayThursdayPrice: 9999, fridayPrice: 9999, saturdayHolidayPrice: 9999, sundayPrice: 9999 },
        { roomTypeId: "missing_room", mondayThursdayPrice: 1, fridayPrice: 1, saturdayHolidayPrice: 1, sundayPrice: 1 }
      ] })
    });
    assert.equal(invalidPriceUpdate.response.status, 400);
    const pricingAfterFailure = await json(`${base}/api/room-pricing?customerId=test_home_a`, { headers: { cookie: cookieA } });
    assert.equal(pricingAfterFailure.body.data.rooms.find((room) => room.id === "room_a").mondayThursdayPrice, 2100);
    assert.equal(pricingBefore.body.data.overrides.length, pricingAfterFailure.body.data.overrides.length);

    const guest = await json(`${base}/api/public/availability?propertyId=test_home_a&checkIn=2026-07-16`);
    assert.equal(JSON.stringify(guest.body).includes("房間維修"), false);
    assert.equal(JSON.stringify(guest.body).includes("包棟等待訂金"), false);
    assert.equal(/notesByDate|internalNote|dailyRoomNotes/.test(JSON.stringify(guest.body)), false);
    assert.equal(JSON.stringify(app.service.getBootstrap("test_home_a")).includes("包棟等待訂金"), false);
    assert.equal(JSON.stringify(app.service.searchAvailability({ customerId: "test_home_a", checkIn: "2026-07-16", checkOut: "2026-07-17", queryMode: "any" })).includes("包棟等待訂金"), false);
    assert.equal(JSON.stringify(app.conversationCoordinator.getProperty("test_home_a")).includes("包棟等待訂金"), false);

    result = await putNote(cookieA, { propertyId: "test_home_a", inventoryType: "bundle", inventoryId: "bundle_a", date: "2026-07-16", note: "" });
    assert.equal(result.response.status, 200);
    result = await month(cookieA);
    assert.equal(result.body.data.notesByDate["2026-07-16"]["bundle:bundle_a"], undefined);
  } finally {
    await app.stop();
  }
}

function runFrontendChecks() {
  const adminHtml = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf8");
  const adminJs = fs.readFileSync(path.join(ROOT, "public/assets/admin.js"), "utf8");
  const adminCss = fs.readFileSync(path.join(ROOT, "public/assets/styles.css"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

  assert.match(adminHtml, /data-view="daily"/);
  assert.match(adminHtml, /data-view="calendar"/);
  assert.match(adminHtml, /id="dailyAvailability"/);
  assert.match(adminHtml, /id="availabilityCalendar"/);
  assert.match(adminHtml, /id="dayDetails"/);
  assert.match(adminHtml, /id="noteEditor"/);
  assert.match(adminHtml, /id="noteSave"/);
  assert.match(adminHtml, /id="noteClear"/);

  assert.match(adminJs, /availabilityState/);
  assert.match(adminJs, /renderDailyView/);
  assert.match(adminJs, /futureDailyDates/);
  assert.match(adminJs, /renderCalendarView/);
  assert.match(adminJs, /queueMutation/);
  assert.match(adminJs, /requestGeneration/);
  assert.match(adminJs, /notesByDate/);
  assert.match(adminJs, /propertyId:\s*session\.propertyId/);
  assert.match(adminJs, /inventoryType/);
  assert.match(adminJs, /inventoryId/);
  assert.match(adminJs, /\/api\/availability\/day-note/);
  assert.match(adminJs, /availability-inventory-grid/);
  assert.match(adminJs, /＋備註/);
  assert.match(adminJs, /編輯備註/);
  assert.doesNotMatch(adminJs, /本月較早日期/);
  assert.match(adminJs, /pricingMatrixForm/);
  assert.match(adminJs, /setPricingInputsDisabled/);
  assert.match(adminJs, /method:\s*"PUT"/);
  assert.match(adminJs, /localStorage/);
  assert.doesNotMatch(adminJs, /\/api\/public\/availability/);

  assert.match(adminCss, /\.availability-view-tabs/);
  assert.match(adminCss, /\.availability-daily/);
  assert.match(adminCss, /\.availability-calendar/);
  assert.match(adminCss, /\.availability-inventory-grid/);
  assert.match(adminCss, /\.pricing-matrix/);
  assert.match(adminCss, /#roomPricing\{min-width:0;width:100%;max-width:100%\}/);
  assert.match(adminCss, /\.checks label/);
  assert.match(adminCss, /min-height:\s*44px/);
  assert.match(adminCss, /min-width:\s*0/);
  assert.match(adminCss, /@media\(max-width:640px\)/);
  assert.match(packageJson.scripts.test, /daily-room-notes-runner/);
}

function runJsonCompatibilityChecks(temp) {
  const seedFile = path.join(temp, "legacy-seed.json");
  const dataFile = path.join(temp, "legacy-data.json");
  const homestay = { customerId: "legacy_home", name: "Legacy", rooms: [{ id: "legacy_room", name: "Legacy room" }], safeFacts: {} };
  fs.writeFileSync(seedFile, JSON.stringify({ homestays: [homestay], messageLogs: {}, seedDays: 0 }));
  fs.writeFileSync(dataFile, JSON.stringify({
    homestays: [homestay], availability: { legacy_home: {} }, guests: { legacy_home: [] }, notes: { legacy_home: [] }, messageLogs: {},
    dailyRoomNotes: { legacy_home: { "2026-07-17": { legacy_room: { propertyId: "legacy_home", roomTypeId: "legacy_room", date: "2026-07-17", note: "legacy note", createdAt: "2026-07-17T00:00:00.000Z", updatedAt: "2026-07-17T00:00:00.000Z" } } } }
  }));
  const repository = new JsonFileRepository({ dataFile, seedFile });
  assert.deepEqual(repository.getAvailabilityDayNotes("legacy_home", "2026-07-01", "2026-08-01").map((item) => [item.inventoryType, item.inventoryId, item.note]), [["room", "legacy_room", "legacy note"]]);
  const migrated = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert.equal(migrated.dailyRoomNotes.legacy_home["2026-07-17"]["room:legacy_room"].inventoryId, "legacy_room");
  assert.equal(migrated.dailyRoomNotes.legacy_home["2026-07-17"].legacy_room, undefined);
}

async function runProviderChecks(connection) {
  const providers = createPostgresProviders(connection);
  try {
    const availability = providers.availability;
    assert.deepEqual(availability.getDayNotes("test_home_a", "2026-07-01", "2026-08-01"), []);

    const created = availability.setDayNote("test_home_a", "room", "room_a", "2026-07-16", "  等待訂金  ");
    assert.equal(created.note, "等待訂金");
    assert.equal(created.propertyId, "test_home_a");
    assert.equal(created.inventoryType, "room");
    assert.equal(created.inventoryId, "room_a");

    const updated = availability.setDayNote("test_home_a", "room", "room_a", "2026-07-16", "更新備註");
    assert.equal(updated.note, "更新備註");
    assert.equal(availability.getDayNotes("test_home_a", "2026-07-01", "2026-08-01").length, 1);
    assert.deepEqual(availability.getDayNotes("test_home_b", "2026-07-01", "2026-08-01"), []);

    assert.throws(
      () => availability.setDayNote("test_home_a", "bundle", "bundle_b", "2026-07-16", "不得跨旅宿"),
      /inventory not found/i
    );

    const bundleNote = availability.setDayNote("test_home_a", "bundle", "bundle_a", "2026-07-16", "包棟備註");
    assert.equal(bundleNote.inventoryType, "bundle");
    availability.setDayNote("test_home_a", "bundle", "bundle_note_only", "2026-07-16", "must remain while bundle exists");
    assert.throws(() => providers.customerSettings.deleteBundle("test_home_a", "bundle_note_only"), /bundle already used/i);
    assert.equal(availability.getDayNotes("test_home_a", "2026-07-01", "2026-08-01").some((item) => item.inventoryId === "bundle_note_only"), true);
    availability.setDayNote("test_home_a", "bundle", "bundle_note_only", "2026-07-16", "");
    assert.equal(availability.setDayNote("test_home_a", "room", "room_a", "2026-07-16", "   "), null);
    assert.equal(availability.setDayNote("test_home_a", "bundle", "bundle_a", "2026-07-16", "   "), null);
    assert.deepEqual(availability.getDayNotes("test_home_a", "2026-07-01", "2026-08-01"), []);
  } finally {
    await providers.close();
  }
}

async function main() {
  const mode = process.argv[2] || "--all";
  if (mode === "--frontend-only") {
    runFrontendChecks();
    console.log("每日房況與月曆前端契約：25/25 PASS");
    return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-daily-room-notes-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  try {
    await migratePostgres(connection);
    await migratePostgres(connection);
    runJsonCompatibilityChecks(temp);
    await seedTestProperties(connection);
    if (mode === "--provider-only" || mode === "--all") {
      await runProviderChecks(connection);
      console.log("每日房型備註 provider：8/8 PASS");
    }
    if (mode === "--api-only" || mode === "--all") {
      await runApiChecks(connection);
      console.log("每日房型備註 API：23/23 PASS");
    }
    if (mode === "--all") {
      runFrontendChecks();
      console.log("每日房況與月曆前端契約：25/25 PASS");
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
