"use strict";
// FAKE_INTEGRATION: actual Understanding boundary, core, PostgreSQL provider
// over isolated PGlite and Resolver. Only the OpenAI HTTP response is a double.
const { test } = require("node:test"), assert = require("node:assert/strict");
const { formalProviders } = require("./new-core-inventory-unknown-outcome-runner");
const { createMvpService } = require("../lib/mvp-service");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const NOW = "2026-09-19T03:00:00.000Z";
const cases = [
  ["今天3人，有房嗎", "今天", "2026-09-19", "2026-09-20", 3, 0],
  ["後天5人，可以預訂嗎", "後天", "2026-09-21", "2026-09-22", 5, 2],
  ["9/28有房嗎，3人", "9/28", "2026-09-28", "2026-09-29", 3],
  ["11/25有房嗎，5人", "11/25", "2026-11-25", "2026-11-26", 5],
  ["12/25可以預訂嗎，3人", "12/25", "2026-12-25", "2026-12-26", 3],
  ["2027/1/2有房嗎，5人", "2027/1/2", "2027-01-02", "2027-01-03", 5],
  ["11/25~11/27 401房，3人還有嗎？", "11/25~11/27", "2026-11-25", "2026-11-27", 3, null, true],
  ["9/30到10/2，5人可以預訂嗎", "9/30到10/2", "2026-09-30", "2026-10-02", 5],
  ["12/31到2027/1/2，3人有房嗎", "12/31到2027/1/2", "2026-12-31", "2027-01-02", 3]
];
for (const [message, raw, date, checkout, guests, offset, room] of cases) {
  test(`capacity result survives final validation: ${message}`, async () => {
    const { providers } = await formalProviders();
    createMvpService(providers, { now: () => new Date(NOW) }).applyBatch({ customerId: "inventory-a", mode: "all_inventory",
      startDate: date, endDate: new Date(Date.parse(checkout) - 86400000).toISOString().slice(0, 10), status: "available" });
    const property = providers.customerSettings.getProperty("inventory-a"), scope = { propertyId: property.propertyId, channel: "isolated", userId: "capacity-guest" };
    const service = createMvpService(providers), turnId = "capacity-turn";
    const ref = { eventId: turnId, messageRef: turnId, startOffset: 0, endOffset: message.length, quote: message };
    const nights = (Date.parse(checkout) - Date.parse(date)) / 86400000;
    const unit = { unitId: "capacity", purpose: "lodging_question", capability: "availability", subject: { kind: room ? "room" : "property", catalogIdentity: room ? "product-a" : null },
      stayDependent: true, evidenceRefs: [ref], confidenceBand: "high", safetyCandidate: null, contextLinkCandidateId: "link",
      temporalCandidate: { rawText: raw, kind: Number.isInteger(offset) ? "relative_date" : nights > 1 ? "date_range" : "absolute_date",
        checkInCandidate: Number.isInteger(offset) ? null : date, checkOutCandidate: nights > 1 ? checkout : null, nightsCandidate: nights > 1 ? nights : null,
        ...(Number.isInteger(offset) ? { relativeSemantics: { dayOffset: offset, dayPeriod: "unspecified" } } : {}) },
      slotCandidates: [{ slotCandidateId: "guest-count", slot: "guest_count", operation: "SET", value: guests, evidenceRefs: [ref] }],
      quantityCandidate: null };
    const output = { understandingOutput: { schemaVersion: 1, turnId, units: [unit] }, contextLinkCandidates: [{ contextLinkCandidateId: "link", unitId: "capacity", relationKind: "NEW_REQUEST", currentSourceEvidenceRefs: [ref], referencedHistoryEventRefs: [] }] };
    const r = await executeNewCoreTurn({ scope, property, now: NOW, publicBaseUrl: "https://example.invalid", providerConfig: { apiKey: "fixture-only" },
      state: createConversationStateV3({ ...scope, tasks: [], createdAt: NOW, updatedAt: NOW, expiresAt: "2026-09-20T03:00:00.000Z" }),
      input: { turnId, traceId: turnId, message, recentConversation: [], sourceEvents: [{ eventId: turnId, messageRef: turnId, role: "guest", timestamp: NOW, messageKind: "text", messageText: message }] },
      resolver: { availability: query => service.searchAvailability(query),
        priceOverrides: () => providers.customerSettings.listInventoryPriceOverrides(property.propertyId),
        dateClassifications: () => providers.customerSettings.listDatePriceClassifications(property.propertyId),
        customReplies: () => providers.customReplies.list(property.propertyId) },
      understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => "fixture" }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) }) }) });
    const outcome = r.artifacts.executionOutcomes[0];
    assert.ok(outcome, JSON.stringify({ earliestFailure: r.earliestFailure, understanding: r.artifacts.understanding, outcomes: r.artifacts.outcomes, property }));
    console.log(JSON.stringify({ classification: "FAKE_INTEGRATION", message, resolver: outcome, finalDecision: r.finalDecision,
      finalResponse: r.finalResponse, initialValidation: r.artifacts.initialClaimValidation, validation: r.artifacts.claimValidation, rebuildCount: r.artifacts.rebuildCount }));
    assert.equal(outcome.outcome, "no_availability");
    assert.equal(outcome.facts.feasibility.inventoryStatus, "available");
    assert.equal(outcome.facts.feasibility.capacityStatus, "insufficient");
    assert.equal(outcome.facts.checkIn, date);
    assert.equal(r.finalResponse.action, "reply");
    assert.equal(r.finalResponse.shouldReply, true);
    assert.equal(r.finalResponse.replyText, date + " 仍有空房，但目前可用房源無法在指定房數內容納這次入住人數，請調整房數或入住人數。\n查房連結：https://example.invalid/inventorya");
    assert.equal(r.artifacts.initialClaimValidation, null);
    assert.equal(r.artifacts.rebuildCount, 0);
    assert.equal(r.artifacts.claimValidation.ok, true);
    for (const phrase of ["目前沒有可提供的房型", "請稍後再試", "直接聯繫", "直接與我們聯繫", "目前無法確認", "資料尚未完整"]) assert.ok(!r.finalResponse.replyText.includes(phrase));
  });
}
