"use strict";

// These are shared hospitality information needs, not property answers or
// message patterns.  The planner maps natural language to one of these IDs.
const DETAIL_INTENTS = new Set([
  "general", "time", "start_time", "end_time", "latest_arrival_policy",
  "early_arrival_policy", "late_departure_policy", "fee", "quantity",
  "eligibility", "reservation_required", "usage_restrictions",
  "room_or_bundle_restriction", "child_restrictions", "seasonal_restrictions",
  "weather_restrictions", "conditions", "missing_information"
]);

const DETAIL_LABELS = Object.freeze({
  time: "時間", start_time: "開始時間", end_time: "結束時間", latest_arrival_policy: "最晚抵達安排",
  early_arrival_policy: "提前入住安排", late_departure_policy: "延後退房安排", fee: "費用",
  quantity: "數量", eligibility: "適用資格", reservation_required: "預約規則",
  usage_restrictions: "使用限制", room_or_bundle_restriction: "單房或包棟限制",
  child_restrictions: "兒童使用限制", seasonal_restrictions: "季節限制",
  weather_restrictions: "天候限制", conditions: "補充條件", missing_information: "相關資訊"
});

// Compatibility mapping for the existing onboarding knowledge ID.  This is a
// canonical-contract bridge shared by every property, not a property branch.
const LEGACY_DETAIL_FACTS = Object.freeze({
  "check_in:early_arrival_policy": Object.freeze(["early_checkin"]),
  "check_out:late_departure_policy": Object.freeze(["late_checkout"])
});

function normalizeDetailIntent(value) { return DETAIL_INTENTS.has(value) ? value : "general"; }
function detailFactCandidates(canonicalTopic, detailIntent) {
  const topic = String(canonicalTopic || "").trim();
  const intent = normalizeDetailIntent(detailIntent);
  if (!topic || intent === "general") return [];
  return [...new Set([`${topic}__${intent}`, ...(LEGACY_DETAIL_FACTS[`${topic}:${intent}`] || [])])];
}
function includeBaseAnswer(detailIntent) { return normalizeDetailIntent(detailIntent) === "early_arrival_policy"; }
function detailLabel(detailIntent) { return DETAIL_LABELS[normalizeDetailIntent(detailIntent)] || "相關資訊"; }

module.exports = { DETAIL_INTENTS, normalizeDetailIntent, detailFactCandidates, includeBaseAnswer, detailLabel };
