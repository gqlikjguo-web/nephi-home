"use strict";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function detach(value, seen = new Map()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  Object.keys(value).forEach((key) => {
    copy[key] = detach(value[key], seen);
  });
  return copy;
}

function failure(code) {
  return { ok: false, code, errors: [] };
}

function sourceFor(reference, sourceEvents) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    return { code: "EVIDENCE_RANGE_INVALID" };
  }
  const events = Array.isArray(sourceEvents) ? sourceEvents : [];
  const matchingEventIds = events.filter((event) => event && event.eventId === reference.eventId);
  const matchingMessageRefs = events.filter((event) => event && event.messageRef === reference.messageRef);
  if (matchingEventIds.length === 0 || matchingMessageRefs.length === 0) {
    return { code: "EVIDENCE_SOURCE_UNKNOWN" };
  }
  const matchingSource = matchingEventIds.filter((event) => event.messageRef === reference.messageRef);
  return matchingSource.length === 1
    ? { source: matchingSource[0] }
    : { code: "EVIDENCE_SCOPE_CONFLICT" };
}

function quoteOccurrences(messageText, quote) {
  const occurrences = [];
  let from = 0;
  while (from <= messageText.length - quote.length) {
    const startOffset = messageText.indexOf(quote, from);
    if (startOffset < 0) break;
    occurrences.push(startOffset);
    from = startOffset + 1;
  }
  return occurrences;
}

function validateReference(reference, sourceEvents) {
  const resolved = sourceFor(reference, sourceEvents);
  if (resolved.code) return failure(resolved.code);

  const { source } = resolved;
  const messageText = source.messageText;
  const syntacticallyValidRange = Number.isInteger(reference.startOffset)
    && Number.isInteger(reference.endOffset)
    && reference.startOffset >= 0
    && reference.endOffset >= reference.startOffset;
  if (!syntacticallyValidRange || typeof reference.quote !== "string" || reference.quote.length === 0) {
    return failure("EVIDENCE_RANGE_INVALID");
  }
  if (typeof messageText !== "string") return failure("EVIDENCE_QUOTE_MISMATCH");

  const rangeInSource = reference.endOffset <= messageText.length;
  if (rangeInSource && messageText.slice(reference.startOffset, reference.endOffset) === reference.quote) {
    return { ok: true, value: { ...reference } };
  }

  const matches = quoteOccurrences(messageText, reference.quote);
  if (matches.length === 1) {
    const startOffset = matches[0];
    return {
      ok: true,
      value: {
        ...reference,
        startOffset,
        endOffset: startOffset + reference.quote.length
      }
    };
  }
  if (matches.length > 1) return failure("EVIDENCE_MATCH_AMBIGUOUS");
  return failure(rangeInSource ? "EVIDENCE_QUOTE_MISMATCH" : "EVIDENCE_RANGE_INVALID");
}

function validateAndNormalizeSourceEvidence(refs, sourceEvents) {
  if (!Array.isArray(refs) || refs.length === 0) return failure("EVIDENCE_RANGE_INVALID");
  const validatedRefs = [];
  for (const reference of refs) {
    const validated = validateReference(reference, sourceEvents);
    if (!validated.ok) return validated;
    validatedRefs.push(validated.value);
  }
  return {
    ok: true,
    code: null,
    errors: [],
    value: deepFreeze(detach(validatedRefs))
  };
}

module.exports = { validateAndNormalizeSourceEvidence };
