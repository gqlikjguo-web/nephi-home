"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CONTRACT_IDS = Array.from({ length: 11 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`);
const MAX_FUNCTION_LINES = 180;
const MAX_EXPRESSION_RESOLUTION_DEPTH = 24;
const MUTATION_CAPABILITIES = new Set(["db", "database", "postgres", "postgresql", "resolver", "line", "state"]);
const MUTATION_ROLES = new Set(["client", "gateway", "mutator", "persistence", "provider", "repository", "repo", "service", "sink", "store", "writer"]);
const MUTATING_METHODS = new Set(["delete", "execute", "insert", "persist", "remove", "reply", "resolve", "save", "send", "set", "update", "upsert", "write"]);
const NON_MUTATION_QUALIFIERS = new Set(["descriptor", "documentation", "enum", "metadata", "projection", "record", "schema", "snapshot", "summary"]);
const READ_ONLY_COLLECTION_METHODS = new Set([
  "map", "filter", "reduce", "find", "findIndex", "some", "every", "slice",
  "includes", "at", "entries", "keys", "values"
]);
const RAW_TEXT_ORIGINS = new Set(["messageText", "guestText", "rawText", "quote"]);
const RAW_TEXT_INSPECTION_METHODS = new Set(["includes", "match", "test", "startsWith", "endsWith"]);
const SEMANTIC_AUTHORITIES = new Set([
  "validateSemanticUnit", "validateAndNormalizeSourceEvidence", "validateContextLink",
  "createLifecycleDecision", "createUnitRoutingDecision", "createCanonicalizerInputItem",
  "executeCanonicalizerInputItem", "canonicalizeExecutionItem", "resolveAvailability"
]);
const CONTRACT_GRAPH_DIGEST = "23fdec57124fae2ca3f291ea190f24ed68024805ea79a6b514bd88000739cbe4";
const FAILURE_OWNER_DIGEST = "6d5b6ade70414d1b9370095e6efcd96e6178721a06a5a1a940df4ca33be99a51";
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
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number")) return String(node.value);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticName(node.left); const right = staticName(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  return null;
}

function emptyResolution() {
  return { nodes: [], names: new Set(), origins: new Set(), exhausted: false, unresolved: false, injected: false };
}

function addNode(result, node) {
  if (!node || result.nodes.includes(node)) return;
  if (result.nodes.length >= 32) {
    result.exhausted = true;
    result.unresolved = true;
    return;
  }
  result.nodes.push(node);
}

function mergeResolution(target, source) {
  source.nodes.forEach((node) => addNode(target, node));
  source.names.forEach((name) => target.names.add(name));
  source.origins.forEach((name) => target.origins.add(name));
  target.exhausted ||= source.exhausted;
  target.unresolved ||= source.unresolved;
  target.injected ||= source.injected;
  return target;
}

function mergeMetadata(target, source) {
  source.names.forEach((name) => target.names.add(name));
  source.origins.forEach((name) => target.origins.add(name));
  target.exhausted ||= source.exhausted;
  target.unresolved ||= source.unresolved;
  target.injected ||= source.injected;
  return target;
}

function propertyResolution(node, bindings, seen, depth) {
  if (!node || node.type !== "MemberExpression") return emptyResolution();
  if (!node.computed) {
    const result = emptyResolution();
    const name = staticName(node.property);
    if (name === null) result.unresolved = true;
    else result.names.add(name);
    return result;
  }
  const result = resolveExpression(node.property, bindings, seen, depth + 1);
  for (const resolved of result.nodes) {
    if (resolved.type === "Identifier") continue;
    const name = staticName(resolved);
    if (name !== null) result.names.add(name);
  }
  if (!result.names.size) result.unresolved = true;
  return result;
}

