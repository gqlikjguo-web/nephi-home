"use strict";

const crypto = require("node:crypto");

const CUSTOM_REPLY_LIMIT = 5;
const TOPICS = new Set([
  "booking_open",
  "booking_paused",
  "price_unannounced",
  "room",
  "bundle",
  "parking_notice",
  "facility_notice",
  "checkin_checkout",
  "lodging_rules",
  "temporary_operation"
]);
const SCOPES = new Set(["all", "room_only", "bundle", "room_type"]);

class CustomReplyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.fatal = true;
  }
}

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizedDatePair(startValue, endValue, code) {
  const start = text(startValue, 10);
  const end = text(endValue, 10);
  if (!start && !end) return { start: "", end: "" };
  if (!validDate(start) || !validDate(end) || start > end) {
    throw new CustomReplyError(400, code, "請提供正確且未倒置的日期區間");
  }
  return { start, end };
}

function localDateKey(date, timeZone = "Asia/Taipei") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((result, item) => ({ ...result, [item.type]: item.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function ruleState(rule, now, timeZone) {
  if (!rule.enabled) return "disabled";
  const today = localDateKey(now, timeZone);
  if (rule.effectiveStartDate && today < rule.effectiveStartDate) return "pending";
  if (rule.effectiveEndDate && today > rule.effectiveEndDate) return "expired";
  return "active";
}

function rangesOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  const aStart = firstStart || "0000-01-01";
  const aEnd = firstEnd || "9999-12-31";
  const bStart = secondStart || "0000-01-01";
  const bEnd = secondEnd || "9999-12-31";
  return aStart <= bEnd && bStart <= aEnd;
}

function normalizeRule(input, property, existing = null) {
  const name = text(input && input.name, 80);
  const topic = text(input && input.topic, 40);
  const scope = text(input && input.scope, 40);
  const approvedReply = text(input && input.approvedReply, 800);
  const roomTypeId = text(input && input.roomTypeId, 120);
  if (!name) throw new CustomReplyError(400, "CUSTOM_REPLY_NAME_REQUIRED", "規則名稱不得空白");
  if (!TOPICS.has(topic)) throw new CustomReplyError(400, "INVALID_CUSTOM_REPLY_TOPIC", "請選擇有效主題");
  if (!SCOPES.has(scope)) throw new CustomReplyError(400, "INVALID_CUSTOM_REPLY_SCOPE", "請選擇有效適用範圍");
  if (!approvedReply) throw new CustomReplyError(400, "CUSTOM_REPLY_TEXT_REQUIRED", "業者核准回覆內容不得空白");
  const stay = normalizedDatePair(input.stayStartDate, input.stayEndDate, "INVALID_CUSTOM_REPLY_DATE_RANGE");
  const effective = normalizedDatePair(input.effectiveStartDate, input.effectiveEndDate, "INVALID_CUSTOM_REPLY_EFFECTIVE_RANGE");
  if (!effective.start) throw new CustomReplyError(400, "CUSTOM_REPLY_EFFECTIVE_RANGE_REQUIRED", "請提供規則有效期間");
  if (scope === "room_type") {
    const room = (property.rooms || []).find((item) => item.id === roomTypeId && item.inventoryType !== "bundle");
    if (!room) throw new CustomReplyError(400, "CUSTOM_REPLY_ROOM_NOT_FOUND", "指定房型不存在");
  }
  return {
    ...(existing || {}),
    name,
    topic,
    scope,
    roomTypeId: scope === "room_type" ? roomTypeId : "",
    stayStartDate: stay.start,
    stayEndDate: stay.end,
    effectiveStartDate: effective.start,
    effectiveEndDate: effective.end,
    approvedReply,
    enabled: input.enabled !== false
  };
}

function decorate(rule, now, timeZone) {
  return { ...rule, state: ruleState(rule, now, timeZone) };
}

function createCustomReplyService({ provider, customerSettings, now = () => new Date(), timeZone = "Asia/Taipei" } = {}) {
  if (!provider) throw new Error("custom reply provider is required");
  function property(propertyId) {
    const item = customerSettings.getProperty(String(propertyId || "").trim());
    if (!item) throw new CustomReplyError(404, "PROPERTY_NOT_FOUND", "找不到旅宿");
    return item;
  }
  function listRaw(propertyId) { property(propertyId); return provider.list(String(propertyId)); }
  function assertNoOverlap(propertyId, candidate, exceptRuleId = "") {
    if (!candidate.enabled) return;
    const conflict = listRaw(propertyId).find((rule) => rule.ruleId !== exceptRuleId
      && rule.enabled
      && rule.topic === candidate.topic
      && rule.scope === candidate.scope
      && rangesOverlap(rule.stayStartDate, rule.stayEndDate, candidate.stayStartDate, candidate.stayEndDate)
      && rangesOverlap(rule.effectiveStartDate, rule.effectiveEndDate, candidate.effectiveStartDate, candidate.effectiveEndDate));
    if (conflict) throw new CustomReplyError(409, "CUSTOM_REPLY_ACTIVE_OVERLAP", "相同主題、範圍及重疊入住日期只能啟用一條規則");
  }
  return {
    list(propertyId) {
      const items = listRaw(propertyId).map((rule) => decorate(rule, now(), timeZone));
      return { used: items.length, limit: CUSTOM_REPLY_LIMIT, items };
    },
    create(propertyId, input) {
      const id = String(propertyId || "").trim();
      const current = listRaw(id);
      if (current.length >= CUSTOM_REPLY_LIMIT) throw new CustomReplyError(409, "CUSTOM_REPLY_LIMIT_REACHED", "每家旅宿最多 5 條自訂回覆");
      const timestamp = now().toISOString();
      const rule = {
        ...normalizeRule(input, property(id)),
        ruleId: `custom_reply_${crypto.randomUUID()}`,
        propertyId: id,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      assertNoOverlap(id, rule);
      return decorate(provider.create(rule), now(), timeZone);
    },
    update(propertyId, ruleId, input) {
      const id = String(propertyId || "").trim();
      const existing = listRaw(id).find((rule) => rule.ruleId === ruleId);
      if (!existing) throw new CustomReplyError(404, "CUSTOM_REPLY_NOT_FOUND", "找不到自訂回覆");
      const rule = { ...normalizeRule(input, property(id), existing), propertyId: id, ruleId, updatedAt: now().toISOString() };
      assertNoOverlap(id, rule, ruleId);
      return decorate(provider.update(id, ruleId, rule), now(), timeZone);
    },
    setEnabled(propertyId, ruleId, enabled) {
      const id = String(propertyId || "").trim();
      const existing = listRaw(id).find((rule) => rule.ruleId === ruleId);
      if (!existing) throw new CustomReplyError(404, "CUSTOM_REPLY_NOT_FOUND", "找不到自訂回覆");
      const rule = { ...existing, enabled: Boolean(enabled), updatedAt: now().toISOString() };
      assertNoOverlap(id, rule, ruleId);
      return decorate(provider.update(id, ruleId, rule), now(), timeZone);
    },
    remove(propertyId, ruleId) {
      property(propertyId);
      return provider.remove(String(propertyId), String(ruleId));
    },
    evaluate(propertyId, ruleId, request) {
      const id = String(propertyId || "").trim();
      property(id);
      const rule = listRaw(id).find((item) => item.ruleId === String(ruleId || ""));
      if (!rule) throw new CustomReplyError(404, "CUSTOM_REPLY_NOT_FOUND", "找不到這則自訂回覆");
      return evaluateCustomReplyMatch({ rules: [rule], propertyId: id, request, now: now(), timeZone });
    }
  };
}

const TOPIC_CAPABILITIES = Object.freeze({
  booking_open: new Set(["availability", "available_dates"]),
  booking_paused: new Set(["availability", "available_dates"]),
  price_unannounced: new Set(["price", "total_price"]),
  room: new Set(["room_options", "capacity", "availability"]),
  bundle: new Set(["bundle_availability"]),
  parking_notice: new Set(["parking"]),
  facility_notice: new Set(["amenity", "amenity_list", "bbq", "pool"]),
  checkin_checkout: new Set(["policy", "property_fact"]),
  lodging_rules: new Set(["policy"]),
  temporary_operation: new Set(["availability", "available_dates"])
});

function topicMatches(rule, request) {
  if (!TOPIC_CAPABILITIES[rule.topic] || !TOPIC_CAPABILITIES[rule.topic].has(request.capability)) return false;
  const entityId = request.canonicalEntity && request.canonicalEntity.canonicalId;
  if (rule.topic === "checkin_checkout" && !["check_in", "check_out"].includes(entityId)) return false;
  return true;
}

function scopeMatches(rule, request) {
  const entity = request.canonicalEntity || {};
  if (rule.scope === "all") return true;
  if (rule.scope === "bundle") return request.capability === "bundle_availability" || entity.category === "bundle";
  if (rule.scope === "room_only") return entity.category === "room";
  if (rule.scope === "room_type") return entity.category === "room" && entity.canonicalId === rule.roomTypeId;
  return false;
}

function stayMatches(rule, request) {
  if (!rule.stayStartDate && !rule.stayEndDate) return true;
  const temporal = request.temporalState || {};
  const checkIn = temporal.checkIn || temporal.searchRange && temporal.searchRange.from || "";
  return Boolean(checkIn && checkIn >= rule.stayStartDate && checkIn <= rule.stayEndDate);
}

function conflictsWithFormalFacts(rule, outcome) {
  if (rule.topic !== "price_unannounced") return false;
  if (!outcome || outcome.outcome !== "answered") return false;
  return (outcome.facts && outcome.facts.prices || []).some((price) =>
    Number.isFinite(price.total)
    || (price.daily || []).some((day) => Number.isFinite(day.price))
  );
}

function matchReason(code, message) { return { code, message }; }

function evaluateCustomReplyMatch({ rules = [], propertyId, request, now = new Date(), timeZone = "Asia/Taipei" } = {}) {
  const scoped = rules.filter((rule) => rule.propertyId === propertyId);
  if (!scoped.length) return { matched: false, rule: null, reply: "", reason: matchReason(rules.length ? "PROPERTY_MISMATCH" : "NO_RULES_FOR_PROPERTY", rules.length ? "規則屬於其他旅宿，不能跨旅宿使用" : "此旅宿沒有可測試的規則") };
  const active = scoped.filter((rule) => ruleState(rule, now, timeZone) === "active");
  if (!active.length) return { matched: false, rule: null, reply: "", reason: matchReason("NO_ACTIVE_RULES", "規則目前未啟用或不在生效期間") };
  const topic = active.filter((rule) => topicMatches(rule, request));
  if (!topic.length) return { matched: false, rule: null, reply: "", reason: matchReason("TOPIC_NOT_MATCHED", "客人詢問的主題不符合規則") };
  const scope = topic.filter((rule) => scopeMatches(rule, request));
  if (!scope.length) return { matched: false, rule: null, reply: "", reason: matchReason("SCOPE_NOT_MATCHED", "客人詢問的訂房類型不符合規則") };
  const stay = scope.filter((rule) => stayMatches(rule, request));
  if (!stay.length) return { matched: false, rule: null, reply: "", reason: matchReason("STAY_DATE_OUT_OF_RANGE", "客人詢問的入住日期不在規則適用範圍") };
  if (stay.length > 1) return { matched: false, rule: null, reply: "", reason: matchReason("AMBIGUOUS_RULES", "有多條規則同時命中，請調整適用範圍") };
  const rule = stay[0];
  return { matched: true, rule, reply: rule.approvedReply, reason: null };
}

function applyControlledReplyRules({ rules = [], property, canonicalItems = [], executionOutcomes = [], now = new Date(), timeZone = "Asia/Taipei" } = {}) {
  const requests = new Map(canonicalItems.map((item) => [item.canonicalRequest.taskId, item.canonicalRequest]));
  return executionOutcomes.map((outcome) => {
    const request = requests.get(outcome.taskId);
    if (!request) return outcome;
    const match = evaluateCustomReplyMatch({ rules, propertyId: property.propertyId, request, now, timeZone });
    if (!match.matched && match.reason.code !== "AMBIGUOUS_RULES") return outcome;
    if (!match.matched) {
      return {
        ...outcome,
        outcome: "unknown",
        reason: "custom_reply_ambiguous",
        review: true,
        facts: { subject: request.canonicalEntity && request.canonicalEntity.rawText || "這個問題", propertyId: property.propertyId }
      };
    }
    if (conflictsWithFormalFacts(match.rule, outcome)) {
      return {
        ...outcome,
        outcome: "unknown",
        reason: "custom_reply_formal_conflict",
        review: true,
        facts: {
          subject: request.canonicalEntity && request.canonicalEntity.rawText || "question",
          propertyId: property.propertyId
        }
      };
    }
    return {
      ...outcome,
      facts: {
        ...(outcome.facts || {}),
        customReply: match.reply,
        customReplyRuleId: match.rule.ruleId,
        customReplySource: "operator_approved_rule",
        propertyId: property.propertyId
      }
    };
  });
}

module.exports = {
  CUSTOM_REPLY_LIMIT,
  CUSTOM_REPLY_TOPICS: TOPICS,
  CUSTOM_REPLY_SCOPES: SCOPES,
  CustomReplyError,
  applyControlledReplyRules,
  createCustomReplyService,
  evaluateCustomReplyMatch,
  localDateKey,
  rangesOverlap,
  ruleState
};
