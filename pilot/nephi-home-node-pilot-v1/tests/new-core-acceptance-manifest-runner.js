"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_PATH = path.resolve(__dirname, "fixtures/new-core-acceptance-manifest.json");
const EVIDENCE_LEVELS = new Set([
  "UNIT_TEST",
  "STRUCTURED_CONTRACT_TEST",
  "FAKE_INTEGRATION",
  "RECORDED_REPRODUCTION",
  "RUNTIME_COMPONENT_TEST",
  "REAL_OPENAI_PLANNER",
  "REAL_POSTGRESQL_PROVIDER",
  "REAL_LINE",
  "REAL_RENDER_DEPLOYMENT"
]);

const EXPECTED_TEST_GROUPS = Object.freeze([
  ["AC-CON", 1, 4, "STRUCTURED_CONTRACT_TEST", ["DR-00"], ["C01"]],
  ["AC-WIR", 1, 8, "STRUCTURED_CONTRACT_TEST", ["DR-01"], ["C02"]],
  ["AC-EVD", 1, 10, "STRUCTURED_CONTRACT_TEST", ["DR-06"], ["C04"]],
  ["AC-SEM", 1, 15, "STRUCTURED_CONTRACT_TEST", ["DR-02", "DR-05"], ["C03"]],
  ["AC-RTE", 1, 20, "STRUCTURED_CONTRACT_TEST", ["DR-03"], ["C07"]],
  ["AC-FCL", 1, 9, "STRUCTURED_CONTRACT_TEST", ["DR-01"], ["C03", "C09"]],
  ["AC-AVL", 1, 10, "STRUCTURED_CONTRACT_TEST", ["DR-05", "DR-10"], ["C03", "C08"]],
  ["AC-PRI", 1, 8, "STRUCTURED_CONTRACT_TEST", ["DR-05", "DR-11"], ["C03", "C08"]],
  ["AC-TMP", 1, 12, "STRUCTURED_CONTRACT_TEST", ["DR-06", "DR-10"], ["C04", "C08"]],
  ["AC-RDY", 1, 10, "STRUCTURED_CONTRACT_TEST", ["DR-05"], ["C07"]],
  ["AC-FCT", 1, 14, "STRUCTURED_CONTRACT_TEST", ["DR-09", "DR-12"], ["C03", "C08"]],
  ["AC-LOC", 1, 6, "STRUCTURED_CONTRACT_TEST", ["DR-05", "DR-12"], ["C03", "C07"]],
  ["AC-NRP", 1, 12, "STRUCTURED_CONTRACT_TEST", ["DR-03"], ["C07", "C09"]],
  ["AC-CTX", 1, 18, "STRUCTURED_CONTRACT_TEST", ["DR-04", "DR-07"], ["C05", "C06"]],
  ["AC-LIF", 1, 18, "STRUCTURED_CONTRACT_TEST", ["DR-04"], ["C06"]],
  ["AC-PND", 1, 8, "STRUCTURED_CONTRACT_TEST", ["DR-07"], ["C05", "C06"]],
  ["AC-MUL", 1, 14, "STRUCTURED_CONTRACT_TEST", ["DR-02", "DR-08"], ["C03", "C09"]],
  ["AC-PAR", 1, 10, "STRUCTURED_CONTRACT_TEST", ["DR-08", "DR-09"], ["C09"]],
  ["AC-HOF", 1, 10, "STRUCTURED_CONTRACT_TEST", ["DR-03"], ["C07"]],
  ["AC-ISO", 1, 4, "STRUCTURED_CONTRACT_TEST", ["DR-12"], ["C01", "C08"]],
  ["AC-CAN", 1, 12, "STRUCTURED_CONTRACT_TEST", ["DR-09"], ["C08"]],
  ["AC-INT", 1, 6, "STRUCTURED_CONTRACT_TEST", ["DR-09", "DR-12"], ["C08", "C09"]],
  ["AC-OBS", 1, 12, "STRUCTURED_CONTRACT_TEST", ["DR-14"], ["C11"]],
  ["AC-SHD", 1, 10, "STRUCTURED_CONTRACT_TEST", ["DR-15"], ["C10"]],
  ["AC-MUT", 1, 6, "STRUCTURED_CONTRACT_TEST", ["DR-18"], ["C03", "C08"]],
  ["AC-MNT", 1, 10, "STRUCTURED_CONTRACT_TEST", ["DR-01", "DR-20"], ["C02", "C11"]],
  ["AC-ORC", 1, 6, "STRUCTURED_CONTRACT_TEST", ["DR-16", "DR-17"], ["C10", "C11"]],
  ["AC-ATT", 1, 2, "STRUCTURED_CONTRACT_TEST", ["DR-13"], ["C11"]],
  ["AC-OAI", 1, 3, "REAL_OPENAI_PLANNER", ["DR-13"], ["C02", "C10", "C11"]],
  ["AC-RBK", 1, 12, "STRUCTURED_CONTRACT_TEST", ["DR-19"], ["C04", "C05", "C06"]],
  ["AC-REG", 1, 1, "STRUCTURED_CONTRACT_TEST", ["DR-19"], ["C11"]],
  ["AC-113", 1, 1, "STRUCTURED_CONTRACT_TEST", ["DR-16", "DR-17"], ["C10", "C11"]],
  ["AC-PRD", 1, 5, "REAL_OPENAI_PLANNER", ["DR-13"], ["C02", "C11"]]
]);

