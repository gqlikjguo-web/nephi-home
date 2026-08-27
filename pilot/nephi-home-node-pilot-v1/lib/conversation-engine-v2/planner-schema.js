"use strict";

const RELATIONS = new Set(["new_request", "continue", "modify", "answer_clarification", "new_topic", "acknowledgement"]);
const OPERATIONS = new Set(["set", "replace", "clear", "keep"]);
const TASK_TYPES = new Set(["availability", "available_dates", "room_options", "bundle_availability", "capacity", "lodging_product_capacity", "price", "total_price", "amenity", "amenity_list", "policy", "property_fact", "booking_request", "human_help", "high_risk", "unknown"]);
const ENTITY_CATEGORIES = new Set(["room", "bundle", "room_feature", "amenity", "activity", "policy", "payment", "cancellation", "transport", "check_in", "check_out", "other"]);
const DATE_KINDS = new Set(["absolute", "relative", "weekday", "weekend", "range", "contextual", "none"]);
const ANCHORS = new Set(["message_time", "previous_check_in", "previous_check_out", "none"]);
const ELIGIBILITY_EVIDENCE_KINDS = new Set(["none", "person", "room", "plan", "booking_mode", "identity", "stated_condition"]);
const CONTEXT_RELATION_KINDS = new Set(["new_request", "supplement_existing", "modify_existing", "end_existing", "relation_uncertain"]);
const SEMANTIC_KINDS = new Set(["capability", "catalog_subject", "temporal_pattern", "lodging_scope"]);
const SEMANTIC_SUBJECT_SCOPES = new Set(["property_owned", "external_place"]);
const SEMANTIC_RELATIONS = new Set(["collection_membership", "property_fact", "property_to_external_place"]);
const SEMANTIC_REQUESTED_OUTPUTS = new Set(["answer", "map_url"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const { DETAIL_INTENTS, detailFactCandidates } = require("./detail-intent");
const { resolveEntity, mentionedPropertyFacts, mentionedInventoryEntities, mentionedInventoryFeatures } = require("./entity-resolver");
const { getCapabilityDefinition } = require("./capability-registry");
const { sourceEventMaps, evidenceMatchesSource } = require("./understanding-validator");
const TASK_ID_REPAIRS = Symbol("plannerTaskIdRepairs");
const INVENTORY_SCOPE_REPAIR_REASON = Symbol("inventoryScopeRepairReason");
const STATELESS_DUPLICATE_TASK_ID_TYPES = new Set(["amenity", "amenity_list", "policy", "property_fact"]);
const INVENTORY_OUTPUT_TYPES = new Set(["price", "total_price"]);
const INVENTORY_OUTPUT_REPAIRABLE_TYPES = new Set(["availability", "bundle_availability", "room_options", "amenity", "policy", "property_fact"]);
const POLICY_DETAIL_INTENTS = new Set([
  "latest_arrival_policy",
  "early_arrival_policy",
  "late_departure_policy",
  "reservation_required",
  "usage_restrictions",
  "room_or_bundle_restriction",
  "child_restrictions",
  "seasonal_restrictions",
  "weather_restrictions"
]);
const PLANNER_OPERATION_PATHS = new Set([
  "*",
  "stay.dateExpression.rawText",
  "stay.dateExpression.kind",
  "stay.dateExpression.anchor",
  "stay.checkInCandidate",
  "stay.checkOutCandidate",
  "stay.nightsCandidate",
  "stay.guestCountCandidate",
  "inventory.mode",
  "inventory.entityId",
  "inventory.features"
]);

function confidence(value) { return typeof value === "number" && value >= 0 && value <= 1; }
function text(value, limit = 500) { return typeof value === "string" && value.length <= limit; }
function normalizedText(value) { return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("zh-TW"); }
function normalizeEligibilityEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "none", sourceText: "" };
  const kind = ELIGIBILITY_EVIDENCE_KINDS.has(value.kind) ? value.kind : "none";
  return { kind, sourceText: kind === "none" ? "" : String(value.sourceText || "").slice(0, 200) };
}
function hasExplicitEligibilityEvidence(task) {
  const evidence = normalizeEligibilityEvidence(task && task.eligibilityEvidence);
  const source = normalizedText(task && task.sourceText);
  const excerpt = normalizedText(evidence.sourceText);
  return evidence.kind !== "none" && Boolean(excerpt) && source.includes(excerpt);
}
function validStayCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expression = value.dateExpression;
  return Boolean(expression && typeof expression === "object" && !Array.isArray(expression)
    && text(expression.rawText || "", 200) && DATE_KINDS.has(expression.kind) && ANCHORS.has(expression.anchor)
    && (value.checkInCandidate === null || text(value.checkInCandidate, 40))
    && (value.checkOutCandidate === null || text(value.checkOutCandidate, 40))
    && (value.nightsCandidate === null || Number.isInteger(value.nightsCandidate) && value.nightsCandidate >= 1 && value.nightsCandidate <= 60)
    && (value.guestCountCandidate === null || Number.isInteger(value.guestCountCandidate) && value.guestCountCandidate >= 1 && value.guestCountCandidate <= 100));
}
function validEvidenceRefShape(ref) {
  return Boolean(ref && typeof ref === "object" && !Array.isArray(ref)
    && text(ref.eventId || "", 120) && text(ref.messageRef || "", 120)
    && Number.isInteger(ref.startOffset) && ref.startOffset >= 0
    && Number.isInteger(ref.endOffset) && ref.endOffset >= ref.startOffset
    && text(ref.quote, 500) && ref.quote.length > 0);
}
function validSemanticCandidateShape(candidate) {
  const scope = candidate && candidate.lodgingScopeCandidate;
  const temporal = candidate && candidate.temporalSemanticCandidate;
  return Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate)
    && UUID_PATTERN.test(String(candidate.candidateId || ""))
    && SEMANTIC_KINDS.has(candidate.semanticKind) && TASK_TYPES.has(candidate.capability)
    && (candidate.canonicalIdentityCandidate === null || text(candidate.canonicalIdentityCandidate, 120))
    && Array.isArray(candidate.evidenceRefs) && candidate.evidenceRefs.length >= 1 && candidate.evidenceRefs.every(validEvidenceRefShape)
    && (candidate.propertyCatalogIdentity === null || text(candidate.propertyCatalogIdentity, 120))
    && (scope === null || scope && typeof scope === "object" && !Array.isArray(scope)
      && UUID_PATTERN.test(String(scope.scopeId || ""))
      && (scope.bundleCanonicalCandidate === null || text(scope.bundleCanonicalCandidate, 120))
      && Array.isArray(scope.roomCanonicalCandidates) && scope.roomCanonicalCandidates.length <= 12
      && scope.roomCanonicalCandidates.every((id) => text(id, 120))
      && (scope.guestCountCandidate === null || Number.isInteger(scope.guestCountCandidate) && scope.guestCountCandidate >= 1 && scope.guestCountCandidate <= 100))
    && (temporal === null || temporal && typeof temporal === "object" && !Array.isArray(temporal)
      && text(temporal.rawText || "", 200) && DATE_KINDS.has(temporal.kind) && ANCHORS.has(temporal.anchor)));
}
function validSemanticGroundingShape(grounding) {
  const subject = grounding && grounding.subject;
  return Boolean(grounding && typeof grounding === "object" && !Array.isArray(grounding)
    && text(grounding.groundingId, 80) && grounding.groundingId.trim()
    && Array.isArray(grounding.provenanceRelationCandidateIndexes)
    && grounding.provenanceRelationCandidateIndexes.length === 1
    && grounding.provenanceRelationCandidateIndexes.every((value) => Number.isInteger(value) && value >= 0)
    && Array.isArray(grounding.evidenceRefs) && grounding.evidenceRefs.length >= 1 && grounding.evidenceRefs.length <= 12
    && grounding.evidenceRefs.every(validEvidenceRefShape)
    && subject && typeof subject === "object" && !Array.isArray(subject)
    && SEMANTIC_SUBJECT_SCOPES.has(subject.scope)
    && (subject.catalogIdentity === null || text(subject.catalogIdentity, 120) && subject.catalogIdentity.trim())
    && SEMANTIC_RELATIONS.has(grounding.relation)
    && SEMANTIC_REQUESTED_OUTPUTS.has(grounding.requestedOutput));
}
function controlledRequestedOutputs(task) {
  if (task.entity && task.entity.category === "transport") return ["map_url"];
  if (["amenity", "policy", "property_fact"].includes(task.type)) return [task.detailIntent === "general" ? "answer" : task.detailIntent];
  return task.requestedOutputs;
}

function requestedInventoryType(task) {
  const requestedOutputs = new Set(Array.isArray(task && task.requestedOutputs) ? task.requestedOutputs : []);
  if (requestedOutputs.size !== 1) return null;
  const [requested] = requestedOutputs;
  return INVENTORY_OUTPUT_TYPES.has(requested) ? requested : null;
}

function normalizedInventoryTaskShape(task, type, fallbackStayCandidate = null) {
  const entity = task && task.entity;
  const inventoryEntity = entity && ["room", "bundle"].includes(entity.category)
    ? entity
    : { ...entity, category: "other", rawText: "", canonicalCandidate: null };
  return {
    ...task,
    type,
    requestedOutputs: [type],
    dependsOnStayContext: true,
    stayCandidate: authoritativeStayCandidate(task.stayCandidate, fallbackStayCandidate),
    entity: inventoryEntity
  };
}

function normalizedStatefulInventoryTaskShape(task, fallbackStayCandidate = null, catalog = null, verifiedSourceText = "", formalPropertyRepresentedBySibling = false) {
  const requestedType = requestedInventoryType(task);
  if (!requestedType || task.type !== requestedType || task.dependsOnStayContext !== true
    || !task.entity || ["room", "bundle", "other"].includes(task.entity.category)) return null;
  const inventoryMentions = catalog && verifiedSourceText
    ? mentionedInventoryEntities(catalog, verifiedSourceText)
    : [];
  const sourceBoundEntity = inventoryMentions.length === 1
    ? inventoryMentions[0]
    : null;
  const formalMentions = !sourceBoundEntity && verifiedSourceText
    ? mentionedPropertyFacts(catalog, verifiedSourceText)
    : [];
  const formalPropertyEntity = formalMentions.length === 1 && task.entity.canonicalCandidate
    ? resolveEntity(catalog, {
        category: "other",
        rawText: "",
        canonicalCandidate: task.entity.canonicalCandidate
      })
    : null;
  if (formalPropertyEntity
    && formalPropertyEntity.status === "resolved"
    && formalPropertyEntity.entity
    && formalPropertyEntity.entity.canonicalId === formalMentions[0].entity.canonicalId
    && !["room", "bundle"].includes(formalPropertyEntity.entity.category)
    && !formalPropertyRepresentedBySibling) return null;
  const normalized = normalizedInventoryTaskShape(sourceBoundEntity ? {
    ...task,
    entity: {
      ...task.entity,
      rawText: sourceBoundEntity.mention,
      category: sourceBoundEntity.entity.category,
      canonicalCandidate: sourceBoundEntity.entity.canonicalId
    }
  } : task, requestedType, fallbackStayCandidate);
  if (sourceBoundEntity) Object.defineProperty(normalized, INVENTORY_SCOPE_REPAIR_REASON, {
    value: "source_bound_inventory_scope_preservation",
    enumerable: false,
    configurable: true
  });
  return normalized;
}

function authoritativeStayCandidate(taskStayCandidate, topLevelStayCandidate) {
  if (stayCandidateHasInventoryScope(taskStayCandidate)) return taskStayCandidate;
  if (stayCandidateHasInventoryScope(topLevelStayCandidate)) return topLevelStayCandidate;
  return taskStayCandidate || topLevelStayCandidate;
}

function stayCandidateHasInventoryScope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expression = value.dateExpression;
  return Boolean(expression && (String(expression.rawText || "").trim() || expression.kind !== "none")
    || value.checkInCandidate !== null && value.checkInCandidate !== undefined
    || value.checkOutCandidate !== null && value.checkOutCandidate !== undefined
    || value.nightsCandidate !== null && value.nightsCandidate !== undefined
    || value.guestCountCandidate !== null && value.guestCountCandidate !== undefined);
}

