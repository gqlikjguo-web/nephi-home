"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function mergeSeedMessageLogs(state, seed) {
  state.messageLogs = state.messageLogs || {};

  Object.entries(seed.messageLogs || {}).forEach(([customerId, seedLogs]) => {
    const existingLogs = state.messageLogs[customerId] || [];
    const existingByReviewId = Object.fromEntries(
      existingLogs.map((item) => [item.reviewId, item])
    );
    const seedReviewIds = new Set(seedLogs.map((item) => item.reviewId));

    const migratedSeedLogs = seedLogs.map((seedItem) => {
      const existing = existingByReviewId[seedItem.reviewId];
      if (!existing) return { ...seedItem };

      const hasOwnerReview = existing.status === "resolved" || Boolean(existing.ownerAction);
      return {
        ...seedItem,
        ...existing,
        guestMessage: seedItem.guestMessage,
        detectedIntent: seedItem.detectedIntent,
        replyType: seedItem.replyType,
        replyText: seedItem.replyText,
        reviewNote: hasOwnerReview ? existing.reviewNote : seedItem.reviewNote
      };
    });

    state.messageLogs[customerId] = migratedSeedLogs.concat(
      existingLogs.filter((item) => !seedReviewIds.has(item.reviewId))
    );
  });
}

function propertyInventory(property) {
  return (property && Array.isArray(property.rooms) ? property.rooms : [])
    .filter((item) => item && item.id)
    .map((item) => ({ ...item, id: String(item.id) }));
}

function bundleInventory(property) {
  return propertyInventory(property).filter((item) => Array.isArray(item.memberRoomIds) && item.memberRoomIds.length);
}

function availabilityRow(property, date, status) {
  return Object.fromEntries([
    ["date", date],
    ...propertyInventory(property).map((item) => [item.id, status])
  ]);
}

function recomputeBundleAvailability(property, row) {
  for (const bundle of bundleInventory(property)) {
    row[bundle.id] = bundle.memberRoomIds.every((roomId) => row[roomId] === "available")
      ? "available"
      : "closed";
  }
}

function migrateDailyRoomNotes(state) {
  state.dailyRoomNotes = state.dailyRoomNotes || {};
  for (const dates of Object.values(state.dailyRoomNotes)) {
    for (const [date, notes] of Object.entries(dates || {})) {
      const migrated = {};
      for (const [storedKey, storedItem] of Object.entries(notes || {})) {
        if (!storedItem || typeof storedItem !== "object") continue;
        const inventoryType = storedItem.inventoryType === "bundle" ? "bundle" : "room";
        const inventoryId = String(storedItem.inventoryId || storedItem.roomTypeId || (storedKey.includes(":") ? storedKey.slice(storedKey.indexOf(":") + 1) : storedKey));
        const key = `${inventoryType}:${inventoryId}`;
        const item = { ...storedItem, inventoryType, inventoryId, date: storedItem.date || date };
        delete item.roomTypeId;
        if (!migrated[key] || storedItem.inventoryType) migrated[key] = item;
      }
      dates[date] = migrated;
    }
  }
}

class JsonFileRepository {
  constructor({ dataFile, seedFile, now = () => new Date() }) {
    this.dataFile = path.resolve(dataFile);
    this.seedFile = path.resolve(seedFile);
    this.now = now;
    this.ensureInitialized();
  }

  ensureInitialized() {
    const seed = JSON.parse(fs.readFileSync(this.seedFile, "utf8"));
    if (fs.existsSync(this.dataFile)) {
      const state = this.read();
      state.conversationStates = state.conversationStates || {};
      state.customReplies = state.customReplies || {};
      migrateDailyRoomNotes(state);
      const existingById = Object.fromEntries((state.homestays || []).map((item) => [item.customerId, item]));
      const seedIds = new Set((seed.homestays || []).map((item) => item.customerId));
      state.homestays = (seed.homestays || []).map((item) => {
        const existing = existingById[item.customerId];
        if (!existing) return item;
        return {
          ...item,
          ...existing,
          safeFacts: { ...(item.safeFacts || {}), ...(existing.safeFacts || {}) },
          rooms: existing.rooms || item.rooms || []
        };
      }).concat((state.homestays || []).filter((item) => !seedIds.has(item.customerId)));
      mergeSeedMessageLogs(state, seed);
      this.write(state);
      return;
    }
    const start = new Date(this.now());
    start.setUTCHours(0, 0, 0, 0);
    const availability = {};
    const guests = {};
    const notes = {};
    const dailyRoomNotes = {};

    for (const homestay of seed.homestays || []) {
      availability[homestay.customerId] = {};
      guests[homestay.customerId] = [];
      notes[homestay.customerId] = [];
      dailyRoomNotes[homestay.customerId] = {};
      for (let offset = 0; offset < Number(seed.seedDays || 180); offset += 1) {
        const date = dateKey(addUtcDays(start, offset));
        availability[homestay.customerId][date] = availabilityRow(homestay, date, "available");
      }
    }

    const state = {
      testOnly: true,
      version: 1,
      homestays: seed.homestays || [],
      availability,
      guests,
      notes,
      dailyRoomNotes,
      messageLogs: seed.messageLogs || {},
      conversationStates: {},
      customReplies: {}
    };
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    this.write(state);
  }

