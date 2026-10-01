"use strict";
// STRUCTURED_CONTRACT_TEST / FAKE_INTEGRATION / RECORDED_REPRODUCTION.
// Inject only model transport; actual admission, lifecycle, State and reply run.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeNewCoreTurn } = require("../lib/new-core/application-service");
const provider = require("../lib/providers/openai-understanding-v1");
const { turn, refs, dateRange, NOW } = require("./helpers/new-core-context-scenarios");
const { fixtureSourceObligations } = require("./helpers/understanding-source-obligations-fixture");
const recorded = require("./fixtures/understanding-cancellation-target-recorded.json");

const plain = { eventId: "unbound-discussion", messageRef: "unbound-discussion", role: "guest",
  timestamp: NOW, messageKind: "text", messageText: "An unprocessed follow-up.", referenceableCycleIds: [] };
const room = (id, name = id) => ({ id, name, type: "double", capacity: 4, basePrice: 1200 });
const propertyFor = propertyId => ({ propertyId, timezone: "Asia/Taipei", currency: "TWD",
  availabilityAutoReplyEnabled: true, rooms: [room("room-a"), room("room-b"), room("901")],
  commonAnswers: {}, businessProfile: {}, propertyFacts: [] });
const stateTasks = result => result.state.tasks;

function output(input, history, meaning = {}) {
  const event = input.sourceEvents[0];
  const ref = { eventId: event.eventId, messageRef: event.messageRef,
    startOffset: 0, endOffset: event.messageText.length, quote: event.messageText };
  const purpose = meaning.purpose || "cancellation", capability = meaning.capability ?? null;
  const relationKind = meaning.relationKind || "TERMINATION";
  return {
    understandingOutput: { schemaVersion: 1, turnId: input.turnId, units: [{ unitId: "end-inquiry",
      evidenceRefs: [ref], purpose, capability, subject: meaning.subject || { kind: null, catalogIdentity: null },
      stayDependent: false, temporalCandidate: null, contextLinkCandidateId: "end-link",
      safetyCandidate: meaning.safetyCandidate || null, slotCandidates: [], quantityCandidate: null, confidenceBand: "high" }] },
    contextLinkCandidates: [{ contextLinkCandidateId: "end-link", unitId: "end-inquiry", relationKind,
      currentSourceEvidenceRefs: [ref], referencedHistoryEventRefs: history, referencedCurrentUnitId: null,
      independentRequestEvidence: null }],
    sourceObligations: fixtureSourceObligations(input.sourceEvents, [{ obligationId: "end-obligation", unitId: "end-inquiry",
      purpose, capability, sourceEvidenceRefs: [ref], requiredFields: capability ? ["subject"] : [],
      relationKind, referencedHistoryEventRefs: history, referencedCurrentUnitId: null }])
  };
}

async function seed() {
  const first = await turn([{ capability: "availability", kind: "room", identity: "room-a",
    temporal: dateRange("2026-11-08", "2026-11-10") }]);
  assert.equal(first.result.earliestFailure, null);
  return first;
}

async function run({ first, history, now = NOW, response, before = null }) {
  const scope = before?.scope || first.state.scope;
  const input = before?.input || { turnId: "cancel-turn", traceId: "cancel-trace", message: "Please end this lodging inquiry.",
    sourceEvents: [{ eventId: "cancel-event", messageRef: "cancel-event", role: "guest", timestamp: now,
      messageKind: "text", messageText: "Please end this lodging inquiry." }], recentConversation: history };
  let calls = 0, queries = 0;
  const bodies = [], outputs = [];
  const result = await executeNewCoreTurn({ scope, input, state: before?.state || first.state, now,
    property: propertyFor(scope.propertyId), publicBaseUrl: "https://example.invalid", providerConfig: { apiKey: "fixture-only" },
    resolver: { availability: () => { queries++; throw Error("CANCELLATION_MUST_NOT_QUERY"); },
      availableDates: () => { queries++; throw Error("CANCELLATION_MUST_NOT_QUERY"); },
      priceOverrides: () => [], dateClassifications: () => [], customReplies: () => [] },
    understandingProvider: (c01, config) => provider.callOpenAIUnderstandingV1(c01, { ...config,
      nowMs: () => Date.parse(now), fetchImpl: async (_url, request) => {
        bodies.push(JSON.parse(request.body));
        assert.ok(calls < 2, "at most one controlled correction");
        const value = response(c01, calls++); outputs.push(structuredClone(value));
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({
          model: "gpt-5.6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }]
        }) };
      } }) });
  return { result, calls, queries, bodies, outputs };
}

