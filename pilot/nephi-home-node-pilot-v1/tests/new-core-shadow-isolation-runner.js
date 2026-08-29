"use strict";

const assert = require("node:assert/strict");
const { buildUnderstandingTurnInput } = require("../lib/new-core/turn-input-adapter");
const {
  createShadowComparisonRecord,
  validateShadowComparisonRecord
} = require("../lib/new-core/shadow-comparator");
const {
  OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC,
  callOpenAIUnderstandingV1
} = require("../lib/providers/openai-understanding-v1");
const {
  assembleReadOnlyShadowComparison,
  runReadOnlyShadowCore
} = require("../lib/new-core/shadow-core");

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
      unitId: "unit-answer",
      purpose: "lodging_question",
      capability: "property_fact",
      subjectKind: "amenity",
      stayDependent: false,
      status: "VALIDATED",
      failureCode: null
    }],
    routes: [{
      unitId: "unit-answer",
      disposition: "ANSWER",
      requiresCanonicalExecution: true,
      status: "VALIDATED",
      failureCode: null
    }],
    lifecycles: [{
      unitId: "unit-answer",
      action: "START",
      slotOperationCount: 0,
      status: "VALIDATED",
      failureCode: null
    }],
    canonicalItems: [{
      unitId: "unit-answer",
      capability: "property_fact",
      subjectKind: "amenity",
      stayDependent: false,
      temporalKind: null,
      slotOperationCount: 0,
      status: "ACCEPTED",
      failureCode: null
    }]
  };
}

function emptySummary() {
  return { semanticUnits: [], routes: [], lifecycles: [], canonicalItems: [] };
}

async function fakeUnderstanding(payload, input) {
  return callOpenAIUnderstandingV1(input, understandingOptions(payload));
}

