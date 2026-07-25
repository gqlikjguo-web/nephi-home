"use strict";

const { resolveEntity } = require("./entity-resolver");
const { addDays } = require("./temporal-resolver");
const { resolveAvailability, resolveAvailableDates } = require("./resolver-adapter");
const { detailFactCandidates, includeBaseAnswer, normalizeDetailIntent } = require("./detail-intent");

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
function priceKey(date) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return day === 5 ? "fridayPrice" : day === 6 ? "saturdayHolidayPrice" : day === 0 ? "sundayPrice" : "mondayThursdayPrice"; }
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

function executePropertyFactTask({ property, catalog, task, resolved }) {
  if (!resolved || resolved.status !== "resolved") return { taskId: task.taskId, type: task.type, status: "needs_human", reason: "property_fact_unknown", facts: { subject: task.entity && task.entity.rawText || "question" }, review: true };
  const entity = resolved.entity;
  if (entity.status === "unknown") return { taskId: task.taskId, type: task.type, status: "needs_human", reason: "property_fact_unknown", facts: { subject: entity.publicName }, review: true };
  const detailIntent = normalizeDetailIntent(task.detailIntent);
  if (detailIntent === "general") return { taskId: task.taskId, type: task.type, status: "answered", facts: { subject: entity.publicName, status: entity.status, answer: entity.answer || "", ...(entity.canonicalId === "location" ? { locationMapUrl: entity.answer || "" } : {}), ...(Array.isArray(entity.applicableBundles) ? { applicableBundles: entity.applicableBundles } : {}), source: "property_catalog", propertyId: property.propertyId, detailIntent } };
  if (Array.isArray(entity.applicableBundles) && entity.applicableBundles.some((bundle) => bundle.note)) return { taskId: task.taskId, type: task.type, status: "answered", facts: { subject: entity.publicName, status: entity.status, answer: entity.answer || "", applicableBundles: entity.applicableBundles, source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: true } };
  const detail = catalogFactByCanonicalId(catalog, detailFactCandidates(entity.canonicalId, detailIntent));
  if (detail) return { taskId: task.taskId, type: task.type, status: "answered", facts: { subject: entity.publicName, status: detail.status, answer: detail.answer || "", source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: true } };
  return { taskId: task.taskId, type: task.type, status: "answered", facts: { subject: entity.publicName, status: entity.status, answer: includeBaseAnswer(detailIntent) ? entity.answer || "" : "", source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: false, detailNeedsConfirmation: true } };
}

function executeTasks({ property, catalog, tasks, request, availabilityResolver, availableDatesResolver, priceOverrides = [] }) {
  return tasks.map((task) => {
    try {
    const genericAvailabilityEntity = isGenericAvailabilityEntity(task);
    const resolved = task._resolvedEntity || (task.entity && task.entity.rawText && !genericAvailabilityEntity ? resolveEntity(catalog, task.entity) : null);
    if (resolved && resolved.status === "ambiguous") return { taskId: task.taskId, type: task.type, status: "needs_clarification", question: "想確認您指的是哪一個？", candidates: resolved.candidates, facts: {}, missingInputs: ["entity.canonicalId"] };
    if (["amenity", "policy", "property_fact"].includes(task.type)) return executePropertyFactTask({ property, catalog, task, resolved });
    if (task.type === "amenity_list") return { taskId: task.taskId, type: task.type, status: "answered", facts: { amenities: catalog.amenities.filter((x) => x.status === "confirmed_yes").map((x) => x.publicName), source: "property_catalog", propertyId: property.propertyId } };
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
      const availableIds = new Set((availableInventory || []).map((item) => item.canonicalId));
      const candidates = (property.rooms || []).filter((room) => availableIds.has(room.id));
      const dates = stayDates(request.stay.checkIn, request.stay.checkOut);
      const prices = [];
      for (const room of candidates) {
        const daily = dates.map((date) => { const override = priceOverrides.find((item) => item.roomId === room.id && item.date === date); const price = override ? Number(override.price) : Number(room[priceKey(date)]); return { date, price: Number.isInteger(price) && price > 0 ? price : null, source: override ? "price_override" : "room_pricing" }; });
        prices.push({ inventory: publicInventory(room), daily, total: daily.every((x) => x.price !== null) ? daily.reduce((sum, x) => sum + x.price, 0) : null, currency: property.currency || "TWD" });
      }
      const missing = prices.some((item) => item.total === null);
      return { taskId: task.taskId, type: task.type, status: missing ? "property_data_missing" : "answered", facts: { availability: "available", checkIn: request.stay.checkIn, checkOut: request.stay.checkOut, prices, source: "pricing_provider", propertyId: property.propertyId }, review: missing };
    }
    return { taskId: task.taskId, type: task.type, status: ["booking_request", "human_help", "high_risk", "unknown"].includes(task.type) ? "needs_human" : "failed", reason: task.type, facts: {}, review: true };
    } catch {
      return { taskId: task.taskId, type: task.type, status: "failed", reason: "capability_exception", facts: { subject: task.sourceText || "這個問題" }, review: true };
    }
  });
}

