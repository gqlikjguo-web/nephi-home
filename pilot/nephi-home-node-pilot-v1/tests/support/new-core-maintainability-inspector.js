"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CONTRACT_IDS = Array.from({ length: 11 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`);
const MAX_FUNCTION_LINES = 180;
const CONTRACT_GRAPH_DIGEST = "4f716c74c7fa0287fd2ecc0c947c56a87b6d96922e3a74ee9e7e696ddc298e20";
const FAILURE_OWNER_DIGEST = "3d4127d7b27b8b418e7d6d45e52ac733fa82fabadbbcb81cd99b746289f60f1e";
const DOMAIN_AUTHORITY_DIGEST = "009e1cfb3b9d0d2fc1d8da58f9cb7ba03d378a991e2c4f3e0640ec94a9600572";

function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

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

function resolvedNode(node, bindings, seen = new Set()) {
  if (!node || node.type !== "Identifier" || !bindings.has(node.name) || seen.has(node.name)) return node;
  const next = new Set(seen); next.add(node.name);
  return resolvedNode(bindings.get(node.name), bindings, next);
}

function resolvedName(node, bindings) { return staticName(resolvedNode(node, bindings)); }

function memberName(node) { return node && node.type === "MemberExpression" ? staticName(node.property) : null; }
function isMember(node, owner, name) { return node && node.type === "MemberExpression" && node.object.type === "Identifier" && node.object.name === owner && memberName(node) === name; }
function isModuleExports(node) { return isMember(node, "module", "exports"); }
function isExports(node) { return node && (node.type === "Identifier" && node.name === "exports" || isModuleExports(node)); }
function analysis(source) {
  const ast = acorn().parse(source, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true, locations: true });
  const declared = new Set();
  const exports = new Set();
  const functions = [];
  const requires = new Set();
  const bindings = new Map();
  walk(ast, (node, parent) => {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) declared.add(node.id.name);
    if (node.type === "VariableDeclarator") {
      if (node.id.type === "Identifier") { declared.add(node.id.name); if (node.init) bindings.set(node.id.name, node.init); }
      if (node.id.type === "ObjectPattern") node.id.properties.forEach((p) => p.value && p.value.type === "Identifier" && declared.add(p.value.name));
    }
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) functions.push(node);
    if (node.type === "MethodDefinition" && node.value) functions.push(node.value);
    if (node.type === "Property" && node.method && node.value) functions.push(node.value);
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require") {
      const request = staticName(node.arguments[0]); if (request) requires.add(request);
    }
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
  return { ast, declared, exports, functions, requires, bindings };
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
    for (const code of contract.failureCodes || []) {
      if (derived.has(code)) return failure("DUPLICATE_FAILURE_CODE_OWNER", root, manifestPath);
      derived.set(code, contract.contractId);
    }
  }
  if (JSON.stringify([...derived].sort()) !== JSON.stringify(Object.keys(manifest.failureCodeOwners).sort().map((k) => [k, manifest.failureCodeOwners[k]]))) return failure("FAILURE_CODE_OWNER_MISMATCH", root, manifestPath);
  if (digest(manifest.contracts) !== CONTRACT_GRAPH_DIGEST) return failure("CONTRACT_GRAPH_MISMATCH", root, manifestPath);
  if (digest(manifest.failureCodeOwners) !== FAILURE_OWNER_DIGEST) return failure("FAILURE_CODE_OWNER_MISMATCH", root, manifestPath);
  if (digest(manifest.domainAuthorities) !== DOMAIN_AUTHORITY_DIGEST) return failure("DOMAIN_AUTHORITY_REGISTRY_INVALID", root, manifestPath);
  return { ok: true };
}