function targetRefs(body) {
  const field = body.text.format.schema.properties.contextLinkCandidates.items.properties.referencedHistoryEventRefs;
  return field.maxItems === 0 ? [] : field.items.anyOf.map(branch => ({
    eventId: branch.properties.eventId.enum[0], messageRef: branch.properties.messageRef.enum[0] }));
}
function correction(body) {
  const text = body.input.at(-1).content[0].text;
  return JSON.parse(text.slice(text.indexOf("\n{") + 1));
}
function handoff(value, previous) {
  assert.equal(value.result.finalDecision.action, "handoff");
  assert.equal(value.result.finalResponse.shouldReply, true);
  assert.equal(value.result.finalResponse.replyText, "請稍後，將盡快回覆您。");
  assert.deepEqual(stateTasks(value.result), previous.tasks);
  assert.equal(value.queries, 0);
  assert.equal(value.result.artifacts.formalRequests.length, 0);
}

test("ordinary history stays visible but only formally bound history is an output target", async () => {
  const first = await seed();
  const value = await run({ first, history: [...first.history, plain], response: input => output(input, refs(first)) });
  const visible = JSON.parse(value.bodies[0].input[1].content[0].text);
  assert.equal(visible.recentConversation.find(event => event.eventId === plain.eventId).messageText, plain.messageText);
  assert.deepEqual(visible.recentConversation.find(event => event.eventId === plain.eventId).referenceableRequestSummaries, []);
  assert.deepEqual(targetRefs(value.bodies[0]), refs(first));
});

test("unique validated cancellation ends its exact cycle and retains accepted silence", async () => {
  const first = await seed();
  const value = await run({ first, history: first.history, response: input => output(input, refs(first)) });
  assert.equal(value.calls, 1);
  assert.equal(value.queries, 0);
  assert.equal(value.result.earliestFailure, null);
  assert.equal(value.result.artifacts.adapted.lifecycleOperations[0].targetTaskId, first.state.tasks[0].taskId);
  assert.equal(stateTasks(value.result)[0].status, "cancelled");
  assert.equal(value.result.finalResponse.shouldReply, false);
  assert.equal(value.result.finalDecision.action, "no_reply");
});

test("unbound target correction supplies formal repair evidence and preserves the cancellation", async () => {
  const first = await seed(), bad = [{ eventId: plain.eventId, messageRef: plain.messageRef }];
  const value = await run({ first, history: [...first.history, plain], response: (input, attempt) => output(input, attempt ? refs(first) : bad) });
  assert.equal(value.calls, 2);
  const failure = correction(value.bodies[1]).failures[0];
  assert.deepEqual(failure.targetReferenceRepair?.rejectedHistoryEventRefs, bad);
  assert.deepEqual(failure.targetReferenceRepair?.allowedHistoryEventRefs, refs(first));
  assert.equal(failure.fieldValidationState.find(field => field.field === "purpose").preservation, "PRESERVE");
  assert.equal(value.result.earliestFailure, null);
  assert.equal(stateTasks(value.result)[0].status, "cancelled");
  assert.equal(value.result.artifacts.understanding.validatedUnits[0].purpose, "cancellation");
});

test("target-only repair cannot rewrite the source obligation identity", async () => {
  const first = await seed(), bad = [{ eventId: plain.eventId, messageRef: plain.messageRef }];
  const value = await run({ first, history: [...first.history, plain], response: (input, attempt) => {
    const candidate = output(input, attempt ? refs(first) : bad);
    if (attempt) { candidate.sourceObligations.requirements[0].obligationId = "replacement-obligation";
      candidate.sourceObligations.coverage[0].obligationIds = ["replacement-obligation"]; }
    return candidate;
  } });
  assert.equal(value.calls, 2);
  handoff(value, first.state);
});