function normalizedSourceBoundInventoryFeatureTaskShape(task, fallbackStayCandidate = null, catalog = null, verifiedSourceText = "") {
  const entity = task && task.entity;
  if (!entity || task.type !== "availability" || task.detailIntent !== "general"
    || !["room", "bundle"].includes(entity.category)
    || !catalog || !verifiedSourceText
    || stayCandidateHasInventoryScope(task.stayCandidate)
    || stayCandidateHasInventoryScope(fallbackStayCandidate)) return null;
  const featureMentions = mentionedInventoryFeatures(catalog, verifiedSourceText);
  if (featureMentions.length !== 1) return null;
  const normalized = {
    ...task,
    type: "amenity",
    requestedOutputs: ["answer"],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: {
      ...entity,
      category: "amenity",
      canonicalCandidate: null
    }
  };
  Object.defineProperty(normalized, INVENTORY_SCOPE_REPAIR_REASON, {
    value: "source_bound_inventory_feature_capability",
    enumerable: false,
    configurable: true
  });
  return normalized;
}


function registeredFaqCapabilityTask(task, catalog, verifiedSourceText = "", siblingFormalIds = new Set()) {
  if (!task || !task.entity || !catalog
    || !["price", "total_price"].includes(task.type)
    || ["room", "bundle", "other"].includes(task.entity.category)
    || task.dependsOnStayContext !== true
    || !(task.requestedOutputs || []).some((output) => ["price", "total_price"].includes(output))) return null;
  const sourceText = String(task.sourceText || "").trim();
  const verifiedSource = normalizedText(verifiedSourceText);
  if (!sourceText || !verifiedSource || verifiedSource !== normalizedText(sourceText)) return null;
  const candidates = mentionedPropertyFacts(catalog, sourceText).filter(({ entity }) => {
    const definition = entity && getCapabilityDefinition(entity.canonicalId);
    return entity && entity.sourceKind === "faq" && definition && definition.resolverId === "property_catalog"
      && definition.stayDependency === false
      && definition.riskLevel === "low"
      && definition.responseMode === "answer";
  });
  if (candidates.length !== 1) return null;
  const { entity: resolved, mention } = candidates[0];
  const candidateId = String(task.entity.canonicalCandidate || "").trim();
  if (candidateId && candidateId !== resolved.canonicalId || siblingFormalIds.has(resolved.canonicalId)) return null;
  const definition = getCapabilityDefinition(resolved.canonicalId);
  const type = ["property_fact", "amenity", "policy"].find((candidateType) => definition.acceptedCandidateTypes.includes(candidateType)
    && definition.acceptedEntityCategories.includes(resolved.category));
  if (!type) return null;
  return {
    ...task,
    type,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: {
      ...task.entity,
      category: resolved.category,
      rawText: mention,
      canonicalCandidate: resolved.canonicalId
    }
  };
}
function groundedPropertyFactTask(task, catalog, fallbackStayCandidate = null, verifiedSourceText = "", currentRequestFormalSubject = null) {
  const entity = task && task.entity;
  if (!catalog || !entity || ["booking_request", "human_help", "high_risk"].includes(task.type)) return null;
  const rawGrounded = entity.rawText
    ? resolveEntity(catalog, {
      category: "other",
      rawText: entity.rawText,
      canonicalCandidate: null
    })
    : null;
  const scopedRawGrounded = entity.rawText
    && entity.category !== "other"
    && (!rawGrounded || rawGrounded.status === "not_found")
    ? resolveEntity(catalog, {
        category: entity.category,
        rawText: entity.rawText,
        canonicalCandidate: null
      })
    : null;
  const canonicalGrounded = entity.canonicalCandidate
    ? resolveEntity(catalog, {
        category: "other",
        rawText: "",
        canonicalCandidate: entity.canonicalCandidate
      })
    : null;
  const candidateGrounded = canonicalGrounded
    && (!rawGrounded || rawGrounded.status === "not_found")
    && (!scopedRawGrounded || scopedRawGrounded.status === "not_found")
    ? canonicalGrounded
    : null;
  const sourceBoundRaw = normalizedText(entity.rawText);
  const sourceBoundTask = normalizedText(task.sourceText);
  const verifiedSource = normalizedText(verifiedSourceText);
  const canonicalIdentityTokens = normalizedText(entity.canonicalCandidate).match(/[\p{L}\p{N}]+/gu) || [];
  const sourceIdentityTokens = sourceBoundRaw.match(/[\p{L}\p{N}]+/gu) || [];
  const sourceNamesCanonicalIdentity = canonicalIdentityTokens.length > 0
    && canonicalIdentityTokens.every((token) => sourceIdentityTokens.includes(token));
  const formalTextIdentityMatches = Object.values(catalog)
    .filter(Array.isArray)
    .flat()
    .filter((fact) => fact && (fact.answer || ["confirmed_yes", "confirmed_no"].includes(fact.status)))
    .flatMap((fact) => fact && fact.canonicalId
      ? [fact.publicName, ...(fact.aliases || []), fact.answer]
        .map((value) => ({ canonicalId: fact.canonicalId, text: normalizedText(value) }))
      : [])
    .filter((match) => match.text && sourceBoundRaw.includes(match.text));
  const longestFormalTextLength = formalTextIdentityMatches.reduce(
    (longest, match) => Math.max(longest, match.text.length),
    0
  );
  const formalTextIdentityIds = new Set(formalTextIdentityMatches
    .filter((match) => match.text.length === longestFormalTextLength)
    .map((match) => match.canonicalId));
  const sourceIdentityIds = new Set([
    rawGrounded && rawGrounded.status === "resolved" && rawGrounded.entity && rawGrounded.entity.canonicalId,
    scopedRawGrounded && scopedRawGrounded.status === "resolved" && scopedRawGrounded.entity && scopedRawGrounded.entity.canonicalId,
    ...mentionedPropertyFacts(catalog, entity.rawText).map(({ entity: fact }) => fact && fact.canonicalId),
    ...mentionedInventoryEntities(catalog, entity.rawText).map(({ entity: inventory }) => inventory && inventory.canonicalId),
    ...formalTextIdentityIds,
    sourceNamesCanonicalIdentity && canonicalGrounded && canonicalGrounded.status === "resolved"
      ? canonicalGrounded.entity.canonicalId
      : null
  ].filter(Boolean));
  const directlyResolvedSourceIdentityIds = new Set([
    rawGrounded && rawGrounded.status === "resolved" && rawGrounded.entity && rawGrounded.entity.canonicalId,
    scopedRawGrounded && scopedRawGrounded.status === "resolved" && scopedRawGrounded.entity && scopedRawGrounded.entity.canonicalId
  ].filter(Boolean));
  const authoritativeSourceIdentityIds = directlyResolvedSourceIdentityIds.size === 1
    ? directlyResolvedSourceIdentityIds
    : sourceIdentityIds;
  const taskLocalAuthoritativeSourceIdentityIds = sourceBoundRaw && verifiedSource.includes(sourceBoundRaw)
    ? authoritativeSourceIdentityIds
    : new Set();
  const sourceBaseCanonicalId = authoritativeSourceIdentityIds.size === 1
    ? [...authoritativeSourceIdentityIds][0]
    : "";
  const sourceBaseGrounded = sourceBaseCanonicalId
    ? resolveEntity(catalog, {
        category: "other",
        rawText: "",
        canonicalCandidate: sourceBaseCanonicalId
      })
    : null;
  const sourceBaseEntity = sourceBaseGrounded
    && sourceBaseGrounded.status === "resolved"
    && sourceBaseGrounded.entity;
  const capabilityDefinition = getCapabilityDefinition(task.type);
  const sourceBoundCatalogFeeEntity = sourceBoundRaw
    && verifiedSource.includes(sourceBoundRaw)
    && ["price", "total_price"].includes(task.type)
    && task.detailIntent === "fee"
    && entity.canonicalCandidate
    && canonicalGrounded && canonicalGrounded.status === "resolved"
    && authoritativeSourceIdentityIds.size === 1
    && authoritativeSourceIdentityIds.has(canonicalGrounded.entity.canonicalId)
    && !["room", "bundle", "other"].includes(canonicalGrounded.entity.category)
    ? canonicalGrounded.entity
    : verifiedSource
      && ["price", "total_price"].includes(task.type)
      && task.detailIntent === "general"
      && currentRequestFormalSubject
      && taskLocalAuthoritativeSourceIdentityIds.size === 0
      && !stayCandidateHasInventoryScope(task.stayCandidate)
      && !stayCandidateHasInventoryScope(fallbackStayCandidate)
      ? currentRequestFormalSubject
      : null;
  const sourceBoundCatalogFeeDefinition = sourceBoundCatalogFeeEntity
    ? getCapabilityDefinition(sourceBoundCatalogFeeEntity.canonicalId)
      || getCapabilityDefinition(["amenity", "activity", "room_feature"].includes(sourceBoundCatalogFeeEntity.category)
        ? "amenity"
        : "policy")
    : null;
  const sourceBoundCatalogFee = sourceBoundCatalogFeeDefinition
    && sourceBoundCatalogFeeDefinition.resolverId === "property_catalog"
    && sourceBoundCatalogFeeDefinition.stayDependency === false
    && sourceBoundCatalogFeeDefinition.riskLevel === "low"
    && sourceBoundCatalogFeeDefinition.responseMode === "answer"
    && sourceBoundCatalogFeeDefinition.acceptedEntityCategories.includes(sourceBoundCatalogFeeEntity.category);
  if (sourceBoundCatalogFee) {
    const preferredType = ["amenity", "activity", "room_feature"].includes(sourceBoundCatalogFeeEntity.category)
      ? "amenity"
      : "policy";
    const type = sourceBoundCatalogFeeDefinition.acceptedCandidateTypes.includes(preferredType)
      ? preferredType
      : sourceBoundCatalogFeeDefinition.acceptedCandidateTypes[0];
    return {
      ...task,
      type,
      detailIntent: "fee",
      requestedOutputs: ["fee"],
      dependsOnStayContext: false,
      stayCandidate: null,
      entity: {
        ...entity,
        category: sourceBoundCatalogFeeEntity.category,
        canonicalCandidate: sourceBoundCatalogFeeEntity.canonicalId
      }
    };
  }
  const collidingCanonicalId = canonicalGrounded && canonicalGrounded.status === "resolved"
    && canonicalGrounded.entity && canonicalGrounded.entity.canonicalId || "";
  const collidingCanonicalDefinition = collidingCanonicalId
    ? getCapabilityDefinition(collidingCanonicalId)
    : null;
  const sourceIdentityAgreesWithCollision = authoritativeSourceIdentityIds.size === 0
    || authoritativeSourceIdentityIds.size === 1
      && authoritativeSourceIdentityIds.has(collidingCanonicalId);
  const statefulLodgingAmountIdentityCollision = ["price", "total_price"].includes(task.type)
    && task.detailIntent === "general"
    && Array.isArray(task.requestedOutputs)
    && task.requestedOutputs.length === 1
    && task.requestedOutputs[0] === task.type
    && task.dependsOnStayContext === true
    && task.stayCandidate
    && !["room", "bundle"].includes(entity.category)
    && capabilityDefinition
    && capabilityDefinition.resolverId === "availability_resolver"
    && capabilityDefinition.stayDependency === "required"
    && capabilityDefinition.riskLevel === "low"
    && capabilityDefinition.responseMode === "answer"
    && collidingCanonicalId
    && !["room", "bundle"].includes(canonicalGrounded.entity.category)
    && collidingCanonicalDefinition
    && collidingCanonicalDefinition.resolverId === "availability_resolver"
    && collidingCanonicalDefinition.stayDependency === "required"
    && sourceIdentityAgreesWithCollision;
  if (statefulLodgingAmountIdentityCollision) return {
    ...task,
    entity: { ...entity, category: "other", rawText: "", canonicalCandidate: null }
  };
  const sourceBoundFormalDetail = sourceBoundRaw
    && verifiedSource.includes(sourceBoundRaw)
    && task.type === "policy"
    && task.detailIntent !== "general"
    && entity.canonicalCandidate
    && canonicalGrounded && canonicalGrounded.status === "resolved"
    && sourceBaseEntity
    && sourceBaseEntity.canonicalId !== canonicalGrounded.entity.canonicalId
    && sourceBaseEntity.category === canonicalGrounded.entity.category
    && detailFactCandidates(sourceBaseEntity.canonicalId, task.detailIntent)
      .includes(canonicalGrounded.entity.canonicalId)
    && capabilityDefinition
    && capabilityDefinition.resolverId === "property_catalog"
    && capabilityDefinition.stayDependency === false
    && capabilityDefinition.riskLevel === "low"
    && capabilityDefinition.responseMode === "answer"
    && capabilityDefinition.acceptedCandidateTypes.includes(task.type)
    && capabilityDefinition.acceptedEntityCategories.includes(sourceBaseEntity.category);
  if (sourceBoundFormalDetail) return {
    ...task,
    entity: {
      ...entity,
      category: sourceBaseEntity.category,
      canonicalCandidate: sourceBaseEntity.canonicalId
    }
  };
  const canonicalFormalMatches = entity.canonicalCandidate
    && canonicalGrounded && canonicalGrounded.status === "resolved"
    ? Object.values(catalog)
      .filter(Array.isArray)
      .flat()
      .filter((fact) => fact && fact.canonicalId === canonicalGrounded.entity.canonicalId)
    : [];
  const sourceBoundFormalCategory = sourceBoundRaw
    && verifiedSource.includes(sourceBoundRaw)
    && entity.canonicalCandidate
    && canonicalGrounded && canonicalGrounded.status === "resolved"
    && canonicalFormalMatches.length === 1
    && authoritativeSourceIdentityIds.size === 1
    && authoritativeSourceIdentityIds.has(canonicalGrounded.entity.canonicalId)
    && capabilityDefinition
    && capabilityDefinition.resolverId === "property_catalog"
    && capabilityDefinition.stayDependency === false
    && capabilityDefinition.riskLevel === "low"
    && capabilityDefinition.responseMode === "answer"
    && capabilityDefinition.acceptedCandidateTypes.includes(task.type)
    && capabilityDefinition.acceptedEntityCategories.includes(canonicalGrounded.entity.category);
  if (sourceBoundFormalCategory) return {
    ...task,
    entity: {
      ...entity,
      category: canonicalGrounded.entity.category,
      canonicalCandidate: canonicalGrounded.entity.canonicalId
    }
  };
  const formalCategoryTaskType = canonicalGrounded && canonicalGrounded.status === "resolved"
    ? ["amenity", "activity", "room_feature"].includes(canonicalGrounded.entity.category)
      ? "amenity"
      : ["policy", "payment", "cancellation", "check_in", "check_out"].includes(canonicalGrounded.entity.category)
        ? "policy"
        : canonicalGrounded.entity.category === "transport"
          ? "property_fact"
          : null
    : null;
  const formalCategoryDefinition = formalCategoryTaskType
    ? getCapabilityDefinition(formalCategoryTaskType)
    : null;
  const safeStatelessPropertyDefinition = (definition) => definition
    && definition.resolverId === "property_catalog"
    && definition.stayDependency === false
    && definition.riskLevel === "low"
    && definition.responseMode === "answer";
  const sourceBoundStatelessCategoryDrift = catalog.propertyId
    && task.detailIntent === "general"
    && sourceBoundRaw
    && verifiedSource.includes(sourceBoundRaw)
    && entity.canonicalCandidate
    && canonicalGrounded && canonicalGrounded.status === "resolved"
    && authoritativeSourceIdentityIds.size === 1
    && authoritativeSourceIdentityIds.has(canonicalGrounded.entity.canonicalId)
    && !["room", "bundle"].includes(canonicalGrounded.entity.category)
    && safeStatelessPropertyDefinition(capabilityDefinition)
    && capabilityDefinition.acceptedCandidateTypes.includes(task.type)
    && safeStatelessPropertyDefinition(formalCategoryDefinition)
    && formalCategoryDefinition.acceptedCandidateTypes.includes(formalCategoryTaskType)
    && formalCategoryDefinition.acceptedEntityCategories.includes(canonicalGrounded.entity.category);
  if (sourceBoundStatelessCategoryDrift) return {
    ...task,
    type: formalCategoryTaskType,
    requestedOutputs: canonicalGrounded.entity.category === "transport" ? ["map_url"] : ["answer"],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: {
      ...entity,
      category: canonicalGrounded.entity.category,
      canonicalCandidate: canonicalGrounded.entity.canonicalId
    }
  };
  const sourceBoundCurrentPropertyGeneralSubject = catalog.propertyId
    && task.detailIntent === "general"
    && sourceBoundRaw
    && verifiedSource.includes(sourceBoundRaw)
    && entity.canonicalCandidate
    && (!canonicalGrounded || canonicalGrounded.status === "not_found")
    && authoritativeSourceIdentityIds.size === 1
    && sourceBaseEntity
    && !["room", "bundle"].includes(sourceBaseEntity.category)
    && capabilityDefinition
    && capabilityDefinition.resolverId === "property_catalog"
    && capabilityDefinition.stayDependency === false
    && capabilityDefinition.riskLevel === "low"
    && capabilityDefinition.responseMode === "answer"
    && capabilityDefinition.acceptedCandidateTypes.includes(task.type)
    && capabilityDefinition.acceptedEntityCategories.includes(sourceBaseEntity.category);
  if (sourceBoundCurrentPropertyGeneralSubject) return {
    ...task,
    requestedOutputs: sourceBaseEntity.category === "transport" ? ["map_url"] : ["answer"],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: {
      ...entity,
      category: sourceBaseEntity.category,
      canonicalCandidate: sourceBaseEntity.canonicalId
    }
  };
  const sourceBoundCanonicalConflict = sourceBoundRaw
    && verifiedSource.includes(sourceBoundRaw)
    && entity.canonicalCandidate
    && canonicalGrounded && canonicalGrounded.status === "resolved"
    && (authoritativeSourceIdentityIds.size > 0
      ? authoritativeSourceIdentityIds.size !== 1 || !authoritativeSourceIdentityIds.has(canonicalGrounded.entity.canonicalId)
      : entity.category !== canonicalGrounded.entity.category);
  if (sourceBoundCanonicalConflict) return {
    ...task,
    type: "unknown",
    detailIntent: "general",
    requestedOutputs: ["answer"],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: { ...entity, category: "other", canonicalCandidate: null }
  };
  return null;
  const mentionedFacts = ["availability", "amenity"].includes(task.type)
    && ["time", "start_time", "end_time"].includes(task.detailIntent)
    && sourceBoundRaw
    && verifiedSource.includes(sourceBoundRaw)
    ? mentionedPropertyFacts(catalog, entity.rawText)
      .filter(({ entity: fact }) => fact && fact.category === "amenity")
    : [];
  const sourceMentionGrounded = mentionedFacts.length === 1
    ? { status: "resolved", entity: mentionedFacts[0].entity }
    : null;
  const rawInventoryGrounded = rawGrounded && (rawGrounded.status === "resolved"
    ? ["room", "bundle"].includes(rawGrounded.entity && rawGrounded.entity.category)
    : rawGrounded.status === "matched_set"
      && Array.isArray(rawGrounded.entities)
      && rawGrounded.entities.length > 0
      && rawGrounded.entities.every((item) => item && ["room", "bundle"].includes(item.category)));
  const inventoryOutputsRequested = (Array.isArray(task.requestedOutputs) ? task.requestedOutputs : [])
    .some((output) => ["availability", "available_dates", "room_options", "bundle_availability", "capacity", "price", "total_price"].includes(output));
  const taskSourceFacts = ["availability", "amenity"].includes(task.type)
    && ["time", "start_time", "end_time"].includes(task.detailIntent)
    && task.dependsOnStayContext === false
    && !inventoryOutputsRequested
    && sourceBoundTask
    && verifiedSource.includes(sourceBoundTask)
    && (!sourceBoundRaw || sourceBoundTask.includes(sourceBoundRaw) && rawInventoryGrounded)
    ? mentionedPropertyFacts(catalog, task.sourceText)
    : [];
  const taskSourceMentionGrounded = taskSourceFacts.length === 1
    ? { status: "resolved", entity: taskSourceFacts[0].entity }
    : null;
  const grounded = rawGrounded && rawGrounded.status === "resolved" && !rawInventoryGrounded
    ? rawGrounded
    : scopedRawGrounded && scopedRawGrounded.status !== "not_found"
      ? scopedRawGrounded
      : candidateGrounded && candidateGrounded.status !== "not_found"
        ? candidateGrounded
        : taskSourceMentionGrounded || sourceMentionGrounded || candidateGrounded || scopedRawGrounded || rawGrounded;
  const groundedEntity = grounded
    && grounded.status === "resolved"
    && grounded.entity;
  const resolved = groundedEntity || null;
  const plannerTypeDefinition = resolved && getCapabilityDefinition(task.type);
  const plannerTypeAcceptsResolvedEntity = Boolean(plannerTypeDefinition
    && plannerTypeDefinition.resolverId === "property_catalog"
    && plannerTypeDefinition.stayDependency === false
    && plannerTypeDefinition.riskLevel === "low"
    && plannerTypeDefinition.responseMode === "answer"
    && plannerTypeDefinition.acceptedCandidateTypes.includes(task.type)
    && plannerTypeDefinition.acceptedEntityCategories.includes(resolved.category));
  const policyRestriction = resolved
    && ["availability", "amenity"].includes(task.type)
    && POLICY_DETAIL_INTENTS.has(task.detailIntent);
  const preferredType = resolved && (policyRestriction
    ? "policy"
    : resolved.category === "transport" || resolved.sourceKind === "faq"
      ? "property_fact"
      : plannerTypeAcceptsResolvedEntity && task.detailIntent !== "general"
        ? task.type
        : resolved.category === "policy"
          ? "policy"
          : "amenity");
  const exactDefinition = resolved && getCapabilityDefinition(resolved.canonicalId);
  if (resolved && exactDefinition
    && resolved.sourceKind !== "faq"
    && task.detailIntent === "general"
    && exactDefinition.resolverId === "availability_resolver"
    && exactDefinition.riskLevel === "low"
    && exactDefinition.responseMode === "answer") return {
    ...task,
    type: exactDefinition.capability,
    detailIntent: task.detailIntent || "general",
    requestedOutputs: [exactDefinition.capability],
    dependsOnStayContext: true,
    stayCandidate: authoritativeStayCandidate(task.stayCandidate, fallbackStayCandidate),
    entity: {
      ...entity,
      rawText: "",
      category: "other",
      canonicalCandidate: null
    }
  };
  const useExactPropertyDefinition = resolved && exactDefinition
    && resolved.sourceKind !== "faq"
    && !policyRestriction
    && (task.detailIntent === "general" || !["policy", "property_fact"].includes(task.type))
    && exactDefinition.resolverId === "property_catalog"
    && exactDefinition.stayDependency === false
    && exactDefinition.riskLevel === "low"
    && exactDefinition.responseMode === "answer"
    && exactDefinition.acceptedCandidateTypes.includes(task.type)
    && exactDefinition.acceptedEntityCategories.includes(resolved.category);
  const definition = resolved && (useExactPropertyDefinition
    ? exactDefinition
    : getCapabilityDefinition(preferredType));
  if (!resolved || !definition
    || definition.resolverId !== "property_catalog"
    || definition.stayDependency !== false
    || definition.riskLevel !== "low"
    || definition.responseMode !== "answer"
    || !definition.acceptedEntityCategories.includes(resolved.category)) return null;
  const type = definition.acceptedCandidateTypes.includes(preferredType)
    ? preferredType
    : definition.acceptedCandidateTypes[0];
  const detailIntent = task.detailIntent || "general";
  return {
    ...task,
    type,
    detailIntent,
    requestedOutputs: resolved.category === "transport" ? ["map_url"] : [detailIntent === "general" ? "answer" : detailIntent],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: {
      ...entity,
      rawText: grounded === taskSourceMentionGrounded ? taskSourceFacts[0].mention : entity.rawText,
      category: resolved.category,
      canonicalCandidate: resolved.canonicalId
    }
  };
}