function objectPropertyResolution(node, propertyName, bindings, seen, depth) {
  const result = emptyResolution();
  if (!node) return result;
  if (node.type === "ArrayExpression") {
    if (/^(?:0|[1-9][0-9]*)$/.test(propertyName)) {
      const item = node.elements[Number(propertyName)];
      if (item) mergeResolution(result, resolveExpression(item, bindings, seen, depth + 1));
    }
    return result;
  }
  if (node.type !== "ObjectExpression") return result;
  for (const property of node.properties) {
    if (!property || property.type !== "Property" || property.kind !== "init") continue;
    let names;
    if (property.computed) {
      const key = resolveValueNames(property.key, bindings, seen, depth + 1);
      mergeMetadata(result, key);
      names = key.names;
    } else names = new Set([staticName(property.key)]);
    if (names.has(propertyName)) mergeResolution(result, resolveExpression(property.value, bindings, seen, depth + 1));
  }
  return result;
}

function resolveExpression(node, bindings, seen = new Set(), depth = 0) {
  const result = emptyResolution();
  if (!node) {
    result.unresolved = true;
    return result;
  }
  if (depth >= MAX_EXPRESSION_RESOLUTION_DEPTH) {
    result.exhausted = true;
    result.unresolved = true;
    addNode(result, node);
    return result;
  }
  if (node.type === "InjectedParameter") {
    (node.names || []).forEach((name) => result.origins.add(name));
    result.injected = true;
    result.unresolved = true;
    addNode(result, node);
    return result;
  }
  if (node.type === "ChainExpression") return resolveExpression(node.expression, bindings, seen, depth + 1);
  if (node.type === "ConditionalExpression" || node.type === "LogicalExpression") {
    const branches = node.type === "ConditionalExpression" ? [node.consequent, node.alternate] : [node.left, node.right];
    branches.forEach((branch) => mergeResolution(result, resolveExpression(branch, bindings, seen, depth + 1)));
    return result;
  }
  if (node.type === "AssignmentExpression" || node.type === "AwaitExpression" || node.type === "YieldExpression") {
    return resolveExpression(node.type === "AssignmentExpression" ? node.right : node.argument, bindings, seen, depth + 1);
  }
  if (node.type === "SequenceExpression" && node.expressions.length) {
    return resolveExpression(node.expressions[node.expressions.length - 1], bindings, seen, depth + 1);
  }
  if (node.type === "CallExpression" && node.callee.type === "Identifier"
    && node.callee.name === "String" && node.arguments.length === 1
    && bindings.lookup("String", node.callee).length === 0) {
    return resolveExpression(node.arguments[0], bindings, seen, depth + 1);
  }
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression"
    && node.callee.object.type === "Identifier" && node.callee.object.name === "Object"
    && staticName(node.callee.property) === "freeze" && node.arguments.length === 1
    && bindings.lookup("Object", node.callee.object).length === 0) {
    return resolveExpression(node.arguments[0], bindings, seen, depth + 1);
  }
  if (node.type === "Identifier") {
    result.origins.add(node.name);
    const records = bindings.lookup(node.name, node);
    if (!records.length) {
      addNode(result, node);
      return result;
    }
    for (const record of records) {
      result.injected ||= record.injected;
      if (!record.source || seen.has(record)) {
        result.unresolved = true;
        addNode(result, node);
        continue;
      }
      const next = new Set(seen); next.add(record);
      mergeResolution(result, resolveExpression(record.source, bindings, next, depth + 1));
    }
    return result;
  }
  if (node.type !== "MemberExpression") {
    addNode(result, node);
    return result;
  }
  const objects = resolveExpression(node.object, bindings, seen, depth + 1);
  const properties = propertyResolution(node, bindings, seen, depth + 1);
  mergeResolution(result, objects);
  mergeMetadata(result, properties);
  properties.names.forEach((name) => result.origins.add(name));
  const resolvedMembers = [];
  for (const object of objects.nodes) {
    let matched = false;
    for (const propertyName of properties.names) {
      const property = objectPropertyResolution(object, propertyName, bindings, seen, depth + 1);
      if (property.nodes.length) {
        matched = true;
        mergeResolution(result, property);
      } else resolvedMembers.push({
        ...node,
        object,
        property: { type: "Literal", value: propertyName },
        computed: true
      });
    }
    if (!matched && !properties.names.size) resolvedMembers.push({ ...node, object });
  }
  result.nodes = result.nodes.filter((item) => !objects.nodes.includes(item));
  resolvedMembers.forEach((item) => addNode(result, item));
  if (!result.nodes.length) addNode(result, node);
  return result;
}

