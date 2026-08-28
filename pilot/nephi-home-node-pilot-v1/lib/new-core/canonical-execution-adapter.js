"use strict";

const canonicalizer = require("../conversation-engine-v2/canonicalizer");
const { isCanonicalRequest } = require("../conversation-engine-v2/canonical-request");
const { getCapabilityDefinition } = require("../conversation-engine-v2/capability-registry");
const { isValidatedSemanticUnitFor } = require("./semantic-unit-validator");
const {
  isValidatedLifecycleDecision,
  understandingInputForValidatedLifecycleDecision
} = require("./lifecycle-manager");
const { isTrustedUnitRoutingDecisionFor } = require("./unit-reply-router");
const { validateCanonicalizerInputItem } = require("./contracts/canonicalizer-input-item");
const { isPublicCatalogIdentityProjectionFor } = require("./turn-input-adapter");

const C08_AUTHORITY_MARKER = new WeakSet();
const PROVENANCE_BY_C08 = new WeakMap();
const EXECUTABLE_LIFECYCLE_ACTIONS = new Set(["START", "CONTINUE", "MODIFY"]);
const CANONICAL_REJECTION_CODES = new Set([
  "invalid_canonical_request",
  "invalid_lodging_product",
  "canonical_request_required"
]);
const LEGACY_RESULT_FIELDS = new Set([
  "candidateIndex",
  "requestCycleId",
  "task",
  "transition",
  "canonicalRequest",
  "stateInput"
]);
const STATE_INPUT_FIELDS = new Set([
  "confirmedFields",
  "temporalResult",
  "hasNewDateExpression",
  "sourceEvidenceRefs"
]);
const CONFIRMED_FIELD_NAMES = new Set(["guests", "nights", "inventory"]);
const TEMPORAL_METADATA_NAMES = new Set(["checkIn", "checkOut", "nights", "searchRange"]);
const TEMPORAL_FIELD_NAMES = new Set([
  "value",
  "valueStatus",
  "provenance",
  "sourceEvidenceRefs",
  "ruleRef",
  "derivedFromFieldRefs"
]);
const TEMPORAL_PROVENANCE = new Set([null, "explicit", "context", "defaulted", "derived"]);
const TEMPORAL_VALUE_STATUSES = new Set(["confirmed", "missing", "uncertain"]);
const TEMPORAL_RULE_REFS = new Set([
  null,
  "temporal:canonical_grammar",
  "temporal:checkout_from_checkin_and_nights",
  "temporal:contextual_expression",
  "temporal:available_dates_default_lookahead",
  "PRODUCT_BASELINE:single_date_availability_default_one_night"
]);
const TEMPORAL_DERIVED_FIELD_REFS = new Set([
  "stay.checkIn",
  "stay.nights",
  "eventTimestamp"
]);
const TEMPORAL_EXPRESSIONS_BY_CANDIDATE_KIND = Object.freeze({
  absolute_date: new Set(["absolute_date"]),
  date_range: new Set(["date_range"]),
  relative_date: new Set(["relative_day"]),
  relative_range: new Set(["date_range"]),
  weekday: new Set(["relative_weekday", "weekend"]),
  month_weekday: new Set(["month_weekday_constraint"]),
  nights_only: new Set(["duration_only"]),
  partial: new Set(["ambiguous"]),
  unknown: new Set(["ambiguous"])
});
const TEMPORAL_KIND_COMPATIBILITY = Object.freeze({
  absolute_date: "absolute",
  date_range: "range",
  relative_date: "relative",
  relative_range: "range",
  weekday: "weekday",
  month_weekday: "weekday",
  nights_only: "none",
  partial: "none",
  unknown: "none"
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function detach(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(detach);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, detach(item)]));
}

function exactKeys(value, allowed) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function sameData(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasRecursiveKey(value, forbidden, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Object.keys(value).some((key) => forbidden.has(key))) return true;
  return Object.values(value).some((item) => hasRecursiveKey(item, forbidden, seen));
}

function failure(code, errors = []) {
  return { ok: false, code, errors };
}