function normalizedPolicyRestrictionTaskShape(task, catalog = null) {
  const entity = task && task.entity;
  if (!entity || !["availability", "amenity"].includes(task.type)
    || !POLICY_DETAIL_INTENTS.has(task.detailIntent)) return null;
  const resolvedInventory = task.type === "availability"
    && catalog
    && ["room", "bundle"].includes(entity.category)
    ? resolveEntity(catalog, entity)
    : null;
  if (resolvedInventory
    && resolvedInventory.status === "resolved"
    && resolvedInventory.entity
    && resolvedInventory.entity.category === entity.category) return {
    ...task,
    [INVENTORY_SCOPE_REPAIR_REASON]: "resolved_inventory_detail_scope_preservation"
  };
  const definition = getCapabilityDefinition("policy");
  const policyEntity = definition.acceptedEntityCategories.includes(entity.category)
    ? entity
    : { ...entity, category: "policy", canonicalCandidate: null };
  return {
    ...task,
    type: "policy",
    requestedOutputs: [task.detailIntent],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: policyEntity
  };
}

function normalizedUngroundedTaskShape(task, fallbackStayCandidate = null, catalog = null) {
  const entity = task && task.entity;
  if (!entity) return task;
  const requestedInventory = requestedInventoryType(task);
  if (task.type === "policy"
    && ["amenity", "activity", "room_feature"].includes(entity.category)
    && !entity.rawText && entity.canonicalCandidate === null) return {
    ...task,
    entity: { ...entity, category: "policy" }
  };
  const policyRestrictionTask = normalizedPolicyRestrictionTaskShape(task, catalog);
  if (policyRestrictionTask) return policyRestrictionTask;
  if (requestedInventory
    && INVENTORY_OUTPUT_REPAIRABLE_TYPES.has(task.type)
    && task.detailIntent === "general") return normalizedInventoryTaskShape(
    task,
    requestedInventory,
    fallbackStayCandidate
  );
  if (task.type === "availability") {
    const standaloneType = ["amenity", "activity", "room_feature"].includes(entity.category)
        ? "amenity"
        : ["policy", "payment", "cancellation", "check_in", "check_out"].includes(entity.category)
          ? "policy"
          : entity.category === "transport"
            ? "property_fact"
            : null;
    if (standaloneType) return {
      ...task,
      type: standaloneType,
      dependsOnStayContext: false,
      stayCandidate: null
    };
  }
  const exactDefinition = getCapabilityDefinition(task.type);
  if (exactDefinition
    && !exactDefinition.acceptedEntityCategories.includes(entity.category)) {
    if (exactDefinition.resolverId === "availability_resolver"
      && exactDefinition.acceptedEntityCategories.includes("other")
      && !["room", "bundle"].includes(entity.category)) return {
      ...task,
      entity: { ...entity, category: "other", rawText: "", canonicalCandidate: null }
    };
    const category = task.type === "policy"
      ? "policy"
      : task.type === "amenity"
        ? "amenity"
        : null;
    if (category) return { ...task, entity: { ...entity, category } };
  }
  return task;
}

