"use strict";

function cleanString(value) { return String(value == null ? "" : value).trim(); }

function normalizeRoomHighlights(value) {
  const seen = new Set(), result = [];
  for (const item of Array.isArray(value) ? value : []) {
    const highlight = cleanString(item);
    if (!highlight || seen.has(highlight)) continue;
    seen.add(highlight); result.push(highlight);
  }
  return result;
}

function normalizeRoomRecord(room = {}) {
  const displayName = cleanString(room.displayName || room.name);
  return { ...room, roomCode: cleanString(room.roomCode), displayName, name: displayName, highlights: normalizeRoomHighlights(room.highlights) };
}

function characterCount(value) { return Array.from(cleanString(value)).length; }

module.exports = { normalizeRoomHighlights, normalizeRoomRecord, characterCount };