// The active Engine runtime calls this entrypoint exclusively.  The legacy
// executeTasks export remains for isolated historical test fixtures only.
function executeQueryPlans({ property, catalog, queryPlans, availabilityResolver, availableDatesResolver, priceOverrides = [] }) {
  return (queryPlans || []).map((queryPlan) => executeQueryPlan({ property, catalog, queryPlan, availabilityResolver, availableDatesResolver, priceOverrides }));
}

function queryOutcome(queryPlan, outcome, extra = {}) { return { taskId: queryPlan.taskId, type: queryPlan.capability, formalRequestId: queryPlan.formalRequestId, requestCycleId: queryPlan.requestCycleId, outcome, facts: {}, resolverAttempted: false, ...extra }; }
function queryResolvedEntity(queryPlan) {
  const entity = queryPlan.entity || {};
  return queryPlan.resolvedEntity || (entity.status === "matched_set" ? { status: "matched_set", entities: (entity.canonicalSet || []).map((canonicalId) => ({ canonicalId, category: entity.category })) } : entity.status === "resolved" ? { status: "resolved", entity: { canonicalId: entity.canonicalId, category: entity.category } } : null);
}
function executeQueryPlan({ property, catalog, queryPlan, availabilityResolver, availableDatesResolver, priceOverrides = [] }) {
  if (!queryPlan || queryPlan.propertyId !== property.propertyId) return queryOutcome(queryPlan || {}, "invalid_query_plan", { reason: "property_scope_mismatch" });
  const request = queryPlan.conditions || {};
  const stay = request.stay || {};
  const resolved = queryResolvedEntity(queryPlan);
  try {
    if (["amenity", "policy", "property_fact"].includes(queryPlan.capability)) {
      const entity = resolved && resolved.status === "resolved" && resolved.entity;
      if (!entity || entity.status === "unknown") return queryOutcome(queryPlan, "unknown", { reason: "property_fact_unknown", facts: { subject: queryPlan.entity && queryPlan.entity.rawText || "question" } });
      const detailIntent = normalizeDetailIntent(queryPlan.detailIntent);
      if (detailIntent === "general") return queryOutcome(queryPlan, "answered", { facts: { subject: entity.publicName, status: entity.status, answer: entity.answer || "", ...(entity.canonicalId === "location" ? { locationMapUrl: entity.answer || "" } : {}), ...(Array.isArray(entity.applicableBundles) ? { applicableBundles: entity.applicableBundles } : {}), source: "property_catalog", propertyId: property.propertyId, detailIntent }, resolverAttempted: false });
      if (Array.isArray(entity.applicableBundles) && entity.applicableBundles.some((bundle) => bundle.note)) return queryOutcome(queryPlan, "answered", { facts: { subject: entity.publicName, status: entity.status, answer: entity.answer || "", applicableBundles: entity.applicableBundles, source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: true }, resolverAttempted: false });
      const detail = catalogFactByCanonicalId(catalog, detailFactCandidates(entity.canonicalId, detailIntent));
      return queryOutcome(queryPlan, "answered", { facts: { subject: entity.publicName, status: (detail || entity).status, answer: detail ? detail.answer || "" : includeBaseAnswer(detailIntent) ? entity.answer || "" : "", source: "property_catalog", propertyId: property.propertyId, detailIntent, detailProvided: Boolean(detail), detailNeedsConfirmation: !detail }, resolverAttempted: false });
    }
    if (queryPlan.capability === "available_dates") {
      if (!stay.searchRange || !stay.searchRange.from || !stay.searchRange.to) return queryOutcome(queryPlan, "invalid_query_plan", { reason: "missing_search_range" });
      const result = resolveAvailableDates({ availableDatesResolver, propertyId: property.propertyId, request, resolved });
      if (result.status === "answered") return queryOutcome(queryPlan, "answered", { facts: { availableDates: result.dates.filter((item) => item.available).map((item) => item.checkIn), range: stay.searchRange, source: result.source, propertyId: property.propertyId }, resolverAttempted: true });
      return queryOutcome(queryPlan, result.status === "unknown" ? "unknown" : "technical_error", { reason: `available_dates_${result.status}`, resolverAttempted: true });
    }
    if (["availability", "bundle_availability", "room_options", "capacity", "price", "total_price"].includes(queryPlan.capability)) {
      if (!stay.checkIn || !stay.checkOut) return queryOutcome(queryPlan, "invalid_query_plan", { reason: "missing_stay" });
      const adapted = resolveAvailability({ availabilityResolver, propertyId: property.propertyId, request, resolved });
      if (!adapted.result.availabilityReliable) return queryOutcome(queryPlan, "technical_error", { reason: "availability_unreliable", resolverAttempted: true });
      if (["availability", "bundle_availability", "room_options", "capacity"].includes(queryPlan.capability)) return queryOutcome(queryPlan, adapted.facts.availableInventory.length ? "answered" : "no_availability", { facts: adapted.facts, resolverAttempted: true });
      return queryOutcome(queryPlan, "answered", { facts: adapted.facts, resolverAttempted: true });
    }
    return queryOutcome(queryPlan, "unknown", { reason: "unsupported_capability" });
  } catch { return queryOutcome(queryPlan, "technical_error", { reason: "resolver_exception", resolverAttempted: true }); }
}

module.exports = { executeTasks, executeQueryPlan, executeQueryPlans, priceKey, isGenericAvailabilityEntity, executePropertyFactTask, catalogFactByCanonicalId };