function resolveValueNames(node, bindings, seen = new Set(), depth = 0) {
  const result = resolveExpression(node, bindings, seen, depth);
  for (const resolved of result.nodes) {
    if (resolved.type === "Identifier" || resolved.type === "InjectedParameter") continue;
    const name = staticName(resolved);
    if (name !== null) result.names.add(name);
  }
  if (!result.names.size) result.unresolved = true;
  return result;
}

function resolveCallable(node, bindings) {
  const result = resolveExpression(node, bindings);
  for (const resolved of [...result.nodes]) {
    if (resolved.type === "Identifier") result.names.add(resolved.name);
    else if (resolved.type === "MemberExpression") mergeMetadata(result, propertyResolution(resolved, bindings, new Set(), 0));
  }
  result.origins.forEach((name) => result.names.add(name));
  return result;
}


function memberName(node) { return node && node.type === "MemberExpression" ? staticName(node.property) : null; }
function isMember(node, owner, name) { return node && node.type === "MemberExpression" && node.object.type === "Identifier" && node.object.name === owner && memberName(node) === name; }
function isModuleExports(node) { return isMember(node, "module", "exports"); }
function isExports(node) { return node && (node.type === "Identifier" && node.name === "exports" || isModuleExports(node)); }

function declarePattern(pattern, declared) {
  if (!pattern) return;
  if (pattern.type === "Identifier") {
    declared.add(pattern.name);
    return;
  }
  if (pattern.type === "AssignmentPattern") return declarePattern(pattern.left, declared);
  if (pattern.type === "RestElement") return declarePattern(pattern.argument, declared);
  if (pattern.type === "ArrayPattern") {
    pattern.elements.forEach((item) => declarePattern(item, declared));
    return;
  }
  if (pattern.type === "ObjectPattern") {
    pattern.properties.forEach((property) => {
      declarePattern(property.type === "RestElement" ? property.argument : property.value, declared);
    });
  }
}