function boundedText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function canonicalizerCatalogMatchesC01(catalog, projection) {
  if (!Array.isArray(catalog.rooms)
    || !Array.isArray(catalog.amenities)
    || !Array.isArray(catalog.policies)) return false;
  const projectedInventory = projection
    .filter((entry) => ["room", "bundle"].includes(entry[1]))
    .map((entry) => `${entry[0]}\u0000${entry[1]}`)
    .sort();
  const legacyInventory = catalog.rooms
    .map((item) => `${item && item.canonicalId}\u0000${item && item.category}`)
    .sort();
  if (!sameData(projectedInventory, legacyInventory)) return false;
  const legacyFacts = [...catalog.amenities, ...catalog.policies];
  return projection
    .filter((entry) => ["amenity", "policy"].includes(entry[1]))
    .every(([catalogIdentity, kind]) => legacyFacts.some((item) => (
      item && item.canonicalId === catalogIdentity && item.category === kind
    )));
}

function createCanonicalizerInputItem({
  unit,
  lifecycleDecision,
  routingDecision,
  understandingTurnInput,
  canonicalizerCatalog,
  publicCatalogIdentityProjection
} = {}) {
  const lifecycleInput = understandingInputForValidatedLifecycleDecision(lifecycleDecision);
  if (!lifecycleInput || lifecycleInput !== understandingTurnInput
    || !isValidatedLifecycleDecision(lifecycleDecision)
    || !isValidatedSemanticUnitFor(understandingTurnInput, unit)
    || !isTrustedUnitRoutingDecisionFor(routingDecision, {
      unit,
      lifecycleDecision,
      understandingTurnInput
    })) {
    return failure("CANONICAL_ADAPTER_OWNERSHIP_CONFLICT", ["provenance"]);
  }
  if (!canonicalizerCatalog || typeof canonicalizerCatalog !== "object"
    || canonicalizerCatalog.propertyId !== understandingTurnInput.propertyScope.propertyId
    || canonicalizerCatalog.timezone !== understandingTurnInput.propertyTimezone
    || !isPublicCatalogIdentityProjectionFor(understandingTurnInput, publicCatalogIdentityProjection)
    || !canonicalizerCatalogMatchesC01(canonicalizerCatalog, publicCatalogIdentityProjection)) {
    return failure("CANONICAL_ADAPTER_OWNERSHIP_CONFLICT", ["catalogProvenance"]);
  }
  if (routingDecision.disposition !== "ANSWER"
    || routingDecision.requiresCanonicalExecution !== true
    || !EXECUTABLE_LIFECYCLE_ACTIONS.has(lifecycleDecision.action)) {
    return failure("CANONICAL_INPUT_NOT_ANSWER", ["routeOrLifecycle"]);
  }
  const value = deepFreeze(detach({
    unitId: unit.unitId,
    capabilityCandidate: unit.capability,
    subjectCandidate: unit.subject,
    stayDependent: unit.stayDependent,
    temporalCandidate: unit.temporalCandidate,
    verifiedSlotInputs: lifecycleDecision.verifiedSlotOperations,
    evidenceRefs: unit.evidenceRefs,
    propertyScope: understandingTurnInput.propertyScope
  }));
  const contract = validateCanonicalizerInputItem(value);
  if (!contract.ok) return contract;
  C08_AUTHORITY_MARKER.add(value);
  PROVENANCE_BY_C08.set(value, {
    unit,
    lifecycleDecision,
    routingDecision,
    understandingTurnInput,
    canonicalizerCatalog,
    publicCatalogIdentityProjection
  });
  return { ok: true, code: null, errors: [], value };
}

function isTrustedCanonicalizerInputItem(value) {
  return Boolean(value) && typeof value === "object"
    && C08_AUTHORITY_MARKER.has(value)
    && Object.isFrozen(value)
    && validateCanonicalizerInputItem(value).ok;
}

function samePropertyScope(snapshot, propertyScope) {
  const snapshotScope = snapshot && snapshot.scope;
  return Boolean(snapshotScope)
    && snapshotScope.propertyId === propertyScope.propertyId
    && String(snapshotScope.channelId || snapshotScope.channel || "") === propertyScope.channel
    && String(snapshotScope.userId || snapshotScope.lineUserId || "") === propertyScope.userId;
}

function catalogSubject(input, subject) {
  if (!subject || subject.catalogIdentity === null) return null;
  return input.publicSubjectCatalog.find((item) => (
    item.catalogIdentity === subject.catalogIdentity && item.kind === subject.kind
  )) || null;
}

