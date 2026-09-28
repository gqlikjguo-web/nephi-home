"use strict";
// STRUCTURED_CONTRACT_TEST. These probes are not REAL provider evidence.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const file = path.resolve(__dirname, "../scripts/run-core-reliability-real.js");
assert.ok(fs.existsSync(file), "RED: bounded real-provider release harness is required");
const { verifyTurn, validateDatabaseTarget } = require(file);
const cases = require("./fixtures/core-reliability-real-cases.json");
assert.equal(cases.turns.length, 13);
assert.equal(cases.maxCalls, 26);
assert.throws(() => validateDatabaseTarget("postgres://production.example/main"), /ISOLATED_DATABASE_REQUIRED/);
assert.throws(() => validateDatabaseTarget("postgres://127.0.0.1/main"), /ISOLATED_DATABASE_REQUIRED/);
validateDatabaseTarget("postgres://127.0.0.1/junzan_core_gate");
const c = cases.turns[0];
const r = { earliestFailure: null, finalDecision: { action: "reply" }, finalResponse: { action: "reply", shouldReply: true, replyText: c.expectedText }, artifacts: { claimValidation: { ok: true }, canonicalItems: [{ canonicalRequest: { temporalState: { checkIn: c.date, checkOut: c.checkOut } } }], executionOutcomes: [{ type: "availability", outcome: c.outcome, facts: { propertyId: c.propertyId } }] } };
verifyTurn(c, r);
for (const text of ["", "請稍後再試", "您查詢的日期目前沒有可提供的房型，歡迎查看其他日期，謝謝您。", c.expectedText.replace(c.date, "2026-01-01")]) {
  assert.throws(() => verifyTurn(c, { ...r, finalResponse: { ...r.finalResponse, replyText: text } }));
}
assert.throws(() => verifyTurn(c, { ...r, finalResponse: { ...r.finalResponse, action: "no_reply", shouldReply: false } }));
const foreign = structuredClone(r); foreign.artifacts.executionOutcomes[0].facts.propertyId = "foreign";
assert.throws(() => verifyTurn(c, foreign));
let checked = 10, failed = 0;
function probe(name, check) {
  checked++;
  try { check(); console.log("PASS " + name); }
  catch (error) { failed++; console.error("FAIL " + name + ": " + error.message); }
}
const zeroDays = [
  { id: "november", date: "2026-11-25", checkOut: "2026-11-26", unopenedDates: ["2026-11-25"],
    expectedText: "2026-11-25 至 2026-11-26 的住宿無法完整預訂：2026-11-25 未開放預訂。\n查房連結：https://example.invalid/gatea" },
  { id: "next-year", date: "2027-01-02", checkOut: "2027-01-03", unopenedDates: ["2027-01-02"],
    expectedText: "2027-01-02 至 2027-01-03 的住宿無法完整預訂：2027-01-02 未開放預訂。\n查房連結：https://example.invalid/gatea" },
  { id: "range-room", date: "2026-11-25", checkOut: "2026-11-27", unopenedDates: ["2026-11-25", "2026-11-26"],
    expectedText: "2026-11-25 至 2026-11-27 的住宿無法完整預訂：2026-11-25、2026-11-26 未開放預訂。\n查房連結：https://example.invalid/gatea" }
];
function notOpenResult(c) {
  return { earliestFailure: null, finalDecision: { action: "reply" }, finalResponse: { action: "reply", shouldReply: true, replyText: c.expectedText },
    artifacts: { claimValidation: { ok: true }, canonicalItems: [{ canonicalRequest: { temporalState: { checkIn: c.date, checkOut: c.checkOut } } }],
      executionOutcomes: [{ type: "availability", outcome: "no_availability", reason: "inventory_not_open", resolverAttempted: true,
        facts: { propertyId: c.propertyId, checkIn: c.date, checkOut: c.checkOut, unopenedDates: [...c.unopenedDates] },
        resolverProvenance: { status: "known_unavailable", reason: "inventory_not_open", unopenedDates: [...c.unopenedDates],
          readEvidence: { completed: true, source: "postgresql.inventory_availability_days", propertyId: c.propertyId,
            from: c.date, to: c.checkOut, rowsReturned: 0, records: [] } } }] } };
}
for (const expected of zeroDays) {
  const current = { ...expected, propertyId: "gate_a", action: "reply", outcome: "no_availability", reason: "inventory_not_open" };
  probe(expected.id + " fixture carries the approved result", () => {
    const actual = cases.turns.find(turn => turn.id === expected.id);
    for (const key of ["outcome", "reason", "unopenedDates", "expectedText"]) assert.deepEqual(actual[key], current[key]);
  });
  probe(expected.id + " accepts complete scoped successful zero-day evidence", () => verifyTurn(current, notOpenResult(current)));
  const corruptions = [
    ["Unknown cannot pass as not-open", o => { o.outcome = "unknown"; o.reason = "missing_inventory_records"; }],
    ["technical failure cannot pass as not-open", o => { o.outcome = "technical_error"; o.reason = "resolver_exception"; }],
    ["explicit closed is distinct", o => { delete o.reason; }],
    ["Resolver must execute", o => { o.resolverAttempted = false; }],
    ["successful read required", o => { o.resolverProvenance.readEvidence.completed = false; }],
    ["official source required", o => { o.resolverProvenance.readEvidence.source = "untrusted"; }],
    ["known unavailable provenance required", o => { o.resolverProvenance.status = "unknown"; }],
    ["provenance reason required", o => { o.resolverProvenance.reason = "missing_inventory_records"; }],
    ["read scope required", o => { o.resolverProvenance.readEvidence.propertyId = "foreign"; }],
    ["read range required", o => { o.resolverProvenance.readEvidence.to = "2030-01-01"; }],
    ["all unopened dates required", o => { o.facts.unopenedDates = []; }],
    ["provenance dates required", o => { o.resolverProvenance.unopenedDates = []; }],
    ["no inventory row may be mislabeled as whole-day zero", o => { o.resolverProvenance.readEvidence.rowsReturned = 1; o.resolverProvenance.readEvidence.records = [{ date: current.date, inventoryId: "other-product", status: "closed", remaining: 0 }]; }]
  ];
  for (const [name, corrupt] of corruptions) probe(expected.id + ": " + name, () => {
    const result = notOpenResult(current); corrupt(result.artifacts.executionOutcomes[0]);
    assert.throws(() => verifyTurn(current, result));
  });
}
probe("explicit closed cannot be relabeled as not-open", () => {
  const changed = structuredClone(r); changed.artifacts.executionOutcomes[0].reason = "inventory_not_open";
  assert.throws(() => verifyTurn(c, changed));
});
probe("genuine partial-missing Unknown keeps its separate reason and execution assertion", () => {
  const expected = { ...c, outcome: "unknown" }, result = structuredClone(r);
  Object.assign(result.artifacts.executionOutcomes[0], { outcome: "unknown", reason: "missing_inventory_records", resolverAttempted: true });
  verifyTurn(expected, result);
  for (const reason of ["inventory_not_open", "resolver_exception"]) {
    const wrong = structuredClone(result); wrong.artifacts.executionOutcomes[0].reason = reason;
    assert.throws(() => verifyTurn(expected, wrong));
  }
});
async function boundaryIntegration() {
  // Same release-only probes over PGlite: FAKE_INTEGRATION, never a claimed
  // native PostgreSQL or OpenAI result. No product runtime is replaced.
  const dataDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "core-real-oracle-"));
  const connection = { kind: "pglite", dataDir };
  let currentProviders;
  function officialProviders() {
    if (!currentProviders) currentProviders = require("../lib/providers/postgres-providers").createPostgresProviders(connection);
    return currentProviders;
  }
  // PGlite NodeFS does not share live snapshots across worker instances.
  // Serialize access; every query/provider still uses the official implementation.
  const db = { query: async (...args) => {
    if (currentProviders) { await currentProviders.close(); currentProviders = null; }
    const client = await require("../lib/providers/postgres-client").openPostgres(connection);
    try { return await client.query(...args); } finally { await client.close(); }
  } };
  const providers = { customerSettings: { getProperty: id => officialProviders().customerSettings.getProperty(id) },
    availability: { getRows: (...args) => officialProviders().availability.getRows(...args) }, persistence: {} };
  try {
    await require("../lib/providers/postgres-migrate").migratePostgres(connection);
    const results = await require(file).verifyInventoryBoundaries(db, providers, require("../lib/mvp-service").createMvpService(providers));
    assert.deepEqual(results, [
      { id: "partial-missing", outcome: "unknown", reason: "missing_inventory_records", resolverAttempted: true },
      { id: "malformed-row", outcome: "technical_error", reason: "availability_unreliable", resolverAttempted: true },
      { id: "query-failure", outcome: "technical_error", reason: "resolver_exception", resolverAttempted: true }
    ]);
    assert.equal((await db.query("SELECT count(*)::int n FROM inventory_availability_days")).rows[0].n, 2);
    console.log(JSON.stringify({ classification: "FAKE_INTEGRATION", inventoryBoundaryChecks: results, realOpenaiCalls: 0 }));
  } finally {
    if (currentProviders) await currentProviders.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
boundaryIntegration().catch(error => { failed++; console.error(error); }).finally(() => {
  console.log(JSON.stringify({ classification: "STRUCTURED_CONTRACT_TEST", cases: checked + 1, passed: checked + 1 - failed, failed, realOpenaiCalls: 0 }));
  if (failed) process.exitCode = 1;
});
