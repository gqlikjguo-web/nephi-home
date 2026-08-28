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
const receiverMethodIndexRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "receiver-method-index.js"), `
    const receiver = Reflect;
    const method = "set";
    const field = "candidateIndex";
    receiver[method]({}, field, 0);
  `);
});
assertGateFailure(gate(receiverMethodIndexRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const nestedIndexAliasRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "nested-index-alias.js"), `
    const compatibility = { fields: { index: "candidateIndex" } };
    const reflectMethods = { mutation: { write: Reflect.set } };
    const receiver = reflectMethods.mutation;
    const write = receiver.write;
    write({}, compatibility["fields"].index, 0);
  `);
});
assertGateFailure(gate(nestedIndexAliasRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const assignedIndexAliasesRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "assigned-index-aliases.js"), `
    let receiver;
    let method;
    let field;
    receiver = Reflect;
    method = "set";
    field = "candidateIndex";
    receiver[method]({}, field, 0);
  `);
});
assertGateFailure(gate(assignedIndexAliasesRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const postCallIndexReassignmentRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "post-call-index-reassignment.js"), `
    let method = "set";
    let field = "candidateIndex";
    Reflect[method]({}, field, 0);
    method = "get";
    field = "other";
  `);
});
assertGateFailure(gate(postCallIndexReassignmentRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const deferredReassignmentIndexRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "deferred-reassignment-index.js"), `
    let field = "candidateIndex";
    function configureLater() {
      field = "other";
    }
    Reflect.set({}, field, 0);
    module.exports = { configureLater };
  `);
});
assertGateFailure(gate(deferredReassignmentIndexRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const destructuredAssignmentIndexRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "destructured-assignment-index.js"), `
    let write;
    ({ set: write } = Reflect);
    const field = "candidateIndex";
    write({}, field, 0);
  `);
});
assertGateFailure(gate(destructuredAssignmentIndexRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const computedDestructuredAssignmentIndexRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "computed-destructured-assignment-index.js"), `
    const operation = "set";
    let write;
    ({ [operation]: write } = Reflect);
    const field = "candidateIndex";
    write({}, field, 0);
  `);
});
assertGateFailure(gate(computedDestructuredAssignmentIndexRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const conditionalIndexAliasRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "conditional-index-alias.js"), `
    let field = "other";
    if (process.env.USE_COMPATIBILITY_FIELD) {
      field = "candidateIndex";
    }
    Reflect.set({}, field, 0);
  `);
});
assertGateFailure(gate(conditionalIndexAliasRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const overwrittenIndexAliasRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "overwritten-index-alias.js"), `
    let field = "candidateIndex";
    field = "other";
    Reflect.set({}, field, 0);
  `);
});
assert.equal(gate(overwrittenIndexAliasRoot).ok, true, JSON.stringify(gate(overwrittenIndexAliasRoot)));
const conditionalExpressionIndexRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "conditional-expression-index.js"), `
    const field = process.env.USE_COMPATIBILITY_FIELD ? "candidateIndex" : "other";
    Reflect.set({}, field, 0);
  `);
});
assertGateFailure(gate(conditionalExpressionIndexRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const computedObjectIndexRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "computed-object-index.js"), `
    const field = "candidateIndex";
    module.exports = { [field]: 0 };
  `);
});
assertGateFailure(gate(computedObjectIndexRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const deepIndexAliasRoot = isolatedSource(({ sourceRoot }) => {
  const aliases = Array.from({ length: 30 }, (_, index) => (
    index === 0 ? `const key0 = "candidateIndex";` : `const key${index} = key${index - 1};`
  )).join("\n");
  fs.writeFileSync(path.join(sourceRoot, "deep-index-alias.js"), `${aliases}\nReflect.set({}, key29, 0);\n`);
});
assertGateFailure(gate(deepIndexAliasRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const reflectedStringReadRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "reflected-string-read.js"), `
    const key = String("candidateIndex");
    const alias = key;
    Reflect.get({}, alias);
  `);
});
assertGateFailure(gate(reflectedStringReadRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const reflectedStringWriteRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "reflected-string-write.js"), `
    const key = String("candidateIndex");
    Reflect.set({}, key, 0);
  `);
});
assertGateFailure(gate(reflectedStringWriteRoot), "CANDIDATE_INDEX_OUTSIDE_C08");
const harmlessStringMetadataRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "string-index-metadata.js"), `
    const fieldDocumentation = String("candidateIndex");
    module.exports = { fieldDocumentation };
  `);
});
assert.equal(gate(harmlessStringMetadataRoot).ok, true, JSON.stringify(gate(harmlessStringMetadataRoot)));
const harmlessReflectedReadRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "reflected-other-read.js"), `
    const key = String("other");
    Reflect.get({}, key);
  `);
});
assert.equal(gate(harmlessReflectedReadRoot).ok, true, JSON.stringify(gate(harmlessReflectedReadRoot)));
const shadowedStringReadRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadowed-string-read.js"), `
    function String() { return "other"; }
    Reflect.get({}, String("candidateIndex"));
  `);
});
assert.equal(gate(shadowedStringReadRoot).ok, true, JSON.stringify(gate(shadowedStringReadRoot)));

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
const protectedCapabilityParameters = [
  ["db", "function runShadow(db, event) { return db.insert(event); }"],
  ["database", "function runShadow({ database: store }) { return Boolean(store); }"],
  ["resolver-client", "function runShadow(resolverClient, input) { return resolverClient.resolve(input); }"],
  ["line-client", "function runShadow(lineClient, message) { return lineClient.reply(message); }"],
  ["state-store", "function runShadow(stateStore, value) { return stateStore.save(value); }"]
];
for (const [name, source] of protectedCapabilityParameters) {
  const root = isolatedSource(({ sourceRoot }) => {
    fs.writeFileSync(path.join(sourceRoot, `shadow-injected-${name}.js`), `${source}\nmodule.exports = { runShadow };\n`);
  });
  assertGateFailure(gate(root), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
}
const unresolvedProtectedReceiverRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-unresolved-receiver.js"), `
    function runShadow(dependencies, operation, event) {
      const serviceBag = { selected: dependencies.resolver };
      const receiver = serviceBag.selected;
      return receiver[operation](event);
    }
    module.exports = { runShadow };
  `);
});
assertGateFailure(gate(unresolvedProtectedReceiverRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const fullyDynamicProtectedReceiverRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-fully-dynamic-receiver.js"), `
    function runShadow(dependencies, capability, operation, event) {
      const receiver = dependencies[capability];
      return receiver[operation](event);
    }
    module.exports = { runShadow };
  `);
});
assertGateFailure(gate(fullyDynamicProtectedReceiverRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
for (const [name, invocation] of [
  ["static-method", "receiver.insert(event)"],
  ["direct-call", "receiver(event)"]
]) {
  const root = isolatedSource(({ sourceRoot }) => {
    fs.writeFileSync(path.join(sourceRoot, `shadow-dynamic-receiver-${name}.js`), `
      function runShadow(dependencies, capability, event) {
        const receiver = dependencies[capability];
        return ${invocation};
      }
      module.exports = { runShadow };
    `);
  });
  assertGateFailure(gate(root), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
}
const qualifiedDynamicProtectedReceiverRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-qualified-dynamic-receiver.js"), `
    function runShadow(dependencies, capability, event) {
      const databaseClientSchema = dependencies[capability];
      return databaseClientSchema.insert(event);
    }
    module.exports = { runShadow };
  `);
});
assertGateFailure(gate(qualifiedDynamicProtectedReceiverRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const qualifiedInjectedMutationRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-qualified-injected-mutation.js"), `
    function runShadow(databaseClientSchema, event) {
      return databaseClientSchema.insert(event);
    }
    module.exports = { runShadow };
  `);
});
assertGateFailure(gate(qualifiedInjectedMutationRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const computedInjectedCapabilityRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-computed-injected-capability.js"), `
    const capability = "resolver";
    function runShadow({ [capability]: service }) {
      return Boolean(service);
    }
    module.exports = { runShadow };
  `);
});
assertGateFailure(gate(computedInjectedCapabilityRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const declaredInjectedCapabilityRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-declared-injected-capability.js"), `
    function runShadow(dependencies) {
      const databaseClient = dependencies.connection;
      return Boolean(databaseClient);
    }
    module.exports = { runShadow };
  `);
});
assertGateFailure(gate(declaredInjectedCapabilityRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const renamedInjectedInsertRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-renamed-insert.js"), `
    function runShadow(x, event) {
      return x.insert(event);
    }
    module.exports = { runShadow };
  `);
});
assertGateFailure(gate(renamedInjectedInsertRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const renamedInjectedReplyRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-renamed-reply.js"), `
    function runShadow(adapter, event) {
      return adapter.reply(event);
    }
    module.exports = { runShadow };
  `);
});
assertGateFailure(gate(renamedInjectedReplyRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const unknownInjectedMethodRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-unknown-method.js"), `
    function runShadow(dependency, event) {
      return dependency.observe(event);
    }
    module.exports = { runShadow };
  `);
});
assertGateFailure(gate(unknownInjectedMethodRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const renamedInjectedReadLikeRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-renamed-read-like-method.js"), `
    function runShadow(dependency, event) {
      const x = dependency;
      return x.get(event);
    }
    module.exports = { runShadow };
  `);
});
assertGateFailure(gate(renamedInjectedReadLikeRoot), "DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN");
const allowlistedReadOnlyMetadataRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-read-only-metadata.js"), `
    function readShadowMetadata(metadata) {
      return metadata.format();
    }
    module.exports = { readShadowMetadata };
  `);
});
assert.equal(gate(allowlistedReadOnlyMetadataRoot).ok, true, JSON.stringify(gate(allowlistedReadOnlyMetadataRoot)));
const summarizeShadowCollectionRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-summarize-collection.js"), `
    function summarizeShadow(items) {
      return items.map((item) => ({ unitId: item.unitId }));
    }
    module.exports = { summarizeShadow };
  `);
});
assert.equal(gate(summarizeShadowCollectionRoot).ok, true, JSON.stringify(gate(summarizeShadowCollectionRoot)));

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
const harmlessProtectedMetadataRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "shadow-schema-metadata.js"), `
    const databaseClientSchema = { type: "object" };
    function describeStateSchema(stateSchema) {
      const reflection = { receiver: Object, method: "keys" };
      if (stateSchema && typeof stateSchema.validate === "function") stateSchema.validate();
      return reflection.receiver[reflection.method](stateSchema);
    }
    function formatResolverMetadata(resolverMetadata) {
      if (resolverMetadata && typeof resolverMetadata.format === "function") return resolverMetadata.format();
      return resolverMetadata && resolverMetadata.name;
    }
    function invokeResolverMetadata(resolverMetadata, operation) {
      return resolverMetadata[operation]();
    }
    module.exports = { databaseClientSchema, describeStateSchema, formatResolverMetadata, invokeResolverMetadata };
  `);
});
assert.equal(gate(harmlessProtectedMetadataRoot).ok, true, JSON.stringify(gate(harmlessProtectedMetadataRoot)));
const harmlessLoopScopeRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "loop-scope-metadata.js"), `
    let field = "other";
    for (let field = "candidateIndex"; false;) {
      void field;
    }
    Reflect.set({}, field, 0);
  `);
});
assert.equal(gate(harmlessLoopScopeRoot).ok, true, JSON.stringify(gate(harmlessLoopScopeRoot)));
const harmlessSwitchScopeRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "switch-scope-metadata.js"), `
    let field = "other";
    switch (process.env.MODE) {
      case "compatibility":
        let field = "candidateIndex";
        void field;
        break;
      default:
        break;
    }
    Reflect.set({}, field, 0);
  `);
});
assert.equal(gate(harmlessSwitchScopeRoot).ok, true, JSON.stringify(gate(harmlessSwitchScopeRoot)));

// AC-MNT-004 supplemental: a raw-text branch cannot hide an imported
// authority behind a namespace member, nested object property, or local alias.
const destructuredRawTextRouteRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "destructured-raw-text-route.js"), `
    const { createUnitRoutingDecision: route } = require("./unit-reply-router");
    function decideFromGuestText({ ["raw" + "Text"]: text }, enabled) {
      let guestAlias = null;
      if (enabled) guestAlias = text;
      if (guestAlias && guestAlias.includes("parking")) return route({});
      return null;
    }
    module.exports = { decideFromGuestText };
  `);
});
assertGateFailure(gate(destructuredRawTextRouteRoot), "GOD_FUNCTION_FORBIDDEN");
const destructuredGuestTextCanonicalRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "destructured-guest-text-canonical.js"), `
    const canonical = require("./canonical-execution-adapter");
    const execute = canonical.executeCanonicalizerInputItem;
    function decideFromGuestText({ ["guest" + "Text"]: value }) {
      const alias = value;
      return alias.startsWith("parking") ? execute({}) : null;
    }
    module.exports = { decideFromGuestText };
  `);
});
assertGateFailure(gate(destructuredGuestTextCanonicalRoot), "GOD_FUNCTION_FORBIDDEN");
const unrelatedMetadataBranchRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "unrelated-metadata-branch.js"), `
    const { createUnitRoutingDecision: route } = require("./unit-reply-router");
    function routeByMetadata(input, metadata) {
      const { rawText } = input;
      void rawText;
      if (metadata.includes("enabled")) return route({});
      return null;
    }
    module.exports = { routeByMetadata };
  `);
});
assert.equal(gate(unrelatedMetadataBranchRoot).ok, true, JSON.stringify(gate(unrelatedMetadataBranchRoot)));
const frozenObjectAuthorityRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "frozen-object-authority.js"), `
    const routing = require("./unit-reply-router");
    const frozen = Object.freeze({ route: routing.createUnitRoutingDecision });
    const { route: extracted } = frozen;
    const localRoute = extracted;
    function decideFromGuestText(rawText) {
      if (rawText.includes("parking")) return localRoute({});
      return null;
    }
    module.exports = { decideFromGuestText };
  `);
});
assertGateFailure(gate(frozenObjectAuthorityRoot), "GOD_FUNCTION_FORBIDDEN");
const frozenArrayAuthorityRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "frozen-array-authority.js"), `
    const canonical = require("./canonical-execution-adapter");
    const frozen = Object.freeze([canonical.executeCanonicalizerInputItem]);
    const extracted = frozen[0];
    const localCanonical = extracted;
    function decideFromGuestText(guestText) {
      if (guestText.endsWith("parking")) return localCanonical({});
      return null;
    }
    module.exports = { decideFromGuestText };
  `);
});
assertGateFailure(gate(frozenArrayAuthorityRoot), "GOD_FUNCTION_FORBIDDEN");
const harmlessFrozenCallableRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "harmless-frozen-callable.js"), `
    const frozen = Object.freeze({ invoke: () => null });
    const local = frozen.invoke;
    function inspectGuestText(rawText) {
      if (rawText.includes("parking")) return local({});
      return null;
    }
    module.exports = { inspectGuestText };
  `);
});
assert.equal(gate(harmlessFrozenCallableRoot).ok, true, JSON.stringify(gate(harmlessFrozenCallableRoot)));
const shadowedObjectFreezeRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "locally-defined-object-freeze.js"), `
    const routing = require("./unit-reply-router");
    const Object = { freeze() { return { invoke: () => null }; } };
    const frozen = Object.freeze({ invoke: routing.createUnitRoutingDecision });
    const local = frozen.invoke;
    function inspectGuestText(rawText) {
      if (rawText.includes("parking")) return local({});
      return null;
    }
    module.exports = { inspectGuestText };
  `);
});
assert.equal(gate(shadowedObjectFreezeRoot).ok, true, JSON.stringify(gate(shadowedObjectFreezeRoot)));
const importedAuthorityAliasRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "imported-authority-god-function.js"), `
    const routing = require("./unit-reply-router");
    const authorityBag = {
      nested: { invoke: routing["create" + "UnitRoutingDecision"] }
    };
    const localAuthority = authorityBag.nested.invoke;
    function decideFromGuestText(rawText) {
      if (rawText.includes("parking")) return localAuthority({});
      return null;
    }
    module.exports = { decideFromGuestText };
  `);
});
assertGateFailure(gate(importedAuthorityAliasRoot), "GOD_FUNCTION_FORBIDDEN");
const destructuredAuthorityAliasRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "destructured-authority-god-function.js"), `
    const { createUnitRoutingDecision: importedRoute } = require("./unit-reply-router");
    const localRoute = importedRoute;
    function decideFromGuestText(messageText) {
      if (messageText.startsWith("parking")) return localRoute({});
      return null;
    }
    module.exports = { decideFromGuestText };
  `);
});
assertGateFailure(gate(destructuredAuthorityAliasRoot), "GOD_FUNCTION_FORBIDDEN");
const assignedAuthorityAliasRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "assigned-authority-god-function.js"), `
    const routing = require("./unit-reply-router");
    let localRoute;
    localRoute = routing.createUnitRoutingDecision;
    function decideFromGuestText(guestText) {
      if (guestText.endsWith("parking")) return localRoute({});
      return null;
    }
    module.exports = { decideFromGuestText };
  `);
});
assertGateFailure(gate(assignedAuthorityAliasRoot), "GOD_FUNCTION_FORBIDDEN");
const scopedAuthorityAliasRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "scoped-authority-god-function.js"), `
    const routing = require("./unit-reply-router");
    function forbidden(rawText) {
      const invoke = routing.createUnitRoutingDecision;
      if (rawText.includes("parking")) return invoke({});
      return null;
    }
    function harmless() {
      const invoke = () => null;
      return invoke();
    }
    module.exports = { forbidden, harmless };
  `);
});
assertGateFailure(gate(scopedAuthorityAliasRoot), "GOD_FUNCTION_FORBIDDEN");
const scopedHarmlessAliasRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "scoped-harmless-alias.js"), `
    const routing = require("./unit-reply-router");
    function harmless(rawText) {
      const invoke = () => null;
      if (rawText.includes("parking")) return invoke({});
      return null;
    }
    function authorityReference() {
      const invoke = routing.createUnitRoutingDecision;
      return invoke;
    }
    module.exports = { harmless, authorityReference };
  `);
});
assert.equal(gate(scopedHarmlessAliasRoot).ok, true, JSON.stringify(gate(scopedHarmlessAliasRoot)));
const destructuredAssignmentAuthorityRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "destructured-assignment-authority.js"), `
    const routing = require("./unit-reply-router");
    let route;
    ({ createUnitRoutingDecision: route } = routing);
    function decideFromGuestText(messageText) {
      if (messageText.match("parking")) return route({});
      return null;
    }
    module.exports = { decideFromGuestText };
  `);
});
assertGateFailure(gate(destructuredAssignmentAuthorityRoot), "GOD_FUNCTION_FORBIDDEN");
const conditionalAuthorityAliasRoot = isolatedSource(({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "conditional-authority-alias.js"), `
    const routing = require("./unit-reply-router");
    const route = process.env.USE_ROUTER
      ? routing.createUnitRoutingDecision
      : (() => null);
    function decideFromGuestText(rawText) {
      if (rawText.includes("parking")) return route({});
      return null;
    }
    module.exports = { decideFromGuestText };
  `);
});
assertGateFailure(gate(conditionalAuthorityAliasRoot), "GOD_FUNCTION_FORBIDDEN");

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