function expandRange(value) {
  const match = /^([A-Z0-9-]+)-(\d{3})\.\.(\d{3})$/.exec(value);
  if (!match) return [value];
  const [, prefix, firstText, lastText] = match;
  const first = Number(firstText);
  const last = Number(lastText);
  if (last < first) return [];
  return Array.from({ length: last - first + 1 }, (_, offset) => `${prefix}-${String(first + offset).padStart(3, "0")}`);
}

function expectedTestGroups() {
  return EXPECTED_TEST_GROUPS.map(([prefix, first, last, evidenceLevel, ruleIds, contractIds]) => ({
    idRange: `${prefix}-${String(first).padStart(3, "0")}..${String(last).padStart(3, "0")}`,
    evidenceLevel,
    ruleIds,
    contractIds
  }));
}

function loadNewCoreAcceptanceManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function validateNewCoreAcceptanceManifest(manifest) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== 1) errors.push("manifest schemaVersion must equal 1");
  if (!Array.isArray(manifest.designRuleIds)) errors.push("manifest designRuleIds must be an array");
  if (!Array.isArray(manifest.contractIds)) errors.push("manifest contractIds must be an array");
  if (!Array.isArray(manifest.testGroups)) errors.push("manifest testGroups must be an array");
  if (errors.length) return errors;

  const ruleIds = new Set(manifest.designRuleIds);
  const contractIds = new Set(manifest.contractIds);
  const testIds = new Set();
  const duplicateIds = new Set();
  for (const testGroup of manifest.testGroups) {
    const allowedKeys = new Set(["idRange", "evidenceLevel", "evidence"]);
    for (const key of Object.keys(testGroup || {})) {
      if (!allowedKeys.has(key)) errors.push(`test group ${testGroup?.idRange || "<unknown>"} contains forbidden metadata field ${key}`);
    }
    if (!testGroup || typeof testGroup.idRange !== "string") {
      errors.push("test group idRange is required");
      continue;
    }
    const expandedIds = expandRange(testGroup.idRange);
    if (!expandedIds.length) errors.push(`test group ${testGroup.idRange} has an invalid range`);
    for (const id of expandedIds) {
      if (testIds.has(id)) duplicateIds.add(id);
      testIds.add(id);
    }
    if (!EVIDENCE_LEVELS.has(testGroup.evidenceLevel)) errors.push(`test group ${testGroup.idRange} has invalid evidence level`);
    if (!Array.isArray(testGroup.evidence) || !testGroup.evidence.length) {
      errors.push(`test group ${testGroup.idRange} is missing evidence links`);
      continue;
    }
    for (const evidence of testGroup.evidence) {
      if (!evidence || !EVIDENCE_LEVELS.has(evidence.evidenceLevel)) {
        errors.push(`test group ${testGroup.idRange} has evidence with an invalid evidence level`);
        continue;
      }
      if (evidence.evidenceLevel !== testGroup.evidenceLevel) {
        errors.push(`test group ${testGroup.idRange} claims ${testGroup.evidenceLevel} from ${evidence.evidenceLevel} evidence`);
      }
      for (const ruleId of evidence.ruleIds || []) if (!ruleIds.has(ruleId)) errors.push(`evidence references missing design rule ${ruleId}`);
      for (const contractId of evidence.contractIds || []) if (!contractIds.has(contractId)) errors.push(`evidence references missing contract ${contractId}`);
      const evidenceCaseIds = (evidence.caseIds || []).flatMap(expandRange);
      if (!evidenceCaseIds.length) errors.push(`test group ${testGroup.idRange} evidence is missing case IDs`);
      for (const caseId of evidenceCaseIds) if (!testIds.has(caseId)) errors.push(`evidence references missing acceptance case ${caseId}`);
    }
  }
  if (duplicateIds.size) errors.push(`duplicate acceptance IDs: ${[...duplicateIds].sort().join(", ")}`);

  const expectedGroups = expectedTestGroups();
  const expectedGroupByRange = new Map(expectedGroups.map((group) => [group.idRange, group]));
  for (const testGroup of manifest.testGroups) {
    const expectedGroup = expectedGroupByRange.get(testGroup?.idRange);
    if (expectedGroup && testGroup.evidenceLevel !== expectedGroup.evidenceLevel) {
      errors.push(`test group ${testGroup.idRange} must declare ${expectedGroup.evidenceLevel}`);
    }
  }
  const expectedIds = expectedGroups.flatMap((group) => expandRange(group.idRange));
  for (const expectedId of expectedIds) if (!testIds.has(expectedId)) errors.push(`missing acceptance ID ${expectedId}`);
  for (const actualId of testIds) if (!expectedIds.includes(actualId)) errors.push(`unexpected acceptance ID ${actualId}`);
  if (testIds.size !== 306) errors.push(`expanded acceptance ID count must equal 306, received ${testIds.size}`);
  return errors;
}

function run() {
  const manifest = loadNewCoreAcceptanceManifest();
  const errors = validateNewCoreAcceptanceManifest(manifest);
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log(JSON.stringify({
    suite: "new-core-acceptance-manifest",
    classification: "STRUCTURED_CONTRACT_TEST",
    acceptanceIdCount: 306,
    status: "PASS"
  }));
}

if (require.main === module) run();

module.exports = {
  EXPECTED_TEST_GROUPS,
  expandRange,
  loadNewCoreAcceptanceManifest,
  validateNewCoreAcceptanceManifest
};
