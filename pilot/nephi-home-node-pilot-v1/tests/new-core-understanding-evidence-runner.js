"use strict";

// STRUCTURED_CONTRACT_TEST / FAKE_INTEGRATION. Fixed provider HTTP responses;
// real admission/correction, shared application and existing manual repository.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const fixturePath = path.join(__dirname, "new-core-openai-adapter-contract-runner.js");
const fixture = new Module(fixturePath, module);
fixture.filename = fixturePath;
fixture.paths = Module._nodeModulePaths(__dirname);
fixture._compile(fs.readFileSync(fixturePath, "utf8").split("async function main()")[0]
  + "\nmodule.exports={c01,providerOutput,successfulResponse,options};", fixturePath);
const f = fixture.exports;
const { callOpenAIUnderstandingV1, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC: D } = require("../lib/providers/openai-understanding-v1");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const { createNewCoreManualTestService } = require("../lib/new-core/manual-test-service");
const { formatNewCoreProductionTrace } = require("../lib/new-core/production-safe-trace");
const clone = value => JSON.parse(JSON.stringify(value));
const bad = (id = "wrong-turn") => {
  const output = f.providerOutput(); output.understandingOutput.turnId = id; return output;
};
async function run(first, second = first, extra = {}) {
  const bodies = [], events = []; let result, error;
  try {
    result = await callOpenAIUnderstandingV1(f.c01(), { ...f.options(async (_url, request) => {
      bodies.push(JSON.parse(request.body));
      assert.ok(bodies.length <= 2, "diagnostics cannot add a third model call");
      return f.successfulResponse(bodies.length === 1 ? first : second);
    }), onOperationalDiagnostic: entry => events.push(entry), ...extra });
  } catch (caught) { error = caught; }
  return { result, error, bodies, events, meta: (result || error)?.[D] };
}
function correctionBody(r) {
  return JSON.parse(r.bodies[1].input.at(-1).content[0].text.split("\n").at(-1));
}

test("two C02 failures retain both original outputs and exact existing violations", async () => {
  const first = bad("first-wrong-turn"), second = bad("second-wrong-turn");
  const r = await run(first, second);
  assert.equal(r.error.code, "UNDERSTANDING_SCHEMA_INVALID");
  assert.equal(r.bodies.length, 2);
  assert.equal(r.meta.finalAcceptedAttempt, null);
  assert.ok(Array.isArray(r.meta.attemptEvidence), "missing per-attempt schema evidence");
  const [a, b] = r.meta.attemptEvidence;
  assert.deepEqual([a.attemptNumber, a.attemptType, b.attemptNumber, b.attemptType], [1, "initial", 2, "correction"]);
  assert.deepEqual(a.structuredOutput, first);
  assert.deepEqual(b.structuredOutput, second);
  for (const [entry, id] of [[a, "first-wrong-turn"], [b, "second-wrong-turn"]]) {
    assert.equal(entry.schemaError.fieldPath, "understandingOutput.turnId");
    assert.equal(entry.schemaError.rule, "enum:C01.turnId");
    assert.equal(entry.schemaError.expected, "enum:C01.turnId");
    assert.equal(entry.schemaError.actual, id);
    assert.equal(entry.admissionFailureCode, "UNDERSTANDING_SCHEMA_INVALID");
    assert.equal(entry.accepted, false);
  }
  assert.deepEqual(b.correctionInput, correctionBody(r));
  assert.equal(b.adoption.candidateAdmitted, false);
  assert.equal(b.adoption.rejectionStage, "admission");
  assert.equal(b.adoption.reportedFailure, "CORRECTION_SIBLING_NOT_PRESERVED");
  assert.equal(b.adoption.checks.unitIdsRetained, false);
});

test("a valid first attempt remains one call with no invented correction", async () => {
  const output = f.providerOutput(), r = await run(output);
  assert.equal(r.bodies.length, 1);
  assert.equal(r.meta.finalAcceptedAttempt, 1);
  assert.ok(r.meta.attemptEvidence, "missing accepted-attempt evidence");
  assert.equal(r.meta.attemptEvidence.length, 1);
  assert.deepEqual(r.meta.attemptEvidence[0].structuredOutput, output);
  assert.equal(r.meta.attemptEvidence[0].schemaError, null);
  assert.equal(r.meta.attemptEvidence[0].correctionInput, null);
  assert.equal(r.meta.attemptEvidence[0].accepted, true);
});

test("successful correction retains the exact submitted failure evidence and all verdicts", async () => {
  const r = await run(bad(), f.providerOutput());
  assert.equal(r.meta.finalAcceptedAttempt, 2);
  assert.ok(r.meta.attemptEvidence, "missing correction receipt");
  const b = r.meta.attemptEvidence[1];
  assert.deepEqual(b.correctionInput, correctionBody(r));
  assert.deepEqual(b.structuredOutput, f.providerOutput());
  assert.equal(b.schemaError, null);
  assert.equal(b.adoption.candidateAdmitted, true);
  assert.equal(b.adoption.rejectionStage, null);
  assert.equal(b.accepted, true);
  assert.equal(b.adoption.checks.fieldsPreserved, true);
});