function createBindingIndex(ast) {
  const nodeScopes = new WeakMap();
  const root = { parent: null, kind: "program", start: ast.start, bindings: new Map() };

  function childScope(parent, kind, start) {
    return { parent, kind, start, bindings: new Map() };
  }

  function addBinding(scope, name, source, start, { conditional = false, injected = false, hoisted = false } = {}) {
    if (!scope.bindings.has(name)) scope.bindings.set(name, []);
    scope.bindings.get(name).push({ source, start, conditional, injected, hoisted });
  }

  function parameterSource(names) {
    return { type: "InjectedParameter", names: [...names] };
  }

  function patternMember(source, property, index = null) {
    if (!source) return null;
    if (index !== null) return {
      type: "MemberExpression", object: source, property: { type: "Literal", value: String(index) }, computed: true
    };
    const key = property.computed ? property.key : { type: "Literal", value: staticName(property.key) };
    return key.value === null ? null : { type: "MemberExpression", object: source, property: key, computed: true };
  }

  function addPattern(pattern, source, scope, start, options = {}) {
    if (!pattern) return;
    if (pattern.type === "Identifier") {
      addBinding(scope, pattern.name, source, start, options);
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      addPattern(pattern.left, source || pattern.right, scope, start, options);
      return;
    }
    if (pattern.type === "RestElement") {
      addPattern(pattern.argument, source, scope, start, options);
      return;
    }
    if (pattern.type === "ArrayPattern") {
      pattern.elements.forEach((item, index) => addPattern(item, patternMember(source, null, index), scope, start, options));
      return;
    }
    if (pattern.type === "ObjectPattern") {
      pattern.properties.forEach((property) => {
        if (property.type === "RestElement") addPattern(property.argument, source, scope, start, options);
        else addPattern(property.value, patternMember(source, property), scope, start, options);
      });
    }
  }

  function assignmentScope(scope, name) {
    let current = scope;
    while (current.parent && !current.bindings.has(name)) current = current.parent;
    return current;
  }

  function functionOwner(scope) {
    let current = scope;
    while (current.parent && !["function", "program"].includes(current.kind)) current = current.parent;
    return current;
  }

  function addAssignmentPattern(pattern, source, scope, start, options = {}) {
    if (!pattern) return;
    if (pattern.type === "Identifier") {
      const target = assignmentScope(scope, pattern.name);
      addBinding(target, pattern.name, source, start, {
        ...options,
        conditional: options.conditional || functionOwner(target) !== functionOwner(scope)
      });
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      addAssignmentPattern(pattern.left, source || pattern.right, scope, start, options);
      return;
    }
    if (pattern.type === "RestElement") {
      addAssignmentPattern(pattern.argument, source, scope, start, options);
      return;
    }
    if (pattern.type === "ArrayPattern") {
      pattern.elements.forEach((item, index) => addAssignmentPattern(item, patternMember(source, null, index), scope, start, options));
      return;
    }
    if (pattern.type === "ObjectPattern") {
      pattern.properties.forEach((property) => {
        if (property.type === "RestElement") addAssignmentPattern(property.argument, source, scope, start, options);
        else addAssignmentPattern(property.value, patternMember(source, property), scope, start, options);
      });
    }
  }

  function variableScope(scope, kind) {
    if (kind !== "var") return scope;
    let current = scope;
    while (current.parent && current.kind !== "function") current = current.parent;
    return current;
  }

  function visitChildren(node, scope, conditional) {
    for (const [key, value] of Object.entries(node)) {
      if (["start", "end", "loc", "range", "type"].includes(key) || !value) continue;
      if (Array.isArray(value)) value.forEach((item) => visit(item, scope, conditional));
      else visit(value, scope, conditional);
    }
  }

  function visitFunction(node, parentScope) {
    const scope = childScope(parentScope, "function", node.start);
    if (node.type !== "ArrowFunctionExpression" && node.id) addBinding(scope, node.id.name, node, node.start, { hoisted: true });
    for (const parameter of node.params) {
      addPattern(parameter, parameterSource(patternNames(parameter, { lookup: () => [] })), scope, node.start, { injected: true, hoisted: true });
      visit(parameter, scope, false);
    }
    if (node.body.type === "BlockStatement") {
      nodeScopes.set(node.body, scope);
      node.body.body.forEach((statement) => visit(statement, scope, false));
    } else visit(node.body, scope, false);
  }

  function visit(node, scope, conditional = false) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((item) => visit(item, scope, conditional));
    nodeScopes.set(node, scope);
    if (node.type === "Program") {
      node.body.forEach((statement) => visit(statement, scope, false));
      return;
    }
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
      if (node.type === "FunctionDeclaration" && node.id) addBinding(scope, node.id.name, node, node.start, { hoisted: true });
      visitFunction(node, scope);
      return;
    }
    if (node.type === "BlockStatement") {
      const block = childScope(scope, "block", node.start);
      node.body.forEach((statement) => visit(statement, block, conditional));
      return;
    }
    if (node.type === "CatchClause") {
      const block = childScope(scope, "block", node.start);
      if (node.param) addPattern(node.param, parameterSource(patternNames(node.param, { lookup: () => [] })), block, node.start, { injected: true, hoisted: true });
      visit(node.param, block, conditional);
      visit(node.body, block, true);
      return;
    }
    if (node.type === "VariableDeclaration") {
      const target = variableScope(scope, node.kind);
      for (const declaration of node.declarations) {
        nodeScopes.set(declaration, scope);
        addPattern(declaration.id, declaration.init, target, declaration.start, { conditional });
        visit(declaration.id, scope, conditional);
        visit(declaration.init, scope, conditional);
      }
      return;
    }
    if (node.type === "AssignmentExpression") {
      visit(node.left, scope, conditional);
      visit(node.right, scope, conditional);
      addAssignmentPattern(node.left, node.operator === "=" ? node.right : null, scope, node.end, { conditional });
      return;
    }
    if (node.type === "UpdateExpression") {
      visit(node.argument, scope, conditional);
      addAssignmentPattern(node.argument, null, scope, node.end, { conditional });
      return;
    }
    if (node.type === "IfStatement") {
      visit(node.test, scope, conditional);
      visit(node.consequent, scope, true);
      visit(node.alternate, scope, true);
      return;
    }
    if (node.type === "ConditionalExpression") {
      visit(node.test, scope, conditional);
      visit(node.consequent, scope, true);
      visit(node.alternate, scope, true);
      return;
    }
    if (node.type === "LogicalExpression") {
      visit(node.left, scope, conditional);
      visit(node.right, scope, true);
      return;
    }
    if (["ForStatement", "ForInStatement", "ForOfStatement"].includes(node.type)) {
      const loop = childScope(scope, "block", node.start);
      for (const key of ["init", "left", "right", "test", "update"]) visit(node[key], loop, conditional);
      visit(node.body, loop, true);
      return;
    }
    if (["WhileStatement", "DoWhileStatement"].includes(node.type)) {
      for (const key of ["init", "left", "right", "test", "update"]) visit(node[key], scope, conditional);
      visit(node.body, scope, true);
      return;
    }
    if (node.type === "SwitchStatement") {
      visit(node.discriminant, scope, conditional);
      const switchScope = childScope(scope, "block", node.start);
      node.cases.forEach((item) => visit(item, switchScope, true));
      return;
    }
    if (["TryStatement", "SwitchCase"].includes(node.type)) {
      visitChildren(node, scope, true);
      return;
    }
    visitChildren(node, scope, conditional);
  }

  visit(ast, root, false);
  return {
    lookup(name, useNode) {
      let scope = nodeScopes.get(useNode) || root;
      while (scope) {
        const records = scope.bindings.get(name);
        if (records) {
          const eligible = records.filter((record) => record.hoisted || record.start <= useNode.start).sort((left, right) => left.start - right.start);
          if (!eligible.length) return [{ source: null, start: scope.start, conditional: false, injected: false, hoisted: false }];
          let active = [];
          for (const record of eligible) active = record.conditional ? [...active, record] : [record];
          return active;
        }
        scope = scope.parent;
      }
      return [];
    }
  };
}

