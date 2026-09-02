"use strict";

const crypto = require("node:crypto");

const ROOM_TYPES = Object.freeze(["單人房", "雙人房", "三人房", "四人房", "五人房", "六人房", "八人房", "家庭房", "親子房", "和室", "通鋪", "套房", "Villa", "其他"]);
const PRESET_AMENITIES = Object.freeze([
  ["singing", "KTV／歡唱設備", ["唱歌", "卡拉 OK", "卡拉OK", "KTV"]],
  ["electric_mahjong", "電動麻將桌", ["電動麻將"]], ["mahjong", "一般麻將", ["麻將"]],
  ["board_games", "桌遊", []], ["game_console", "Switch／遊戲主機", ["Switch", "遊戲主機"]],
  ["projector", "投影機／大螢幕", ["投影機", "大螢幕"]], ["billiards", "撞球桌", ["撞球"]],
  ["darts", "飛鏢", []], ["table_football", "桌上足球", []],
  ["bbq", "烤肉區／烤肉設備", ["烤肉", "烤肉區", "烤肉設備"]], ["splash_pool", "戲水池", []],
  ["swimming_pool", "游泳池", []], ["children_play_area", "兒童遊戲區", []], ["slide", "溜滑梯", []],
  ["sandpit", "沙坑", []], ["outdoor_yard", "戶外庭院", ["庭院"]], ["shared_living_room", "公共客廳", ["客廳"]],
  ["kitchen", "廚房", []], ["hot_pot_equipment", "火鍋設備", ["火鍋"]]
].map(([key, displayName, aliases], position) => Object.freeze({ key, displayName, aliases: Object.freeze(aliases), source: "preset", position })));
const presetByKey = new Map(PRESET_AMENITIES.map((item) => [item.key, item]));
function count(value) { return [...String(value || "")].length; }
function clean(value, max) { const result = String(value || "").normalize("NFC").replace(/\s+/g, " ").trim(); if (count(result) > max) throw new Error(`文字不得超過 ${max} 字`); return result; }
function customKey(name, position) { return `custom_${crypto.createHash("sha256").update(`${name}\n${position}`).digest("hex").slice(0, 12)}`; }
function normalizeEntertainmentAmenities(input) {
  const customNames = new Set(), custom = [], supplied = new Map((Array.isArray(input) ? input : []).map((item) => [String(item && item.key || ""), item || {}]));
  const presets = PRESET_AMENITIES.map((preset) => {
    const item = supplied.get(preset.key) || {};
    const provided = item.provided === true ? true : item.provided === false && item.statusSource === "operator" ? false : null;
    return { key: preset.key, displayName: preset.displayName, provided, statusSource: provided === null ? null : "operator", note: provided === true ? clean(item.note, 100) : "", source: "preset", position: preset.position };
  });
  for (const item of Array.isArray(input) ? input : []) {
    if (!item || item.source !== "custom" || item.provided !== true) continue;
    const displayName = clean(item.displayName, 20); if (!displayName) continue;
    const dedupe = displayName.toLocaleLowerCase("zh-Hant-TW"); if (customNames.has(dedupe)) continue; customNames.add(dedupe);
    const position = PRESET_AMENITIES.length + custom.length;
    const requestedKey = String(item.key || "").trim();
    custom.push({ key: /^custom_[a-zA-Z0-9_-]{1,64}$/.test(requestedKey) ? requestedKey : customKey(displayName, position), displayName, provided: true, note: clean(item.note, 100), source: "custom", position });
  }
  return [...presets, ...custom];
}
function providedAmenities(input) { return normalizeEntertainmentAmenities(input).filter((item) => item.provided === true); }

module.exports = { ROOM_TYPES, PRESET_AMENITIES, normalizeEntertainmentAmenities, providedAmenities, presetByKey };
