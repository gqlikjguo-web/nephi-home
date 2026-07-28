"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { migratePostgres } = require(path.join(root, "lib/providers/postgres-migrate"));
const { seedNephiPostgres } = require(path.join(root, "tests/helpers/nephi-postgres-seed"));
const { openPostgres } = require(path.join(root, "lib/providers/postgres-client"));
const { createPostgresProviders } = require(path.join(root, "lib/providers/postgres-providers"));
const { createApp } = require(path.join(root, "server"));

const checks = [];
function check(name, value) { assert.ok(value, name); checks.push(name); }
async function json(url, options) { const response = await fetch(url, options); return { response, body: await response.json() }; }

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nephi-guest-"));
  const connection = { kind: "pglite", dataDir };
  await migratePostgres(connection);
  await seedNephiPostgres(connection);
  const client = await openPostgres(connection);
  await client.query("UPDATE property_settings SET settings=jsonb_set(settings,'{contactLink}',to_jsonb($2::text),true) WHERE property_id=$1", ["nephi_home", "https://line.me/R/ti/p/test-only"]);
  await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", ["other_home", "其他民宿"]);
  await client.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)", ["other_home", JSON.stringify({ onboarding: { isReady: true }, contactLink: "javascript:alert(1)" })]);
  await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,$2,$3,$4,$5,$6,$7)", ["other_home", "room301", "其他房型", 2, "double", "", 0]);
  await client.query("INSERT INTO availability_days(property_id,stay_date,room301,room302,room401,room402,whole_house) VALUES($1,$2,'available','closed','closed','closed','closed')", ["other_home", "2026-07-19"]);
  await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", ["disabled_home", "停用民宿"]);
  await client.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)", ["disabled_home", JSON.stringify({ onboarding: { isReady: false } })]);
  await client.close();

  const providers = createPostgresProviders(connection);
  const app = createApp({ providers, structuredClassifier: null, adminAuthRequired: true });
  const running = await app.start(0, "127.0.0.1");
  const endpoint = (params) => `${running.url}/api/public/availability?${new URLSearchParams(params)}`;
  try {
    const page = await fetch(`${running.url}/guest?propertyId=nephi_home`);
    const html = await page.text();
    check("guest page opens", page.status === 200 && html.includes("客人查房") && html.includes("guest.css"));

    const all = await json(endpoint({ propertyId: "nephi_home", checkIn: "2026-07-19" }));
    check("single date defaults one night", all.response.status === 200 && all.body.data.checkOutDate === "2026-07-20");
    check("guest count optional", all.body.data.guestCount === null);
    check("any returns rooms and bundle", all.body.data.rooms.length === 4 && all.body.data.bundles.length === 1);
    check("line link comes from property", all.body.data.lineUrl === "https://line.me/R/ti/p/test-only");
    check("public response uses safe field whitelist", !/admin|session|secret|token|password|lineUserId/i.test(JSON.stringify(all.body.data)));

    const rooms = await json(endpoint({ propertyId: "nephi_home", checkIn: "2026-07-19", queryMode: "room_only" }));
    check("room only", rooms.body.data.rooms.length === 4 && rooms.body.data.bundles.length === 0);
    const bundles = await json(endpoint({ propertyId: "nephi_home", checkIn: "2026-07-19", queryMode: "bundle_only" }));
    check("bundle only", bundles.body.data.rooms.length === 0 && bundles.body.data.bundles.length === 1);
    const room301 = await json(endpoint({ propertyId: "nephi_home", checkIn: "2026-07-19", roomType: "301" }));
    check("specific 301", room301.body.data.rooms.length === 1 && room301.body.data.rooms[0].id === "room301" && room301.body.data.bundles.length === 0);

    providers.availability.setDay("nephi_home", "2026-07-19", "room301", "closed");
    const refreshed = await json(endpoint({ propertyId: "nephi_home", checkIn: "2026-07-19", roomType: "301" }));
    check("postgres update immediately visible", refreshed.body.data.rooms.length === 0);
    check("no availability has empty result", refreshed.body.data.empty === true);

    const unknown = await json(endpoint({ propertyId: "missing_home", checkIn: "2026-07-19" }));
    check("unknown property fails safely", unknown.response.status === 404 && unknown.body.error.code === "UNKNOWN_CUSTOMER_ID");
    const disabled = await json(endpoint({ propertyId: "disabled_home", checkIn: "2026-07-19" }));
    check("disabled property fails safely", disabled.response.status === 404 && disabled.body.error.code === "PROPERTY_NOT_AVAILABLE");
    const other = await json(endpoint({ propertyId: "other_home", checkIn: "2026-07-19" }));
    check("property isolation", other.body.data.propertyName === "其他民宿" && other.body.data.rooms.length === 1 && other.body.data.rooms[0].name === "其他房型" && !JSON.stringify(other.body).includes("四房包棟"));
    check("missing line link omitted", other.body.data.lineUrl === "");

    const write = await fetch(`${running.url}/api/public/availability`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    check("public api is read only", write.status === 404);

    const css = fs.readFileSync(path.join(root, "public/assets/guest.css"), "utf8");
    check("390px mobile layout", css.includes("390px") || css.includes("max-width: 32rem"));
  } finally {
    await app.stop();
    if (providers.close) await providers.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`${checks.length}/${checks.length} PASS`);
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
