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
console.log(JSON.stringify({ classification: "STRUCTURED_CONTRACT_TEST", cases: 10, passed: 10, realOpenaiCalls: 0 }));