function compatibilityEntity(input, unit) {
  const subject = unit.subject;
  const publicSubject = catalogSubject(input, subject);
  if (subject.kind !== "external_place" && !publicSubject) return null;
  if (unit.capability === "location") {
    return { category: "transport", rawText: "", canonicalCandidate: "location", confidence: 1 };
  }
  if (subject.kind === "matched_room_set") {
    return { category: "room", rawText: publicSubject.publicName, canonicalCandidate: null, confidence: 1 };
  }
  if (subject.kind === "property") {
    return { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 };
  }
  const category = unit.capability === "property_fact" && subject.kind === "room"
    ? "room_feature"
    : subject.kind === "other_verified" ? "other" : subject.kind;
  return {
    category,
    rawText: "",
    canonicalCandidate: subject.catalogIdentity,
    confidence: 1
  };
}

function compatibilityTaskType(capability) {
  return capability === "location" ? "property_fact" : capability;
}

function compatibilityRequestedOutputs(capability) {
  if (capability === "location") return ["map_url"];
  if (["price", "total_price"].includes(capability)) return ["price"];
  if (["availability", "available_dates"].includes(capability)) return ["availability"];
  return ["answer"];
}

function uniqueSlotOperation(operations, slotName) {
  const matches = operations.filter((operation) => operation.slot === slotName);
  return matches.length <= 1 ? (matches[0] || null) : undefined;
}

function productFromIdentity(identity, kind) {
  if (kind === "bundle") {
    return { productType: "bundle", productId: identity, roomTypeId: null, bundleId: identity };
  }
  if (kind === "room") {
    return { productType: "room_type", productId: identity, roomTypeId: identity, bundleId: null };
  }
  return { productType: "any", productId: null, roomTypeId: null, bundleId: null };
}

function contextCycleFor(provenance, contextSnapshot) {
  const target = provenance.lifecycleDecision.targetRequestCycleId;
  if (target === null) return { ok: true, cycle: null };
  const matches = (contextSnapshot.cycles || []).filter((cycle) => cycle && cycle.requestCycleId === target);
  return matches.length === 1
    ? { ok: true, cycle: matches[0] }
    : { ok: false, cycle: null };
}

function approvedProductFor(provenance, contextCycle) {
  const operations = provenance.lifecycleDecision.verifiedSlotOperations;
  const productOperation = uniqueSlotOperation(operations, "product");
  if (productOperation === undefined) return null;
  const subject = provenance.unit.subject;
  if (productOperation && productOperation.operation === "SET") {
    if (["room", "bundle"].includes(subject.kind)
      && subject.catalogIdentity !== productOperation.value) return null;
    return productFromIdentity(productOperation.value,
      productOperation.persistedProductType === "bundle" ? "bundle"
        : productOperation.persistedProductType === "room_type" ? "room" : null);
  }
  if (productOperation && productOperation.operation === "CLEAR") {
    return productFromIdentity(null, null);
  }
  if (["room", "bundle"].includes(subject.kind)) {
    return productFromIdentity(subject.catalogIdentity, subject.kind);
  }
  const inventory = contextCycle && contextCycle.confirmedInputs && contextCycle.confirmedInputs.inventory;
  if (inventory && inventory.mode === "bundle_only" && boundedText(inventory.entityId)) {
    return productFromIdentity(inventory.entityId, "bundle");
  }
  if (inventory && inventory.mode === "room_only" && boundedText(inventory.entityId)) {
    return productFromIdentity(inventory.entityId, "room");
  }
  return productFromIdentity(null, null);
}

function sourcesForEvidence(input, refs) {
  const sources = [];
  for (const reference of refs) {
    const matches = input.sourceEvents.filter((event) => (
      event.eventId === reference.eventId && event.messageRef === reference.messageRef
    ));
    if (matches.length !== 1
      || matches[0].messageText.slice(reference.startOffset, reference.endOffset) !== reference.quote) return null;
    sources.push(matches[0]);
  }
  return sources;
}

