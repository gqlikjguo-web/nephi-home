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
function relativeOffsetDays(rawText) {
  const raw = String(rawText || "").normalize("NFKC").replace(/\s+/g, "");
  if (!raw) return null;
  if (raw.includes("大後天")) return 3;
  if (raw.includes("後天")) return 2;
  if (raw.includes("明")) return 1;
  return 0;
}
function hasAbsoluteDateSyntax(rawText) {
  const raw = String(rawText || "").normalize("NFKC").replace(/\s+/g, "");
  return /^(?:\d{4}\s*(?:年|[-/])\s*)?\d{1,2}\s*(?:月|[-/])\s*\d{1,2}\s*(?:日|號)?$/u.test(raw);
}
function canonicalizeTemporalInput(stay = {}) {
  const expression = stay.dateExpression || {};
  const rawText = String(expression.rawText || "").normalize("NFKC").replace(/\s+/g, "");
  const kind = String(expression.kind || "none");
  const hasCandidate = Boolean(stay.checkInCandidate || stay.checkOutCandidate);
  const intent = Boolean(rawText || kind !== "none" || hasCandidate) ? "present" : "absent";
  if (intent === "absent") return { intent, status: "absent", valueType: "none", value: null, reasonCode: "date_intent_absent" };
  if (kind === "relative") {
    const offset = expression.anchor === "message_time" ? relativeOffsetDays(rawText) : null;
    return Number.isInteger(offset)
      ? { intent, status: "candidate", valueType: "relative_offset", value: offset, reasonCode: "relative_offset_candidate" }
      : { intent, status: "ambiguous", valueType: "relative_offset", value: null, reasonCode: "relative_offset_missing" };
  }
  if (kind === "absolute") {
    return hasAbsoluteDateSyntax(rawText)
      ? { intent, status: "candidate", valueType: "absolute_expression", value: rawText, reasonCode: "absolute_expression_candidate" }
      : { intent, status: "ambiguous", valueType: "absolute_expression", value: null, reasonCode: "absolute_candidate_missing" };
  }
  if (kind === "none") {
    return { intent, status: "ambiguous", valueType: "none", value: null, reasonCode: hasCandidate ? "candidate_without_expression" : "date_kind_missing" };
  }
  return { intent, status: "candidate", valueType: `${kind}_expression`, value: rawText, reasonCode: `${kind}_expression_candidate` };
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

function resolveTemporalExpression(expression = {}, context = {}) {
  const timezone = context.timezone || "Asia/Taipei";
  const timestamp = Number(context.eventTimestamp) || Date.parse(context.eventTimestamp || "") || Date.now();
  const base = partsAt(timestamp, timezone).key;
  const raw = String(expression.rawText || "").normalize("NFKC").replace(/\s+/g, "");
  const canonicalTemporal = context.canonicalTemporal || canonicalizeTemporalInput({
    dateExpression: expression,
    checkInCandidate: context.checkInCandidate,
    checkOutCandidate: context.checkOutCandidate
  });
  if (canonicalTemporal.status === "ambiguous" || canonicalTemporal.status === "invalid") {
    return {
      checkIn: null,
      checkOut: null,
      nights: Number.isInteger(context.nightsCandidate) ? context.nightsCandidate : null,
      searchRange: null,
      timezone,
      resolutionStatus: canonicalTemporal.status,
      ambiguity: canonicalTemporal.reasonCode,
      originalExpression: raw,
      dateIntentStatus: "unresolved",
      canonicalTemporal
    };
  }
  const deterministicAbsolute = absoluteDateFromRaw(raw, base);
  let checkIn = deterministicAbsolute || (expression.kind === "range" && valid(context.checkInCandidate) ? context.checkInCandidate : null);
  let searchRange = null;
  const absolute = raw.match(/^(?:(\d{4})[年\/-])?(\d{1,2})[月\/-](\d{1,2})日?$/u);
  if (canonicalTemporal.valueType === "relative_offset" && Number.isInteger(canonicalTemporal.value)) {
    checkIn = addDays(base, canonicalTemporal.value);
  } else if (!valid(checkIn) && absolute) {
    let year = Number(absolute[1] || base.slice(0, 4));
    const candidate = `${year}-${String(absolute[2]).padStart(2, "0")}-${String(absolute[3]).padStart(2, "0")}`;
    if (!absolute[1] && valid(candidate) && candidate < base) year += 1;
    checkIn = `${year}-${String(absolute[2]).padStart(2, "0")}-${String(absolute[3]).padStart(2, "0")}`;
  } else if (expression.kind === "relative") {
    const offset = relativeOffsetDays(raw);
    checkIn = Number.isInteger(offset) ? addDays(base, offset) : null;
  } else if (expression.kind === "weekday") {
    const target = weekdayNumber(raw);
    if (target === null) return { timezone, resolutionStatus: "ambiguous", ambiguity: "weekday_missing", originalExpression: raw, dateIntentStatus: "unresolved", canonicalTemporal };
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
  if (checkIn && !valid(checkIn)) return { timezone, resolutionStatus: "invalid", ambiguity: "invalid_date", originalExpression: raw, dateIntentStatus: "unresolved", canonicalTemporal };
  if (checkIn && checkIn < base) return { timezone, resolutionStatus: "invalid", ambiguity: "past_date", originalExpression: raw, dateIntentStatus: "unresolved", canonicalTemporal };
  const nights = Number.isInteger(context.nightsCandidate) ? context.nightsCandidate : Number.isInteger(context.defaultNights) ? context.defaultNights : null;
  const checkOut = valid(context.checkOutCandidate) ? context.checkOutCandidate : checkIn && nights ? addDays(checkIn, nights) : null;
  if (checkIn && checkOut && checkOut <= checkIn) return { timezone, resolutionStatus: "invalid", ambiguity: "checkout_not_after_checkin", originalExpression: raw, dateIntentStatus: "unresolved", canonicalTemporal };
  const resolutionStatus = checkIn || searchRange ? "resolved" : "ambiguous";
  return {
    checkIn,
    checkOut,
    nights,
    searchRange,
    timezone,
    resolutionStatus,
    ambiguity: resolutionStatus === "resolved" ? null : "date_missing",
    originalExpression: raw,
    dateIntentStatus: resolutionStatus === "resolved" ? "resolved" : canonicalTemporal.intent === "absent" ? "absent" : "unresolved",
    canonicalTemporal
  };
}

module.exports = { resolveTemporalExpression, inferExplicitTemporalExpression, canonicalizeTemporalInput, relativeOffsetDays, addDays, valid };
