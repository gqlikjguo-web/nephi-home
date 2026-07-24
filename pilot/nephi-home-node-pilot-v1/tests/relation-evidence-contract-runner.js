"use strict";

const assert = require("node:assert/strict");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { ConversationEngineV2Coordinator } = require("../lib/conversation-engine-v2/coordinator");
const { emptyStateV2 } = require("../lib/conversation-engine-v2/state-reducer");
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");

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

async function processWithoutExplicitRelation(priorState) {
  let persisted = clone(priorState);
  const logs = [];
  const engine = new ConversationEngineV2({
    planner: { classify: async () => plannerOutput() },
    persistence: {
      getConversationState: () => clone(persisted),
      setConversationState: (_propertyId, _channelId, _userId, state) => { persisted = clone(state); },
      appendMessageLog: (_propertyId, item) => { logs.push(clone(item)); return { reviewId: `review-${logs.length}` }; }
    },
    getProperty: () => ({ propertyId: scope.propertyId, timezone: "Asia/Taipei", rooms: [], commonAnswers: { parkingRule: "Parking is available." } }),
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => [],
    now: () => new Date(scope.now)
  });
  const result = await engine.process({
    customerId: scope.propertyId,
    channelId: scope.channelId,
    lineUserId: scope.lineUserId,
    eventId: "event-a",
    eventTimestamp: scope.now,
    messageText: sourceEvents[0].messageText,
    sourceEvents
  });
  return { result, persisted, logs };
}

async function main() {
  const valid = validateUnderstandingContext(plannerOutput({ contextRelationCandidates: [relation()] }), snapshot(), { sourceEvents });
  assert.equal(valid.ok, true, "an explicit candidate relation with exact source evidence is accepted");

  const legacyOnly = validateUnderstandingContext(plannerOutput(), snapshot(), { sourceEvents });
  assert.equal(legacyOnly.ok, false, "legacy discourse.relation must not create a formal relation candidate");

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

  const before = emptyStateV2(scope);
  before.conditions.stay.checkIn = "2026-08-06";
  before.contextCycle = { requestCycleId: "cycle-a", requestKind: "policy", status: "active", confirmedInputs: {}, contextReuseExpiresAt: "2026-07-25T00:00:00.000Z" };
  const unchanged = await processWithoutExplicitRelation(before);
  assert.deepEqual(unchanged.persisted, before, "missing explicit relation must not mutate persisted state even with one snapshot cycle");
  assert.equal(unchanged.result.shouldReply, true);
  assert.ok(unchanged.result.replyText.length > 0, "missing explicit relation must produce a non-empty safe reply");
  assert.ok(unchanged.logs.every((item) => item.processingStatus !== "processing_failed"), "contract failure must not be recorded as processing_failed");
  assert.ok(unchanged.logs.every((item) => !String(item.replyText || "").includes("2026-08-06")), "safe fallback must not disclose unapproved state facts");

  const burstDiagnostics = [];
  const burstPlanner = plannerOutput({
    tasks: [task(0), { ...task(1), sourceText: "Second" }],
    contextRelationCandidates: [
      relation({ candidateIndex: 0, evidenceRefs: [{ eventId: "burst-a", startOffset: 0, endOffset: 4, quote: "Need" }] }),
      relation({ candidateIndex: 1, evidenceRefs: [{ eventId: "burst-b", startOffset: 0, endOffset: 6, quote: "Second" }] })
    ]
  });
  let burstState = emptyStateV2(scope);
  const burstEngine = new ConversationEngineV2({
    planner: { classify: async () => burstPlanner },
    persistence: {
      getConversationState: () => clone(burstState),
      setConversationState: (_propertyId, _channelId, _userId, state) => { burstState = clone(state); },
      appendMessageLog: () => ({ reviewId: "burst-review" })
    },
    getProperty: () => ({ propertyId: scope.propertyId, timezone: "Asia/Taipei", rooms: [], commonAnswers: { parkingRule: "Parking is available." } }),
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => [],
    now: () => new Date(scope.now),
    onDiagnostic: (item) => burstDiagnostics.push(item)
  });
  let scheduled = null;
  const coordinator = new ConversationEngineV2Coordinator({ engine: burstEngine, schedule: (run) => { scheduled = run; return 1; }, cancel: () => {} });
  const first = coordinator.enqueue({ customerId: scope.propertyId, channelId: scope.channelId, lineUserId: scope.lineUserId, eventId: "burst-a", messageRef: "message-burst-a", eventTimestamp: scope.now, messageText: "Need" });
  const second = coordinator.enqueue({ customerId: scope.propertyId, channelId: scope.channelId, lineUserId: scope.lineUserId, eventId: "burst-b", messageRef: "message-burst-b", eventTimestamp: scope.now, messageText: "Second" });
  await scheduled();
  await Promise.all([first, second]);
  assert.ok(burstDiagnostics.length > 0, "a merged burst must enter the engine once");
  assert.ok(burstDiagnostics.every((item) => JSON.stringify(item.sourceEventIds) === JSON.stringify(["burst-a", "burst-b"])), "every burst trace record must retain all source event IDs");

  console.log("relation evidence contract: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
