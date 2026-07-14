"use strict";

function notImplemented(provider, method) {
  throw new Error(`${provider}.${method} must be implemented`);
}

class CustomerSettingsProvider {
  listProperties() { return notImplemented("CustomerSettingsProvider", "listProperties"); }
  getProperty() { return notImplemented("CustomerSettingsProvider", "getProperty"); }
  updateProperty() { return notImplemented("CustomerSettingsProvider", "updateProperty"); }
}

class AvailabilityProvider {
  getRows() { return notImplemented("AvailabilityProvider", "getRows"); }
  setDay() { return notImplemented("AvailabilityProvider", "setDay"); }
}

class StructuredClassifierProvider {
  classify() { return notImplemented("StructuredClassifierProvider", "classify"); }
}

class PersistenceProvider {
  // Formal database adapters must implement this as an atomic insert protected
  // by a unique constraint on (propertyId, externalEventId). channelId is
  // persisted for isolation and audit, but cannot be used to replay an event.
  claimMessageEvent() { return notImplemented("PersistenceProvider", "claimMessageEvent"); }
  updateMessageEvent() { return notImplemented("PersistenceProvider", "updateMessageEvent"); }
  listGuests() { return notImplemented("PersistenceProvider", "listGuests"); }
  createGuest() { return notImplemented("PersistenceProvider", "createGuest"); }
  updateGuest() { return notImplemented("PersistenceProvider", "updateGuest"); }
  getGuest() { return notImplemented("PersistenceProvider", "getGuest"); }
  findGuestByLineUserId() { return notImplemented("PersistenceProvider", "findGuestByLineUserId"); }
  listNotes() { return notImplemented("PersistenceProvider", "listNotes"); }
  addNote() { return notImplemented("PersistenceProvider", "addNote"); }
  updateNote() { return notImplemented("PersistenceProvider", "updateNote"); }
  listMessageLogs() { return notImplemented("PersistenceProvider", "listMessageLogs"); }
  listRecentMessages() { return notImplemented("PersistenceProvider", "listRecentMessages"); }
  findMessageByEventId() { return notImplemented("PersistenceProvider", "findMessageByEventId"); }
  appendMessageLog() { return notImplemented("PersistenceProvider", "appendMessageLog"); }
  listGuestMessages() { return notImplemented("PersistenceProvider", "listGuestMessages"); }
  linkMessagesToGuest() { return notImplemented("PersistenceProvider", "linkMessagesToGuest"); }
  getConversationState() { return notImplemented("PersistenceProvider", "getConversationState"); }
  setConversationState() { return notImplemented("PersistenceProvider", "setConversationState"); }
  deleteConversationState() { return notImplemented("PersistenceProvider", "deleteConversationState"); }
  resolveReview() { return notImplemented("PersistenceProvider", "resolveReview"); }
}

module.exports = {
  CustomerSettingsProvider,
  AvailabilityProvider,
  PersistenceProvider,
  StructuredClassifierProvider
};
