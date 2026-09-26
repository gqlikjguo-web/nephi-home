"use strict";
// FAKE_INTEGRATION: actual core and PostgreSQL provider over isolated PGlite;
// only Understanding uses a model double. No production writes or network calls.
const { test } = require("node:test"), assert = require("node:assert/strict");
const { run, formalProviders } = require("./new-core-inventory-unknown-outcome-runner");
const { unknownProvenanceFor, isValidatedFinalResponse } = require("../lib/conversation-engine-v2/claim-validator");
const { createMvpService } = require("../lib/mvp-service");
const now = "2026-09-19T03:00:00.000Z";
const cases = [
  ["9/28，還可以預訂嗎", "9/28", "2026-09-28", "2026-09-29", false],
  ["11/25還有房嗎", "11/25", "2026-11-25", "2026-11-26", false],
  ["12/25可以預訂嗎", "12/25", "2026-12-25", "2026-12-26", false],
  ["2027/1/2有房嗎", "2027/1/2", "2027-01-02", "2027-01-03", false],
  ["11/25~11/27 401房，還有嗎？", "11/25~11/27", "2026-11-25", "2026-11-27", true]
];
// Partial-missing cases run first, before operator writes complete those dates.
for (const status of ["missing", "closed", "available"]) for (const [text, raw, date, checkout, room] of cases) {
  test(`${status}: ${text}`, async () => {
    const { providers } = await formalProviders();
    if (status !== "missing") {
      const service = createMvpService(providers, { now: () => new Date(now) });
      // Exercise the same all-inventory operator write used by the admin API.
      const endDate = new Date(Date.parse(checkout) - 86400000).toISOString().slice(0, 10);
      service.applyBatch({ customerId: "inventory-a", mode: "all_inventory", startDate: date, endDate, status });
      const rows = providers.availability.getRows("inventory-a", date, checkout);
      assert.equal(rows.length, room ? 2 : 1);
      for (const row of rows) for (const id of ["product-a", "product-b"]) assert.equal(row[id], status);
    }
    const r = await run({ now, date, availabilityProvider: providers.availability,
      requests: [{ capability: "availability", kind: room ? "room" : "property", identity: room ? "product-a" : null, text,
        temporal: { rawText: raw, kind: room ? "date_range" : "absolute_date", checkInCandidate: date,
          checkOutCandidate: room ? checkout : null, nightsCandidate: room ? 2 : null } }] });
    const canonical = r.artifacts.canonicalItems[0].canonicalRequest;
    assert.equal(canonical.temporalState.checkIn, date);
    assert.equal(canonical.temporalState.checkOut, checkout);
    if (room) assert.equal(canonical.canonicalEntity.canonicalId, "product-a");
    const outcome = r.artifacts.executionOutcomes[0];
    assert.equal(outcome.outcome, status === "missing" ? "unknown" : status === "closed" ? "no_availability" : "answered");
    assert.equal(r.finalResponse.shouldReply, true, "an active availability inquiry must not disappear");
    assert.equal(isValidatedFinalResponse(r.finalResponse, { propertyId: "inventory-a", turnId: "inventory-turn", eventId: "inventory-turn" }), true);
    assert.ok(r.finalResponse.replyText.trim());
    assert.ok(!r.finalResponse.replyText.includes("目前無法確認"));
    assert.equal(r.finalDecision.reviewRequired, false);
    if (status === "missing") {
      assert.equal(outcome.reason, "missing_inventory_records");
      assert.ok(unknownProvenanceFor(outcome));
      assert.equal(r.artifacts.responsePlan.sections[0].claimType, "EPISTEMIC_UNKNOWN");
      assert.ok(r.finalResponse.replyText.includes(`${date} 入住目前沒有可提供的房型，歡迎查看其他日期，謝謝您。`));
      // The fixture property URL contains "inventorya"; check guest prose, not its URL slug.
      const prose = r.finalResponse.replyText.replace(/https?:\/\/\S+/g, "");
      for (const forbidden of ["資料", "missing", "unknown", "inventory"]) assert.ok(!prose.includes(forbidden));
      const trace = require("../lib/new-core/production-safe-trace").formatNewCoreProductionTrace({ stage: "new_core_resolver", traceId: "availability-reliability", results: r.artifacts.executionOutcomes });
      assert.equal(trace.results[0].reason, "missing_inventory_records");
      assert.ok(!r.finalResponse.replyText.includes("請稍後再試"));
      assert.ok(!r.finalResponse.replyText.includes("直接與我們聯繫"));
    } else if (status === "closed") assert.ok(r.finalResponse.replyText.includes(`${date} 入住目前沒有可提供的房型，歡迎查看其他日期，謝謝您。`));
    else assert.ok(r.finalResponse.replyText.includes("目前可預訂"));
  });
}
test("another property's explicit close cannot create this property's facts", async () => {
  const { providers } = await formalProviders();
  assert.deepEqual(providers.availability.getRows("inventory-b", "2027-01-02", "2027-01-03"), [{ date: "2027-01-02", "product-b": "closed" }]);
  const r = await run({ propertyId: "inventory-b", date: "2027-01-02", availabilityProvider: providers.availability });
  assert.equal(r.artifacts.executionOutcomes[0].outcome, "unknown");
  assert.equal(r.finalResponse.shouldReply, true);
});
