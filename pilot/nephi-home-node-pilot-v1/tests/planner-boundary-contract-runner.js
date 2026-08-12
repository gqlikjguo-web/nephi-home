"use strict";

const assert = require("node:assert/strict");
const { createConversationStateV3, createConversationTaskV3 } = require("../lib/conversation-contracts/conversation-state-v3");
const { decideContextExecutionV3 } = require("../lib/conversation-engine-v2/conversation-state-v3-reducer");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");

const NOW = "2026-08-01T00:00:00.000Z";
const FUTURE = "2026-08-02T00:00:00.000Z";
const scope = { propertyId: "boundary", channel: "line:boundary", userId: "Uboundary" };
const catalog = buildPropertyCatalog({ propertyId: "boundary", timezone: "Asia/Taipei", rooms: [{ id: "room", name: "New Room", type: "room", capacity: 2, enabled: true }], commonAnswers: {} });
const task = (overrides = {}) => createConversationTaskV3({
  taskId: "pricing", taskType: "pricing", productType: "bundle", productId: "whole", roomTypeId: null, bundleId: "whole",
  checkIn: null, checkOut: null, guestCount: null, searchFrom: null, searchTo: null, entityId: "whole", entityCategory: "bundle",
  detailIntent: "general", knownFields: ["productType", "productId", "bundleId"], missingFields: ["checkIn", "checkOut"], status: "pending",
  createdAt: NOW, updatedAt: NOW, expiresAt: FUTURE, ...overrides
});
const state = (tasks) => createConversationStateV3({ ...scope, tasks, createdAt: NOW, updatedAt: NOW, expiresAt: FUTURE });
const planner = (overrides = {}) => ({
  candidateIndex: 0, taskId: "planner-availability", type: "availability", sourceText: "8/7", detailIntent: "general", requestedOutputs: ["availability"],
  eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true,
  entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 0.9 },
  stayCandidate: { dateExpression: { rawText: "8/7", kind: "absolute", anchor: "message_time" }, checkInCandidate: "2026-08-07", checkOutCandidate: null, nightsCandidate: 1, guestCountCandidate: null }, confidence: 0.9,
  ...overrides
});

const pendingBundle = state([task()]);
const slotOnly = decideContextExecutionV3({
  state: pendingBundle,
  relations: [{ candidateIndex: 0, stateAction: "continue", requestCycleId: "pricing", reasonCode: "planner_structured_context_continue" }],
  plannerTasks: [planner()],
  now: NOW
});
assert.equal(slotOnly.executionItems[0].task.type, "price", "a structured continue relation must resume pending pricing");
assert.equal(slotOnly.executionItems[0].task.entity.canonicalCandidate, "whole", "a structured continue relation must preserve pending bundle product");
assert.equal(slotOnly.contextDecision.reasonCode, "planner_structured_context_continue");

const explicitNew = decideContextExecutionV3({ state: pendingBundle, catalog, plannerTasks: [planner({ sourceText: "new availability", entity: { category: "room", rawText: "new room", canonicalCandidate: "room", confidence: 0.9 } })], now: NOW });
assert.equal(explicitNew.executionItems[0].task.type, "availability", "explicit new task must not be locked to pending pricing");
assert.deepEqual(explicitNew.executionItems[0].transition.approvedProduct, { productType: "room_type", productId: "room", roomTypeId: "room", bundleId: null }, "Reducer must approve a new task product before canonicalization");

const completed = state([task({ status: "answered", checkIn: "2026-08-09", checkOut: "2026-08-10", knownFields: ["productType", "productId", "bundleId", "checkIn", "checkOut"], missingFields: [] })]);
const completedFollowup = decideContextExecutionV3({ state: completed, relations: [{ candidateIndex: 0, stateAction: "continue", requestCycleId: "pricing" }], plannerTasks: [planner({ taskId: "quad-price", type: "price", sourceText: "quad price", entity: { category: "room", rawText: "quad", canonicalCandidate: "quad", confidence: 0.9 }, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null } })], now: NOW });
assert.equal(completedFollowup.executionItems[0].requestCycleId, "pricing", "unexpired completed context must be selectable by reducer");

console.log(JSON.stringify({ suite: "planner-boundary-contract", classification: "structured_planner_boundary_not_real_openai", caseCount: 4, passCount: 4, failCount: 0 }));