function compatibilityTemporal(unit, sources) {
  const temporal = unit.temporalCandidate;
  if (temporal === null) {
    return {
      eventTimestamp: sources[0].timestamp,
      stayCandidate: {
        dateExpression: { rawText: "", kind: "none", anchor: "none" },
        checkInCandidate: null,
        checkOutCandidate: null,
        nightsCandidate: null
      }
    };
  }
  const ownedSourceIndexes = unit.evidenceRefs.flatMap((reference, index) => (
    reference.quote.includes(temporal.rawText) ? [index] : []
  ));
  if (ownedSourceIndexes.length !== 1) return null;
  return {
    eventTimestamp: sources[ownedSourceIndexes[0]].timestamp,
    stayCandidate: {
      dateExpression: {
        rawText: temporal.rawText,
        kind: TEMPORAL_KIND_COMPATIBILITY[temporal.kind],
        anchor: "message_time"
      },
      checkInCandidate: temporal.checkInCandidate,
      checkOutCandidate: temporal.checkOutCandidate,
      nightsCandidate: temporal.nightsCandidate
    }
  };
}

function contextTaskFor(cycle) {
  if (!cycle) return null;
  const stay = cycle.confirmedInputs && cycle.confirmedInputs.stay || {};
  return {
    checkIn: stay.checkIn || null,
    checkOut: stay.checkOut || null,
    guestCount: Number.isInteger(stay.guests) ? stay.guests : null
  };
}

function relationFor(candidateIndex, lifecycleDecision, evidenceRefs) {
  const kind = lifecycleDecision.action === "START" ? "new_request"
    : lifecycleDecision.action === "CONTINUE" ? "supplement_existing"
      : "modify_existing";
  const stateAction = lifecycleDecision.action === "START" ? "start"
    : lifecycleDecision.action === "CONTINUE" ? "continue" : "replace";
  return {
    candidateIndex,
    kind,
    requestCycleId: lifecycleDecision.targetRequestCycleId,
    stateAction,
    evidenceRefs: detach(evidenceRefs)
  };
}

function expectedCanonicalCapabilities(unit, entity) {
  if (unit.capability === "availability" && unit.subject.kind === "bundle") {
    return new Set(["bundle_availability"]);
  }
  const expected = new Set([unit.capability]);
  if (["property_fact", "amenity", "policy"].includes(unit.capability)
    && boundedText(unit.subject.catalogIdentity)) {
    const subjectDefinition = getCapabilityDefinition(unit.subject.catalogIdentity);
    const taskType = compatibilityTaskType(unit.capability);
    if (subjectDefinition
      && subjectDefinition.acceptedCandidateTypes.includes(taskType)
      && subjectDefinition.acceptedEntityCategories.includes(entity.category)) {
      expected.add(subjectDefinition.capability);
    }
  }
  return expected;
}

function expectedInventory(canonicalEntity) {
  if (!canonicalEntity || canonicalEntity.status !== "resolved"
    || !["room", "bundle"].includes(canonicalEntity.category)
    || !boundedText(canonicalEntity.canonicalId)) return null;
  return {
    mode: canonicalEntity.category === "bundle" ? "bundle_only" : "room_only",
    entityId: canonicalEntity.canonicalId
  };
}

function expectedProduct(approvedProduct, canonicalEntity) {
  if (approvedProduct.productType !== "any") return approvedProduct;
  const inventory = expectedInventory(canonicalEntity);
  if (!inventory) return productFromIdentity(null, null);
  return productFromIdentity(inventory.entityId,
    inventory.mode === "bundle_only" ? "bundle" : "room");
}

function temporalMetadataIsClosed(temporalState, expectedEvidenceRefs) {
  if (!exactKeys(temporalState.provenance, TEMPORAL_METADATA_NAMES)
    || !exactKeys(temporalState.ruleRefs, TEMPORAL_METADATA_NAMES)
    || !exactKeys(temporalState.derivedFromFieldRefs, TEMPORAL_METADATA_NAMES)
    || !exactKeys(temporalState.fields, TEMPORAL_METADATA_NAMES)) return false;
  for (const name of TEMPORAL_METADATA_NAMES) {
    const field = temporalState.fields[name];
    if (!TEMPORAL_PROVENANCE.has(temporalState.provenance[name])
      || !TEMPORAL_RULE_REFS.has(temporalState.ruleRefs[name])
      || !Array.isArray(temporalState.derivedFromFieldRefs[name])
      || temporalState.derivedFromFieldRefs[name].some((reference) => (
        !TEMPORAL_DERIVED_FIELD_REFS.has(reference)
      ))
      || !exactKeys(field, TEMPORAL_FIELD_NAMES)
      || !TEMPORAL_VALUE_STATUSES.has(field.valueStatus)
      || !sameData(field.value, temporalState[name])
      || field.provenance !== temporalState.provenance[name]
      || field.ruleRef !== temporalState.ruleRefs[name]
      || !sameData(field.derivedFromFieldRefs, temporalState.derivedFromFieldRefs[name])
      || !sameData(field.sourceEvidenceRefs, expectedEvidenceRefs)) return false;
  }
  return true;
}

