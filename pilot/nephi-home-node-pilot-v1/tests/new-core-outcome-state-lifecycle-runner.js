"use strict";
// FAKE_INTEGRATION: production adapter/core + PostgreSQL provider on isolated
// PGlite. Queued Understanding; no REAL OpenAI, PostgreSQL or LINE claim.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createProviders } = require("../lib/providers/provider-factory");
const { createNewCoreProductionTurnAdapter } = require("../lib/new-core/production-turn-adapter");
const { executeNewCoreTurn, turnStateSnapshot } = require("../lib/new-core/application-service");
const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
const { validateConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { isValidatedFinalResponse, unknownProvenanceFor } = require("../lib/conversation-engine-v2/claim-validator");
const { formalProperty } = require("./new-core-room-composition-query-runner");
const { policy } = require("./new-core-operator-policy-runner");
const NOW = "2026-09-13T08:00:00.000Z", propertyId = "lifecycle-contract";
const cases = [
  { name: "Unknown single", kind: "unknown", single: true, outcome: "unknown", action: "reply" },
  { name: "Unknown persist reload next", kind: "unknown", outcome: "unknown", action: "reply" },
  { name: "ANSWER multi turn", kind: "answer", outcome: "answered", action: "reply" },
  { name: "CLARIFY multi turn", kind: "clarify", outcome: "not_ready", action: "clarification" },
  { name: "HANDOFF multi turn", kind: "human", action: "handoff" },
  { name: "technical failure multi turn", kind: "technical", outcome: "technical_error", action: "reply" },
  { name: "NO_REPLY control", kind: "closure", action: "no_reply" },
  { name: "Unknown followed by closure", kind: "unknown", outcome: "unknown", action: "reply", next: "closure" }
];
async function run() {
  const connection = { kind: "pglite", dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "outcome-state-")) };
  const rows = []; let providers;
  try {
    await migratePostgres(connection);
    const db = await openPostgres(connection);
    await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [propertyId, "Contract lodge"]);
    await db.close(); providers = createProviders({ postgresConnection: connection });
    for (const c of cases) {
      const property = formalProperty(propertyId);
      property.propertyFacts = [policy(c.kind === "unknown" ? "unknown" : "allowed", c.kind === "unknown" ? "" : "The registered service is available.")];
      const scope = { propertyId, channel: "isolated", userId: c.name };
      let calls = 0, currentKind = c.kind;
      const adapter = createNewCoreProductionTurnAdapter({
        persistence: { getConversationState: (...args) => providers.persistence.getConversationState(...args), setConversationState: (...args) => providers.persistence.setConversationState(...args) },
        customerSettings: { getProperty: () => property, listInventoryPriceOverrides: () => [], listDatePriceClassifications: () => [] },
        service: { searchAvailability: () => { throw Error("isolated_dependency_failure"); }, searchAvailableDates: () => { throw Error("isolated_dependency_failure"); } },
        customReplies: { list: () => [] }, providerConfig: { apiKey: "isolated-provider-double" }, publicBaseUrl: "https://example.invalid", now: () => new Date(NOW),
        executeTurn: input => executeNewCoreTurn({ ...input, understandingProvider: (turn, opts) => callOpenAIUnderstandingV1(turn, { ...opts, fetchImpl: async () => {
          calls++; const id = turn.turnId, text = input.input.message;
          const closure = currentKind === "closure", human = currentKind === "human", stay = ["clarify", "technical"].includes(currentKind);
          const refs = [{ eventId: id, messageRef: id, startOffset: 0, endOffset: text.length, quote: text }];
          const unit = { unitId: id + "-unit", contextLinkCandidateId: id + "-link", purpose: closure ? "conversational_statement" : human ? "operator_request" : "lodging_question",
            capability: closure ? null : human ? "booking_operator_request" : stay ? "price" : "policy",
            subject: closure ? { kind: null, catalogIdentity: null } : human ? { kind: "other_verified", catalogIdentity: null } : stay ? { kind: "room", catalogIdentity: "type-family" } : { kind: "policy", catalogIdentity: "operator_access" },
            stayDependent: stay, evidenceRefs: refs, slotCandidates: [], quantityCandidate: null, confidenceBand: "high",
            temporalCandidate: currentKind === "technical" ? { rawText: "2026-12-25", kind: "absolute_date", checkInCandidate: "2026-12-25", checkOutCandidate: null, nightsCandidate: null } : null,
            safetyCandidate: human ? { operatorActionClass: "special_arrangement", riskClass: null } : null };
          const envelope = { understandingOutput: { schemaVersion: 1, turnId: id, units: [unit] }, contextLinkCandidates: [{ unitId: unit.unitId, contextLinkCandidateId: unit.contextLinkCandidateId, relationKind: closure ? "NONE" : "NEW_REQUEST", currentSourceEvidenceRefs: refs, referencedHistoryEventRefs: [] }] };
          return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(envelope) }] }] }) };
        } }) })
      });
      const processTurn = (id, message) => adapter.process({ customerId: propertyId, channelId: scope.channel, lineUserId: scope.userId, eventId: id, eventTimestamp: Date.parse(NOW), messageText: message });
      const row = { name: c.name };
      try {
        const first = await processTurn("first", c.kind === "technical" ? "Rate for 2026-12-25" : "This turn's formal request");
        row.first = { failure: first.earliestFailure, decision: first.finalDecision, outcomes: first.artifacts.executionOutcomes };
        assert.equal(first.earliestFailure, null); assert.equal(first.finalDecision.action, c.action);
        if (c.outcome) assert.equal(first.artifacts.executionOutcomes[0].outcome, c.outcome);
        if (c.kind === "unknown") assert.ok(unknownProvenanceFor(first.artifacts.executionOutcomes[0]));
        if (c.kind === "technical") assert.equal(unknownProvenanceFor(first.artifacts.executionOutcomes[0]), null);
        assert.equal(validateConversationStateV3(first.state).ok, true);
        const saved = providers.persistence.getConversationState(propertyId, scope.channel, scope.userId);
        assert.deepEqual(saved, first.state);
        await providers.close(); providers = createProviders({ postgresConnection: connection });
        const reloaded = providers.persistence.getConversationState(propertyId, scope.channel, scope.userId);
        assert.deepEqual(reloaded, saved); row.persisted = reloaded;
        assert.equal(providers.persistence.getConversationState(propertyId, "other-channel", scope.userId), null);
        assert.equal(turnStateSnapshot(reloaded, { ...scope, propertyId: "foreign" }, NOW).referenceableCycles.length, 0);
        if (!c.single) {
          const before = calls; currentKind = c.next || "answer";
          property.propertyFacts = [policy("allowed", "The registered service is available.")];
          const second = await processTurn("second", currentKind === "closure" ? "Thank you, I will discuss it." : "What is the registered service policy?");
          row.second = { failure: second.earliestFailure, decision: second.finalDecision, response: second.finalResponse, calls: calls - before };
          assert.equal(second.earliestFailure, null); assert.equal(calls - before, 1);
          assert.equal(second.finalDecision.action, currentKind === "closure" ? "no_reply" : "reply");
          assert.equal(second.finalResponse.shouldReply, currentKind !== "closure");
          if (currentKind === "closure") assert.equal(second.finalResponse.replyText, "");
          else assert.equal(isValidatedFinalResponse(second.finalResponse, { propertyId, turnId: "second", eventId: "second" }), true);
        }
        row.pass = true;
      } catch (error) { row.pass = false; row.error = { code: error.code, message: error.message }; }
      rows.push(row);
    }
  } finally { if (providers) await providers.close(); }
  if (process.env.LIFECYCLE_EVIDENCE) fs.writeFileSync(process.env.LIFECYCLE_EVIDENCE, JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows.map(({ name, pass, error }) => ({ name, pass, error }))));
  if (rows.some(r => !r.pass)) process.exitCode = 1;
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
