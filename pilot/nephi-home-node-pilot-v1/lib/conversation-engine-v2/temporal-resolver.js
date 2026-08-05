"use strict";

const TEMPORAL_RESULT_STATUSES = new Set(["absent", "resolved", "unresolved"]);
const TEMPORAL_PROVENANCE = new Set(["explicit", "context", "defaulted", "derived"]);
const TEMPORAL_VALUE_STATUSES = new Set(["missing", "uncertain", "confirmed"]);
const CONTEXTUAL_TEMPORAL_RULE_REF = "temporal:contextual_expression";
const CANONICAL_TEMPORAL_RULE_REF = "temporal:canonical_grammar";

const RELATIVE_DAY_OFFSETS = new Map([
  ["今天", 0],
  ["今晚", 0],
  ["明天", 1],
  ["後天", 2],
  ["大後天", 3]
]);
const CHINESE_DIGITS = new Map([
  ["零", 0], ["〇", 0],
  ["一", 1], ["二", 2], ["兩", 2], ["三", 3], ["四", 4],
  ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9]
]);
const WEEKDAY_NUMBERS = new Map([
  ["日", 0], ["天", 0],
  ["一", 1], ["1", 1], ["二", 2], ["2", 2], ["三", 3], ["3", 3],
  ["四", 4], ["4", 4], ["五", 5], ["5", 5], ["六", 6], ["6", 6]
]);

function normalizeText(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "");
}

function partsAt(timestamp, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(new Date(timestamp)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday)
  };
}

function valid(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return false;
  const date = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === key;
}

function addDays(key, days) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inferExplicitTemporalExpression(text) {
  const match = String(text || "").normalize("NFKC").match(/(?:\b\d{4}\s*[/-]\s*)?\b\d{1,2}\s*[/-]\s*\d{1,2}\b/);
  return match ? { rawText: match[0].replace(/\s+/g, ""), kind: "absolute", anchor: "message_time" } : null;
}

function chineseInteger(value) {
  const text = normalizeText(value);
  if (/^\d+$/.test(text)) return Number(text);
  if (CHINESE_DIGITS.has(text)) return CHINESE_DIGITS.get(text);
  if (text === "十") return 10;
  const tens = text.match(/^([一二兩三四五六七八九])?十([一二兩三四五六七八九])?$/u);
  if (!tens) return null;
  return (tens[1] ? CHINESE_DIGITS.get(tens[1]) : 1) * 10 + (tens[2] ? CHINESE_DIGITS.get(tens[2]) : 0);
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
    if (daysUntilNextYearCandidate <= 183) candidate = nextYearCandidate;
  }
  return valid(candidate) ? candidate : null;
}

function relativeDay(raw, base) {
  if (RELATIVE_DAY_OFFSETS.has(raw)) return { checkIn: addDays(base, RELATIVE_DAY_OFFSETS.get(raw)), expressionType: "relative_day" };
  const match = raw.match(/^([一二兩三四五六七八九十\d]+)(天|週|星期|禮拜)後$/u);
  if (!match) return null;
  const count = chineseInteger(match[1]);
  if (!Number.isInteger(count) || count < 1 || count > 60) return null;
  const multiplier = match[2] === "天" ? 1 : 7;
  return { checkIn: addDays(base, count * multiplier), expressionType: "relative_day" };
}

function weekdayParts(raw) {
  const match = raw.match(/^(這|本|下下|下個|下)?(?:個)?(?:週|星期|禮拜)([日天一二三四五六1-6])$/u);
  if (!match) return null;
  const prefix = match[1] || "";
  const weekOffset = prefix === "下下" ? 2 : ["下", "下個"].includes(prefix) ? 1 : 0;
  return { targetWeekday: WEEKDAY_NUMBERS.get(match[2]), weekOffset, explicitlyCurrentWeek: ["這", "本"].includes(prefix) };
}

function relativeWeekday(raw, base, baseWeekday) {
  const parts = weekdayParts(raw);
  if (!parts) return null;
  const daysSinceMonday = (baseWeekday + 6) % 7;
  const targetOffsetFromMonday = (parts.targetWeekday + 6) % 7;
  let delta = parts.weekOffset * 7 - daysSinceMonday + targetOffsetFromMonday;
  if (!parts.explicitlyCurrentWeek && parts.weekOffset === 0 && delta < 0) delta += 7;
  if (delta < 0) return null;
  return { checkIn: addDays(base, delta), expressionType: "relative_weekday" };
}

