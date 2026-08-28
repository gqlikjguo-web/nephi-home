"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  verifyNewCoreMaintainability
} = require("./support/new-core-maintainability-inspector");

const projectRoot = path.resolve(__dirname, "..");
const ownershipPath = path.join(projectRoot, "docs", "new-core-contract-ownership.json");

// SUPPLEMENTAL: structural lookalikes never acquire private producer authority.
const lookalike = Object.freeze({ unitId: "unit-lookalike", status: "VALIDATED" });
assert.equal(require("../lib/new-core/semantic-unit-validator").isValidatedSemanticUnitFor({}, lookalike), false);
assert.equal(require("../lib/new-core/context-link-validator").isValidatedContextLinkFor(lookalike, lookalike), false);
assert.equal(require("../lib/new-core/lifecycle-manager").isValidatedLifecycleDecision(lookalike), false);
assert.equal(require("../lib/new-core/unit-reply-router").isTrustedUnitRoutingDecision(lookalike), false);
assert.equal(require("../lib/new-core/state-v3-lifecycle-adapter").isStateV3LifecycleOperationsFor([lookalike], {}), false);

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

function isolatedSource(mutator) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-task10-maintainability-"));
  const sourceRoot = path.join(root, "lib", "new-core");
  copyDirectory(path.join(projectRoot, "lib"), path.join(root, "lib"));
  mutator({ root, sourceRoot });
  return root;
}

function gate(root = projectRoot, manifestPath = ownershipPath) {
  return verifyNewCoreMaintainability({ projectRoot: root, manifestPath });
}

function assertGateFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.equal(typeof result.file, "string");
  assert.equal(result.file.startsWith("/"), false, "gate findings must use bounded relative paths");
  assert.equal(Object.hasOwn(result, "source"), false, "gate must not reflect source text");
}

// AC-MNT-001: every C01-C11 contract has exactly one declared writer,
// validator, named consumer list, boundary marker, and failure-code owner.
const clean = gate();
assert.equal(clean.ok, true, JSON.stringify(clean));
assert.deepEqual(clean.contractIds, ["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C09", "C10", "C11"]);
assert.equal(clean.validatorCoverage.implemented, 10, "C01-C09 and C11 validators must exist at Task 10");
assert.deepEqual(clean.validatorCoverage.planned, [{ contractId: "C10", task: 12 }]);
const sealedConsumers = {
  C01: ["OpenAI Understanding V1"],
  C02: ["Source Evidence Validator"],
  C03: ["Context Link Validator", "Per-unit Reply Router"],
  C04: ["Semantic Unit Validator", "Context Link Validator", "Diagnostic Boundary Emitter"],
  C05: ["Lifecycle Manager"],
  C06: ["State V3 Lifecycle Adapter", "Unit Aggregator"],
  C07: ["Unit Aggregator", "Canonical Execution Adapter"],
  C08: ["Official canonicalizer"],
  C09: ["Existing execution orchestration", "FinalDecision input adapter"],
  C10: ["Offline acceptance and reporting"],
  C11: ["Existing safe diagnostic persistence", "Acceptance attribution"]
};
const ownershipManifest = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
for (const contract of ownershipManifest.contracts) {
  assert.deepEqual(contract.consumers.map((consumer) => consumer.name), sealedConsumers[contract.contractId]);
}

// AC-MNT-002: recursive inspection sees duplicate writers hidden in nested files
// and computed CommonJS exports, while ignoring strings/comments.
const duplicateWriterRoot = isolatedSource(({ sourceRoot }) => {
  const nested = path.join(sourceRoot, "nested", "duplicate-writer.js");
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, `
    // buildUnderstandingTurnInput in a comment is not a writer.
    const harmless = "buildUnderstandingTurnInput";
    function duplicateTurnWriter() { return {}; }
    module["exports"]["build" + "UnderstandingTurnInput"] = duplicateTurnWriter;
  `);
});
assertGateFailure(gate(duplicateWriterRoot), "DUPLICATE_CONTRACT_WRITER");
const assignedWriterRoot = isolatedSource(({ sourceRoot }) => {
  const nested = path.join(sourceRoot, "nested", "assigned-writer.js");
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, `
    function alternateTurnWriter() { return {}; }
    Object.assign(module.exports, { buildUnderstandingTurnInput: alternateTurnWriter });
  `);
});
assertGateFailure(gate(assignedWriterRoot), "DUPLICATE_CONTRACT_WRITER");
const definedWriterRoot = isolatedSource(({ sourceRoot }) => {
  const nested = path.join(sourceRoot, "nested", "defined-writer.js");
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, `
    function alternateTurnWriter() { return {}; }
    Object.defineProperty(module.exports, "buildUnderstandingTurnInput", { value: alternateTurnWriter });
  `);
});
assertGateFailure(gate(definedWriterRoot), "DUPLICATE_CONTRACT_WRITER");
const alternateExtensionRoot = isolatedSource(({ sourceRoot }) => {
  const nested = path.join(sourceRoot, "nested", "alternate-writer.cjs");
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, `
    function alternateTurnWriter() { return {}; }
    module.exports.buildUnderstandingTurnInput = alternateTurnWriter;
  `);
});
assertGateFailure(gate(alternateExtensionRoot), "DUPLICATE_CONTRACT_WRITER");

