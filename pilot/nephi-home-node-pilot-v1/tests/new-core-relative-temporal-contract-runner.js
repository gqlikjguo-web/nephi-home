"use strict";

// FAKE_INTEGRATION: fixture OpenAI wire output, real production C01-C09,
// FinalDecision, FinalResponse and Conversation State contracts. Direct
// temporal cases are STRUCTURED_CONTRACT_TEST. No network or database writes.
const assert = require("node:assert/strict");
const {
  resolveTemporalExpression
} = require("../lib/conversation-engine-v2/temporal-resolver");
const {
  callOpenAIUnderstandingV1
} = require("../lib/providers/openai-understanding-v1");
const {
  executeNewCoreTurn
} = require("../lib/new-core/application-service");
const {
  createConversationStateV3
} = require("../lib/conversation-contracts/conversation-state-v3");

const TIMEZONE = "Asia/Taipei";
const NOW = "2026-09-11T14:12:18.261Z";
const EXPIRES = "2026-09-12T14:12:18.261Z";
const scope = {
  propertyId: "relative-temporal-contract-property",
  channel: "line:relative-temporal-contract",
  userId: "relative-temporal-contract-user"
};
const property = {
  propertyId: scope.propertyId,
  displayName: "Relative temporal contract fixture",
  timezone: TIMEZONE,
  availabilityAutoReplyEnabled: true,
  rooms: [{
    id: "fixture-room",
    displayName: "Fixture room",
    type: "double",
    capacity: 2,
    enabled: true,
    aliases: []
  }],
  commonAnswers: {},
  businessProfile: {},
  propertyFacts: []
};

function emptyState() {
  return createConversationStateV3({
    ...scope,
    tasks: [],
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: EXPIRES
  });
}

function pendingAvailabilityState(taskId = "pending-availability") {
  return createConversationStateV3({
    ...scope,
    tasks: [{
      taskId,
      taskType: "availability",
      productType: "any",
      productId: null,
      roomTypeId: null,
      bundleId: null,
      checkIn: null,
      checkOut: null,
      guestCount: null,
      searchFrom: null,
      searchTo: null,
      entityId: null,
      entityCategory: null,
      detailIntent: "general",
      knownFields: ["productType"],
      missingFields: ["checkIn", "checkOut"],
      status: "pending",
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: EXPIRES
    }],
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: EXPIRES
  });
}

function pendingCapacityState(taskId = "pending-capacity") {
  return createConversationStateV3({
    ...scope,
    tasks: [{
      taskId,
      taskType: "capacity",
      productType: "room_type",
      productId: "fixture-room",
      roomTypeId: "fixture-room",
      bundleId: null,
      checkIn: null,
      checkOut: null,
      guestCount: 2,
      searchFrom: null,
      searchTo: null,
      entityId: "fixture-room",
      entityCategory: "room",
      detailIntent: "general",
      knownFields: ["productType", "productId", "roomTypeId", "guestCount"],
      missingFields: ["checkIn", "checkOut"],
      status: "pending",
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: EXPIRES
    }],
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: EXPIRES
  });
}

function relativeCandidate(rawText, dayOffset, dayPeriod = "unspecified") {
  return {
    rawText,
    kind: "relative_date",
    checkInCandidate: null,
    checkOutCandidate: null,
    nightsCandidate: null,
    relativeSemantics: { dayOffset, dayPeriod }
  };
}

function grammarCandidate(rawText, kind) {
  return {
    rawText,
    kind,
    checkInCandidate: null,
    checkOutCandidate: null,
    nightsCandidate: null
  };
}