// Legacy planner state controls are accepted only for wire compatibility with
// the existing planner provider.  They are discarded at the schema boundary:
// no downstream component receives them as a state input.
function discardLegacyPlannerStateControls(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { stateOperations: _discarded, ...rest } = value;
  return { ...rest, stateOperations: [] };
}

function validatePlannerOutput(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["root"] };
  if (value.schemaVersion !== 2) errors.push("schemaVersion");
  if (!value.discourse || !RELATIONS.has(value.discourse.relation) || !confidence(value.discourse.confidence)) errors.push("discourse");
  if (!Array.isArray(value.stateOperations)) errors.push("stateOperations");
  else value.stateOperations.forEach((item, index) => {
    if (!item || !PLANNER_OPERATION_PATHS.has(item.field) || !OPERATIONS.has(item.operation) || !text(item.sourceText || "", 500)) errors.push(`stateOperations.${index}`);
  });
  const expression = value.stay && value.stay.dateExpression;
  if (!expression || !text(expression.rawText || "", 200) || !DATE_KINDS.has(expression.kind) || !ANCHORS.has(expression.anchor)) errors.push("stay.dateExpression");
  if (!Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > 24) errors.push("tasks");
  else {
    const taskIds = new Set();
    value.tasks.forEach((task, index) => {
      const entity = task && task.entity;
      const eligibilityEvidence = task && task.eligibilityEvidence;
      if (!task || !Number.isInteger(task.candidateIndex) || task.candidateIndex < 0 || !text(task.taskId, 80) || !TASK_TYPES.has(task.type) || !text(task.sourceText, 500) || !task.sourceText.trim()
        || (task.detailIntent !== undefined && !DETAIL_INTENTS.has(task.detailIntent)) || !Array.isArray(task.requestedOutputs) || typeof task.dependsOnStayContext !== "boolean" || !confidence(task.confidence)
        || !eligibilityEvidence || typeof eligibilityEvidence !== "object" || Array.isArray(eligibilityEvidence) || !ELIGIBILITY_EVIDENCE_KINDS.has(eligibilityEvidence.kind) || !text(eligibilityEvidence.sourceText || "", 200)
        || !entity || !ENTITY_CATEGORIES.has(entity.category) || !text(entity.rawText || "", 200) || (!entity.rawText && !["availability", "available_dates", "bundle_availability", "room_options", "capacity", "price", "total_price", "amenity", "policy"].includes(task.type))
        || !(entity.canonicalCandidate === null || text(entity.canonicalCandidate, 120)) || !confidence(entity.confidence)
        || !Object.hasOwn(task, "stayCandidate")
        || (task.dependsOnStayContext && task.stayCandidate === null)
        || (task.stayCandidate !== null && !validStayCandidate(task.stayCandidate))) errors.push(`tasks.${index}`);
      if (task && text(task.taskId, 80)) {
        if (taskIds.has(task.taskId)) errors.push("tasks.taskId.duplicate");
        taskIds.add(task.taskId);
      }
      if (!Array.isArray(task && task.semanticCandidateIds) || task.semanticCandidateIds.length < 1 || task.semanticCandidateIds.length > 24
          || task.semanticCandidateIds.some((id) => !UUID_PATTERN.test(String(id || "")))
          || !(task.lodgingScopeId === null || UUID_PATTERN.test(String(task.lodgingScopeId || "")))) errors.push('tasks.' + index + '.semanticCandidates');
    });
  }
  if (!Array.isArray(value.ambiguities)) errors.push("ambiguities");
  if (Array.isArray(value.semanticGroundings)) {
    if (value.semanticGroundings.length < 1 || value.semanticGroundings.length > 24
      || !value.semanticGroundings.every(validSemanticGroundingShape)) errors.push("semanticGroundings");
    const groundingIds = value.semanticGroundings.map((grounding) => String(grounding && grounding.groundingId || ""));
    if (new Set(groundingIds).size !== groundingIds.length) errors.push("semanticGroundings.groundingId.duplicate");
    const taskGroundingIds = (value.tasks || []).map((task) => String(task && task.groundingId || ""));
    if (taskGroundingIds.some((id) => !id || !groundingIds.includes(id))
      || new Set(taskGroundingIds).size !== taskGroundingIds.length
      || taskGroundingIds.length !== groundingIds.length) errors.push("tasks.groundingId.ownership");
  }
  const semanticCandidatesValid = Array.isArray(value.semanticCandidates) && value.semanticCandidates.length >= 1 && value.semanticCandidates.length <= 24
    && value.semanticCandidates.every(validSemanticCandidateShape);
  if (!semanticCandidatesValid) errors.push("semanticCandidates");
  else {
    if (new Set(value.semanticCandidates.map((candidate) => candidate.candidateId)).size !== value.semanticCandidates.length) errors.push("semanticCandidates.candidateId.duplicate");
    const scopeSignatures = new Map();
    for (const candidate of value.semanticCandidates) {
      const scope = candidate.lodgingScopeCandidate;
      if (!scope) continue;
      const signature = JSON.stringify(scope);
      if (scopeSignatures.has(scope.scopeId) && scopeSignatures.get(scope.scopeId) !== signature) errors.push("semanticCandidates.lodgingScope.conflict");
      else scopeSignatures.set(scope.scopeId, signature);
    }
    const knownCandidateIds = new Set(value.semanticCandidates.map((candidate) => candidate.candidateId));
    for (const task of value.tasks || []) {
      if (task && task.lodgingScopeId !== null && !scopeSignatures.has(task.lodgingScopeId)) errors.push("tasks.lodgingScopeId.orphan");
      if (task && Array.isArray(task.semanticCandidateIds) && task.semanticCandidateIds.some((candidateId) => !knownCandidateIds.has(candidateId)))
        errors.push("tasks.semanticCandidateIds.unknown");
    }
  }

  if (!Array.isArray(value.missingInformation)) errors.push("missingInformation");
  if (!Array.isArray(value.contextRelationCandidates) || value.contextRelationCandidates.some((item) => !item || !Number.isInteger(item.candidateIndex) || item.candidateIndex < 0 || !CONTEXT_RELATION_KINDS.has(item.kind) || !Array.isArray(item.candidateRequestCycleRefs) || !Array.isArray(item.evidenceRefs))) errors.push("contextRelationCandidates");
  if (typeof value.needsHuman !== "boolean" || typeof value.shouldIgnore !== "boolean" || !text(value.reason, 120)) errors.push("safety");
  return { ok: errors.length === 0, errors };
}

function sourceEventsAreUnicodeNonSubstantive(sourceEvents) {
  const messages = (Array.isArray(sourceEvents) ? sourceEvents : [])
    .map((event) => String(event && event.messageText || "").trim())
    .filter(Boolean);
  return messages.length > 0 && messages.every((message) => /^[\p{P}\p{S}\s]+$/u.test(message));
}

