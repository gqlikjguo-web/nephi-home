"use strict";

const PATHS = new Set(["stay.checkIn", "stay.checkOut", "stay.nights", "stay.guests", "stay.searchRange", "inventory.mode", "inventory.entityId", "inventory.features"]);
function blankConditions() { return { stay: { checkIn: null, checkOut: null, nights: null, guests: null, searchRange: null }, inventory: { mode: "any", entityId: null, features: [] }, tasks: [] }; }
function emptyStateV2(scope = {}) { return { schemaVersion: 2, scope: { propertyId: scope.propertyId || "", channelId: scope.channelId || "", lineUserId: scope.lineUserId || "" }, conditions: blankConditions(), transition: { set: [], replaced: [], cleared: [], kept: [], sourceEventId: "" }, updatedAt: scope.now || new Date().toISOString() }; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function setPath(root, path, value) { const [group, field] = path.split("."); root[group][field] = value; }
function migrateStateV2(state, scope) { if (!state || state.schemaVersion !== 2 || !state.scope || state.scope.propertyId !== scope.propertyId || state.scope.channelId !== scope.channelId || state.scope.lineUserId !== scope.lineUserId) return emptyStateV2(scope); return clone(state); }

function reduceConversationState(previous, planner, scope) {
  let state = migrateStateV2(previous, scope);
  if (planner.discourse && (planner.discourse.relation === "new_topic" || planner.discourse.relation === "new_request") && planner.stateOperations.some((item) => item.field === "*" && item.operation === "clear")) state.conditions = blankConditions();
  const transition = { set: [], replaced: [], cleared: [], kept: [], sourceEventId: scope.eventId || "" };
  for (const item of planner.stateOperations || []) {
    if (!PATHS.has(item.field)) continue;
    if (item.operation === "clear") { setPath(state.conditions, item.field, item.field === "inventory.features" ? [] : null); transition.cleared.push(item.field); }
    else if (item.operation === "keep") transition.kept.push(item.field);
    else { setPath(state.conditions, item.field, clone(item.value)); transition[item.operation === "replace" ? "replaced" : "set"].push(item.field); }
  }
  if (planner.tasks && planner.tasks.length) state.conditions.tasks = clone(planner.tasks);
  state.transition = transition; state.updatedAt = scope.now || new Date().toISOString();
  return state;
}

module.exports = { emptyStateV2, migrateStateV2, reduceConversationState };