function resolve(candidate, eventTimestamp = NOW) {
  return resolveTemporalExpression({
    rawText: candidate.rawText,
    kind: candidate.kind === "relative_date" ? "relative"
      : candidate.kind === "relative_range" ? "range"
        : candidate.kind === "absolute_date" ? "absolute"
          : candidate.kind,
    anchor: "message_time",
    ...(candidate.relativeSemantics
      ? { relativeSemantics: candidate.relativeSemantics }
      : {})
  }, {
    eventTimestamp,
    timezone: TIMEZONE,
    nightsCandidate: candidate.nightsCandidate,
    defaultNights: 1,
    applicableTaskIds: ["temporal-contract-task"],
    sourceEvidenceRefs: []
  });
}

function assertResolved(candidate, checkIn, checkOut, eventTimestamp = NOW) {
  const result = resolve(candidate, eventTimestamp);
  assert.equal(result.resolutionStatus, "resolved", `${candidate.rawText} must resolve`);
  assert.equal(result.checkIn, checkIn, `${candidate.rawText} check-in`);
  assert.equal(result.checkOut, checkOut, `${candidate.rawText} check-out`);
  return result;
}

function runTemporalMatrix() {
  const singleDateCases = [
    [relativeCandidate("明天", 1), "2026-09-12", "2026-09-13"],
    [relativeCandidate("明晚", 1, "night"), "2026-09-12", "2026-09-13"],
    [relativeCandidate("後天", 2), "2026-09-13", "2026-09-14"],
    [relativeCandidate("這週五", 0), "2026-09-11", "2026-09-12"],
    [relativeCandidate("下週一", 3), "2026-09-14", "2026-09-15"],
    [relativeCandidate("下週三", 5), "2026-09-16", "2026-09-17"],
    [relativeCandidate("下個星期五", 7), "2026-09-18", "2026-09-19"]
  ];
  for (const [candidate, checkIn, checkOut] of singleDateCases) {
    assertResolved(candidate, checkIn, checkOut);
  }

  assertResolved(
    relativeCandidate("下週一", 5),
    "2026-10-05",
    "2026-10-06",
    "2026-09-30T12:00:00.000Z"
  );
  assertResolved(
    relativeCandidate("下週一", 5),
    "2027-01-04",
    "2027-01-05",
    "2026-12-30T12:00:00.000Z"
  );

  const weekend = assertResolved(
    grammarCandidate("下週末", "relative_range"),
    "2026-09-19",
    "2026-09-20"
  );
  assert.equal(weekend.expressionType, "weekend");

  const range = assertResolved(
    grammarCandidate("下週三到下週五", "relative_range"),
    "2026-09-16",
    "2026-09-18"
  );
  assert.equal(range.expressionType, "date_range");

  const absolute = assertResolved(
    grammarCandidate("2026/09/16", "absolute_date"),
    "2026-09-16",
    "2026-09-17"
  );
  assert.equal(absolute.expressionType, "absolute_date");

  const equivalentRepresentation = resolve(relativeCandidate("下週三", 5));
  assert.equal(
    equivalentRepresentation.resolutionStatus,
    "resolved",
    "different legal expression types with the same canonical single date must be accepted"
  );
  assert.equal(equivalentRepresentation.checkIn, "2026-09-16");

  const conflictingRepresentation = resolve(relativeCandidate("下週三", 6));
  assert.equal(
    conflictingRepresentation.resolutionStatus,
    "unresolved",
    "different representations with different canonical dates must be rejected"
  );
  assert.equal(conflictingRepresentation.repairReasonCode, "relative_semantics_conflict");

  const singleAgainstRange = resolve(relativeCandidate("下週末", 8));
  assert.equal(singleAgainstRange.resolutionStatus, "unresolved");
  assert.equal(singleAgainstRange.repairReasonCode, "relative_semantics_conflict");

  return {
    classification: "STRUCTURED_CONTRACT_TEST",
    passCount: singleDateCases.length + 7,
    cases: [
      ...singleDateCases.map(([candidate]) => candidate.rawText),
      "cross-month-relative-weekday",
      "cross-year-relative-weekday",
      "relative-range",
      "absolute-date",
      "equivalent-representation",
      "conflicting-representation",
      "single-vs-range-conflict"
    ]
  };
}

