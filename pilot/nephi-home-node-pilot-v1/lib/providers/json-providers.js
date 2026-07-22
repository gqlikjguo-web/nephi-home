"use strict";

const { JsonFileRepository } = require("../json-repository");
const { CustomerSettingsProvider, AvailabilityProvider, PersistenceProvider } = require("./contracts");
const { normalizeRoomRecord } = require("../room-data");

function toProperty(homestay) {
  if (!homestay) return null;
  return {
    propertyId: homestay.customerId,
    displayName: homestay.name,
    rooms: (homestay.rooms || []).map(normalizeRoomRecord),
    commonAnswers: homestay.safeFacts || {},
    pricing: homestay.pricing || {},
    faqs: homestay.faqs || [],
    humanHandoffSituations: homestay.humanHandoffSituations || [],
    businessProfile: homestay.businessProfile || {},
    contactLink: homestay.lineUrl || "",
    onboarding: {
      isReady: Boolean(homestay.name && (homestay.rooms || []).length),
      nextStepLabel: "確認常見問題與房型資料"
    }
  };
}

class JsonCustomerSettingsProvider extends CustomerSettingsProvider {
  constructor(repository) { super(); this.repository = repository; }
  listProperties() { return this.repository.listHomestays().map(toProperty); }
  getProperty(propertyId) { return toProperty(this.repository.getHomestay(propertyId)); }
  listRoomRecords(propertyId) { const homestay=this.repository.getHomestay(propertyId);return homestay?(homestay.rooms||[]).filter(room=>room.inventoryType!=="bundle").map(normalizeRoomRecord):[]; }
  updateProperty(propertyId, input) {
    const updated = this.repository.updateHomestay(propertyId, {
      name: input.displayName,
      rooms: input.rooms,
      safeFacts: input.commonAnswers
    });
    return toProperty(updated);
  }
  updatePropertyProfile(propertyId, input) {
    const current = this.repository.getHomestay(propertyId);
    if (!current) return null;
    const updated = this.repository.updateHomestay(propertyId, {
      name: input.displayName,
      rooms: current.rooms || [],
      safeFacts: input.commonAnswers,
      businessProfile: input.businessProfile,
      lineUrl: input.contactLink
    });
    return toProperty(updated);
  }
  updateRoomPricingBatch(propertyId, items) {
    const homestay = this.repository.getHomestay(propertyId);
    if (!homestay) throw new Error("room not found");
    const changes = new Map(items.map((item) => [item.roomTypeId, item]));
    if (changes.size !== items.length || [...changes.keys()].some((id) => !(homestay.rooms || []).some((room) => room.id === id && room.inventoryType !== "bundle"))) throw new Error("room not found");
    const updated = this.repository.updateHomestay(propertyId, { name: homestay.name, rooms: homestay.rooms.map((room) => changes.has(room.id) ? normalizeRoomRecord({ ...room, ...changes.get(room.id) }) : room), safeFacts: homestay.safeFacts || {} });
    return toProperty(updated);
  }
  listRoomPriceOverrides() { return []; }
}

class JsonAvailabilityProvider extends AvailabilityProvider {
  constructor(repository) { super(); this.repository = repository; }
  getRows(propertyId, from, to) { return this.repository.getAvailabilityRows(propertyId, from, to); }
  setDay(propertyId, date, roomId, status) { return this.repository.setAvailabilityDay(propertyId, date, roomId, status); }
  getDayNotes(propertyId, from, to) { return this.repository.getAvailabilityDayNotes(propertyId, from, to); }
  setDayNote(propertyId, inventoryType, inventoryId, date, note) { return this.repository.setAvailabilityDayNote(propertyId, inventoryType, inventoryId, date, note); }
}

class JsonPersistenceProvider extends PersistenceProvider {
  constructor(repository) { super(); this.repository = repository; }
}

[
  "listGuests", "createGuest", "updateGuest", "getGuest", "findGuestByLineUserId",
  "listNotes", "addNote", "updateNote", "listMessageLogs", "listRecentMessages", "findMessageByEventId",
  "claimMessageEvent", "updateMessageEvent", "appendMessageLog", "listGuestMessages", "linkMessagesToGuest", "getConversationState",
  "setConversationState", "deleteConversationState", "resolveReview"
].forEach((method) => {
  JsonPersistenceProvider.prototype[method] = function proxy(...args) {
    return this.repository[method](...args);
  };
});

function createJsonProviders(options) {
  const repository = new JsonFileRepository(options);
  return {
    customerSettings: new JsonCustomerSettingsProvider(repository),
    availability: new JsonAvailabilityProvider(repository),
    persistence: new JsonPersistenceProvider(repository)
  };
}

module.exports = {
  JsonCustomerSettingsProvider,
  JsonAvailabilityProvider,
  JsonPersistenceProvider,
  createJsonProviders
};
