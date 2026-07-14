"use strict";

function dateKeyInTimeZone(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_runtime_clock");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function runtimeCalendarContext(now = () => new Date(), timeZone = "Asia/Taipei") {
  return { currentDate: dateKeyInTimeZone(now(), timeZone), timeZone };
}

module.exports = { dateKeyInTimeZone, runtimeCalendarContext };