function canonicalTemporalMatchesC08(temporalState, provenance, contextCycle) {
  const candidate = provenance.unit.temporalCandidate;
  const timezone = provenance.understandingTurnInput.propertyTimezone;
  const contextStay = contextCycle && contextCycle.confirmedInputs
    && contextCycle.confirmedInputs.stay || null;
  const usesContext = candidate === null && Boolean(contextStay && contextStay.checkIn);
  const expectedEvidenceRefs = usesContext ? [] : provenance.unit.evidenceRefs;
  if (temporalState.timezone !== timezone
    || !sameData(temporalState.applicableTaskIds, [provenance.unit.unitId])
    || temporalState.repairReasonCode !== ""
    || temporalState.ambiguity !== null
    || !temporalMetadataIsClosed(temporalState, expectedEvidenceRefs)) return false;
  if (candidate) {
    const expressionTypes = TEMPORAL_EXPRESSIONS_BY_CANDIDATE_KIND[candidate.kind];
    return Boolean(expressionTypes && expressionTypes.has(temporalState.expressionType))
      && temporalState.rawText === candidate.rawText
      && temporalState.originalExpression === candidate.rawText
      && temporalState.checkIn === candidate.checkInCandidate
      && temporalState.checkOut === candidate.checkOutCandidate
      && temporalState.nights === candidate.nightsCandidate
      && temporalState.searchRange === null
      && temporalState.resolutionStatus === "resolved"
      && temporalState.resolutionSource === "canonical_temporal_grammar";
  }
  if (usesContext) {
    const expectedNights = contextStay.checkOut
      ? Math.round((Date.parse(`${contextStay.checkOut}T00:00:00Z`)
        - Date.parse(`${contextStay.checkIn}T00:00:00Z`)) / 86400000)
      : null;
    return temporalState.rawText === ""
      && temporalState.originalExpression === ""
      && temporalState.checkIn === contextStay.checkIn
      && temporalState.checkOut === (contextStay.checkOut || null)
      && temporalState.nights === expectedNights
      && temporalState.searchRange === null
      && temporalState.expressionType === "context"
      && temporalState.resolutionStatus === "resolved"
      && temporalState.resolutionSource === "context";
  }
  return temporalState.rawText === ""
    && temporalState.originalExpression === ""
    && temporalState.checkIn === null
    && temporalState.checkOut === null
    && temporalState.nights === null
    && temporalState.searchRange === null
    && temporalState.expressionType === "none"
    && temporalState.resolutionStatus === "absent"
    && temporalState.resolutionSource === "canonical_temporal_grammar";
}

