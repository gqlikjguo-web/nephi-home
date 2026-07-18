"use strict";

function partsAt(timestamp, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(timestamp)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return { key: `${parts.year}-${parts.month}-${parts.day}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
}
function valid(key) { if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return false; const date = new Date(`${key}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === key; }
function addDays(key, days) { const date = new Date(`${key}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
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
    year += 1;
    candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return candidate;
}
function weekdayNumber(text) { const digits = { "日": 0, "天": 0, "一": 1, "1": 1, "二": 2, "2": 2, "三": 3, "3": 3, "四": 4, "4": 4, "五": 5, "5": 5, "六": 6, "6": 6 }; const match = String(text).match(/(?:週|星期|禮拜)\s*([日天一二三四五六1-6])/u); return match ? digits[match[1]] : null; }

function resolveTemporalExpression(expression = {}, context = {}) {
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

module.exports = { resolveTemporalExpression, addDays, valid };
