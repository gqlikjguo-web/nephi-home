"use strict";
// Natural-language meaning, not executable dates or property facts.
const DAY_PERIODS = Object.freeze(["unspecified", "morning", "afternoon", "evening", "night"]);
const MAX_DAY_OFFSET = 366;
const RELATIVE_TEMPORAL_CANDIDATE_KIND = "relative_date";
const RELATIVE_TEMPORAL_CANONICAL_DOMAIN = "single_date";
const RELATIVE_TEMPORAL_SEMANTICS_DESCRIPTION = "Source-grounded relative meaning for one calendar date, including relative days, relative weekdays, and time-of-day qualifiers. Date candidates remain null; JunZan Temporal computes and validates the canonical date.";
const CANONICAL_TEMPORAL_COMPARISON = Object.freeze({
  EQUIVALENT: "EQUIVALENT",
  CONFLICT: "CONFLICT",
  NOT_COMPARABLE: "NOT_COMPARABLE"
});

function isRelativeTemporalSemantics(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 2 && Object.hasOwn(value,"dayOffset") && Object.hasOwn(value,"dayPeriod")
    && Number.isSafeInteger(value.dayOffset) && Math.abs(value.dayOffset) <= MAX_DAY_OFFSET
    && DAY_PERIODS.includes(value.dayPeriod));
}

function canonicalDayNumber(value) {
  if (typeof value !== "string" || value.length !== 10) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp / 86400000 : null;
}

// Inputs are canonical date values, never natural language. A point date is
// not a stay interval. Duration is a constraint, including when end is given.
// Search windows retain their own domain; they do not mean occupied nights.
function canonicalTemporalValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.searchRange) {
    const from = canonicalDayNumber(value.searchRange.from);
    const to = canonicalDayNumber(value.searchRange.to);
    if (from === null || to === null || to < from || value.checkIn || value.checkOut || value.nights != null) return { invalid: true };
    return { domain: "search_range", from, to };
  }
  if (value.checkIn == null) return null;
  const from = canonicalDayNumber(value.checkIn);
  const durationPresent = value.nights != null;
  if (from === null || durationPresent && (!Number.isSafeInteger(value.nights) || value.nights < 1)) return { invalid: true };
  if (value.checkOut != null) {
    const to = canonicalDayNumber(value.checkOut);
    if (to === null || to <= from || durationPresent && to - from !== value.nights) return { invalid: true };
    return { domain: "stay_range", from, to };
  }
  if (durationPresent) return { domain: "stay_range", from, to: from + value.nights };
  return { domain: RELATIVE_TEMPORAL_CANONICAL_DOMAIN, date: from };
}

function compareCanonicalTemporalSemantics(left, right) {
  const leftValue = canonicalTemporalValue(left);
  const rightValue = canonicalTemporalValue(right);
  if (leftValue && leftValue.invalid || rightValue && rightValue.invalid) return CANONICAL_TEMPORAL_COMPARISON.CONFLICT;
  if (!leftValue || !rightValue) return CANONICAL_TEMPORAL_COMPARISON.NOT_COMPARABLE;
  if (leftValue.domain !== rightValue.domain) return CANONICAL_TEMPORAL_COMPARISON.CONFLICT;
  if (leftValue.domain === RELATIVE_TEMPORAL_CANONICAL_DOMAIN) {
    return leftValue.date === rightValue.date
      ? CANONICAL_TEMPORAL_COMPARISON.EQUIVALENT
      : CANONICAL_TEMPORAL_COMPARISON.CONFLICT;
  }
  return leftValue.from === rightValue.from && leftValue.to === rightValue.to
    ? CANONICAL_TEMPORAL_COMPARISON.EQUIVALENT
    : CANONICAL_TEMPORAL_COMPARISON.CONFLICT;
}

module.exports = {
  DAY_PERIODS,
  MAX_DAY_OFFSET,
  RELATIVE_TEMPORAL_CANDIDATE_KIND,
  RELATIVE_TEMPORAL_CANONICAL_DOMAIN,
  RELATIVE_TEMPORAL_SEMANTICS_DESCRIPTION,
  CANONICAL_TEMPORAL_COMPARISON,
  isRelativeTemporalSemantics,
  compareCanonicalTemporalSemantics
};