function runIntervalMatrix() {
  const { compareCanonicalTemporalSemantics: compare } = require("../lib/conversation-contracts/relative-temporal-semantics");
  const cases = [];
  function check(name, fn) {
    try { fn(); cases.push({ name, pass: true }); }
    catch (error) { cases.push({ name, pass: false, error: error.message }); }
  }
  const duration = (rawText, offset, nights) => ({ ...relativeCandidate(rawText, offset), nightsCandidate: nights });
  const accepted = [
    ["relative-day", relativeCandidate("明天", 1), "2026-09-12", "2026-09-13"],
    ["relative-weekday", relativeCandidate("下週三", 5), "2026-09-16", "2026-09-17"],
    ["relative-weekend", grammarCandidate("下週末", "relative_range"), "2026-09-19", "2026-09-20"],
    ["absolute-single", grammarCandidate("2026/09/16", "absolute_date"), "2026-09-16", "2026-09-17"],
    ["explicit-range", grammarCandidate("2026/09/16到2026/09/18", "date_range"), "2026-09-16", "2026-09-18"],
    ["relative-one-night", duration("明天住一晚", 1, 1), "2026-09-12", "2026-09-13"],
    ["relative-two-nights", duration("明天住兩晚", 1, 2), "2026-09-12", "2026-09-14"],
    ["grammar-grounded-duration", duration("明天住兩晚", 1, null), "2026-09-12", "2026-09-14"],
    ["weekday-duration", duration("下週三住兩晚", 5, 2), "2026-09-16", "2026-09-18"],
    ["absolute-duration", { ...grammarCandidate("2026/09/16住兩晚", "absolute_date"), nightsCandidate: 2 }, "2026-09-16", "2026-09-18"],
    ["relative-range-and-duration", duration("明天到後天", 1, 1), "2026-09-12", "2026-09-13"],
    ["month-boundary", duration("明天住兩晚", 1, 2), "2026-09-30", "2026-10-02", "2026-09-29T12:00:00Z"],
    ["year-boundary", duration("明天住兩晚", 1, 2), "2026-12-31", "2027-01-02", "2026-12-30T12:00:00Z"]
  ];
  for (const [name, candidate, start, end, now] of accepted) check(name, () => assertResolved(candidate, start, end, now || NOW));
  for (const [name, candidate] of [
    ["model-duration-conflicts-with-source", duration("明天住兩晚", 1, 1)],
    ["model-duration-conflicts-with-range", duration("明天到後天", 1, 2)],
    ["start-conflict-with-duration", duration("明天住兩晚", 2, 2)],
    ["single-does-not-cover-weekend", relativeCandidate("下週末", 8)]
  ]) check(name, () => {
    const result = resolve(candidate);
    assert.equal(result.resolutionStatus, "unresolved");
    assert.equal(result.repairReasonCode, "relative_semantics_conflict");
    assert.equal(result.checkIn, null);
    assert.equal(result.checkOut, null);
  });
  const start = "2026-09-16", end = "2026-09-18";
  for (const [name, left, right, expected] of [
    ["same-interval-different-representations", {checkIn:start,nights:2}, {checkIn:start,checkOut:end}, "EQUIVALENT"],
    ["same-start-different-duration", {checkIn:start,nights:1}, {checkIn:start,nights:2}, "CONFLICT"],
    ["different-interval", {checkIn:start,nights:2}, {checkIn:"2026-09-17",checkOut:end}, "CONFLICT"],
    ["single-vs-stay", {checkIn:start}, {checkIn:start,checkOut:end}, "CONFLICT"],
    ["duration-and-end-disagree", {checkIn:start,checkOut:end,nights:1}, {checkIn:start,checkOut:end}, "CONFLICT"],
    ["single-equivalence", {checkIn:start,expressionType:"relative_day"}, {checkIn:start,expressionType:"relative_weekday"}, "EQUIVALENT"],
    ["search-is-not-stay", {searchRange:{from:start,to:end}}, {checkIn:start,checkOut:end}, "CONFLICT"],
    ["search-equivalence", {searchRange:{from:start,to:end}}, {searchRange:{from:start,to:end}}, "EQUIVALENT"],
    ["range-cross-month", {checkIn:"2026-09-30",nights:2}, {checkIn:"2026-09-30",checkOut:"2026-10-02"}, "EQUIVALENT"],
    ["range-cross-year", {checkIn:"2026-12-31",nights:2}, {checkIn:"2026-12-31",checkOut:"2027-01-02"}, "EQUIVALENT"],
    ["missing-is-not-equivalent", {}, {checkIn:start}, "NOT_COMPARABLE"]
  ]) check(name, () => {
    assert.equal(compare(left,right),expected);
    assert.equal(compare(right,left),expected,"comparison must be symmetric");
  });
  const failed = cases.filter(item => !item.pass);
  if (failed.length) throw new Error(JSON.stringify({suite:"temporal-interval",classification:"STRUCTURED_CONTRACT_TEST",cases,failCount:failed.length}));
  return {classification:"STRUCTURED_CONTRACT_TEST",passCount:cases.length,cases};
}