function canonicalResultMatchesC08(canonicalRequest, provenance, entity, approvedProduct, contextCycle) {
  const expectedCapabilities = expectedCanonicalCapabilities(provenance.unit, entity);
  const expectedStayDependency = provenance.unit.stayDependent ? "required" : false;
  const definition = getCapabilityDefinition(canonicalRequest.capability);
  if (!expectedCapabilities.has(canonicalRequest.capability)
    || !definition
    || canonicalRequest.stayDependency !== expectedStayDependency
    || !sameData(canonicalRequest.requiredFields, definition.requiredFields)
    || canonicalRequest.resolverId !== definition.resolverId
    || canonicalRequest.riskLevel !== definition.riskLevel
    || canonicalRequest.responseMode !== definition.responseMode
    || canonicalRequest.detailIntent !== "general"
    || !sameData(canonicalRequest.lodgingProduct,
      expectedProduct(approvedProduct, canonicalRequest.canonicalEntity))
    || !sameData(canonicalRequest.evidenceRefs, provenance.unit.evidenceRefs)
    || !canonicalTemporalMatchesC08(canonicalRequest.temporalState, provenance, contextCycle)) return false;
  const subject = provenance.unit.subject;
  const canonicalEntity = canonicalRequest.canonicalEntity;
  if (subject.kind === "matched_room_set") {
    const verifiedRoomIds = new Set(provenance.publicCatalogIdentityProjection
      .filter((entry) => entry[1] === "room")
      .map((entry) => entry[0]));
    return canonicalEntity.status === "matched_set"
      && canonicalEntity.category === "room"
      && canonicalEntity.canonicalId === null
      && canonicalEntity.rawText === entity.rawText
      && Array.isArray(canonicalEntity.canonicalSet)
      && canonicalEntity.canonicalSet.length > 0
      && new Set(canonicalEntity.canonicalSet).size === canonicalEntity.canonicalSet.length
      && canonicalEntity.canonicalSet.every((canonicalId) => verifiedRoomIds.has(canonicalId));
  }
  if (provenance.unit.capability === "location") {
    return canonicalEntity.status === "resolved"
      && canonicalEntity.category === "transport"
      && canonicalEntity.canonicalId === "location"
      && canonicalEntity.rawText === ""
      && sameData(canonicalEntity.canonicalSet, []);
  }
  if (["room", "bundle", "amenity", "policy", "other_verified"].includes(subject.kind)) {
    const projectedSubject = provenance.understandingTurnInput.publicSubjectCatalog
      .find((item) => item.catalogIdentity === subject.catalogIdentity && item.kind === subject.kind);
    return Boolean(projectedSubject)
      && canonicalEntity.status === "resolved"
      && canonicalEntity.canonicalId === subject.catalogIdentity
      && canonicalEntity.rawText === entity.rawText
      && sameData(canonicalEntity.canonicalSet, []);
  }
  return subject.kind === "property"
    && canonicalEntity.canonicalId === null
    && canonicalEntity.rawText === ""
    && sameData(canonicalEntity.canonicalSet, []);
}

function stateInputMatchesC08(stateInput, canonicalRequest, task, provenance) {
  if (!exactKeys(stateInput, STATE_INPUT_FIELDS)
    || !exactKeys(stateInput.confirmedFields, CONFIRMED_FIELD_NAMES)) return false;
  const expectedGuests = task.stayCandidate.guestCountCandidate;
  const expectedNights = task.stayCandidate.nightsCandidate;
  const expectedHasDateExpression = Boolean(task.stayCandidate.dateExpression.rawText
    && task.stayCandidate.dateExpression.kind !== "none");
  return stateInput.confirmedFields.guests === expectedGuests
    && stateInput.confirmedFields.nights === expectedNights
    && sameData(stateInput.confirmedFields.inventory,
      expectedInventory(canonicalRequest.canonicalEntity))
    && sameData(stateInput.temporalResult, canonicalRequest.temporalState)
    && stateInput.hasNewDateExpression === expectedHasDateExpression
    && sameData(stateInput.sourceEvidenceRefs, provenance.unit.evidenceRefs);
}