  read() {
    return JSON.parse(fs.readFileSync(this.dataFile, "utf8"));
  }

  write(state) {
    fs.writeFileSync(this.dataFile, JSON.stringify(state, null, 2) + "\n", "utf8");
  }

  eventClaimPath(customerId, channelId, eventId) {
    const key = [customerId, eventId].map((value) => String(value || "").trim()).join("\u0000");
    const digest = crypto.createHash("sha256").update(key).digest("hex");
    return path.join(`${this.dataFile}.event-claims`, `${digest}.json`);
  }

  safeEventData(input = {}) {
    const result = { ...input };
    [
      "replyToken", "accessToken", "lineChannelAccessToken", "channelSecret",
      "secret", "token", "externalErrorPayload", "externalResponsePayload"
    ].forEach((key) => { delete result[key]; });
    return result;
  }

  mutate(mutator) {
    const state = this.read();
    const result = mutator(state);
    this.write(state);
    return result;
  }

  listHomestays() {
    return this.read().homestays.map((item) => JSON.parse(JSON.stringify(item)));
  }

  getHomestay(customerId) {
    return this.read().homestays.find((item) => item.customerId === customerId) || null;
  }

  updateHomestay(customerId, input) {
    return this.mutate((state) => {
      const homestay = (state.homestays || []).find((item) => item.customerId === customerId);
      if (!homestay) return null;
      const nextRoomIds = new Set(input.rooms.map((room) => room.id));
      const removedRoomIds = (homestay.rooms || []).map((room) => room.id).filter((id) => !nextRoomIds.has(id));
      Object.values(state.availability[customerId] || {}).forEach((row) => {
        removedRoomIds.forEach((roomId) => { delete row[roomId]; });
        if (removedRoomIds.length) recomputeBundleAvailability(input, row);
      });
      homestay.name = input.name;
      homestay.rooms = input.rooms.map((room) => ({ ...room }));
      homestay.safeFacts = { ...input.safeFacts };
      if (Object.hasOwn(input, "propertyFacts")) homestay.propertyFacts = JSON.parse(JSON.stringify(input.propertyFacts || []));
      if (input.businessProfile) homestay.businessProfile = { ...input.businessProfile };
      if (Object.hasOwn(input, "lineUrl")) homestay.lineUrl = input.lineUrl;
      homestay.updatedAt = this.now().toISOString();
      return JSON.parse(JSON.stringify(homestay));
    });
  }

  listCustomReplies(customerId) {
    return JSON.parse(JSON.stringify((this.read().customReplies || {})[customerId] || []));
  }

  createCustomReply(input) {
    return this.mutate((state) => {
      state.customReplies = state.customReplies || {};
      state.customReplies[input.propertyId] = state.customReplies[input.propertyId] || [];
      state.customReplies[input.propertyId].push(JSON.parse(JSON.stringify(input)));
      return JSON.parse(JSON.stringify(input));
    });
  }

  updateCustomReply(propertyId, ruleId, input) {
    return this.mutate((state) => {
      const items = (state.customReplies || {})[propertyId] || [];
      const index = items.findIndex((item) => item.ruleId === ruleId);
      if (index < 0) return null;
      items[index] = JSON.parse(JSON.stringify(input));
      return JSON.parse(JSON.stringify(items[index]));
    });
  }

  removeCustomReply(propertyId, ruleId) {
    return this.mutate((state) => {
      const items = (state.customReplies || {})[propertyId] || [];
      const index = items.findIndex((item) => item.ruleId === ruleId);
      if (index < 0) return false;
      items.splice(index, 1);
      return true;
    });
  }

