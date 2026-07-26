"use strict";

const assert = require("node:assert/strict");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { ConversationEngineV2Coordinator } = require("../lib/conversation-engine-v2/coordinator");
const { emptyStateV2 } = require("../lib/conversation-engine-v2/state-reducer");
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");
const { normalizePlannerEvidenceCoordinates } = require("../lib/conversation-engine-v2/evidence-normalizer");

const scope = {
  propertyId: "relation-evidence-property",
  channelId: "relation-evidence-channel",
  lineUserId: "relation-evidence-user",
  now: "2026-07-24T00:00:00.000Z"
};

const sourceEvents = [{
  eventId: "event-a",
  messageRef: "message-a",
  messageText: "Need availability"
}];

function task(candidateIndex = 0) {
  return {
    candidateIndex,
    taskId: `task-${candidateIndex}`,
    type: "policy",
    sourceText: "Need availability",
    detailIntent: "general",
    requestedOutputs: ["answer"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    entity: { category: "policy", rawText: "parking", canonicalCandidate: "parking", confidence: 1 },
    stayCandidate: null,
    confidence: 1
  };
}

function plannerOutput({ tasks = [task()], contextRelationCandidates, discourseRelation = "new_request" } = {}) {
  return {
    schemaVersion: 2,
    discourse: { relation: discourseRelation, confidence: 1 },
    stateOperations: [],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks,
    ...(contextRelationCandidates === undefined ? {} : { contextRelationCandidates }),
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "relation evidence contract test"
  };
}

function relation({ candidateIndex = 0, kind = "new_request", refs = [], evidenceRefs = [{ eventId: "event-a", startOffset: 5, endOffset: 17, quote: "availability" }] } = {}) {
  return { candidateIndex, kind, candidateRequestCycleRefs: refs, evidenceRefs };
}

function snapshot() {
  return {
    scope: { propertyId: scope.propertyId, channelId: scope.channelId, userId: scope.lineUserId },
    generatedAt: scope.now,
    cycles: [{ requestCycleId: "cycle-a", requestKind: "policy", status: "active", confirmedInputs: {}, contextReuseExpiresAt: "2026-07-25T00:00:00.000Z" }]
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function protectedState({ cycleStatus = "active", cycleExpiry = "2026-07-25T00:00:00.000Z", stateScope = scope } = {}) {
  const state = emptyStateV2(stateScope);
  state.requestCycles = [{ requestCycleId: "cycle-a", requestKind: "policy", status: cycleStatus,
    confirmedInputs: { stay: { checkIn: "2026-08-06", checkOut: "2026-08-07", nights: 1, guests: 2, searchRange: null }, inventory: { mode: "room_only", entityId: "protected-room", features: [] }, topic: { capabilityType: "price", canonicalId: "protected-price", category: "price", detailIntent: "general", detailFields: [] } },
    contextReuseExpiresAt: cycleExpiry, createdAt: scope.now, updatedAt: scope.now }];
  return state;
}

async function processRejectedCase({ name, output, priorState = protectedState(), events = sourceEvents, expectedReason = "context_relation_invalid", expectedFallbackReason = expectedReason }) {
  let persisted = clone(priorState);
  const logs = [];
  const diagnostics = [];
  let resolverCalls = 0;
  const engine = new ConversationEngineV2({
    planner: { classify: async () => output },
    persistence: {
      getConversationState: () => clone(persisted),
      setConversationState: (_propertyId, _channelId, _userId, state) => { persisted = clone(state); },
      appendMessageLog: (_propertyId, item) => { logs.push(clone(item)); return { reviewId: `review-${logs.length}` }; }
    },
    getProperty: () => ({ propertyId: scope.propertyId, timezone: "Asia/Taipei", rooms: [], commonAnswers: { parkingRule: "Parking is available." } }),
    availabilityResolver: () => { resolverCalls += 1; return { availabilityReliable: true, rooms: [] }; },
    availableDatesResolver: () => { resolverCalls += 1; return { availabilityReliable: true, rooms: [] }; },
    listPriceOverrides: () => [],
    now: () => new Date(scope.now),
    onDiagnostic: (item) => diagnostics.push(item)
  });
  const result = await engine.process({
    customerId: scope.propertyId,
    channelId: scope.channelId,
    lineUserId: scope.lineUserId,
    eventId: events[0].eventId,
    eventTimestamp: scope.now,
    messageText: events.map((event) => event.messageText).join("\n"),
    sourceEvents: events
  });
  assert.deepEqual(persisted, priorState, `${name}: rejected relation/evidence must not mutate persisted state`);
  assert.equal(result.shouldReply, true, `${name}: formal safe degradation must remain delivery-ready`);
  assert.ok(result.replyText.length > 0, `${name}: safe reply must be non-empty`);
  for (const protectedFact of ["2026-08-06", "protected-room", "9999"]) assert.ok(!result.replyText.includes(protectedFact), `${name}: reply must not disclose unapproved fact ${protectedFact}`);
  assert.equal(resolverCalls, 0, `${name}: rejected input must not call a Resolver`);
  assert.ok(logs.length > 0 && logs.every((item) => item.processingStatus !== "processing_failed"), `${name}: safe degradation must not persist processing_failed`);
  assert.equal(logs.at(-1).decisionReason, expectedReason, `${name}: rejection must persist the controlled safety outcome`);
  assert.ok(diagnostics.some((item) => item.stage === "fallback" && item.reasonCode === expectedFallbackReason), `${name}: Engine must reach the formal safety fallback`);
  return { result, persisted, logs, diagnostics, resolverCalls };
}

async function main() {
  const valid = validateUnderstandingContext(plannerOutput({ contextRelationCandidates: [relation()] }), snapshot(), { sourceEvents });
  assert.equal(valid.ok, true, "an explicit candidate relation with exact source evidence is accepted");

  const legacyOnly = validateUnderstandingContext(plannerOutput(), snapshot(), { sourceEvents });
  assert.equal(legacyOnly.ok, false, "legacy discourse.relation must not create a formal relation candidate");

  const badEvidence = { eventId: "planner-event", messageRef: "", startOffset: 99, endOffset: 100, quote: "wrong" };
  const exactSourceTask = { ...task(), sourceText: "availability" };
  const exactSourcePlan = plannerOutput({ tasks: [exactSourceTask], contextRelationCandidates: [relation({ evidenceRefs: [badEvidence] })] });
  const exactSourcePlanBefore = clone(exactSourcePlan);
  const canonicalized = normalizePlannerEvidenceCoordinates(exactSourcePlan, sourceEvents);
  assert.deepEqual(canonicalized.contextRelationCandidates[0].evidenceRefs, [{
    eventId: "event-a",
    messageRef: "message-a",
    startOffset: 5,
    endOffset: 17,
    quote: "availability"
  }], "a unique exact sourceText occurrence must become canonical source coordinates");
  assert.deepEqual(exactSourcePlan, exactSourcePlanBefore, "evidence normalization must not mutate Planner output");
  assert.equal(canonicalized.contextRelationCandidates[0].kind, exactSourcePlan.contextRelationCandidates[0].kind, "normalization must not change relation kind");
  assert.deepEqual(canonicalized.contextRelationCandidates[0].candidateRequestCycleRefs, exactSourcePlan.contextRelationCandidates[0].candidateRequestCycleRefs, "normalization must not change request-cycle references");
  assert.equal(validateUnderstandingContext(canonicalized, snapshot(), { sourceEvents }).ok, true, "canonical evidence must still pass the unchanged validator");

  const eventIdOnlyEvents = [{ eventId: "event-only", messageRef: "", messageText: "availability" }];
  const eventIdOnly = normalizePlannerEvidenceCoordinates(exactSourcePlan, eventIdOnlyEvents);
  assert.deepEqual(eventIdOnly.contextRelationCandidates[0].evidenceRefs[0], {
    eventId: "event-only", messageRef: "", startOffset: 0, endOffset: 12, quote: "availability"
  });
  assert.equal(validateUnderstandingContext(eventIdOnly, snapshot(), { sourceEvents: eventIdOnlyEvents }).ok, true);

  const messageRefOnlyEvents = [{ eventId: "", messageRef: "message-only", messageText: "availability" }];
  const messageRefOnly = normalizePlannerEvidenceCoordinates(exactSourcePlan, messageRefOnlyEvents);
  assert.deepEqual(messageRefOnly.contextRelationCandidates[0].evidenceRefs[0], {
    eventId: "", messageRef: "message-only", startOffset: 0, endOffset: 12, quote: "availability"
  });
  assert.equal(validateUnderstandingContext(messageRefOnly, snapshot(), { sourceEvents: messageRefOnlyEvents }).ok, true);

  for (const unrepairable of [
    {
      name: "sourceText not found",
      output: plannerOutput({ tasks: [{ ...task(), sourceText: "missing" }], contextRelationCandidates: [relation({ evidenceRefs: [badEvidence] })] }),
      events: sourceEvents
    },
    {
      name: "sourceText empty",
      output: plannerOutput({ tasks: [{ ...task(), sourceText: "" }], contextRelationCandidates: [relation({ evidenceRefs: [badEvidence] })] }),
      events: sourceEvents
    },
    {
      name: "sourceText repeated",
      output: exactSourcePlan,
      events: [{ eventId: "repeated", messageRef: "", messageText: "availability availability" }]
    },
    {
      name: "source event not unique",
      output: exactSourcePlan,
      events: [{ eventId: "first", messageRef: "", messageText: "availability" }, { eventId: "second", messageRef: "", messageText: "availability" }]
    },
    {
      name: "source event identifier not unique",
      output: exactSourcePlan,
      events: [{ eventId: "duplicate", messageRef: "", messageText: "availability" }, { eventId: "duplicate", messageRef: "", messageText: "other" }]
    },
    {
      name: "candidateIndex does not exist",
      output: plannerOutput({ contextRelationCandidates: [relation({ candidateIndex: 9, evidenceRefs: [badEvidence] })] }),
      events: sourceEvents
    }
  ]) {
    const before = clone(unrepairable.output);
    const normalized = normalizePlannerEvidenceCoordinates(unrepairable.output, unrepairable.events);
    assert.deepEqual(normalized, before, `${unrepairable.name}: normalization must preserve unrepairable evidence`);
    assert.equal(validateUnderstandingContext(normalized, snapshot(), { sourceEvents: unrepairable.events }).ok, false, `${unrepairable.name}: unchanged validator must reject unrepairable evidence`);
  }

  for (const invalidEvidence of [
    [],
    { eventId: "event-missing", startOffset: 5, endOffset: 17, quote: "availability" },
    { messageRef: "message-missing", startOffset: 5, endOffset: 17, quote: "availability" },
    { eventId: "event-a", startOffset: 17, endOffset: 5, quote: "" },
    { eventId: "event-a", startOffset: 5, endOffset: 99, quote: "availability" },
    { eventId: "event-a", startOffset: 5, endOffset: 17, quote: "different" }
  ]) {
    const checked = validateUnderstandingContext(plannerOutput({ contextRelationCandidates: [relation({ evidenceRefs: [invalidEvidence] })] }), snapshot(), { sourceEvents });
    assert.equal(checked.ok, false, "invalid source event evidence must be rejected");
  }

  const unknownCandidate = validateUnderstandingContext(plannerOutput({ contextRelationCandidates: [relation({ candidateIndex: 1 })] }), snapshot(), { sourceEvents });
  assert.equal(unknownCandidate.ok, false, "a relation must reference an existing request candidateIndex");

  const duplicateCandidate = validateUnderstandingContext(plannerOutput({ tasks: [task(0), task(1)], contextRelationCandidates: [relation({ candidateIndex: 0 }), relation({ candidateIndex: 0 })] }), snapshot(), { sourceEvents });
  assert.equal(duplicateCandidate.ok, false, "two relations cannot control the same request candidate");

  const continuing = plannerOutput({ contextRelationCandidates: [relation({ kind: "supplement_existing", refs: ["cycle-a"] })] });
  for (const invalidSnapshot of [
    { ...snapshot(), cycles: [{ ...snapshot().cycles[0], status: "ended" }] },
    { ...snapshot(), cycles: [{ ...snapshot().cycles[0], status: "expired" }] },
    { ...snapshot(), cycles: [{ ...snapshot().cycles[0], contextReuseExpiresAt: "2026-07-23T00:00:00.000Z" }] },
    { ...snapshot(), scope: { ...snapshot().scope, channelId: "other-channel" } }
  ]) {
    const rejected = validateUnderstandingContext(continuing, invalidSnapshot, { sourceEvents, scope });
    assert.equal(rejected.ok, false, "ended, expired, or scope-mismatched snapshot cycles cannot be referenced");
  }

  const continuingRelation = (overrides = {}) => plannerOutput({
    contextRelationCandidates: [relation({ kind: "supplement_existing", refs: ["cycle-a"], ...overrides })]
  });
  const unrepairableContinuingRelation = (overrides = {}) => plannerOutput({
    tasks: [{ ...task(), sourceText: "not present in source events" }],
    contextRelationCandidates: [relation({ kind: "supplement_existing", refs: ["cycle-a"], ...overrides })]
  });
  const burstEvents = [
    { eventId: "burst-a", messageRef: "message-burst-a", messageText: "Need" },
    { eventId: "burst-b", messageRef: "message-burst-b", messageText: "Second" }
  ];
  const rejectionCases = [
    { name: "missing explicit relation", output: plannerOutput(), expectedReason: "planner_invalid", expectedFallbackReason: "planner_schema_invalid" },
    { name: "snapshot outside cycle", output: continuingRelation({ refs: ["cycle-outside"] }) },
    { name: "ended cycle", output: continuingRelation(), priorState: protectedState({ cycleStatus: "ended" }) },
    { name: "expired cycle", output: continuingRelation(), priorState: protectedState({ cycleExpiry: "2026-07-23T00:00:00.000Z" }) },
    { name: "property scope mismatch", output: continuingRelation(), priorState: protectedState({ stateScope: { ...scope, propertyId: "other-property" } }) },
    { name: "channel scope mismatch", output: continuingRelation(), priorState: protectedState({ stateScope: { ...scope, channelId: "other-channel" } }) },
    { name: "user scope mismatch", output: continuingRelation(), priorState: protectedState({ stateScope: { ...scope, lineUserId: "other-user" } }) },
    { name: "wrong eventId", output: unrepairableContinuingRelation({ evidenceRefs: [{ eventId: "event-missing", startOffset: 5, endOffset: 17, quote: "availability" }] }) },
    { name: "wrong messageRef", output: unrepairableContinuingRelation({ evidenceRefs: [{ messageRef: "message-missing", startOffset: 5, endOffset: 17, quote: "availability" }] }) },
    { name: "out of bounds offset", output: unrepairableContinuingRelation({ evidenceRefs: [{ eventId: "event-a", startOffset: 5, endOffset: 99, quote: "availability" }] }) },
    { name: "inverted offset", output: unrepairableContinuingRelation({ evidenceRefs: [{ eventId: "event-a", startOffset: 17, endOffset: 5, quote: "" }] }) },
    { name: "quote mismatch", output: unrepairableContinuingRelation({ evidenceRefs: [{ eventId: "event-a", startOffset: 5, endOffset: 17, quote: "different" }] }) },
    { name: "unknown candidateIndex", output: plannerOutput({ contextRelationCandidates: [relation({ candidateIndex: 1, kind: "supplement_existing", refs: ["cycle-a"] })] }) },
    { name: "duplicate candidateIndex", output: plannerOutput({ tasks: [task(0), task(1)], contextRelationCandidates: [relation({ candidateIndex: 0, kind: "supplement_existing", refs: ["cycle-a"] }), relation({ candidateIndex: 0, kind: "supplement_existing", refs: ["cycle-a"] })] }) },
    { name: "burst wrong source", output: continuingRelation({ evidenceRefs: [{ eventId: "burst-a", startOffset: 0, endOffset: 6, quote: "Second" }] }), events: burstEvents }
  ];
  for (const rejectionCase of rejectionCases) {
    await processRejectedCase(rejectionCase);
    console.log(`Engine rejection: ${rejectionCase.name}: PASS`);
  }

  const burstDiagnostics = [];
  const burstPlanner = plannerOutput({
    tasks: [task(0), { ...task(1), sourceText: "Second" }],
    contextRelationCandidates: [
      relation({ candidateIndex: 0, evidenceRefs: [{ eventId: "burst-a", startOffset: 0, endOffset: 4, quote: "Need" }] }),
      relation({ candidateIndex: 1, evidenceRefs: [{ eventId: "burst-b", startOffset: 0, endOffset: 6, quote: "Second" }] })
    ]
  });
  let burstState = emptyStateV2(scope);
  const burstStateBefore = clone(burstState);
  let burstResolverCalls = 0;
  const burstEngine = new ConversationEngineV2({
    planner: { classify: async () => burstPlanner },
    persistence: {
      getConversationState: () => clone(burstState),
      setConversationState: (_propertyId, _channelId, _userId, state) => { burstState = clone(state); },
      appendMessageLog: () => ({ reviewId: "burst-review" })
    },
    getProperty: () => ({ propertyId: scope.propertyId, timezone: "Asia/Taipei", rooms: [], commonAnswers: { parkingRule: "Parking is available." } }),
    availabilityResolver: () => { burstResolverCalls += 1; return { availabilityReliable: true, rooms: [] }; },
    availableDatesResolver: () => { burstResolverCalls += 1; return { availabilityReliable: true, rooms: [] }; },
    listPriceOverrides: () => [],
    now: () => new Date(scope.now),
    onDiagnostic: (item) => burstDiagnostics.push(item)
  });
  let scheduled = null;
  const coordinator = new ConversationEngineV2Coordinator({ engine: burstEngine, externalReplyToken: true, schedule: (run) => { scheduled = run; return 1; }, cancel: () => {} });
  const first = coordinator.enqueue({ customerId: scope.propertyId, channelId: scope.channelId, lineUserId: scope.lineUserId, eventId: "burst-a", messageRef: "message-burst-a", eventTimestamp: scope.now, messageText: "Need" });
  const second = coordinator.enqueue({ customerId: scope.propertyId, channelId: scope.channelId, lineUserId: scope.lineUserId, eventId: "burst-b", messageRef: "message-burst-b", eventTimestamp: scope.now, messageText: "Second" });
  await scheduled();
  const [firstResult, burstResult] = await Promise.all([first, second]);
  assert.ok(burstDiagnostics.length > 0, "a merged burst must enter the engine once");
  assert.ok(burstDiagnostics.every((item) => JSON.stringify(item.sourceEventIds) === JSON.stringify(["burst-a", "burst-b"])), "every burst trace record must retain all source event IDs");
  assert.equal(firstResult.merged, true, "only the trailing event receives the merged-burst result");
  assert.equal(burstResult.shouldReply, true, "valid multi-event evidence must continue through the Engine");
  assert.equal(burstResolverCalls, 0, "policy facts in a burst must not cause unrelated Resolver queries");
  assert.equal(burstStateBefore.requestCycles.length, 0);
  assert.equal(burstState.requestCycles.length, 2, "each explicitly related burst candidate must receive an isolated cycle");
  assert.notEqual(burstState.requestCycles[0].requestCycleId, burstState.requestCycles[1].requestCycleId, "burst candidates must not overwrite one another");
  const acceptedBurst = burstDiagnostics.find((item) => item.stage === "context_validation");
  assert.deepEqual(acceptedBurst.acceptedRelations.map((item) => item.evidenceRefs[0].eventId), ["burst-a", "burst-b"], "each burst relation must retain its own source event");
  assert.equal(burstDiagnostics.some((item) => item.stage === "fallback"), false, "valid burst evidence must not enter the safety fallback");
  console.log("Engine burst valid evidence: PASS");

  console.log("relation evidence contract: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
