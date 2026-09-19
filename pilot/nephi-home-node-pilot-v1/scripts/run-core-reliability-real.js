"use strict";
// Release-only harness. No production entrypoint, quota controller or LINE client.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const cases = require("../tests/fixtures/core-reliability-real-cases.json");
function validateDatabaseTarget(value) {
  const url = new URL(value);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/junzan_core_gate" && !url.search, "ISOLATED_DATABASE_REQUIRED");
  return { kind: "pg", databaseUrl: value, ssl: false };
}
function verifyTurn(c, r) {
  assert.equal(r.earliestFailure, null);
  assert.equal(r.artifacts.claimValidation.ok, true);
  assert.equal(r.finalDecision.action, c.action);
  assert.equal(r.finalResponse.action, c.action);
  assert.equal(r.finalResponse.shouldReply, c.action !== "no_reply");
  assert.equal(r.finalResponse.replyText, c.expectedText, "independent final public text contract");
  const outcomes = r.artifacts.executionOutcomes || [];
  for (const o of outcomes) for (const owner of [o.facts?.propertyId, o.resolverProvenance?.propertyId]) if (owner) assert.equal(owner, c.propertyId);
  if (c.date) {
    const q = r.artifacts.canonicalItems[0].canonicalRequest;
    assert.equal(q.temporalState.checkIn, c.date); assert.equal(q.temporalState.checkOut, c.checkOut);
    assert.ok(r.finalResponse.replyText.includes(c.date));
    const o = outcomes.find(o => o.type === "availability");
    assert.equal(o?.outcome, c.outcome);
    if (c.price) { assert.equal(o.facts.prices[0].total, c.price); assert.equal(o.facts.prices[0].inventory.publicName, c.room); }
    if (c.id === "capacity") { assert.equal(o.facts.feasibility.inventoryStatus, "available"); assert.equal(o.facts.feasibility.capacityStatus, "insufficient"); }
    if (c.outcome === "unknown") { assert.equal(o.reason, "missing_inventory_records"); assert.equal(o.resolverAttempted, true); }
  }
  if (c.action === "no_reply") assert.equal(outcomes.length, 0);
  if (c.answer) assert.ok(outcomes.some(o => o.facts?.answer === c.answer));
}
async function main() {
  assert.equal(process.env.CORE_GATE_REAL_APPROVED, "true", "release approval required");
  const app = path.resolve(__dirname, ".."), root = path.resolve(app, "../..");
  const candidate = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(candidate, process.env.CORE_GATE_CANDIDATE_SHA);
  assert.equal(execFileSync("git", ["diff", "HEAD", "--name-only"], { cwd: root, encoding: "utf8" }).trim(), "");
  const connection = validateDatabaseTarget(process.env.CORE_GATE_DATABASE_URL);
  const apiKey = process.env.CORE_GATE_OPENAI_API_KEY; assert.ok(apiKey, "isolated test provider key required");
  const evidenceDir = path.resolve(process.env.CORE_GATE_EVIDENCE_DIR); fs.mkdirSync(evidenceDir, { recursive: true });
  const { openPostgres } = require("../lib/providers/postgres-client");
  const db = await openPostgres(connection); let providers, realCalls = 0;
  const report = { candidateSha: candidate, provider: "REAL_OPENAI_AND_POSTGRESQL", status: "FAIL", turns: 0, realCalls: 0, lineDelivery: "NOT_RUN", quotaWrites: 0, results: [] };
  try {
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, "fresh isolated database required; rerunning a failed release is forbidden");
    await require("../lib/providers/postgres-migrate").migratePostgres(connection);
    for (const [id, name, amount] of [["gate_a", "401花園雙人房", 1000], ["gate_b", "海景雙人房", 2000]]) {
      await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [id, "Isolated reliability " + id]);
      await db.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2)", [id, JSON.stringify({ availabilityAutoReplyEnabled: true, commonAnswers: { checkInGuestText: "下午15:00起可以入住。" } })]);
      await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,position,base_price,weekday_price,friday_price,saturday_price) VALUES($1,'401',$2,2,0,$3,$3,$3,$3)", [id, name, amount]);
      for (const [date, status] of [["2026-09-19", "closed"], ["2026-09-21", "closed"], ["2026-09-28", "available"], ["2026-09-30", "available"], ["2026-12-25", "closed"]]) {
        await db.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,'401',$2,$3,$4)", [id, date, status, status === "available" ? 1 : 0]);
      }
    }
    providers = require("../lib/providers/postgres-providers").createPostgresProviders(connection);
    const service = require("../lib/mvp-service").createMvpService(providers);
    const { executeNewCoreTurn } = require("../lib/new-core/application-service");
    const { callOpenAIUnderstandingV1 } = require("../lib/providers/openai-understanding-v1");
    const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
    const saved = new Map();
    for (const c of cases.turns) {
      const scope = { propertyId: c.propertyId, channel: "isolated-core-release", userId: "gate-guest" }, turnId = "release-" + c.id;
      const now = cases.referenceTime, previous = c.previous && saved.get(c.previous);
      const property = providers.customerSettings.getProperty(c.propertyId), before = realCalls;
      const r = await executeNewCoreTurn({ scope, property, now,
        state: previous?.result.state || createConversationStateV3({ ...scope, tasks: [], createdAt: now, updatedAt: now, expiresAt: "2026-09-20T03:00:00.000Z" }),
        input: { turnId, traceId: turnId, message: c.message, recentConversation: previous ? [previous.event] : [], sourceEvents: [{ eventId: turnId, messageRef: turnId, role: "guest", timestamp: now, messageKind: "text", messageText: c.message }] },
        providerConfig: { apiKey }, publicBaseUrl: "https://example.invalid",
        resolver: { availability: q => { assert.equal(q.customerId, c.propertyId); return service.searchAvailability(q); }, availableDates: q => service.searchAvailableDates(q),
          priceOverrides: () => providers.customerSettings.listInventoryPriceOverrides(c.propertyId), dateClassifications: () => providers.customerSettings.listDatePriceClassifications(c.propertyId), customReplies: () => [] },
        understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, apiKey, fetchImpl: async (url, request) => {
          assert.equal(String(url), "https://api.openai.com/v1/responses");
          assert.ok(++realCalls <= cases.maxCalls && realCalls - before <= 2, "bounded genuine Understanding attempts only");
          return fetch(url, request);
        } }) });
      const capture = { id: c.id, calls: realCalls - before, canonical: r.artifacts.canonicalItems, decision: r.finalDecision, response: r.finalResponse, resolver: r.artifacts.executionOutcomes };
      fs.appendFileSync(path.join(evidenceDir, "turns.jsonl"), JSON.stringify(capture) + "\n");
      assert.ok(capture.calls >= 1 && capture.calls <= 2); verifyTurn(c, r);
      saved.set(c.id, { result: r, event: { eventId: turnId, messageRef: turnId, role: "guest", timestamp: now, messageKind: "text", messageText: c.message } });
      report.results.push({ id: c.id, status: "PASS", candidateSha: candidate, calls: capture.calls }); report.turns++;
    }
    assert.equal(report.turns, 13);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM message_logs")).rows[0].n, 0);
    report.status = "PASS";
  } finally {
    report.realCalls = realCalls;
    fs.writeFileSync(path.join(evidenceDir, "real-report.json"), JSON.stringify(report, null, 2));
    if (providers) await providers.close(); await db.close();
  }
}
if (require.main === module) main().catch(e => { console.error("REAL_E2E_STOP: " + e.message); process.exitCode = 1; });
module.exports = { verifyTurn, validateDatabaseTarget };
