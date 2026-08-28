"use strict";

const assert = require("node:assert/strict");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const {
  createShadowComparisonRecord,
  validateShadowComparisonRecord
} = require("../lib/new-core/shadow-comparator");
const { runReadOnlyShadowCore } = require("../lib/new-core/shadow-core");

const NOW = "2026-08-29T08:00:00.000Z";
const CORE_SHA = "58f83ba08d7d1bfcf28fea4330ec35d760dfa006";
const MESSAGE = "停車資訊，謝謝，private-guest-fragment";

function turnInput(propertyId = "property-shadow-a") {
  return buildUnderstandingTurnInput({
    coreVersion: "new-core-v1",
    traceId: `trace-shadow-${propertyId}`,
    turnId: `turn-shadow-${propertyId}`,
    verifiedPropertyBinding: { propertyId, channel: "line-shadow" },
    verifiedConversationScope: { channel: "line-shadow", userId: "guest-shadow" },
    sourceEvents: [{
      eventId: "event-shadow",
      messageRef: "message-shadow",
      role: "guest",
      timestamp: NOW,
      messageKind: "text",
      messageText: MESSAGE
    }],
    recentConversation: [{
      eventId: "history-shadow",
      messageRef: "history-message-shadow",
      role: "assistant",
      timestamp: "2026-08-29T07:59:00.000Z",
      messageKind: "text",
      messageText: "bounded-history-fragment",
      referenceableCycleIds: ["cycle-shadow"]
    }],
    stateV3Snapshot: {
      scope: { propertyId, channel: "line-shadow", userId: "guest-shadow" },
      referenceableCycles: [{
        requestCycleId: "cycle-shadow",
        status: "active",
        expiresAt: "2026-08-30T08:00:00.000Z",
        slotRefs: []
      }]
    },
    publicCatalog: {
      propertyId,
      timezone: "Asia/Taipei",
      capabilityCatalog: ["property_fact"],
      publicSubjectCatalog: [{
        catalogIdentity: "parking-shadow",
        kind: "amenity",
        propertyId,
        publicName: "Parking"
      }]
    }
  });
}

function evidence(startOffset, endOffset, quote) {
  return {
    eventId: "event-shadow",
    messageRef: "message-shadow",
    startOffset,
    endOffset,
    quote
  };
}

function semanticUnit(overrides = {}) {
  return {
    unitId: "unit-answer",
    evidenceRefs: [evidence(0, 4, "停車資訊")],
    purpose: "lodging_question",
    capability: "property_fact",
    subject: { kind: "amenity", catalogIdentity: "parking-shadow" },
    stayDependent: false,
    temporalCandidate: null,
    contextLinkCandidateId: "link-answer",
    replyCandidate: { disposition: "ANSWER", reasonClass: "lodging_need" },
    slotCandidates: [],
    confidenceBand: "high",
    ...overrides
  };
}

function acknowledgementUnit() {
  return semanticUnit({
    unitId: "unit-ack",
    evidenceRefs: [evidence(5, 7, "謝謝")],
    purpose: "acknowledgement",
    capability: null,
    subject: { kind: null, catalogIdentity: null },
    contextLinkCandidateId: "link-ack",
    replyCandidate: { disposition: "NO_REPLY", reasonClass: "acknowledgement" }
  });
}

function failedUnit() {
  return semanticUnit({
    unitId: "unit-failed",
    evidenceRefs: [evidence(8, 16, "not-there")],
    contextLinkCandidateId: "link-failed"
  });
}

function link(unit, overrides = {}) {
  return {
    contextLinkCandidateId: unit.contextLinkCandidateId,
    unitId: unit.unitId,
    actionCandidate: unit.purpose === "acknowledgement" ? "NONE" : "START",
    targetRequestCycleId: null,
    evidenceRefs: unit.evidenceRefs,
    ...overrides
  };
}

function providerPayload({ includeFailure = true, crossProperty = false } = {}) {
  const answer = semanticUnit(crossProperty
    ? { subject: { kind: "amenity", catalogIdentity: "parking-property-b" } }
    : {});
  const ack = acknowledgementUnit();
  const invalid = failedUnit();
  const units = includeFailure ? [answer, invalid, ack] : [answer, ack];
  return {
    understandingOutput: {
      schemaVersion: 1,
      turnId: "turn-shadow-property-shadow-a",
      units
    },
    contextLinkCandidates: units.map((unit) => link(unit))
  };
}

function structuredResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "req-shadow" },
    text: async () => JSON.stringify({
      status: "completed",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(payload) }]
      }]
    })
  };
}

function understandingOptions(payload) {
  return {
    apiKey: "test-only-key",
    model: "gpt-4.1-mini",
    fetchImpl: async () => structuredResponse(payload),
    retryDelayMs: 0,
    waitImpl: async () => undefined,
    nowMs: () => Date.parse(NOW),
    timeoutMs: 100,
    roundTimeoutMs: 250
  };
}