function analysis(source) {
  const ast = acorn().parse(source, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true, locations: true });
  const declared = new Set();
  const exports = new Set();
  const functions = [];
  const requires = new Set();
  const bindings = createBindingIndex(ast);
  walk(ast, (node, parent) => {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) declared.add(node.id.name);
    if (node.type === "VariableDeclarator") {
      declarePattern(node.id, declared);
    }
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) functions.push(node);
    if (node.type === "MethodDefinition" && node.value) functions.push(node.value);
    if (node.type === "Property" && node.method && node.value) functions.push(node.value);
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require") {
      const request = staticName(node.arguments[0]); if (request) requires.add(request);
    }
    if (node.type === "AssignmentExpression" && node.operator === "=") {
      if (node.left.type === "Identifier") {
        declared.add(node.left.name);
      }
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

function patternNames(pattern, bindings, names = new Set()) {
  if (!pattern) return names;
  if (pattern.type === "Identifier") names.add(pattern.name);
  else if (pattern.type === "AssignmentPattern") patternNames(pattern.left, bindings, names);
  else if (pattern.type === "RestElement") patternNames(pattern.argument, bindings, names);
  else if (pattern.type === "ArrayPattern") pattern.elements.forEach((item) => patternNames(item, bindings, names));
  else if (pattern.type === "ObjectPattern") {
    pattern.properties.forEach((property) => {
      if (property.type === "RestElement") patternNames(property.argument, bindings, names);
      else {
        const keys = property.computed ? resolveValueNames(property.key, bindings).names : new Set([staticName(property.key)]);
        keys.forEach((key) => { if (key !== null) names.add(key); });
        patternNames(property.value, bindings, names);
      }
    });
  }
  return names;
}

function mutationCapabilityName(value) {
  if (typeof value !== "string") return false;
  const tokens = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((token) => NON_MUTATION_QUALIFIERS.has(token))) return false;
  if (tokens.length === 1) return MUTATION_CAPABILITIES.has(tokens[0]);
  return tokens.some((token) => MUTATION_CAPABILITIES.has(token)) && tokens.some((token) => MUTATION_ROLES.has(token));
}

