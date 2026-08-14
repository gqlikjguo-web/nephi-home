"use strict";

const { resolveEntity } = require("./entity-resolver");
const { addDays } = require("./temporal-resolver");
const { assertCanonicalRequest } = require("./canonical-request");
const { resolveAvailability, resolveAvailableDates } = require("./resolver-adapter");
const { detailFactCandidates, includeBaseAnswer, normalizeDetailIntent } = require("./detail-intent");
const { PRICE_KEYS, resolveDatePrice, weekdayPriceType } = require("../date-price-authority");

function stayDates(checkIn, checkOut) { const dates = []; for (let d = checkIn; d && checkOut && d < checkOut && dates.length < 60; d = addDays(d, 1)) dates.push(d); return dates; }
function publicInventory(item) { return { canonicalId: item.id, publicName: String(item.publicDisplayName || item.displayName || item.publicName || item.name || "房型").slice(0, 100), capacity: Number(item.capacity) || null, category: item.inventoryType === "bundle" ? "bundle" : "room" }; }
function selected(property, request, entities) {
  const entityIds = new Set((entities || []).map((entity) => entity.canonicalId));
  return (property.rooms || []).filter((room) => room.enabled !== false)
    .filter((room) => request.inventory.mode !== "bundle_only" || room.inventoryType === "bundle")
    .filter((room) => request.inventory.mode !== "room_only" || room.inventoryType !== "bundle")
    .filter((room) => !entityIds.size || entityIds.has(room.id))
    .filter((room) => !request.stay.guests || Number(room.capacity) >= Number(request.stay.guests));
}
function priceKey(date) { return PRICE_KEYS[weekdayPriceType(date)] || null; }
function buildPricingFacts({ property, availableInventory, checkIn, checkOut, priceOverrides = [], datePriceClassifications = [] }) {
  const availableIds = new Set((availableInventory || []).map((item) => item.canonicalId));
  const dates = stayDates(checkIn, checkOut);
  const prices = (property.rooms || []).filter((room) => availableIds.has(room.id)).map((room) => {
    const daily = dates.map((date) => { const resolved = resolveDatePrice({ inventory: room, date, priceOverrides, datePriceClassifications }); return { date, price: resolved.price, source: resolved.source }; });
    return { inventory: publicInventory(room), daily, total: daily.every((item) => item.price !== null) ? daily.reduce((sum, item) => sum + item.price, 0) : null, currency: property.currency || "TWD" };
  });
  return { prices, missing: prices.some((item) => item.total === null) };
}
function isGenericAvailabilityEntity(task) {
  if (!task || !["availability", "bundle_availability", "room_options", "capacity", "price", "total_price", "available_dates"].includes(task.type)) return false;
  const entity = task.entity || {};
  return entity.category === "other" && entity.canonicalCandidate === null;
}

function catalogFactByCanonicalId(catalog, canonicalIds) {
  const wanted = new Set(canonicalIds.map((id) => String(id).toLocaleLowerCase("en-US")));
  return [...(catalog.amenities || []), ...(catalog.policies || []), ...(catalog.faqs || [])]
    .find((item) => wanted.has(String(item.canonicalId || "").toLocaleLowerCase("en-US")) && item.status !== "unknown") || null;
}
function scopedCatalogEntity(entity, inventoryMode = "any") {
  if (!entity || entity.appliesTo !== "bundle_only" || inventoryMode !== "room_only") return entity;
  return { ...entity, status: "confirmed_no", answer: "", applicableBundles: [] };
}

function catalogAmenityNames(catalog, inventoryMode = "any") {
  return (catalog.amenities || [])
    .filter((item) => item.status === "confirmed_yes")
    .filter((item) => inventoryMode !== "room_only" || item.appliesTo !== "bundle_only")
    .map((item) => item.appliesTo === "bundle_only" && inventoryMode === "any"
      ? `${item.publicName}\uff08\u50c5\u5305\u68df\u5ba2\u9069\u7528\uff09`
      : item.publicName);
}