function providerFor({
  temporalCandidate,
  relationKind = "NEW_REQUEST",
  historyRefs = [],
  capability = "availability",
  subject = { kind: "property", catalogIdentity: null }
}) {
  return (input, options) => callOpenAIUnderstandingV1(input, {
    ...options,
    nowMs: () => Date.parse(NOW),
    fetchImpl: async () => {
      const event = input.sourceEvents[0];
      const evidence = {
        eventId: event.eventId,
        messageRef: event.messageRef,
        startOffset: 0,
        endOffset: event.messageText.length,
        quote: event.messageText
      };
      const unit = {
        unitId: `unit-${event.eventId}`,
        evidenceRefs: [evidence],
        purpose: "lodging_question",
        capability,
        subject,
        stayDependent: true,
        temporalCandidate,
        contextLinkCandidateId: `link-${event.eventId}`,
        safetyCandidate: null,
        slotCandidates: [],
        confidenceBand: "high"
      };
      const output = {
        understandingOutput: {
          schemaVersion: 1,
          turnId: input.turnId,
          units: [unit]
        },
        contextLinkCandidates: [{
          contextLinkCandidateId: unit.contextLinkCandidateId,
          unitId: unit.unitId,
          relationKind,
          currentSourceEvidenceRefs: [evidence],
          referencedHistoryEventRefs: historyRefs
        }]
      };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "fixture-request" },
        text: async () => JSON.stringify({
          model: "gpt-5.6-luna",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(output) }]
          }]
        })
      };
    }
  });
}

async function execute({
  eventId,
  message,
  temporalCandidate,
  state = emptyState(),
  recentConversation = [],
  relationKind = "NEW_REQUEST",
  historyRefs = [],
  capability = "availability",
  subject = { kind: "property", catalogIdentity: null },
  availability = null
}) {
  const sourceEvent = {
    eventId,
    messageRef: eventId,
    role: "guest",
    timestamp: NOW,
    messageKind: "text",
    messageText: message
  };
  let availabilityCalls = 0;
  const diagnostics = [];
  const result = await executeNewCoreTurn({
    scope,
    property,
    state,
    now: NOW,
    publicBaseUrl: "https://example.invalid",
    input: {
      turnId: eventId,
      traceId: `trace-${eventId}`,
      message,
      sourceEvents: [sourceEvent],
      recentConversation
    },
    providerConfig: { apiKey: "fixture-only" },
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    resolver: {
      availability: query => {
        availabilityCalls += 1;
        if (availability) return availability(query);
        return {
          customerId: scope.propertyId,
          availabilityReliable: true,
          rooms: [],
          checkIn: query.checkIn,
          checkOut: query.checkOut
        };
      },
      availableDates: () => {
        throw new Error("UNEXPECTED_AVAILABLE_DATES_RESOLVER");
      },
      priceOverrides: () => [],
      dateClassifications: () => [],
      customReplies: () => []
    },
    understandingProvider: providerFor({
      temporalCandidate,
      relationKind,
      historyRefs,
      capability,
      subject
    })
  });
  return { result, availabilityCalls, sourceEvent, diagnostics };
}

