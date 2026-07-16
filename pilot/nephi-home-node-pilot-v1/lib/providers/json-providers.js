"use strict";

const { JsonFileRepository } = require("../json-repository");
const { CustomerSettingsProvider, AvailabilityProvider, PersistenceProvider } = require("./contracts");

function toProperty(homestay) {
  if (!homestay) return null;
  return {
    propertyId: homestay.customerId,
    displayName: homestay.name,
    rooms: homestay.rooms || [],
    commonAnswers: homestay.safeFacts || {},
    pricing: homestay.pricing || {},
    faqs: homestay.faqs || [],
    humanHandoffSituations: homestay.humanHandoffSituations || [],
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
  updateProperty(propertyId, input) {
    const updated = this.repository.updateHomestay(propertyId, {
      name: input.displayName,
      rooms: input.rooms,
      safeFacts: input.commonAnswers
    });
    return toProperty(updated);
  }
}

class JsonAvailabilityProvider extends AvailabilityProvider {
  constructor(repository) { super(); this.repository = repository; }
  getRows(propertyId, from, to) { return this.repository.getAvailabilityRows(propertyId, from, to); }
  setDay(propertyId, date, roomId, status) { return this.repository.setAvailabilityDay(propertyId, date, roomId, status); }
  getDayNotes(propertyId, from, to) { return this.repository.getAvailabilityDayNotes(propertyId, from, to); }
  setDayNote(propertyId, roomTypeId, date, note) { return this.repository.setAvailabilityDayNote(propertyId, roomTypeId, date, note); }
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