  upsertHomestay(input, { seedDays = 240 } = {}) {
    return this.mutate((state) => {
      state.homestays = state.homestays || [];
      const existing = state.homestays.find((item) => item.customerId === input.customerId);
      const created = !existing;
      const homestay = existing || { customerId: input.customerId, createdAt: this.now().toISOString() };
      Object.assign(homestay, JSON.parse(JSON.stringify(input)), { updatedAt: this.now().toISOString() });
      if (created) state.homestays.push(homestay);

      state.availability = state.availability || {};
      state.guests = state.guests || {};
      state.notes = state.notes || {};
      state.messageLogs = state.messageLogs || {};
      state.dailyRoomNotes = state.dailyRoomNotes || {};
      state.availability[input.customerId] = state.availability[input.customerId] || {};
      state.guests[input.customerId] = state.guests[input.customerId] || [];
      state.notes[input.customerId] = state.notes[input.customerId] || [];
      state.messageLogs[input.customerId] = state.messageLogs[input.customerId] || [];
      state.dailyRoomNotes[input.customerId] = state.dailyRoomNotes[input.customerId] || {};

      if (created) {
        const start = new Date(this.now());
        start.setUTCHours(0, 0, 0, 0);
        for (let offset = 0; offset < Number(seedDays || 240); offset += 1) {
          const date = dateKey(addUtcDays(start, offset));
          state.availability[input.customerId][date] = availabilityRow(homestay, date, "closed");
        }
      }
      return { created, homestay: JSON.parse(JSON.stringify(homestay)) };
    });
  }

  getAvailabilityRows(customerId, from, to) {
    const rows = this.read().availability[customerId] || {};
    return Object.keys(rows)
      .filter((date) => (!from || date >= from) && (!to || date < to))
      .sort()
      .map((date) => ({ ...rows[date] }));
  }

  setAvailabilityDay(customerId, date, roomId, status) {
    return this.mutate((state) => {
      const rows = state.availability[customerId];
      const property = (state.homestays || []).find((item) => item.customerId === customerId);
      const inventory = propertyInventory(property).find((item) => item.id === roomId);
      if (!inventory) throw new Error("invalid inventory");
      const row = rows[date] || availabilityRow(property, date, "available");
      if (Array.isArray(inventory.memberRoomIds) && inventory.memberRoomIds.length) {
        row[roomId] = status;
        for (const memberRoomId of inventory.memberRoomIds) row[memberRoomId] = status;
      } else {
        row[roomId] = status;
        recomputeBundleAvailability(property, row);
      }
      rows[date] = row;
      return { ...row };
    });
  }

  getAvailabilityDayNotes(customerId, from, to) {
    const dates = (this.read().dailyRoomNotes || {})[customerId] || {};
    return Object.keys(dates)
      .filter((date) => (!from || date >= from) && (!to || date < to))
      .sort()
      .flatMap((date) => Object.values(dates[date]).map((item) => ({ ...item })));
  }

  setAvailabilityDayNote(customerId, inventoryType, inventoryId, date, value) {
    return this.mutate((state) => {
      const homestay = (state.homestays || []).find((item) => item.customerId === customerId);
      if (!homestay || !["room", "bundle"].includes(inventoryType) || !(homestay.rooms || []).some((room) => room.id === inventoryId && (room.inventoryType === "bundle" ? "bundle" : "room") === inventoryType)) throw new Error("inventory not found");
      state.dailyRoomNotes = state.dailyRoomNotes || {};
      state.dailyRoomNotes[customerId] = state.dailyRoomNotes[customerId] || {};
      state.dailyRoomNotes[customerId][date] = state.dailyRoomNotes[customerId][date] || {};
      const inventoryKey = `${inventoryType}:${inventoryId}`;
      const note = String(value || "").trim();
      if (!note) {
        delete state.dailyRoomNotes[customerId][date][inventoryKey];
        if (!Object.keys(state.dailyRoomNotes[customerId][date]).length) delete state.dailyRoomNotes[customerId][date];
        return null;
      }
      const existing = state.dailyRoomNotes[customerId][date][inventoryKey];
      const timestamp = this.now().toISOString();
      const item = {
        propertyId: customerId,
        inventoryType,
        inventoryId,
        date,
        note,
        createdAt: existing ? existing.createdAt : timestamp,
        updatedAt: timestamp
      };
      state.dailyRoomNotes[customerId][date][inventoryKey] = item;
      return { ...item };
    });
  }

  listGuests(customerId) {
    return (this.read().guests[customerId] || []).map((item) => ({ ...item }));
  }

