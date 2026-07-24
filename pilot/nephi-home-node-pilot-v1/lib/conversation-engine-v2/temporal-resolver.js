"use strict";

function partsAt(timestamp, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(timestamp)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return { key: `${parts.year}-${parts.month}-${parts.day}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
}
function valid(key) { if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return false; const date = new Date(`${key}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === key; }
function addDays(key, days) { const date = new Date(`${key}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function inferExplicitTemporalExpression(text) {
  const match = String(text || "").normalize("NFKC").match(/(?:\b\d{4}\s*[/-]\s*)?\b\d{1,2}\s*[/-]\s*\d{1,2}\b/);
  return match ? { rawText: match[0].replace(/\s+/g, ""), kind: "absolute", anchor: "message_time" } : null;
}
function absoluteDateFromRaw(raw, base) {
  const explicitYear = raw.match(/^(\d{4})\s*(?:年|[-/])\s*(\d{1,2})\s*(?:月|[-/])\s*(\d{1,2})\s*(?:日|號)?$/u);
  const yearless = explicitYear ? null : raw.match(/^(\d{1,2})\s*(?:月|[-/])\s*(\d{1,2})\s*(?:日|號)?$/u);
  const match = explicitYear || yearless;
  if (!match) return null;
  let year = explicitYear ? Number(match[1]) : Number(base.slice(0, 4));
  const month = Number(match[explicitYear ? 2 : 1]);
  const day = Number(match[explicitYear ? 3 : 2]);
  let candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!explicitYear && valid(candidate) && candidate < base) {
    const nextYearCandidate = `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const daysUntilNextYearCandidate = Math.round((Date.parse(`${nextYearCandidate}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86400000);
    // A yearless date just after a year boundary (for example, 1/5 when it
    // is 12/20) is naturally an upcoming stay. A date from yesterday is not:
    // retain it so the caller can safely request a future date rather than
    // silently converting it into a stay almost a year away.
    if (daysUntilNextYearCandidate <= 183) candidate = nextYearCandidate;
  }
  return candidate;
}
function weekdayNumber(text) { const digits = { "日": 0, "天": 0, "一": 1, "1": 1, "二": 2, "2": 2, "三": 3, "3": 3, "四": 4, "4": 4, "五": 5, "5": 5, "六": 6, "6": 6 }; const match = String(text).match(/(?:週|星期|禮拜)\s*([日天一二三四五六1-6])/u); return match ? digits[match[1]] : null; }

function resolveLegacyTemporalExpression(expression = {}, context = {}) {
  const timezone = context.timezone || "Asia/Taipei";
  const timestamp = Number(context.eventTimestamp) || Date.parse(context.eventTimestamp || "") || Date.now();
  const base = partsAt(timestamp, timezone).key;
  const raw = String(expression.rawText || "").normalize("NFKC").replace(/\s+/g, "");
  const deterministicAbsolute = absoluteDateFromRaw(raw, base);
  let checkIn = deterministicAbsolute || context.checkInCandidate || null;
  let searchRange = null;
  const absolute = raw.match(/^(?:(\d{4})[年\/-])?(\d{1,2})[月\/-](\d{1,2})日?$/u);
  if (!valid(checkIn) && absolute) {
    let year = Number(absolute[1] || base.slice(0, 4));
    const candidate = `${year}-${String(absolute[2]).padStart(2, "0")}-${String(absolute[3]).padStart(2, "0")}`;
    if (!absolute[1] && valid(candidate) && candidate < base) year += 1;
    checkIn = `${year}-${String(absolute[2]).padStart(2, "0")}-${String(absolute[3]).padStart(2, "0")}`;
  } else if (expression.kind === "relative") {
    const offset = raw.includes("大後天") ? 3 : raw.includes("後天") ? 2 : raw.includes("明") ? 1 : 0;
    checkIn = addDays(base, offset);
  } else if (expression.kind === "weekday") {
    const target = weekdayNumber(raw);
    if (target === null) return { timezone, resolutionStatus: "ambiguous", ambiguity: "weekday_missing", originalExpression: raw };
    const baseWeekday = partsAt(timestamp, timezone).weekday;
    const weeks = raw.includes("下下") ? 2 : raw.includes("下") ? 1 : 0;
    let delta;
    if (weeks) {
      const daysUntilNextMonday = 7 - ((baseWeekday + 6) % 7);
      const targetOffsetFromMonday = (target + 6) % 7;
      delta = daysUntilNextMonday + targetOffsetFromMonday + (weeks - 1) * 7;
    } else {
      delta = (target - baseWeekday + 7) % 7;
    }
    checkIn = addDays(base, delta);
  } else if (expression.kind === "weekend") {
    const baseWeekday = partsAt(timestamp, timezone).weekday;
    let delta = (6 - baseWeekday + 7) % 7;
    if (raw.includes("下下")) delta += 14; else if (raw.includes("下")) delta += 7;
    const from = addDays(base, delta), to = addDays(from, 2);
    searchRange = { from, to };
  } else if (expression.kind === "absolute") {
    if (deterministicAbsolute) checkIn = deterministicAbsolute;
    else if (valid(context.checkInCandidate)) checkIn = context.checkInCandidate;
    else {
      const match = raw.match(/(?:(\d{4})[年/-])?(\d{1,2})[月/-](\d{1,2})日?/u);
      if (match) {
        let year = Number(match[1] || base.slice(0, 4));
        const candidate = `${year}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
        if (!match[1] && valid(candidate) && candidate < base) year += 1;
        checkIn = `${year}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
      }
    }
  } else if (expression.kind === "contextual") {
    const anchor = expression.anchor === "previous_check_out" ? context.previousCheckOut : context.previousCheckIn;
    if (raw.includes("隔天") || raw.includes("明天")) checkIn = valid(anchor) ? addDays(anchor, 1) : null;
    else checkIn = anchor || null;
  }
  if (checkIn && !valid(checkIn)) return { timezone, resolutionStatus: "invalid", ambiguity: "invalid_date", originalExpression: raw };
  if (checkIn && checkIn < base) return { timezone, resolutionStatus: "invalid", ambiguity: "past_date", originalExpression: raw };
  const nights = Number.isInteger(context.nightsCandidate) ? context.nightsCandidate : Number.isInteger(context.defaultNights) ? context.defaultNights : null;
  const checkOut = valid(context.checkOutCandidate) ? context.checkOutCandidate : checkIn && nights ? addDays(checkIn, nights) : null;
  if (checkIn && checkOut && checkOut <= checkIn) return { timezone, resolutionStatus: "invalid", ambiguity: "checkout_not_after_checkin", originalExpression: raw };
  return { checkIn, checkOut, nights, searchRange, timezone, resolutionStatus: checkIn || searchRange ? "resolved" : "ambiguous", ambiguity: checkIn || searchRange ? null : "date_missing", originalExpression: raw };
}

const TEMPORAL_RESULT_STATUSES = new Set(["absent", "resolved", "unresolved", "invalid", "conflicting"]);
const TEMPORAL_PROVENANCE = new Set(["explicit", "context", "defaulted", "derived"]);
const CONTEXTUAL_TEMPORAL_RULE_REF = "temporal:contextual_expression";

function emptyFieldMetadata() {
  return {
    provenance: { checkIn: null, checkOut: null, nights: null, searchRange: null },
    ruleRefs: { checkIn: null, checkOut: null, nights: null, searchRange: null },
    derivedFromFieldRefs: { checkIn: [], checkOut: [], nights: [], searchRange: [] }
  };
}

function withFieldMetadata(result, metadata = {}) {
  const fields = emptyFieldMetadata();
  const provenance = { ...fields.provenance, ...(metadata.provenance || {}) };
  const ruleRefs = { ...fields.ruleRefs, ...(metadata.ruleRefs || {}) };
  const derivedFromFieldRefs = { ...fields.derivedFromFieldRefs, ...(metadata.derivedFromFieldRefs || {}) };
  return {
    ...result,
    resolutionStatus: TEMPORAL_RESULT_STATUSES.has(result.resolutionStatus) ? result.resolutionStatus : "unresolved",
    provenance,
    ruleRefs,
    derivedFromFieldRefs,
    fields: {
      checkIn: { value: result.checkIn || null, provenance: provenance.checkIn, ruleRef: ruleRefs.checkIn, derivedFromFieldRefs: derivedFromFieldRefs.checkIn },
      checkOut: { value: result.checkOut || null, provenance: provenance.checkOut, ruleRef: ruleRefs.checkOut, derivedFromFieldRefs: derivedFromFieldRefs.checkOut },
      nights: { value: Number.isInteger(result.nights) ? result.nights : null, provenance: provenance.nights, ruleRef: ruleRefs.nights, derivedFromFieldRefs: derivedFromFieldRefs.nights },
      searchRange: { value: result.searchRange || null, provenance: provenance.searchRange, ruleRef: ruleRefs.searchRange, derivedFromFieldRefs: derivedFromFieldRefs.searchRange }
    }
  };
}

function hasDateExpression(expression = {}) {
  return Boolean(String(expression.rawText || "").trim()) && expression.kind !== "none";
}

function contextTemporalResult(expression, context, timezone) {
  const approved = context.approvedContext || {};
  const checkIn = valid(approved.checkIn) ? approved.checkIn : null;
  const checkOut = valid(approved.checkOut) ? approved.checkOut : null;
  const nights = Number.isInteger(approved.nights) ? approved.nights : null;
  if (!checkIn && !checkOut) return null;
  return withFieldMetadata({ checkIn, checkOut, nights, searchRange: null, timezone, resolutionStatus: "resolved", ambiguity: null, originalExpression: "" }, {
    provenance: { checkIn: checkIn ? "context" : null, checkOut: checkOut ? "context" : null, nights: nights ? "context" : null }
  });
}

function resolveTemporalExpression(expression = {}, context = {}) {
  const timezone = context.timezone || "Asia/Taipei";
  const hasExpression = hasDateExpression(expression);
  const approved = context.approvedContext || null;
  if (!hasExpression && context.allowContextReuse === true && approved) {
    const reused = contextTemporalResult(expression, context, timezone);
    if (reused) return reused;
  }

  const legacyContext = {
    ...context,
    previousCheckIn: approved && approved.checkIn || context.previousCheckIn,
    previousCheckOut: approved && approved.checkOut || context.previousCheckOut
  };
  const result = resolveLegacyTemporalExpression(expression, legacyContext);
  const status = result.resolutionStatus === "ambiguous"
    ? hasExpression ? "unresolved" : "absent"
    : result.resolutionStatus;
  const invalidCheckOut = result.ambiguity === "checkout_not_after_checkin";
  const finalStatus = invalidCheckOut ? "conflicting" : status;
  const rawIsContextual = expression.kind === "contextual";
  const explicitCheckIn = result.checkIn && !rawIsContextual ? "explicit" : result.checkIn && rawIsContextual ? "derived" : null;
  const explicitNights = Number.isInteger(context.nightsCandidate);
  const defaultedNights = !explicitNights && Number.isInteger(context.defaultNights);
  const explicitCheckOut = valid(context.checkOutCandidate);
  const ruleRef = context.defaultNightsRuleRef || null;
  const provenance = {
    checkIn: explicitCheckIn,
    checkOut: explicitCheckOut ? "explicit" : result.checkOut && result.checkIn && result.nights ? "derived" : null,
    nights: explicitNights ? "explicit" : defaultedNights ? "defaulted" : null
  };
  const ruleRefs = {
    checkIn: rawIsContextual && result.checkIn ? CONTEXTUAL_TEMPORAL_RULE_REF : null,
    checkOut: !explicitCheckOut && result.checkOut && result.checkIn && result.nights ? (defaultedNights ? ruleRef : "temporal:checkout_from_checkin_and_nights") : null,
    nights: defaultedNights ? ruleRef : null
  };
  const derivedFromFieldRefs = {
    checkIn: rawIsContextual && result.checkIn ? ["approvedTemporalContext"] : [],
    checkOut: !explicitCheckOut && result.checkOut && result.checkIn && result.nights ? ["stay.checkIn", "stay.nights"] : [],
    nights: []
  };
  return withFieldMetadata({ ...result, resolutionStatus: finalStatus }, { provenance, ruleRefs, derivedFromFieldRefs });
}

module.exports = { resolveTemporalExpression, inferExplicitTemporalExpression, addDays, valid, TEMPORAL_RESULT_STATUSES, TEMPORAL_PROVENANCE, CONTEXTUAL_TEMPORAL_RULE_REF };