async function assembleFake(payload, oldCoreOutcomeSummary = oldSummary(), input = turnInput()) {
  const understandingResult = await fakeUnderstanding(payload, input);
  return assembleReadOnlyShadowComparison({
    understandingTurnInput: input,
    oldCoreOutcomeSummary,
    coreSha: CORE_SHA,
    understandingResult
  });
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
  const record = await assembleFake(providerPayload(), old, input);
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
  assert.equal(record.newCoreSummary.canonicalItems.length, 1, JSON.stringify(record));
  assert.equal(record.failureCodes.includes("EVIDENCE_QUOTE_MISMATCH"), true);

  const successTrap = sideEffectTrap();
  const successful = await assembleFake(providerPayload({ includeFailure: false }), old);
  assert.equal(successful.status, "SUCCESS");
  assertZeroSideEffects(successTrap.counters);
  assert.deepEqual(successful.sideEffectCounters, record.sideEffectCounters);

  // AC-SHD-008: the closed C10 projection carries hashes and bounded enums,
  // never raw guest/history text, evidence quotes, facts, or property IDs.
  const serialized = JSON.stringify(record);
  for (const forbidden of [
    MESSAGE,
    "private-guest-fragment",
    "bounded-history-fragment",
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
  const failed = assembleReadOnlyShadowComparison({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    understandingResult: { guestText: MESSAGE }
  });
  assert.equal(validateShadowComparisonRecord(failed).ok, true);
  assert.equal(failed.status, "FAILED");
  assert.deepEqual(failed.failureCodes, ["SHADOW_COMPARISON_INCOMPLETE"]);
  assert.equal(JSON.stringify(failed).includes(MESSAGE), false);
  assertZeroSideEffects(failureTrap.counters);

  let forgedAccessorReads = 0;
  const forgedUnderstandingResult = {};
  for (const field of ["validatedUnits", "validatedContextLinks", "failedUnits"]) {
    Object.defineProperty(forgedUnderstandingResult, field, {
      enumerable: true,
      get() {
        forgedAccessorReads += 1;
        return [];
      }
    });
  }
  Object.defineProperty(
    forgedUnderstandingResult,
    OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC,
    { value: Object.freeze({ providerAttemptCount: 1 }) }
  );
  const rejectedForgedResult = assembleReadOnlyShadowComparison({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    understandingResult: forgedUnderstandingResult
  });
  assert.equal(rejectedForgedResult.status, "FAILED");
  assert.deepEqual(rejectedForgedResult.failureCodes, ["SHADOW_COMPARISON_INCOMPLETE"]);
  assert.equal(forgedAccessorReads, 0, "shadow must reject forged provenance before field access");

  // Property isolation: a property-B catalog identity in a property-A C01 is
  // rejected at C03, while C10 contains no property identity or foreign fact.
  const isolated = await assembleFake(
    providerPayload({ crossProperty: true, includeFailure: false }),
    emptySummary()
  );
  assert.equal(isolated.failureCodes.includes("CATALOG_IDENTITY_INVALID"), true);
  assert.equal(JSON.stringify(isolated).includes("parking-property-b"), false);
  assert.equal(JSON.stringify(isolated).includes("property-shadow-a"), false);

  // The comparator rejects a non-zero counter and unsafe hand-built records;
  // it cannot launder a side-effect attempt or arbitrary raw field into C10.
  const unsafeCounter = createShadowComparisonRecord({
    coreVersion: "new-core-v1",
    coreSha: CORE_SHA,
    traceId: input.traceId,
    oldCoreOutcomeSummary: emptySummary(),
    newCoreOutcomeSummary: emptySummary(),
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
    oldCoreOutcomeSummary: emptySummary(),
    newCoreOutcomeSummary: emptySummary(),
    validationCodes: ["C01_PROPERTY_SECRET"],
    failureCodes: [],
    sideEffectCounters: record.sideEffectCounters
  });
  assert.equal(unsafeMarker.ok, false);
  assert.equal(unsafeMarker.code, "SHADOW_RECORD_UNSAFE");
  assert.equal(validateShadowComparisonRecord({ ...record, guestText: MESSAGE }).code, "SHADOW_RECORD_UNSAFE");

  // Review fix probes: the production entry point has no caller-controlled
  // provider transport seam, tuple ownership participates in comparison, and
  // incomplete source summaries fail closed rather than becoming empty arrays.
  let callerTransportCalls = 0;
  const adversarialTrap = sideEffectTrap();
  const rejectedTransportSeam = await runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    providerConfig: {
      apiKey: "test-only-key",
      model: "gpt-4.1-mini",
      fetchImpl: async () => {
        callerTransportCalls += 1;
        return structuredResponse(providerPayload({ includeFailure: false }));
      }
    }
  });
  assert.equal(callerTransportCalls, 0, "production shadow must not invoke a caller transport");
  assert.deepEqual(rejectedTransportSeam, {
    ok: false,
    code: "SHADOW_COMPARISON_INCOMPLETE"
  });
  const rejectedAdversarialCapabilities = await runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    dependencies: trappedDependencies(adversarialTrap)
  });
  assert.deepEqual(rejectedAdversarialCapabilities, rejectedTransportSeam);
  assertZeroSideEffects(adversarialTrap.counters);

  let providerGetterCalls = 0;
  const accessorProviderConfig = { model: "gpt-4.1-mini" };
  Object.defineProperty(accessorProviderConfig, "apiKey", {
    enumerable: true,
    get() {
      providerGetterCalls += 1;
      throw new Error("provider getter must never execute");
    }
  });
  const rejectedAccessorConfig = await runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    providerConfig: accessorProviderConfig
  });
  assert.deepEqual(rejectedAccessorConfig, rejectedTransportSeam);
  assert.equal(providerGetterCalls, 0);

  let providerProxyTrapCalls = 0;
  const proxyProviderConfig = new Proxy({
    apiKey: "test-only-key",
    model: "gpt-4.1-mini"
  }, {
    ownKeys(target) {
      providerProxyTrapCalls += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
      providerProxyTrapCalls += 1;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    get(target, property, receiver) {
      providerProxyTrapCalls += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  const rejectedProxyConfig = await runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary: old,
    coreSha: CORE_SHA,
    providerConfig: proxyProviderConfig
  });
  assert.deepEqual(rejectedProxyConfig, rejectedTransportSeam);
  assert.equal(providerProxyTrapCalls, 0, "proxy configs must reject without callback traps");

  const originalGlobalFetch = globalThis.fetch;
  let hostileSummaryProviderCalls = 0;
  globalThis.fetch = async () => {
    hostileSummaryProviderCalls += 1;
    return structuredResponse(providerPayload({ includeFailure: false }));
  };
  const runHostileOldSummary = (oldCoreOutcomeSummary) => runReadOnlyShadowCore({
    understandingTurnInput: input,
    oldCoreOutcomeSummary,
    coreSha: CORE_SHA,
    providerConfig: { apiKey: "test-only-key", model: "gpt-4.1-mini" }
  });
  const assertSanitizedOldSummaryFailure = (value) => {
    assert.equal(validateShadowComparisonRecord(value).ok, true, JSON.stringify(value));
    assert.equal(value.status, "FAILED");
    assert.deepEqual(value.failureCodes, ["SHADOW_COMPARISON_INCOMPLETE"]);
    assert.deepEqual(value.sideEffectCounters, record.sideEffectCounters);
  };
  try {
    let outerOldAccessorCalls = 0;
    const outerAccessorOld = oldSummary();
    Object.defineProperty(outerAccessorOld, "routes", {
      enumerable: true,
      get() {
        outerOldAccessorCalls += 1;
        throw new Error("outer old-summary getter must not execute");
      }
    });
    assertSanitizedOldSummaryFailure(await runHostileOldSummary(outerAccessorOld));
    assert.equal(outerOldAccessorCalls, 0);

    let nestedOldAccessorCalls = 0;
    const nestedAccessorOld = oldSummary();
    Object.defineProperty(nestedAccessorOld.routes[0], "disposition", {
      enumerable: true,
      get() {
        nestedOldAccessorCalls += 1;
        throw new Error("nested old-summary getter must not execute");
      }
    });
    assertSanitizedOldSummaryFailure(await runHostileOldSummary(nestedAccessorOld));
    assert.equal(nestedOldAccessorCalls, 0);

    let oldProxyTrapCalls = 0;
    const oldProxyHandler = {
      ownKeys(target) {
        oldProxyTrapCalls += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        oldProxyTrapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        oldProxyTrapCalls += 1;
        return Reflect.getPrototypeOf(target);
      },
      get(target, property, receiver) {
        oldProxyTrapCalls += 1;
        return Reflect.get(target, property, receiver);
      }
    };
    assertSanitizedOldSummaryFailure(await runHostileOldSummary(
      new Proxy(oldSummary(), oldProxyHandler)
    ));
    const nestedProxyOld = oldSummary();
    nestedProxyOld.routes[0] = new Proxy(nestedProxyOld.routes[0], oldProxyHandler);
    assertSanitizedOldSummaryFailure(await runHostileOldSummary(nestedProxyOld));
    assert.equal(oldProxyTrapCalls, 0, "old-summary proxies must reject before traps");

    const cyclicOld = oldSummary();
    cyclicOld.self = cyclicOld;
    assertSanitizedOldSummaryFailure(await runHostileOldSummary(cyclicOld));
    const executableOld = oldSummary();
    executableOld.routes[0].callback = () => MESSAGE;
    executableOld[Symbol("unsafe-old-summary")] = MESSAGE;
    const rejectedExecutableOld = await runHostileOldSummary(executableOld);
    assertSanitizedOldSummaryFailure(rejectedExecutableOld);
    assert.equal(JSON.stringify(rejectedExecutableOld).includes(MESSAGE), false);
  } finally {
    globalThis.fetch = originalGlobalFetch;
  }
  assert.equal(hostileSummaryProviderCalls, 0,
    "invalid old summaries must reject before the official Task 11 transport");

  const ownedA = oldSummary();
  ownedA.semanticUnits.push({
    ...ownedA.semanticUnits[0],
    unitId: "unit-b",
    capability: "amenity"
  });
  ownedA.routes.push({ ...ownedA.routes[0], unitId: "unit-b", disposition: "HANDOFF" });
  ownedA.lifecycles.push({ ...ownedA.lifecycles[0], unitId: "unit-b", action: "END" });
  ownedA.canonicalItems.push({
    ...ownedA.canonicalItems[0],
    unitId: "unit-b",
    capability: "amenity"
  });
  const ownedB = JSON.parse(JSON.stringify(ownedA));
  ownedB.routes[0].disposition = "HANDOFF";
  ownedB.routes[1].disposition = "ANSWER";
  ownedB.lifecycles[0].action = "END";
  ownedB.lifecycles[1].action = "START";
  ownedB.canonicalItems[0].capability = "amenity";
  ownedB.canonicalItems[1].capability = "property_fact";
  const swappedOwnership = createShadowComparisonRecord({
    coreVersion: "new-core-v1",
    coreSha: CORE_SHA,
    traceId: input.traceId,
    oldCoreOutcomeSummary: ownedA,
    newCoreOutcomeSummary: ownedB,
    validationCodes: [],
    failureCodes: [],
    sideEffectCounters: record.sideEffectCounters
  });
  assert.equal(swappedOwnership.ok, true);
  assert.equal(swappedOwnership.value.diffSummary.routes.match, false,
    "route values swapped across unit owners must mismatch");
  assert.equal(swappedOwnership.value.diffSummary.lifecycles.match, false,
    "lifecycle values swapped across unit owners must mismatch");
  assert.equal(swappedOwnership.value.diffSummary.canonicalItems.match, false,
    "canonical values swapped across unit owners must mismatch");

  const missingSummaryField = createShadowComparisonRecord({
    coreVersion: "new-core-v1",
    coreSha: CORE_SHA,
    traceId: input.traceId,
    oldCoreOutcomeSummary: { semanticUnits: [], routes: [], lifecycles: [] },
    newCoreOutcomeSummary: emptySummary(),
    validationCodes: [],
    failureCodes: [],
    sideEffectCounters: record.sideEffectCounters
  });
  assert.equal(missingSummaryField.ok, false);
  assert.equal(missingSummaryField.code, "SHADOW_COMPARISON_INCOMPLETE");

  const malformedSummaryEntry = createShadowComparisonRecord({
    coreVersion: "new-core-v1",
    coreSha: CORE_SHA,
    traceId: input.traceId,
    oldCoreOutcomeSummary: {
      semanticUnits: [{ unitId: "unit-a", purpose: "lodging_question" }],
      routes: [],
      lifecycles: [],
      canonicalItems: []
    },
    newCoreOutcomeSummary: emptySummary(),
    validationCodes: [],
    failureCodes: [],
    sideEffectCounters: record.sideEffectCounters
  });
  assert.equal(malformedSummaryEntry.ok, false);
  assert.equal(malformedSummaryEntry.code, "SHADOW_COMPARISON_INCOMPLETE");
  const malformedClosedRecord = JSON.parse(JSON.stringify(record));
  delete malformedClosedRecord.newCoreSummary.routes[0].disposition;
  assert.equal(
    validateShadowComparisonRecord(malformedClosedRecord).code,
    "SHADOW_COMPARISON_INCOMPLETE"
  );

  console.log(JSON.stringify({
    suite: "new-core-shadow-isolation",
    classification: "FAKE_INTEGRATION",
    caseCount: 41,
    status: "PASS",
    sideEffectCounters: record.sideEffectCounters
  }));
}

runShadowIsolationAcceptance().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
