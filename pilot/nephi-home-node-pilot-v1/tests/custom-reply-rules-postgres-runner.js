"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createCustomReplyService } = require("../lib/custom-reply-rules");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { buildPricingFacts } = require("../lib/conversation-engine-v2/capability-executor");

let completed = false;
process.once("beforeExit", () => {
  if (!completed) {
    process.stderr.write("[custom-reply-pg] ERROR: runner exited before completing all assertions\n");
    process.exitCode = 1;
  }
});

(async () => {
  const databaseUrl = String(process.env.CUSTOM_REPLY_TEST_DATABASE_URL || "").trim();
  const temp = databaseUrl ? "" : fs.mkdtempSync(path.join(os.tmpdir(), "custom-replies-pg-"));
  const connection = databaseUrl
    ? { kind: "pg", databaseUrl, ssl: false }
    : { kind: "pglite", dataDir: path.join(temp, "db") };
  let providers;
  try {
    const migration = await migratePostgres(connection);
    assert.ok(migration.files.includes("018_property_custom_replies.sql"));
    const client = await openPostgres(connection);
    await client.query(
      "INSERT INTO properties(property_id,display_name) VALUES($1,$2),($3,$4)",
      ["property_alpha", "Alpha", "property_beta", "Beta"]
    );
    await client.query(
      "INSERT INTO room_types(property_id,room_id,name,capacity,position) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15)",
      ["property_alpha", "alpha_room", "Alpha Room", 2, 0, "property_alpha", "alpha_room_2", "Alpha Room 2", 3, 1, "property_beta", "beta_room", "Beta Room", 4, 0]
    );
    await client.close();

    providers = createPostgresProviders(connection);
    const bundle = providers.customerSettings.createBundle("property_alpha", {
      name: "Alpha bundle", capacity: 2, memberRoomIds: ["alpha_room"],
      mondayThursdayPrice: 1000, fridayPrice: 1100, saturdayHolidayPrice: 1200, sundayPrice: 1050,
      enabled: true, entertainmentAmenities: []
    });
    await providers.close();
    providers = null;
    const bundleAvailability = await openPostgres(connection);
    await bundleAvailability.query(
      "INSERT INTO bundle_availability_days(property_id,bundle_id,stay_date,status) VALUES($1,$2,$3,$4)",
      ["property_alpha", bundle.id, "2026-09-03", "available"]
    );
    await bundleAvailability.close();
    providers = createPostgresProviders(connection);
    const updatedBundle = providers.customerSettings.updateBundle("property_alpha", bundle.id, {
      ...bundle, name: "Alpha bundle updated", capacity: 3, memberRoomIds: ["alpha_room_2"], mondayThursdayPrice: 1300, fridayPrice: 1400,
      saturdayHolidayPrice: 1500, sundayPrice: 1350, enabled: false,
      entertainmentAmenities: [{ key: "singing", displayName: "KTV", provided: true, source: "preset", position: 0 }]
    });
    assert.equal(updatedBundle.id, bundle.id, "bundle updates must preserve the server-generated identity");
    assert.equal(updatedBundle.name, "Alpha bundle updated");
    assert.equal(updatedBundle.capacity, 3);
    assert.equal(updatedBundle.mondayThursdayPrice, 1300);
    assert.deepEqual(updatedBundle.memberRoomIds, ["alpha_room_2"]);
    assert.equal(updatedBundle.enabled, false);
    assert.equal(updatedBundle.entertainmentAmenities.find((item) => item.key === "singing").provided, true);
    assert.throws(
      () => providers.customerSettings.updateBundle("property_alpha", bundle.id, { ...updatedBundle, memberRoomIds: ["beta_room"] }),
      /invalid bundle member/,
      "bundle members must resolve inside the same property"
    );
    assert.equal(providers.customerSettings.listBundles("property_beta").length, 0, "bundle updates must not leak into another property");
    providers.customerSettings.updateBundle("property_alpha", bundle.id, { ...updatedBundle, enabled: true });
    const betaBundle = providers.customerSettings.createBundle("property_beta", {
      name: "Beta bundle", capacity: 4, memberRoomIds: ["beta_room"],
      mondayThursdayPrice: 2300, fridayPrice: 2400, saturdayHolidayPrice: 2500, sundayPrice: 2350,
      enabled: true, entertainmentAmenities: []
    });
    const disposable = providers.customerSettings.createBundle("property_alpha", {
      name: "Disposable", capacity: 2, memberRoomIds: ["alpha_room"],
      mondayThursdayPrice: 900, fridayPrice: 1000, saturdayHolidayPrice: 1100, sundayPrice: 950,
      enabled: true, entertainmentAmenities: []
    });
    assert.equal(providers.customerSettings.deleteBundle("property_alpha", disposable.id), true);
    assert.equal(providers.customerSettings.listBundles("property_alpha").some((item) => item.id === disposable.id), false);
    const freshAlpha = providers.customerSettings.getProperty("property_alpha");
    const freshBeta = providers.customerSettings.getProperty("property_beta");
    const alphaInventory = freshAlpha.rooms.find((item) => item.id === bundle.id);
    const betaInventory = freshBeta.rooms.find((item) => item.id === betaBundle.id);
    assert.equal(buildPricingFacts({ property: freshAlpha, availableInventory: [{ canonicalId: bundle.id }], checkIn: "2026-09-07", checkOut: "2026-09-08" }).prices[0].total, 1300, "the next formal pricing read must use the updated bundle price without restart");
    assert.equal(buildPricingFacts({ property: freshBeta, availableInventory: [{ canonicalId: betaBundle.id }], checkIn: "2026-09-07", checkOut: "2026-09-08" }).prices[0].total, 2300, "another property must keep its own price");
    assert.equal(buildPropertyCatalog(freshAlpha).rooms.find((item) => item.canonicalId === bundle.id).capacity, 3);
    assert.equal(alphaInventory.entertainmentAmenities.find((item) => item.key === "singing").provided, true);
    assert.equal(freshAlpha.rooms.some((item) => item.id === betaBundle.id), false);
    assert.equal(freshBeta.rooms.some((item) => item.id === bundle.id), false);
    assert.throws(
      () => providers.customerSettings.deleteBundle("property_alpha", bundle.id),
      /bundle already used/,
      "an existing bundle with formal availability history must retain the delete safety guard"
    );
    await providers.close();
    providers = null;
    const bundleInspection = await openPostgres(connection);
    const preservedAvailability = await bundleInspection.query(
      "SELECT status FROM bundle_availability_days WHERE property_id=$1 AND bundle_id=$2 AND stay_date=$3",
      ["property_alpha", bundle.id, "2026-09-03"]
    );
    await bundleInspection.close();
    assert.deepEqual(preservedAvailability.rows, [{ status: "available" }]);

    providers = createPostgresProviders(connection);
    const service = createCustomReplyService({
      provider: providers.customReplies,
      customerSettings: providers.customerSettings,
      now: () => new Date("2026-07-30T04:00:00.000Z")
    });
    const saved = service.create("property_alpha", {
      name: "September booking reply", topic: "booking_open", scope: "all",
      stayStartDate: "2026-09-01", stayEndDate: "2026-09-30",
      effectiveStartDate: "2026-07-01", effectiveEndDate: "2026-09-30",
      approvedReply: "September bookings are open.", enabled: true
    });
    assert.equal(service.list("property_alpha").items[0].approvedReply, "September bookings are open.");
    assert.equal(service.list("property_beta").used, 0);
    const updatedReply = service.update("property_alpha", saved.ruleId, {
      ...saved, name: "September booking reply updated", approvedReply: "September bookings can be requested.", enabled: true
    });
    assert.equal(updatedReply.approvedReply, "September bookings can be requested.");
    await providers.close();
    providers = createPostgresProviders(connection);
    const reloadedService = createCustomReplyService({
      provider: providers.customReplies,
      customerSettings: providers.customerSettings,
      now: () => new Date("2026-07-30T04:00:00.000Z")
    });
    assert.equal(reloadedService.list("property_alpha").items[0].name, "September booking reply updated");
    assert.equal(reloadedService.evaluate("property_alpha", saved.ruleId, {
      capability: "availability", canonicalEntity: { category: "room", canonicalId: "alpha_room" }, lodgingProduct: { productType: "room_type", productId: "alpha_room", roomTypeId: "alpha_room", bundleId: null }, temporalState: { checkIn: "2026-09-03" }
    }).matched, true);
    assert.throws(
      () => reloadedService.evaluate("property_beta", saved.ruleId, {
        capability: "availability", canonicalEntity: { category: "room", canonicalId: "beta_room" }, lodgingProduct: { productType: "room_type", productId: "beta_room", roomTypeId: "beta_room", bundleId: null }, temporalState: { checkIn: "2026-09-03" }
      }),
      (error) => error && error.code === "CUSTOM_REPLY_NOT_FOUND" && error.status === 404
    );
    assert.equal(reloadedService.setEnabled("property_alpha", saved.ruleId, false).state, "disabled");
    assert.equal(reloadedService.setEnabled("property_alpha", saved.ruleId, true).state, "active");
    assert.equal(reloadedService.remove("property_alpha", saved.ruleId), true);
    assert.equal(reloadedService.list("property_alpha").used, 0);

    await providers.close();
    providers = null;
    const inspection = await openPostgres(connection);
    const columns = await inspection.query("SELECT column_name FROM information_schema.columns WHERE table_name='property_custom_replies' ORDER BY ordinal_position");
    await inspection.close();
    assert.deepEqual(columns.rows.map((row) => row.column_name), [
      "rule_id", "property_id", "name", "topic", "scope", "room_type_id",
      "stay_start_date", "stay_end_date", "effective_start_date", "effective_end_date",
      "approved_reply", "enabled", "created_at", "updated_at"
    ]);
    completed = true;
    console.log(JSON.stringify({ suite: "custom-reply-rules-postgres", pass: true, assertions: 19, database: connection.kind }));
  } finally {
    if (providers) await providers.close();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
