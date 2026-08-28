"use strict";

const fs = require("node:fs");
const path = require("node:path");
const OWNERSHIP_MANIFEST = require("../../docs/new-core-contract-ownership.json");

const CORE_VERSION = "new-core-v1";
const MAX_UNIT_IDS = 100;
const MAX_FUNCTION_LINES = 180;
const EVENT_INPUT_FIELDS = new Set([
  "coreVersion",
  "traceId",
  "boundary",
  "inputUnitIds",
  "outputUnitIds",
  "status",
  "failureCode",
  "failureClass",
  "contextResult",
  "lifecycleResult",
  "routeResult",
  "canonicalResult",
  "targetMarker",
  "timestamp"
]);
const EVENT_FIELDS = new Set([...EVENT_INPUT_FIELDS, "isEarliestFailure"]);
const STATUSES = new Set(["SUCCESS", "FAILURE"]);
const FAILURE_CLASSES = new Set(["NONE", "CONTRACT", "PROVIDER_TIMEOUT", "DIAGNOSTIC"]);
const CONTEXT_RESULTS = new Set(["NOT_APPLICABLE", "VALIDATED", "REJECTED"]);
const LIFECYCLE_RESULTS = new Set([
  "NOT_APPLICABLE", "START", "CONTINUE", "MODIFY", "END", "NONE", "REJECTED"
]);
const ROUTE_RESULTS = new Set([
  "NOT_APPLICABLE", "ANSWER", "CLARIFY", "HANDOFF", "NO_REPLY", "REJECTED"
]);
const CANONICAL_RESULTS = new Set([
  "NOT_APPLICABLE", "NOT_REQUIRED", "ACCEPTED", "REJECTED"
]);
const CONTRACT_IDS = Object.freeze(Array.from({ length: 11 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`));
const CONTRACT_ID_SET = new Set(CONTRACT_IDS);
const COMPATIBILITY_INDEX_FIELD = ["candidate", "Index"].join("");
const SEALED_CONTRACT_GRAPH = Object.freeze({
  C01: { writer: "Turn Input Adapter", validator: "validateUnderstandingTurnInput", consumers: ["OpenAI Understanding V1"] },
  C02: { writer: "OpenAI Understanding V1", validator: "validateUnderstandingOutputV1", consumers: ["Source Evidence Validator"] },
  C03: { writer: "OpenAI Understanding V1 unit writer", validator: "validateSemanticUnit", consumers: ["Context Link Validator", "Per-unit Reply Router"] },
  C04: { writer: "Source Evidence validity writer", validator: "validateAndNormalizeSourceEvidence", consumers: ["Semantic Unit Validator", "Context Link Validator", "Diagnostic Boundary Emitter"] },
  C05: { writer: "OpenAI Understanding V1 context proposal", validator: "validateContextLink", consumers: ["Lifecycle Manager"] },
  C06: { writer: "Lifecycle Manager", validator: "validateLifecycleDecision", consumers: ["State V3 Lifecycle Adapter", "Unit Aggregator"] },
  C07: { writer: "Per-unit Reply Router", validator: "validateUnitRoutingDecision", consumers: ["Unit Aggregator", "Canonical Execution Adapter"] },
  C08: { writer: "Canonical Execution Adapter", validator: "validateCanonicalizerInputItem", consumers: ["Official canonicalizer"] },
  C09: { writer: "Unit Aggregator", validator: "validateUnitAggregationResult", consumers: ["Existing execution orchestration", "FinalDecision input adapter"] },
  C10: { writer: "Shadow Comparator", validator: "validateShadowComparisonRecord", consumers: ["Offline acceptance and reporting"] },
  C11: { writer: "Diagnostic Boundary Emitter", validator: "validateDiagnosticBoundaryEvent", consumers: ["Existing safe diagnostic persistence", "Acceptance attribution"] }
});
const SEALED_DOMAIN_OWNERS = Object.freeze(Object.fromEntries([
  ["semantic", "OpenAI Understanding V1"],
  ["evidence", "Source Evidence Validator"],
  ["capability", "existing capability registry"],
  ["reply", "Per-unit Reply Router"],
  ["context", "Context Link Validator / Lifecycle Manager"],
  ["facts", "existing Resolver and PostgreSQL providers"],
  ["memory", "existing state-v3 reducer"]
]));

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

function fixedFailure(code) {
  return Object.freeze({ ok: false, code });
}

function exactKeys(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.size
    && Object.keys(value).every((key) => fields.has(key));
}

function opaqueId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    && !/^(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-|eyJ|Bearer|Basic)/i.test(value);
}

function boundedUnitIds(value) {
  return Array.isArray(value)
    && value.length <= MAX_UNIT_IDS
    && value.every(opaqueId)
    && new Set(value).size === value.length;
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 80 && Number.isFinite(Date.parse(value));
}

function contractRecords(manifest = OWNERSHIP_MANIFEST) {
  return Array.isArray(manifest && manifest.contracts) ? manifest.contracts : [];
}

function failureOwnership(manifest = OWNERSHIP_MANIFEST) {
  const ownership = new Map();
  for (const contract of contractRecords(manifest)) {
    for (const code of Array.isArray(contract.failureCodes) ? contract.failureCodes : []) {
      if (!ownership.has(code)) ownership.set(code, contract.contractId);
      else ownership.set(code, null);
    }
  }
  return ownership;
}

function markerOwnership(manifest = OWNERSHIP_MANIFEST) {
  const ownership = new Map();
  for (const contract of contractRecords(manifest)) {
    for (const marker of Array.isArray(contract.diagnosticMarkers) ? contract.diagnosticMarkers : []) {
      if (!ownership.has(marker)) ownership.set(marker, contract.contractId);
      else ownership.set(marker, null);
    }
  }
  return ownership;
}

const FAILURE_OWNERS = failureOwnership();
const MARKER_OWNERS = markerOwnership();

function failureCodeOwner(code) {
  return FAILURE_OWNERS.get(code) || null;
}

function validateDiagnosticBoundaryEvent(value) {
  try {
    if (!exactKeys(value, EVENT_FIELDS)) return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    if (value.coreVersion !== CORE_VERSION || !opaqueId(value.traceId)
      || !boundedUnitIds(value.inputUnitIds) || !boundedUnitIds(value.outputUnitIds)
      || !STATUSES.has(value.status) || !FAILURE_CLASSES.has(value.failureClass)
      || !CONTEXT_RESULTS.has(value.contextResult) || !LIFECYCLE_RESULTS.has(value.lifecycleResult)
      || !ROUTE_RESULTS.has(value.routeResult) || !CANONICAL_RESULTS.has(value.canonicalResult)
      || typeof value.isEarliestFailure !== "boolean" || !validTimestamp(value.timestamp)) {
      return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    }
    if (!CONTRACT_ID_SET.has(value.boundary)) return fixedFailure("DIAGNOSTIC_BOUNDARY_UNKNOWN");
    if (MARKER_OWNERS.get(value.targetMarker) !== value.boundary) {
      return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    }
    if (value.status === "SUCCESS") {
      if (value.failureCode !== null || value.failureClass !== "NONE" || value.isEarliestFailure) {
        return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
      }
    } else {
      if (typeof value.failureCode !== "string"
        || failureCodeOwner(value.failureCode) !== value.boundary) {
        return fixedFailure("DIAGNOSTIC_CODE_UNOWNED");
      }
      if (value.failureClass === "NONE") return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
      if (value.failureCode === "UNDERSTANDING_PROVIDER_TIMEOUT"
        && value.failureClass !== "PROVIDER_TIMEOUT") {
        return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
      }
      if (value.failureCode !== "UNDERSTANDING_PROVIDER_TIMEOUT"
        && value.failureClass === "PROVIDER_TIMEOUT") {
        return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
      }
      const expectedFailureClass = value.failureCode === "UNDERSTANDING_PROVIDER_TIMEOUT"
        ? "PROVIDER_TIMEOUT"
        : value.boundary === "C11" ? "DIAGNOSTIC" : "CONTRACT";
      if (value.failureClass !== expectedFailureClass) return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    }
    const failureMarker = /_(REJECTED|TIMEOUT)$/.test(value.targetMarker);
    if ((value.status === "FAILURE") !== failureMarker) return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    return Object.freeze({ ok: true, code: null, value });
  } catch (_) {
    return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
  }
}

function createDiagnosticBoundaryEvent(input, { isEarliestFailure = false } = {}) {
  try {
    if (!exactKeys(input, EVENT_INPUT_FIELDS) || typeof isEarliestFailure !== "boolean") {
      return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
    }
    const value = deepFreeze({
      coreVersion: input.coreVersion,
      traceId: input.traceId,
      boundary: input.boundary,
      inputUnitIds: [...input.inputUnitIds],
      outputUnitIds: [...input.outputUnitIds],
      status: input.status,
      failureCode: input.failureCode,
      failureClass: input.failureClass,
      contextResult: input.contextResult,
      lifecycleResult: input.lifecycleResult,
      routeResult: input.routeResult,
      canonicalResult: input.canonicalResult,
      targetMarker: input.targetMarker,
      timestamp: input.timestamp,
      isEarliestFailure
    });
    const validation = validateDiagnosticBoundaryEvent(value);
    return validation.ok ? Object.freeze({ ok: true, code: null, value }) : validation;
  } catch (_) {
    return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
  }
}

function createDiagnosticTraceEmitter({ traceId, sink = null } = {}) {
  let failureObserved = false;
  return Object.freeze({
    emit(input) {
      try {
        if (!opaqueId(traceId) || !input || input.traceId !== traceId) {
          return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
        }
        const failure = input && input.status === "FAILURE";
        const earliest = Boolean(failure && !failureObserved);
        const projected = createDiagnosticBoundaryEvent(input, { isEarliestFailure: earliest });
        if (!projected.ok) return projected;
        if (failure) failureObserved = true;
        let delivered = false;
        if (typeof sink === "function") {
          try {
            sink(projected.value);
            delivered = true;
          } catch (_) {
            delivered = false;
          }
        }
        return Object.freeze({ ok: true, event: projected.value, delivered });
      } catch (_) {
        return fixedFailure("DIAGNOSTIC_FIELD_FORBIDDEN");
      }
    }
  });
}

function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      if (character === "\n") line += 1;
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") line += 1;
        index += 1;
      }
      index += 2;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      const tokenLine = line;
      let value = "";
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          if (source[index + 1] === "\n") line += 1;
          value += source[index + 1] || "";
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        if (source[index] === "\n") line += 1;
        value += source[index];
        index += 1;
      }
      tokens.push({ type: "string", value, line: tokenLine });
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const tokenLine = line;
      let value = character;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) {
        value += source[index];
        index += 1;
      }
      tokens.push({ type: "identifier", value, line: tokenLine });
      continue;
    }
    const two = source.slice(index, index + 2);
    if (["=>", "==", "!=", "<=", ">=", "&&", "||", "?."].includes(two)) {
      tokens.push({ type: "punct", value: two, line });
      index += 2;
      continue;
    }
    tokens.push({ type: "punct", value: character, line });
    index += 1;
  }
  return tokens;
}

function matchingToken(tokens, start, open, close) {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    if (tokens[index].value === close) depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function constantBracketProperty(tokens, start) {
  if (tokens[start] && tokens[start].value !== "[") return null;
  const end = matchingToken(tokens, start, "[", "]");
  if (end < 0) return null;
  let value = "";
  for (let index = start + 1; index < end; index += 1) {
    if (tokens[index].type === "string") value += tokens[index].value;
    else if (tokens[index].value !== "+") return null;
  }
  return { value, end };
}

function exportedNames(tokens) {
  const names = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    let cursor = index;
    let isExports = false;
    if (tokens[cursor] && tokens[cursor].value === "exports") {
      isExports = true;
      cursor += 1;
    } else if (tokens[cursor] && tokens[cursor].value === "module") {
      cursor += 1;
      if (tokens[cursor] && tokens[cursor].value === "." && tokens[cursor + 1] && tokens[cursor + 1].value === "exports") {
        cursor += 2;
        isExports = true;
      } else {
        const property = constantBracketProperty(tokens, cursor);
        if (property && property.value === "exports") {
          cursor = property.end + 1;
          isExports = true;
        }
      }
    }
    if (!isExports) continue;
    if (tokens[cursor] && tokens[cursor].value === "." && tokens[cursor + 1]) {
      names.add(tokens[cursor + 1].value);
    } else if (tokens[cursor] && tokens[cursor].value === "[") {
      const property = constantBracketProperty(tokens, cursor);
      if (property) names.add(property.value);
    } else if (tokens[cursor] && ["=", ","].includes(tokens[cursor].value)) {
      const open = tokens.findIndex((token, candidate) => (
        candidate > cursor && candidate <= cursor + 8 && token.value === "{"
      ));
      if (open < 0) continue;
      const end = matchingToken(tokens, open, "{", "}");
      let depth = 0;
      for (let item = open + 1; item < end; item += 1) {
        if (["{", "[", "("].includes(tokens[item].value)) depth += 1;
        if (["}", "]", ")"].includes(tokens[item].value)) depth -= 1;
        if (depth === 0 && ["identifier", "string"].includes(tokens[item].type)
          && [",", ":", "}"].includes((tokens[item + 1] || {}).value)) {
          names.add(tokens[item].value);
        }
      }
    }
  }
  return names;
}

function declaredSymbols(tokens) {
  const names = new Set();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (["function", "class", "const", "let", "var"].includes(tokens[index].value)
      && tokens[index + 1].type === "identifier") names.add(tokens[index + 1].value);
  }
  return names;
}

function functionBodies(tokens) {
  const bodies = [];
  for (let index = 0; index < tokens.length; index += 1) {
    let name = null;
    let open = -1;
    if (tokens[index].value === "function" && tokens[index + 1] && tokens[index + 1].type === "identifier") {
      name = tokens[index + 1].value;
      open = tokens.findIndex((token, candidate) => candidate > index + 1 && token.value === "{");
    } else if (["const", "let", "var"].includes(tokens[index].value)
      && tokens[index + 1] && tokens[index + 1].type === "identifier") {
      const arrow = tokens.findIndex((token, candidate) => candidate > index + 1 && candidate < index + 40 && token.value === "=>");
      if (arrow > 0) {
        name = tokens[index + 1].value;
        open = tokens[arrow + 1] && tokens[arrow + 1].value === "{" ? arrow + 1 : -1;
      }
    }
    if (name === null || open < 0) continue;
    const close = matchingToken(tokens, open, "{", "}");
    if (close < 0) continue;
    bodies.push({ name, tokens: tokens.slice(open + 1, close), startLine: tokens[index].line, endLine: tokens[close].line });
    index = open;
  }
  return bodies;
}

function objectKeySets(tokens) {
  const keySets = [];
  for (let start = 0; start < tokens.length; start += 1) {
    if (tokens[start].value !== "{") continue;
    const end = matchingToken(tokens, start, "{", "}");
    if (end < 0) continue;
    const keys = new Set();
    let depth = 0;
    for (let index = start + 1; index < end; index += 1) {
      if (depth === 0 && tokens[index].value === "[") {
        const property = constantBracketProperty(tokens, index);
        if (property && (tokens[property.end + 1] || {}).value === ":") {
          keys.add(property.value);
          index = property.end;
          continue;
        }
      }
      if (["{", "[", "("].includes(tokens[index].value)) depth += 1;
      if (["}", "]", ")"].includes(tokens[index].value)) depth -= 1;
      if (depth !== 0 || !["identifier", "string"].includes(tokens[index].type)) continue;
      if ((tokens[index + 1] || {}).value === ":") keys.add(tokens[index].value);
    }
    keySets.push(keys);
  }
  return keySets;
}

function assignedPropertyNames(tokens) {
  const names = new Set();
  for (const keys of objectKeySets(tokens)) {
    for (const key of keys) names.add(key);
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === "." && tokens[index + 1] && tokens[index + 1].type === "identifier"
      && (tokens[index + 2] || {}).value === "=") {
      names.add(tokens[index + 1].value);
    }
    if (tokens[index].value === "[") {
      const property = constantBracketProperty(tokens, index);
      if (property && (tokens[property.end + 1] || {}).value === "=") names.add(property.value);
    }
  }
  return names;
}

function hasCompatibilityIndex(tokens) {
  if (tokens.some((token) => token.type === "identifier" && token.value === COMPATIBILITY_INDEX_FIELD)) return true;
  return tokens.some((token, index) => {
    if (token.value !== "[") return false;
    const property = constantBracketProperty(tokens, index);
    return property && property.value === COMPATIBILITY_INDEX_FIELD;
  });
}

function sourceFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && /\.(?:c?js|mjs)$/.test(entry.name)) files.push(absolute);
    }
  }
  if (fs.existsSync(root)) visit(root);
  return files.sort();
}

function relativeFile(projectRoot, file) {
  const relative = path.relative(projectRoot, file).replaceAll(path.sep, "/");
  return relative || path.basename(file);
}

function gateFailure(code, projectRoot, file) {
  return deepFreeze({ ok: false, code, file: relativeFile(projectRoot, file) });
}

function validRole(role) {
  return Boolean(role) && typeof role === "object" && !Array.isArray(role)
    && typeof role.name === "string" && role.name.length > 0
    && typeof role.source === "string" && /^(?:lib|tests|scripts)\/[A-Za-z0-9_./-]+$/.test(role.source)
    && !role.source.split("/").includes("..") && !path.isAbsolute(role.source)
    && typeof role.symbol === "string" && /^[A-Za-z_$][A-Za-z0-9_$]{0,159}$/.test(role.symbol)
    && /^(implemented|planned_task_(11|12|13|14|15))$/.test(role.status);
}

function readManifest(manifestPath, projectRoot) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return { ok: true, manifest };
  } catch (_) {
    return gateFailure("OWNERSHIP_MANIFEST_INVALID", projectRoot, manifestPath);
  }
}

function validateManifest(manifest, projectRoot, manifestPath) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.coreVersion !== CORE_VERSION
    || !Array.isArray(manifest.contracts) || !Array.isArray(manifest.domainAuthorities)) {
    return gateFailure("OWNERSHIP_MANIFEST_INVALID", projectRoot, manifestPath);
  }
  const ids = manifest.contracts.map((entry) => entry && entry.contractId);
  if (ids.length !== CONTRACT_IDS.length || new Set(ids).size !== ids.length
    || CONTRACT_IDS.some((id) => !ids.includes(id))) {
    return gateFailure("CONTRACT_COVERAGE_INCOMPLETE", projectRoot, manifestPath);
  }
  const failureOwners = new Map();
  const markers = new Set();
  for (const contract of manifest.contracts) {
    if (typeof contract.responsibility !== "string" || !validRole(contract.writer)
      || !validRole(contract.validator) || !Array.isArray(contract.consumers)
      || !contract.consumers.length || !contract.consumers.every(validRole)
      || new Set(contract.consumers.map((item) => `${item.source}\u0000${item.symbol}`)).size !== contract.consumers.length
      || contract.failureOwner !== contract.validator.symbol
      || !Array.isArray(contract.failureCodes) || !contract.failureCodes.length
      || !Array.isArray(contract.diagnosticMarkers) || !contract.diagnosticMarkers.length) {
      return gateFailure("OWNERSHIP_MANIFEST_INVALID", projectRoot, manifestPath);
    }
    for (const code of contract.failureCodes) {
      if (typeof code !== "string" || !code.length || failureOwners.has(code)) {
        return gateFailure("DUPLICATE_FAILURE_CODE_OWNER", projectRoot, manifestPath);
      }
      failureOwners.set(code, contract.contractId);
    }
    for (const marker of contract.diagnosticMarkers) {
      if (typeof marker !== "string" || !marker.startsWith(`${contract.contractId}_`) || markers.has(marker)) {
        return gateFailure("OWNERSHIP_MANIFEST_INVALID", projectRoot, manifestPath);
      }
      markers.add(marker);
    }
    const sealed = SEALED_CONTRACT_GRAPH[contract.contractId];
    if (!sealed || contract.writer.name !== sealed.writer || contract.validator.symbol !== sealed.validator
      || JSON.stringify(contract.consumers.map((consumer) => consumer.name)) !== JSON.stringify(sealed.consumers)) {
      return gateFailure("CONTRACT_GRAPH_MISMATCH", projectRoot, manifestPath);
    }
  }
  const authorityNames = manifest.domainAuthorities.map((entry) => entry && entry.authority);
  const expectedAuthorities = ["semantic", "evidence", "capability", "reply", "context", "facts", "memory"];
  if (authorityNames.length !== expectedAuthorities.length || new Set(authorityNames).size !== authorityNames.length
    || expectedAuthorities.some((name) => !authorityNames.includes(name))
    || manifest.domainAuthorities.some((entry) => !CONTRACT_ID_SET.has(entry.contractId)
      || entry.owner !== SEALED_DOMAIN_OWNERS[entry.authority])) {
    return gateFailure("DOMAIN_AUTHORITY_REGISTRY_INVALID", projectRoot, manifestPath);
  }
  return { ok: true };
}

function verifyImplementedRoles(manifest, projectRoot, tokenByFile) {
  for (const contract of manifest.contracts) {
    const roles = [
      [contract.writer, "CONTRACT_WRITER_MISSING"],
      [contract.validator, "CONTRACT_VALIDATOR_MISSING"],
      ...contract.consumers.map((consumer) => [consumer, "CONTRACT_CONSUMER_MISSING"])
    ];
    for (const [role, code] of roles) {
      if (role.status !== "implemented") continue;
      const tokens = tokenByFile.get(role.source);
      if (!tokens || !declaredSymbols(tokens).has(role.symbol)) {
        return gateFailure(code, projectRoot, path.join(projectRoot, role.source));
      }
    }
  }
  return { ok: true };
}

function verifyDuplicateWriters(manifest, projectRoot, tokenByFile) {
  for (const contract of manifest.contracts) {
    if (contract.writer.status !== "implemented") continue;
    for (const [file, tokens] of tokenByFile) {
      if (file !== contract.writer.source && exportedNames(tokens).has(contract.writer.symbol)) {
        return gateFailure("DUPLICATE_CONTRACT_WRITER", projectRoot, path.join(projectRoot, file));
      }
    }
  }
  return { ok: true };
}

const AUTHORITY_SIGNATURES = Object.freeze([
  { name: "semantic", keys: ["purpose", "capability", "subject", "stayDependent"], allowed: new Set(["lib/new-core/contracts/canonicalizer-input-item.js", "lib/new-core/canonical-execution-adapter.js"]) },
  { name: "evidence", keys: ["startOffset", "endOffset", "quote"], allowed: new Set(["lib/new-core/source-evidence-validator.js"]) },
  { name: "capability", keys: ["requestKind", "exactRequiredFields"], allowed: new Set(["lib/new-core/capability-subject-policy.js"]) },
  { name: "reply", keys: ["disposition", "requiresCanonicalExecution"], allowed: new Set(["lib/new-core/unit-reply-router.js"]) },
  { name: "context", keys: ["actionCandidate", "targetRequestCycleId"], allowed: new Set(["lib/new-core/context-link-validator.js"]) },
  { name: "facts", keys: ["facts"], allowed: new Set([]) },
  { name: "memory", keys: ["confirmedFields", "lifecycleOperations"], allowed: new Set(["lib/new-core/state-v3-lifecycle-adapter.js"]) }
]);

function verifyAuthorityShapes(projectRoot, tokenByFile) {
  for (const [file, tokens] of tokenByFile) {
    const keySets = objectKeySets(tokens);
    const assignedKeys = assignedPropertyNames(tokens);
    for (const signature of AUTHORITY_SIGNATURES) {
      if (!signature.allowed.has(file)
        && (keySets.some((keys) => signature.keys.every((key) => keys.has(key)))
          || signature.keys.every((key) => assignedKeys.has(key)))) {
        return deepFreeze({
          ...gateFailure("DUPLICATE_DOMAIN_AUTHORITY", projectRoot, path.join(projectRoot, file)),
          authority: signature.name
        });
      }
    }
  }
  return { ok: true };
}

function verifyFunctions(projectRoot, tokenByFile) {
  const rawMeaningTokens = new Set(["messageText", "guestText", "rawText", "quote"]);
  const semanticBranchTokens = new Set(["includes", "match", "test", "startsWith", "endsWith"]);
  const authorityCalls = new Set([
    "validateSemanticUnit",
    "validateAndNormalizeSourceEvidence",
    "validateContextLink",
    "createLifecycleDecision",
    "createUnitRoutingDecision",
    "createCanonicalizerInputItem",
    "executeCanonicalizerInputItem",
    "canonicalizeExecutionItem",
    "resolveAvailability"
  ]);
  for (const [file, tokens] of tokenByFile) {
    for (const body of functionBodies(tokens)) {
      const names = new Set(body.tokens.filter((token) => token.type === "identifier").map((token) => token.value));
      const interpretsRawMeaning = [...rawMeaningTokens].some((name) => names.has(name))
        && [...semanticBranchTokens].some((name) => names.has(name));
      const crossesAuthority = [...authorityCalls].some((name) => names.has(name));
      if (body.endLine - body.startLine + 1 > MAX_FUNCTION_LINES
        || interpretsRawMeaning && crossesAuthority) {
        return gateFailure("GOD_FUNCTION_FORBIDDEN", projectRoot, path.join(projectRoot, file));
      }
    }
  }
  return { ok: true };
}

function verifyCompatibilityIndex(projectRoot, tokenByFile) {
  for (const [file, tokens] of tokenByFile) {
    if (file !== "lib/new-core/canonical-execution-adapter.js" && hasCompatibilityIndex(tokens)) {
      return gateFailure("CANDIDATE_INDEX_OUTSIDE_C08", projectRoot, path.join(projectRoot, file));
    }
  }
  return { ok: true };
}

function verifyDiagnosticIsolation(projectRoot, tokenByFile) {
  const sideEffectTokens = new Set([
    "database", "resolver", "sendLine", "writeState", "createReview", "persist", "insertReview"
  ]);
  for (const [file, tokens] of tokenByFile) {
    if (!path.basename(file).includes("diagnostic")) continue;
    if (tokens.some((token) => token.type === "identifier" && sideEffectTokens.has(token.value))) {
      return gateFailure("DIAGNOSTIC_SIDE_EFFECT_FORBIDDEN", projectRoot, path.join(projectRoot, file));
    }
  }
  return { ok: true };
}

function verifyNewCoreMaintainability({ projectRoot, manifestPath } = {}) {
  const boundedRoot = typeof projectRoot === "string" ? path.resolve(projectRoot) : "";
  const boundedManifestPath = typeof manifestPath === "string" ? path.resolve(manifestPath) : "";
  if (!boundedRoot || !boundedManifestPath) return gateFailure("OWNERSHIP_MANIFEST_INVALID", boundedRoot || process.cwd(), boundedManifestPath || "manifest");
  const loaded = readManifest(boundedManifestPath, boundedRoot);
  if (!loaded.ok) return loaded;
  const manifestValidation = validateManifest(loaded.manifest, boundedRoot, boundedManifestPath);
  if (!manifestValidation.ok) return manifestValidation;
  const newCoreRoot = path.join(boundedRoot, "lib", "new-core");
  const tokenByFile = new Map();
  try {
    for (const file of sourceFiles(newCoreRoot)) {
      tokenByFile.set(relativeFile(boundedRoot, file), tokenizeJavaScript(fs.readFileSync(file, "utf8")));
    }
  } catch (_) {
    return gateFailure("SOURCE_INSPECTION_FAILED", boundedRoot, newCoreRoot);
  }
  for (const check of [
    verifyImplementedRoles(loaded.manifest, boundedRoot, tokenByFile),
    verifyDuplicateWriters(loaded.manifest, boundedRoot, tokenByFile),
    verifyAuthorityShapes(boundedRoot, tokenByFile),
    verifyFunctions(boundedRoot, tokenByFile),
    verifyCompatibilityIndex(boundedRoot, tokenByFile),
    verifyDiagnosticIsolation(boundedRoot, tokenByFile)
  ]) {
    if (!check.ok) return check;
  }
  const plannedValidators = loaded.manifest.contracts
    .filter((entry) => entry.validator.status !== "implemented")
    .map((entry) => ({
      contractId: entry.contractId,
      task: Number(entry.validator.status.slice("planned_task_".length))
    }));
  return deepFreeze({
    ok: true,
    contractIds: [...CONTRACT_IDS],
    validatorCoverage: {
      implemented: loaded.manifest.contracts.length - plannedValidators.length,
      planned: plannedValidators
    }
  });
}

module.exports = {
  CORE_VERSION,
  createDiagnosticBoundaryEvent,
  createDiagnosticTraceEmitter,
  failureCodeOwner,
  validateDiagnosticBoundaryEvent,
  verifyNewCoreMaintainability
};
