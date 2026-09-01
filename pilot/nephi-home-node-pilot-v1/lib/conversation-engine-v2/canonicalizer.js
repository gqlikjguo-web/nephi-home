"use strict";

const {
  CAPABILITY_REGISTRY,
  getCapabilityDefinition
} = require("./capability-registry");
const { createCanonicalRequest } = require("./canonical-request");
const { resolveEntity } = require("./entity-resolver");
const { resolveCanonicalTemporal } = require("./temporal-resolver");
const {
  createLodgingProduct
} = require("../conversation-contracts/lodging-product");

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
      category: candidate.category === "room_feature" ? "room_feature" : resolved.entity.category || candidate.category || "other",
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

function definitionMatches(definition, task, entity) {
  return definition.acceptedCandidateTypes.includes(task.type)
    && definition.acceptedEntityCategories.includes(entity.category);
}

function selectCapabilityDefinition(task, entity) {
  const semanticDetailDefinition = task.detailIntent !== "general"
    && ["policy", "property_fact"].includes(task.type)
    && getCapabilityDefinition(task.type);
  if (semanticDetailDefinition && definitionMatches(semanticDetailDefinition, task, entity)) {
    return semanticDetailDefinition;
  }
  const entitySpecific = entity.canonicalId && getCapabilityDefinition(entity.canonicalId);
  if (entitySpecific && definitionMatches(entitySpecific, task, entity)) {
    return entitySpecific;
  }
  const exact = getCapabilityDefinition(task.type);
  if (exact && definitionMatches(exact, task, entity)) return exact;
  const matches = Object.values(CAPABILITY_REGISTRY)
    .filter((definition) => definition.acceptedCandidateTypes.includes(definition.capability))
    .filter((definition) => definitionMatches(definition, task, entity));
  if (matches.length) return matches[0];
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


function lodgingProductForCanonicalScope(reducerProduct, entity) {
  const approved = createLodgingProduct(reducerProduct || { productType: "any" });
  if (approved.productType !== "any") return approved;
  const inventory = confirmedInventory(entity);
  if (!inventory) return approved;
  return createLodgingProduct(inventory.mode === "bundle_only" ? {
    productType: "bundle",
    productId: inventory.entityId,
    bundleId: inventory.entityId
  } : {
    productType: "room_type",
    productId: inventory.entityId,
    roomTypeId: inventory.entityId
  });
}
function canonicalizeExecutionItem({
  item,
  relation,
  contextSnapshot,
  catalog,
  guestMessage,
  eventTimestamp,
  allowSharedMessageInference = false
}) {
  const plannerTask = item.task;
  const plannerStay = normalizedTaskStay(plannerTask);
  const evidenceRefs = sourceEvidenceRefsForRelation(relation);
  const reducerContext = item.transition && item.transition.contextTask || null;
  const approvedContext = reducerContext && !plannerStay.dateExpression.rawText
    ? { checkIn: reducerContext.checkIn, checkOut: reducerContext.checkOut, nights: null, sourceEvidenceRefs: [] }
    : null;
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
    allowSharedMessageInference: plannerTask.dependsOnStayContext === true
      && allowSharedMessageInference,
    applicableTaskIds: [plannerTask.taskId]
  });
  const candidateEntity = plannerTask.entity;
  const entity = canonicalEntity(catalog, candidateEntity, plannerTask.type);
  const definition = selectCapabilityDefinition(plannerTask, entity);
  const reducerProduct = item.transition && item.transition.approvedProduct;
  const canonicalRequest = createCanonicalRequest({
    taskId: plannerTask.taskId,
    capability: definition.capability,
    canonicalEntity: entity,
    lodgingProduct: lodgingProductForCanonicalScope(reducerProduct, entity),
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
Object.defineProperty(module.exports, "canonicalizeExecutionItem", {
  value: canonicalizeExecutionItem,
  enumerable: true,
  writable: false,
  configurable: false
});
