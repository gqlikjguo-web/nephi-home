"use strict";

function availabilityRequest(propertyId, request, resolved) {
  const entity = resolved && resolved.status === "resolved" ? resolved.entity : null;
  const roomTypeSet = resolved && resolved.status === "matched_set" ? resolved.entities.map((item) => item.canonicalId).filter(Boolean) : [];
  return {
    customerId: propertyId,
    checkIn: request.stay.checkIn,
    checkOut: request.stay.checkOut,
    guests: request.stay.guests || null,
    roomType: entity ? entity.canonicalId : "all",
    ...(roomTypeSet.length ? { roomTypeSet } : {}),
    queryMode: request.inventory.mode || "any"
  };
}

function availabilityFacts(result, propertyId) {
  return {
    checkIn: result.checkIn,
    checkOut: result.checkOut,
    availableInventory: (result.rooms || []).map((room) => ({ canonicalId: room.id, publicName: room.publicDisplayName || room.displayName || room.publicName || room.name, capacity: Number(room.capacity) || null, category: room.inventoryType === "bundle" ? "bundle" : "room" })),
    availability: (result.rooms || []).length ? "available" : "full",
    source: "availability_resolver",
    propertyId
  };
}

function resolveAvailability({ availabilityResolver, propertyId, request, resolved }) {
  if (typeof availabilityResolver !== "function") throw new Error("availability_resolver_required");
  const contractRequest = availabilityRequest(propertyId, request, resolved);
  const result = availabilityResolver(contractRequest);
  if (!result || result.customerId !== propertyId) throw new Error("availability_resolver_invalid_result");
  return { result, facts: availabilityFacts(result, propertyId) };
}

function resolveAvailableDates({ availableDatesResolver, propertyId, request, resolved }) {
  if (typeof availableDatesResolver !== "function") throw new Error("available_dates_resolver_required");
  const entity = resolved && resolved.status === "resolved" ? resolved.entity : null;
  const roomTypeSet = resolved && resolved.status === "matched_set" ? resolved.entities.map((item) => item.canonicalId).filter(Boolean) : [];
  const result = availableDatesResolver({ customerId: propertyId, dateFrom: request.stay.searchRange.from, dateTo: request.stay.searchRange.to, nights: request.stay.nights || 1, guests: request.stay.guests || null, roomType: entity ? entity.canonicalId : "all", ...(roomTypeSet.length ? { roomTypeSet } : {}), queryMode: request.inventory.mode || "any" });
  if (!result || !["answered", "unknown", "unreliable"].includes(result.status)) throw new Error("available_dates_resolver_invalid_result");
  return result;
}

module.exports = { availabilityRequest, availabilityFacts, resolveAvailability, resolveAvailableDates };
