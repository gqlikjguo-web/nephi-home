"use strict";

const assert = require("node:assert/strict");
const { getCapabilityDefinition } = require("../lib/conversation-engine-v2/capability-registry");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildCanonicalFormalRequest, buildCanonicalQueryPlan } = require("../lib/conversation-engine-v2/formal-request");
const { executeCanonicalQueryPlans } = require("../lib/conversation-engine-v2/capability-executor");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");
const { validateClaims } = require("../lib/conversation-engine-v2/claim-validator");
const { plannerProviderJsonSchema } = require("../lib/conversation-engine-v2/planner-schema");
const { evaluateTaskReadiness } = require("../lib/conversation-contracts/task-readiness");

const CAPABILITY = "lodging_product_capacity";
const eventTimestamp = Date.parse("2026-08-21T10:00:00+08:00");
const property = {
  propertyId: "static-capacity-property",
  displayName: "Capacity Test Lodge",
  timezone: "Asia/Taipei",
  rooms: [
    { id: "garden-room", name: "Garden Room", type: "family", capacity: 4, enabled: true },
    { id: "courtyard-bundle", name: "Courtyard Lodge", type: "whole house", inventoryType: "bundle", capacity: 11, enabled: true }
  ],
  commonAnswers: {},
  semanticCatalog: { aliases: {} }
};
const catalog = buildPropertyCatalog(property);

function taskFor(entity) {
  return {
    candidateIndex: 0,
    taskId: `capacity-${entity.canonicalId}`,
    type: CAPABILITY,
    sourceText: entity.publicName,
    detailIntent: "quantity",
    requestedOutputs: ["capacity"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: false,
    entity: {
      category: entity.category,
      rawText: entity.publicName,
      canonicalCandidate: entity.canonicalId,
      confidence: 0.99
    },
    stayCandidate: null,
    confidence: 0.99
  };
}

function runCapacity(entityId, expectedReply) {
  const entity = catalog.rooms.find((item) => item.canonicalId === entityId);
  const task = taskFor(entity);
  const relation = {
    candidateIndex: 0,
    kind: "new_request",
    candidateRequestCycleRefs: [],
    evidenceRefs: [{ eventId: `event-${entityId}`, messageRef: "", startOffset: 0, endOffset: task.sourceText.length, quote: task.sourceText }]
  };
  const canonicalItem = canonicalizeExecutionItem({
    item: {
      candidateIndex: 0,
      requestCycleId: task.taskId,
      task,
      transition: { approvedProduct: { productType: "any", productId: null, roomTypeId: null, bundleId: null } }
    },
    relation,
    contextSnapshot: { cycles: [] },
    catalog,
    guestMessage: task.sourceText,
    eventTimestamp
  });
  assert.equal(canonicalItem.canonicalRequest.capability, CAPABILITY);
  assert.equal(canonicalItem.canonicalRequest.stayDependency, false);
  assert.deepEqual(canonicalItem.canonicalRequest.requiredFields, []);
  assert.equal(canonicalItem.canonicalRequest.resolverId, "property_catalog");
  const formalRequest = buildCanonicalFormalRequest({
    property,
    canonicalRequest: canonicalItem.canonicalRequest,
    candidateIndex: 0,
    requestCycleId: task.taskId,
    confirmedInputs: canonicalItem.stateInput.confirmedFields
  });
  assert.equal(formalRequest.readiness.status, "ready");
  const queryPlan = buildCanonicalQueryPlan(formalRequest);
  assert.equal(queryPlan.resolverId, "property_catalog");
  const [result] = executeCanonicalQueryPlans({
    property,
    catalog,
    queryPlans: [queryPlan],
    availabilityResolver: () => { throw new Error("availability resolver must not run"); }
  });
  assert.equal(result.outcome, "answered");
  assert.equal(result.resolverAttempted, false);
  assert.equal(result.facts.source, "property_catalog");
  const responsePlan = buildResponsePlan({
    propertyId: property.propertyId,
    taskResults: [{ ...result, status: result.outcome }],
    inputTaskIds: [task.taskId],
    canonicalRequests: [canonicalItem.canonicalRequest]
  });
  const reply = composeControlledReply(responsePlan);
  assert.equal(reply, expectedReply);
  assert.equal(validateClaims(reply, responsePlan, [task.taskId]).ok, true);
}

function main() {
  assert.deepEqual(getCapabilityDefinition(CAPABILITY), {
    capability: CAPABILITY,
    acceptedCandidateTypes: [CAPABILITY],
    acceptedEntityCategories: ["room", "bundle"],
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer"
  });
  const taskTypeSchema = plannerProviderJsonSchema().properties.tasks.items.properties.type;
  assert.ok(taskTypeSchema.enum.includes(CAPABILITY));
  runCapacity("garden-room", "Garden Room 最多可住 4 人。");
  runCapacity("courtyard-bundle", "Courtyard Lodge 最多可住 11 人。");

  const genericTask = taskFor(catalog.rooms[0]);
  genericTask.entity = { category: "other", rawText: "lodging options", canonicalCandidate: null, confidence: 0.99 };
  const genericItem = canonicalizeExecutionItem({
    item: { candidateIndex: 0, requestCycleId: "generic", task: genericTask, transition: { approvedProduct: { productType: "any" } } },
    relation: null,
    contextSnapshot: { cycles: [] },
    catalog,
    guestMessage: genericTask.sourceText,
    eventTimestamp
  });
  assert.equal(genericItem.canonicalRequest.capability, "unknown", "generic recommendation must not become fixed product capacity");

  assert.deepEqual(evaluateTaskReadiness({ taskType: "capacity", productType: "room_type", productId: "garden-room", roomTypeId: "garden-room" }).missingFields, ["checkIn", "checkOut", "guestCount"]);
  process.stdout.write("lodging product capacity: PASS\n");
}

main();