function verifyAst(file, item, root) {
  for (const fn of item.functions) {
    if (fn.loc && fn.loc.end.line - fn.loc.start.line + 1 > MAX_FUNCTION_LINES) return failure("GOD_FUNCTION_FORBIDDEN", root, path.join(root, file));
    const identifiers = new Set(); let rawBranch = false; let authorityCall = false;
    walk(fn.body, (node) => {
      if (node.type === "Identifier") identifiers.add(node.name);
      if (node.type === "CallExpression") {
        const callee = resolvedNode(node.callee, item.bindings);
        const call = callee.type === "Identifier" ? callee.name : resolvedName(callee.property, item.bindings);
        if (["includes", "match", "test", "startsWith", "endsWith"].includes(call)) rawBranch = true;
        if (["validateSemanticUnit", "validateAndNormalizeSourceEvidence", "validateContextLink", "createLifecycleDecision", "createUnitRoutingDecision", "createCanonicalizerInputItem", "executeCanonicalizerInputItem", "canonicalizeExecutionItem", "resolveAvailability"].includes(call)) authorityCall = true;
      }
    });
    if (rawBranch && ["messageText", "guestText", "rawText", "quote"].some((name) => identifiers.has(name)) && authorityCall) return failure("GOD_FUNCTION_FORBIDDEN", root, path.join(root, file));
  }
  let candidate = false; let sideEffect = false;
  walk(item.ast, (node) => {
    if ((node.type === "MemberExpression" && resolvedName(node.property, item.bindings) === "candidateIndex")
      || node.type === "Property" && staticName(node.key) === "candidateIndex"
      || node.type === "CallExpression" && ["set", "defineProperty"].includes(memberName(resolvedNode(node.callee, item.bindings)))
        && resolvedName(node.arguments[1], item.bindings) === "candidateIndex") candidate = true;
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.id.name === "candidateIndex") candidate = true;
    if (node.type === "AssignmentExpression" && node.left.type === "Identifier" && node.left.name === "candidateIndex") candidate = true;
    if (node.type === "CallExpression") {
      const callee = resolvedNode(node.callee, item.bindings);
      const receiver = callee.type === "MemberExpression" ? resolvedNode(callee.object, item.bindings) : null;
      const owner = receiver && receiver.type === "Identifier" ? receiver.name : null;
      const call = callee.type === "Identifier" ? callee.name : resolvedName(callee.property, item.bindings);
      if (["state", "State", "Resolver", "resolver", "LINE", "line", "database"].includes(owner)
        || ["sendLine", "writeState", "createReview", "persist", "insertReview", "replyMessage", "resolveAvailability"].includes(call)) sideEffect = true;
      if (/(?:diagnostic|shadow)/i.test(path.basename(file)) && callee.type === "MemberExpression" && call === null) sideEffect = true;
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
  const requiredImports = [
    ["lib/new-core/context-link-validator.js", "./semantic-unit-validator"],
    ["lib/new-core/lifecycle-manager.js", "./context-link-validator"],
    ["lib/new-core/state-v3-lifecycle-adapter.js", "./lifecycle-manager"],
    ["lib/new-core/unit-aggregator.js", "./unit-reply-router"],
    ["lib/new-core/unit-aggregator.js", "./lifecycle-manager"],
    ["lib/new-core/canonical-execution-adapter.js", "./unit-reply-router"]
  ];
  for (const [file, request] of requiredImports) {
    if (byFile.has(file) && !byFile.get(file).requires.has(request)) return failure("CONTRACT_CONSUMER_MISSING", root, path.join(root, file));
  }
  for (const authority of manifest.domainAuthorities) {
    if (authority.status !== "implemented" || byFile.has(authority.source)) continue;
    const absolute = path.join(root, authority.source);
    if (!fs.existsSync(absolute)) return failure("DOMAIN_AUTHORITY_REGISTRY_INVALID", root, absolute);
    let item;
    try { item = analysis(fs.readFileSync(absolute, "utf8")); } catch (_) { return failure("SOURCE_INSPECTION_FAILED", root, absolute); }
    if (!item.declared.has(authority.symbol) || !item.exports.has(authority.symbol)) return failure("DOMAIN_AUTHORITY_REGISTRY_INVALID", root, absolute);
  }
  for (const [file, item] of byFile) { const result = verifyAst(file, item, root); if (!result.ok) return result; }
  const planned = manifest.contracts.filter((c) => c.validator.status !== "implemented").map((c) => ({ contractId: c.contractId, task: Number(c.validator.status.slice(13)) }));
  return Object.freeze({ ok: true, contractIds: [...CONTRACT_IDS], validatorCoverage: { implemented: 11 - planned.length, planned } });
}

module.exports = { verifyNewCoreMaintainability };
