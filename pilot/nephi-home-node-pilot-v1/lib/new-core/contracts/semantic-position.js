"use strict";

const { isDeepStrictEqual: equal } = require("node:util");
const { INFORMATION_NEED_SLOT } = require("./information-need");

// Execution positions are scalar in C08/State; context-only positions are sets
// of typed members. Quantity is a separate compound value, never slot count.
const SLOT_POSITIONS = Object.freeze({
  guest_count: Object.freeze({ cardinality: "single" }),
  product: Object.freeze({ cardinality: "single" }),
  [INFORMATION_NEED_SLOT]: Object.freeze({ cardinality: "single" }),
  transport: Object.freeze({ cardinality: "multi" }),
  other_supported: Object.freeze({ cardinality: "multi" })
});
const QUANTITY_POSITION = Object.freeze({ field: "quantityCandidate", cardinality: "single" });
const typedValue = value => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "evidenceRefs" && key !== "slotCandidateId"))
  : value;
const slotValue = item => ({ slot: item.slot, operation: item.operation, value: item.value });
const evidenceRetained = (before, after) => Array.isArray(before) && Array.isArray(after)
  && before.every(ref => after.some(candidate => equal(ref, candidate)));

function validateSemanticPositions(items) {
  if (!Array.isArray(items)) return { ok: false, failures: [{ rule: "positionsRequired" }] };
  const failures = [];
  for (const slot of new Set(items.map(item => item.slot))) {
    const rule = SLOT_POSITIONS[slot];
    const members = items.filter(item => item.slot === slot);
    if (!rule) { failures.push({ slot, rule: "positionUnknown" }); continue; }
    if (rule.cardinality === "single" && members.length > 1) {
      failures.push({ slot, rule: "singlePositionConflict" });
    } else if (members.length > 1 && members.some(item => item.operation === "CLEAR")) {
      failures.push({ slot, rule: "positionClearConflict" });
    } else if (members.some((item, index) => members.slice(0, index).some(other => equal(slotValue(item), slotValue(other))))) {
      failures.push({ slot, rule: "duplicateSemanticValue" });
    }
  }
  return { ok: failures.length === 0, failures };
}

function singleSlotOperation(operations, position) {
  if (SLOT_POSITIONS[position]?.cardinality !== "single") return undefined;
  const matches = operations.filter(operation => operation.slot === position);
  return matches.length <= 1 ? (matches[0] || null) : undefined;
}

function semanticOwner(input, unit) {
  return { propertyScope: input.propertyScope, turnId: input.turnId, unitId: unit.unitId };
}

// The producer snapshots the validated obligation, not the opaque instance ID.
function bindSemanticObligations(states, unit, input) {
  const owner = semanticOwner(input, unit);
  return states.map(state => {
    if (state.obligationKind === "positionRepair") return { ...state, owner };
    const item = state.slotCandidateId
      ? unit.slotCandidates.find(candidate => candidate.slotCandidateId === state.slotCandidateId)
      : unit[state.field];
    return { ...state, owner, semanticPosition: state.slotCandidateId ? item.slot : state.field,
      obligationKind: state.obligationKind || (state.slotCandidateId ? "slotItem" : "typedValue"),
      trustedValue: typedValue(item), evidenceRefs: item?.evidenceRefs };
  });
}

function semanticObligationsPreserved(previous, next, obligations, input) {
  if (!previous || !next || !input || !Array.isArray(obligations)
    || !validateSemanticPositions(next.slotCandidates).ok) return false;
  const owner = semanticOwner(input, next);
  const used = new Set();
  // Match trusted items first; a revalidated member cannot consume their match.
  const ordered = [...obligations].sort((a, b) => Number(b.preservation === "PRESERVE") - Number(a.preservation === "PRESERVE"));
  for (const state of ordered) {
    if (!equal(state.owner, owner)) return false;
    if (state.preservation === "MUTABLE") continue;
    if (state.obligationKind === "positionRepair") {
      const members = next.slotCandidates.filter(item => item.slot === state.semanticPosition);
      if (!members.length || !evidenceRetained(state.evidenceRefs, members.flatMap(item => item.evidenceRefs))) return false;
      continue;
    }
    if (state.obligationKind === "slotItem") {
      const candidate = next.slotCandidates.find(item => !used.has(item) && item.slot === state.semanticPosition
        && (state.preservation === "REVALIDATE" || equal(typedValue(item), state.trustedValue)
          && evidenceRetained(state.evidenceRefs, item.evidenceRefs)));
      if (!candidate) return false;
      used.add(candidate);
      continue;
    }
    const after = next[state.field];
    if (state.trustedValue != null && after == null) return false;
    if (state.preservation === "REVALIDATE") continue;
    if (state.obligationKind === "sourceEvidence") {
      if (!evidenceRetained(state.trustedValue, after)) return false;
    } else if (!equal(state.trustedValue, typedValue(after))
      || state.evidenceRefs && !evidenceRetained(state.evidenceRefs, after?.evidenceRefs)) return false;
    if (state.slotConstraint && !next.slotCandidates.filter(item => item.slot === state.slotConstraint.slot)
      .every(item => equal(typedValue(item), state.slotConstraint))) return false;
  }
  return true;
}

module.exports = { SLOT_POSITIONS, QUANTITY_POSITION, validateSemanticPositions,
  singleSlotOperation, bindSemanticObligations, semanticObligationsPreserved };
