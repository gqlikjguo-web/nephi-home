"use strict";
// Release-only harness. No production entrypoint, quota controller or LINE client.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const cases = require("../tests/fixtures/core-reliability-real-cases.json");
function readExecutionPlan(candidate, root, file) {
  if (!file) return null; // Compatibility with the previously installed, trusted Gate.
  const content = require("./capability-guard-content"), plan = JSON.parse(fs.readFileSync(file));
  const { planDigest, ...binding } = plan;
  assert.equal(content.hash(binding), planDigest, "REAL_PLAN_DRIFT");
  assert.equal(plan.candidateSha, candidate);
  assert.ok(Array.isArray(plan.ids) && plan.ids.length && new Set(plan.ids).size === plan.ids.length);
  const policy = JSON.parse(fs.readFileSync(path.join(root, ".github/product-content-policy.json")));
  assert.equal(content.contentDigest(content.gitTree(root, candidate), policy.mustMatch), plan.candidateDigest);
  const selected = cases.turns.filter(c => plan.ids.includes(c.id));
  assert.deepEqual(selected.map(c => c.id), plan.ids, "REAL_PLAN_CASES");
  for (const c of selected) if (c.previous) assert.ok(plan.ids.indexOf(c.previous) >= 0 && plan.ids.indexOf(c.previous) < plan.ids.indexOf(c.id), "REAL_PLAN_DEPENDENCY");
  return { plan, selected };
}
function validateDatabaseTarget(value) {
  const url = new URL(value);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/junzan_core_gate" && !url.search, "ISOLATED_DATABASE_REQUIRED");
  return { kind: "pg", databaseUrl: value, ssl: false };
}
function verifyNotOpen(c, o) {
  assert.equal(o.reason, "inventory_not_open"); assert.equal(o.resolverAttempted, true);
  assert.equal(o.facts.propertyId, c.propertyId);
  assert.equal(o.facts.checkIn, c.date); assert.equal(o.facts.checkOut, c.checkOut);
  assert.deepEqual(o.facts.unopenedDates, c.unopenedDates);
  const provenance = o.resolverProvenance, read = provenance?.readEvidence;
  assert.equal(provenance?.status, "known_unavailable"); assert.equal(provenance.reason, "inventory_not_open");
  assert.deepEqual(provenance.unopenedDates, c.unopenedDates);
  assert.equal(read?.completed, true); assert.equal(read.source, "postgresql.inventory_availability_days");
  assert.equal(read.propertyId, c.propertyId); assert.equal(read.from, c.date); assert.equal(read.to, c.checkOut);
  assert.ok(Array.isArray(read.records) && Array.isArray(c.unopenedDates) && c.unopenedDates.length > 0);
  assert.equal(read.rowsReturned, new Set(read.records.map(record => record.date)).size);
  for (const date of c.unopenedDates) {
    assert.ok(date >= c.date && date < c.checkOut);
    assert.equal(read.records.filter(record => record.date === date).length, 0, "whole-day zero, not selected-product missing");
  }
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
    if (c.reason === "inventory_not_open") verifyNotOpen(c, o);
    else assert.notEqual(o.reason, "inventory_not_open", "explicit closed and uncertainty must not become unopened inventory");
  }
  if (c.action === "no_reply") assert.equal(outcomes.length, 0);
  if (c.answer) assert.ok(outcomes.some(o => o.facts?.answer === c.answer));
}
async function verifyInventoryBoundaries(db, providers, service) {
  // Additional Resolver/PostgreSQL probes, not additional model turns or a
  // substitute for the thirteen genuine OpenAI-to-FinalResponse cases.
  const propertyId = "gate_inventory_boundary";
  await db.query("INSERT INTO properties(property_id,display_name) VALUES($1,'Isolated inventory boundary')", [propertyId]);
  for (const id of ["401", "402"]) await db.query("INSERT INTO room_types(property_id,room_id,name,capacity,position) VALUES($1,$2,$2,2,0)", [propertyId, id]);
  await db.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,'401','2031-02-01','closed',0),($1,'date','2031-02-02','available',1)", [propertyId]);
  const property = providers.customerSettings.getProperty(propertyId), results = [];
  function check(id, from, to, outcome, reason) {
    const actual = require("../lib/conversation-engine-v2/capability-executor").executeQueryPlan({ property, catalog: {},
      queryPlan: { propertyId, capability: "availability", resolverId: "availability_resolver", conditions: { stay: { checkIn: from, checkOut: to } },
        resolverTask: { propertyId, productType: "room_type", productId: "401", checkIn: from, checkOut: to } },
      availabilityResolver: query => service.searchAvailability(query) });
    assert.equal(actual.resolverAttempted, true); assert.equal(actual.outcome, outcome); assert.equal(actual.reason, reason);
    assert.notEqual(actual.reason, "inventory_not_open");
    if (outcome === "unknown") {
      assert.equal(actual.resolverProvenance.status, "unknown");
      assert.equal(actual.resolverProvenance.readEvidence.propertyId, propertyId);
      assert.equal(actual.resolverProvenance.readEvidence.completed, true);
    }
    results.push({ id, outcome: actual.outcome, reason: actual.reason, resolverAttempted: actual.resolverAttempted });
  }
  check("partial-missing", "2031-02-01", "2031-02-02", "unknown", "missing_inventory_records");
  check("malformed-row", "2031-02-02", "2031-02-03", "technical_error", "availability_unreliable");
  // Only the freshly created, loopback-only isolated Gate database is used.
  // Temporarily hide its table to exercise a genuine SQL failure; no injected
  // answer, production credential or persistent environment change is involved.
  await db.query("ALTER TABLE inventory_availability_days RENAME TO core_gate_withheld_inventory");
  try { check("query-failure", "2031-02-01", "2031-02-02", "technical_error", "resolver_exception"); }
  finally { await db.query("ALTER TABLE core_gate_withheld_inventory RENAME TO inventory_availability_days"); }
  assert.equal(results.length, 3);
  return results;
}
async function main() {
  assert.equal(process.env.CORE_GATE_REAL_APPROVED, "true", "release approval required");
  const app = path.resolve(__dirname, ".."), root = path.resolve(app, "../..");
  const candidate = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(candidate, process.env.CORE_GATE_CANDIDATE_SHA);
  assert.equal(execFileSync("git", ["diff", "HEAD", "--name-only"], { cwd: root, encoding: "utf8" }).trim(), "");
  const execution = readExecutionPlan(candidate, root, process.env.CORE_GATE_REAL_PLAN_FILE);
  const connection = validateDatabaseTarget(process.env.CORE_GATE_DATABASE_URL);
  const apiKey = process.env.CORE_GATE_OPENAI_API_KEY; assert.ok(apiKey, "isolated test provider key required");
  const evidenceDir = path.resolve(process.env.CORE_GATE_EVIDENCE_DIR); fs.mkdirSync(evidenceDir, { recursive: true });
  assert.ok(!["real-report.json", "turns.jsonl", "usage.jsonl"].some(name => fs.existsSync(path.join(evidenceDir, name))), "REAL_EVIDENCE_ALREADY_EXISTS");
  const metering = execution && require("./capability-real-session").createRealSession({ dir: evidenceDir, plan: execution.plan, budget: execution.plan.budget });
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
    for (const c of execution?.selected || cases.turns) {
      if (metering) metering.beginCase(c.id);
      const scope = { propertyId: c.propertyId, channel: "isolated-core-release", userId: "gate-guest" }, turnId = "release-" + c.id;
      const now = cases.referenceTime, previous = c.previous && saved.get(c.previous);
      const property = providers.customerSettings.getProperty(c.propertyId), before = metering ? metering.summary().calls : realCalls, attemptedBefore = realCalls;
      const r = await executeNewCoreTurn({ scope, property, now,
        state: previous?.result.state || createConversationStateV3({ ...scope, tasks: [], createdAt: now, updatedAt: now, expiresAt: "2026-09-20T03:00:00.000Z" }),
        input: { turnId, traceId: turnId, message: c.message, recentConversation: previous ? [previous.event] : [], sourceEvents: [{ eventId: turnId, messageRef: turnId, role: "guest", timestamp: now, messageKind: "text", messageText: c.message }] },
        providerConfig: { apiKey }, publicBaseUrl: "https://example.invalid",
        resolver: { availability: q => { assert.equal(q.customerId, c.propertyId); return service.searchAvailability(q); }, availableDates: q => service.searchAvailableDates(q),
          priceOverrides: () => providers.customerSettings.listInventoryPriceOverrides(c.propertyId), dateClassifications: () => providers.customerSettings.listDatePriceClassifications(c.propertyId), customReplies: () => [] },
        understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, apiKey, nowMs: Date.parse(now), fetchImpl: async (url, request) => {
          assert.equal(String(url), "https://api.openai.com/v1/responses");
          assert.ok(++realCalls <= cases.maxCalls && realCalls - attemptedBefore <= 2, "bounded genuine Understanding attempts only");
          return metering ? metering.fetch(url, request, fetch) : fetch(url, request);
        } }) });
      const capture = { id: c.id, calls: (metering ? metering.summary().calls : realCalls) - before, canonical: r.artifacts.canonicalItems, decision: r.finalDecision, response: r.finalResponse, resolver: r.artifacts.executionOutcomes };
      fs.appendFileSync(path.join(evidenceDir, "turns.jsonl"), JSON.stringify(capture) + "\n");
      assert.ok(capture.calls >= 1 && capture.calls <= 2); verifyTurn(c, r);
      if (metering) metering.completeCase(c.id);
      saved.set(c.id, { result: r, event: { eventId: turnId, messageRef: turnId, role: "guest", timestamp: now, messageKind: "text", messageText: c.message } });
      report.results.push({ id: c.id, status: "PASS", candidateSha: candidate, calls: capture.calls }); report.turns++;
    }
    assert.equal(report.turns, execution ? execution.selected.length : 13);
    report.inventoryBoundaries = { classification: "REAL_POSTGRESQL_PROVIDER", results: await verifyInventoryBoundaries(db, providers, service) };
    assert.equal((await db.query("SELECT count(*)::int AS n FROM message_logs")).rows[0].n, 0);
    report.status = "PASS";
  } finally {
    report.realCalls = realCalls;
    if (metering) {
      report.usage = metering.summary(); report.totalTokens = report.usage.tokens; report.realCalls = report.usage.calls;
      report.candidateDigest = execution.plan.candidateDigest; report.planDigest = execution.plan.planDigest;
      if (report.usage.status !== "PASS") report.status = "FAIL";
    }
    fs.writeFileSync(path.join(evidenceDir, "real-report.json"), JSON.stringify(report, null, 2));
    if (providers) await providers.close(); await db.close();
  }
}
if (require.main === module) main().catch(e => { console.error("REAL_E2E_STOP: " + e.message); process.exitCode = 1; });
module.exports = { verifyTurn, validateDatabaseTarget, verifyInventoryBoundaries, readExecutionPlan };
