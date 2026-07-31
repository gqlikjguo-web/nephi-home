"use strict";

(function expose(root) {
  function addDays(dateKey, count) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
  }

  function recentDateKeys(startDate, count = 15) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || "")) || !Number.isInteger(count) || count < 1) return [];
    return Array.from({ length: count }, (_item, index) => addDays(startDate, index));
  }

  function monthsForDateKeys(dateKeys) {
    return [...new Set((dateKeys || []).map((date) => String(date).slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)))];
  }

  const api = { recentDateKeys, monthsForDateKeys };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AdminAvailabilityWindow = api;
})(typeof globalThis === "undefined" ? null : globalThis);