function history(event, cycleId) {
  return {
    ...event,
    referenceableCycleIds: [cycleId]
  };
}

function historyRef(event) {
  return { eventId: event.eventId, messageRef: event.messageRef };
}

async function runApplicationTemporalMatrix() {
  const first = await execute({
    eventId: "relative-weekend",
    message: "下週末有房嗎",
    temporalCandidate: grammarCandidate("下週末", "relative_range")
  });
  assert.equal(first.result.earliestFailure, null);
  assert.equal(first.result.finalDecision.action, "reply");
  assert.equal(first.availabilityCalls, 1);
  const firstTask = first.result.state.tasks.find(task => task.taskType === "availability");
  assert.ok(firstTask);
  assert.equal(firstTask.checkIn, "2026-09-19");

  const changedDate = await execute({
    eventId: "relative-weekday-after-weekend",
    message: "那下週三有房嗎",
    temporalCandidate: relativeCandidate("下週三", 5),
    state: first.result.state,
    recentConversation: [history(first.sourceEvent, firstTask.taskId)]
  });
  assert.equal(changedDate.result.earliestFailure, null);
  assert.equal(changedDate.result.finalDecision.action, "reply");
  assert.equal(changedDate.availabilityCalls, 1);
  assert.ok(
    changedDate.result.artifacts.canonicalItems.some(item => (
      item.canonicalRequest.temporalState.checkIn === "2026-09-16"
    )),
    "a NEW_REQUEST with history must retain its equivalent canonical date"
  );

  const supplementEvent = {
    eventId: "pending-history-event",
    messageRef: "pending-history-event",
    role: "guest",
    timestamp: "2026-09-11T13:00:00.000Z",
    messageKind: "text",
    messageText: "先查房況",
    referenceableCycleIds: ["pending-capacity"]
  };
  const supplement = await execute({
    eventId: "relative-weekday-supplement",
    message: "日期改成下週一",
    temporalCandidate: relativeCandidate("下週一", 3),
    state: pendingCapacityState(),
    recentConversation: [supplementEvent],
    relationKind: "SUPPLEMENT",
    historyRefs: [historyRef(supplementEvent)],
    capability: "capacity",
    subject: { kind: "room", catalogIdentity: "fixture-room" }
  });
  assert.equal(supplement.result.earliestFailure, null, JSON.stringify({
    artifacts: supplement.result.artifacts,
    diagnostics: supplement.diagnostics
  }));
  assert.equal(supplement.result.finalDecision.action, "clarification");
  assert.equal(supplement.result.finalDecision.reasonCode, "missing_information");
  assert.equal(supplement.availabilityCalls, 0);
  assert.ok(
    supplement.result.artifacts.outcomes.some(outcome => (
      outcome.lifecycleDecision.action === "CONTINUE"
      && outcome.lifecycleDecision.targetRequestCycleId === "pending-capacity"
    )),
    "a source-grounded relative temporal supplement must retain the formal CONTINUE relation"
  );
  assert.equal(supplement.result.state.tasks.length, 1);
  assert.equal(supplement.result.state.tasks[0].taskId, "pending-capacity");
  assert.equal(supplement.result.state.tasks[0].guestCount, 2);

  const modificationEvent = history(first.sourceEvent, firstTask.taskId);
  const modification = await execute({
    eventId: "relative-weekday-modification",
    message: "改成下個星期五",
    temporalCandidate: relativeCandidate("下個星期五", 7),
    state: first.result.state,
    recentConversation: [modificationEvent],
    relationKind: "MODIFICATION",
    historyRefs: [historyRef(modificationEvent)]
  });
  assert.equal(modification.result.earliestFailure, null);
  assert.equal(modification.result.finalDecision.action, "reply");
  assert.equal(modification.availabilityCalls, 1);
  assert.equal(modification.result.state.tasks.length, 1);
  assert.equal(modification.result.state.tasks[0].taskId, firstTask.taskId);
  assert.equal(modification.result.state.tasks[0].checkIn, "2026-09-18");

  return {
    classification: "FAKE_INTEGRATION",
    passCount: 4,
    cases: [
      "single-turn-new-request-no-history",
      "new-request-with-history",
      "supplement-pending-history",
      "modification-answered-history"
    ]
  };
}

