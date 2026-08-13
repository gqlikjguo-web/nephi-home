"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { buildPricingFacts } = require("../lib/conversation-engine-v2/capability-executor");

async function migrateThroughLegacyPricing(connection) {
  const client = await openPostgres(connection);
  const directory = path.resolve(__dirname, "../migrations");
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(".sql") && file < "023_date_price_authority.sql").sort();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    await client.transaction(async (transaction) => {
      for (const file of files) {
        await transaction.exec(fs.readFileSync(path.join(directory, file), "utf8"));
        await transaction.query("INSERT INTO schema_migrations(filename) VALUES($1)", [file]);
      }
    });
  } finally {
    await client.close();
  }
}

async function seed(connection) {
  const client = await openPostgres(connection);
  try {
    await client.query("INSERT INTO properties(property_id,display_name) VALUES('property-a','Property A'),('property-b','Property B')");
    await client.query("INSERT INTO property_settings(property_id,settings) VALUES('property-a','{}'::jsonb),('property-b','{}'::jsonb)");
    await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,position,enabled,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price) VALUES('property-a','room-a','Room A',2,0,true,1000,1200,1600,1100)");
    await client.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,enabled,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price) VALUES('property-a','bundle-a','Bundle A',8,5000,true,5000,6000,8000,5500)");
    await client.query("INSERT INTO room_price_overrides(property_id,room_id,stay_date,price,currency) VALUES('property-a','room-a','2026-09-21',2100,'TWD')");
  } finally {
    await client.close();
  }
}

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "date-price-storage-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  let providers;
  try {
    await migrateThroughLegacyPricing(connection);
    await seed(connection);
    await migratePostgres(connection);
    providers = createPostgresProviders(connection);
    const settings = providers.customerSettings;

    assert.deepEqual(settings.listInventoryPriceOverrides("property-a"), [{
      inventoryType: "room",
      inventoryId: "room-a",
      roomId: "room-a",
      bundleId: null,
      date: "2026-09-21",
      price: 2100,
      priceType: null,
      currency: "TWD"
    }], "a room override stored before migration 023 must retain its exact value in the unified authority");
    settings.setRoomPriceOverride("property-a", "room-a", "2026-09-21", 2200, "TWD");
    assert.equal(settings.listInventoryPriceOverrides("property-a")[0].price, 2200, "the legacy room override writer must remain compatible after migration");

    settings.setInventoryPriceOverride("property-a", {
      inventoryType: "bundle",
      inventoryId: "bundle-a",
      date: "2026-09-21",
      priceType: "friday"
    });
    assert.deepEqual(settings.listInventoryPriceOverrides("property-a").find((item) => item.inventoryType === "bundle"), {
      inventoryType: "bundle",
      inventoryId: "bundle-a",
      roomId: null,
      bundleId: "bundle-a",
      date: "2026-09-21",
      price: null,
      priceType: "friday",
      currency: "TWD"
    });

    settings.setDatePriceClassification("property-a", "2026-09-21", "saturday_holiday");
    assert.deepEqual(settings.listDatePriceClassifications("property-a"), [{ date: "2026-09-21", priceType: "saturday_holiday" }]);
    assert.deepEqual(settings.listDatePriceClassifications("property-b"), [], "formal date classifications must be property-scoped");
    const resolverPricing = buildPricingFacts({
      property: settings.getProperty("property-a"),
      availableInventory: [{ canonicalId: "room-a" }, { canonicalId: "bundle-a" }],
      checkIn: "2026-09-21",
      checkOut: "2026-09-22",
      priceOverrides: settings.listInventoryPriceOverrides("property-a"),
      datePriceClassifications: settings.listDatePriceClassifications("property-a")
    });
    assert.deepEqual(resolverPricing.prices.map((item) => [item.inventory.canonicalId, item.daily[0].price]), [["room-a",2200],["bundle-a",6000]], "Resolver must consume the same stored room and bundle price authority");

    assert.equal(settings.deleteInventoryPriceOverride("property-a", "bundle", "bundle-a", "2026-09-21"), true);
    assert.equal(settings.listInventoryPriceOverrides("property-a").some((item) => item.inventoryType === "bundle"), false, "clearing an inventory override must restore automatic pricing");
    assert.equal(settings.deleteDatePriceClassification("property-a", "2026-09-21"), true);
    assert.deepEqual(settings.listDatePriceClassifications("property-a"), []);
    console.log("date price storage: PASS");
  } finally {
    if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { run };
