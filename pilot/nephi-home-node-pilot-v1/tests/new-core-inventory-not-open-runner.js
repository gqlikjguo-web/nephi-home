"use strict";
// FAKE_INTEGRATION: existing PostgreSQL provider over isolated PGlite, real
// Resolver/core/response validation, deterministic Understanding only. No network.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { run } = require("./new-core-inventory-unknown-outcome-runner");
const { createMvpService } = require("../lib/mvp-service");
let fixturePromise;
async function fixture() {
  if (!fixturePromise) fixturePromise = (async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-not-open-"));
    const connection = { kind: "pglite", dataDir };
    await require("../lib/providers/postgres-migrate").migratePostgres(connection);
    const db = await require("../lib/providers/postgres-client").openPostgres(connection);
    try {
      for (const id of ["inventory-a", "inventory-b"]) {
        await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,'Isolated inventory')", [id]);
        await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,position) VALUES($1,'product-a','Garden lodging',2,0)", [id]);
        await db.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity) VALUES($1,'product-b','Courtyard group',2)", [id]);
        await db.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id) VALUES($1,'product-b','product-a')", [id]);
      }
      for (const [date, ids, status, remaining] of [
        ["2026-10-07", ["product-a", "product-b"], "available", 1],
        ["2026-10-09", ["product-a", "product-b"], "closed", 0],
        ["2026-10-10", ["product-b"], "available", 1],
        ["2026-10-11", ["product-a"], "available", 1],
        ["2026-10-13", ["product-a", "product-b"], "available", 0],
        ["2026-10-20", ["date"], "available", 1]
      ]) for (const id of ids) await db.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES('inventory-a',$1,$2,$3,$4)", [id, date, status, remaining]);
      await db.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES('inventory-b','product-a','2026-10-08','available',1)");
    } finally { await db.close(); }
    return { dataDir, providers: require("../lib/providers/postgres-providers").createPostgresProviders(connection) };
  })();
  return fixturePromise;
}
after(async () => { if (fixturePromise) { const f = await fixturePromise; await f.providers.close(); fs.rmSync(f.dataDir, { recursive: true }); } });
async function turn(date, out, kind = "room") {
  const { providers } = await fixture();
  const text = out ? `${date}到${out}可以預訂嗎？` : `${date}可以預訂嗎？`;
  return run({ date, availabilityProvider: providers.availability, requests: [{ capability: "availability", kind,
    identity: kind === "bundle" ? "product-b" : "product-a", text,
    temporal: { rawText: out ? `${date}到${out}` : date, kind: out ? "date_range" : "absolute_date",
      checkInCandidate: date, checkOutCandidate: out || null, nightsCandidate: null } }] });
}
function assertNotOpen(r, dates, from, to) {
  const o = r.artifacts.executionOutcomes[0];
  assert.equal(o.outcome, "no_availability");
  assert.equal(o.reason, "inventory_not_open");
  assert.deepEqual(o.facts.unopenedDates, dates);
  assert.equal(o.facts.propertyId, "inventory-a");
  assert.equal(o.facts.checkIn, from); assert.equal(o.facts.checkOut, to);
  assert.equal(o.resolverAttempted, true);
  assert.equal(o.resolverProvenance.status, "known_unavailable");
  assert.equal(o.resolverProvenance.readEvidence.completed, true);
  assert.equal(o.resolverProvenance.readEvidence.source, "postgresql.inventory_availability_days");
  assert.equal(o.resolverProvenance.readEvidence.propertyId, "inventory-a");
  assert.equal(r.artifacts.responsePlan.sections[0].claimType, "FACTUAL_ANSWER");
  assert.equal(r.finalDecision.action, "reply");
  assert.equal(r.finalResponse.shouldReply, true);
  assert.ok(r.finalResponse.replyText.includes("無法完整預訂"));
  assert.ok(r.finalResponse.replyText.includes("未開放預訂"));
  for (const date of dates) assert.ok(r.finalResponse.replyText.includes(date));
  assert.ok(!r.finalResponse.replyText.includes("目前無法確認"));
}
for (const kind of ["room", "bundle"]) test(`successful whole-day zero rows are not-open: ${kind}`, async () => {
  assertNotOpen(await turn("2026-10-08", null, kind), ["2026-10-08"], "2026-10-08", "2026-10-09");
});
test("one open night cannot sell a two-night stay with an unopened second night", async () => {
  assertNotOpen(await turn("2026-10-07", "2026-10-09"), ["2026-10-08"], "2026-10-07", "2026-10-09");
});
test("explicit closed remains known unavailable and is not recast as zero rows", async () => {
  const o = (await turn("2026-10-09")).artifacts.executionOutcomes[0];
  assert.equal(o.outcome, "no_availability"); assert.notEqual(o.reason, "inventory_not_open");
  assert.ok(!o.facts.unopenedDates?.length);
});
test("partially recorded products are not a whole-day-zero fact", async () => {
  const o = (await turn("2026-10-10")).artifacts.executionOutcomes[0];
  assert.equal(o.outcome, "unknown"); assert.equal(o.reason, "missing_inventory_records");
});
test("bundle projection cannot hide a partial day beside an empty day", async () => {
  const o = (await turn("2026-10-11", "2026-10-13", "bundle")).artifacts.executionOutcomes[0];
  assert.equal(o.outcome, "unknown"); assert.notEqual(o.reason, "inventory_not_open");
});
test("contradictory inventory beside zero rows cannot become known not-open", async () => {
  const o = (await turn("2026-10-13", "2026-10-15")).artifacts.executionOutcomes[0];
  assert.ok(["unknown", "technical_error"].includes(o.outcome)); assert.notEqual(o.reason, "inventory_not_open");
});
test("malformed successful-read projection remains technical uncertainty", async () => {
  assert.equal((await turn("2026-10-20", "2026-10-22")).artifacts.executionOutcomes[0].outcome, "technical_error");
});
test("an empty array without authentic successful-read evidence is not a not-open fact", async () => {
  assert.equal((await run({ formalRead: false })).artifacts.executionOutcomes[0].outcome, "technical_error");
});
for (const message of ["database connection failure", "query failure", "postgres provider timeout: getRows"]) test(`dependency failure stays uncertain: ${message}`, async () => {
  const r = await run({ availabilityProvider: { getRows() { throw new Error(message); } } });
  const o = r.artifacts.executionOutcomes[0];
  assert.equal(o.outcome, "technical_error"); assert.equal(o.reason, "resolver_exception");
  assert.equal(r.artifacts.responsePlan.sections[0].claimType, "PROCESSING_STATUS");
  assert.ok(!r.finalResponse.replyText.includes("未開放預訂"));
});
test("another property's completed empty read cannot certify this property's date", async () => {
  const { providers } = await fixture();
  const r = await run({ date: "2026-10-12", availabilityProvider: { getRows: (_id, from, to) => providers.availability.getRows("inventory-b", from, to) } });
  assert.equal(r.artifacts.executionOutcomes[0].outcome, "technical_error");
});
test("available-date search treats unopened days as unavailable, not a failed search", async () => {
  const { providers } = await fixture();
  const r = createMvpService(providers).searchAvailableDates({ customerId: "inventory-a", dateFrom: "2026-10-07", dateTo: "2026-10-09", nights: 2, roomType: "product-a", queryMode: "room_only" });
  assert.equal(r.status, "answered"); assert.equal(r.dates[0].available, false);
});
