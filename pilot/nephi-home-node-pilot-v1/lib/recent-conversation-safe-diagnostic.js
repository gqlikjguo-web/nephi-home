"use strict";

const crypto = require("node:crypto");

const HASH_LENGTH = 16;
const MAX_ITEMS = 50;

function shortSha256(value) {
  return crypto.createHash("sha256")
    .update(String(value == null ? "" : value), "utf8")
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

function recentConversationSafeSummary(value) {
  const items = (Array.isArray(value) ? value : []).slice(-MAX_ITEMS).map((item) => ({
    createdAt: String(item && item.createdAt || "").slice(0, 40),
    guestMessageHash: shortSha256(item && item.guestMessage),
    replyTextHash: shortSha256(item && item.replyText)
  }));
  return { count: items.length, items };
}

module.exports = { recentConversationSafeSummary };