function weekend(raw, base, baseWeekday) {
  const match = raw.match(/^(這|本|下下|下個|下)?(?:個)?週末$/u);
  if (!match) return null;
  const prefix = match[1] || "";
  const weekOffset = prefix === "下下" ? 2 : ["下", "下個"].includes(prefix) ? 1 : 0;
  const daysSinceMonday = (baseWeekday + 6) % 7;
  let delta = weekOffset * 7 - daysSinceMonday + 5;
  if (!["這", "本"].includes(prefix) && weekOffset === 0 && delta < 0) delta += 7;
  if (delta < 0) return null;
  const checkIn = addDays(base, delta);
  return { checkIn, checkOut: addDays(checkIn, 1), nights: 1, expressionType: "weekend" };
}

function explicitNights(raw) {
  const match = raw.match(/(?:(?:入住|住)([一二兩三四五六七八九十\d]+)[晚天]|([一二兩三四五六七八九十\d]+)晚)/u);
  if (!match) return null;
  const nights = chineseInteger(match[1] || match[2]);
  return Number.isInteger(nights) && nights >= 1 && nights <= 60 ? nights : null;
}

function expressionBeforeNights(raw) {
  return raw.replace(/(?:(?:入住|住)[一二兩三四五六七八九十\d]+[晚天]|[一二兩三四五六七八九十\d]+晚).*$/u, "");
}

function parseSingleExpression(raw, base, baseWeekday) {
  const relative = relativeDay(raw, base);
  if (relative) return relative;
  const weekday = relativeWeekday(raw, base, baseWeekday);
  if (weekday) return weekday;
  const weekendResult = weekend(raw, base, baseWeekday);
  if (weekendResult) return weekendResult;
  const absolute = absoluteDateFromRaw(raw, base);
  return absolute ? { checkIn: absolute, expressionType: "absolute_date" } : null;
}

function daysBetween(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function compactRangeParts(raw) {
  const slash = raw.match(/^(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})(?:日|號)?(?:-|\.|、|~|～|到|至)(?:(\d{1,2})[/-])?(\d{1,2})(?:日|號)?$/u);
  if (slash) {
    return {
      year: slash[1] ? Number(slash[1]) : null,
      startMonth: Number(slash[2]),
      startDay: Number(slash[3]),
      endMonth: slash[4] ? Number(slash[4]) : null,
      endDay: Number(slash[5])
    };
  }
  const chinese = raw.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|號)?(?:-|~|～|到|至)(?:(\d{1,2})月)?(\d{1,2})(?:日|號)?$/u);
  if (!chinese) return null;
  return {
    year: chinese[1] ? Number(chinese[1]) : null,
    startMonth: Number(chinese[2]),
    startDay: Number(chinese[3]),
    endMonth: chinese[4] ? Number(chinese[4]) : null,
    endDay: Number(chinese[5])
  };
}

