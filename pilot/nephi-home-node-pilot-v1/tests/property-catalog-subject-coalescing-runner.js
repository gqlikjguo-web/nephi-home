"use strict";

const assert = require("node:assert/strict");
const {
  executeCanonicalQueryPlans
} = require("../lib/conversation-engine-v2/capability-executor");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");
const { validateClaims } = require("../lib/conversation-engine-v2/claim-validator");
const { createCanonicalRequest } = require("../lib/conversation-engine-v2/canonical-request");

function canonicalRequest(taskId, detailIntent) {
  return createCanonicalRequest({
    taskId,
    capability: "amenity",
    canonicalEntity: { category: "amenity", canonicalId: "shared_subject", canonicalSet: [], status: "resolved", rawText: "" },
    lodgingProduct: { productType: "any", productId: null },
    detailIntent,
    temporalState: { rawText: "", expressionType: "none", checkIn: null, checkOut: null, nights: null, searchRange: null, timezone: "Asia/Taipei", resolutionStatus: "absent", resolutionSource: "none", repairReasonCode: "", applicableTaskIds: [], ambiguity: null, originalExpression: "", provenance: [], ruleRefs: [], derivedFromFieldRefs: [], fields: {} },
    stayDependency: false,
    requiredFields: [],
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer",
    evidenceRefs: []
  });
}

function queryPlan(taskId, detailIntent) {
  const request = canonicalRequest(taskId, detailIntent);
  return {
    formalRequestId: `cycle:${taskId}`,
    taskId,
    candidateIndex: detailIntent === "general" ? 0 : 1,
    requestCycleId: "cycle",
    propertyId: "property_alpha",
    canonicalRequest: request,
    resolverTask: {},
    capability: "amenity",
    resolverId: "property_catalog",
    riskLevel: "low",
    responseMode: "answer",
    detailIntent,
    operation: "property_catalog",
    conditions: { stay: {}, inventory: { mode: "any" }, topic: {} },
    entity: request.canonicalEntity
  };
}

const property = { propertyId: "property_alpha", rooms: [] };
const catalog = {
  rooms: [], policies: [], faqs: [],
  amenities: [{ canonicalId: "shared_subject", category: "amenity", publicName: "共用設施", status: "confirmed_yes", answer: "正式完整說明。" }]
};
const plans = [queryPlan("usage", "general"), queryPlan("fee", "fee")];
const outcomes = executeCanonicalQueryPlans({ property, catalog, queryPlans: plans });
assert.equal(outcomes.length, 2, "all original task IDs must retain an execution outcome");
assert.deepEqual(outcomes.map((item) => item.taskId), ["usage", "fee"]);
assert.equal(outcomes[0].facts, outcomes[1].facts, "same canonical subject must reuse one formal facts object");

const taskResults = outcomes.map((item) => ({ taskId: item.taskId, type: item.type, status: "answered", facts: item.facts }));
const responsePlan = buildResponsePlan({
  propertyId: property.propertyId,
  taskResults,
  inputTaskIds: ["usage", "fee"],
  canonicalRequests: plans.map((item) => item.canonicalRequest)
});
assert.equal(responsePlan.sections.length, 1, "same canonical subject must render once");
assert.deepEqual(responsePlan.sections[0].coveredTaskIds, ["usage", "fee"]);
const reply = composeControlledReply(responsePlan);
assert.equal(reply, "正式完整說明。");
assert.equal(validateClaims(reply, responsePlan, ["usage", "fee"]).ok, true);

const distinct = buildResponsePlan({
  propertyId: property.propertyId,
  taskResults: [
    taskResults[0],
    { taskId: "parking", type: "amenity", status: "answered", facts: { subject: "停車", status: "confirmed_yes", answer: "可停車。", source: "property_catalog", propertyId: property.propertyId } }
  ],
  inputTaskIds: ["usage", "parking"],
  canonicalRequests: [plans[0].canonicalRequest, { ...canonicalRequest("parking", "general"), canonicalEntity: { category: "amenity", canonicalId: "parking", canonicalSet: [], status: "resolved", rawText: "" } }]
});
assert.equal(distinct.sections.length, 2, "different canonical subjects must remain independent");

const unresolvedSibling = buildResponsePlan({
  propertyId: property.propertyId,
  taskResults: [
    taskResults[0],
    { taskId: "unknown", type: "unknown", status: "needs_human", facts: { subject: "其他問題" }, review: true }
  ],
  inputTaskIds: ["usage", "unknown"],
  canonicalRequests: [plans[0].canonicalRequest, createCanonicalRequest({
    ...JSON.parse(JSON.stringify(canonicalRequest("unknown", "general"))),
    capability: "unknown",
    canonicalEntity: { category: "other", canonicalId: null, canonicalSet: [], status: "not_found", rawText: "" },
    resolverId: "human_handoff",
    riskLevel: "high",
    responseMode: "handoff"
  })]
});
assert.equal(unresolvedSibling.sections.length, 2, "a true unknown must not be swallowed by an answered subject");
assert.equal(unresolvedSibling.sections[1].responseMode, "handoff");

console.log("property catalog subject coalescing: PASS");
