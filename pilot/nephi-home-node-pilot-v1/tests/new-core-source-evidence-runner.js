"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  validateAndNormalizeSourceEvidence
} = require("../lib/new-core/source-evidence-validator");

function reference(overrides = {}) {
  return {
    eventId: "event-1",
    messageRef: "message-1",
    startOffset: 0,
    endOffset: 4,
    quote: "需要停車",
    ...overrides
  };
}

function sourceEvents() {
  return [
    { eventId: "event-1", messageRef: "message-1", messageText: "需要停車資訊" },
    { eventId: "event-2", messageRef: "message-2", messageText: "另一個來源" }
  ];
}

function assertFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
}

function listNewCoreModules(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listNewCoreModules(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

// AC-EVD-001: exact same-source UTF-16 coordinates remain unchanged.
const exactRef = reference();
const exactBefore = JSON.parse(JSON.stringify(exactRef));
const exact = validateAndNormalizeSourceEvidence([exactRef], sourceEvents());
assert.equal(exact.ok, true);
assert.equal(exact.code, null);
assert.deepEqual(exact.value, [exactBefore]);
assert.deepEqual(exactRef, exactBefore, "validation never mutates provider-supplied evidence");

// AC-EVD-002: a coordinate mismatch relocates only to the unique exact quote
// in the identified source item.
const relocated = validateAndNormalizeSourceEvidence([
  reference({ startOffset: 0, endOffset: 1, quote: "停車" })
], sourceEvents());
assert.equal(relocated.ok, true);
assert.deepEqual(relocated.value, [reference({ startOffset: 2, endOffset: 4, quote: "停車" })]);

// AC-EVD-003: a repeated exact quote is not a safe relocation target.
assertFailure(validateAndNormalizeSourceEvidence([
  reference({ startOffset: 0, endOffset: 1, quote: "想住兩晚" })
], [{ eventId: "event-1", messageRef: "message-1", messageText: "想住兩晚，也想住兩晚" }]), "EVIDENCE_MATCH_AMBIGUOUS");

// AC-EVD-004..008: unknown sources, event/message disagreement, malformed
// ranges, non-matching quotes, and a quote from another event all fail closed.
assertFailure(validateAndNormalizeSourceEvidence([
  reference({ eventId: "missing-event" })
], sourceEvents()), "EVIDENCE_SOURCE_UNKNOWN");
assertFailure(validateAndNormalizeSourceEvidence([
  reference({ messageRef: "message-2" })
], sourceEvents()), "EVIDENCE_SCOPE_CONFLICT");
assertFailure(validateAndNormalizeSourceEvidence([
  reference({ startOffset: -1, endOffset: 2 })
], sourceEvents()), "EVIDENCE_RANGE_INVALID");
assertFailure(validateAndNormalizeSourceEvidence([
  reference({ startOffset: 0, endOffset: 4, quote: "不是停車" })
], sourceEvents()), "EVIDENCE_QUOTE_MISMATCH");
assertFailure(validateAndNormalizeSourceEvidence([
  reference({ quote: "另一個來源" })
], sourceEvents()), "EVIDENCE_QUOTE_MISMATCH");

// AC-EVD-009: JavaScript string offsets are UTF-16 code units, including a
// surrogate-pair emoji before the evidence quote.
const unicode = validateAndNormalizeSourceEvidence([
  reference({ startOffset: 2, endOffset: 5, quote: "😀兩" })
], [{ eventId: "event-1", messageRef: "message-1", messageText: "入住😀兩晚" }]);
assert.equal(unicode.ok, true);
assert.deepEqual(unicode.value, [reference({ startOffset: 2, endOffset: 5, quote: "😀兩" })]);

// AC-EVD-010: successful evidence is a detached deep-frozen validity record.
assert.equal(Object.isFrozen(exact.value), true);
assert.equal(Object.isFrozen(exact.value[0]), true);
assert.throws(() => { exact.value[0].quote = "mutated"; }, TypeError);
assert.equal(exact.value[0].quote, "需要停車");

// AC-MNT-003 / AC-MUT-001..004: C04 has exactly one coordinate-writing
// authority. Other new-core modules may validate/read coordinate names, but
// cannot construct or assign coordinate values.
const newCoreRoot = path.resolve(__dirname, "../lib/new-core");
const coordinateWriter = /\b(?:startOffset|endOffset)\s*(?::|=(?!=))/;
const unauthorizedWriters = listNewCoreModules(newCoreRoot)
  .filter((file) => path.basename(file) !== "source-evidence-validator.js")
  .filter((file) => coordinateWriter.test(fs.readFileSync(file, "utf8")));
assert.deepEqual(unauthorizedWriters, [], "only the C04 validator may write evidence coordinates");

console.log(JSON.stringify({
  suite: "new-core-source-evidence",
  classification: "STRUCTURED_CONTRACT_TEST",
  caseCount: 10,
  status: "PASS"
}));
