"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONTRACT_IDS = Array.from({ length: 11 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`);
const MAX_FUNCTION_LINES = 180;
const SEALED = Object.freeze({
  C01: ["Turn Input Adapter|lib/new-core/turn-input-adapter.js|buildUnderstandingTurnInput|implemented", "C01 closed-schema validator|lib/new-core/contracts/understanding-turn-input.js|validateUnderstandingTurnInput|implemented", ["OpenAI Understanding V1|lib/providers/openai-understanding-v1.js|callOpenAIUnderstandingV1|planned_task_11"]],
  C02: ["OpenAI Understanding V1|lib/providers/openai-understanding-v1.js|callOpenAIUnderstandingV1|planned_task_11", "Wire Schema Validator|lib/new-core/contracts/understanding-output-v1.js|validateUnderstandingOutputV1|implemented", ["Source Evidence Validator|lib/new-core/source-evidence-validator.js|validateAndNormalizeSourceEvidence|implemented"]],
  C03: ["OpenAI Understanding V1 unit writer|lib/providers/openai-understanding-v1.js|callOpenAIUnderstandingV1|planned_task_11", "Semantic Unit Validator|lib/new-core/semantic-unit-validator.js|validateSemanticUnit|implemented", ["Context Link Validator|lib/new-core/context-link-validator.js|validateContextLink|implemented", "Per-unit Reply Router|lib/new-core/unit-reply-router.js|createUnitRoutingDecision|implemented"]],
  C04: ["Source Evidence validity writer|lib/new-core/source-evidence-validator.js|validateAndNormalizeSourceEvidence|implemented", "Source Evidence Validator|lib/new-core/source-evidence-validator.js|validateAndNormalizeSourceEvidence|implemented", ["Semantic Unit Validator|lib/new-core/semantic-unit-validator.js|validateSemanticUnit|implemented", "Context Link Validator|lib/new-core/context-link-validator.js|validateContextLink|implemented", "Diagnostic Boundary Emitter|lib/new-core/diagnostic-boundary.js|createDiagnosticBoundaryEvent|implemented"]],
  C05: ["OpenAI Understanding V1 context proposal|lib/providers/openai-understanding-v1.js|callOpenAIUnderstandingV1|planned_task_11", "Context Link Validator|lib/new-core/context-link-validator.js|validateContextLink|implemented", ["Lifecycle Manager|lib/new-core/lifecycle-manager.js|createLifecycleDecision|implemented"]],
  C06: ["Lifecycle Manager|lib/new-core/lifecycle-manager.js|createLifecycleDecision|implemented", "Lifecycle invariant validator|lib/new-core/lifecycle-manager.js|validateLifecycleDecision|implemented", ["State V3 Lifecycle Adapter|lib/new-core/state-v3-lifecycle-adapter.js|adaptLifecycleDecisionsToStateV3|implemented", "Unit Aggregator|lib/new-core/unit-aggregator.js|aggregateUnitOutcomes|implemented"]],
  C07: ["Per-unit Reply Router|lib/new-core/unit-reply-router.js|createUnitRoutingDecision|implemented", "Route invariant validator|lib/new-core/contracts/unit-routing-decision.js|validateUnitRoutingDecision|implemented", ["Unit Aggregator|lib/new-core/unit-aggregator.js|aggregateUnitOutcomes|implemented", "Canonical Execution Adapter|lib/new-core/canonical-execution-adapter.js|createCanonicalizerInputItem|implemented"]],
  C08: ["Canonical Execution Adapter|lib/new-core/canonical-execution-adapter.js|createCanonicalizerInputItem|implemented", "C08 adapter contract validator|lib/new-core/contracts/canonicalizer-input-item.js|validateCanonicalizerInputItem|implemented", ["Official canonicalizer|lib/new-core/canonical-execution-adapter.js|executeCanonicalizerInputItem|implemented"]],
  C09: ["Unit Aggregator|lib/new-core/unit-aggregator.js|aggregateUnitOutcomes|implemented", "C09 coverage and ownership validator|lib/new-core/contracts/unit-aggregation-result.js|validateUnitAggregationResult|implemented", ["Existing execution orchestration|lib/new-core/shadow-core.js|consumeUnitAggregationResult|planned_task_12", "FinalDecision input adapter|lib/v2-composition-root.js|adaptUnitAggregationToFinalDecision|planned_task_15"]],
  C10: ["Shadow Comparator|lib/new-core/shadow-comparator.js|createShadowComparisonRecord|planned_task_12", "Shadow privacy and isolation validator|lib/new-core/shadow-comparator.js|validateShadowComparisonRecord|planned_task_12", ["Offline acceptance and reporting|tests/new-core-shadow-isolation-runner.js|runShadowIsolationAcceptance|planned_task_12"]],
  C11: ["Diagnostic Boundary Emitter|lib/new-core/diagnostic-boundary.js|createDiagnosticBoundaryEvent|implemented", "Safe trace allowlist validator|lib/new-core/diagnostic-boundary.js|validateDiagnosticBoundaryEvent|implemented", ["Existing safe diagnostic persistence|lib/test-only-line-message-trace.js|diagnosticProjection|planned_task_12", "Acceptance attribution|scripts/run-new-core-openai-shadow-acceptance.js|runNewCoreOpenAiShadowAcceptance|planned_task_14"]]
});
const SEALED_AUTHORITIES = Object.freeze({
  semantic: "OpenAI Understanding V1|C03|lib/providers/openai-understanding-v1.js|callOpenAIUnderstandingV1|planned_task_11",
  evidence: "Source Evidence Validator|C04|lib/new-core/source-evidence-validator.js|validateAndNormalizeSourceEvidence|implemented",
  capability: "existing capability registry|C08|lib/conversation-engine-v2/capability-registry.js|CAPABILITY_REGISTRY|implemented",
  reply: "Per-unit Reply Router|C07|lib/new-core/unit-reply-router.js|createUnitRoutingDecision|implemented",
  context: "Context Link Validator / Lifecycle Manager|C05|lib/new-core/context-link-validator.js|validateContextLink|implemented",
  facts: "existing Resolver and PostgreSQL providers|C08|lib/conversation-engine-v2/capability-executor.js|executeCanonicalQueryPlans|implemented",
  memory: "existing state-v3 reducer|C06|lib/conversation-engine-v2/conversation-state-v3-reducer.js|reduceConversationStateV3|implemented",
  final_action: "existing FinalDecision|C09|lib/conversation-engine-v2/final-decision.js|buildFinalDecision|implemented"
});
const SIGNATURES = [
  ["semantic", ["purpose", "capability", "subject", "stayDependent"], new Set(["lib/new-core/contracts/canonicalizer-input-item.js", "lib/new-core/canonical-execution-adapter.js"])],
  ["evidence", [["start", "Offset"].join(""), ["end", "Offset"].join(""), "quote"], new Set(["lib/new-core/source-evidence-validator.js"])],
  ["capability", ["requestKind", "exactRequiredFields"], new Set(["lib/new-core/capability-subject-policy.js"])],
  ["reply", ["disposition", "requiresCanonicalExecution"], new Set(["lib/new-core/unit-reply-router.js"])],
  ["context", ["actionCandidate", "targetRequestCycleId"], new Set(["lib/new-core/context-link-validator.js"])],
  ["facts", ["facts"], new Set()],
  ["memory", ["confirmedFields", "lifecycleOperations"], new Set(["lib/new-core/state-v3-lifecycle-adapter.js"])]
];

