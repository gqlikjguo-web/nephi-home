"use strict";

const {
  CAPABILITY_REGISTRY,
  getCapabilityDefinition
} = require("./capability-registry");
const { createCanonicalRequest } = require("./canonical-request");
const { resolveEntity } = require("./entity-resolver");
const { resolveCanonicalTemporal } = require("./temporal-resolver");

const DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS = 31;
const SINGLE_DATE_DEFAULT_NIGHT_RULE_REF = "PRODUCT_BASELINE:single_date_availability_default_one_night";
const AVAILABLE_DATES_LOOKAHEAD_RULE_REF = "temporal:available_dates_default_lookahead";
const INVENTORY_CANDIDATE_TYPES = new Set([
  "availability",
  "bundle_availability",
  "room_options",
  "capacity",
  "price",
  "total_price"
]);

function normalizedTaskStay(task) {
  const stay = task && task.stayCandidate || {};
  return {
    dateExpression: {
      rawText: stay.dateExpression && stay.dateExpression.rawText || "",
      kind: stay.dateExpression && stay.dateExpression.kind || "none",
      anchor: stay.dateExpression && stay.dateExpression.anchor || "none"
    },
    checkInCandidate: stay.checkInCandidate || null,
    checkOutCandidate: stay.checkOutCandidate || null,
    nightsCandidate: Number.isInteger(stay.nightsCandidate) ? stay.nightsCandidate : null,
    guestCountCandidate: Number.isInteger(stay.guestCountCandidate) ? stay.guestCountCandidate : null
  };
}

function sourceEvidenceRefsForRelation(relation) {
  return (relation && relation.evidenceRefs || []).map((evidenceRef) => ({
    eventId: String(evidenceRef && evidenceRef.eventId || "").trim(),
    messageRef: String(evidenceRef && evidenceRef.messageRef || "").trim(),
    startOffset: Number.isInteger(evidenceRef && evidenceRef.startOffset) ? evidenceRef.startOffset : 0,
    endOffset: Number.isInteger(evidenceRef && evidenceRef.endOffset) ? evidenceRef.endOffset : 0,
    quote: String(evidenceRef && evidenceRef.quote || "")
  }));
}

function approvedTemporalContext(snapshot, relation, plannerStay) {
  if (!relation || relation.stateAction !== "continue" || !relation.requestCycleId) return null;
  if (plannerStay.dateExpression.rawText && plannerStay.dateExpression.kind !== "none") return null;
  const cycle = (snapshot && snapshot.cycles || []).find((item) => item.requestCycleId === relation.requestCycleId);
  if (!cycle || !cycle.temporalResult || cycle.temporalResult.resolutionStatus !== "resolved") return null;
  const stay = cycle && cycle.confirmedInputs && cycle.confirmedInputs.stay;
  if (!stay) return null;
  const temporalFields = cycle && cycle.temporalResult && cycle.temporalResult.fields || {};
  return {
    checkIn: stay.checkIn || null,
    checkOut: stay.checkOut || null,
    nights: Number.isInteger(stay.nights) ? stay.nights : null,
    sourceEvidenceRefs: [
      ...(temporalFields.checkIn && temporalFields.checkIn.sourceEvidenceRefs || []),
      ...(temporalFields.checkOut && temporalFields.checkOut.sourceEvidenceRefs || []),
      ...(temporalFields.nights && temporalFields.nights.sourceEvidenceRefs || []),
      ...(cycle && cycle.sourceEvidenceRefs || [])
    ]
  };
}

function approvedTopicCandidate(snapshot, relation, task) {
  const entity = task && task.entity || {};
  if (entity.canonicalCandidate !== null && entity.canonicalCandidate !== undefined) return entity;
  if (!relation || relation.stateAction !== "continue" || !relation.requestCycleId) return entity;
  const cycle = (snapshot && snapshot.cycles || []).find((item) => item.requestCycleId === relation.requestCycleId);
  const topic = cycle && cycle.confirmedInputs && cycle.confirmedInputs.topic;
  const topicDefinition = topic && getCapabilityDefinition(topic.capabilityType);
  if (!topic || !topic.canonicalId || !topicDefinition
    || !topicDefinition.acceptedCandidateTypes.includes(task.type)) return entity;
  return {
    ...entity,
    category: topic.category || entity.category || "other",
    canonicalCandidate: topic.canonicalId
  };
}

function canonicalEntity(catalog, candidate, taskType) {
  const genericInventory = [...INVENTORY_CANDIDATE_TYPES, "available_dates"].includes(taskType)
    && candidate.category === "other"
    && candidate.canonicalCandidate === null
    && !candidate.rawText;
  if (genericInventory) {
    return {
      status: "not_requested",
      category: "other",
      canonicalId: null,
      canonicalSet: [],
      rawText: ""
    };
  }
  const resolved = resolveEntity(catalog, candidate);
  if (resolved && resolved.status === "resolved" && resolved.entity) {
    return {
      status: "resolved",
      category: resolved.entity.category || candidate.category || "other",
      canonicalId: String(resolved.entity.canonicalId),
      canonicalSet: [],
      rawText: String(candidate.rawText || "")
    };
  }
  if (resolved && resolved.status === "matched_set") {
    return {
      status: "matched_set",
      category: candidate.category || "other",
      canonicalId: null,
      canonicalSet: (resolved.entities || []).map((entity) => String(entity.canonicalId)).filter(Boolean),
      rawText: String(candidate.rawText || "")
    };
  }
  return {
    status: resolved && resolved.status || "not_found",
    category: candidate.category || "other",
    canonicalId: null,
    canonicalSet: [],
    rawText: String(candidate.rawText || "")
  };
}

