"use strict";

const { validateAndNormalizeSourceEvidence } = require("./source-evidence-validator");
const { resolveTemporalExpression } = require("../conversation-engine-v2/temporal-resolver");

const historyKey = ref => JSON.stringify([ref.eventId, ref.messageRef]);

// C01 supplies the verified conversation scope and snapshot. This is an
// evidence obligation, not a choice of lifecycle target or a language parser.
function referenceableStayHistory(input, now = Math.max(...input.sourceEvents.map(event => Date.parse(event.timestamp)))) {
  const stays = new Set(input.referenceableCycles.filter(cycle =>
    ["active", "pending", "answered"].includes(cycle.status)
      && Date.parse(cycle.expiresAt) > now
      && cycle.confirmedValues.checkIn && cycle.confirmedValues.checkOut
      && ["property", "room", "bundle", "matched_room_set"].includes(cycle.subject.kind)
  ).map(cycle => cycle.requestCycleId));
  return input.recentConversation.filter(event => event.referenceableCycleIds.some(id => stays.has(id)))
    .map(({ eventId, messageRef }) => ({ eventId, messageRef }));
}

function sourceOwned(ref, owners) {
  return owners.some(owner => ref.eventId === owner.eventId && ref.messageRef === owner.messageRef
    && ref.startOffset >= owner.startOffset && ref.endOffset <= owner.endOffset);
}

function independenceFailure(proof, unit, link, input, history) {
  if (!proof) return { field: "independentRequestEvidence", actual: "relation_completeness:missing",
    expected: "source-grounded independence assessment of verified lodging history, or a supported existing relation" };
  const refs = validateAndNormalizeSourceEvidence(proof.currentSourceEvidenceRefs, input.sourceEvents);
  const unitRefs = validateAndNormalizeSourceEvidence(unit.evidenceRefs, input.sourceEvents);
  const linkRefs = validateAndNormalizeSourceEvidence(link.currentSourceEvidenceRefs, input.sourceEvents);
  if (!refs.ok || !unitRefs.ok || !linkRefs.ok
    || !refs.value.every(ref => sourceOwned(ref, unitRefs.value) && sourceOwned(ref, linkRefs.value))) {
    return { field: "independentRequestEvidence.currentSourceEvidenceRefs",
      actual: refs.code || "relation_completeness:unowned_evidence",
      expected: "exact current-source evidence owned by this unit and its relation" };
  }
  const required = new Set(history.map(historyKey));
  const assessed = new Set(proof.assessedHistoryEventRefs.map(historyKey));
  if (assessed.size !== proof.assessedHistoryEventRefs.length || assessed.size !== required.size
    || [...required].some(key => !assessed.has(key))) {
    return { field: "independentRequestEvidence.assessedHistoryEventRefs",
      actual: "relation_completeness:history_assessment_incomplete",
      expected: "each supplied, nonexpired history event bound to a verified stay, without foreign refs or target selection" };
  }
  return null;
}

function sourceEventsForTemporalEvidence(evidence, temporal, input) {
  return evidence.value.filter(ref => ref.quote.includes(temporal.rawText))
    .map(ref => input.sourceEvents.find(source => source.eventId === ref.eventId && source.messageRef === ref.messageRef));
}

function hasIndependentStayDates(unit, input) {
  const temporal = unit.temporalCandidate;
  if (temporal === null) return false;
  const evidence = validateAndNormalizeSourceEvidence(unit.evidenceRefs, input.sourceEvents);
  // Do not replace C04's source failure with a relation failure. Invalid refs
  // still fail full admission; they can never authorize Context inheritance.
  if (!evidence.ok) return true;
  const sources = sourceEventsForTemporalEvidence(evidence, temporal, input);
  return sources.length > 0 && sources.every(source => {
    // Ask the sole Temporal authority about this source alone. No defaults,
    // history selection, Context reuse or locally inferred date conditions.
    const resolved = resolveTemporalExpression({
      ...temporal,
      kind: temporal.kind === "relative_date" ? "relative" : temporal.kind,
      anchor: "message_time"
    }, {
      eventTimestamp: source.timestamp, timezone: input.propertyTimezone,
      checkInCandidate: temporal.checkInCandidate, checkOutCandidate: temporal.checkOutCandidate,
      nightsCandidate: temporal.nightsCandidate
    });
    // A grounded past date is still independent; its execution rejection must
    // remain at the existing Temporal boundary, not become a history request.
    return Boolean(resolved.checkIn || resolved.searchRange || resolved.repairReasonCode === "past_date");
  });
}

function relationCompletenessFailure(value, input, now) {
  const history = referenceableStayHistory(input, now);
  const unitViolations = [];
  for (const [index, link] of value.contextLinkCandidates.entries()) {
    const unit = value.understandingOutput.units.find(item => item.unitId === link.unitId
      && item.contextLinkCandidateId === link.contextLinkCandidateId);
    if (!unit) continue;
    const required = link.relationKind === "NEW_REQUEST" && unit.purpose === "lodging_question"
      && unit.stayDependent === true && history.length > 0 && !hasIndependentStayDates(unit, input);
    if (!required && link.independentRequestEvidence == null) continue;
    const failure = independenceFailure(link.independentRequestEvidence, unit, link, input, history);
    if (failure) unitViolations.push({ unitId: unit.unitId, violation: {
      validationErrorCode: "UNDERSTANDING_SCHEMA_INVALID",
      fieldPath: `contextLinkCandidates.${index}.${failure.field}`,
      expected: failure.expected, actual: failure.actual
    } });
  }
  return unitViolations.length
    ? { code: "UNDERSTANDING_SCHEMA_INVALID", violation: unitViolations[0].violation, unitViolations }
    : null;
}

module.exports = { referenceableStayHistory, relationCompletenessFailure };
