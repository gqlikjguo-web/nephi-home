"use strict";

const { resolveEntity } = require("./entity-resolver");
const { addDays } = require("./temporal-resolver");

function stayDates(checkIn, checkOut) { const dates = []; for (let d = checkIn; d && checkOut && d < checkOut && dates.length < 60; d = addDays(d, 1)) dates.push(d); return dates; }
function publicInventory(item) { return { canonicalId: item.id, publicName: String(item.publicDisplayName || item.displayName || item.publicName || item.name || "房型").slice(0, 100), capacity: Number(item.capacity) || null, category: item.inventoryType === "bundle" ? "bundle" : "room" }; }
function selected(property, request, entity) {
  return (property.rooms || []).filter((room) => room.enabled !== false)
    .filter((room) => request.inventory.mode !== "bundle_only" || room.inventoryType === "bundle")
    .filter((room) => request.inventory.mode !== "room_only" || room.inventoryType !== "bundle")
    .filter((room) => !entity || room.id === entity.canonicalId)
    .filter((room) => !request.stay.guests || Number(room.capacity) >= Number(request.stay.guests));
}
function priceKey(date) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return day === 5 ? "fridayPrice" : day === 6 ? "saturdayHolidayPrice" : day === 0 ? "sundayPrice" : "mondayThursdayPrice"; }

function executeTasks({ property, catalog, tasks, request, availability, priceOverrides = [] }) {
  const dates = stayDates(request.stay.checkIn, request.stay.checkOut);
  const rows = dates.length && availability && typeof availability.getRows === "function" ? availability.getRows(property.propertyId, request.stay.checkIn, request.stay.checkOut) : [];
  const byDate = Object.fromEntries(rows.map((row) => [row.date, row]));
  const reliable = dates.length > 0 && dates.every((date) => byDate[date]);
  return tasks.map((task) => {
    try {
    const resolved = task.entity && task.entity.rawText ? resolveEntity(catalog, task.entity) : null;
    if (resolved && resolved.status === "ambiguous") return { taskId: task.taskId, type: task.type, status: "needs_clarification", question: "想確認您指的是哪一個？", candidates: resolved.candidates, facts: {} };
    if (["amenity", "policy", "property_fact"].includes(task.type)) {
      if (!resolved || resolved.status !== "resolved") return { taskId: task.taskId, type: task.type, status: "needs_human", reason: "property_fact_unknown", facts: { subject: task.entity && task.entity.rawText || "這項資訊" }, review: true };
      const entity = resolved.entity;
      if (entity.status === "unknown") return { taskId: task.taskId, type: task.type, status: "needs_human", reason: "property_fact_unknown", facts: { subject: entity.publicName }, review: true };
      return { taskId: task.taskId, type: task.type, status: "answered", facts: { subject: entity.publicName, status: entity.status, answer: entity.answer || "", source: "property_catalog", propertyId: property.propertyId } };
    }
    if (task.type === "amenity_list") return { taskId: task.taskId, type: task.type, status: "answered", facts: { amenities: catalog.amenities.filter((x) => x.status === "confirmed_yes").map((x) => x.publicName), source: "property_catalog", propertyId: property.propertyId } };
    if (task.type === "available_dates") {
      const range = request.stay.searchRange;
      if (!range || !range.from || !range.to) return { taskId: task.taskId, type: task.type, status: "needs_clarification", question: "想查哪一段日期呢？", facts: {} };
      const rangeRows = availability.getRows(property.propertyId, range.from, range.to);
      const entity = resolved && resolved.status === "resolved" ? resolved.entity : null;
      const candidates = selected(property, request, entity);
      const availableDates = rangeRows.filter((row) => candidates.some((room) => row[room.id] === "available")).map((row) => row.date);
      return { taskId: task.taskId, type: task.type, status: "answered", facts: { availableDates, range, source: "availability_provider", propertyId: property.propertyId } };
    }
    if (["availability", "bundle_availability", "room_options", "capacity", "price", "total_price"].includes(task.type)) {
      if (!request.stay.checkIn || !request.stay.checkOut) return { taskId: task.taskId, type: task.type, status: "needs_clarification", question: "想查哪一天入住、住幾晚呢？", facts: {} };
      if (!reliable) return { taskId: task.taskId, type: task.type, status: "needs_human", reason: "availability_unreliable", facts: {}, review: true };
      const entity = resolved && resolved.status === "resolved" ? resolved.entity : null;
      const candidates = selected(property, request, entity).filter((room) => dates.every((date) => byDate[date] && byDate[date][room.id] === "available"));
      const availableInventory = candidates.map(publicInventory);
      if (["availability", "bundle_availability", "room_options", "capacity"].includes(task.type)) return { taskId: task.taskId, type: task.type, status: "answered", facts: { checkIn: request.stay.checkIn, checkOut: request.stay.checkOut, availableInventory, availability: availableInventory.length ? "available" : "full", source: "availability_provider", propertyId: property.propertyId } };
      if (!availableInventory.length) return { taskId: task.taskId, type: task.type, status: "answered", facts: { availability: "full", checkIn: request.stay.checkIn, checkOut: request.stay.checkOut, prices: [], source: "availability_provider", propertyId: property.propertyId } };
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

module.exports = { executeTasks, priceKey };