  createGuest(customerId, input) {
    return this.mutate((state) => {
      const items = state.guests[customerId];
      const timestamp = this.now().toISOString();
      const guest = {
        guestId: `guest_${Date.now()}_${items.length + 1}`,
        customerId,
        name: String(input.name || "").trim(),
        phone: String(input.phone || "").trim(),
        email: String(input.email || "").trim(),
        lineUserId: String(input.lineUserId || "").trim(),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      items.push(guest);
      return { ...guest };
    });
  }

  updateGuest(customerId, guestId, input) {
    return this.mutate((state) => {
      const guest = (state.guests[customerId] || []).find((item) => item.guestId === guestId);
      if (!guest) return null;
      guest.name = String(input.name || guest.name).trim();
      guest.phone = String(input.phone === undefined ? guest.phone : input.phone).trim();
      guest.email = String(input.email === undefined ? guest.email : input.email).trim();
      guest.lineUserId = String(input.lineUserId === undefined ? guest.lineUserId || "" : input.lineUserId).trim();
      guest.updatedAt = this.now().toISOString();
      return { ...guest };
    });
  }

  getGuest(customerId, guestId) {
    return this.listGuests(customerId).find((item) => item.guestId === guestId) || null;
  }

  findGuestByLineUserId(customerId, lineUserId) {
    const id = String(lineUserId || "").trim();
    if (!id) return null;
    return this.listGuests(customerId).find((item) => item.lineUserId === id) || null;
  }

  listNotes(customerId, guestId) {
    return (this.read().notes[customerId] || [])
      .filter((item) => item.guestId === guestId)
      .map((item) => ({ ...item }));
  }

  addNote(customerId, guestId, text) {
    return this.mutate((state) => {
      const items = state.notes[customerId];
      const note = {
        noteId: `note_${Date.now()}_${items.length + 1}`,
        customerId,
        guestId,
        text: String(text || "").trim(),
        createdAt: this.now().toISOString()
      };
      items.push(note);
      return { ...note };
    });
  }

  updateNote(customerId, guestId, noteId, text) {
    return this.mutate((state) => {
      const note = (state.notes[customerId] || []).find((item) => item.guestId === guestId && item.noteId === noteId);
      if (!note) return null;
      note.text = String(text || "").trim();
      note.updatedAt = this.now().toISOString();
      return { ...note };
    });
  }

  listMessageLogs(customerId) {
    const stored = (this.read().messageLogs[customerId] || []).map((item) => ({ ...item, customerId }));
    const seen = new Set(stored.map((item) => `${item.channelId || ""}\u0000${item.eventId || ""}`));
    const claimDirectory = `${this.dataFile}.event-claims`;
    if (!fs.existsSync(claimDirectory)) return stored;
    for (const entry of fs.readdirSync(claimDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const claim = JSON.parse(fs.readFileSync(path.join(claimDirectory, entry.name), "utf8"));
        const key = `${claim.channelId || ""}\u0000${claim.eventId || ""}`;
        if (claim.propertyId === customerId && !seen.has(key)) {
          stored.push({ ...claim, customerId });
          seen.add(key);
        }
      } catch {
        // The exclusive marker still blocks duplicate processing if a process
        // stopped while writing; malformed marker contents are never trusted.
      }
    }
    return stored;
  }

  listRecentMessages(customerId, channelId, lineUserId, options = {}) {
    const limit = Math.max(1, Math.min(50, Number(options.limit || 10)));
    const sinceMs = Date.parse(options.since || "");
    return this.listMessageLogs(customerId)
      .filter((item) => item.channelId === channelId && item.lineUserId === lineUserId)
      .filter((item) => item.processingStatus !== "processing")
      .filter((item) => !Number.isFinite(sinceMs) || Date.parse(item.createdAt || "") >= sinceMs)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, limit)
      .reverse();
  }

  findMessageByEventId(customerId, eventId, channelId) {
    const id = String(eventId || "").trim();
    if (!id) return null;
    return this.listMessageLogs(customerId).find((item) => (
      item.eventId === id && (!channelId || item.channelId === channelId)
    )) || null;
  }