function oldSummary() {
  return {
    semanticUnits: [{
      unitId: "old-unit-answer",
      purpose: "lodging_question",
      capability: "property_fact",
      subjectKind: "amenity",
      stayDependent: false,
      status: "VALIDATED",
      failureCode: null,
      guestText: "must-not-survive"
    }],
    routes: [{
      unitId: "old-unit-answer",
      disposition: "ANSWER",
      requiresCanonicalExecution: true,
      status: "VALIDATED",
      failureCode: null
    }],
    lifecycles: [{
      unitId: "old-unit-answer",
      action: "START",
      slotOperationCount: 0,
      status: "VALIDATED",
      failureCode: null
    }],
    canonicalItems: [{
      unitId: "old-unit-answer",
      capability: "property_fact",
      subjectKind: "amenity",
      stayDependent: false,
      temporalKind: null,
      slotOperationCount: 0,
      status: "ACCEPTED",
      failureCode: null,
      facts: [{ text: "must-not-survive" }]
    }]
  };
}

function sideEffectTrap() {
  const counters = { state: 0, message: 0, review: 0, resolver: 0, postgres: 0, line: 0 };
  const dependencyNames = {
    stateWriter: "state",
    messageWriter: "message",
    reviewWriter: "review",
    resolver: "resolver",
    postgres: "postgres",
    lineTransport: "line"
  };
  const capabilities = {};
  for (const [name, counter] of Object.entries(dependencyNames)) {
    Object.defineProperty(capabilities, name, {
      enumerable: true,
      get() {
        counters[counter] += 1;
        throw new Error(`forbidden capability accessed: ${name}`);
      }
    });
  }
  return { counters, capabilities };
}

function trappedDependencies(trap, values = {}) {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(trap.capabilities, key, {
      enumerable: true,
      configurable: false,
      writable: false,
      value
    });
  }
  return trap.capabilities;
}

function assertZeroSideEffects(counters) {
  assert.deepEqual(counters, { state: 0, message: 0, review: 0, resolver: 0, postgres: 0, line: 0 });
}

