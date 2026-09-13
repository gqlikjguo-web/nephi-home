"use strict";
// FAKE_INTEGRATION + official provider over isolated PGlite, never REAL E2E.
const { test } = require("node:test"), assert = require("node:assert/strict");
const { run, formalProviders } = require("./new-core-inventory-unknown-outcome-runner");
const { unknownProvenanceFor } = require("../lib/conversation-engine-v2/claim-validator");
const { canonicalExecutionProvenanceFor } = require("../lib/conversation-engine-v2/capability-executor");
const outcomes = r => r.artifacts.executionOutcomes;

test("FACTUAL ANSWER stays factual", async () => {
  const r = await run({ inventory: "available" });
  assert.equal(outcomes(r)[0].outcome, "answered");
  assert.equal(r.artifacts.responsePlan.sections[0].claimType, "FACTUAL_ANSWER");
});
test("EPISTEMIC_UNKNOWN has completed PostgreSQL read provenance", async () => {
  const r = await run();
  const p = unknownProvenanceFor(outcomes(r)[0]);
  assert.ok(p);
  assert.equal(p.resolverProvenance?.status, "unknown");
  assert.equal(p.resolverProvenance?.reason, "missing_inventory_records");
  assert.equal(p.resolverProvenance?.readEvidence.source, "postgresql.inventory_availability_days");
  assert.equal(p.resolverProvenance?.readEvidence.propertyId, "inventory-a");
  assert.equal(p.resolverProvenance?.readEvidence.completed, true);
  assert.equal(r.finalDecision.reviewRequired, false);
});
test("unknown feasibility without completed-read provenance stays TECHNICAL_ERROR", async () => {
  const r = await run({ formalRead: false });
  assert.equal(outcomes(r)[0].outcome, "technical_error");
  assert.equal(unknownProvenanceFor(outcomes(r)[0]), null);
  assert.equal(canonicalExecutionProvenanceFor(outcomes(r)[0]).sourceOutcomeStatus, "technical_error");
  assert.equal(r.artifacts.responsePlan.sections[0].claimType, "PROCESSING_STATUS");
});
test("thrown dependency stays TECHNICAL_ERROR", async () => {
  const r = await run({ inventory: "exception" });
  assert.equal(outcomes(r)[0].reason, "resolver_exception");
  assert.equal(unknownProvenanceFor(outcomes(r)[0]), null);
  assert.equal(r.finalDecision.reviewRequired, false);
});
test("MISSING_INFORMATION is clarification", async () => {
  const r = await run({ requests: [{ capability: "availability", kind: "room", identity: "product-a", text: "Is Garden lodging available?", noDate: true }] });
  assert.equal(outcomes(r)[0].outcome, "not_ready");
  assert.equal(r.finalDecision.action, "clarification");
  assert.equal(r.artifacts.responsePlan.sections[0].claimType, "CLARIFY");
});
test("PARTIAL RESULT preserves UNKNOWN sibling", async () => {
  const r = await run({ inventory: "available", quantity: 2, sibling: true, factStatus: "unknown" });
  assert.equal(outcomes(r)[0].fulfillmentStatus, "partial");
  assert.equal(outcomes(r)[1].outcome, "unknown");
  assert.ok(unknownProvenanceFor(outcomes(r)[1]));
  assert.equal(r.artifacts.responsePlan.renderObligations.length, 2);
});
test("ANSWER and TECHNICAL_ERROR retain separate responsibility", async () => {
  const r = await run({ inventory: "exception", sibling: true });
  assert.deepEqual(outcomes(r).map(o => o.outcome), ["technical_error", "answered"]);
  assert.deepEqual(r.artifacts.responsePlan.sections.map(s => s.claimType), ["PROCESSING_STATUS", "FACTUAL_ANSWER"]);
  assert.ok(r.finalResponse.replyText.includes("A reading lounge is provided."));
  assert.equal(r.finalDecision.reviewRequired, false);
});
test("ANSWER and UNKNOWN retain their two obligations", async () => {
  const r = await run({ sibling: true });
  assert.deepEqual(outcomes(r).map(o => o.outcome), ["unknown", "answered"]);
  assert.deepEqual(r.artifacts.responsePlan.sections.map(s => s.claimType), ["EPISTEMIC_UNKNOWN", "FACTUAL_ANSWER"]);
  assert.ok(r.finalResponse.replyText.includes("A reading lounge is provided."));
});
test("NO_REPLY does not acquire a processing or unknown obligation", async () => {
  const r = await run({ requests: [{ capability: null, kind: null, identity: null, text: "We will discuss the options, thank you." }] });
  assert.equal(r.finalDecision.action, "no_reply");
  assert.equal(r.finalResponse.shouldReply, false);
  assert.equal(r.finalResponse.replyText, "");
});
test("HUMAN_ACTION_REQUIRED is grounded in operator action", async () => {
  const r = await run({ requests: [{ capability: "booking_operator_request", purpose: "operator_request", kind: "other_verified", identity: null,
    text: "Please cancel my reservation.", safetyCandidate: { operatorActionClass: "reservation_cancellation", riskClass: null } }] });
  assert.equal(r.finalDecision.action, "handoff");
  assert.equal(r.finalDecision.reviewRequired, true);
  assert.ok(r.artifacts.requestEvidence.some(e => e.humanActionRequired || e.existingOperatorResponsibility));
});
test("completed-read receipt is scoped and cannot be copied or forged", async () => {
  const { providers } = await formalProviders();
  const get = require("../lib/providers/postgres-providers").availabilityReadEvidenceFor;
  assert.equal(typeof get, "function");
  const scope = { propertyId: "inventory-a", from: "2026-12-25", to: "2026-12-26" };
  const rows = providers.availability.getRows(scope.propertyId, scope.from, scope.to);
  assert.ok(get(rows, scope));
  assert.equal(get([], scope), null);
  assert.equal(get(structuredClone(rows), scope), null);
  assert.equal(get(rows, { ...scope, propertyId: "inventory-b" }), null);
  assert.equal(get(rows, { ...scope, from: "2026-12-24" }), null);
  rows.push({ date: scope.from, forged: "available" });
  assert.equal(get(rows, scope), null);
});
test("public provider constructor cannot brand a fake RPC array as PostgreSQL evidence", () => {
  const { PostgresAvailabilityProvider, availabilityReadEvidenceFor } = require("../lib/providers/postgres-providers");
  const provider = new PostgresAvailabilityProvider({ call: () => [] });
  const scope = { propertyId: "inventory-a", from: "2026-12-25", to: "2026-12-26" };
  const rows = provider.getRows(scope.propertyId, scope.from, scope.to);
  assert.equal(availabilityReadEvidenceFor(rows, scope), null);
});
test("completed formal read with malformed projected rows stays technical", async () => {
  const { providers } = await formalProviders();
  const scope = { propertyId: "inventory-b", from: "2026-12-24", to: "2026-12-25" };
  const rows = providers.availability.getRows(scope.propertyId, scope.from, scope.to);
  assert.ok(require("../lib/providers/postgres-providers").availabilityReadEvidenceFor(rows, scope));
  assert.equal(rows[0].date, "available");
  const r = await run({ propertyId: scope.propertyId, date: scope.from });
  assert.equal(outcomes(r)[0].outcome, "technical_error");
  assert.equal(unknownProvenanceFor(outcomes(r)[0]), null);
  assert.equal(r.artifacts.responsePlan.sections[0].claimType, "PROCESSING_STATUS");
});
