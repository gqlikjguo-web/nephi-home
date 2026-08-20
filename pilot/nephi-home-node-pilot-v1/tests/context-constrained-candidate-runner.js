"use strict";

const assert = require("node:assert/strict");
const { createConversationStateV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { decideContextExecutionV3 } = require("../lib/conversation-engine-v2/conversation-state-v3-reducer");
const { buildLodgingContextCandidatesV3 } = require("../lib/conversation-engine-v2/conversation-state-v3-reducer");

const now = "2026-08-20T04:00:00.000Z";
const state = createConversationStateV3({
  propertyId: "property-a",
  channel: "line",
  userId: "user-a",
  revision: 3,
  createdAt: "2026-08-20T01:00:00.000Z",
  updatedAt: "2026-08-20T03:00:00.000Z",
  expiresAt: "2026-08-21T03:00:00.000Z",
  tasks: [{
    taskId: "pricing-cycle",
    taskType: "pricing",
    productType: "bundle",
    productId: "bundle-a",
    roomTypeId: null,
    bundleId: "bundle-a",
    checkIn: "2026-10-02",
    checkOut: "2026-10-03",
    guestCount: null,
    searchFrom: null,
    searchTo: null,
    entityId: "bundle-a",
    entityCategory: "bundle",
    detailIntent: "general",
    knownFields: ["productType", "productId", "bundleId", "checkIn", "checkOut"],
    missingFields: [],
    status: "answered",
    createdAt: "2026-08-20T01:00:00.000Z",
    updatedAt: "2026-08-20T03:00:00.000Z",
    expiresAt: "2026-08-21T03:00:00.000Z"
  }]
});

function task(type, sourceText) {
  return {
    candidateIndex: 0,
    taskId: `${type}-current`,
    type,
    sourceText,
    detailIntent: "general",
    requestedOutputs: [type === "price" ? "price" : "availability"],
    dependsOnStayContext: true,
    selectedContextCandidateId: "lodging_context_1",
    entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 },
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    },
    confidence: 1
  };
}

function run(currentTask) {
  return decideContextExecutionV3({
    state,
    relations: [{ candidateIndex: 0, relationKind: "new_request", stateAction: "start", requestCycleId: null, evidenceRefs: [] }],
    plannerTasks: [currentTask],
    contextCandidates: buildLodgingContextCandidatesV3(state, now),
    catalog: { rooms: [{ canonicalId: "bundle-a", category: "bundle", publicName: "包棟", aliases: [] }] },
    now
  }).executionItems[0];
}

const a = run(task("price", "費用多少"));
assert.equal(a.requestCycleId, "pricing-cycle", "A must select the JunZan-issued lodging context candidate despite raw new_request");
assert.equal(a.task.type, "price", "A must retain the current price capability");
assert.equal(a.transition.contextTask.checkIn, "2026-10-02");
assert.equal(a.transition.approvedProduct.bundleId, "bundle-a");

const b = run(task("availability", "還能預訂嗎？"));
assert.equal(b.requestCycleId, "pricing-cycle", "B must select the same validated lodging candidate across capability change");
assert.equal(b.task.type, "availability", "B must retain the current availability capability rather than prior pricing");
assert.equal(b.transition.contextTask.checkIn, "2026-10-02");
assert.equal(b.transition.approvedProduct.bundleId, "bundle-a");

const independent = task("price", "另一筆住宿費用多少");
independent.selectedContextCandidateId = null;
const independentResult = decideContextExecutionV3({
  state,
  relations: [{ candidateIndex: 0, relationKind: "supplement_existing", stateAction: "continue", requestCycleId: "pricing-cycle", evidenceRefs: [] }],
  plannerTasks: [independent],
  contextCandidates: buildLodgingContextCandidatesV3(state, now),
  catalog: { rooms: [] },
  now
}).executionItems[0];
assert.notEqual(independentResult.requestCycleId, "pricing-cycle", "an explicit null selection must prevent relation-only carryover");

const propertyFact = task("property_fact", "地址在哪裡");
propertyFact.dependsOnStayContext = false;
propertyFact.entity = { category: "transport", rawText: "地址", canonicalCandidate: "location", confidence: 1 };
const propertyFactResult = run(propertyFact);
assert.notEqual(propertyFactResult.requestCycleId, "pricing-cycle", "non-stay tasks must not consume lodging candidates");

const invented = task("availability", "還能預訂嗎？");
invented.selectedContextCandidateId = "lodging_context_999";
assert.notEqual(run(invented).requestCycleId, "pricing-cycle", "an unknown candidate ID must fail closed");

const ended = task("availability", "取消");
const endedResult = decideContextExecutionV3({
  state,
  relations: [{ candidateIndex: 0, relationKind: "end_existing", stateAction: "end", requestCycleId: "pricing-cycle", evidenceRefs: [] }],
  plannerTasks: [ended],
  contextCandidates: buildLodgingContextCandidatesV3(state, now),
  catalog: { rooms: [] },
  now
});
assert.equal(endedResult.executionItems.length, 0, "end lifecycle must take precedence over candidate selection");
assert.deepEqual(endedResult.endedTaskIds, ["pricing-cycle"]);

console.log("context-constrained-candidate: PASS");
