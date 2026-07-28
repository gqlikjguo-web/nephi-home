"use strict";

const { assertCanonicalRequest } = require("./canonical-request");

const INVENTORY_CAPABILITIES = new Set(["availability", "bundle_availability", "room_options", "capacity", "price", "total_price"]);
const SUPPORTED_CAPABILITIES = new Set([...INVENTORY_CAPABILITIES, "available_dates", "amenity", "policy", "property_fact", "amenity_list", "booking_request", "human_help", "high_risk", "unknown"]);

function stableFormalRequestId({ requestCycleId, task }) {
  return `${String(requestCycleId || "none")}:${String(task && task.taskId || "task")}`;
}

function plainStay(temporalResult = {}, confirmedInputs = {}) {
  const confirmed = confirmedInputs.stay || {};
  return {
    checkIn: temporalResult.checkIn || null,
    checkOut: temporalResult.checkOut || null,
    nights: Number.isInteger(temporalResult.nights) ? temporalResult.nights : null,
    guests: Number.isInteger(confirmed.guests) ? confirmed.guests : null,
    searchRange: temporalResult.searchRange || null
  };
}

function capabilityForTemporal(task, temporalResult = {}) {
  if (task.type === "available_dates"
    && temporalResult.resolutionStatus === "resolved"
    && temporalResult.checkIn
    && temporalResult.checkOut
    && !temporalResult.searchRange) return "availability";
  return task.type;
}

function readinessFor({ task, temporalResult = {}, stay, resolvedEntity }) {
  if (!SUPPORTED_CAPABILITIES.has(task.type)) return { status: "unsupported", missingFields: [], invalidFields: [], conflictingFields: [] };
  if (temporalResult.resolutionStatus === "unresolved") return { status: "missing_information", missingFields: ["stay.checkIn"], invalidFields: [], conflictingFields: [] };
  const generic = task.entity && task.entity.category === "other" && task.entity.canonicalCandidate === null;
  if ([...INVENTORY_CAPABILITIES, "available_dates"].includes(task.type) && task.entity && task.entity.rawText && !generic && (!resolvedEntity || !["resolved", "matched_set"].includes(resolvedEntity.status))) return { status: "entity_unresolved", missingFields: [], invalidFields: [], conflictingFields: [] };
  if (task.type === "available_dates" && (!stay.searchRange || !stay.searchRange.from || !stay.searchRange.to)) return { status: "missing_information", missingFields: ["stay.searchRange"], invalidFields: [], conflictingFields: [] };
  if (INVENTORY_CAPABILITIES.has(task.type) && (!stay.checkIn || !stay.checkOut)) return { status: "missing_information", missingFields: [!stay.checkIn ? "stay.checkIn" : "stay.checkOut"], invalidFields: [], conflictingFields: [] };
  return { status: "ready", missingFields: [], invalidFields: [], conflictingFields: [] };
}

function buildFormalRequest({ property, task, requestCycleId, temporalResult, confirmedInputs, resolvedEntity, sourceEvidenceRefs = [] }) {
  const stay = plainStay(temporalResult, confirmedInputs);
  const inventory = confirmedInputs.inventory || {};
  const entity = resolvedEntity && (resolvedEntity.entity || (resolvedEntity.entities && resolvedEntity.entities[0])) || null;
  const capability = capabilityForTemporal(task, temporalResult);
  const readiness = readinessFor({ task: { ...task, type: capability }, temporalResult, stay, resolvedEntity });
  return {
    formalRequestId: stableFormalRequestId({ requestCycleId, task }), taskId: task.taskId,
    candidateIndex: task.candidateIndex, requestCycleId, propertyId: property.propertyId,
    capability,
    detailIntent: task.detailIntent || (confirmedInputs.topic && confirmedInputs.topic.detailIntent) || "general",
    requestedOutputs: Array.isArray(task.requestedOutputs) ? task.requestedOutputs : [],
    entity: { status: resolvedEntity && resolvedEntity.status || "not_requested", category: entity && entity.category || task.entity && task.entity.category || "other", rawText: task.entity && task.entity.rawText || "", canonicalId: entity && entity.canonicalId || null, canonicalSet: resolvedEntity && resolvedEntity.entities ? resolvedEntity.entities.map((item) => item.canonicalId).filter(Boolean) : (entity && entity.canonicalSet || []) },
    stay,
    inventory: { mode: inventory.mode || "any", entityId: inventory.entityId || (entity && entity.canonicalId) || null, entityIds: Array.isArray(inventory.entityIds) ? inventory.entityIds : [], features: Array.isArray(inventory.features) ? inventory.features : [] },
    topic: { ...(confirmedInputs.topic || {}), detailIntent: task.detailIntent || (confirmedInputs.topic && confirmedInputs.topic.detailIntent) || "general" },
    evidence: { sourceEvidenceRefs: Array.isArray(sourceEvidenceRefs) ? sourceEvidenceRefs : [], temporalFieldRefs: temporalResult && temporalResult.fields || {} },
    readiness,
    resolvedEntity: resolvedEntity || null
  };
}