function catalogFactMetadata(entity) {
  return {
    ...(entity.appliesTo ? { appliesTo: entity.appliesTo } : {}),
    ...(entity.canonicalId === "location" ? { locationMapUrl: entity.mapUrl === undefined ? entity.answer || "" : entity.mapUrl, locationAddress: entity.address || "" } : {})
  };
}


function baseAnswerProvidesControlledDetail(entity, detailIntent) {
  const answer = String(entity && entity.answer || "");
  if (!answer) return false;
  const intent = normalizeDetailIntent(detailIntent);
  if (["time", "start_time", "end_time"].includes(intent)) {
    return /(?:^|[^\d])(?:[01]?\d|2[0-3]):[0-5]\d(?:[^\d]|$)/u.test(answer);
  }
  if (intent === "fee") {
    return /(?:NT\$|TWD|USD|JPY|RMB|CNY|\$|¥)\s*\d|\d[\d,]*(?:\.\d+)?\s*(?:TWD|USD|JPY|RMB|CNY|元|圓|塊)/iu.test(answer);
  }
  return false;
}

function executePropertyFactTask({ property, catalog, task, resolved, request = {} }) {
  if (!resolved || resolved.status !== "resolved") return { taskId: task.taskId, type: task.type, status: "needs_human", reason: "property_fact_unknown", facts: { subject: task.entity && task.entity.rawText || "question" }, review: true };
  const entity = scopedCatalogEntity(resolved.entity, request.inventory && request.inventory.mode);
  if (entity.status === "unknown") return { taskId: task.taskId, type: task.type, status: "needs_human", reason: "property_fact_unknown", facts: { subject: entity.publicName }, review: true };
  const detailIntent = normalizeDetailIntent(task.detailIntent);
  if (detailIntent === "general") return { taskId: task.taskId, type: task.type, status: "answered", facts: { subject: entity.publicName, status: entity.status, answer: entity.answer || "", ...catalogFactMetadata(entity), ...(Array.isArray(entity.applicableBundles) ? { applicableBundles: entity.applicableBundles } : {}), source: "property_catalog", propertyId: property.propertyId, detailIntent } };
  if (Array.isArray(entity.applicableBundles) && entity.applicableBundles.some((bundle) => bundle.note)) return { taskId: task.taskId, type: task.type, status: "answered", facts: { subject: entity.publicName, status: entity.status, answer: entity.answer || "", applicableBundles: entity.applicableBundles, source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: true } };
  const detail = catalogFactByCanonicalId(catalog, detailFactCandidates(entity.canonicalId, detailIntent));
  if (detail) return { taskId: task.taskId, type: task.type, status: "answered", facts: { subject: entity.publicName, status: detail.status, answer: detail.answer || "", source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: true } };
  if (baseAnswerProvidesControlledDetail(entity, detailIntent)) return { taskId: task.taskId, type: task.type, status: "answered", facts: { subject: entity.publicName, status: entity.status, answer: entity.answer || "", source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: true } };
  return { taskId: task.taskId, type: task.type, status: "answered", facts: { subject: entity.publicName, status: entity.status, answer: includeBaseAnswer(detailIntent) ? entity.answer || "" : "", source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: false, detailNeedsConfirmation: true } };
}

