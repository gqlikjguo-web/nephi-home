"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  CASES,
  buildCaseInput,
  classifyRun,
  summarizeCase,
  validateRunConfiguration
} = require("../scripts/run-new-core-openai-shadow-acceptance");

const expected = {
  "AC-PRD-001": "好",
  "AC-PRD-002": "了解，謝謝您",
  "AC-PRD-003": "有開車,感謝留車位, 我們只有四位,謝謝!!",
  "AC-PRD-004": "你好 想問明年二月的4～7 有開放訂房了嗎",
  "AC-PRD-005": "想了解包棟的",
  "AC-OAI-001": "好的，謝謝您",
  "AC-OAI-002": "請問 2026/10/09 到 10/10 包棟還可以預訂嗎？",
  "AC-OAI-003": "想了解包棟價格"
};

assert.deepEqual(Object.fromEntries(CASES.map((item) => [item.id, item.input])), expected);
assert.equal(CASES.every((item) => item.minimumAcceptedRuns === 5), true);
assert.deepEqual(validateRunConfiguration({ apiKey: "secret", coreSha: "a".repeat(40) }), {
  minimumAcceptedCalls: 40,
  requestedModel: "gpt-5.6-luna",
  coreSha: "a".repeat(40)
});
assert.throws(() => validateRunConfiguration({ apiKey: "" }), /OPENAI_TEST_API_KEY_REQUIRED/);
assert.throws(() => validateRunConfiguration({ apiKey: "secret", coreSha: "bad" }), /TASK14_CORE_SHA_REQUIRED/);

const source = fs.readFileSync(path.resolve(__dirname, "../scripts/run-new-core-openai-shadow-acceptance.js"), "utf8");
assert.equal(source.includes("process.env.OPENAI_MODEL"), false);
assert.equal(source.includes("process.env.JUNZAN_OPENAI_MODEL"), false);
assert.equal(source.includes("gpt-4.1-mini"), false);

const followUp = buildCaseInput(CASES.find((item) => item.id === "AC-PRD-005"), 1);
assert.equal(followUp.recentConversation.some((item) => item.messageText === expected["AC-PRD-004"]), true);
assert.equal(followUp.referenceableCycles.some((item) => item.requestCycleId === "cycle-prd-004"), true);

const baseRun = {
  caseId: "AC-PRD-001", runNumber: 1,
  requestedModel: "gpt-5.6-luna", resolvedModel: "gpt-5.6-luna",
  semanticShape: "acknowledgement|null|null|false|NONE|NO_REPLY|0",
  rawUnits: [{ purpose: "acknowledgement", capability: null, subjectKind: null, stayDependent: false, safetyCandidate: null }],
  units: [{ purpose: "acknowledgement", capability: null, subjectKind: null, stayDependent: false, contextAction: "NONE", lifecycle: "NONE", replyDisposition: "NO_REPLY", c08Owned: false }],
  failureCodes: [], c11Markers: ["C02_UNDERSTANDING_RECEIVED", "C03_SEMANTIC_UNIT_VALIDATED", "C09_AGGREGATION_VALIDATED"],
  sideEffectCounters: { stateWrites: 0, messageWrites: 0, reviewWrites: 0, resolverCalls: 0, postgresMutations: 0, lineCalls: 0 },
  propertyIsolation: true
};
assert.deepEqual(classifyRun(CASES[0], baseRun), { accepted: true, classification: "PASS", plainReason: "產品語意與安全處理符合預期" });
assert.equal(classifyRun(CASES[0], { ...baseRun, resolvedModel: "other" }).classification, "MODEL_IDENTITY_MISMATCH");
assert.equal(classifyRun(CASES[0], { ...baseRun, rawUnits: [{ ...baseRun.rawUnits[0], purpose: "unknown" }] }).classification, "OPENAI_UNDERSTANDING_ERROR");
assert.equal(classifyRun(CASES[0], { ...baseRun, units: [], failureCodes: ["CATALOG_IDENTITY_INVALID"] }).classification, "CONTRACT_TOO_NARROW");

const summary = summarizeCase(CASES[0], Array.from({ length: 5 }, (_, index) => ({ ...baseRun, runNumber: index + 1 })));
assert.equal(summary.status, "PASS");
assert.equal(summary.acceptedLunaRuns, 5);
for (const field of ["INPUT", "OPENAI_UNDERSTANDING", "JUNZAN_ACTION", "EXPECTED_PRODUCT_BEHAVIOR", "ACTUAL_PRODUCT_BEHAVIOR", "RESULT", "FAIL_REASON_PLAIN_LANGUAGE"]) {
  assert.equal(Object.hasOwn(summary.humanReview, field), true, field);
}

console.log(JSON.stringify({ suite: "new-core-openai-shadow-acceptance-contract", classification: "STRUCTURED_CONTRACT_TEST", caseCount: 18, status: "PASS" }));
