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

  function availabilityRangeForSelection(today, selection) {
    if (selection === "rolling") {
      const dateKeys = recentDateKeys(today, 30);
      return { startDate: dateKeys[0], endDate: dateKeys[dateKeys.length - 1], dateKeys };
    }
    const month = String(selection || "");
    if (!/^\d{4}-\d{2}$/.test(month)) return availabilityRangeForSelection(today, "rolling");
    const monthStart = `${month}-01`;
    const nextMonth = addDays(`${month}-28`, 4).slice(0, 7);
    const monthEnd = addDays(`${nextMonth}-01`, -1);
    const startDate = month === String(today).slice(0, 7) ? today : monthStart;
    const dateKeys = recentDateKeys(startDate, Math.round((new Date(`${monthEnd}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1);
    return { startDate, endDate: monthEnd, dateKeys };
  }

  function availabilityLoadPlan(today, selection) {
    const range = availabilityRangeForSelection(today, selection);
    return {
      selection: selection === "rolling" || /^\d{4}-\d{2}$/.test(String(selection || "")) ? selection : "rolling",
      months: monthsForDateKeys(range.dateKeys),
      dateKeys: range.dateKeys
    };
  }

  const api = { recentDateKeys, monthsForDateKeys, availabilityRangeForSelection, availabilityLoadPlan };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AdminAvailabilityWindow = api;
})(typeof globalThis === "undefined" ? null : globalThis);