async function runStateFailureMatrix() {
  const mismatch = await execute({
    eventId: "relative-weekday-conflict",
    message: "下週三有房嗎",
    temporalCandidate: relativeCandidate("下週三", 6)
  });
  assert.equal(mismatch.availabilityCalls, 0, "a temporal conflict must not query Resolver");
  assert.equal(mismatch.result.earliestFailure, null);
  assert.equal(mismatch.result.finalDecision.action, "clarification");
  assert.equal(mismatch.result.finalDecision.reasonCode, "missing_information");
  assert.equal(
    mismatch.result.artifacts.canonicalItems[0].canonicalRequest.temporalState.repairReasonCode,
    "relative_semantics_conflict",
    "the structured canonical temporal failure reason must survive the safe clarification path"
  );
  assert.equal(mismatch.result.finalResponse.shouldReply, true);
  assert.ok(mismatch.result.finalResponse.replyText.length > 0);
  assert.equal(mismatch.result.state.tasks.length, 1);
  assert.ok(
    ["pending", "needs_clarification"].includes(mismatch.result.state.tasks[0].status),
    "missing readiness must remain a legal non-human State"
  );

  const technical = await execute({
    eventId: "relative-weekday-technical",
    message: "下週一有房嗎",
    temporalCandidate: relativeCandidate("下週一", 3),
    availability: query => ({
      customerId: scope.propertyId,
      availabilityReliable: false,
      rooms: [],
      checkIn: query.checkIn,
      checkOut: query.checkOut
    })
  });
  assert.equal(technical.availabilityCalls, 1);
  assert.equal(technical.result.finalDecision.action, "no_reply");
  assert.equal(technical.result.finalDecision.reasonCode, "terminal_processing_status");
  assert.equal(technical.result.finalDecision.reviewRequired, false);
  assert.equal(technical.result.finalResponse.shouldReply, false);
  assert.equal(technical.result.finalResponse.replyText, "");
  assert.equal(
    technical.result.state.tasks[0].status,
    "ready",
    "a technical execution failure must not persist human responsibility"
  );

  return {
    classification: "FAKE_INTEGRATION",
    passCount: 2,
    cases: ["structured-temporal-conflict", "technical-execution-processing-status"]
  };
}

async function main() {
  const mode = process.argv[2] || "--all";
  const output = { suite: "new-core-relative-temporal-contract", mode };
  if (["--temporal", "--all"].includes(mode)) {
    output.interval = runIntervalMatrix();
    output.temporal = runTemporalMatrix();
    output.applicationTemporal = await runApplicationTemporalMatrix();
  }
  if (["--state", "--all"].includes(mode)) {
    output.stateFailure = await runStateFailureMatrix();
  }
  if (!["--temporal", "--state", "--all"].includes(mode)) {
    throw new TypeError(`unsupported mode: ${mode}`);
  }
  output.passCount = Object.values(output)
    .filter(value => value && typeof value === "object" && Number.isInteger(value.passCount))
    .reduce((total, value) => total + value.passCount, 0);
  output.failCount = 0;
  console.log(JSON.stringify(output));
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
