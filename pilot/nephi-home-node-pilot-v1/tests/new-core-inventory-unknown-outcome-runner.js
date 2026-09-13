"use strict";
// FAKE_INTEGRATION: official application, C03/C08, service Resolver and final
// validation; model doubles. Unknown-positive cases use the official provider
// over isolated PGlite reads; this is not REAL PostgreSQL or REAL OpenAI.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { createMvpService } = require("../lib/mvp-service");
const { isValidatedFinalResponse, unknownProvenanceFor } = require("../lib/conversation-engine-v2/claim-validator");
const NOW = "2026-09-12T11:35:00.000Z";
const DATE = "2026-12-25";
let formalPromise;
async function formalProviders() {
  if (!formalPromise) formalPromise = (async () => {
    const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-read-evidence-"));
    const connection = { kind: "pglite", dataDir };
    await require("../lib/providers/postgres-migrate").migratePostgres(connection);
    const db = await require("../lib/providers/postgres-client").openPostgres(connection);
    try {
      for (const id of ["inventory-a", "inventory-b"]) {
        await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [id, "Inventory fixture"]);
        await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,position) VALUES($1,$2,$3,2,0)", [id, "product-a", "Garden lodging"]);
        await db.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity) VALUES($1,$2,$3,2)", [id, "product-b", "Courtyard group"]);
        await db.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id) VALUES($1,$2,$3)", [id, "product-b", "product-a"]);
      }
      // Existing SQL schema permits this identifier; exercise the current
      // worker projection collision without changing schema or production data.
      await db.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,$2,$3,$4,1)",
        ["inventory-b", "date", "2026-12-24", "available"]);
    } finally { await db.close(); }
    const providers = require("../lib/providers/provider-factory").createProviders({ postgresConnection: connection });
    return { providers, dataDir };
  })();
  return formalPromise;
}
after(async () => {
  if (!formalPromise) return;
  const { providers, dataDir } = await formalPromise;
  await providers.close();
  require("node:fs").rmSync(dataDir, { recursive: true, force: true });
});

