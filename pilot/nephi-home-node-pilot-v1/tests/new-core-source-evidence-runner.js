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

function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;
  const punctuators = ["===", "!==", "**=", "&&=", "||=", "??=", ">>>=", "<<=", ">>=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "++", "--", "=>"];
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) { index += 1; continue; }
    if (source.startsWith("//", index)) {
      index = source.indexOf("\n", index + 2);
      if (index < 0) break;
      continue;
    }
    if (source.startsWith("/*", index)) {
      index = source.indexOf("*/", index + 2);
      if (index < 0) break;
      index += 2;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      let value = "";
      let dynamic = false;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (quote === "`" && source.startsWith("${", index)) dynamic = true;
        if (source[index] === "\\") {
          value += source[index + 1] || "";
          index += 2;
        } else {
          value += source[index];
          index += 1;
        }
      }
      index += 1;
      tokens.push({ type: dynamic ? "dynamic" : "string", value });
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      tokens.push({ type: "identifier", value: source.slice(start, index) });
      continue;
    }
    const punctuator = punctuators.find((candidate) => source.startsWith(candidate, index));
    tokens.push({ type: "punctuator", value: punctuator || character });
    index += (punctuator || character).length;
  }
  return tokens;
}

function matchingToken(tokens, start, open, close) {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    if (tokens[index].value === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function staticPropertyName(tokens, constants = new Map()) {
  if (tokens.length === 1) {
    if (tokens[0].type === "string") return tokens[0].value;
    if (tokens[0].type === "identifier") return constants.get(tokens[0].value);
    return undefined;
  }
  if (tokens.length % 2 === 1 && tokens.every((token, index) => index % 2 === 1
    ? token.value === "+"
    : token.type === "string")) {
    return tokens.filter((_, index) => index % 2 === 0).map((token) => token.value).join("");
  }
  return undefined;
}

function staticStringConstants(tokens) {
  const constants = new Map();
  for (let index = 0; index < tokens.length - 3; index += 1) {
    if (tokens[index].value !== "const" || tokens[index + 1].type !== "identifier"
      || tokens[index + 2].value !== "=") continue;
    const end = tokens.findIndex((token, candidateIndex) => candidateIndex > index + 2 && token.value === ";");
    const value = staticPropertyName(tokens.slice(index + 3, end < 0 ? tokens.length : end), constants);
    if (value !== undefined) constants.set(tokens[index + 1].value, value);
  }
  return constants;
}

function isAssignmentOrIncrement(tokens, memberEnd, memberStart) {
  const next = tokens[memberEnd + 1] && tokens[memberEnd + 1].value;
  if (["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "&&=", "||=", "??=", "**=", "<<=", ">>=", ">>>=", "++", "--"].includes(next)) return true;
  return tokens.slice(Math.max(0, memberStart - 3), memberStart).some((token) => token.value === "++" || token.value === "--");
}

function callArgument(tokens, openIndex, argumentIndex) {
  let depth = 0;
  let currentArgument = 0;
  let start = openIndex + 1;
  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index].value === "(") depth += 1;
    if (tokens[index].value === ")") {
      if (depth === 0) return currentArgument === argumentIndex ? tokens.slice(start, index) : [];
      depth -= 1;
    }
    if (tokens[index].value === "," && depth === 0) {
      if (currentArgument === argumentIndex) return tokens.slice(start, index);
      currentArgument += 1;
      start = index + 1;
    }
  }
  return [];
}

function definePropertyOpenIndex(tokens, index, constants) {
  if (tokens[index].value !== "Object" && tokens[index].value !== "Reflect") return -1;
  if (tokens[index + 1] && tokens[index + 1].value === "."
    && tokens[index + 2] && tokens[index + 2].value === "defineProperty"
    && tokens[index + 3] && tokens[index + 3].value === "(") return index + 3;
  if (tokens[index + 1] && tokens[index + 1].value === "[") {
    const closeIndex = matchingToken(tokens, index + 1, "[", "]");
    if (closeIndex > index + 1
      && staticPropertyName(tokens.slice(index + 2, closeIndex), constants) === "defineProperty"
      && tokens[closeIndex + 1] && tokens[closeIndex + 1].value === "(") return closeIndex + 1;
  }
  return -1;
}

function findUnauthorizedEvidenceCoordinateWrites(source) {
  const tokens = tokenizeJavaScript(source);
  const constants = staticStringConstants(tokens);
  const coordinateNames = new Set(["startOffset", "endOffset"]);
  const writes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (coordinateNames.has(tokens[index].value) && tokens[index + 1] && tokens[index + 1].value === ":") {
      writes.push(`object:${tokens[index].value}`);
    }
    if (tokens[index].value === "." && coordinateNames.has(tokens[index + 1] && tokens[index + 1].value)
      && isAssignmentOrIncrement(tokens, index + 1, index - 1)) {
      writes.push(`dot:${tokens[index + 1].value}`);
    }
    if (tokens[index].value === "[") {
      const closeIndex = matchingToken(tokens, index, "[", "]");
      if (closeIndex > index && isAssignmentOrIncrement(tokens, closeIndex, index - 1)) {
        const propertyName = staticPropertyName(tokens.slice(index + 1, closeIndex), constants);
        if (propertyName === undefined || coordinateNames.has(propertyName)) {
          writes.push(`computed:${propertyName || "dynamic"}`);
        }
      }
    }
    const openIndex = definePropertyOpenIndex(tokens, index, constants);
    if (openIndex >= 0) {
      const propertyName = staticPropertyName(callArgument(tokens, openIndex, 1), constants);
      if (propertyName === undefined || coordinateNames.has(propertyName)) {
        writes.push(`defineProperty:${propertyName || "dynamic"}`);
      }
    }
  }
  return writes;
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
const coordinateWriterBypassProbes = [
  "const replacement = { startOffset: 1 };",
  "candidate.startOffset = 1;",
  "candidate[\"endOffset\"] = 2;",
  "candidate[`start${\"\"}Offset`] = 3;",
  "candidate[\"start\" + \"Offset\"]++;",
  "const offsetKey = \"endOffset\"; candidate[offsetKey] += 1;",
  "Object.defineProperty(candidate, \"startOffset\", { value: 1 });",
  "Object[\"define\" + \"Property\"](candidate, \"endOffset\", { value: 2 });",
  "Reflect.defineProperty(candidate, \"endOffset\", { value: 2 });"
];
for (const probe of coordinateWriterBypassProbes) {
  assert.equal(findUnauthorizedEvidenceCoordinateWrites(probe).length, 1, `static gate must reject ${probe}`);
}
const unauthorizedWriters = listNewCoreModules(newCoreRoot)
  .filter((file) => !["source-evidence-validator.js", "production-safe-trace.js"].includes(path.basename(file)))
  .flatMap((file) => findUnauthorizedEvidenceCoordinateWrites(fs.readFileSync(file, "utf8"))
    .map((write) => `${file}:${write}`));
assert.deepEqual(unauthorizedWriters, [], "only the C04 validator may write evidence coordinates");
assert.equal(findUnauthorizedEvidenceCoordinateWrites(
  fs.readFileSync(path.join(newCoreRoot, "production-safe-trace.js"), "utf8")
).every((write) => write === "object:startOffset" || write === "object:endOffset"), true,
"the trace-only exception may only copy explicit evidence coordinate fields");

// Direct callers may pass provider metadata before the C04 wire validator has
// rejected it. C04 output must detach before freezing, never freeze provider
// objects that the caller still owns.
const nestedProviderMetadata = { provenance: { model: "untrusted" } };
const directInput = reference({ providerMetadata: nestedProviderMetadata });
const direct = validateAndNormalizeSourceEvidence([directInput], sourceEvents());
assert.equal(direct.ok, true);
assert.notEqual(direct.value[0].providerMetadata, nestedProviderMetadata);
assert.notEqual(direct.value[0].providerMetadata.provenance, nestedProviderMetadata.provenance);
assert.equal(Object.isFrozen(nestedProviderMetadata), false);
assert.equal(Object.isFrozen(nestedProviderMetadata.provenance), false);
assert.equal(Object.isFrozen(direct.value[0].providerMetadata), true);
assert.equal(Object.isFrozen(direct.value[0].providerMetadata.provenance), true);

console.log(JSON.stringify({
  suite: "new-core-source-evidence",
  classification: "STRUCTURED_CONTRACT_TEST",
  caseCount: 10,
  status: "PASS"
}));
