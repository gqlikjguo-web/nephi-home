"use strict";
// Fixture declarations only: callers author requirements before corrupting a
// candidate. No provider wrapper, output inspection, source fallback or repair.
function fixtureSourceObligations(sourceEvents, requirements) {
  if (!Array.isArray(requirements)) throw new TypeError("explicit_fixture_requirements_required");
  const coverage = sourceEvents.flatMap(source => {
    const ids = requirements.filter(req => req.sourceEvidenceRefs.some(ref => ref.eventId === source.eventId
      && ref.messageRef === source.messageRef)).map(req => req.obligationId);
    const rows = [];
    for (let startOffset = 0; startOffset < source.messageText.length; startOffset += 500) {
      const endOffset = Math.min(startOffset + 500, source.messageText.length);
      rows.push({ source: { eventId: source.eventId, messageRef: source.messageRef, startOffset, endOffset,
        quote: source.messageText.slice(startOffset, endOffset) }, disposition: ids.length ? "required" : "background", obligationIds: ids });
    }
    return rows;
  });
  return structuredClone({ coverage, requirements });
}
module.exports = { fixtureSourceObligations };