function buildQueryPlan(formalRequest) {
  if (!formalRequest || !formalRequest.readiness || formalRequest.readiness.status !== "ready") return null;
  return {
    formalRequestId: formalRequest.formalRequestId, taskId: formalRequest.taskId, candidateIndex: formalRequest.candidateIndex,
    requestCycleId: formalRequest.requestCycleId, propertyId: formalRequest.propertyId,
    capability: formalRequest.capability,
    detailIntent: formalRequest.detailIntent,
    operation: formalRequest.capability,
    conditions: { stay: formalRequest.stay, inventory: formalRequest.inventory, topic: formalRequest.topic },
    entity: formalRequest.entity, resolvedEntity: formalRequest.resolvedEntity, expectedOutputs: formalRequest.requestedOutputs
  };
}

function resultForNotReady(formalRequest) {
  const readiness = formalRequest.readiness || {};
  return {
    taskId: formalRequest.taskId, type: formalRequest.capability,
    formalRequestId: formalRequest.formalRequestId, requestCycleId: formalRequest.requestCycleId,
    outcome: "not_ready", readinessStatus: readiness.status || "unsupported",
    missingFields: readiness.missingFields || [], invalidFields: readiness.invalidFields || [], conflictingFields: readiness.conflictingFields || [],
    facts: {}, resolverAttempted: false
  };
}

function canonicalStay(canonicalRequest, confirmedInputs = {}) {
  const temporal = canonicalRequest.temporalState;
  const confirmed = confirmedInputs.stay || {};
  return {
    checkIn: temporal.checkIn || null,
    checkOut: temporal.checkOut || null,
    nights: Number.isInteger(temporal.nights) ? temporal.nights : null,
    guests: Number.isInteger(confirmed.guests) ? confirmed.guests : null,
    searchRange: temporal.searchRange || null
  };
}

function valueAtPath({ stay }, field) {
  if (field === "stay.checkIn") return stay.checkIn;
  if (field === "stay.checkOut") return stay.checkOut;
  if (field === "stay.searchRange") return stay.searchRange;
  return null;
}

function canonicalReadiness(canonicalRequest, stay) {
  const missingFields = canonicalRequest.requiredFields
    .filter((field) => !valueAtPath({ stay }, field));
  if (missingFields.length) {
    return {
      status: "missing_information",
      missingFields: missingFields.slice(0, 1),
      invalidFields: [],
      conflictingFields: []
    };
  }
  if (canonicalRequest.resolverId === "availability_resolver"
    && ["not_found", "ambiguous"].includes(canonicalRequest.canonicalEntity.status)
    && canonicalRequest.canonicalEntity.category !== "other") {
    return {
      status: "entity_unresolved",
      missingFields: [],
      invalidFields: [],
      conflictingFields: []
    };
  }
  return {
    status: "ready",
    missingFields: [],
    invalidFields: [],
    conflictingFields: []
  };
}

function buildCanonicalFormalRequest({
  property,
  canonicalRequest,
  candidateIndex = null,
  requestCycleId,
  confirmedInputs = {}
}) {
  const request = assertCanonicalRequest(canonicalRequest);
  const stay = canonicalStay(request, confirmedInputs);
  const inventory = confirmedInputs.inventory || {};
  return {
    formalRequestId: `${String(requestCycleId || "none")}:${request.taskId}`,
    taskId: request.taskId,
    candidateIndex,
    requestCycleId,
    propertyId: property.propertyId,
    canonicalRequest: request,
    capability: request.capability,
    resolverId: request.resolverId,
    riskLevel: request.riskLevel,
    responseMode: request.responseMode,
    detailIntent: request.detailIntent,
    entity: request.canonicalEntity,
    stay,
    inventory: {
      mode: inventory.mode || "any",
      entityId: inventory.entityId || request.canonicalEntity.canonicalId || null,
      entityIds: Array.isArray(inventory.entityIds) ? inventory.entityIds : [],
      features: Array.isArray(inventory.features) ? inventory.features : []
    },
    topic: {
      ...(confirmedInputs.topic || {}),
      capabilityType: request.capability,
      canonicalId: request.canonicalEntity.canonicalId,
      category: request.canonicalEntity.category,
      detailIntent: request.detailIntent
    },
    evidence: {
      sourceEvidenceRefs: request.evidenceRefs,
      temporalFieldRefs: request.temporalState.fields || {}
    },
    readiness: canonicalReadiness(request, stay)
  };
}

function buildCanonicalQueryPlan(formalRequest) {
  if (!formalRequest || !formalRequest.readiness
    || formalRequest.readiness.status !== "ready") return null;
  const canonicalRequest = assertCanonicalRequest(formalRequest.canonicalRequest);
  return {
    formalRequestId: formalRequest.formalRequestId,
    taskId: canonicalRequest.taskId,
    candidateIndex: formalRequest.candidateIndex,
    requestCycleId: formalRequest.requestCycleId,
    propertyId: formalRequest.propertyId,
    canonicalRequest,
    capability: canonicalRequest.capability,
    resolverId: canonicalRequest.resolverId,
    riskLevel: canonicalRequest.riskLevel,
    responseMode: canonicalRequest.responseMode,
    detailIntent: canonicalRequest.detailIntent,
    operation: canonicalRequest.resolverId,
    conditions: {
      stay: formalRequest.stay,
      inventory: formalRequest.inventory,
      topic: formalRequest.topic
    },
    entity: canonicalRequest.canonicalEntity
  };
}

module.exports = {
  buildFormalRequest,
  buildQueryPlan,
  buildCanonicalFormalRequest,
  buildCanonicalQueryPlan,
  resultForNotReady,
  stableFormalRequestId
};