let parser;
function acorn() {
  if (parser) return parser;
  const source = process.binding("natives")["internal/deps/acorn/acorn/dist/acorn"];
  if (typeof source !== "string") throw new Error("parser unavailable");
  const embedded = { exports: {} };
  Function("exports", "require", "module", "__filename", "__dirname", source)(embedded.exports, require, embedded, "embedded-acorn.js", "");
  parser = embedded.exports;
  return parser;
}

function walk(value, visitor, parent = null) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item) => walk(item, visitor, parent));
  if (typeof value.type === "string") visitor(value, parent);
  for (const [key, item] of Object.entries(value)) {
    if (!["start", "end", "loc", "range"].includes(key)) walk(item, visitor, value);
  }
}

function staticName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticName(node.left); const right = staticName(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  return null;
}

function memberName(node) { return node && node.type === "MemberExpression" ? staticName(node.property) : null; }
function isMember(node, owner, name) { return node && node.type === "MemberExpression" && node.object.type === "Identifier" && node.object.name === owner && memberName(node) === name; }
function isModuleExports(node) { return isMember(node, "module", "exports"); }
function isExports(node) { return node && (node.type === "Identifier" && node.name === "exports" || isModuleExports(node)); }
function roleSignature(role) { return `${role.name}|${role.source}|${role.symbol}|${role.status}`; }
function authoritySignature(entry) { return `${entry.owner}|${entry.contractId}|${entry.source}|${entry.symbol}|${entry.status}`; }