function normalizeDuplicateTaskIds(value) {
function evidenceOwnershipSignature(evidenceRefs) {
  return JSON.stringify((evidenceRefs || []).map((ref) => ({
    eventId: ref.eventId || "",
    messageRef: ref.messageRef || "",
    startOffset: ref.startOffset,
    endOffset: ref.endOffset,
    quote: ref.quote
  })));
}

function hasIsolatedAvailabilityOwnership(value, tasks) {
  if (!tasks.every((task) => task && task.type === "availability")) return false;
  const candidateIndexes = tasks.map((task) => task.candidateIndex);
  if (candidateIndexes.some((index) => !Number.isInteger(index) || index < 0)
    || new Set(candidateIndexes).size !== tasks.length) return false;

  const allCandidateOwners = new Map();
  for (const task of value.tasks) {
    for (const candidateId of Array.isArray(task && task.semanticCandidateIds) ? task.semanticCandidateIds : []) {
      allCandidateOwners.set(candidateId, (allCandidateOwners.get(candidateId) || 0) + 1);
    }
  }
  const semanticCandidates = Array.isArray(value.semanticCandidates) ? value.semanticCandidates : [];
  const candidatesById = new Map();
  for (const candidate of semanticCandidates) {
    const candidateId = String(candidate && candidate.candidateId || "");
    if (!UUID_PATTERN.test(candidateId) || candidatesById.has(candidateId)) return false;
    candidatesById.set(candidateId, candidate);
  }

  const relations = Array.isArray(value.contextRelationCandidates) ? value.contextRelationCandidates : [];
  const ownedIds = new Set();
  const scopeIds = new Set();
  const relationSignatures = new Set();
  const lodgingUnitSignatures = new Set();
  for (const task of tasks) {
    const candidateIds = Array.isArray(task.semanticCandidateIds) ? task.semanticCandidateIds : [];
    if (!candidateIds.length || new Set(candidateIds).size !== candidateIds.length
      || candidateIds.some((candidateId) => !UUID_PATTERN.test(String(candidateId || ""))
        || ownedIds.has(candidateId) || allCandidateOwners.get(candidateId) !== 1 || !candidatesById.has(candidateId))) return false;
    candidateIds.forEach((candidateId) => ownedIds.add(candidateId));

    const taskRelations = relations.filter((relation) => relation && relation.candidateIndex === task.candidateIndex);
    if (taskRelations.length !== 1 || !Array.isArray(taskRelations[0].evidenceRefs)
      || !taskRelations[0].evidenceRefs.length || !taskRelations[0].evidenceRefs.every(validEvidenceRefShape)) return false;
    const relationSignature = evidenceOwnershipSignature(taskRelations[0].evidenceRefs);
    if (relationSignatures.has(relationSignature)) return false;
    relationSignatures.add(relationSignature);

    const scopeId = String(task.lodgingScopeId || "");
    if (!UUID_PATTERN.test(scopeId) || scopeIds.has(scopeId)) return false;
    scopeIds.add(scopeId);
    const ownedCandidates = candidateIds.map((candidateId) => candidatesById.get(candidateId));
    if (ownedCandidates.some((candidate) => !Array.isArray(candidate.evidenceRefs)
      || !candidate.evidenceRefs.length || !candidate.evidenceRefs.every(validEvidenceRefShape)
      || evidenceOwnershipSignature(candidate.evidenceRefs) !== relationSignature)) return false;
    if (!ownedCandidates.some((candidate) => candidate.semanticKind === "capability" && candidate.capability === "availability")) return false;
    const ownedScopes = ownedCandidates.map((candidate) => candidate.lodgingScopeCandidate).filter(Boolean);
    if (!ownedScopes.length || ownedScopes.some((scope) => scope.scopeId !== scopeId)) return false;
    const lodgingUnitSignature = JSON.stringify(ownedScopes.map((scope) => ({
      bundleCanonicalCandidate: scope.bundleCanonicalCandidate,
      roomCanonicalCandidates: [...scope.roomCanonicalCandidates].sort(),
      guestCountCandidate: scope.guestCountCandidate
    })));
    if (lodgingUnitSignatures.has(lodgingUnitSignature)) return false;
    lodgingUnitSignatures.add(lodgingUnitSignature);
  }
  return true;
}

  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.tasks)) return value;
  const taskGroups = new Map();
  for (const task of value.tasks) {
    const taskId = task && typeof task.taskId === "string" ? task.taskId.trim() : "";
    if (!taskId) continue;
    if (!taskGroups.has(taskId)) taskGroups.set(taskId, []);
    taskGroups.get(taskId).push(task);
  }
  const safelyRepairableTaskIds = new Set([...taskGroups]
    .filter(([, tasks]) => tasks.length > 1 && (
      tasks.every((task) => STATELESS_DUPLICATE_TASK_ID_TYPES.has(task.type))
      || hasIsolatedAvailabilityOwnership(value, tasks)
    ))
    .map(([taskId]) => taskId));
  const reservedTaskIds = new Set(value.tasks
    .map((task) => task && typeof task.taskId === "string" ? task.taskId.trim() : "")
    .filter(Boolean));
  const usedTaskIds = new Set();
  const repairs = [];
  const tasks = value.tasks.map((task, index) => {
    const originalTaskId = task && typeof task.taskId === "string" ? task.taskId.trim() : "";
    if (!originalTaskId || !usedTaskIds.has(originalTaskId) || !safelyRepairableTaskIds.has(originalTaskId)) {
      if (originalTaskId) usedTaskIds.add(originalTaskId);
      return task;
    }
    const candidateIndex = Number.isInteger(task.candidateIndex) && task.candidateIndex >= 0
      ? task.candidateIndex
      : index;
    let ordinal = 1;
    let taskId = "";
    do {
      const suffix = `-candidate-${candidateIndex}${ordinal > 1 ? `-${ordinal}` : ""}`;
      taskId = `${originalTaskId.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
      ordinal += 1;
    } while (reservedTaskIds.has(taskId) || usedTaskIds.has(taskId));
    usedTaskIds.add(taskId);
    repairs.push({ taskId, index, reason: "duplicate_task_id_normalization" });
    return { ...task, taskId };
  });
  const normalized = { ...value, tasks };
  Object.defineProperty(normalized, TASK_ID_REPAIRS, { value: repairs, enumerable: false });
  return normalized;
}

function normalizeIgnoredAcknowledgementOutput(value, { sourceEvents } = {}) {
  if (sourceEventsAreUnicodeNonSubstantive(sourceEvents)) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.tasks)) return value;
    const sourceEvent = (Array.isArray(sourceEvents) ? sourceEvents : []).find((event) => String(event && event.messageText || "").trim());
    if (!sourceEvent) return value;
    const messageText = String(sourceEvent.messageText || "").slice(0, 500);
    const tasks = value.tasks.map((task) => {
      if (!task || typeof task !== "object" || Array.isArray(task)) return task;
      const sourceText = text(task.sourceText, 500) && task.sourceText.trim() ? task.sourceText : messageText;
      const entity = task.entity && typeof task.entity === "object" && !Array.isArray(task.entity)
        ? {
          ...task.entity,
          rawText: text(task.entity.rawText || "", 200) && task.entity.rawText.trim()
            ? task.entity.rawText
            : messageText.slice(0, 200)
        }
        : task.entity;
      return { ...task, sourceText, entity };
    });
    return {
      ...value,
      tasks,
      needsHuman: false,
      shouldIgnore: true,
      reason: "non_substantive_unicode"
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !value.discourse || value.discourse.relation !== "acknowledgement"
    || value.shouldIgnore !== true || !Array.isArray(value.tasks)) return value;
  const sourceEvent = (Array.isArray(sourceEvents) ? sourceEvents : []).find((event) => {
    const messageText = String(event && event.messageText || "");
    return messageText.trim() && (String(event && event.eventId || "").trim() || String(event && event.messageRef || "").trim());
  });
  if (!sourceEvent) return value;
  const messageText = String(sourceEvent.messageText || "");
  const ignoredIndexes = new Set();
  const ignoredCandidateIndexes = new Set();
  const substantiveIndexes = new Set();
  const tasks = value.tasks.map((task, index) => {
    if (task && verifiedNewRequestRelation(task, value.contextRelationCandidates, sourceEvents)) {
      substantiveIndexes.add(index);
      return task;
    }
    if (!task || !["human_help", "unknown"].includes(task.type)
      || ![undefined, "", "general"].includes(task.detailIntent)) return task;
    ignoredIndexes.add(index);
    if (Number.isInteger(task.candidateIndex) && task.candidateIndex >= 0) ignoredCandidateIndexes.add(task.candidateIndex);
    const sourceText = text(task.sourceText, 500) && task.sourceText.trim()
      ? task.sourceText
      : messageText.slice(0, 500);
    const taskConfidence = confidence(task.confidence)
      ? task.confidence
      : confidence(value.discourse.confidence) ? value.discourse.confidence : 0;
    const entityConfidence = confidence(task.entity && task.entity.confidence)
      ? task.entity.confidence
      : taskConfidence;
    return {
      ...task,
      candidateIndex: index,
      taskId: text(task.taskId, 80) && task.taskId.trim() ? task.taskId : `acknowledgement-${index + 1}`,
      type: "unknown",
      sourceText,
      detailIntent: "general",
      requestedOutputs: ["answer"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: {
        category: "other",
        rawText: messageText.slice(0, 200),
        canonicalCandidate: null,
        confidence: entityConfidence
      },
      stayCandidate: null,
      confidence: taskConfidence
    };
  });
  if (!ignoredIndexes.size) return substantiveIndexes.size
    ? { ...value, shouldIgnore: false }
    : value;
  const retainedCandidates = (Array.isArray(value.contextRelationCandidates) ? value.contextRelationCandidates : [])
    .filter((candidate) => candidate && !ignoredCandidateIndexes.has(candidate.candidateIndex) && !ignoredIndexes.has(candidate.candidateIndex));
  const normalizedCandidates = [...ignoredIndexes].map((candidateIndex) => ({
    candidateIndex,
    kind: "relation_uncertain",
    candidateRequestCycleRefs: [],
    evidenceRefs: [{
      eventId: String(sourceEvent.eventId || "").trim(),
      messageRef: String(sourceEvent.messageRef || "").trim(),
      startOffset: 0,
      endOffset: messageText.length,
      quote: messageText
    }]
  }));
  return {
    ...value,
    tasks,
    shouldIgnore: substantiveIndexes.size ? false : value.shouldIgnore,
    contextRelationCandidates: [...retainedCandidates, ...normalizedCandidates]
      .sort((left, right) => left.candidateIndex - right.candidateIndex)
  };
}

function verifiedNewRequestEvidence(task, contextRelationCandidates, sourceEvents) {
  const candidate = verifiedNewRequestRelation(task, contextRelationCandidates, sourceEvents);
  if (!candidate) return "";
  const evidenceText = candidate.evidenceRefs.map((evidenceRef) => evidenceRef.quote).join("\n");
  const taskSourceText = String(task && task.sourceText || "").trim();
  if (!taskSourceText || !normalizedText(evidenceText).includes(normalizedText(taskSourceText))) return "";
  return taskSourceText;
}

function verifiedNewRequestRelation(task, contextRelationCandidates, sourceEvents) {
  const candidates = (Array.isArray(contextRelationCandidates) ? contextRelationCandidates : [])
    .filter((candidate) => candidate && candidate.candidateIndex === task.candidateIndex);
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  if (candidate.kind !== "new_request"
    || !Array.isArray(candidate.candidateRequestCycleRefs) || candidate.candidateRequestCycleRefs.length !== 0
    || !Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length === 0) return null;
  const sourceMaps = sourceEventMaps(sourceEvents);
  if (!candidate.evidenceRefs.every((evidenceRef) => evidenceMatchesSource(evidenceRef, sourceMaps))) return null;
  return candidate;
}

function resolvedEvidenceSource(ref, sourceMaps) {
  const eventId = String(ref && ref.eventId || "").trim();
  const messageRef = String(ref && ref.messageRef || "").trim();
  const byEventId = eventId ? sourceMaps.byEventId.get(eventId) : null;
  const byMessageRef = messageRef ? sourceMaps.byMessageRef.get(messageRef) : null;
  return byEventId && byMessageRef && byEventId !== byMessageRef ? null : byEventId || byMessageRef || null;
}

function evidenceRefsOverlap(left, right, sourceMaps) {
  const leftSource = resolvedEvidenceSource(left, sourceMaps);
  const rightSource = resolvedEvidenceSource(right, sourceMaps);
  return leftSource !== null && leftSource === rightSource
    && left.startOffset < right.endOffset && right.startOffset < left.endOffset;
}

function uniqueCurrentRequestFormalSubject(value, catalog, sourceEvents) {
  if (!catalog || !value || !Array.isArray(value.tasks)) return null;
  const subjects = new Map();
  for (const task of value.tasks) {
    if (!task || !task.entity) continue;
    const verifiedSourceText = verifiedNewRequestEvidence(task, value.contextRelationCandidates, sourceEvents);
    if (!verifiedSourceText) continue;
    const resolved = resolveEntity(catalog, task.entity);
    if (resolved && resolved.status === "resolved" && resolved.entity
      && ["room", "bundle"].includes(resolved.entity.category)) return null;
    const resolvedDefinition = resolved && resolved.status === "resolved" && resolved.entity
      ? getCapabilityDefinition(resolved.entity.canonicalId)
        || getCapabilityDefinition(["amenity", "activity", "room_feature"].includes(resolved.entity.category)
          ? "amenity"
          : "policy")
      : null;
    const definition = resolvedDefinition && resolvedDefinition.acceptedCandidateTypes.includes(task.type)
      ? resolvedDefinition
      : null;
    if (!definition || definition.resolverId !== "property_catalog" || definition.stayDependency !== false
      || definition.riskLevel !== "low" || definition.responseMode !== "answer") continue;
    const mentionIds = new Set(mentionedPropertyFacts(catalog, verifiedSourceText)
      .map(({ entity: fact }) => fact && fact.canonicalId)
      .filter(Boolean));
    if (mentionIds.size !== 1 || !resolved || resolved.status !== "resolved" || !resolved.entity
      || !mentionIds.has(resolved.entity.canonicalId)
      || !definition.acceptedEntityCategories.includes(resolved.entity.category)) continue;
    const relation = verifiedNewRequestRelation(task, value.contextRelationCandidates, sourceEvents);
    if (!relation) continue;
    const subject = subjects.get(resolved.entity.canonicalId) || { entity: resolved.entity, owners: [] };
    subject.owners.push({ task, relation });
    subjects.set(resolved.entity.canonicalId, subject);
  }
  return subjects.size === 1 ? [...subjects.values()][0] : null;
}

function isolatedCurrentRequestFormalSubject(task, value, catalog, sourceEvents, subject) {
  if (!subject || !subject.entity || subject.owners.length !== 1) return null;
  const taskRelation = verifiedNewRequestRelation(task, value.contextRelationCandidates, sourceEvents);
  if (!taskRelation) return null;
  const sourceMaps = sourceEventMaps(sourceEvents);
  const ownerRefs = subject.owners[0].relation.evidenceRefs;
  const taskRefs = taskRelation.evidenceRefs;
  if (!taskRefs.every((taskRef) => ownerRefs.every((ownerRef) => {
    const taskSource = resolvedEvidenceSource(taskRef, sourceMaps);
    const ownerSource = resolvedEvidenceSource(ownerRef, sourceMaps);
    return taskSource !== null && taskSource === ownerSource && !evidenceRefsOverlap(taskRef, ownerRef, sourceMaps);
  }))) return null;
  const hasIndependentLodgingPrice = value.tasks.some((candidate) => candidate && candidate.candidateIndex !== task.candidateIndex
    && ["price", "total_price"].includes(candidate.type)
    && verifiedNewRequestRelation(candidate, value.contextRelationCandidates, sourceEvents));
  return hasIndependentLodgingPrice ? null : subject.entity;
}

function sourceBoundFormalPropertyId(task, contextRelationCandidates, sourceEvents, catalog) {
  const verifiedSourceText = verifiedNewRequestEvidence(task, contextRelationCandidates, sourceEvents);
  if (!verifiedSourceText || !task || !task.entity) return null;
  const mentions = mentionedPropertyFacts(catalog, verifiedSourceText);
  if (mentions.length !== 1) return null;
  const resolved = resolveEntity(catalog, task.entity);
  const definition = getCapabilityDefinition(task.type);
  if (!resolved || resolved.status !== "resolved" || !resolved.entity
    || resolved.entity.canonicalId !== mentions[0].entity.canonicalId
    || !definition || definition.resolverId !== "property_catalog" || definition.stayDependency !== false
    || definition.riskLevel !== "low" || definition.responseMode !== "answer") return null;
  return resolved.entity.canonicalId;
}

function normalizeUnreferencedSameTurnSupplements(value, sourceEvents) {
  const repairs = [];
  if (!value || !value.discourse || value.discourse.relation !== "new_request"
    || !Array.isArray(value.tasks) || !Array.isArray(value.contextRelationCandidates)) return { value, repairs };
  const sourceMaps = sourceEventMaps(sourceEvents);
  const taskCandidateIndexes = new Set(value.tasks
    .map((task) => task && task.candidateIndex)
    .filter((candidateIndex) => Number.isInteger(candidateIndex) && candidateIndex >= 0));
  const verifiedCandidate = (candidate) => candidate
    && taskCandidateIndexes.has(candidate.candidateIndex)
    && Array.isArray(candidate.evidenceRefs)
    && candidate.evidenceRefs.length > 0
    && candidate.evidenceRefs.every((evidenceRef) => evidenceMatchesSource(evidenceRef, sourceMaps));
  const hasVerifiedNewRequest = value.contextRelationCandidates.some((candidate) => verifiedCandidate(candidate)
    && candidate.kind === "new_request"
    && Array.isArray(candidate.candidateRequestCycleRefs)
    && candidate.candidateRequestCycleRefs.length === 0);
  if (!hasVerifiedNewRequest) return { value, repairs };
  const contextRelationCandidates = value.contextRelationCandidates.map((candidate) => {
    if (!verifiedCandidate(candidate)
      || candidate.kind !== "supplement_existing"
      || !Array.isArray(candidate.candidateRequestCycleRefs)
      || candidate.candidateRequestCycleRefs.length !== 0) return candidate;
    repairs.push({ candidateIndex: candidate.candidateIndex, reason: "unreferenced_same_turn_supplement" });
    return { ...candidate, kind: "new_request", candidateRequestCycleRefs: [] };
  });
  return { value: { ...value, contextRelationCandidates }, repairs };
}

function isolatedCatalogTaskId(taskId, ordinal, usedTaskIds) {
  let candidateOrdinal = ordinal;
  while (candidateOrdinal <= 12) {
    const suffix = `-catalog-${candidateOrdinal}`;
    const candidate = `${String(taskId || "task").slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
    if (!usedTaskIds.has(candidate)) return { taskId: candidate, nextOrdinal: candidateOrdinal + 1 };
    candidateOrdinal += 1;
  }
  return null;
}

function semanticGroundingEvidenceSignature(evidenceRefs) {
  return JSON.stringify((evidenceRefs || []).map((ref) => ({
    eventId: String(ref && ref.eventId || ""),
    messageRef: String(ref && ref.messageRef || ""),
    startOffset: ref && ref.startOffset,
    endOffset: ref && ref.endOffset,
    quote: String(ref && ref.quote || "")
  })));
}

function formalCatalogEntity(catalog, canonicalId) {
  const matches = ["rooms", "amenities", "policies", "faqs", "propertyFacts", "transportFacts"]
    .flatMap((key) => Array.isArray(catalog && catalog[key]) ? catalog[key] : [])
    .filter((entity) => entity && String(entity.canonicalId || "") === canonicalId);
  return matches.length === 1 ? matches[0] : null;
}

function failClosedSemanticGroundingTask(task) {
  const rawText = String(task && task.entity && task.entity.rawText || task && task.sourceText || "").slice(0, 200);
  return {
    ...task,
    type: "unknown",
    detailIntent: "general",
    requestedOutputs: ["answer"],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: { ...task.entity, category: "other", rawText, canonicalCandidate: null }
  };
}

function semanticGroundingDecisions(value, catalog, sourceEvents) {
  if (!Array.isArray(value && value.semanticGroundings)) return null;
  const decisions = new Map();
  const groundings = value.semanticGroundings;
  const groundingCounts = new Map();
  const taskOwnershipCounts = new Map();
  const taskCandidateIndexCounts = new Map();
  const groundingCandidateIndexCounts = new Map();
  for (const grounding of groundings) {
    const id = String(grounding && grounding.groundingId || "");
    groundingCounts.set(id, (groundingCounts.get(id) || 0) + 1);
    const candidateIndex = grounding && grounding.provenanceRelationCandidateIndexes && grounding.provenanceRelationCandidateIndexes[0];
    groundingCandidateIndexCounts.set(candidateIndex, (groundingCandidateIndexCounts.get(candidateIndex) || 0) + 1);
  }
  for (const task of value.tasks || []) {
    const id = String(task && task.groundingId || "");
    taskOwnershipCounts.set(id, (taskOwnershipCounts.get(id) || 0) + 1);
    taskCandidateIndexCounts.set(task && task.candidateIndex, (taskCandidateIndexCounts.get(task && task.candidateIndex) || 0) + 1);
  }
  (value.tasks || []).forEach((task, taskIndex) => {
    const groundingId = String(task && task.groundingId || "");
    const grounding = groundings.find((item) => String(item && item.groundingId || "") === groundingId);
    const relationCandidates = (value.contextRelationCandidates || []).filter((item) => item && item.candidateIndex === task.candidateIndex);
    const structurallyOwned = groundingId
      && groundingCounts.get(groundingId) === 1
      && taskOwnershipCounts.get(groundingId) === 1
      && taskCandidateIndexCounts.get(task.candidateIndex) === 1
      && groundingCandidateIndexCounts.get(task.candidateIndex) === 1
      && validSemanticGroundingShape(grounding)
      && grounding.provenanceRelationCandidateIndexes[0] === task.candidateIndex
      && relationCandidates.length === 1
      && grounding.evidenceRefs.every((ref) => evidenceMatchesSource(ref, sourceEventMaps(sourceEvents || [])))
      && semanticGroundingEvidenceSignature(grounding.evidenceRefs) === semanticGroundingEvidenceSignature(relationCandidates[0].evidenceRefs);
    if (!structurallyOwned) {
      decisions.set(taskIndex, { ok: false, reason: "semantic_grounding_invalid" });
      return;
    }
    const subject = grounding.subject;
    if (subject.scope === "external_place") {
      decisions.set(taskIndex, subject.catalogIdentity === null
        && grounding.relation === "property_to_external_place"
        && grounding.requestedOutput === "map_url"
        ? { ok: true, kind: "location" }
        : { ok: false, reason: "semantic_grounding_tuple_conflict" });
      return;
    }
    if (grounding.relation === "collection_membership") {
      decisions.set(taskIndex, subject.catalogIdentity === null && grounding.requestedOutput === "answer"
        ? { ok: true, kind: "amenity_list" }
        : { ok: false, reason: "semantic_grounding_tuple_conflict" });
      return;
    }
    const formalEntity = subject.catalogIdentity ? formalCatalogEntity(catalog, subject.catalogIdentity) : null;
    if (grounding.relation === "property_fact" && grounding.requestedOutput === "answer"
      && subject.catalogIdentity === null && task.type !== "amenity_list") {
      decisions.set(taskIndex, { ok: true, kind: "preserve" });
      return;
    }
    decisions.set(taskIndex, grounding.relation === "property_fact"
      && grounding.requestedOutput === "answer"
      && Boolean(formalEntity)
      ? { ok: true, kind: "property_fact", formalEntity }
      : { ok: false, reason: "semantic_grounding_catalog_conflict" });
  });
  return decisions;
}

function validatePlannerSemanticGroundingContract(value, { catalog, sourceEvents } = {}) {
  if (!value || !Array.isArray(value.tasks) || !Array.isArray(value.semanticGroundings)) return false;
  if (value.tasks.length !== value.semanticGroundings.length) return false;
  const decisions = semanticGroundingDecisions(value, catalog, sourceEvents);
  return decisions instanceof Map
    && decisions.size === value.tasks.length
    && [...decisions.values()].every((decision) => decision && decision.ok === true);
}

function applySemanticGroundingDecision(task, decision) {
  if (!decision || decision.ok !== true) return failClosedSemanticGroundingTask(task);
  if (decision.kind === "preserve") return task;
  if (decision.kind === "location") return {
    ...task,
    type: "property_fact",
    detailIntent: "general",
    requestedOutputs: ["map_url"],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: { ...task.entity, category: "transport", canonicalCandidate: "location" }
  };
  if (decision.kind === "amenity_list") return {
    ...task,
    type: "amenity_list",
    detailIntent: "general",
    requestedOutputs: ["answer"],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: { ...task.entity, category: "other", canonicalCandidate: null }
  };
  const category = String(decision.formalEntity.category || "other");
  const type = ["amenity", "activity", "room_feature"].includes(category)
    ? "amenity"
    : ["policy", "payment", "cancellation", "check_in", "check_out"].includes(category)
      ? "policy"
      : "property_fact";
  return {
    ...task,
    type,
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: { ...task.entity, category, canonicalCandidate: decision.formalEntity.canonicalId }
  };
}

function isolateMergedUnknownCatalogTasks(value, catalog, sourceEvents) {
  if (!catalog || !value || value.shouldIgnore === true
    || value.discourse && value.discourse.relation === "acknowledgement"
    || !Array.isArray(value.tasks) || value.tasks.length >= 12) return { ...value, isolatedTaskIndexes: [] };
  const representedCanonicalIds = new Set(value.tasks.flatMap((task) => {
    const canonicalCandidate = String(task && task.entity && task.entity.canonicalCandidate || "").trim();
    if (canonicalCandidate) return [canonicalCandidate];
    const resolved = task && task.entity ? resolveEntity(catalog, task.entity) : null;
    return resolved && resolved.status === "resolved" ? [resolved.entity.canonicalId] : [];
  }));
  const tasks = [...value.tasks];
  const contextRelationCandidates = Array.isArray(value.contextRelationCandidates)
    ? [...value.contextRelationCandidates]
    : value.contextRelationCandidates;
  const isolatedTaskIndexes = [];
  const usedTaskIds = new Set(tasks.map((task) => String(task && task.taskId || "")));
  let nextCandidateIndex = Math.max(-1, ...tasks.map((task) => Number.isInteger(task && task.candidateIndex) ? task.candidateIndex : -1)) + 1;
  let ordinal = 1;
  for (const original of value.tasks) {
    if (!original || original.type !== "unknown" || tasks.length >= 12) continue;
    const evidenceText = verifiedNewRequestEvidence(original, value.contextRelationCandidates, sourceEvents);
    const candidateText = String(original.entity && original.entity.rawText || "").trim();
    if (!evidenceText || !candidateText) continue;
    const relation = value.contextRelationCandidates.find((candidate) => candidate && candidate.candidateIndex === original.candidateIndex);
    for (const { entity } of mentionedPropertyFacts(catalog, candidateText)) {
      if (tasks.length >= 12 || representedCanonicalIds.has(entity.canonicalId)) continue;
      const identity = isolatedCatalogTaskId(original.taskId, ordinal, usedTaskIds);
      if (!identity) continue;
      const candidateIndex = nextCandidateIndex;
      nextCandidateIndex += 1;
      const type = entity.sourceKind === "faq" || entity.category === "transport"
        ? "property_fact"
        : entity.category === "policy" ? "policy" : "amenity";
      const syntheticTask = {
        ...original,
        candidateIndex,
        taskId: identity.taskId,
        type,
        sourceText: String(original.sourceText || evidenceText).slice(0, 500),
        detailIntent: "general",
        requestedOutputs: ["answer"],
        eligibilityEvidence: { kind: "none", sourceText: "" },
        dependsOnStayContext: false,
        entity: {
          category: entity.category,
          rawText: "",
          canonicalCandidate: entity.canonicalId,
          confidence: confidence(original.entity && original.entity.confidence) ? original.entity.confidence : original.confidence
        },
        stayCandidate: null
      };
      tasks.push(syntheticTask);
      contextRelationCandidates.push({
        ...relation,
        candidateIndex,
        candidateRequestCycleRefs: [],
        evidenceRefs: relation.evidenceRefs.map((evidenceRef) => ({ ...evidenceRef }))
      });
      representedCanonicalIds.add(entity.canonicalId);
      usedTaskIds.add(identity.taskId);
      isolatedTaskIndexes.push(tasks.length - 1);
      ordinal = identity.nextOrdinal;
    }
  }
  return { ...value, tasks, contextRelationCandidates, isolatedTaskIndexes };
}

function applyPlannerSemanticContract(value, { catalog, sourceEvents } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.tasks)) return value;
  const taskIdRepairs = Array.isArray(value[TASK_ID_REPAIRS]) ? value[TASK_ID_REPAIRS] : [];
  const relationNormalization = normalizeUnreferencedSameTurnSupplements(value, sourceEvents);
  value = relationNormalization.value;
  const acceptedTasks = [], repairedTasks = [
    ...taskIdRepairs,
  ], rejectedTasks = [], repairedRelations = [...relationNormalization.repairs];
  let contextRelationCandidates = value.contextRelationCandidates;
  const currentRequestFormalSubject = uniqueCurrentRequestFormalSubject(value, catalog, sourceEvents);
  const groundingDecisions = semanticGroundingDecisions(value, catalog, sourceEvents);
  let tasks = value.tasks.map((original, index) => {
    let task = { ...original, eligibilityEvidence: normalizeEligibilityEvidence(original && original.eligibilityEvidence), entity: original && original.entity ? { ...original.entity } : original && original.entity };
    if (task.dependsOnStayContext === true) task.stayCandidate = authoritativeStayCandidate(task.stayCandidate, value.stay);
    let entity = task && task.entity;
    if (!entity) return task;

    const verifiedSourceText = verifiedNewRequestEvidence(task, value.contextRelationCandidates, sourceEvents);
    const isolatedFormalSubject = isolatedCurrentRequestFormalSubject(task, value, catalog, sourceEvents, currentRequestFormalSubject);
    const groundedTask = groundedPropertyFactTask(task, catalog, value.stay, verifiedSourceText, isolatedFormalSubject);
    if (groundedTask
      && (task.type !== groundedTask.type
        || task.entity.category !== groundedTask.entity.category
        || task.entity.rawText !== groundedTask.entity.rawText
        || task.entity.canonicalCandidate !== groundedTask.entity.canonicalCandidate)) {
      task = groundedTask;
      entity = task.entity;
      if (task.type === "unknown") {
        rejectedTasks.push({ taskId: task.taskId, index, reason: "property_catalog_entity_conflict" });
      } else {
        repairedTasks.push({ taskId: task.taskId, index, reason: "property_catalog_entity_grounding" });
      }
    }

    if (task.type === "availability" && entity.category === "room" && entity.canonicalCandidate === null && catalog) {
      const inventoryEntity = resolveEntity(catalog, entity);
      if (!["resolved", "matched_set"].includes(inventoryEntity.status)) {
        task = { ...task, entity: { ...entity, category: "other", rawText: "", canonicalCandidate: null } };
        repairedTasks.push({ taskId: task.taskId, index, reason: "generic_availability_entity_unresolved" });
      }
    }

    if (value.discourse && value.discourse.relation === "acknowledgement"
      && ["amenity", "policy", "property_fact"].includes(task.type)
      && !groundedTask) {
      rejectedTasks.push({ taskId: task.taskId, index, reason: "ungrounded_acknowledgement_fact" });
      task = { ...task, type: "unknown", detailIntent: "general", requestedOutputs: ["answer"], entity: { ...task.entity, category: "other", canonicalCandidate: null } };
    }

    if (value.discourse && value.discourse.relation === "acknowledgement"
      && value.shouldIgnore === true
      && task.type === "human_help"
      && task.detailIntent === "general") {
      rejectedTasks.push({ taskId: task.taskId, index, reason: "ignored_acknowledgement_human_help_conflict" });
      task = { ...task, type: "unknown", requestedOutputs: ["answer"], entity: { ...task.entity, category: "other", canonicalCandidate: null } };
    }

    if (task.detailIntent === "eligibility" && !hasExplicitEligibilityEvidence(task)) {
      task = { ...task, detailIntent: "general", eligibilityEvidence: { kind: "none", sourceText: "" } };
      repairedTasks.push({ taskId: task.taskId, index, reason: "eligibility_evidence_missing" });
    }
    if (groundingDecisions) {
      const decision = groundingDecisions.get(index);
      const grounded = applySemanticGroundingDecision(task, decision);
      const changed = task.type !== grounded.type
        || task.detailIntent !== grounded.detailIntent
        || task.dependsOnStayContext !== grounded.dependsOnStayContext
        || task.entity.category !== grounded.entity.category
        || task.entity.canonicalCandidate !== grounded.entity.canonicalCandidate
        || JSON.stringify(task.requestedOutputs) !== JSON.stringify(grounded.requestedOutputs);
      task = grounded;
      entity = task.entity;
      if (!decision || decision.ok !== true) {
        rejectedTasks.push({ taskId: task.taskId, index, reason: decision && decision.reason || "semantic_grounding_missing" });
      } else if (changed) {
        repairedTasks.push({ taskId: task.taskId, index, reason: "semantic_grounding_alignment" });
      }
    }
    task = { ...task, requestedOutputs: controlledRequestedOutputs(task) };
    if (!repairedTasks.some((item) => item.index === index) && !rejectedTasks.some((item) => item.index === index)) acceptedTasks.push({ taskId: task.taskId, index });
    return task;
  });
  let guestCountCertaintyAligned = false;
  const guestCountCertaintyAlignedTaskIndexes = new Set();
  if (value.stay && value.stay.guestCountCandidate === null
    && Array.isArray(value.missingInformation) && value.missingInformation.length > 0) {
    const stayTaskGroups = new Map();
    tasks.forEach((task, index) => {
      if (!task || task.dependsOnStayContext !== true || !task.stayCandidate) return;
      const scopeId = String(task.lodgingScopeId || "");
      const groupId = scopeId || (tasks.length === 1 ? "single_stay_task" : "");
      if (!groupId) return;
      const group = stayTaskGroups.get(groupId) || [];
      group.push({ task, index });
      stayTaskGroups.set(groupId, group);
    });
    for (const group of stayTaskGroups.values()) {
      if (!group.some(({ task }) => Number.isInteger(task.stayCandidate.guestCountCandidate))) continue;
      for (const { task, index } of group) {
        tasks[index] = {
          ...task,
          stayCandidate: { ...task.stayCandidate, guestCountCandidate: null }
        };
        repairedTasks.push({ taskId: task.taskId, index, reason: "guest_count_certainty_alignment" });
        guestCountCertaintyAlignedTaskIndexes.add(index);
      }
      guestCountCertaintyAligned = true;
    }
  }
  const acknowledgementWithActionableTask = value.discourse
    && value.discourse.relation === "acknowledgement"
    && tasks.some((task) => task && task.type !== "unknown");
  if (acknowledgementWithActionableTask) {
    const ignoredIndexes = new Set(tasks
      .map((task, index) => task && task.type === "unknown" ? index : -1)
      .filter((index) => index >= 0));
    tasks = tasks.filter((_task, index) => !ignoredIndexes.has(index));
    contextRelationCandidates = Array.isArray(contextRelationCandidates)
      ? contextRelationCandidates.filter((candidate) => !ignoredIndexes.has(candidate.candidateIndex))
      : contextRelationCandidates;
    for (let index = acceptedTasks.length - 1; index >= 0; index -= 1) {
      if (ignoredIndexes.has(acceptedTasks[index].index)) acceptedTasks.splice(index, 1);
    }
    for (const index of ignoredIndexes) {
      rejectedTasks.push({ taskId: value.tasks[index].taskId, index, reason: "acknowledgement_fragment_ignored" });
    }
  }
  const acknowledgementOnly = value.discourse
    && value.discourse.relation === "acknowledgement"
    && tasks.every((task) => {
      if (!task || task.type !== "unknown" || task.detailIntent !== "general"
        || !Array.isArray(contextRelationCandidates)) return false;
      const candidates = contextRelationCandidates.filter((candidate) => candidate
        && candidate.candidateIndex === task.candidateIndex);
      return candidates.length === 1
        && candidates[0].kind === "relation_uncertain"
        && Array.isArray(candidates[0].candidateRequestCycleRefs)
        && candidates[0].candidateRequestCycleRefs.length === 0;
    });
  const nonSubstantiveUnknownOnly = tasks.every((task) => task && task.type === "unknown")
    && sourceEventsAreUnicodeNonSubstantive(sourceEvents);
  const silentOnly = acknowledgementOnly || nonSubstantiveUnknownOnly;
  if (silentOnly && Array.isArray(contextRelationCandidates)) {
    const acknowledgementIndexes = new Set(tasks.map((task) => task.candidateIndex));
    contextRelationCandidates = contextRelationCandidates.map((candidate) => {
      if (!candidate || !acknowledgementIndexes.has(candidate.candidateIndex)
        || !Array.isArray(candidate.candidateRequestCycleRefs)) return candidate;
      if (candidate.kind !== "relation_uncertain"
        || candidate.candidateRequestCycleRefs.length > 0) repairedRelations.push({
        candidateIndex: candidate.candidateIndex,
        reason: acknowledgementOnly
          ? "acknowledgement_relation_normalization"
          : "non_substantive_unicode_relation_normalization"
      });
      return {
        ...candidate,
        kind: "relation_uncertain",
        candidateRequestCycleRefs: []
      };
    });
  }
  const { isolatedTaskIndexes: _isolatedTaskIndexes, ...contractValue } = value;
  const ownedGuestCandidateIds = guestCountCertaintyAligned
    ? new Set([...guestCountCertaintyAlignedTaskIndexes].flatMap((index) => (
      Array.isArray(tasks[index] && tasks[index].semanticCandidateIds)
        ? tasks[index].semanticCandidateIds.map(String)
        : []
    )))
    : new Set();
  const semanticCandidates = (Array.isArray(value.semanticCandidates) ? value.semanticCandidates : []).map((candidate) => {
    if (!guestCountCertaintyAligned || !ownedGuestCandidateIds.has(String(candidate && candidate.candidateId || ""))
      || !candidate.lodgingScopeCandidate || !Number.isInteger(candidate.lodgingScopeCandidate.guestCountCandidate)) return candidate;
    const alignedCandidate = {
      ...candidate,
      lodgingScopeCandidate: { ...candidate.lodgingScopeCandidate, guestCountCandidate: null }
    };
    for (const symbol of Object.getOwnPropertySymbols(candidate)) {
      Object.defineProperty(alignedCandidate, symbol, Object.getOwnPropertyDescriptor(candidate, symbol));
    }
    return alignedCandidate;
  });
  const result = {
    ...contractValue,
    tasks,
    ...(Array.isArray(value.semanticCandidates) ? { semanticCandidates } : {}),
    contextRelationCandidates,
    shouldIgnore: silentOnly ? true : value.shouldIgnore,
    semanticValidation: { acceptedTasks, repairedTasks, rejectedTasks, repairedRelations }
  };
  const candidatesById = new Map(semanticCandidates.map((candidate) => [String(candidate && candidate.candidateId || ""), candidate]));
  const repairCanonicalizationResult = Object.freeze(tasks.flatMap((task) => {
    const candidateIds = Array.isArray(task && task.semanticCandidateIds) ? task.semanticCandidateIds : [];
    const resolved = task.entity && catalog ? resolveEntity(catalog, task.entity) : null;
    return candidateIds.flatMap((rawCandidateId) => {
      const candidateId = String(rawCandidateId || "");
      const candidate = candidatesById.get(candidateId);
      if (!candidate) return [];
      const semanticIdentity = candidate.semanticKind === "capability"
        ? String(candidate.capability || "")
        : candidate.semanticKind === "temporal_pattern"
          ? "temporal_pattern"
          : "";
      const resolvedIdentity = resolved && resolved.status === "resolved" && resolved.entity
        ? String(resolved.entity.canonicalId || "")
        : "";
      const canonicalIdentity = semanticIdentity || resolvedIdentity;
      const catalogIdentity = String(candidate.propertyCatalogIdentity || "");
      const unique = Boolean(canonicalIdentity && (!catalogIdentity || catalogIdentity === canonicalIdentity));
      return [Object.freeze({
        taskId: String(task.taskId || ""),
        candidateId,
        unique,
        canonicalIdentity: unique ? canonicalIdentity : null
      })];
    });
  }));
  Object.defineProperty(result, "repairCanonicalizationResult", {
    enumerable: false,
    configurable: false,
    writable: false,
    value: repairCanonicalizationResult
  });
  return result;
}

