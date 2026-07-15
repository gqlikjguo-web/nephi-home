"use strict";

const { runtimeCalendarContext } = require("./runtime-calendar");

const STATE_FIELDS = [
  "checkInDate", "checkOutDate", "nights", "guestCount", "roomType",
  "bookingType", "awaitingField", "lastIntent", "updatedAt"
];
const ACCUMULATED_FIELDS = [
  "checkInDate", "checkOutDate", "nights", "guestCount", "roomType", "bookingType"
];

function emptyState(updatedAt) {
  return {
    checkInDate: null,
    checkOutDate: null,
    nights: null,
    guestCount: null,
    roomType: null,
    bookingType: null,
    awaitingField: null,
    lastIntent: null,
    updatedAt,
    lastMessageFingerprint: "",
    lastReplyAt: ""
  };
}

function normalizeMessage(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function isSilentMessage(input) {
  const route = input && input.route && typeof input.route === "object" ? input.route : {};
  return route.route === "no_reply_silent_ignore" || route.shouldIgnore === true;
}

function accumulatedFromState(state) {
  return Object.fromEntries(ACCUMULATED_FIELDS.map((key) => [key, state[key] || null]));
}

function applyExtractedFields(state, extractedFields) {
  const next = { ...state };
  for (const key of ACCUMULATED_FIELDS) {
    const value = extractedFields && extractedFields[key];
    if (value !== undefined && value !== null && value !== "") next[key] = value;
  }
  return next;
}

function normalizedRoomKey(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function roomMatchesType(room, value) {
  const compact = normalizedRoomKey(value);
  if (!compact || !room) return false;
  const id = normalizedRoomKey(room.id);
  const idWithoutPrefix = id.replace(/^room/, "");
  const name = normalizedRoomKey(room.name);
  const descriptiveName = idWithoutPrefix && name.startsWith(idWithoutPrefix)
    ? name.slice(idWithoutPrefix.length)
    : name;
  return [id, idWithoutPrefix, name, descriptiveName, normalizedRoomKey(room.type)].filter(Boolean).includes(compact);
}

function normalizeRoomType(property, value) {
  const input = String(value || "").normalize("NFKC").trim().toLowerCase();
  if (!input || !property || !Array.isArray(property.rooms)) return value;
  const compact = normalizedRoomKey(input);
  for (const room of property.rooms) {
    const exactAliases = [room.id, room.name].map((item) => String(item || "").normalize("NFKC").trim().toLowerCase());
    if (exactAliases.includes(input)) return room.id;
    const compactAliases = exactAliases.map(normalizedRoomKey).filter(Boolean);
    const idWithoutPrefix = normalizedRoomKey(room.id).replace(/^room/, "");
    if (compact && (compactAliases.includes(compact) || (idWithoutPrefix && compact.startsWith(idWithoutPrefix)))) return room.id;
  }
  const matchingRooms = property.rooms.filter((room) => roomMatchesType(room, compact));
  if (matchingRooms.length === 1) return matchingRooms[0].id;
  if (matchingRooms.length > 1) return compact;
  return null;
}

function safeDiagnosticText(value, limit) {
  return String(value || "")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .slice(0, limit);
}

class ConversationCoordinator {
  constructor(options) {
    this.persistence = options.persistence;
    this.now = options.now || (() => new Date());
    this.timeZone = options.timeZone || "Asia/Taipei";
    this.debounceMs = Number(options.debounceMs || 2000);
    this.ttlMs = Number(options.ttlMs || 30 * 60 * 1000);
    this.recentMessageLimit = Math.max(1, Number(options.recentMessageLimit || 10));
    this.recentMessageWindowMs = Math.max(1, Number(options.recentMessageWindowMs || this.ttlMs));
    this.schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
    this.cancel = options.cancel || ((timerId) => clearTimeout(timerId));
    this.resolveMerged = options.resolveMerged;
    this.decisionPipeline = options.decisionPipeline;
    this.getProperty = options.getProperty || (() => null);
    this.availableIntents = options.availableIntents || [];
    this.availableRoutes = options.availableRoutes || [];
    this.externalReplyToken = Boolean(options.externalReplyToken);
    this.onDiagnostic = typeof options.onDiagnostic === "function" ? options.onDiagnostic : null;
    this.pending = new Map();
    this.consumedReplyTokens = new Set();
    this.seenEventIds = new Map();
  }

  key(input) {
    return [input.customerId, input.channelId, input.lineUserId].map((value) => String(value || "").trim()).join(":");
  }

  eventKey(input) {
    return `${String(input.customerId || "").trim()}:${String(input.eventId || "").trim()}`;
  }

  currentState(input) {
    const currentTime = this.now();
    const existing = this.persistence.getConversationState(input.customerId, input.channelId, input.lineUserId);
    if (!existing) return emptyState(currentTime.toISOString());
    const updatedAt = Date.parse(existing.updatedAt || "");
    if (!Number.isFinite(updatedAt) || currentTime.getTime() - updatedAt > this.ttlMs) {
      this.persistence.deleteConversationState(input.customerId, input.channelId, input.lineUserId);
      return emptyState(currentTime.toISOString());
    }
    return { ...emptyState(currentTime.toISOString()), ...existing };
  }

  enqueue(input) {
    const nowMs = this.now().getTime();
    for (const [eventKey, seenAt] of this.seenEventIds.entries()) {
      if (nowMs - seenAt > this.ttlMs) this.seenEventIds.delete(eventKey);
    }
    const eventId = String(input.eventId || "");
    const eventKey = this.eventKey(input);
    if (eventId && (this.seenEventIds.has(eventKey) || [...this.pending.values()].some((item) => item.eventKeys.has(eventKey)))) {
      return Promise.resolve({ shouldReply: false, noReply: true, duplicate: true, replyToken: "" });
    }
    const key = this.key(input);
    let burst = this.pending.get(key);
    if (!burst) {
      burst = { generation: 0, flushing: false, messages: [], waiters: [], eventKeys: new Set(), timerId: null };
      this.pending.set(key, burst);
    }
    if (burst.timerId !== null) this.cancel(burst.timerId);
    burst.generation += 1;
    burst.messages.push({ ...input });
    if (eventId) burst.eventKeys.add(eventKey);
    const promise = new Promise((resolve, reject) => burst.waiters.push({ resolve, reject }));
    const generation = burst.generation;
    burst.timerId = this.schedule(() => this.flush(key, generation), this.debounceMs);
    return promise;
  }

  async flush(key, generation) {
    const burst = this.pending.get(key);
    if (!burst || burst.generation !== generation || burst.flushing) return;
    burst.flushing = true;
    burst.timerId = null;
    const messages = burst.messages;
    const waiterCountAtStart = burst.waiters.length;
    let stage = "load_context";
    try {
      const last = messages[messages.length - 1];
      const state = this.currentState(last);
      const since = new Date(this.now().getTime() - this.recentMessageWindowMs).toISOString();
      const recentMessages = this.persistence.listRecentMessages(
        last.customerId,
        last.channelId,
        last.lineUserId,
        { limit: this.recentMessageLimit, since }
      );
      const property = this.getProperty(last.customerId);
      const calendarContext = runtimeCalendarContext(this.now, this.timeZone);
      stage = "classify";
      let decision = await this.decisionPipeline.decide({
        propertyId: last.customerId,
        channelId: last.channelId,
        lineUserId: last.lineUserId,
        currentMessage: String(last.messageText || ""),
        currentMessages: messages.map((message) => String(message.messageText || "")),
        recentMessages: recentMessages.map((item) => ({
          guestMessage: item.guestMessage,
          route: item.route || "",
          createdAt: item.createdAt
        })),
        conversationState: accumulatedFromState(state),
        accumulatedFields: accumulatedFromState(state),
        currentDate: calendarContext.currentDate,
        timeZone: calendarContext.timeZone,
        availableIntents: property && property.aiPolicy && property.aiPolicy.allowedIntents || this.availableIntents,
        availableRoutes: property && property.aiPolicy && property.aiPolicy.allowedRoutes || this.availableRoutes,
        property
      });
      if (decision.extractedFields && decision.extractedFields.roomType) {
        decision = {
          ...decision,
          extractedFields: {
            ...decision.extractedFields,
            roomType: normalizeRoomType(property, decision.extractedFields.roomType)
          }
        };
      }

      const fingerprint = normalizeMessage(messages.map((message) => message.messageText).join(" "));
      const lastReplyAt = Date.parse(state.lastReplyAt || "");
      const repeatedMessage = fingerprint && fingerprint === state.lastMessageFingerprint
        && Number.isFinite(lastReplyAt)
        && this.now().getTime() - lastReplyAt <= this.ttlMs;
      if (repeatedMessage) {
        decision = {
          ...decision,
          route: "no_reply_silent_ignore",
          reason: "repeated_message",
          shouldIgnore: true,
          needsHuman: false
        };
      }

      const nextState = applyExtractedFields(state, decision.extractedFields);
      nextState.awaitingField = decision.missingFields && decision.missingFields[0] || null;
      nextState.lastIntent = decision.intent;
      nextState.updatedAt = this.now().toISOString();
      nextState.lastMessageFingerprint = fingerprint;

      const mergedInput = {
        ...last,
        messageText: messages.map((message) => message.messageText).join("\n"),
        eventIds: messages.map((message) => message.eventId),
        eventRecords: messages.map((message) => ({
          eventId: message.eventId,
          eventTimestamp: message.eventTimestamp || "",
          messageText: message.messageText
        })),
        route: {
          ...decision,
          extractedFields: accumulatedFromState(nextState)
        }
      };
      stage = "resolve_merged";
      const result = await this.resolveMerged(mergedInput);
      if (this.pending.get(key) === burst && burst.generation !== generation) {
        burst.waiters.splice(0, waiterCountAtStart).forEach(({ resolve }) => resolve({
          shouldReply: false,
          noReply: true,
          superseded: true,
          replyToken: ""
        }));
        burst.flushing = false;
        if (burst.timerId !== null) this.cancel(burst.timerId);
        const latestGeneration = burst.generation;
        burst.timerId = this.schedule(() => this.flush(key, latestGeneration), this.debounceMs);
        return;
      }

      this.pending.delete(key);
      messages.forEach((message) => {
        if (message.eventId) this.seenEventIds.set(this.eventKey(message), this.now().getTime());
      });
      const resultAllowsReply = Boolean(result && result.shouldReply !== false && !result.noReply);
      if (resultAllowsReply) nextState.lastReplyAt = this.now().toISOString();
      stage = "persist_conversation_state";
      this.persistence.setConversationState(last.customerId, last.channelId, last.lineUserId, nextState);

      if (this.externalReplyToken) {
        burst.waiters.forEach(({ resolve }, index) => resolve(index === burst.waiters.length - 1
          ? resultAllowsReply
            ? { ...result, shouldReply: true, noReply: false }
            : { ...result, shouldReply: false, noReply: true, replyToken: "" }
          : { shouldReply: false, noReply: true, superseded: true, replyToken: "" }));
        return;
      }

      const replyToken = String(last.replyToken || "");
      const usableReplyToken = resultAllowsReply && replyToken && !this.consumedReplyTokens.has(replyToken) ? replyToken : "";
      if (usableReplyToken) this.consumedReplyTokens.add(usableReplyToken);
      burst.waiters.forEach(({ resolve }, index) => resolve(index === burst.waiters.length - 1
        ? { ...result, shouldReply: Boolean(usableReplyToken), noReply: !usableReplyToken, replyToken: usableReplyToken }
        : { shouldReply: false, noReply: true, replyToken: "", merged: true }));
    } catch (error) {
      const last = burst.messages[burst.messages.length - 1] || {};
      if (this.onDiagnostic) {
        try {
          this.onDiagnostic({
            stage,
            exceptionName: safeDiagnosticText(error && error.name || "Error", 120),
            exceptionMessage: safeDiagnosticText(error && error.message || error, 500),
            stackTrace: safeDiagnosticText(error && error.stack || "", 4000),
            eventId: safeDiagnosticText(last.eventId, 200),
            propertyId: safeDiagnosticText(last.customerId, 200),
            channelId: safeDiagnosticText(last.channelId, 200)
          });
        } catch {
          // Diagnostics must never change message processing behavior.
        }
      }
      if (this.pending.get(key) === burst) this.pending.delete(key);
      burst.waiters.forEach(({ reject }) => reject(error));
    }
  }
}

module.exports = {
  ConversationCoordinator,
  STATE_FIELDS,
  emptyState,
  isSilentMessage,
  normalizeMessage,
  accumulatedFromState,
  applyExtractedFields,
  normalizeRoomType,
  roomMatchesType
};