async function run({ propertyId = "inventory-a", capabilities = ["availability"], kind = "room", inventory = "missing", sibling = false,
  formalRead = true, requests = null, quantity = null, factStatus = "provided", date = DATE } = {}) {
  const scope = { propertyId, channel: "isolated", userId: "inventory-guest" };
  const room = { id: "product-a", name: "Garden lodging", type: "double", capacity: 2, basePrice: 1000,
    mondayThursdayPrice: 1000, fridayPrice: 1000, saturdayHolidayPrice: 1000, sundayPrice: 1000 };
  const bundle = { ...room, id: "product-b", name: "Courtyard group", inventoryType: "bundle", memberRoomIds: [room.id] };
  const property = { propertyId, displayName: "Inventory fixture", timezone: "Asia/Taipei", rooms: [room, bundle], commonAnswers: {},
    propertyFacts: [{ canonicalId: "facility-a", publicName: "Reading lounge", category: "amenity", status: factStatus, publicText: factStatus === "unknown" ? "" : "A reading lounge is provided." }] };
  const availability = inventory === "missing" && formalRead ? (await formalProviders()).providers.availability : {
    getRows: () => inventory === "missing" ? [] : [{ date, [room.id]: inventory, [bundle.id]: inventory }]
  };
  const service = createMvpService({ customerSettings: { getProperty: () => property }, persistence: {}, availability });
  const specs = requests || capabilities.map(capability => ({ capability, kind, identity: kind === "bundle" ? bundle.id : room.id,
    text: `${capability} for ${kind === "bundle" ? bundle.name : room.name} on ${date}` }));
  if (sibling) specs.push({ capability: "amenity", kind: "amenity", identity: "facility-a", text: "Is there a reading lounge?" });
  const message = specs.map(s => s.text).join("\n"), turnId = "inventory-turn";
  let calls = 0;
  const result = await executeNewCoreTurn({ scope, property, now: NOW,
    state: createConversationStateV3({ ...scope, tasks: [], createdAt: NOW, updatedAt: NOW, expiresAt: "2026-09-13T11:35:00.000Z" }),
    input: { turnId, traceId: turnId, message, recentConversation: [], sourceEvents: [{ eventId: turnId, messageRef: turnId,
      role: "guest", timestamp: NOW, messageKind: "text", messageText: message }] },
    publicBaseUrl: "https://example.invalid", providerConfig: { apiKey: "fixture-only" },
    resolver: { availability: query => {
      if (inventory === "exception") throw new Error("controlled provider failure");
      if (inventory === "untyped_unreliable") return { customerId: propertyId, checkIn: DATE, checkOut: "2026-12-26", rooms: [], availabilityReliable: false };
      return service.searchAvailability(query);
    }, availableDates: () => { throw new Error("unexpected date search"); }, priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, fetchImpl: async () => {
      calls++;
      const units = specs.map((s, i) => ({ unitId: `request-${i}`, purpose: s.purpose || (s.capability === null ? "conversational_statement" : "lodging_question"), capability: s.capability,
        subject: { kind: s.kind, catalogIdentity: s.identity }, stayDependent: ["availability", "price"].includes(s.capability),
        evidenceRefs: [{ eventId: turnId, messageRef: turnId, startOffset: message.indexOf(s.text), endOffset: message.indexOf(s.text) + s.text.length, quote: s.text }],
        temporalCandidate: s.noDate || !["availability", "price"].includes(s.capability) ? null : { rawText: date, kind: "absolute_date", checkInCandidate: date, checkOutCandidate: null, nightsCandidate: null },
        slotCandidates: [], quantityCandidate: quantity && s.capability === "availability" ? { requestedQuantity: quantity, distinctRequirement: "distinct_entities", evidenceRefs: [{ eventId: turnId, messageRef: turnId, startOffset: message.indexOf(s.text), endOffset: message.indexOf(s.text) + s.text.length, quote: s.text }] } : null,
        safetyCandidate: s.safetyCandidate || null, contextLinkCandidateId: `link-${i}`, confidenceBand: "high" }));
      const output = { understandingOutput: { schemaVersion: 1, turnId, units }, contextLinkCandidates: units.map(u => ({
        contextLinkCandidateId: u.contextLinkCandidateId, unitId: u.unitId, relationKind: u.capability === null ? "NONE" : "NEW_REQUEST", currentSourceEvidenceRefs: u.evidenceRefs, referencedHistoryEventRefs: [] })) };
      return { ok: true, status: 200, headers: { get: () => "fixture-request" }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
    } }) });
  assert.equal(calls, 1);
  assert.equal(result.earliestFailure, null);
  assert.equal(result.artifacts.claimValidation.ok, true);
  if (result.finalResponse.shouldReply) assert.equal(isValidatedFinalResponse(result.finalResponse, { propertyId, turnId, eventId: turnId }), true);
  else assert.equal(result.finalResponse.replyText, "");
  return result;
}

if (require.main === module) {
for (const propertyId of ["inventory-a", "inventory-b"]) for (const kind of ["room", "bundle"]) {
  test(`formal unknown inventory remains epistemic: ${propertyId}/${kind}`, async () => {
    const r = await run({ propertyId, kind, capabilities: ["availability", "price"] });
    assert.deepEqual(r.artifacts.executionOutcomes.map(o => o.outcome), ["unknown", "unknown"]);
    for (const o of r.artifacts.executionOutcomes) {
      assert.equal(o.resolverAttempted, true);
      assert.ok(unknownProvenanceFor(o));
    }
    assert.notEqual(r.finalDecision.reasonCode, "terminal_processing_status");
    assert.equal(r.finalDecision.reviewRequired, false);
    assert.ok(r.artifacts.responsePlan.sections.every(s => s.claimType === "EPISTEMIC_UNKNOWN"));
  });
}
test("unknown inventory preserves an independent factual answer", async () => {
  const r = await run({ capabilities: ["availability", "price"], sibling: true });
  assert.deepEqual(r.artifacts.executionOutcomes.map(o => o.outcome), ["unknown", "unknown", "answered"]);
  assert.ok(r.finalResponse.replyText.includes("A reading lounge is provided."));
});
for (const [inventory, expected] of [["available", "answered"], ["closed", "no_availability"], ["exception", "technical_error"], ["untyped_unreliable", "technical_error"]]) {
  test(`preserves existing ${inventory} outcome`, async () => {
    const r = await run({ inventory });
    assert.equal(r.artifacts.executionOutcomes[0].outcome, expected);
    if (expected === "technical_error") {
      assert.equal(unknownProvenanceFor(r.artifacts.executionOutcomes[0]), null);
      assert.equal(r.finalDecision.reasonCode, "terminal_processing_status");
    }
  });
}
}
module.exports = { run, formalProviders };