  claimMessageEvent(customerId, channelId, eventId, initialData = {}) {
    const property = String(customerId || "").trim();
    const channel = String(channelId || "").trim();
    const externalEventId = String(eventId || "").trim();
    if (!property || !channel || !externalEventId) throw new Error("propertyId, channelId and eventId are required for atomic event claim");
    const timestamp = this.now().toISOString();
    const item = this.safeEventData({
      ...initialData,
      customerId: undefined,
      propertyId: property,
      channelId: channel,
      eventId: externalEventId,
      reviewId: initialData.reviewId || `message_${crypto.randomUUID()}`,
      processingStatus: "processing",
      claimedAt: timestamp,
      createdAt: initialData.createdAt || timestamp,
      updatedAt: timestamp,
      shouldReply: false,
      noReply: false,
      needsReview: false,
      status: "processing"
    });
    delete item.customerId;
    const claimPath = this.eventClaimPath(property, channel, externalEventId);
    fs.mkdirSync(path.dirname(claimPath), { recursive: true });
    const preparedPath = `${claimPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(preparedPath, JSON.stringify(item), { encoding: "utf8", flag: "wx" });
      fs.linkSync(preparedPath, claimPath);
    } catch (error) {
      if (error && error.code !== "EEXIST") throw error;
      let existing = this.findMessageByEventId(property, externalEventId);
      if (!existing) {
        try {
          existing = { ...JSON.parse(fs.readFileSync(claimPath, "utf8")), customerId: property };
        } catch {
          existing = { ...item, customerId: property };
        }
      }
      return { claimed: false, duplicate: true, processingStatus: existing.processingStatus || "processing", item: existing };
    } finally {
      if (fs.existsSync(preparedPath)) fs.unlinkSync(preparedPath);
    }
    const persisted = this.appendMessageLog(property, item);
    return { claimed: true, duplicate: false, processingStatus: "processing", item: persisted };
  }

  updateMessageEvent(customerId, channelId, eventId, patch = {}) {
    const safePatch = this.safeEventData(patch);
    return this.mutate((state) => {
      const items = state.messageLogs[customerId] || [];
      const item = items.find((entry) => entry.eventId === eventId && entry.channelId === channelId);
      if (!item) return null;
      Object.assign(item, safePatch, { updatedAt: this.now().toISOString() });
      const timestampFields = {
        decided: "decidedAt",
        no_reply: "noReplyAt",
        reply_succeeded: "replySucceededAt",
        reply_failed: "replyFailedAt",
        processing_failed: "processingFailedAt"
      };
      const timestampField = timestampFields[item.processingStatus];
      if (timestampField && !item[timestampField]) item[timestampField] = this.now().toISOString();
      return { ...item, customerId };
    });
  }

  appendMessageLog(customerId, input) {
    return this.mutate((state) => {
      const items = state.messageLogs[customerId];
      const item = {
        ...input,
        reviewId: input.reviewId || `message_${Date.now()}_${items.length + 1}`,
        createdAt: input.createdAt || this.now().toISOString()
      };
      items.push(item);
      return { ...item, customerId };
    });
  }

  listGuestMessages(customerId, guestId) {
    return this.listMessageLogs(customerId).filter((item) => item.guestId === guestId);
  }

  linkMessagesToGuest(customerId, lineUserId, guestId) {
    return this.mutate((state) => {
      let updated = 0;
      (state.messageLogs[customerId] || []).forEach((item) => {
        if (!item.guestId && item.lineUserId === lineUserId) {
          item.guestId = guestId;
          updated += 1;
        }
      });
      return updated;
    });
  }

  getConversationState(customerId, channelId, lineUserId) {
    const state = this.read();
    const byCustomer = state.conversationStates && state.conversationStates[customerId];
    const byChannel = byCustomer && byCustomer[channelId];
    const item = byChannel && byChannel[lineUserId];
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  setConversationState(customerId, channelId, lineUserId, input) {
    return this.mutate((state) => {
      state.conversationStates = state.conversationStates || {};
      state.conversationStates[customerId] = state.conversationStates[customerId] || {};
      state.conversationStates[customerId][channelId] = state.conversationStates[customerId][channelId] || {};
      state.conversationStates[customerId][channelId][lineUserId] = JSON.parse(JSON.stringify(input));
      return JSON.parse(JSON.stringify(state.conversationStates[customerId][channelId][lineUserId]));
    });
  }

  deleteConversationState(customerId, channelId, lineUserId) {
    return this.mutate((state) => {
      const byCustomer = state.conversationStates && state.conversationStates[customerId];
      const byChannel = byCustomer && byCustomer[channelId];
      if (!byChannel || !byChannel[lineUserId]) return false;
      delete byChannel[lineUserId];
      return true;
    });
  }

  resolveReview(customerId, reviewId, ownerAction, reviewNote) {
    return this.mutate((state) => {
      const item = (state.messageLogs[customerId] || []).find((log) => log.reviewId === reviewId);
      if (!item) return null;
      item.ownerAction = ownerAction;
      item.reviewNote = reviewNote;
      item.status = "resolved";
      item.resolvedAt = this.now().toISOString();
      return { ...item, customerId };
    });
  }
}

module.exports = { JsonFileRepository };
