"use strict";
const { understandingInputForValidatedLifecycleDecision, relationForValidatedLifecycleDecision } = require("./lifecycle-manager");
const { isValidatedSemanticUnitFor } = require("./semantic-unit-validator");
const { referenceableStays } = require("./relation-completeness");
const ISSUED = new WeakSet();
const LODGING = new Set(["availability", "bundle_availability", "price", "total_price", "capacity"]);

// A question about a possible continuation grants no lifecycle target and no
// permission to reuse conditions. C05/C06 remain the sole reuse authorities.
function createContinuationClarification({ unit, lifecycleDecision, readiness }) {
  const input = understandingInputForValidatedLifecycleDecision(lifecycleDecision);
  if (!input || !isValidatedSemanticUnitFor(input, unit) || lifecycleDecision.action !== "START"
    || !["NEW_REQUEST", "NONE"].includes(relationForValidatedLifecycleDecision(lifecycleDecision))
    || unit.purpose !== "lodging_question" || !LODGING.has(unit.capability)
    || readiness.status !== "MISSING_GUEST_FIELDS"
    || !readiness.missingGuestFields.some(field => ["stay.checkIn", "stay.checkOut"].includes(field))) return null;
  const bound = new Set(input.recentConversation.flatMap(event => event.referenceableCycleIds));
  const stays = referenceableStays(input).filter(cycle => bound.has(cycle.requestCycleId)
    && LODGING.has(cycle.capability));
  if (!stays.length) return null;
  const unique = stays.length === 1 ? stays[0] : null;
  const catalogSubject = input.publicSubjectCatalog.find(subject => subject.kind === unit.subject.kind
    && subject.catalogIdentity === unit.subject.catalogIdentity);
  const value = Object.freeze({ kind: unique ? "confirm_continuation" : "ambiguous_continuation",
    propertyId: input.propertyScope.propertyId, turnId: input.turnId, unitId: unit.unitId,
    requestCycleId: unique?.requestCycleId || null,
    checkIn: unique?.confirmedValues.checkIn || null, checkOut: unique?.confirmedValues.checkOut || null,
    subjectName: catalogSubject?.publicName || "這個旅宿的房型" });
  ISSUED.add(value);
  return value;
}
function isContinuationClarification(value, scope = {}) {
  return Boolean(value && ISSUED.has(value)
    && (!scope.propertyId || scope.propertyId === value.propertyId)
    && (!scope.turnId || scope.turnId === value.turnId)
    && (!scope.unitId || scope.unitId === value.unitId));
}
function continuationQuestion(value, scope) {
  return isContinuationClarification(value, scope) && value.kind === "confirm_continuation"
    ? `請問您是要沿用剛才的住宿日期（${value.checkIn} 至 ${value.checkOut}），查詢 ${value.subjectName} 嗎？` : "";
}
module.exports = { createContinuationClarification, isContinuationClarification, continuationQuestion };