function nonMutationQualifiedName(value) {
  if (typeof value !== "string") return false;
  const tokens = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((token) => NON_MUTATION_QUALIFIERS.has(token));
}

function qualifiedMutationSurfaceName(value) {
  if (typeof value !== "string") return false;
  const tokens = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((token) => MUTATION_CAPABILITIES.has(token)) && tokens.some((token) => MUTATION_ROLES.has(token));
}

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

function receiverResolution(callee, callable, bindings) {
  const result = emptyResolution();
  for (const resolved of callable.nodes) {
    if (resolved.type !== "MemberExpression") continue;
    mergeResolution(result, resolveExpression(callee.type === "MemberExpression" ? resolved.object : resolved, bindings));
  }
  if (callee.type === "MemberExpression") mergeResolution(result, resolveExpression(callee.object, bindings));
  return result;
}

function callableHasUnresolvedMethod(callee, callable, bindings) {
  let sawMember = false;
  let unresolved = false;
  for (const resolved of callable.nodes) {
    if (resolved.type !== "MemberExpression") continue;
    sawMember = true;
    const property = propertyResolution(resolved, bindings, new Set(), 0);
    unresolved ||= property.unresolved || property.exhausted;
  }
  if (!sawMember && callee.type === "MemberExpression") {
    const property = propertyResolution(callee, bindings, new Set(), 0);
    unresolved ||= property.unresolved || property.exhausted;
  }
  return unresolved;
}

function callableMethodResolution(callee, callable, bindings) {
  const result = emptyResolution();
  let sawMember = false;
  for (const resolved of callable.nodes) {
    if (resolved.type !== "MemberExpression") continue;
    sawMember = true;
    mergeMetadata(result, propertyResolution(resolved, bindings, new Set(), 0));
  }
  if (!sawMember && callee.type === "MemberExpression") {
    mergeMetadata(result, propertyResolution(callee, bindings, new Set(), 0));
  }
  return result;
}

function resolutionHasUnresolvedSelection(resolution, bindings) {
  for (const node of resolution.nodes) {
    if (node.type !== "MemberExpression") continue;
    const property = propertyResolution(node, bindings, new Set(), 0);
    if (property.unresolved || property.exhausted) return true;
  }
  return false;
}

function injectedCapabilityBinding(pattern, source, bindings) {
  if (!pattern || !source) return false;
  const resolved = resolveExpression(source, bindings);
  if (!resolved.injected) return false;
  return [...patternNames(pattern, bindings), ...resolved.origins].some(mutationCapabilityName);
}

function resolutionHasRawTextOrigin(resolution) {
  return [...resolution.origins, ...resolution.names].some((name) => RAW_TEXT_ORIGINS.has(name));
}

function callInspectsRawText(node, callable, bindings) {
  if (![...callable.names].some((name) => RAW_TEXT_INSPECTION_METHODS.has(name))) return false;
  const values = [...node.arguments];
  if (node.callee.type === "MemberExpression") values.push(node.callee.object);
  for (const resolved of callable.nodes) {
    if (resolved.type === "MemberExpression") values.push(resolved.object);
  }
  return values.some((value) => resolutionHasRawTextOrigin(resolveExpression(value, bindings)));
}