test("correction cannot turn a validated inquiry cancellation into an order operation", async () => {
  const first = await seed(), bad = [{ eventId: plain.eventId, messageRef: plain.messageRef }];
  const value = await run({ first, history: [...first.history, plain], response: (input, attempt) => output(input, attempt ? refs(first) : bad,
    attempt ? { purpose: "operator_request", capability: "booking_operator_request", subject: { kind: "room", catalogIdentity: "room-a" },
      safetyCandidate: { operatorActionClass: "reservation_cancellation", riskClass: null } } : {}) });
  assert.equal(value.calls, 2);
  assert.ok(value.result.artifacts.terminalFailures.some(failure => failure.code === "CORRECTION_FIELD_NOT_PRESERVED"));
  handoff(value, first.state);
});

test("unrepaired unbound cancellation hands off without cancelling the remaining legitimate cycle", async () => {
  const first = await seed();
  const value = await run({ first, history: [...first.history, plain], response: input => output(input, [{ eventId: plain.eventId, messageRef: plain.messageRef }]) });
  assert.equal(value.calls, 2);
  assert.equal(value.result.earliestFailure.failureCode, "CONTEXT_TARGET_UNAVAILABLE");
  handoff(value, first.state);
});

test("correction transport failure exits through safe handoff before output-dependent preservation", async () => {
  const first = await seed(), bad = [{ eventId: plain.eventId, messageRef: plain.messageRef }];
  const value = await run({ first, history: [...first.history, plain], response: (input, attempt) => {
    if (attempt === 1) throw new Error("deterministic correction transport failure");
    return output(input, bad);
  } });
  assert.equal(value.calls, 2);
  assert.ok(value.result.artifacts.terminalFailures.every(failure => failure.code !== "NEW_CORE_RUNTIME_FAILURE"));
  handoff(value, first.state);
});

test("a history event bound to multiple legal targets never selects one cancellation target", async () => {
  const first = await seed();
  const second = await turn([{ capability: "availability", kind: "room", identity: "room-b",
    temporal: dateRange("2026-12-03", "2026-12-05") }], { previous: first.state, history: first.history });
  const shared = { ...plain, referenceableCycleIds: second.state.tasks.map(task => task.taskId) };
  const value = await run({ first: second, history: [shared], response: input => output(input, [{ eventId: shared.eventId, messageRef: shared.messageRef }]) });
  assert.equal(value.result.earliestFailure.failureCode, "CONTEXT_TARGET_AMBIGUOUS");
  handoff(value, second.state);
});

for (const status of ["expired", "cancelled"]) test(`${status} targets are excluded and never revived`, async () => {
  const first = await seed();
  first.state.tasks[0].status = status;
  const now = status === "expired" ? "2026-09-27T03:00:00.000Z" : NOW;
  const value = await run({ first, history: first.history, now, response: input => output(input, refs(first)) });
  assert.deepEqual(targetRefs(value.bodies[0]), []);
  assert.equal(value.queries, 0);
  assert.equal(value.result.finalDecision.action, "handoff");
  assert.ok(stateTasks(value.result).every(task => ["expired", "cancelled"].includes(task.status)));
});

test("a formally acknowledged NONE remains no_reply", async () => {
  const first = await seed();
  const value = await run({ first, history: first.history, response: input => output(input, [], { purpose: "acknowledgement", relationKind: "NONE" }) });
  assert.equal(value.calls, 1);
  assert.deepEqual(stateTasks(value.result), first.state.tasks);
  assert.equal(value.result.finalResponse.shouldReply, false);
  assert.equal(value.queries, 0);
});

test("RECORDED_REPRODUCTION: exact saved cancellation attempts fail safely instead of silently", async () => {
  const before = structuredClone(recorded.before);
  const value = await run({ before, now: before.input.sourceEvents[0].timestamp,
    response: (_input, attempt) => structuredClone(recorded.outputs[attempt]) });
  assert.equal(value.calls, 2);
  assert.equal(value.result.earliestFailure.failureCode, recorded.baselineEarliestFailure.failureCode);
  assert.ok(value.result.artifacts.terminalFailures.some(failure => failure.code === "CORRECTION_FIELD_NOT_PRESERVED"));
  handoff(value, before.state);
});