function executeTasks({ property, catalog, tasks, request, availabilityResolver, availableDatesResolver, priceOverrides = [], datePriceClassifications = [] }) {
  return tasks.map((task) => {
    try {
    const genericAvailabilityEntity = isGenericAvailabilityEntity(task);
    const resolved = task._resolvedEntity || (task.entity && task.entity.rawText && !genericAvailabilityEntity ? resolveEntity(catalog, task.entity) : null);
    if (resolved && resolved.status === "ambiguous") return { taskId: task.taskId, type: task.type, status: "needs_clarification", question: "想確認您指的是哪一個？", candidates: resolved.candidates, facts: {}, missingInputs: ["entity.canonicalId"] };
    if (["amenity", "policy", "property_fact"].includes(task.type)) return executePropertyFactTask({ property, catalog, task, resolved, request });
    if (task.type === "amenity_list") return { taskId: task.taskId, type: task.type, status: "answered", facts: { amenities: catalogAmenityNames(catalog, request.inventory && request.inventory.mode), source: "property_catalog", propertyId: property.propertyId } };
    if (task.type === "available_dates") {
      const range = request.stay.searchRange;
      if (!range || !range.from || !range.to) return { taskId: task.taskId, type: task.type, status: "needs_clarification", question: "想查哪一段日期呢？", facts: {}, missingInputs: ["stay.searchRange"] };
      if (resolved && resolved.status === "not_found" && task.entity && task.entity.rawText) return { taskId: task.taskId, type: task.type, status: "needs_human", reason: "inventory_entity_unknown", facts: { subject: task.entity.rawText }, review: true };
      const result = resolveAvailableDates({ availableDatesResolver, propertyId: property.propertyId, request, resolved });
      if (result.status !== "answered") return { taskId: task.taskId, type: task.type, status: "needs_human", reason: `available_dates_${result.status}`, facts: {}, review: true };
      return { taskId: task.taskId, type: task.type, status: "answered", facts: { availableDates: result.dates.filter((item) => item.available).map((item) => item.checkIn), range, source: result.source, propertyId: property.propertyId } };
    }
    if (["availability", "bundle_availability", "room_options", "capacity", "price", "total_price"].includes(task.type)) {
      if (!request.stay.checkIn || !request.stay.checkOut) return { taskId: task.taskId, type: task.type, status: "needs_clarification", question: "想查哪一天入住、住幾晚呢？", facts: {}, missingInputs: [!request.stay.checkIn ? "stay.checkIn" : "stay.checkOut"] };
      if (resolved && resolved.status === "not_found" && task.entity && task.entity.rawText) return { taskId: task.taskId, type: task.type, status: "needs_human", reason: "inventory_entity_unknown", facts: { subject: task.entity.rawText }, review: true };
      const adapted = resolveAvailability({ availabilityResolver, propertyId: property.propertyId, request, resolved });
      if (!adapted.result.availabilityReliable) return { taskId: task.taskId, type: task.type, status: "needs_human", reason: "availability_unreliable", facts: {}, review: true };
      if (["availability", "bundle_availability", "room_options", "capacity"].includes(task.type)) return { taskId: task.taskId, type: task.type, status: "answered", facts: adapted.facts };
      const availableInventory = adapted.facts.availableInventory;
      if (!availableInventory.length) return { taskId: task.taskId, type: task.type, status: "answered", facts: { availability: "full", checkIn: request.stay.checkIn, checkOut: request.stay.checkOut, prices: [], source: "availability_provider", propertyId: property.propertyId } };
      const pricing = buildPricingFacts({ property, availableInventory, checkIn: request.stay.checkIn, checkOut: request.stay.checkOut, priceOverrides, datePriceClassifications });
      return { taskId: task.taskId, type: task.type, status: pricing.missing ? "property_data_missing" : "answered", facts: { availability: "available", checkIn: request.stay.checkIn, checkOut: request.stay.checkOut, prices: pricing.prices, source: "pricing_provider", propertyId: property.propertyId }, review: pricing.missing };
    }
    return { taskId: task.taskId, type: task.type, status: ["booking_request", "human_help", "high_risk", "unknown"].includes(task.type) ? "needs_human" : "failed", reason: task.type, facts: {}, review: true };
    } catch {
      return { taskId: task.taskId, type: task.type, status: "failed", reason: "capability_exception", facts: { subject: task.sourceText || "這個問題" }, review: true };
    }
  });
}

// The active Engine runtime calls this entrypoint exclusively.  The legacy
// executeTasks export remains for isolated historical test fixtures only.
function executeQueryPlans({ property, catalog, queryPlans, availabilityResolver, availableDatesResolver, priceOverrides = [], datePriceClassifications = [] }) {
  return (queryPlans || []).map((queryPlan) => executeQueryPlan({ property, catalog, queryPlan, availabilityResolver, availableDatesResolver, priceOverrides, datePriceClassifications }));
}