test("sensitive output fields and embedded credential values are redacted without mutating input", async () => {
  const secret = crypto.randomBytes(32).toString("hex");
  const output = bad();
  output.authorization = `Bearer ${secret}`;
  output.extra = { apiKey: secret, note: secret, secret, cookie: secret };
  const before = clone(output), r = await run(output, output, { apiKey: secret });
  assert.deepEqual(output, before);
  assert.ok(r.meta.attemptEvidence, "missing redacted evidence");
  const encoded = JSON.stringify(r.meta.attemptEvidence);
  assert.equal(encoded.includes(secret), false);
  assert.equal(encoded.includes("Bearer "), false);
  assert.ok(encoded.includes("[REDACTED]"));
  assert.equal(r.error.code, "UNKNOWN_WIRE_FIELD");
});

test("production safe trace never exposes structured outputs or correction bodies", async () => {
  const r = await run(bad(), f.providerOutput());
  const safe = formatNewCoreProductionTrace(r.events.find(e => e.stage === "new_core_understanding_attempts"));
  assert.equal(safe.totalUnderstandingCalls, 2);
  const text = JSON.stringify(safe);
  for (const field of ["structuredOutput", "correctionInput", "attemptEvidence", "wrong-turn"])
    assert.equal(text.includes(field), false);
});

test("malformed output cannot persist an unrelated password or passphrase", async () => {
  const password = crypto.randomBytes(28).toString("hex");
  const passphrase = crypto.randomBytes(28).toString("hex");
  const output = bad(); output.extra = { password, passphrase };
  const r = await run(output);
  assert.equal(r.error.code, "UNKNOWN_WIRE_FIELD");
  const encoded = JSON.stringify(r.meta.attemptEvidence);
  assert.equal(encoded.includes(password), false);
  assert.equal(encoded.includes(passphrase), false);
});

async function manualRoundTrip(correctSecond) {
  const at = "2026-09-27T12:00:00.000Z";
  const property = { propertyId: "nephi_home", timezone: "Asia/Taipei", displayName: "Diagnostic fixture", rooms: [], commonAnswers: {}, propertyFacts: [] };
  const providers = { customerSettings: { getProperty: () => property, listInventoryPriceOverrides: () => [], listDatePriceClassifications: () => [] } };
  let calls = 0, resolverCalls = 0;
  const service = createNewCoreManualTestService({ providers, service: {}, now: () => new Date(at),
    dispatchMessage: async ({ session, turnId, message }) => {
      const result = await executeNewCoreTurn({ input: { turnId, traceId: "diagnostic-fixture-trace", message, recentConversation: [] },
        state: session.state, scope: session.state.scope, property, now: at, providerConfig: { apiKey: crypto.randomBytes(24).toString("hex") },
        resolver: { availability: () => { resolverCalls++; throw new Error("schema failure cannot reach Resolver"); } },
        understandingProvider: (input, options) => callOpenAIUnderstandingV1(input, { ...options, fetchImpl: async () => {
          const output = f.providerOutput(), event = input.sourceEvents[0]; calls++;
          output.understandingOutput.turnId = correctSecond && calls === 2 ? input.turnId : `wrong-${calls}`;
          const reference = { eventId: event.eventId, messageRef: event.messageRef, startOffset: 0, endOffset: message.length, quote: message };
          output.understandingOutput.units[0].evidenceRefs = [reference];
          output.contextLinkCandidates[0].currentSourceEvidenceRefs = [reference];
          return f.successfulResponse(output);
        } }) });
      return { result: { ...result, traceId: "diagnostic-fixture-trace" }, transport: { kind: "browser" } };
    } });
  const owner = { propertyId: "nephi_home", username: "diagnostic-test" };
  const session = await service.createSession(owner);
  const turn = await service.runTurn(session.testSessionId, owner, { input: "謝謝" });
  return { turn, stored: await service.trace(turn.traceId, owner), calls, resolverCalls,
    foreign: await service.trace(turn.traceId, { propertyId: "other", username: "diagnostic-test" }) };
}

for (const corrected of [false, true]) test(`manual repository retains evidence after ${corrected ? "correction success" : "terminal C02 failure"}`, async () => {
  const r = await manualRoundTrip(corrected);
  assert.equal(r.calls, 2);
  assert.equal(r.resolverCalls, 0);
  assert.equal(r.foreign, null, "diagnostics stay owner/property scoped");
  assert.ok(r.stored.diagnostic.understandingAttempts, "application/manual projection lost attempt evidence");
  assert.deepEqual(r.stored.diagnostic.understandingAttempts, r.turn.diagnostic.understandingAttempts);
  const [a, b] = r.stored.diagnostic.understandingAttempts;
  assert.equal(a.schemaError.actual, "wrong-1");
  assert.equal(b.accepted, corrected);
  assert.equal(b.schemaError?.actual || null, corrected ? null : "wrong-2");
  assert.equal(r.stored.diagnostic.finalResponse.shouldReply, false);
});