function analysis(source) {
  const ast = acorn().parse(source, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true, locations: true });
  const declared = new Set();
  const exports = new Set();
  const functions = [];
  walk(ast, (node, parent) => {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) declared.add(node.id.name);
    if (node.type === "VariableDeclarator") {
      if (node.id.type === "Identifier") declared.add(node.id.name);
      if (node.id.type === "ObjectPattern") node.id.properties.forEach((p) => p.value && p.value.type === "Identifier" && declared.add(p.value.name));
    }
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) functions.push(node);
    if (node.type === "MethodDefinition" && node.value) functions.push(node.value);
    if (node.type === "Property" && node.method && node.value) functions.push(node.value);
    if (node.type === "AssignmentExpression" && node.operator === "=") {
      if (node.left.type === "Identifier") declared.add(node.left.name);
      if (node.left.type === "MemberExpression" && isExports(node.left.object)) exports.add(memberName(node.left));
      if (isModuleExports(node.left) && node.right.type === "ObjectExpression") {
        node.right.properties.forEach((p) => p.type === "Property" && exports.add(staticName(p.key)));
      }
    }
    if (node.type === "CallExpression" && isMember(node.callee, "Object", "assign") && isExports(node.arguments[0])) {
      node.arguments.slice(1).forEach((arg) => arg.type === "ObjectExpression" && arg.properties.forEach((p) => p.type === "Property" && exports.add(staticName(p.key))));
    }
    if (node.type === "CallExpression" && (isMember(node.callee, "Object", "defineProperty") || isMember(node.callee, "Reflect", "defineProperty")) && isExports(node.arguments[0])) exports.add(staticName(node.arguments[1]));
  });
  return { ast, declared, exports, functions };
}

function sourceFiles(root) {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.(?:c?js|mjs)$/.test(entry.name)) files.push(file);
    }
  }
  if (fs.existsSync(root)) visit(root);
  return files.sort();
}

function relative(root, file) { return path.relative(root, file).replaceAll(path.sep, "/") || path.basename(file); }
function failure(code, root, file, extra = {}) { return Object.freeze({ ok: false, code, file: relative(root, file), ...extra }); }

function validRole(role) {
  return role && typeof role === "object" && typeof role.name === "string"
    && typeof role.source === "string" && /^(?:lib|tests|scripts)\/[A-Za-z0-9_./-]+$/.test(role.source)
    && !role.source.split("/").includes("..") && typeof role.symbol === "string"
    && /^[A-Za-z_$][A-Za-z0-9_$]{0,159}$/.test(role.symbol)
    && /^(implemented|planned_task_(11|12|13|14|15))$/.test(role.status);
}

