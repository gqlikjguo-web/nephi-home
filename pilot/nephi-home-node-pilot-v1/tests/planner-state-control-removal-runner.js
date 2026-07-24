"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ConversationEngineV2 } = require("../lib/conversation-engine-v2/engine");
const { emptyStateV2 } = require("../lib/conversation-engine-v2/state-reducer");

const property = { propertyId: "property-a", timezone: "Asia/Taipei", rooms: [], commonAnswers: {} };
const scope = { propertyId: "property-a", channelId: "channel-a", lineUserId: "user-a", now: "2026-07-24T00:00:00.000Z" };

function plan({ relation = "new_request", refs = [], stateOperations = [] } = {}) {
  return {
    schemaVersion: 2,
    discourse: { relation, confidence: 1 },
    stateOperations,
    stay: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    },
    tasks: [{
      candidateIndex: 0,
      taskId: "availability-task",
      type: "availability",
      sourceText: "test",
      detailIntent: "general",
      requestedOutputs: ["answer"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 },
      confidence: 1
    }],
    contextRelationCandidates: [{ candidateIndex: 0, kind: relation === "new_request" ? "new_request" : "supplement_existing", candidateRequestCycleRefs: refs, evidenceRefs: [{ eventId: "event-a", startOffset: 0, endOffset: 4, quote: "test" }] }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "test"
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function processWith({ priorState, plannerOutput }) {
  let persisted = clone(priorState);
  const logs = [];
  const engine = new ConversationEngineV2({
    planner: { classify: async () => plannerOutput },
    persistence: {
      getConversationState: () => clone(persisted),
      setConversationState: (_propertyId, _channelId, _userId, state) => { persisted = clone(state); },
      appendMessageLog: (_propertyId, item) => { logs.push(clone(item)); return { reviewId: `review-${logs.length}` }; }
    },
    getProperty: () => property,
    availabilityResolver: () => ({ availabilityReliable: true, rooms: [] }),
    listPriceOverrides: () => [],
    now: () => new Date(scope.now)
  });
  const result = await engine.process({
    customerId: scope.propertyId,
    channelId: scope.channelId,
    lineUserId: scope.lineUserId,
    eventId: "event-a",
    eventTimestamp: "2026-07-24T00:00:00.000Z",
    messageText: "test"
  });
  return { result, persisted, logs };
}

async function main() {
  const initial = emptyStateV2(scope);
  initial.requestCycles = [{ requestCycleId: "existing-cycle", requestKind: "availability", status: "active", confirmedInputs: { stay: { checkIn: null, checkOut: null, nights: null, guests: 2, searchRange: null }, inventory: { mode: "any", entityId: null, features: [] }, topic: { capabilityType: null, canonicalId: null, category: null, detailIntent: "general", detailFields: [] } }, contextReuseExpiresAt: "2026-07-25T00:00:00.000Z", createdAt: scope.now, updatedAt: scope.now }];
  const legacy = await processWith({
    priorState: initial,
    plannerOutput: plan({ stateOperations: [{ field: "stay.guestCountCandidate", operation: "replace", value: 4, sourceText: "four guests" }] })
  });
  assert.equal(legacy.persisted.requestCycles[0].confirmedInputs.stay.guests, 2, "legacy Planner state controls must not change persisted state");

  for (const invalidReference of ["outside", "expired", "ended", "scope-mismatch"]) {
    const before = emptyStateV2(scope);
    before.requestCycles = [{
      requestCycleId: "trusted-cycle",
      requestKind: "availability",
      status: invalidReference === "ended" ? "ended" : "active",
      confirmedInputs: { stay: { checkIn: "2026-08-06", checkOut: null, nights: null, guests: null, searchRange: null }, inventory: { mode: "any", entityId: null, features: [] }, topic: { capabilityType: null, canonicalId: null, category: null, detailIntent: "general", detailFields: [] } },
      contextReuseExpiresAt: invalidReference === "expired" ? "2026-07-23T00:00:00.000Z" : "2026-07-25T00:00:00.000Z", createdAt: scope.now, updatedAt: scope.now
    }];
    if (invalidReference === "scope-mismatch") before.scope.lineUserId = "another-user";
    const snapshot = clone(before);
    const outcome = await processWith({ priorState: before, plannerOutput: plan({ relation: "continue", refs: [invalidReference] }) });
    assert.deepEqual(outcome.persisted, snapshot, `${invalidReference} relation must leave persisted state unchanged`);
    assert.equal(outcome.result.shouldReply, true);
    assert.ok(outcome.result.replyText.length > 0, `${invalidReference} relation must produce a non-empty safe reply`);
    assert.ok(outcome.logs.every((item) => item.processingStatus !== "processing_failed"), `${invalidReference} safe fallback must not be recorded as processing_failed`);
    assert.ok(outcome.logs.every((item) => !String(item.replyText || "").includes("2026-08-06")), `${invalidReference} safe fallback must not expose unapproved state facts`);
  }

  const engineSource = fs.readFileSync(path.join(__dirname, "../lib/conversation-engine-v2/engine.js"), "utf8");
  assert.equal(engineSource.includes("stateOperations"), false, "Engine must not read legacy Planner state operations");
  console.log("planner state control removal: PASS");
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
