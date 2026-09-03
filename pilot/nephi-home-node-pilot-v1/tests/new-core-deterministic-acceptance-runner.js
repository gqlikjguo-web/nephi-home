"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  expandRange,
  loadNewCoreAcceptanceManifest
} = require("./new-core-acceptance-manifest-runner");

const ROOT = path.resolve(__dirname, "..");
const MAP_PATH = path.resolve(__dirname, "fixtures/new-core-deterministic-acceptance-map.json");
const ALLOWED_CLASSIFICATIONS = new Set([
  "UNIT_TEST",
  "STRUCTURED_CONTRACT_TEST",
  "FAKE_INTEGRATION",
  "RECORDED_REPRODUCTION",
  "RUNTIME_COMPONENT_TEST",
  "TEST_ONLY_EVIDENCE"
]);
const PRIMARY_RUNNERS = Object.freeze({
  "AC-CON": ["node tests/new-core-turn-input-contract-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-WIR": ["node tests/new-core-wire-schema-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-EVD": ["node tests/new-core-source-evidence-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-SEM": ["node tests/new-core-semantic-unit-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-RTE": ["node tests/new-core-unit-routing-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-FCL": ["node tests/new-core-observability-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-AVL": ["node tests/new-core-canonical-adapter-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-PRI": ["node tests/new-core-canonical-adapter-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-TMP": ["node tests/new-core-canonical-adapter-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-RDY": ["node tests/new-core-unit-routing-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-FCT": ["node tests/new-core-semantic-unit-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-LOC": ["node tests/new-core-semantic-unit-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-NRP": ["node tests/new-core-unit-routing-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-CTX": ["node tests/new-core-context-lifecycle-runner.js", "RUNTIME_COMPONENT_TEST"],
  "AC-LIF": ["node tests/new-core-context-lifecycle-runner.js", "RUNTIME_COMPONENT_TEST"],
  "AC-PND": ["node tests/new-core-context-lifecycle-runner.js", "RUNTIME_COMPONENT_TEST"],
  "AC-MUL": ["node tests/new-core-unit-aggregation-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-PAR": ["node tests/new-core-unit-aggregation-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-HOF": ["node tests/new-core-unit-routing-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-ISO": ["node tests/new-core-turn-input-contract-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-CAN": ["node tests/new-core-canonical-adapter-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-INT": ["node tests/phase6-final-decision-runner.js", "RUNTIME_COMPONENT_TEST"],
  "AC-OBS": ["node tests/new-core-observability-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-SHD": ["node tests/new-core-shadow-isolation-runner.js", "FAKE_INTEGRATION"],
  "AC-MUT": ["node tests/new-core-maintainability-gates-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-MNT": ["node tests/new-core-maintainability-gates-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-ORC": ["node tests/new-core-acceptance-manifest-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-ATT": ["node tests/new-core-observability-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-RBK": ["node tests/new-core-maintainability-gates-runner.js", "STRUCTURED_CONTRACT_TEST"],
  "AC-REG": ["node tests/conversation-engine-v2-runner.js", "RUNTIME_COMPONENT_TEST"],
  "AC-113": ["node tests/real-guest-deployed-acceptance-matrix-runner.js", "TEST_ONLY_EVIDENCE"]
});
const COMMAND_PATTERN = /^node tests\/[a-z0-9-]+-runner\.js$/;

function loadAcceptanceMap(mapPath = MAP_PATH) {
  return JSON.parse(fs.readFileSync(mapPath, "utf8"));
}

function deterministicAcceptanceIds(manifest) {
  return manifest.testGroups
    .filter((group) => group.requiredEvidenceLevel !== "REAL_OPENAI_PLANNER")
    .flatMap((group) => expandRange(group.idRange));
}

function validateAcceptanceMap(manifest, acceptanceMap) {
  const expectedIds = deterministicAcceptanceIds(manifest);
  const expectedSet = new Set(expectedIds);
  const covered = new Set();
  const errors = [];
  if (!acceptanceMap || acceptanceMap.schemaVersion !== 1 || !Array.isArray(acceptanceMap.groups)) {
    return ["deterministic acceptance map shape invalid"];
  }
  for (const group of acceptanceMap.groups) {
    if (!group || typeof group !== "object" || Array.isArray(group)
      || Object.keys(group).some((key) => !["idRange", "classification", "primaryCommand", "supportingCommands"].includes(key))) {
      errors.push("deterministic acceptance group shape invalid");
      continue;
    }
    if (!ALLOWED_CLASSIFICATIONS.has(group.classification)) {
      errors.push(`${group.idRange} has invalid deterministic classification`);
    }
    const prefixMatch = /^(AC-(?:[A-Z]+|113))-/.exec(group.idRange);
    const expectedPrimary = prefixMatch && PRIMARY_RUNNERS[prefixMatch[1]];
    if (!expectedPrimary || group.primaryCommand !== expectedPrimary[0]) {
      errors.push(`${group.idRange} primary evidence runner mismatch`);
    }
    if (expectedPrimary && group.classification !== expectedPrimary[1]) {
      errors.push(`${group.idRange} classification mismatch`);
    }
    if (typeof group.primaryCommand !== "string" || !COMMAND_PATTERN.test(group.primaryCommand)
      || !Array.isArray(group.supportingCommands)
      || group.supportingCommands.some((command) => typeof command !== "string" || !COMMAND_PATTERN.test(command))
      || new Set([group.primaryCommand, ...group.supportingCommands]).size !== group.supportingCommands.length + 1) {
      errors.push(`${group.idRange} has invalid deterministic commands`);
    }
    for (const id of expandRange(group.idRange)) {
      if (!expectedSet.has(id)) errors.push(`unexpected deterministic acceptance ID ${id}`);
      if (covered.has(id)) errors.push(`duplicate deterministic acceptance ID ${id}`);
      covered.add(id);
    }
  }
  for (const id of expectedIds) if (!covered.has(id)) errors.push(`missing deterministic acceptance ID ${id}`);
  if (covered.size !== expectedIds.length) {
    errors.push(`deterministic acceptance count must equal ${expectedIds.length}, received ${covered.size}`);
  }
  return errors;
}

function executeMappedRunners(acceptanceMap) {
  const commands = [...new Set(acceptanceMap.groups.flatMap((group) => [group.primaryCommand, ...group.supportingCommands]))];
  const results = [];
  for (const command of commands) {
    const [executable, ...args] = command.split(" ");
    const result = spawnSync(executable, args, { cwd: ROOT, encoding: "utf8" });
    results.push({
      command,
      exitCode: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    });
    if (result.status !== 0) {
      const error = new Error(`deterministic acceptance runner failed: ${command}`);
      error.result = results.at(-1);
      throw error;
    }
  }
  return results;
}

function assertMapMutationCoverage(manifest, acceptanceMap) {
  const extraAssociation = structuredClone(acceptanceMap);
  extraAssociation.groups[0].primaryCommand = "node tests/new-core-wire-schema-runner.js";
  assert.ok(
    validateAcceptanceMap(manifest, extraAssociation).some((error) => error.includes("primary evidence")),
    "one acceptance ID must not silently acquire a second primary runner"
  );

  const falseClassification = structuredClone(acceptanceMap);
  falseClassification.groups[0].classification = "RECORDED_REPRODUCTION";
  assert.ok(
    validateAcceptanceMap(manifest, falseClassification).some((error) => error.includes("classification mismatch")),
    "a mapped runner classification must not be relabeled to another allowlisted evidence level"
  );
}

function run() {
  const manifest = loadNewCoreAcceptanceManifest();
  const acceptanceMap = loadAcceptanceMap();
  const errors = validateAcceptanceMap(manifest, acceptanceMap);
  assert.deepEqual(errors, [], errors.join("\n"));
  assertMapMutationCoverage(manifest, acceptanceMap);
  const results = executeMappedRunners(acceptanceMap);
  const resultByCommand = new Map(results.map((result) => [result.command, result]));
  const acceptanceResults = acceptanceMap.groups.flatMap((group) => expandRange(group.idRange).map((acceptanceId) => ({
    acceptanceId,
    classification: group.classification,
    primaryCommand: group.primaryCommand,
    primaryExitCode: resultByCommand.get(group.primaryCommand).exitCode,
    supportingResults: group.supportingCommands.map((command) => ({
      command,
      exitCode: resultByCommand.get(command).exitCode
    }))
  })));
  console.log(JSON.stringify({
    suite: "new-core-deterministic-acceptance",
    classification: "STRUCTURED_CONTRACT_TEST",
    acceptanceIdCount: deterministicAcceptanceIds(manifest).length,
    runnerCount: results.length,
    acceptanceResults,
    results,
    status: "PASS"
  }));
}

if (require.main === module) run();

module.exports = {
  deterministicAcceptanceIds,
  executeMappedRunners,
  loadAcceptanceMap,
  validateAcceptanceMap
};