function fieldAvailable(field, temporalState) {
  if (field === "stay.checkIn") return Boolean(temporalState.checkIn);
  if (field === "stay.checkOut") return Boolean(temporalState.checkOut);
  if (field === "stay.searchRange") {
    return Boolean(temporalState.searchRange
      && temporalState.searchRange.from
      && temporalState.searchRange.to);
  }
  return false;
}

function definitionMatches(definition, task, entity) {
  return definition.acceptedCandidateTypes.includes(task.type)
    && definition.acceptedEntityCategories.includes(entity.category);
}

function selectCapabilityDefinition(task, entity, temporalState) {
  const entitySpecific = entity.canonicalId && getCapabilityDefinition(entity.canonicalId);
  if (entitySpecific && definitionMatches(entitySpecific, task, entity)) return entitySpecific;
  const matches = Object.values(CAPABILITY_REGISTRY)
    .filter((definition) => definitionMatches(definition, task, entity));
  const ready = matches.find((definition) => definition.requiredFields.every((field) => fieldAvailable(field, temporalState)));
  if (ready) return ready;
  const exact = getCapabilityDefinition(task.type);
  if (exact && definitionMatches(exact, task, entity)) return exact;
  return getCapabilityDefinition("unknown");
}

function confirmedInventory(entity) {
  if (!entity || entity.status !== "resolved"
    || !["room", "bundle"].includes(entity.category)
    || !entity.canonicalId) return null;
  return {
    mode: entity.category === "bundle" ? "bundle_only" : "room_only",
    entityId: entity.canonicalId
  };
}

function canonicalizeExecutionItem({
  item,
  relation,
  contextSnapshot,
  catalog,
  guestMessage,
  eventTimestamp
}) {
  const plannerTask = item.task;
  const plannerStay = normalizedTaskStay(plannerTask);
  const evidenceRefs = sourceEvidenceRefsForRelation(relation);
  const approvedContext = approvedTemporalContext(contextSnapshot, relation, plannerStay);
  const temporalState = resolveCanonicalTemporal({
    guestMessage,
    candidateSourceText: plannerTask.sourceText,
    plannerCandidate: plannerStay,
    eventTimestamp,
    timezone: catalog.timezone,
    defaultNights: INVENTORY_CANDIDATE_TYPES.has(plannerTask.type) ? 1 : null,
    defaultNightsRuleRef: SINGLE_DATE_DEFAULT_NIGHT_RULE_REF,
    defaultSearchRangeDays: plannerTask.type === "available_dates"
      ? DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS
      : null,
    defaultSearchRangeRuleRef: plannerTask.type === "available_dates"
      ? AVAILABLE_DATES_LOOKAHEAD_RULE_REF
      : null,
    sourceEvidenceRefs: evidenceRefs,
    approvedContext,
    allowContextReuse: Boolean(approvedContext),
    applicableTaskIds: [plannerTask.taskId]
  });
  const candidateEntity = approvedTopicCandidate(contextSnapshot, relation, plannerTask);
  const entity = canonicalEntity(catalog, candidateEntity, plannerTask.type);
  const definition = selectCapabilityDefinition(plannerTask, entity, temporalState);
  const canonicalRequest = createCanonicalRequest({
    taskId: plannerTask.taskId,
    capability: definition.capability,
    canonicalEntity: entity,
    detailIntent: plannerTask.detailIntent || "general",
    temporalState,
    stayDependency: definition.stayDependency,
    requiredFields: definition.requiredFields,
    resolverId: definition.resolverId,
    riskLevel: definition.riskLevel,
    responseMode: definition.responseMode,
    evidenceRefs
  });
  return {
    ...item,
    canonicalRequest,
    stateInput: {
      confirmedFields: {
        guests: plannerStay.guestCountCandidate,
        nights: plannerStay.nightsCandidate,
        inventory: confirmedInventory(entity)
      },
      temporalResult: temporalState,
      hasNewDateExpression: Boolean(
        plannerStay.dateExpression.rawText
        && plannerStay.dateExpression.kind !== "none"
      ),
      sourceEvidenceRefs: evidenceRefs
    }
  };
}

module.exports = {
  canonicalizeExecutionItem,
  normalizedTaskStay,
  sourceEvidenceRefsForRelation,
  DEFAULT_AVAILABLE_DATES_LOOKAHEAD_DAYS,
  SINGLE_DATE_DEFAULT_NIGHT_RULE_REF,
  AVAILABLE_DATES_LOOKAHEAD_RULE_REF
};
