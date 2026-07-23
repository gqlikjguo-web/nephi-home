"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildContextSnapshot } = require("../lib/conversation-engine-v2/contracts");
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");
const { emptyStateV2, reduceConversationState } = require("../lib/conversation-engine-v2/state-reducer");

const scope = {
  propertyId: "property-a",
  channelId: "channel-a",
  lineUserId: "user-a",
  now: "2026-07-24T00:00:00.000Z"
};

function plannerOutput(relation) {
  return {
    schemaVersion: 2,
    discourse: { relation: "continue", confidence: 1 },
    stateOperations: [{ field: "stay.guests", operation: "replace", value: 4, sourceText: "four guests" }],
    stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null },
    tasks: [],
    contextRelationCandidates: [relation],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "context authority test"
  };
}

function main() {
  const previous = emptyStateV2(scope);
  previous.pendingRequest = {
    version: 1,
    requestCycleId: "cycle-a",
    capability: "availability",
    tasks: [{ taskId: "availability-a", type: "availability", entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 } }],
    conditions: previous.conditions,
    missingFields: ["stay.checkIn"],
    clarificationTarget: "stay.checkIn",
    metadata: { sourceEventId: "event-a", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z", expiresAt: "2026-07-25T00:00:00.000Z" }
  };

  const snapshot = buildContextSnapshot(previous, scope);
  assert.deepEqual(snapshot.scope, { propertyId: "property-a", channelId: "channel-a", userId: "user-a" });
  assert.deepEqual(snapshot.cycles.map((cycle) => cycle.requestCycleId), ["cycle-a"]);

  const valid = validateUnderstandingContext(plannerOutput({
    candidateIndex: 0,
    kind: "supplement_existing",
    candidateRequestCycleRefs: ["cycle-a"],
    evidenceRefs: []
  }), snapshot);
  assert.equal(valid.ok, true);
  assert.equal(valid.relations[0].requestCycleId, "cycle-a");

  const invalid = validateUnderstandingContext(plannerOutput({
    candidateIndex: 0,
    kind: "supplement_existing",
    candidateRequestCycleRefs: ["cycle-not-in-snapshot"],
    evidenceRefs: []
  }), snapshot);
  assert.equal(invalid.ok, false, "a relation may reference only a current ContextSnapshot cycle");

  const uncertainty = validateUnderstandingContext(plannerOutput({
    candidateIndex: 0,
    kind: "relation_uncertain",
    candidateRequestCycleRefs: ["cycle-a"],
    evidenceRefs: []
  }), snapshot);
  assert.equal(uncertainty.ok, true);
  assert.equal(uncertainty.relations[0].stateAction, "none");

  const unchanged = reduceConversationState(previous, plannerOutput({
    candidateIndex: 0,
    kind: "new_request",
    candidateRequestCycleRefs: [],
    evidenceRefs: []
  }), scope);
  assert.equal(unchanged.conditions.stay.guests, null, "legacy planner stateOperations cannot change conversation state directly");

  const reducerSource = fs.readFileSync(path.join(__dirname, "../lib/conversation-engine-v2/state-reducer.js"), "utf8");
  const pendingSource = fs.readFileSync(path.join(__dirname, "../lib/conversation-engine-v2/pending-request.js"), "utf8");
  assert.equal(reducerSource.includes("stateOperations"), false, "state reducer must not read planner stateOperations");
  assert.equal(reducerSource.includes("discourse.relation"), false, "state reducer must not read legacy planner discourse relation");
  assert.equal(pendingSource.includes("discourse.relation"), false, "pending helper must not read legacy planner discourse relation");
  assert.equal(pendingSource.includes("hasTemporalSupplement"), false, "pending helper must not infer continuation from temporal text or task shape");

  console.log("controlled context authority: PASS");
}

try { main(); } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
