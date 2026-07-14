"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { createProviders } = require(path.join(ROOT, "lib/providers/provider-factory"));
const { migratePostgres } = require(path.join(ROOT, "lib/providers/postgres-migrate"));
const { seedPostgres } = require(path.join(ROOT, "lib/providers/postgres-seed"));
const { openPostgres } = require(path.join(ROOT, "lib/providers/postgres-client"));

async function main() {
  const runtimeRoot = path.join(ROOT, ".runtime");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(runtimeRoot, "postgres-test-"));
  const databasePath = path.join(temp, "database");
  const connection = { kind: "pglite", dataDir: databasePath };
  try {
    await migratePostgres(connection);
    await migratePostgres(connection);
    const seeded = await seedPostgres(connection);
    assert.equal(seeded.propertyId, "nephi_home");
    assert.equal(seeded.roomTypeCount, 4);
    assert.equal(seeded.availabilityDayCount, 49);
    const client = await openPostgres(connection);
    await client.query("UPDATE properties SET display_name='preserved' WHERE property_id='nephi_home'");
    await client.close();
    const repeatedSeed = await seedPostgres(connection);
    assert.equal(repeatedSeed.seeded, false);

    const providers = createProviders({ databaseUrl: "pglite:test", postgresConnection: connection });
    assert.equal(providers.kind, "postgres");
    const property = providers.customerSettings.getProperty("nephi_home");
    assert.equal(property.displayName, "preserved");
    assert.equal(property.rooms.length, 4);
    assert.ok(property.faqs.length >= 10);

    const rows = providers.availability.getRows("nephi_home", "2026-07-25", "2026-07-27");
    assert.deepEqual(rows.map((row) => row.date), ["2026-07-25", "2026-07-26"]);

    providers.persistence.setConversationState("nephi_home", "channel-a", "user-a", { nights: 2 });
    providers.persistence.setConversationState("other_home", "channel-a", "user-a", { nights: 9 });
    assert.equal(providers.persistence.getConversationState("nephi_home", "channel-a", "user-a").nights, 2);

    const claim = providers.persistence.claimMessageEvent("nephi_home", "channel-a", "event-a", {
      lineUserId: "user-a", guestMessage: "test"
    });
    assert.equal(claim.claimed, true);
    assert.equal(providers.persistence.claimMessageEvent("nephi_home", "channel-b", "event-a", {}).duplicate, true);
    providers.persistence.updateMessageEvent("nephi_home", "channel-a", "event-a", {
      processingStatus: "reply_succeeded", replyDelivered: true, needsReview: false
    });
    assert.equal(providers.persistence.findMessageByEventId("nephi_home", "event-a").processingStatus, "reply_succeeded");

    const review = providers.persistence.appendMessageLog("nephi_home", {
      reviewId: "review-a", eventId: "event-review", channelId: "channel-a",
      lineUserId: "user-a", guestMessage: "review", needsReview: true, status: "pending"
    });
    assert.equal(review.status, "pending");
    assert.equal(providers.persistence.resolveReview("nephi_home", "review-a", "correct", "ok").status, "resolved");
    assert.equal(providers.persistence.listMessageLogs("other_home").length, 0);

    providers.close();
    const jsonProviders = createProviders({ databaseUrl: "", dataFile: path.join(temp, "store.json"), seedFile: path.join(ROOT, "fixtures/seed.json") });
    assert.equal(jsonProviders.kind, "json");
    console.log("PostgreSQL provider: 14/14 PASS");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
