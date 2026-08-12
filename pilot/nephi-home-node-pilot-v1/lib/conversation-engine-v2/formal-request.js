"use strict";

const { assertCanonicalRequest } = require("./canonical-request");
const {
  evaluateTaskReadiness
} = require("../conversation-contracts/task-readiness");

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

function legacyProductForReadiness(inventory, entity) {
  const entityId = inventory.entityId || entity && entity.canonicalId || null;
  if (inventory.mode === "bundle_only" && entityId) return {
    productType: "bundle",
    productId: entityId,
    bundleId: entityId
  };
  if (inventory.mode === "room_only" && entityId) return {
    productType: "room_type",
    productId: entityId,
    roomTypeId: entityId
  };
  return { productType: "any", productId: null };
}

function readinessFor({ task, stay, resolvedEntity, inventory = {} }) {
  if (!SUPPORTED_CAPABILITIES.has(task.type)) return { status: "unsupported", missingFields: [], invalidFields: [], conflictingFields: [] };
  const generic = task.entity && task.entity.category === "other" && task.entity.canonicalCandidate === null;
  if ([...INVENTORY_CAPABILITIES, "available_dates"].includes(task.type) && task.entity && task.entity.rawText && !generic && (!resolvedEntity || !["resolved", "matched_set"].includes(resolvedEntity.status))) return { status: "entity_unresolved", missingFields: [], invalidFields: [], conflictingFields: [] };
  const entity = resolvedEntity && (
    resolvedEntity.entity
    || resolvedEntity.entities && resolvedEntity.entities[0]
  ) || null;
  const readiness = evaluateTaskReadiness({
    taskType: readinessTaskType(task.type),
    ...legacyProductForReadiness(inventory, entity),
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    guestCount: stay.guests,
    searchFrom: stay.searchRange && stay.searchRange.from,
    searchTo: stay.searchRange && stay.searchRange.to
  });
  return {
    status: readiness.status === "missing"
      ? "missing_information"
      : readiness.status,
    missingFields: readiness.missingFields,
    invalidFields: readiness.invalidFields,
    conflictingFields: []
  };
}

function buildFormalRequest({ property, task, requestCycleId, temporalResult, confirmedInputs, resolvedEntity, sourceEvidenceRefs = [] }) {
  const stay = plainStay(temporalResult, confirmedInputs);
  const inventory = confirmedInputs.inventory || {};
  const entity = resolvedEntity && (resolvedEntity.entity || (resolvedEntity.entities && resolvedEntity.entities[0])) || null;
  const capability = capabilityForTemporal(task, temporalResult);
  const readiness = readinessFor({
    task: { ...task, type: capability },
    stay,
    resolvedEntity,
    inventory
  });
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
    outcome: "not_ready", readinessStatus: readiness.reasonCode || readiness.status || "unsupported",
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

function readinessTaskType(capability) {
  if (["price", "total_price"].includes(capability)) return "pricing";
  if (capability === "bundle_availability") return "availability";
  return capability;
}

function canonicalReadiness(canonicalRequest, stay, uncertainties = {}) {
  const temporalReasonCode = canonicalRequest.temporalState.resolutionStatus === "unresolved"
    && canonicalRequest.temporalState.repairReasonCode === "past_date"
    ? "past_date"
    : "";
  const readiness = evaluateTaskReadiness({
    taskType: readinessTaskType(canonicalRequest.capability),
    ...canonicalRequest.lodgingProduct,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    guestCount: stay.guests,
    searchFrom: stay.searchRange && stay.searchRange.from,
    searchTo: stay.searchRange && stay.searchRange.to
  });
  const guestCountUncertain = canonicalRequest.resolverId === "availability_resolver"
    && uncertainties.guestCount === true
    && stay.guests === null;
  if (readiness.status !== "ready") return {
    status: readiness.status === "missing"
      ? "missing_information"
      : readiness.status,
    knownFields: readiness.knownFields,
    missingFields: guestCountUncertain
      ? [...new Set([...readiness.missingFields, "guestCount"])]
      : readiness.missingFields,
    invalidFields: readiness.invalidFields,
    conflictingFields: [],
    reasonCode: temporalReasonCode
  };
  if (guestCountUncertain) return {
    status: "missing_information",
    knownFields: readiness.knownFields,
    missingFields: ["guestCount"],
    invalidFields: [],
    conflictingFields: [],
    reasonCode: ""
  };
  if (canonicalRequest.resolverId === "availability_resolver"
    && ["not_found", "ambiguous"].includes(canonicalRequest.canonicalEntity.status)
    && canonicalRequest.canonicalEntity.category !== "other") {
    return {
      status: "entity_unresolved",
      knownFields: readiness.knownFields,
      missingFields: [],
      invalidFields: [],
      conflictingFields: []
    };
  }
  return {
    status: "ready",
    knownFields: readiness.knownFields,
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
  const resolverTask = {
    propertyId: property.propertyId,
    taskType: readinessTaskType(request.capability),
    productType: request.lodgingProduct.productType,
    productId: request.lodgingProduct.productId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    guestCount: stay.guests,
    ...(request.capability === "available_dates" ? {
      searchFrom: stay.searchRange && stay.searchRange.from || null,
      searchTo: stay.searchRange && stay.searchRange.to || null,
      nights: stay.nights || 1
    } : {})
  };
  return {
    formalRequestId: `${String(requestCycleId || "none")}:${request.taskId}`,
    taskId: request.taskId,
    candidateIndex,
    requestCycleId,
    propertyId: property.propertyId,
    canonicalRequest: request,
    resolverTask,
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
    readiness: canonicalReadiness(request, stay, confirmedInputs.uncertainties)
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
    resolverTask: formalRequest.resolverTask,
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
