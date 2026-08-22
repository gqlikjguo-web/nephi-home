"use strict";

function normalizeMultilineText(value, limit) {
  if (typeof value !== "string") throw new TypeError("multiline_text_string_required");
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, limit);
}

module.exports = { normalizeMultilineText };