function validateManifest(manifest, root, manifestPath) {
  if (!manifest || manifest.schemaVersion !== 2 || manifest.coreVersion !== "new-core-v1"
    || !Array.isArray(manifest.contracts) || !Array.isArray(manifest.domainAuthorities)
    || !manifest.failureCodeOwners || typeof manifest.failureCodeOwners !== "object" || Array.isArray(manifest.failureCodeOwners)) return failure("OWNERSHIP_MANIFEST_INVALID", root, manifestPath);
  if (manifest.contracts.length !== 11 || CONTRACT_IDS.some((id) => !manifest.contracts.some((c) => c.contractId === id))) return failure("CONTRACT_COVERAGE_INCOMPLETE", root, manifestPath);
  const derived = new Map();
  for (const contract of manifest.contracts) {
    if (!validRole(contract.writer) || !validRole(contract.validator) || !Array.isArray(contract.consumers) || !contract.consumers.length || !contract.consumers.every(validRole)) return failure("OWNERSHIP_MANIFEST_INVALID", root, manifestPath);
    const sealed = SEALED[contract.contractId];
    if (!sealed || roleSignature(contract.writer) !== sealed[0] || roleSignature(contract.validator) !== sealed[1]
      || JSON.stringify(contract.consumers.map(roleSignature)) !== JSON.stringify(sealed[2])) return failure("CONTRACT_GRAPH_MISMATCH", root, manifestPath);
    for (const code of contract.failureCodes || []) {
      if (derived.has(code)) return failure("DUPLICATE_FAILURE_CODE_OWNER", root, manifestPath);
      derived.set(code, contract.contractId);
    }
  }
  if (JSON.stringify([...derived].sort()) !== JSON.stringify(Object.keys(manifest.failureCodeOwners).sort().map((k) => [k, manifest.failureCodeOwners[k]]))) return failure("FAILURE_CODE_OWNER_MISMATCH", root, manifestPath);
  const actualAuthorities = Object.fromEntries(manifest.domainAuthorities.map((entry) => [entry.authority, authoritySignature(entry)]));
  if (JSON.stringify(actualAuthorities) !== JSON.stringify(SEALED_AUTHORITIES)) return failure("DOMAIN_AUTHORITY_REGISTRY_INVALID", root, manifestPath);
  return { ok: true };
}

function objectKeys(node) {
  if (!node || node.type !== "ObjectExpression") return null;
  const keys = new Set(); let executable = false;
  for (const property of node.properties) {
    if (property.type !== "Property") continue;
    keys.add(staticName(property.key));
    if (!(property.value.type === "Literal" && typeof property.value.value === "string")) executable = true;
  }
  return executable ? keys : null;
}

function verifyAst(file, item, root) {
  for (const fn of item.functions) {
    if (fn.loc && fn.loc.end.line - fn.loc.start.line + 1 > MAX_FUNCTION_LINES) return failure("GOD_FUNCTION_FORBIDDEN", root, path.join(root, file));
    const identifiers = new Set(); let rawBranch = false; let authorityCall = false;
    const assigned = new Map();
    walk(fn.body, (node) => {
      if (node.type === "Identifier") identifiers.add(node.name);
      if (node.type === "CallExpression") {
        const call = node.callee.type === "Identifier" ? node.callee.name : memberName(node.callee);
        if (["includes", "match", "test", "startsWith", "endsWith"].includes(call)) rawBranch = true;
        if (["validateSemanticUnit", "validateAndNormalizeSourceEvidence", "validateContextLink", "createLifecycleDecision", "createUnitRoutingDecision", "createCanonicalizerInputItem", "executeCanonicalizerInputItem", "canonicalizeExecutionItem", "resolveAvailability"].includes(call)) authorityCall = true;
      }
      if (node.type === "ObjectExpression") {
        const keys = objectKeys(node);
        if (keys) assigned.set(node, keys);
      }
      if (node.type === "AssignmentExpression" && node.left.type === "MemberExpression" && node.left.object.type === "Identifier") {
        const keys = assigned.get(node.left.object.name) || new Set(); keys.add(memberName(node.left)); assigned.set(node.left.object.name, keys);
      }
      if (node.type === "CallExpression" && isMember(node.callee, "Reflect", "set") && node.arguments[0] && node.arguments[0].type === "Identifier") {
        const keys = assigned.get(node.arguments[0].name) || new Set(); keys.add(staticName(node.arguments[1])); assigned.set(node.arguments[0].name, keys);
      }
    });
    if (rawBranch && ["messageText", "guestText", "rawText", "quote"].some((name) => identifiers.has(name)) && authorityCall) return failure("GOD_FUNCTION_FORBIDDEN", root, path.join(root, file));
    for (const keys of assigned.values()) for (const [name, required, allowed] of SIGNATURES) if (!allowed.has(file) && required.every((key) => keys.has(key))) return failure("DUPLICATE_DOMAIN_AUTHORITY", root, path.join(root, file), { authority: name });
  }
  let candidate = false; let sideEffect = false;
  walk(item.ast, (node) => {
    if ((node.type === "MemberExpression" && memberName(node) === "candidateIndex")
      || node.type === "Property" && staticName(node.key) === "candidateIndex"
      || node.type === "CallExpression" && isMember(node.callee, "Reflect", "set") && staticName(node.arguments[1]) === "candidateIndex") candidate = true;
    if (node.type === "CallExpression") {
      const owner = node.callee.type === "MemberExpression" && node.callee.object.type === "Identifier" ? node.callee.object.name : null;
      const call = node.callee.type === "Identifier" ? node.callee.name : memberName(node.callee);
      if (["state", "State", "Resolver", "resolver", "LINE", "line", "database"].includes(owner)
        || ["sendLine", "writeState", "createReview", "persist", "insertReview", "replyMessage", "resolveAvailability"].includes(call)) sideEffect = true;
    }
  });
  if (file !== "lib/new-core/canonical-execution-adapter.js" && candidate) return failure("CANDIDATE_INDEX_OUTSIDE_C08", root, path.join(root, file));
  if (/(?:diagnostic|shadow)/i.test(path.basename(file)) && sideEffect) return failure("DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN", root, path.join(root, file));
  return { ok: true };
}