function queryOutcome(queryPlan, outcome, extra = {}) { return { taskId: queryPlan.taskId, type: queryPlan.capability, formalRequestId: queryPlan.formalRequestId, requestCycleId: queryPlan.requestCycleId, outcome, facts: {}, resolverAttempted: false, ...extra }; }
function catalogEntity(catalog, canonicalId) {
  if (!canonicalId) return null;
  return [...(catalog.rooms || []), ...(catalog.amenities || []), ...(catalog.policies || []), ...(catalog.faqs || [])]
    .find((entity) => entity.canonicalId === canonicalId) || null;
}
function queryResolvedEntity(queryPlan, catalog) {
  const entity = queryPlan.entity || {};
  if (queryPlan.resolvedEntity) return queryPlan.resolvedEntity;
  if (entity.status === "matched_set") {
    return {
      status: "matched_set",
      entities: (entity.canonicalSet || []).map((canonicalId) => catalogEntity(catalog, canonicalId)
        || { canonicalId, category: entity.category })
    };
  }
  if (entity.status !== "resolved") return null;
  return {
    status: "resolved",
    entity: catalogEntity(catalog, entity.canonicalId)
      || { canonicalId: entity.canonicalId, category: entity.category }
  };
}
function executeQueryPlan({ property, catalog, queryPlan, availabilityResolver, availableDatesResolver, priceOverrides = [], datePriceClassifications = [] }) {
  if (!queryPlan || queryPlan.propertyId !== property.propertyId) return queryOutcome(queryPlan || {}, "invalid_query_plan", { reason: "property_scope_mismatch" });
  const request = queryPlan.conditions || {};
  const stay = request.stay || {};
  const resolved = queryResolvedEntity(queryPlan, catalog);
  const resolverId = queryPlan.resolverId || (
    ["amenity", "policy", "property_fact", "amenity_list"].includes(queryPlan.capability)
      ? "property_catalog"
      : ["booking_request", "human_help", "high_risk", "unknown"].includes(queryPlan.capability)
        ? "human_handoff"
        : "availability_resolver"
  );
  try {
    if (resolverId === "property_catalog" && queryPlan.capability === "amenity_list") {
      return queryOutcome(queryPlan, "answered", { facts: { amenities: catalogAmenityNames(catalog, request.inventory && request.inventory.mode), source: "property_catalog", propertyId: property.propertyId }, resolverAttempted: false });
    }
    if (resolverId === "property_catalog") {
      const entity = scopedCatalogEntity(resolved && resolved.status === "resolved" && resolved.entity, request.inventory && request.inventory.mode);
      if (!entity || entity.status === "unknown") return queryOutcome(queryPlan, "unknown", { reason: "property_fact_unknown", facts: { subject: queryPlan.entity && queryPlan.entity.rawText || "question" } });
      const detailIntent = normalizeDetailIntent(queryPlan.detailIntent);
      if (detailIntent === "general") return queryOutcome(queryPlan, "answered", { facts: { subject: entity.publicName, status: entity.status, answer: entity.answer || "", ...catalogFactMetadata(entity), ...(Array.isArray(entity.applicableBundles) ? { applicableBundles: entity.applicableBundles } : {}), source: "property_catalog", propertyId: property.propertyId, detailIntent }, resolverAttempted: false });
      if (Array.isArray(entity.applicableBundles) && entity.applicableBundles.some((bundle) => bundle.note)) return queryOutcome(queryPlan, "answered", { facts: { subject: entity.publicName, status: entity.status, answer: entity.answer || "", applicableBundles: entity.applicableBundles, source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: true }, resolverAttempted: false });
      const detail = catalogFactByCanonicalId(catalog, detailFactCandidates(entity.canonicalId, detailIntent));
      const baseDetailProvided = baseAnswerProvidesControlledDetail(entity, detailIntent);
      return queryOutcome(queryPlan, "answered", { facts: { subject: entity.publicName, status: (detail || entity).status, answer: detail ? detail.answer || "" : baseDetailProvided || includeBaseAnswer(detailIntent) ? entity.answer || "" : "", source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: Boolean(detail) || baseDetailProvided, detailNeedsConfirmation: !detail && !baseDetailProvided }, resolverAttempted: false });
    }
    if (resolverId === "availability_resolver" && queryPlan.capability === "available_dates") {
      if (!stay.searchRange || !stay.searchRange.from || !stay.searchRange.to) return queryOutcome(queryPlan, "invalid_query_plan", { reason: "missing_search_range" });
      if (!queryPlan.resolverTask) return queryOutcome(queryPlan, "invalid_query_plan", { reason: "resolver_task_required" });
      const result = resolveAvailableDates({ availableDatesResolver, resolverTask: queryPlan.resolverTask });
      if (result.status === "answered") return queryOutcome(queryPlan, "answered", { facts: { availableDates: result.dates.filter((item) => item.available).map((item) => item.checkIn), range: stay.searchRange, source: result.source, propertyId: property.propertyId }, resolverAttempted: true });
      return queryOutcome(queryPlan, result.status === "unknown" ? "unknown" : "technical_error", { reason: `available_dates_${result.status}`, resolverAttempted: true });
    }
    if (resolverId === "availability_resolver") {
      if (!stay.checkIn || !stay.checkOut) return queryOutcome(queryPlan, "invalid_query_plan", { reason: "missing_stay" });
      if (!queryPlan.resolverTask) return queryOutcome(queryPlan, "invalid_query_plan", { reason: "resolver_task_required" });
      const adapted = resolveAvailability({ availabilityResolver, resolverTask: queryPlan.resolverTask });
      if (!adapted.result.availabilityReliable) return queryOutcome(queryPlan, "technical_error", { reason: "availability_unreliable", resolverAttempted: true });
      if (["availability", "bundle_availability", "room_options", "capacity"].includes(queryPlan.capability)) return queryOutcome(queryPlan, adapted.facts.availableInventory.length ? "answered" : "no_availability", { facts: adapted.facts, resolverAttempted: true });
      if (!adapted.facts.availableInventory.length) return queryOutcome(queryPlan, "no_availability", { facts: { availability: "full", checkIn: stay.checkIn, checkOut: stay.checkOut, prices: [], source: "availability_provider", propertyId: property.propertyId }, resolverAttempted: true });
      const pricing = buildPricingFacts({ property, availableInventory: adapted.facts.availableInventory, checkIn: stay.checkIn, checkOut: stay.checkOut, priceOverrides, datePriceClassifications });
      return queryOutcome(queryPlan, pricing.missing ? "property_data_missing" : "answered", { facts: { availability: "available", checkIn: stay.checkIn, checkOut: stay.checkOut, prices: pricing.prices, source: "pricing_provider", propertyId: property.propertyId }, resolverAttempted: true });
    }
    if (resolverId === "human_handoff") {
      return queryOutcome(queryPlan, "unknown", { reason: queryPlan.capability });
    }
    return queryOutcome(queryPlan, "invalid_query_plan", { reason: "unsupported_resolver" });
  } catch { return queryOutcome(queryPlan, "technical_error", { reason: "resolver_exception", resolverAttempted: true }); }
}

function executeCanonicalQueryPlans(input) {
  for (const queryPlan of input.queryPlans || []) {
    assertCanonicalRequest(queryPlan && queryPlan.canonicalRequest);
    if (queryPlan.resolverId !== queryPlan.canonicalRequest.resolverId) {
      return [queryOutcome(queryPlan, "invalid_query_plan", { reason: "resolver_authority_mismatch" })];
    }
  }
  return executeQueryPlans(input);
}

module.exports = {
  executeTasks,
  executeQueryPlan,
  executeQueryPlans,
  executeCanonicalQueryPlans,
  buildPricingFacts,
  priceKey,
  isGenericAvailabilityEntity,
  executePropertyFactTask,
  catalogFactByCanonicalId
};