function plannerJsonSchema() {
  const stringEnum = (values) => ({ type: "string", enum: [...values] });
  const schema = {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "discourse", "stateOperations", "stay", "tasks", "semanticGroundings", "contextRelationCandidates", "ambiguities", "missingInformation", "needsHuman", "shouldIgnore", "reason"],
    properties: {
      schemaVersion: { type: "integer", const: 2 },
      discourse: { type: "object", additionalProperties: false, required: ["relation", "confidence"], properties: { relation: stringEnum(RELATIONS), confidence: { type: "number", minimum: 0, maximum: 1 } } },
      stateOperations: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["field", "operation", "value", "sourceText"], properties: { field: stringEnum(PLANNER_OPERATION_PATHS), operation: stringEnum(OPERATIONS), value: { type: ["string", "integer", "boolean", "array", "null"], items: { type: "string" } }, sourceText: { type: "string", maxLength: 500 } } } },
      stay: { type: "object", additionalProperties: false, required: ["dateExpression", "checkInCandidate", "checkOutCandidate", "nightsCandidate", "guestCountCandidate"], properties: { dateExpression: { type: "object", additionalProperties: false, required: ["rawText", "kind", "anchor"], properties: { rawText: { type: "string", maxLength: 200 }, kind: stringEnum(DATE_KINDS), anchor: stringEnum(ANCHORS) } }, checkInCandidate: { type: ["string", "null"] }, checkOutCandidate: { type: ["string", "null"] }, nightsCandidate: { type: ["integer", "null"], minimum: 1, maximum: 60 }, guestCountCandidate: { type: ["integer", "null"], minimum: 1, maximum: 100 } } },
      tasks: { type: "array", minItems: 1, maxItems: 12, description: "One task per independently actionable guest need. Coordinated subjects remain separate, and a shared descriptor that asks an independently answerable, clarifiable, or handoff-required request must have its own task rather than being absorbed by the subject tasks.", items: { type: "object", additionalProperties: false, required: ["candidateIndex", "taskId", "groundingId", "type", "sourceText", "detailIntent", "requestedOutputs", "eligibilityEvidence", "dependsOnStayContext", "entity", "stayCandidate", "confidence"], properties: { candidateIndex: { type: "integer", minimum: 0 }, taskId: { type: "string", maxLength: 80 }, groundingId: { type: "string", minLength: 1, maxLength: 80 }, type: { ...stringEnum(TASK_TYPES), description: "Semantic capability. Monetary lodging amount, charge, or rate requests use price or total_price; the fixed maximum occupancy of one explicitly identified room or bundle uses lodging_product_capacity; lodging recommendation or date-and-guest-dependent selection does not. Property rules and conditions use policy. Missing stay dates do not turn price into policy. Requests to disclose access credentials or authentication secrets use high_risk and never policy. An identified current-property formal catalog subject fee uses a subject-compatible amenity, policy, or property_fact task, not price or total_price." }, sourceText: { type: "string", minLength: 1, maxLength: 500 }, detailIntent: stringEnum(DETAIL_INTENTS), requestedOutputs: { type: "array", description: "Requested fact for this capability. A price task uses price, a total_price task uses total_price, lodging_product_capacity uses capacity, and a general property fact uses answer. A property-subject fee uses fee.", items: { type: "string", maxLength: 80 } }, eligibilityEvidence: { type: "object", additionalProperties: false, description: "Explicit guest qualification evidence. Use none for a base availability or permission question. Use a non-none kind only when sourceText quotes the person, room, plan, booking mode, identity, or stated condition that makes this an eligibility question.", required: ["kind", "sourceText"], properties: { kind: stringEnum(ELIGIBILITY_EVIDENCE_KINDS), sourceText: { type: "string", maxLength: 200, description: "Exact excerpt from the task sourceText containing the qualification; empty when kind is none." } } }, dependsOnStayContext: { type: "boolean" }, entity: { type: "object", additionalProperties: false, required: ["category", "rawText", "canonicalCandidate", "confidence"], properties: { category: stringEnum(ENTITY_CATEGORIES), rawText: { type: "string", maxLength: 200 }, canonicalCandidate: { type: ["string", "null"], maxLength: 120 }, confidence: { type: "number", minimum: 0, maximum: 1 } } }, stayCandidate: { type: ["object", "null"], description: "When dependsOnStayContext is true, use a structured object even if all stay inputs are missing; use empty candidate fields rather than null. Use null when dependsOnStayContext is false.", additionalProperties: false, required: ["dateExpression", "checkInCandidate", "checkOutCandidate", "nightsCandidate", "guestCountCandidate"], properties: { dateExpression: { type: "object", additionalProperties: false, required: ["rawText", "kind", "anchor"], properties: { rawText: { type: "string", maxLength: 200 }, kind: stringEnum(DATE_KINDS), anchor: stringEnum(ANCHORS) } }, checkInCandidate: { type: ["string", "null"], maxLength: 40 }, checkOutCandidate: { type: ["string", "null"], maxLength: 40 }, nightsCandidate: { type: ["integer", "null"], minimum: 1, maximum: 60 }, guestCountCandidate: { type: ["integer", "null"], minimum: 1, maximum: 100 } } }, confidence: { type: "number", minimum: 0, maximum: 1 } } } },
      semanticGroundings: { type: "array", minItems: 1, maxItems: 24, description: "Independent source-bound semantic grounding for each task. It distinguishes property-owned subjects from external places without keyword matching.", items: { type: "object", additionalProperties: false, required: ["groundingId", "provenanceRelationCandidateIndexes", "evidenceRefs", "subject", "relation", "requestedOutput"], properties: { groundingId: { type: "string", minLength: 1, maxLength: 80 }, provenanceRelationCandidateIndexes: { type: "array", minItems: 1, maxItems: 1, items: { type: "integer", minimum: 0 } }, evidenceRefs: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["eventId", "messageRef", "startOffset", "endOffset", "quote"], properties: { eventId: { type: "string", maxLength: 120 }, messageRef: { type: "string", maxLength: 120 }, startOffset: { type: "integer", minimum: 0 }, endOffset: { type: "integer", minimum: 0 }, quote: { type: "string", minLength: 1, maxLength: 500 } } } }, subject: { type: "object", additionalProperties: false, required: ["scope", "catalogIdentity"], properties: { scope: stringEnum(SEMANTIC_SUBJECT_SCOPES), catalogIdentity: { type: ["string", "null"], maxLength: 120 } } }, relation: stringEnum(SEMANTIC_RELATIONS), requestedOutput: stringEnum(SEMANTIC_REQUESTED_OUTPUTS) } } },
      contextRelationCandidates: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["candidateIndex", "kind", "candidateRequestCycleRefs", "evidenceRefs"], properties: { candidateIndex: { type: "integer", minimum: 0 }, kind: stringEnum(CONTEXT_RELATION_KINDS), candidateRequestCycleRefs: { type: "array", items: { type: "string", maxLength: 120 } }, evidenceRefs: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["eventId", "messageRef", "startOffset", "endOffset", "quote"], properties: { eventId: { type: "string", maxLength: 120 }, messageRef: { type: "string", maxLength: 120 }, startOffset: { type: "integer", minimum: 0 }, endOffset: { type: "integer", minimum: 0 }, quote: { type: "string", minLength: 1, maxLength: 500 } } } } } } },
      ambiguities: { type: "array", items: { type: "string", maxLength: 300 } }, missingInformation: { type: "array", items: { type: "string", maxLength: 120 } }, needsHuman: { type: "boolean" }, shouldIgnore: { type: "boolean" }, reason: { type: "string", maxLength: 120 }
    }
  };
  schema.required.splice(5, 0, "semanticCandidates");
  const taskSchema = schema.properties.tasks.items;
  taskSchema.required.push("semanticCandidateIds", "lodgingScopeId");
  taskSchema.properties.semanticCandidateIds = { type: "array", maxItems: 24, items: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" } };
  taskSchema.properties.semanticCandidateIds.minItems = 1;
  taskSchema.properties.lodgingScopeId = { type: ["string", "null"], pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" };
  const evidenceRefSchema = { type: "object", additionalProperties: false, description: "A source-bound evidence coordinate. Identify exactly one supplied sourceEvents item by eventId or messageRef (or both identifiers for that same item). quote must be the exact JavaScript string slice from that source message.", required: ["eventId", "messageRef", "startOffset", "endOffset", "quote"], properties: { eventId: { type: "string", maxLength: 120, description: "Copy a supplied sourceEvents eventId verbatim, or use an empty string only when messageRef identifies the source event." }, messageRef: { type: "string", maxLength: 120, description: "Copy a supplied sourceEvents messageRef verbatim, or use an empty string only when eventId identifies the source event." }, startOffset: { type: "integer", minimum: 0, description: "0-based UTF-16 JavaScript string offset, inclusive, in the identified source event messageText." }, endOffset: { type: "integer", minimum: 0, description: "0-based UTF-16 JavaScript string offset, exclusive, greater than startOffset and no greater than the identified source event messageText length." }, quote: { type: "string", minLength: 1, maxLength: 500, description: "Exactly sourceEvents[].messageText.slice(startOffset, endOffset), copied without paraphrasing, normalization, or translation." } } };
  schema.properties.semanticCandidates = { type: "array", maxItems: 24, description: "Every ledger candidate must independently carry valid source-bound evidenceRefs; the runtime rejects guesses, paraphrases, mismatched identifiers, and non-exact spans.", items: { type: "object", additionalProperties: false, required: ["candidateId", "semanticKind", "capability", "canonicalIdentityCandidate", "evidenceRefs", "lodgingScopeCandidate", "temporalSemanticCandidate", "propertyCatalogIdentity"], properties: { candidateId: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" }, semanticKind: stringEnum(SEMANTIC_KINDS), capability: stringEnum(TASK_TYPES), canonicalIdentityCandidate: { type: ["string", "null"], maxLength: 120 }, evidenceRefs: { type: "array", minItems: 1, maxItems: 12, items: evidenceRefSchema }, lodgingScopeCandidate: { type: ["object", "null"], additionalProperties: false, required: ["scopeId", "bundleCanonicalCandidate", "roomCanonicalCandidates", "guestCountCandidate"], properties: { scopeId: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" }, bundleCanonicalCandidate: { type: ["string", "null"], maxLength: 120 }, roomCanonicalCandidates: { type: "array", maxItems: 12, items: { type: "string", maxLength: 120 } }, guestCountCandidate: { type: ["integer", "null"], minimum: 1, maximum: 100 } } }, temporalSemanticCandidate: { type: ["object", "null"], additionalProperties: false, required: ["rawText", "kind", "anchor"], properties: { rawText: { type: "string", maxLength: 200 }, kind: stringEnum(DATE_KINDS), anchor: stringEnum(ANCHORS) } }, propertyCatalogIdentity: { type: ["string", "null"], maxLength: 120 } } } };
  schema.properties.semanticCandidates.minItems = 1;
  return schema;
}

function plannerProviderJsonSchema() {
  const schema = JSON.parse(JSON.stringify(plannerJsonSchema()));
  const taskSchema = schema.properties.tasks.items;
  taskSchema.required = taskSchema.required.filter((field) => field !== "semanticCandidateIds" && field !== "lodgingScopeId");
  delete taskSchema.properties.semanticCandidateIds;
  delete taskSchema.properties.lodgingScopeId;
  schema.required = schema.required.filter((field) => field !== "semanticCandidates");
  delete schema.properties.semanticCandidates;
  return schema;
}
module.exports = { validatePlannerOutput, validatePlannerSemanticGroundingContract, applyPlannerSemanticContract, plannerJsonSchema, plannerProviderJsonSchema, normalizeEligibilityEvidence, normalizeIgnoredAcknowledgementOutput, normalizeDuplicateTaskIds, discardLegacyPlannerStateControls, TASK_TYPES };
