"use strict";

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
  const readiness = readinessFor({ task, temporalResult, stay, resolvedEntity });
  return {
    formalRequestId: stableFormalRequestId({ requestCycleId, task }), taskId: task.taskId,
    candidateIndex: task.candidateIndex, requestCycleId, propertyId: property.propertyId,
    capability: task.type,
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

module.exports = { buildFormalRequest, buildQueryPlan, resultForNotReady, stableFormalRequestId };