function verifyAst(file, item, root) {
  const protectedSource = /(?:diagnostic|shadow)/i.test(file);
  const shadowSource = /shadow/i.test(file);
  let sideEffect = false;
  for (const fn of item.functions) {
    if (fn.loc && fn.loc.end.line - fn.loc.start.line + 1 > MAX_FUNCTION_LINES) return failure("GOD_FUNCTION_FORBIDDEN", root, path.join(root, file));
    if (protectedSource && fn.params.some((parameter) => [...patternNames(parameter, item.bindings)].some(mutationCapabilityName))) sideEffect = true;
    let rawBranch = false; let authorityCall = false;
    walk(fn.body, (node) => {
      if (node.type === "CallExpression") {
        const callable = resolveCallable(node.callee, item.bindings);
        const isRawCall = callInspectsRawText(node, callable, item.bindings);
        rawBranch ||= isRawCall;
        if ([...callable.names].some((name) => SEMANTIC_AUTHORITIES.has(name))
          || callable.exhausted && !isRawCall) authorityCall = true;
      }
    });
    if (rawBranch && authorityCall) return failure("GOD_FUNCTION_FORBIDDEN", root, path.join(root, file));
  }
  let candidate = false;
  walk(item.ast, (node) => {
    if (protectedSource && node.type === "VariableDeclarator"
      && injectedCapabilityBinding(node.id, node.init, item.bindings)) sideEffect = true;
    if (protectedSource && node.type === "AssignmentExpression" && node.operator === "="
      && injectedCapabilityBinding(node.left, node.right, item.bindings)) sideEffect = true;
    if (node.type === "MemberExpression") {
      const property = propertyResolution(node, item.bindings, new Set(), 0);
      if (property.names.has("candidateIndex") || property.exhausted) candidate = true;
    }
    if (node.type === "Property") {
      const property = node.computed ? resolveValueNames(node.key, item.bindings) : { names: new Set([staticName(node.key)]), exhausted: false };
      if (property.names.has("candidateIndex") || property.exhausted) candidate = true;
    }
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.id.name === "candidateIndex") candidate = true;
    if (node.type === "AssignmentExpression" && node.left.type === "Identifier" && node.left.name === "candidateIndex") candidate = true;
    if (node.type === "CallExpression") {
      const callable = resolveCallable(node.callee, item.bindings);
      if (shadowSource && callable.exhausted) sideEffect = true;
      const hasMember = node.callee.type === "MemberExpression" || callable.nodes.some((item) => item.type === "MemberExpression");
      const reflectiveAccess = ["get", "set", "defineProperty"].some((name) => callable.names.has(name));
      const field = resolveValueNames(node.arguments[1], item.bindings);
      if (hasMember && (reflectiveAccess && (field.names.has("candidateIndex") || field.exhausted)
        || field.names.has("candidateIndex") && callable.exhausted)) candidate = true;
      const receiver = receiverResolution(node.callee, callable, item.bindings);
      const unresolvedSelection = resolutionHasUnresolvedSelection(receiver, item.bindings);
      const unresolvedMethod = callableHasUnresolvedMethod(node.callee, callable, item.bindings);
      const method = callableMethodResolution(node.callee, callable, item.bindings);
      const metadataQualified = [...receiver.origins].some(nonMutationQualifiedName);
      const mutatingMethod = [...callable.names].some((name) => MUTATING_METHODS.has(name));
      const allowlistedReadOnlyCollectionMethod = method.names.size > 0
        && !method.unresolved && !method.exhausted
        && [...method.names].every((name) => READ_ONLY_COLLECTION_METHODS.has(name));
      const explicitQualifiedMutation = receiver.injected
        && [...receiver.origins].some(qualifiedMutationSurfaceName)
        && mutatingMethod;
      if ([...receiver.origins].some(mutationCapabilityName)
        || ["sendLine", "writeState", "createReview", "persist", "insertReview", "replyMessage", "resolveAvailability"].some((name) => callable.names.has(name))
        || protectedSource && explicitQualifiedMutation
        || shadowSource && receiver.injected && hasMember
          && (mutatingMethod || !metadataQualified && !allowlistedReadOnlyCollectionMethod)
        || protectedSource && receiver.injected
          && (receiver.exhausted || unresolvedSelection || unresolvedMethod && !metadataQualified)) sideEffect = true;
    }
  });
  if (file !== "lib/new-core/canonical-execution-adapter.js" && candidate) return failure("CANDIDATE_INDEX_OUTSIDE_C08", root, path.join(root, file));
  if (protectedSource && sideEffect) return failure("DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN", root, path.join(root, file));
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
