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
  return (queryPlans || []).flatMap((plan) => {
    const entity = plan.entity || {};
    const resolved = plan.resolvedEntity || (entity.status === "matched_set"
      ? { status: "matched_set", entities: (entity.canonicalSet || []).map((canonicalId) => ({ canonicalId, category: entity.category })) }
      : entity.status === "resolved"
        ? { status: "resolved", entity: { canonicalId: entity.canonicalId, category: entity.category } }
        : null);
    const task = {
      taskId: plan.taskId, candidateIndex: plan.candidateIndex, type: plan.capability,
      requestedOutputs: plan.expectedOutputs || [], detailIntent: plan.conditions.topic && plan.conditions.topic.detailIntent || "general",
      sourceText: "", entity: { category: entity.category || "other", rawText: entity.rawText || entity.canonicalId || "", canonicalCandidate: entity.canonicalId || null },
      _resolvedEntity: resolved
    };
    return executeTasks({ property, catalog, tasks: [task], request: plan.conditions, availabilityResolver, availableDatesResolver, priceOverrides });
  });
}

module.exports = { executeTasks, executeQueryPlans, priceKey, isGenericAvailabilityEntity, executePropertyFactTask, catalogFactByCanonicalId };