// AC-MNT-003: duplicate failure-code ownership fails even when the JSON remains valid.
const duplicateFailureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-task10-failure-owner-"));
copyDirectory(path.join(projectRoot, "lib"), path.join(duplicateFailureRoot, "lib"));
fs.mkdirSync(path.join(duplicateFailureRoot, "docs"), { recursive: true });
const duplicateFailureManifest = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
duplicateFailureManifest.contracts.find((entry) => entry.contractId === "C03").failureCodes.push("EVIDENCE_QUOTE_MISMATCH");
const duplicateFailurePath = path.join(duplicateFailureRoot, "docs", "ownership.json");
fs.writeFileSync(duplicateFailurePath, JSON.stringify(duplicateFailureManifest));
assertGateFailure(gate(duplicateFailureRoot, duplicateFailurePath), "DUPLICATE_FAILURE_CODE_OWNER");

// AC-MNT-004: one function cannot combine raw-language interpretation with
// routing/state/canonical authority (a god function), regardless of nesting.
const godFunctionRoot = isolatedSource(({ sourceRoot }) => {
  const nested = path.join(sourceRoot, "deep", "deeper", "god-function.js");
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, `
    function decideEverything(messageText) {
      if (messageText.includes("parking")) {
        return createUnitRoutingDecision({ capability: "property_fact" });
      }
      return executeCanonicalizerInputItem({});
    }
    module.exports = { decideEverything };
  `);
});
assertGateFailure(gate(godFunctionRoot), "GOD_FUNCTION_FORBIDDEN");
const classGodFunctionRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "class-god-function.js"), `
    class TurnGod {
      decide(messageText) {
        if (messageText.includes("parking")) return createUnitRoutingDecision({});
        return executeCanonicalizerInputItem({});
      }
    }
    module.exports = { TurnGod };
  `);
});
assertGateFailure(gate(classGodFunctionRoot), "GOD_FUNCTION_FORBIDDEN");

// AC-MNT-005: existing validators stay independently callable and no contract
// can silently drop its validator or consumer accounting.
const missingValidatorRoot = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-task10-validator-"));
copyDirectory(path.join(projectRoot, "lib"), path.join(missingValidatorRoot, "lib"));
fs.mkdirSync(path.join(missingValidatorRoot, "docs"), { recursive: true });
const missingValidatorManifest = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
const missingValidatorPath = path.join(missingValidatorRoot, "docs", "ownership.json");
fs.writeFileSync(missingValidatorPath, JSON.stringify(missingValidatorManifest));
const routeContractPath = path.join(missingValidatorRoot, "lib", "new-core", "contracts", "unit-routing-decision.js");
fs.writeFileSync(routeContractPath, fs.readFileSync(routeContractPath, "utf8").replace(
  "function validateUnitRoutingDecision(value)",
  "function removedRouteValidator(value)"
));
assertGateFailure(gate(missingValidatorRoot, missingValidatorPath), "CONTRACT_VALIDATOR_MISSING");
const unexportedConsumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-task10-consumer-"));
copyDirectory(path.join(projectRoot, "lib"), path.join(unexportedConsumerRoot, "lib"));
fs.mkdirSync(path.join(unexportedConsumerRoot, "docs"), { recursive: true });
const unexportedConsumerManifestPath = path.join(unexportedConsumerRoot, "docs", "ownership.json");
fs.writeFileSync(unexportedConsumerManifestPath, fs.readFileSync(ownershipPath));
const semanticValidatorPath = path.join(unexportedConsumerRoot, "lib", "new-core", "state-v3-lifecycle-adapter.js");
fs.writeFileSync(semanticValidatorPath, fs.readFileSync(semanticValidatorPath, "utf8").replace(
  "  adaptLifecycleDecisionsToStateV3,\n",
  ""
));
assertGateFailure(gate(unexportedConsumerRoot, unexportedConsumerManifestPath), "CONTRACT_CONSUMER_MISSING");
const wrongGraphManifest = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
wrongGraphManifest.contracts.find((entry) => entry.contractId === "C01").consumers[0].name = "Semantic Unit Validator";
const wrongGraphPath = path.join(missingValidatorRoot, "docs", "wrong-graph-ownership.json");
fs.writeFileSync(wrongGraphPath, JSON.stringify(wrongGraphManifest));
assertGateFailure(gate(missingValidatorRoot, wrongGraphPath), "CONTRACT_GRAPH_MISMATCH");
const traversalManifest = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
traversalManifest.contracts[0].writer.source = "../outside-writer.js";
const traversalPath = path.join(missingValidatorRoot, "docs", "traversal-ownership.json");
fs.writeFileSync(traversalPath, JSON.stringify(traversalManifest));
assertGateFailure(gate(missingValidatorRoot, traversalPath), "OWNERSHIP_MANIFEST_INVALID");