function executeCanonicalizerInputItem({
  canonicalizerInputItem,
  catalog,
  publicCatalogIdentityProjection,
  contextSnapshot
} = {}) {
  if (!isTrustedCanonicalizerInputItem(canonicalizerInputItem)) {
    return failure("CANONICAL_ADAPTER_OWNERSHIP_CONFLICT", ["canonicalizerInputItem"]);
  }
  const provenance = PROVENANCE_BY_C08.get(canonicalizerInputItem);
  if (!provenance
    || !isValidatedSemanticUnitFor(provenance.understandingTurnInput, provenance.unit)
    || understandingInputForValidatedLifecycleDecision(provenance.lifecycleDecision) !== provenance.understandingTurnInput
    || !isTrustedUnitRoutingDecisionFor(provenance.routingDecision, {
      unit: provenance.unit,
      lifecycleDecision: provenance.lifecycleDecision,
      understandingTurnInput: provenance.understandingTurnInput
    })) {
    return failure("CANONICAL_ADAPTER_OWNERSHIP_CONFLICT", ["provenance"]);
  }
  const propertyScope = canonicalizerInputItem.propertyScope;
  if (catalog !== provenance.canonicalizerCatalog
    || publicCatalogIdentityProjection !== provenance.publicCatalogIdentityProjection
    || !isPublicCatalogIdentityProjectionFor(
      provenance.understandingTurnInput,
      publicCatalogIdentityProjection
    )
    || !samePropertyScope(contextSnapshot, propertyScope)
    || !Array.isArray(contextSnapshot.cycles)) {
    return failure("CANONICAL_ADAPTER_OWNERSHIP_CONFLICT", ["propertyScope"]);
  }
  const context = contextCycleFor(provenance, contextSnapshot);
  if (!context.ok) return failure("CANONICAL_INPUT_INCOMPLETE", ["contextTarget"]);
  const entity = compatibilityEntity(provenance.understandingTurnInput, provenance.unit);
  const approvedProduct = approvedProductFor(provenance, context.cycle);
  const sources = sourcesForEvidence(provenance.understandingTurnInput, canonicalizerInputItem.evidenceRefs);
  const temporal = sources && compatibilityTemporal(provenance.unit, sources);
  const guestOperation = uniqueSlotOperation(provenance.lifecycleDecision.verifiedSlotOperations, "guest_count");
  if (!entity || !approvedProduct || !sources || !temporal || guestOperation === undefined) {
    return failure("CANONICAL_INPUT_INCOMPLETE", ["compatibilityMapping"]);
  }
  const guestCountCandidate = guestOperation && guestOperation.operation === "SET"
    ? guestOperation.value : null;
  const sourceText = canonicalizerInputItem.evidenceRefs.map((reference) => reference.quote).join("\n");

  // This compatibility index has no semantic meaning. It is created only for
  // the unchanged legacy call, then the complete legacy wrapper is discarded.
  const candidateIndex = 0;
  const task = {
    candidateIndex,
    taskId: provenance.unit.unitId,
    type: compatibilityTaskType(provenance.unit.capability),
    sourceText,
    detailIntent: "general",
    requestedOutputs: compatibilityRequestedOutputs(provenance.unit.capability),
    dependsOnStayContext: provenance.unit.stayDependent,
    entity,
    stayCandidate: {
      ...temporal.stayCandidate,
      guestCountCandidate
    },
    confidence: 1
  };
  const relation = relationFor(candidateIndex, provenance.lifecycleDecision, canonicalizerInputItem.evidenceRefs);
  const compatibilityItem = {
    candidateIndex,
    requestCycleId: provenance.lifecycleDecision.targetRequestCycleId || provenance.unit.unitId,
    task,
    transition: {
      reasonCode: "new_core_c08_compatibility",
      contextTask: contextTaskFor(context.cycle),
      approvedProduct,
      slotSources: {}
    }
  };
  let canonicalized;
  try {
    canonicalized = canonicalizer.canonicalizeExecutionItem({
      item: compatibilityItem,
      relation,
      contextSnapshot,
      catalog,
      guestMessage: sourceText,
      eventTimestamp: temporal.eventTimestamp,
      allowSharedMessageInference: false
    });
  } catch (error) {
    const rejectionCode = CANONICAL_REJECTION_CODES.has(error && error.code)
      ? error.code : "CANONICAL_INPUT_INCOMPLETE";
    return failure(rejectionCode, ["canonicalizerRejected"]);
  }
  if (!exactKeys(canonicalized, LEGACY_RESULT_FIELDS)
    || canonicalized.candidateIndex !== candidateIndex
    || canonicalized.requestCycleId !== compatibilityItem.requestCycleId
    || !sameData(canonicalized.task, task)
    || !sameData(canonicalized.transition, compatibilityItem.transition)
    || !isCanonicalRequest(canonicalized.canonicalRequest)
    || canonicalized.canonicalRequest.taskId !== provenance.unit.unitId
    || !canonicalResultMatchesC08(
      canonicalized.canonicalRequest,
      provenance,
      entity,
      approvedProduct,
      context.cycle
    )
    || !stateInputMatchesC08(
      canonicalized.stateInput,
      canonicalized.canonicalRequest,
      task,
      provenance
    )) {
    return failure("CANONICAL_INPUT_INCOMPLETE", ["canonicalizerResult"]);
  }
  const value = deepFreeze({
    unitId: provenance.unit.unitId,
    canonicalRequest: canonicalized.canonicalRequest,
    stateInput: detach(canonicalized.stateInput)
  });
  if (hasRecursiveKey(value, new Set([
    "candidateIndex",
    "facts",
    "resolvedFacts",
    "semanticData",
    "inferredCapability"
  ]))) {
    return failure("CANONICAL_INPUT_INCOMPLETE", ["canonicalizerResult"]);
  }
  return { ok: true, code: null, errors: [], value };
}

module.exports = {
  createCanonicalizerInputItem,
  executeCanonicalizerInputItem,
  isTrustedCanonicalizerInputItem
};
