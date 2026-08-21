"use strict";

const STATUS_GROUPS = {
  answered: "answeredTaskIds",
  needs_clarification: "clarificationTaskIds",
  property_data_missing: "humanTaskIds",
  needs_human: "humanTaskIds",
  failed: "failedTaskIds"
};

function coverageByStatus(items = []) {
  const result = { answeredTaskIds: [], clarificationTaskIds: [], humanTaskIds: [], failedTaskIds: [] };
  for (const item of items) {
    const group = STATUS_GROUPS[item && item.status] || "failedTaskIds";
    const taskIds = Array.isArray(item && item.coveredTaskIds) && item.coveredTaskIds.length
      ? item.coveredTaskIds
      : [item && item.taskId];
    for (const taskId of taskIds) if (taskId && !result[group].includes(taskId)) result[group].push(taskId);
  }
  return result;
}

function assertTaskCoverage(inputTaskIds = [], coverage = {}) {
  const expected = [...new Set(inputTaskIds.filter(Boolean))];
  const groups = ["answeredTaskIds", "clarificationTaskIds", "humanTaskIds", "failedTaskIds"];
  const occurrences = new Map();
  for (const group of groups) for (const id of coverage[group] || []) occurrences.set(id, (occurrences.get(id) || 0) + 1);
  const missingTaskIds = expected.filter((id) => !occurrences.has(id));
  const duplicateTaskIds = expected.filter((id) => (occurrences.get(id) || 0) !== 1 && occurrences.has(id));
  const unexpectedTaskIds = [...occurrences.keys()].filter((id) => !expected.includes(id));
  return { ok: missingTaskIds.length === 0 && duplicateTaskIds.length === 0 && unexpectedTaskIds.length === 0, missingTaskIds, duplicateTaskIds, unexpectedTaskIds, coveredTaskIds: expected.filter((id) => occurrences.get(id) === 1) };
}

module.exports = { coverageByStatus, assertTaskCoverage };