function verifyNewCoreMaintainability({ projectRoot, manifestPath } = {}) {
  const root = typeof projectRoot === "string" ? path.resolve(projectRoot) : "";
  const manifestFile = typeof manifestPath === "string" ? path.resolve(manifestPath) : "";
  if (!root || !manifestFile) return failure("OWNERSHIP_MANIFEST_INVALID", root || process.cwd(), manifestFile || "manifest");
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); } catch (_) { return failure("OWNERSHIP_MANIFEST_INVALID", root, manifestFile); }
  const valid = validateManifest(manifest, root, manifestFile); if (!valid.ok) return valid;
  const byFile = new Map();
  try {
    for (const absolute of sourceFiles(path.join(root, "lib", "new-core"))) {
      const file = relative(root, absolute); byFile.set(file, analysis(fs.readFileSync(absolute, "utf8")));
    }
  } catch (_) { return failure("SOURCE_INSPECTION_FAILED", root, path.join(root, "lib", "new-core")); }
  for (const contract of manifest.contracts) {
    for (const [role, code] of [[contract.writer, "CONTRACT_WRITER_MISSING"], [contract.validator, "CONTRACT_VALIDATOR_MISSING"], ...contract.consumers.map((c) => [c, "CONTRACT_CONSUMER_MISSING"])]) {
      if (role.status !== "implemented") continue;
      const item = byFile.get(role.source);
      if (!item || !item.declared.has(role.symbol) || !item.exports.has(role.symbol)) return failure(code, root, path.join(root, role.source));
    }
    if (contract.writer.status === "implemented") for (const [file, item] of byFile) if (file !== contract.writer.source && item.exports.has(contract.writer.symbol)) return failure("DUPLICATE_CONTRACT_WRITER", root, path.join(root, file));
  }
  for (const [file, item] of byFile) { const result = verifyAst(file, item, root); if (!result.ok) return result; }
  const planned = manifest.contracts.filter((c) => c.validator.status !== "implemented").map((c) => ({ contractId: c.contractId, task: Number(c.validator.status.slice(13)) }));
  return Object.freeze({ ok: true, contractIds: [...CONTRACT_IDS], validatorCoverage: { implemented: 11 - planned.length, planned } });
}

module.exports = { verifyNewCoreMaintainability };
