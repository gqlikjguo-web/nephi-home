"use strict";

class ConversationEngineV2Coordinator {
  constructor({ engine, debounceMs = 2000, externalReplyToken = false, schedule, cancel }) { this.engine = engine; this.debounceMs = debounceMs; this.externalReplyToken = externalReplyToken; this.schedule = schedule || setTimeout; this.cancel = cancel || clearTimeout; this.pending = new Map(); this.seenEvents = new Set(); }
  key(input) { return `${input.customerId}:${input.channelId}:${input.lineUserId}`; }
  enqueue(input) {
    const eventKey = `${input.customerId}:${input.eventId}`;
    if (this.seenEvents.has(eventKey)) return Promise.resolve({ shouldReply: false, noReply: true, duplicate: true, replyToken: "" });
    const key = this.key(input); let burst = this.pending.get(key);
    if (!burst) { burst = { messages: [], waiters: [], timer: null }; this.pending.set(key, burst); }
    if (burst.timer) this.cancel(burst.timer); burst.messages.push(input);
    const promise = new Promise((resolve, reject) => burst.waiters.push({ resolve, reject }));
    burst.timer = this.schedule(() => this.flush(key), this.debounceMs); return promise;
  }
  async flush(key) {
    const burst = this.pending.get(key); if (!burst) return; this.pending.delete(key);
    const last = burst.messages[burst.messages.length - 1];
    try {
      const result = await this.engine.process({ ...last, messageText: burst.messages.map((x) => x.messageText).join("\n"), currentMessages: burst.messages.map((x) => x.messageText), eventIds: burst.messages.map((x) => x.eventId) });
      burst.messages.forEach((x) => this.seenEvents.add(`${x.customerId}:${x.eventId}`));
      burst.waiters.forEach(({ resolve }, index) => { const trailing = index === burst.waiters.length - 1; resolve(trailing ? { ...result, replyToken: this.externalReplyToken ? "" : String(last.replyToken || ""), shouldReply: Boolean(result.shouldReply && (this.externalReplyToken || last.replyToken)), noReply: !result.shouldReply } : { shouldReply: false, noReply: true, merged: true, replyToken: "" }); });
    } catch (error) { burst.waiters.forEach(({ reject }) => reject(error)); }
  }
}

module.exports = { ConversationEngineV2Coordinator };