// AC-MNT-006: unbranded lookalikes are harmless metadata, not authorities.
const duplicateAuthorityCases = [
  ["semantic", "function shadowSemanticWriter(){ return { purpose: 'unknown', capability: null, subject: null, stayDependent: false }; }"],
  ["evidence", "function shadowEvidenceWriter(){ return { startOffset: 0, endOffset: 1, quote: 'x' }; }"],
  ["capability", "function shadowCapabilityWriter(){ return { requestKind: 'x', exactRequiredFields: [] }; }"],
  ["reply", "function shadowReplyWriter(){ return { disposition: 'NO_REPLY', requiresCanonicalExecution: false }; }"],
  ["context", "function shadowContextWriter(){ return { actionCandidate: 'NONE', targetRequestCycleId: null }; }"],
  ["facts", "function shadowFactsWriter(){ return { facts: [] }; }"],
  ["memory", "function shadowMemoryWriter(){ return { confirmedFields: {}, lifecycleOperations: [] }; }"],
];
for (const [name, source] of duplicateAuthorityCases) {
  const root = isolatedSource(({ sourceRoot }) => {
    fs.writeFileSync(path.join(sourceRoot, `shadow-${name}.js`), `${source}\nmodule.exports = {};\n`);
  });
  assert.equal(gate(root).ok, true, JSON.stringify(gate(root)));
}
const computedFactsRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-computed-facts.js"), `
    function shadowFactsWriter() {
      const result = {};
      result["fa" + "cts"] = [];
      return result;
    }
    module.exports = { shadowFactsWriter };
  `);
});
assert.equal(gate(computedFactsRoot).ok, true, JSON.stringify(gate(computedFactsRoot)));

// AC-MNT-007: candidateIndex is adapter-local C08 compatibility data only;
// constant-folded computed names are still visible to the gate.
const escapedIndexRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "escaped-index.js"), `
    const compatibility = {};
    compatibility["candidate" + "Index"] = 0;
    module.exports = compatibility;
  `);
});
assertGateFailure(gate(escapedIndexRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const reflectedIndexRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "reflected-index.js"), `
    const compatibility = {};
    Reflect.set(compatibility, "candidate" + "Index", 0);
    module.exports = compatibility;
  `);
});
assertGateFailure(gate(reflectedIndexRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const aliasedIndexRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "aliased-index.js"), `const key = "candidateIndex"; Reflect.set({}, key, 0);`);
});
assertGateFailure(gate(aliasedIndexRoot), "CANDIDATE_INDEX_OUTSIDE_C08");

// AC-MNT-008: diagnostics have one writer and are not a second persistence,
// Resolver, state, reply, or facts boundary.
const shadowSideEffectRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "diagnostic-side-effect.js"), `
    function persistDiagnostic(event) { database.insert(event); resolver(event); sendLine(event); }
    module.exports = { persistDiagnostic };
  `);
});
assertGateFailure(gate(shadowSideEffectRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const shadowClassSideEffectRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-runner.js"), `
    class ShadowRunner {
      run(event) {
        state.writeState(event);
        Resolver.resolveAvailability(event);
        LINE.replyMessage(event);
      }
    }
    module.exports = { ShadowRunner };
  `);
});
assertGateFailure(gate(shadowClassSideEffectRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const aliasedShadowRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-aliased.js"), `const db = database; const write = db.insert; function run(x) { write(x); } module.exports = { run };`);
});
assertGateFailure(gate(aliasedShadowRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");

// AC-MNT-009: the scanner is token-aware: comments, string literals, and
// innocent consumer names do not create false writer/authority findings.
const falsePositiveRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "nested-safe-consumer.js"), `
    // candidateIndex buildUnderstandingTurnInput facts lifecycleOperations
    const documentation = "candidateIndex facts createUnitRoutingDecision";
    function observeValidatedRoute(value) { return Boolean(value && value.ok); }
    module.exports = { observeValidatedRoute, documentation };
  `);
});
assert.equal(gate(falsePositiveRoot).ok, true, JSON.stringify(gate(falsePositiveRoot)));
const authorityMetadataRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "authority-metadata.js"), `
    const fieldDocumentation = {
      purpose: "wire field", capability: "wire field", subject: "wire field", stayDependent: "wire field",
      startOffset: "wire field", endOffset: "wire field", quote: "wire field",
      requestKind: "wire field", exactRequiredFields: "wire field",
      disposition: "wire field", requiresCanonicalExecution: "wire field",
      actionCandidate: "wire field", targetRequestCycleId: "wire field",
      facts: "wire field", confirmedFields: "wire field", lifecycleOperations: "wire field"
    };
    module.exports = { fieldDocumentation };
  `);
});
assert.equal(gate(authorityMetadataRoot).ok, true, JSON.stringify(gate(authorityMetadataRoot)));

// SUPPLEMENTAL: exact source/symbol ownership and the final-action authority are sealed.
const exactGraphManifest = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
exactGraphManifest.contracts.find((entry) => entry.contractId === "C02").writer.source = "lib/providers/alternate-understanding-v1.js";
const exactGraphPath = path.join(missingValidatorRoot, "docs", "exact-graph-ownership.json");
fs.writeFileSync(exactGraphPath, JSON.stringify(exactGraphManifest));
assertGateFailure(gate(missingValidatorRoot, exactGraphPath), "CONTRACT_GRAPH_MISMATCH");
assert.equal(ownershipManifest.domainAuthorities.some((entry) => entry.authority === "final_action"), true);

// SUPPLEMENTAL: failure ownership is exact and the frozen C06 code set remains complete.
assert.equal(typeof ownershipManifest.failureCodeOwners, "object");
for (const contract of ownershipManifest.contracts) {
  for (const code of contract.failureCodes) assert.equal(ownershipManifest.failureCodeOwners[code], contract.contractId);
}
assert.deepEqual(
  ownershipManifest.contracts.find((entry) => entry.contractId === "C06").failureCodes,
  ["LIFECYCLE_TARGET_REQUIRED", "LIFECYCLE_START_TARGET_FORBIDDEN", "LIFECYCLE_SLOT_UNVERIFIED", "LIFECYCLE_TRANSITION_INVALID", "LIFECYCLE_PROPERTY_CONFLICT"]
);
const wrongFailureOwnerManifest = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
wrongFailureOwnerManifest.failureCodeOwners.EVIDENCE_QUOTE_MISMATCH = "C03";
const wrongFailureOwnerPath = path.join(missingValidatorRoot, "docs", "wrong-failure-owner.json");
fs.writeFileSync(wrongFailureOwnerPath, JSON.stringify(wrongFailureOwnerManifest));
assertGateFailure(gate(missingValidatorRoot, wrongFailureOwnerPath), "FAILURE_CODE_OWNER_MISMATCH");
const markerManifest = JSON.parse(fs.readFileSync(ownershipPath, "utf8"));
markerManifest.contracts[0].diagnosticMarkers[0] = "C01_MUTATED";
const markerPath = path.join(missingValidatorRoot, "docs", "marker.json");
fs.writeFileSync(markerPath, JSON.stringify(markerManifest));
assertGateFailure(gate(missingValidatorRoot, markerPath), "CONTRACT_GRAPH_MISMATCH");
const removedImportRoot = isolatedSource(({ root }) => {
  const file = path.join(root, "lib", "new-core", "unit-aggregator.js");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('require("./lifecycle-manager")', 'require("./missing-lifecycle")'));
});
assertGateFailure(gate(removedImportRoot), "CONTRACT_CONSUMER_MISSING");
const missingAuthorityRoot = isolatedSource(({ root }) => {
  fs.unlinkSync(path.join(root, "lib", "conversation-engine-v2", "final-decision.js"));
});
assertGateFailure(gate(missingAuthorityRoot), "DOMAIN_AUTHORITY_REGISTRY_INVALID");

// AC-MNT-010: arbitrary files outside lib/new-core are not scanned and cannot
// make fixtures or old runtime into new-core authority.
const scopedRoot = isolatedSource(({ root }) => {
  const fixtures = path.join(root, "tests", "fixtures");
  fs.mkdirSync(fixtures, { recursive: true });
  fs.writeFileSync(path.join(fixtures, "fake-authority.js"), "module.exports = { candidateIndex: 0, facts: [] };\n");
});
assert.equal(gate(scopedRoot).ok, true, JSON.stringify(gate(scopedRoot)));

console.log("new core maintainability gates runner: PASS (12 STRUCTURED_CONTRACT_TEST cases)");
