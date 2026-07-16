"use strict";

function toLegacyProperty(property) {
  if (!property) return null;
  return {
    customerId: property.propertyId,
    name: property.displayName,
    rooms: property.rooms || [],
    safeFacts: property.commonAnswers || {},
    lineUrl: property.contactLink || "",
    publicEnabled: !property.onboarding || property.onboarding.isReady !== false
  };
}

function createServiceDataAccess(providers) {
  const settings = providers.customerSettings;
  const availability = providers.availability;
  const persistence = providers.persistence;
  return {
    listHomestays: () => settings.listProperties().map(toLegacyProperty),
    getHomestay: (propertyId) => toLegacyProperty(settings.getProperty(propertyId)),
    updateHomestay: (propertyId, input) => toLegacyProperty(settings.updateProperty(propertyId, {
      displayName: input.name,
      rooms: input.rooms,
      commonAnswers: input.safeFacts
    })),
    getAvailabilityRows: (...args) => availability.getRows(...args),
    setAvailabilityDay: (...args) => availability.setDay(...args),
    getAvailabilityDayNotes: (...args) => availability.getDayNotes(...args),
    setAvailabilityDayNote: (...args) => availability.setDayNote(...args),
    listGuests: (...args) => persistence.listGuests(...args),
    createGuest: (...args) => persistence.createGuest(...args),
    updateGuest: (...args) => persistence.updateGuest(...args),
    getGuest: (...args) => persistence.getGuest(...args),
    findGuestByLineUserId: (...args) => persistence.findGuestByLineUserId(...args),
    listNotes: (...args) => persistence.listNotes(...args),
    addNote: (...args) => persistence.addNote(...args),
    updateNote: (...args) => persistence.updateNote(...args),
    listMessageLogs: (...args) => persistence.listMessageLogs(...args),
    findMessageByEventId: (...args) => persistence.findMessageByEventId(...args),
    updateMessageEvent: (...args) => persistence.updateMessageEvent(...args),
    appendMessageLog: (...args) => persistence.appendMessageLog(...args),
    listGuestMessages: (...args) => persistence.listGuestMessages(...args),
    linkMessagesToGuest: (...args) => persistence.linkMessagesToGuest(...args),
    resolveReview: (...args) => persistence.resolveReview(...args)
  };
}

module.exports = { createServiceDataAccess };