function compactDateRange(raw, base) {
  const parts = compactRangeParts(raw);
  if (!parts) return null;
  const startRaw = parts.year
    ? `${parts.year}/${parts.startMonth}/${parts.startDay}`
    : `${parts.startMonth}/${parts.startDay}`;
  const checkIn = absoluteDateFromRaw(startRaw, base);
  if (!checkIn) return { unresolvedReason: "temporal_range_invalid" };

  const startYear = Number(checkIn.slice(0, 4));
  const startMonth = Number(checkIn.slice(5, 7));
  const startDay = Number(checkIn.slice(8, 10));
  let endYear = startYear;
  let endMonth = parts.endMonth || startMonth;
  if (parts.endMonth && endMonth < startMonth) endYear += 1;
  if (!parts.endMonth && parts.endDay <= startDay) {
    endMonth += 1;
    if (endMonth > 12) {
      endMonth = 1;
      endYear += 1;
    }
  }
  if (parts.endMonth && endMonth === startMonth && parts.endDay <= startDay) {
    return { unresolvedReason: "temporal_range_invalid" };
  }
  const checkOut = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(parts.endDay).padStart(2, "0")}`;
  const nights = valid(checkOut) ? daysBetween(checkIn, checkOut) : 0;
  if (!valid(checkOut) || nights < 1 || nights > 60) {
    return { unresolvedReason: "temporal_range_invalid" };
  }
  return { checkIn, checkOut, nights, expressionType: "date_range" };
}

function parseRange(raw, base, baseWeekday) {
  const duration = explicitNights(raw);
  const inclusiveDayRange = duration ? null : raw.match(/^((?:(?:\d{4})[/-])?\d{1,2}[/-]\d{1,2}(?:日|號)?(?:-|\.|、|~|～|到|至)(?:(?:\d{1,2})[/-])?\d{1,2}(?:日|號)?)[一二兩三四五六七八九十\d]+天$/u);
  const temporalExpression = duration
    ? expressionBeforeNights(raw)
    : inclusiveDayRange ? inclusiveDayRange[1] : raw;
  const compact = compactDateRange(temporalExpression, base);
  if (compact) return duration && compact.nights !== duration
    ? { unresolvedReason: "temporal_range_invalid" }
    : compact;
  const labeled = temporalExpression.match(/^入住日期[:：]?(.+?)[,，]?退房日期[:：]?(.+)$/u);
  if (labeled) {
    const left = parseSingleExpression(normalizeText(labeled[1]), base, baseWeekday);
    const right = parseSingleExpression(normalizeText(labeled[2]), base, baseWeekday);
    if (!left || !right || !left.checkIn || !right.checkIn || right.checkIn <= left.checkIn) return { unresolvedReason: "temporal_range_invalid" };
    const nights = daysBetween(left.checkIn, right.checkIn);
    return { checkIn: left.checkIn, checkOut: right.checkIn, nights, expressionType: "date_range" };
  }
  const between = raw.match(/^(.+?)(?:到|至)(.+)$/u);
  if (between) {
    const left = parseSingleExpression(normalizeText(between[1]), base, baseWeekday);
    const right = parseSingleExpression(normalizeText(between[2]), base, baseWeekday);
    if (!left || !right || !left.checkIn || !right.checkIn || right.checkIn <= left.checkIn) return { unresolvedReason: "temporal_range_invalid" };
    return { checkIn: left.checkIn, checkOut: right.checkIn, nights: daysBetween(left.checkIn, right.checkIn), expressionType: "date_range" };
  }
  const stayRange = raw.match(/^(.+?)入住[、,，]?(.+?)退房$/u);
  if (stayRange) {
    const leftRaw = normalizeText(stayRange[1]);
    const rightRaw = normalizeText(stayRange[2]);
    const left = parseSingleExpression(leftRaw, base, baseWeekday);
    let right = parseSingleExpression(rightRaw, base, baseWeekday);
    if (!left || !left.checkIn || !right || !right.checkIn) return { unresolvedReason: "temporal_range_invalid" };
    if (right.checkIn <= left.checkIn && weekdayParts(rightRaw)) right = { ...right, checkIn: addDays(right.checkIn, 7) };
    if (right.checkIn <= left.checkIn) return { unresolvedReason: "temporal_range_invalid" };
    return { checkIn: left.checkIn, checkOut: right.checkIn, nights: daysBetween(left.checkIn, right.checkIn), expressionType: "date_range" };
  }
  const nights = duration;
  if (nights) {
    const start = parseSingleExpression(expressionBeforeNights(raw), base, baseWeekday);
    if (!start || !start.checkIn) return { unresolvedReason: "temporal_expression_unrecognized" };
    return { checkIn: start.checkIn, checkOut: addDays(start.checkIn, nights), nights, expressionType: "date_range" };
  }
  return null;
}

function parseTemporalGrammarAtBase(raw, baseParts) {
  if (/下次.*有空.*週末/u.test(raw)) return { unresolvedReason: "temporal_expression_ambiguous" };
  const range = parseRange(raw, baseParts.key, baseParts.weekday);
  if (range) return range.checkIn && range.checkIn < baseParts.key ? { ...range, unresolvedReason: "past_date" } : range;
  const single = parseSingleExpression(raw, baseParts.key, baseParts.weekday);
  if (!single) return { unresolvedReason: "temporal_expression_unrecognized" };
  return single.checkIn < baseParts.key ? { ...single, unresolvedReason: "past_date" } : single;
}

function parseTemporalGrammar(raw, eventTimestamp, timezone) {
  const timestamp = Number(eventTimestamp) || Date.parse(eventTimestamp || "");
  if (!Number.isFinite(timestamp)) return { unresolvedReason: "temporal_clock_invalid" };
  return parseTemporalGrammarAtBase(raw, partsAt(timestamp, timezone));
}

function inferTemporalSpanFromMessage(text, eventTimestamp, timezone) {
  const message = normalizeText(text);
  const timestamp = Number(eventTimestamp) || Date.parse(eventTimestamp || "");
  if (!message || !Number.isFinite(timestamp)) return null;
  const baseParts = partsAt(timestamp, timezone);
  const wholeMessage = parseTemporalGrammarAtBase(message, baseParts);
  if (wholeMessage.unresolvedReason === "temporal_expression_ambiguous") {
    return { ambiguity: wholeMessage.unresolvedReason };
  }
  const candidates = [];
  for (let start = 0; start < message.length; start += 1) {
    const maxEnd = Math.min(message.length, start + 200);
    for (let end = start + 1; end <= maxEnd; end += 1) {
      const rawText = message.slice(start, end);
      const previous = start > 0 ? message[start - 1] : "";
      const next = end < message.length ? message[end] : "";
      if ((/\d/.test(rawText[0]) && /\d/.test(previous))
        || (/\d/.test(rawText[rawText.length - 1]) && /\d/.test(next))) continue;
      const parsed = parseTemporalGrammarAtBase(rawText, baseParts);
      if ((!parsed.unresolvedReason || parsed.unresolvedReason === "past_date") && parsed.checkIn) {
        candidates.push({ rawText, parsed, start, end });
      }
    }
  }
  if (!candidates.length) return null;
  const maximal = candidates.filter((candidate) => !candidates.some((other) => (
    other !== candidate
    && other.start <= candidate.start
    && other.end >= candidate.end
    && (other.start < candidate.start || other.end > candidate.end)
  )));
  const semanticKeys = new Set(maximal.map((candidate) => JSON.stringify({
    checkIn: candidate.parsed.checkIn,
    checkOut: candidate.parsed.checkOut || null,
    nights: candidate.parsed.nights || null,
    expressionType: candidate.parsed.expressionType,
    unresolvedReason: candidate.parsed.unresolvedReason || ""
  })));
  if (semanticKeys.size !== 1) return { ambiguity: "temporal_expression_ambiguous" };
  const maxLength = Math.max(...maximal.map((candidate) => candidate.rawText.length));
  const longest = maximal.filter((candidate) => candidate.rawText.length === maxLength);
  return longest[0];
}

function inferDurationSpanFromMessage(text) {
  const message = normalizeText(text);
  if (!message) return null;
  const candidates = [];
  for (let start = 0; start < message.length; start += 1) {
    const maxEnd = Math.min(message.length, start + 32);
    for (let end = start + 1; end <= maxEnd; end += 1) {
      const rawText = message.slice(start, end);
      const nights = explicitNights(rawText);
      if (Number.isInteger(nights) && /\p{L}/u.test(rawText) && !expressionBeforeNights(rawText)) {
        candidates.push({ rawText, nights, expressionType: "duration_only", start, end });
      }
    }
  }
  if (!candidates.length) return null;
  const minimal = candidates.filter((candidate) => !candidates.some((other) => (
    other !== candidate
    && other.start >= candidate.start
    && other.end <= candidate.end
    && (other.start > candidate.start || other.end < candidate.end)
  )));
  if (new Set(minimal.map((candidate) => candidate.nights)).size !== 1) {
    return { ambiguity: "temporal_expression_ambiguous" };
  }
  const minLength = Math.min(...minimal.map((candidate) => candidate.rawText.length));
  const shortest = minimal.filter((candidate) => candidate.rawText.length === minLength);
  return shortest[0];
}

function inferGroundedTemporalSpan({ candidateSourceText, guestMessage, eventTimestamp, timezone }) {
  const normalizedMessage = normalizeText(guestMessage);
  const normalizedCandidateSource = normalizeText(candidateSourceText);
  const sources = [];
  if (normalizedCandidateSource && (!normalizedMessage || normalizedMessage.includes(normalizedCandidateSource))) {
    sources.push(candidateSourceText);
  }
  if (normalizedMessage && !sources.some((source) => normalizeText(source) === normalizedMessage)) {
    sources.push(guestMessage);
  }
  let ambiguity = null;
  for (const source of sources) {
    const temporal = inferTemporalSpanFromMessage(source, eventTimestamp, timezone);
    if (temporal && temporal.rawText) return temporal;
    if (temporal && temporal.ambiguity) ambiguity = temporal;
    const duration = inferDurationSpanFromMessage(source);
    if (duration && duration.rawText) return duration;
    if (duration && duration.ambiguity) ambiguity = duration;
  }
  return ambiguity;
}

function sourceEvidenceRefs(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).map((value) => {
    if (!value || typeof value !== "object") return null;
    const eventId = String(value.eventId || "").trim();
    const messageRef = String(value.messageRef || "").trim();
    if (!eventId && !messageRef) return null;
    const reference = {
      eventId,
      messageRef,
      startOffset: Number.isInteger(value.startOffset) ? value.startOffset : 0,
      endOffset: Number.isInteger(value.endOffset) ? value.endOffset : 0,
      quote: String(value.quote || "")
    };
    const key = JSON.stringify(reference);
    if (seen.has(key)) return null;
    seen.add(key);
    return reference;
  }).filter(Boolean);
}

function emptyFieldMetadata() {
  return {
    provenance: { checkIn: null, checkOut: null, nights: null, searchRange: null },
    ruleRefs: { checkIn: null, checkOut: null, nights: null, searchRange: null },
    derivedFromFieldRefs: { checkIn: [], checkOut: [], nights: [], searchRange: [] },
    sourceEvidenceRefs: { checkIn: [], checkOut: [], nights: [], searchRange: [] }
  };
}

function withFieldMetadata(result, metadata = {}) {
  const empty = emptyFieldMetadata();
  const provenance = { ...empty.provenance, ...(metadata.provenance || {}) };
  const ruleRefs = { ...empty.ruleRefs, ...(metadata.ruleRefs || {}) };
  const derivedFromFieldRefs = { ...empty.derivedFromFieldRefs, ...(metadata.derivedFromFieldRefs || {}) };
  const commonSourceEvidenceRefs = sourceEvidenceRefs(metadata.sourceEvidenceRefs);
  const values = {
    checkIn: result.checkIn || null,
    checkOut: result.checkOut || null,
    nights: Number.isInteger(result.nights) ? result.nights : null,
    searchRange: result.searchRange || null
  };
  const field = (name) => ({
    value: values[name],
    valueStatus: values[name] === null ? (name === "checkIn" && result.resolutionStatus === "unresolved" ? "uncertain" : "missing") : "confirmed",
    provenance: provenance[name],
    sourceEvidenceRefs: commonSourceEvidenceRefs,
    ruleRef: ruleRefs[name],
    derivedFromFieldRefs: derivedFromFieldRefs[name]
  });
  return {
    ...result,
    resolutionStatus: TEMPORAL_RESULT_STATUSES.has(result.resolutionStatus) ? result.resolutionStatus : "unresolved",
    provenance,
    ruleRefs,
    derivedFromFieldRefs,
    fields: {
      checkIn: field("checkIn"),
      checkOut: field("checkOut"),
      nights: field("nights"),
      searchRange: field("searchRange")
    }
  };
}

function plannerKindForExpressionType(expressionType) {
  if (expressionType === "relative_day") return "relative";
  if (expressionType === "relative_weekday") return "weekday";
  if (expressionType === "weekend") return "weekend";
  if (expressionType === "absolute_date") return "absolute";
  if (expressionType === "date_range") return "range";
  return "none";
}

function repairReason(plannerCandidate, parsed) {
  const expression = plannerCandidate && plannerCandidate.dateExpression || {};
  const expectedKind = plannerKindForExpressionType(parsed.expressionType);
  if (expectedKind !== "none" && expression.kind !== expectedKind) return "planner_kind_repaired";
  const candidateCheckIn = String(plannerCandidate && plannerCandidate.checkInCandidate || "");
  const candidateCheckOut = String(plannerCandidate && plannerCandidate.checkOutCandidate || "");
  const candidateNights = plannerCandidate && plannerCandidate.nightsCandidate;
  if (candidateCheckIn && candidateCheckIn !== parsed.checkIn) return "planner_candidate_rejected";
  if (candidateCheckOut && candidateCheckOut !== parsed.checkOut) return "planner_candidate_rejected";
  if (Number.isInteger(candidateNights) && Number.isInteger(parsed.nights) && candidateNights !== parsed.nights) return "planner_candidate_rejected";
  return "";
}

function resolvedContext({ rawText, timezone, applicableTaskIds, approvedContext, plannerCandidate, sourceEvidenceRefs: evidence }) {
  const checkIn = valid(approvedContext && approvedContext.checkIn) ? approvedContext.checkIn : null;
  const contextCheckOut = valid(approvedContext && approvedContext.checkOut) ? approvedContext.checkOut : null;
  const currentNights = Number.isInteger(plannerCandidate && plannerCandidate.nightsCandidate)
    ? plannerCandidate.nightsCandidate
    : null;
  const nights = currentNights || (
    Number.isInteger(approvedContext && approvedContext.nights)
      ? approvedContext.nights
      : null
  );
  const checkOut = contextCheckOut || (
    checkIn && currentNights ? addDays(checkIn, currentNights) : null
  );
  if (!checkIn || !checkOut) return null;
  return withFieldMetadata({
    rawText,
    expressionType: "context",
    checkIn,
    checkOut,
    nights,
    searchRange: null,
    timezone,
    resolutionStatus: "resolved",
    resolutionSource: "approved_context",
    repairReasonCode: "",
    applicableTaskIds,
    ambiguity: null,
    originalExpression: rawText
  }, {
    provenance: { checkIn: "context", checkOut: contextCheckOut ? "context" : "derived", nights: currentNights ? "explicit" : nights ? "context" : null },
    ruleRefs: { checkIn: CONTEXTUAL_TEMPORAL_RULE_REF, checkOut: contextCheckOut ? CONTEXTUAL_TEMPORAL_RULE_REF : "temporal:checkout_from_checkin_and_nights", nights: currentNights ? null : nights ? CONTEXTUAL_TEMPORAL_RULE_REF : null },
    derivedFromFieldRefs: { checkOut: contextCheckOut ? [] : ["stay.checkIn", "stay.nights"] },
    sourceEvidenceRefs: evidence
  });
}

function resolveCanonicalTemporal({
  guestMessage = "",
  candidateSourceText = "",
  plannerCandidate = {},
  eventTimestamp,
  timezone = "Asia/Taipei",
  defaultNights = null,
  defaultNightsRuleRef = null,
  defaultSearchRangeDays = null,
  defaultSearchRangeRuleRef = null,
  sourceEvidenceRefs: evidence = [],
  approvedContext = null,
  allowContextReuse = false,
  allowSharedMessageInference = false,
  applicableTaskIds = []
} = {}) {
  const expression = plannerCandidate && plannerCandidate.dateExpression || {};
  let rawText = normalizeText(expression.rawText);
  let recoveredPlannerSpan = false;
  const taskIds = [...new Set((Array.isArray(applicableTaskIds) ? applicableTaskIds : []).map(String).filter(Boolean))];
  const inferGroundedSpan = (allowGuestMessage = allowSharedMessageInference) => inferGroundedTemporalSpan({
    candidateSourceText,
    guestMessage: allowGuestMessage ? guestMessage : "",
    eventTimestamp,
    timezone
  });

  if (!rawText) {
    const inferred = inferGroundedSpan();
    if (inferred && inferred.ambiguity) {
      return withFieldMetadata({
        rawText: "",
        expressionType: "ambiguous",
        checkIn: null,
        checkOut: null,
        nights: null,
        searchRange: null,
        timezone,
        resolutionStatus: "unresolved",
        resolutionSource: "canonical_temporal_grammar",
        repairReasonCode: inferred.ambiguity,
        applicableTaskIds: taskIds,
        ambiguity: inferred.ambiguity,
        originalExpression: ""
      }, { sourceEvidenceRefs: evidence });
    }
    if (inferred && inferred.rawText) {
      rawText = inferred.rawText;
      recoveredPlannerSpan = true;
    }
  }

  if (!rawText) {
    if (allowContextReuse && approvedContext) {
      const reused = resolvedContext({ rawText, timezone, applicableTaskIds: taskIds, approvedContext, plannerCandidate, sourceEvidenceRefs: approvedContext.sourceEvidenceRefs || evidence });
      if (reused) return reused;
    }
    if (Number.isInteger(defaultSearchRangeDays) && defaultSearchRangeDays > 0) {
      const timestamp = Number(eventTimestamp) || Date.parse(eventTimestamp || "");
      const from = Number.isFinite(timestamp) ? partsAt(timestamp, timezone).key : null;
      if (from) {
        const searchRange = { from, to: addDays(from, defaultSearchRangeDays) };
        return withFieldMetadata({
          rawText,
          expressionType: "default_search_range",
          checkIn: null,
          checkOut: null,
          nights: null,
          searchRange,
          timezone,
          resolutionStatus: "resolved",
          resolutionSource: "product_default",
          repairReasonCode: "",
          applicableTaskIds: taskIds,
          ambiguity: null,
          originalExpression: rawText
        }, {
          provenance: { searchRange: "defaulted" },
          ruleRefs: { searchRange: defaultSearchRangeRuleRef || null },
          derivedFromFieldRefs: { searchRange: ["eventTimestamp"] },
          sourceEvidenceRefs: evidence
        });
      }
    }
    return withFieldMetadata({
      rawText,
      expressionType: "none",
      checkIn: null,
      checkOut: null,
      nights: Number.isInteger(plannerCandidate.nightsCandidate) ? plannerCandidate.nightsCandidate : null,
      searchRange: null,
      timezone,
      resolutionStatus: "absent",
      resolutionSource: "canonical_temporal_grammar",
      repairReasonCode: "",
      applicableTaskIds: taskIds,
      ambiguity: null,
      originalExpression: rawText
    }, { sourceEvidenceRefs: evidence });
  }

  const normalizedMessage = normalizeText(guestMessage);
  if (normalizedMessage && !normalizedMessage.includes(rawText)) {
    const inferred = inferGroundedSpan();
    if (inferred && inferred.ambiguity) {
      return withFieldMetadata({
        rawText: "",
        expressionType: "ambiguous",
        checkIn: null,
        checkOut: null,
        nights: null,
        searchRange: null,
        timezone,
        resolutionStatus: "unresolved",
        resolutionSource: "canonical_temporal_grammar",
        repairReasonCode: inferred.ambiguity,
        applicableTaskIds: taskIds,
        ambiguity: inferred.ambiguity,
        originalExpression: rawText
      }, { sourceEvidenceRefs: evidence });
    }
    if (inferred && inferred.rawText) {
      rawText = inferred.rawText;
      recoveredPlannerSpan = true;
    } else {
      return withFieldMetadata({
        rawText,
        expressionType: "ambiguous",
        checkIn: null,
        checkOut: null,
        nights: null,
        searchRange: null,
        timezone,
        resolutionStatus: "unresolved",
        resolutionSource: "canonical_temporal_grammar",
        repairReasonCode: "planner_temporal_span_invalid",
        applicableTaskIds: taskIds,
        ambiguity: "planner_temporal_span_invalid",
        originalExpression: rawText
      }, { sourceEvidenceRefs: evidence });
    }
  }

  if (!recoveredPlannerSpan) {
    const initialParsed = parseTemporalGrammar(rawText, eventTimestamp, timezone);
    if (initialParsed.unresolvedReason === "temporal_expression_unrecognized") {
      const inferred = inferGroundedSpan(false);
      if (inferred && inferred.rawText && normalizeText(inferred.rawText) !== rawText) {
        rawText = inferred.rawText;
        recoveredPlannerSpan = true;
      }
    }
  }

  const durationOnly = explicitNights(rawText);
  if (durationOnly && !expressionBeforeNights(rawText)) {
    return withFieldMetadata({
      rawText,
      expressionType: "duration_only",
      checkIn: null,
      checkOut: null,
      nights: durationOnly,
      searchRange: null,
      timezone,
      resolutionStatus: "absent",
      resolutionSource: "canonical_temporal_grammar",
      repairReasonCode: recoveredPlannerSpan ? "planner_temporal_span_recovered" : "",
      applicableTaskIds: taskIds,
      ambiguity: null,
      originalExpression: rawText
    }, {
      provenance: { nights: "explicit" },
      ruleRefs: { nights: CANONICAL_TEMPORAL_RULE_REF },
      sourceEvidenceRefs: evidence
    });
  }

  const parsed = parseTemporalGrammar(rawText, eventTimestamp, timezone);
  if (parsed.unresolvedReason) {
    const unresolvedNights = parsed.unresolvedReason === "past_date"
      ? Number.isInteger(parsed.nights)
        ? parsed.nights
        : Number.isInteger(plannerCandidate.nightsCandidate)
          ? plannerCandidate.nightsCandidate
          : Number.isInteger(defaultNights) ? defaultNights : null
      : null;
    return withFieldMetadata({
      rawText,
      expressionType: parsed.unresolvedReason === "past_date" && parsed.expressionType
        ? parsed.expressionType
        : "ambiguous",
      checkIn: null,
      checkOut: null,
      nights: unresolvedNights,
      searchRange: null,
      timezone,
      resolutionStatus: "unresolved",
      resolutionSource: "canonical_temporal_grammar",
      repairReasonCode: parsed.unresolvedReason,
      applicableTaskIds: taskIds,
      ambiguity: parsed.unresolvedReason,
      originalExpression: rawText
    }, { sourceEvidenceRefs: evidence });
  }

  const parsedNights = Number.isInteger(parsed.nights)
    ? parsed.nights
    : Number.isInteger(plannerCandidate.nightsCandidate)
      ? plannerCandidate.nightsCandidate
      : Number.isInteger(defaultNights) ? defaultNights : null;
  const checkIn = parsed.checkIn || null;
  const checkOut = parsed.checkOut || (checkIn && parsedNights ? addDays(checkIn, parsedNights) : null);
  if (!valid(checkIn) || (checkOut && (!valid(checkOut) || checkOut <= checkIn))) {
    return withFieldMetadata({
      rawText,
      expressionType: parsed.expressionType || "ambiguous",
      checkIn: null,
      checkOut: null,
      nights: parsedNights,
      searchRange: null,
      timezone,
      resolutionStatus: "unresolved",
      resolutionSource: "canonical_temporal_grammar",
      repairReasonCode: "temporal_range_invalid",
      applicableTaskIds: taskIds,
      ambiguity: "temporal_range_invalid",
      originalExpression: rawText
    }, { sourceEvidenceRefs: evidence });
  }

  const canonical = {
    ...parsed,
    checkIn,
    checkOut,
    nights: parsedNights,
    searchRange: parsed.searchRange || null
  };
  const repaired = recoveredPlannerSpan ? "planner_temporal_span_recovered" : repairReason(plannerCandidate, canonical);
  return withFieldMetadata({
    rawText,
    expressionType: canonical.expressionType,
    checkIn,
    checkOut,
    nights: parsedNights,
    searchRange: canonical.searchRange,
    timezone,
    resolutionStatus: "resolved",
    resolutionSource: "canonical_temporal_grammar",
    repairReasonCode: repaired,
    applicableTaskIds: taskIds,
    ambiguity: null,
    originalExpression: rawText
  }, {
    provenance: {
      checkIn: "explicit",
      checkOut: canonical.checkOut ? (parsed.checkOut ? "explicit" : "derived") : null,
      nights: Number.isInteger(parsed.nights) ? "explicit" : Number.isInteger(plannerCandidate.nightsCandidate) ? "explicit" : Number.isInteger(defaultNights) ? "defaulted" : null,
      searchRange: canonical.searchRange ? "explicit" : null
    },
    ruleRefs: {
      checkIn: CANONICAL_TEMPORAL_RULE_REF,
      checkOut: parsed.checkOut ? CANONICAL_TEMPORAL_RULE_REF : canonical.checkOut ? (Number.isInteger(defaultNights) ? defaultNightsRuleRef : "temporal:checkout_from_checkin_and_nights") : null,
      nights: Number.isInteger(defaultNights) && !Number.isInteger(plannerCandidate.nightsCandidate) && !Number.isInteger(parsed.nights) ? defaultNightsRuleRef : null,
      searchRange: canonical.searchRange ? CANONICAL_TEMPORAL_RULE_REF : null
    },
    derivedFromFieldRefs: {
      checkOut: parsed.checkOut ? [] : canonical.checkOut ? ["stay.checkIn", "stay.nights"] : []
    },
    sourceEvidenceRefs: evidence
  });
}

function resolveTemporalExpression(expression = {}, context = {}) {
  return resolveCanonicalTemporal({
    guestMessage: expression.rawText || "",
    candidateSourceText: expression.rawText || "",
    plannerCandidate: {
      dateExpression: expression,
      checkInCandidate: context.checkInCandidate || null,
      checkOutCandidate: context.checkOutCandidate || null,
      nightsCandidate: Number.isInteger(context.nightsCandidate) ? context.nightsCandidate : null,
      guestCountCandidate: null
    },
    eventTimestamp: context.eventTimestamp,
    timezone: context.timezone,
    defaultNights: context.defaultNights,
    defaultNightsRuleRef: context.defaultNightsRuleRef,
    defaultSearchRangeDays: context.defaultSearchRangeDays,
    defaultSearchRangeRuleRef: context.defaultSearchRangeRuleRef,
    sourceEvidenceRefs: context.sourceEvidenceRefs,
    approvedContext: context.approvedContext,
    allowContextReuse: context.allowContextReuse,
    applicableTaskIds: context.applicableTaskIds || []
  });
}

module.exports = {
  resolveCanonicalTemporal,
  resolveTemporalExpression,
  inferExplicitTemporalExpression,
  addDays,
  valid,
  TEMPORAL_RESULT_STATUSES,
  TEMPORAL_PROVENANCE,
  TEMPORAL_VALUE_STATUSES,
  CONTEXTUAL_TEMPORAL_RULE_REF,
  CANONICAL_TEMPORAL_RULE_REF
};