async function runShadowIsolationAcceptance() {
  const input = turnInput();
  const inputBefore = JSON.stringify(input);
  const old = oldSummary();
  const oldBefore = JSON.stringify(old);
  const trap = sideEffectTrap();

  // AC-SHD-001..007: Task 11 and Tasks 6-9 run without any writer,
  // Resolver, PostgreSQL, or LINE capability being present on the callable
  // dependency surface. Success and a failed sibling both preserve zero use.
  const record = await runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    timeoutMs: 500,
    dependencies: trappedDependencies(trap, {
      understandingOptions: understandingOptions(providerPayload())
    })
  });
  assert.equal(validateShadowComparisonRecord(record).ok, true);
  assert.equal(record.status, "PARTIAL", JSON.stringify(record));
  assert.deepEqual(record.sideEffectCounters, {
    stateWrites: 0,
    messageWrites: 0,
    reviewWrites: 0,
    resolverCalls: 0,
    postgresMutations: 0,
    lineCalls: 0
  });
  assertZeroSideEffects(trap.counters);
  assert.equal(JSON.stringify(input), inputBefore, "C01 and its bounded snapshots must remain unchanged");
  assert.equal(JSON.stringify(old), oldBefore, "old-core summary must remain unchanged");
  assert.equal(record.newCoreSummary.semanticUnits.length, 2, "valid siblings must survive a failed unit");
  assert.equal(record.newCoreSummary.canonicalItems.length, 1);
  assert.equal(record.failureCodes.includes("EVIDENCE_QUOTE_MISMATCH"), true);

  const successTrap = sideEffectTrap();
  const successful = await runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    dependencies: trappedDependencies(successTrap, {
      understandingOptions: understandingOptions(providerPayload({ includeFailure: false }))
    })
  });
  assert.equal(successful.status, "SUCCESS");
  assertZeroSideEffects(successTrap.counters);
  assert.deepEqual(successful.sideEffectCounters, record.sideEffectCounters);

  let nestedDiagnosticSinkCalls = 0;
  const nestedCallback = await runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    dependencies: {
      understandingOptions: {
        ...understandingOptions(providerPayload({ includeFailure: false })),
        onDiagnostic: () => { nestedDiagnosticSinkCalls += 1; }
      }
    }
  });
  assert.equal(nestedCallback.status, "SUCCESS");
  assert.equal(nestedDiagnosticSinkCalls, 0, "shadow must remove nested diagnostic sinks");

  // AC-SHD-008: the closed C10 projection carries hashes and bounded enums,
  // never raw guest/history text, evidence quotes, facts, or property IDs.
  const serialized = JSON.stringify(record);
  for (const forbidden of [
    MESSAGE,
    "private-guest-fragment",
    "bounded-history-fragment",
    "must-not-survive",
    "property-shadow-a",
    "停車資訊",
    "謝謝"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `C10 leaked ${forbidden}`);
  }
  assert.match(record.traceHash, /^h:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.newCoreSummary), true);

  // AC-SHD-009: semantic/route/lifecycle/C08 comparisons are all present and
  // independently summarized; differing old/new unit counts remain explicit.
  assert.deepEqual(Object.keys(record.diffSummary).sort(), [
    "canonicalItems", "lifecycles", "routes", "semanticUnits"
  ]);
  assert.equal(record.diffSummary.canonicalItems.match, true);
  assert.equal(record.diffSummary.semanticUnits.match, false);
  assert.equal(record.diffSummary.semanticUnits.newCount, 2);
  assert.equal(record.diffSummary.semanticUnits.oldCount, 1);

  // AC-SHD-010: an understanding exception cannot escape into or influence
  // the old core; it produces a valid, sanitized failed C10 record.
  const failureTrap = sideEffectTrap();
  const failingOptions = understandingOptions(providerPayload({ includeFailure: false }));
  failingOptions.fetchImpl = async () => { throw new Error(MESSAGE); };
  const failed = await runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    dependencies: trappedDependencies(failureTrap, {
      understandingOptions: failingOptions
    })
  });
  assert.equal(validateShadowComparisonRecord(failed).ok, true);
  assert.equal(failed.status, "FAILED");
  assert.deepEqual(failed.failureCodes, ["UNDERSTANDING_SCHEMA_INVALID"]);
  assert.equal(JSON.stringify(failed).includes(MESSAGE), false);
  assertZeroSideEffects(failureTrap.counters);

  // Timeout is bounded, sanitized, and side-effect neutral.
  const timeoutTrap = sideEffectTrap();
  let activeTimeoutAttempts = 0;
  let postReturnWork = 0;
  let timeoutReturned = false;
  const timeoutOptions = understandingOptions(providerPayload({ includeFailure: false }));
  timeoutOptions.fetchImpl = async (_url, request) => new Promise((resolve, reject) => {
    activeTimeoutAttempts += 1;
    const lateTimer = setTimeout(() => {
      activeTimeoutAttempts -= 1;
      if (timeoutReturned) postReturnWork += 1;
      resolve(structuredResponse(providerPayload({ includeFailure: false })));
    }, 100);
    request.signal.addEventListener("abort", () => {
      clearTimeout(lateTimer);
      activeTimeoutAttempts -= 1;
      const error = new Error("aborted test transport");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const started = Date.now();
  const timedOut = await runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    timeoutMs: 20,
    dependencies: trappedDependencies(timeoutTrap, {
      understandingOptions: timeoutOptions
    })
  });
  timeoutReturned = true;
  assert.equal(Date.now() - started < 500, true, "shadow timeout must be bounded");
  assert.equal(timedOut.status, "FAILED");
  assert.deepEqual(timedOut.failureCodes, ["UNDERSTANDING_PROVIDER_TIMEOUT"]);
  assert.equal(activeTimeoutAttempts, 0, "timeout must settle every Task 11 transport attempt before return");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(postReturnWork, 0, "timeout must leave no post-return shadow work");
  assertZeroSideEffects(timeoutTrap.counters);

  // Property isolation: a property-B catalog identity in a property-A C01 is
  // rejected at C03, while C10 contains no property identity or foreign fact.
  const isolated = await runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: {},
    coreSha: CORE_SHA,
    dependencies: {
      understandingOptions: understandingOptions(providerPayload({ crossProperty: true, includeFailure: false }))
    }
  });
  assert.equal(isolated.failureCodes.includes("CATALOG_IDENTITY_INVALID"), true);
  assert.equal(JSON.stringify(isolated).includes("parking-property-b"), false);
  assert.equal(JSON.stringify(isolated).includes("property-shadow-a"), false);

  // The comparator rejects a non-zero counter and unsafe hand-built records;
  // it cannot launder a side-effect attempt or arbitrary raw field into C10.
  const unsafeCounter = createShadowComparisonRecord({
    coreVersion: "new-core-v1",
    coreSha: CORE_SHA,
    traceId: input.traceId,
    oldCoreOutcomeSummary: {},
    newCoreOutcomeSummary: {},
    validationCodes: [],
    failureCodes: [],
    sideEffectCounters: {
      stateWrites: 1,
      messageWrites: 0,
      reviewWrites: 0,
      resolverCalls: 0,
      postgresMutations: 0,
      lineCalls: 0
    }
  });
  assert.equal(unsafeCounter.ok, false);
  assert.equal(unsafeCounter.code, "SHADOW_SIDE_EFFECT_ATTEMPT");
  const unsafeMarker = createShadowComparisonRecord({
    coreVersion: "new-core-v1",
    coreSha: CORE_SHA,
    traceId: input.traceId,
    oldCoreOutcomeSummary: {},
    newCoreOutcomeSummary: {},
    validationCodes: ["C01_PROPERTY_SECRET"],
    failureCodes: [],
    sideEffectCounters: record.sideEffectCounters
  });
  assert.equal(unsafeMarker.ok, false);
  assert.equal(unsafeMarker.code, "SHADOW_RECORD_UNSAFE");
  assert.equal(validateShadowComparisonRecord({ ...record, guestText: MESSAGE }).code, "SHADOW_RECORD_UNSAFE");

  console.log(JSON.stringify({
    suite: "new-core-shadow-isolation",
    classification: "RUNTIME_COMPONENT_TEST",
    caseCount: 19,
    status: "PASS",
    sideEffectCounters: record.sideEffectCounters
  }));
}

runShadowIsolationAcceptance().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
