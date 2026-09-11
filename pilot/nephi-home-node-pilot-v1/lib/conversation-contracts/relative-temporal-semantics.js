"use strict";
// Natural-language meaning, not executable dates or property facts.
const DAY_PERIODS = Object.freeze(["unspecified", "morning", "afternoon", "evening", "night"]);
const MAX_DAY_OFFSET = 366;
function isRelativeTemporalSemantics(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 2 && Object.hasOwn(value,"dayOffset") && Object.hasOwn(value,"dayPeriod")
    && Number.isSafeInteger(value.dayOffset) && Math.abs(value.dayOffset) <= MAX_DAY_OFFSET
    && DAY_PERIODS.includes(value.dayPeriod));
}
module.exports = {DAY_PERIODS, MAX_DAY_OFFSET, isRelativeTemporalSemantics};
