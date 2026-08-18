"use strict";

const assert = require("node:assert/strict");
const {
  createConversationStateV3,
  createConversationTaskV3
} = require("../lib/conversation-contracts/conversation-state-v3");
const {
  decideContextExecutionV3
} = require("../lib/conversation-engine-v2/conversation-state-v3-reducer");

const now = "2026-08-18T10:00:00.000Z";
const state = createConversationStateV3({
  propertyId: "preflight-property",
  channel: "preflight-channel",
  userId: "preflight-user",
  tasks: [createConversationTaskV3({
    taskId: "answered-price",
    taskType: "pricing",
    productType: "bundle",
    productId: "bundle-all",
    roomTypeId: null,
    bundleId: "bundle-all",
    checkIn: "2026-10-02",
    checkOut: "2026-10-03",
    guestCount: null,
    searchFrom: null,
    searchTo: null,
    entityId: "bundle-all",
    entityCategory: "bundle",
    detailIntent: "general",
    knownFields: ["productType", "productId", "bundleId", "checkIn", "checkOut"],
    missingFields: [],
    status: "answered",
    createdAt: now,
    updatedAt: now,
    expiresAt: "2026-08-19T10:00:00.000Z"
  })],
  createdAt: now,
  updatedAt: now,
  expiresAt: "2026-08-19T10:00:00.000Z"
});

const result = decideContextExecutionV3({
  state,
  relations: [{
    candidateIndex: 0,
    relationKind: "supplement_existing",
    stateAction: "continue",
    requestCycleId: "answered-price",
    evidenceRefs: []
  }],
  plannerTasks: [{
    candidateIndex: 0,
    taskId: "availability-followup",
    type: "availability",
    sourceText: "availability followup",
    detailIntent: "general",
    requestedOutputs: ["availability"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: true,
    entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 },
    stayCandidate: null,
    confidence: 1
  }],
  catalog: { rooms: [], bundles: [{ canonicalId: "bundle-all", category: "bundle" }] },
  now
});

assert.equal(result.executionItems[0].task.type, "availability");
assert.deepEqual(result.executionItems[0].task.requestedOutputs, ["availability"]);
assert.equal(result.executionItems[0].transition.contextTask.checkIn, "2026-10-02");
assert.equal(result.executionItems[0].transition.contextTask.bundleId, "bundle-all");
