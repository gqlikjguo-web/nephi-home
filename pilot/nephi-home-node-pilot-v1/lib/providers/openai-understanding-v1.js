"use strict";

const crypto = require("node:crypto");
const { CAPABILITY_REGISTRY } = require("../conversation-engine-v2/capability-registry");
const {
  validateUnderstandingTurnInput
} = require("../new-core/contracts/understanding-turn-input");
const {
  MAX_UNITS,
  validateUnderstandingOutputV1
} = require("../new-core/contracts/understanding-output-v1");
const {
  MAX_SLOT_CANDIDATES,
  PURPOSES,
  CAPABILITIES,
  SUBJECT_KINDS,
  REPLY_DISPOSITIONS,
  CONFIDENCE_BANDS,
  TEMPORAL_KINDS,
  SLOT_NAMES,
  SLOT_OPERATIONS
} = require("../new-core/contracts/semantic-unit-candidate");
const {
  MAX_EVIDENCE_REFS
} = require("../new-core/contracts/source-evidence");
const {
  MAX_CONTEXT_LINKS,
  ACTION_CANDIDATES,
  validateContextLinkCandidates
} = require("../new-core/contracts/context-link-candidate");
const {
  buildPublicCatalogIdentityProjection
} = require("../new-core/turn-input-adapter");
const {
  validateAndNormalizeSourceEvidence
} = require("../new-core/source-evidence-validator");
const {
  buildPublicCatalogIdentitySet,
  projectCapabilityRegistry,
  validateSemanticUnit
} = require("../new-core/semantic-unit-validator");
const { validateContextLink } = require("../new-core/context-link-validator");
const { createDiagnosticTraceEmitter } = require("../new-core/diagnostic-boundary");

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const PROVIDER_NAME = "openai";
const DEFAULT_PROVIDER_TIMEOUT_MS = 30000;
const DEFAULT_RETRY_DELAY_MS = 750;
const MAX_RETRY_DELAY_MS = 1000;
const MAX_PROVIDER_ATTEMPTS = 2;
const MAX_ID_LENGTH = 160;
const MAX_QUOTE_LENGTH = 500;
const RETRYABLE_TRANSPORT_CATEGORIES = new Set(["timeout", "network", "rate_limit", "provider_5xx"]);
const OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC = Symbol.for("junzan.openAiUnderstandingV1ProviderDiagnostic");
const INTERNAL_PROVIDER_FAILURE = Symbol("openAiUnderstandingV1ProviderFailure");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value) || Object.isFrozen(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function detach(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(detach);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, detach(item)]));
}

function exactKeys(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((key) => fields.includes(key));
}

function safeToken(value, limit = 160) {
  const token = String(value || "");
  return /^[A-Za-z0-9._:-]+$/.test(token) ? token.slice(0, limit) : "";
}

function boundedPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.floor(number)) : fallback;
}

function boundedRetryDelay(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.min(MAX_RETRY_DELAY_MS, Math.floor(number))
    : DEFAULT_RETRY_DELAY_MS;
}

function waitForRetry(delayMs) {
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
}

function timestamp(nowMs) {
  const value = Number(nowMs());
  return new Date(Number.isFinite(value) ? value : Date.now()).toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function stringSchema(maxLength = MAX_ID_LENGTH, description) {
  return {
    type: "string",
    minLength: 1,
    maxLength,
    ...(description ? { description } : {})
  };
}

function nullableStringSchema(maxLength = MAX_ID_LENGTH, description) {
  return {
    type: ["string", "null"],
    maxLength,
    ...(description ? { description } : {})
  };
}

function enumSchema(values, description) {
  const items = [...values];
  const primitiveTypes = [...new Set(items.map((value) => value === null ? "null" : typeof value))]
    .map((type) => type === "number" ? "integer" : type);
  return {
    type: primitiveTypes.length === 1 ? primitiveTypes[0] : primitiveTypes,
    enum: items,
    ...(description ? { description } : {})
  };
}

function objectSchema(properties, description) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
    ...(description ? { description } : {})
  };
}

function arraySchema(items, { minItems = 0, maxItems, description } = {}) {
  return {
    type: "array",
    items,
    minItems,
    ...(Number.isInteger(maxItems) ? { maxItems } : {}),
    ...(description ? { description } : {})
  };
}

function evidenceSchema() {
  return objectSchema({
    eventId: stringSchema(),
    messageRef: stringSchema(),
    startOffset: { type: "integer", minimum: 0 },
    endOffset: { type: "integer", minimum: 0 },
    quote: stringSchema(MAX_QUOTE_LENGTH, "Exact UTF-16 source substring; never paraphrase or normalize.")
  }, "One source-bound evidence span from C01 sourceEvents.");
}

function evidenceArraySchema() {
  return arraySchema(evidenceSchema(), { minItems: 1, maxItems: MAX_EVIDENCE_REFS });
}

function temporalCandidateSchema() {
  return {
    anyOf: [
      { type: "null" },
      objectSchema({
        rawText: stringSchema(MAX_QUOTE_LENGTH),
        kind: enumSchema(TEMPORAL_KINDS),
        checkInCandidate: nullableStringSchema(80),
        checkOutCandidate: nullableStringSchema(80),
        nightsCandidate: { type: ["integer", "null"], minimum: 1 }
      }, "Source meaning only. Do not add an implicit year or executable date.")
    ]
  };
}

function slotCandidateSchema() {
  return objectSchema({
    slotCandidateId: stringSchema(),
    slot: enumSchema(SLOT_NAMES),
    operation: enumSchema(SLOT_OPERATIONS),
    value: { type: ["string", "integer", "boolean", "null"] },
    evidenceRefs: evidenceArraySchema()
  }, "A source-bound slot proposal only; it is not a state mutation.");
}

function semanticUnitSchema(understandingTurnInput) {
  const catalogIdentities = understandingTurnInput.publicSubjectCatalog.map((subject) => subject.catalogIdentity);
  return objectSchema({
    unitId: stringSchema(),
    evidenceRefs: evidenceArraySchema(),
    purpose: enumSchema(PURPOSES, "One independent source meaning; do not merge separately actionable meanings."),
    capability: enumSchema(CAPABILITIES, "Language-derived capability candidate only; never answer facts."),
    subject: objectSchema({
      kind: enumSchema(SUBJECT_KINDS),
      catalogIdentity: {
        type: ["string", "null"],
        enum: [...new Set([...catalogIdentities, null])],
        maxLength: MAX_ID_LENGTH
      }
    }),
    stayDependent: { type: "boolean" },
    temporalCandidate: temporalCandidateSchema(),
    contextLinkCandidateId: stringSchema(),
    replyCandidate: objectSchema({
      disposition: enumSchema(REPLY_DISPOSITIONS),
      reasonClass: stringSchema()
    }, "A language-derived proposal; deterministic routing remains a later authority."),
    slotCandidates: arraySchema(slotCandidateSchema(), { maxItems: MAX_SLOT_CANDIDATES }),
    confidenceBand: enumSchema(CONFIDENCE_BANDS)
  }, "Exactly one immutable semantic candidate. Do not emit facts, canonical dates, resolver data, state writes, or final copy.");
}

function contextLinkSchema(understandingTurnInput) {
  const cycleIds = understandingTurnInput.referenceableCycles.map((cycle) => cycle.requestCycleId);
  return objectSchema({
    contextLinkCandidateId: stringSchema(),
    unitId: stringSchema(),
    actionCandidate: enumSchema(ACTION_CANDIDATES),
    targetRequestCycleId: {
      type: ["string", "null"],
      enum: [...new Set([...cycleIds, null])],
      maxLength: MAX_ID_LENGTH
    },
    evidenceRefs: evidenceArraySchema()
  }, "One language-derived Context proposal for one unit; never guess a target not present in C01.");
}

function openAiUnderstandingV1ProviderSchema(understandingTurnInput) {
  return objectSchema({
    understandingOutput: objectSchema({
      schemaVersion: { type: "integer", enum: [1] },
      turnId: { type: "string", enum: [understandingTurnInput.turnId], maxLength: MAX_ID_LENGTH },
      units: arraySchema(semanticUnitSchema(understandingTurnInput), { maxItems: MAX_UNITS })
    }),
    contextLinkCandidates: arraySchema(contextLinkSchema(understandingTurnInput), { maxItems: MAX_CONTEXT_LINKS })
  }, "One complete C02-C05 candidate envelope for this C01 turn.");
}

function instructions() {
  return [
    "You are JunZan AI Understanding V1 for Taiwan lodging conversations.",
    "Return exactly one response matching the supplied strict schema.",
    "Split every independent source meaning into one unit and emit exactly one matching context-link candidate per unit.",
    "Use only the bounded C01 source events, recent conversation, referenceable cycles, capability catalog, and public subject catalog supplied by the developer message.",
    "Recent conversation helps interpret language and references but is never a property-fact source. Evidence must cite exact C01 sourceEvents UTF-16 coordinates and quote text.",
    "Capability, subject, stay dependency, reply proposal, and Context action are independent candidates. Do not derive one merely from another.",
    "Temporal candidates preserve source meaning only. Do not invent an implicit year, canonical date, availability, price, policy truth, amenity truth, location fact, or any other formal fact.",
    "Do not emit resolver IDs, query plans, state mutations, final reply text, message-level routing, task indexes, credentials, private data, or fields outside the schema.",
    "When meaning or reference is uncertain, preserve that uncertainty in the declared candidate fields; never invent a catalog identity or Context target.",
    "Before returning, verify that every unit and context link has unique matching IDs and exact source evidence, and that no independently meaningful source request was omitted or merged."
  ].join("\n");
}

function providerRequestBody(understandingTurnInput, model) {
  return {
    model,
    safety_identifier: sha256(understandingTurnInput.propertyScope.userId),
    input: [
      { role: "system", content: [{ type: "input_text", text: instructions() }] },
      { role: "developer", content: [{ type: "input_text", text: JSON.stringify(understandingTurnInput) }] }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "junzan_understanding_v1",
        strict: true,
        schema: openAiUnderstandingV1ProviderSchema(understandingTurnInput)
      }
    }
  };
}

function outputText(payload) {
  if (payload && typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload && Array.isArray(payload.output) ? payload.output : []) {
    for (const part of Array.isArray(item && item.content) ? item.content : []) {
      if (part && part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

function structuredOutputFailed(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (["incomplete", "failed"].includes(payload.status)) return true;
  return (Array.isArray(payload.output) ? payload.output : []).some((item) =>
    (Array.isArray(item && item.content) ? item.content : []).some((part) => part && part.type === "refusal"));
}

async function readProviderPayload(response) {
  let raw = "";
  if (response && typeof response.text === "function") {
    try { raw = String(await response.text() || ""); }
    catch { return { bodyPresent: false, parseFailed: true, payload: null }; }
  } else if (response && typeof response.json === "function") {
    try {
      const payload = await response.json();
      return { bodyPresent: payload !== null && payload !== undefined, parseFailed: false, payload };
    } catch { return { bodyPresent: false, parseFailed: true, payload: null }; }
  }
  if (!raw) return { bodyPresent: false, parseFailed: false, payload: null };
  try { return { bodyPresent: true, parseFailed: false, payload: JSON.parse(raw) }; }
  catch { return { bodyPresent: true, parseFailed: true, payload: null }; }
}

function providerFailure(code, category, { timeout = false, retryable = false, status = 0, providerError = {} } = {}) {
  const error = new Error(code);
  error.code = code;
  error.errorCategory = category;
  error.provider = PROVIDER_NAME;
  error.timeout = Boolean(timeout);
  error.retryable = Boolean(retryable);
  error.httpStatus = Number.isInteger(status) ? status : 0;
  error.providerErrorType = safeToken(providerError.type, 120);
  error.providerErrorCode = safeToken(providerError.code, 120);
  error.providerErrorParam = safeToken(providerError.param, 200);
  Object.defineProperty(error, INTERNAL_PROVIDER_FAILURE, { value: true });
  return error;
}

function providerErrorFromPayload(payload) {
  return payload && payload.error && typeof payload.error === "object" ? payload.error : {};
}

function httpFailure(status, payload) {
  if (status === 429) {
    return providerFailure("UNDERSTANDING_SCHEMA_INVALID", "rate_limit", {
      retryable: true, status, providerError: providerErrorFromPayload(payload)
    });
  }
  if (status >= 500 && status <= 599) {
    return providerFailure("UNDERSTANDING_SCHEMA_INVALID", "provider_5xx", {
      retryable: true, status, providerError: providerErrorFromPayload(payload)
    });
  }
  return providerFailure("UNDERSTANDING_SCHEMA_INVALID", "provider_4xx", {
    status, providerError: providerErrorFromPayload(payload)
  });
}

function safeAttempt(details) {
  return deepFreeze({
    attemptNumber: details.attemptNumber,
    timeoutMs: details.timeoutMs,
    timeout: Boolean(details.timeout),
    retryable: Boolean(details.retryable),
    errorCategory: details.errorCategory,
    httpStatus: details.httpStatus,
    providerRequestId: safeToken(details.providerRequestId, 200),
    responseBodyPresent: Boolean(details.responseBodyPresent),
    parsedOutputPresent: Boolean(details.parsedOutputPresent)
  });
}

function providerDiagnostic(attempts) {
  const values = attempts.slice(0, MAX_PROVIDER_ATTEMPTS).map(safeAttempt);
  const retried = values.length > 1;
  return deepFreeze({
    providerAttemptCount: values.length,
    retryPerformed: retried,
    retrySucceeded: retried && values.at(-1).errorCategory === "",
    providerAttempts: values
  });
}

async function requestOnce({ apiKey, model, fetchImpl, timeoutMs, requestIdFactory, understandingTurnInput }, attemptNumber) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let httpStatus = 0;
  let providerRequestId = "";
  let responseBodyPresent = false;
  let parsedOutputPresent = false;
  try {
    const generatedId = String(requestIdFactory() || "");
    const clientRequestId = UUID_PATTERN.test(generatedId) ? generatedId : crypto.randomUUID();
    const response = await fetchImpl(RESPONSES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "X-Client-Request-Id": clientRequestId
      },
      signal: controller.signal,
      body: JSON.stringify(providerRequestBody(understandingTurnInput, model))
    });
    httpStatus = Number.isInteger(Number(response && (response.status || response.statusCode)))
      ? Number(response.status || response.statusCode) : 0;
    try {
      providerRequestId = safeToken(response && response.headers && response.headers.get("x-request-id"), 200);
    } catch { providerRequestId = ""; }
    const read = await readProviderPayload(response);
    responseBodyPresent = read.bodyPresent;
    if (!response || !response.ok) throw httpFailure(httpStatus, read.payload);
    if (read.parseFailed || !read.bodyPresent) {
      throw providerFailure("UNDERSTANDING_SCHEMA_INVALID", "parse_failure", { status: httpStatus });
    }
    const text = outputText(read.payload);
    if (!text && structuredOutputFailed(read.payload)) {
      throw providerFailure("UNDERSTANDING_SCHEMA_INVALID", "structured_output_failure", { status: httpStatus });
    }
    if (!text) throw providerFailure("UNDERSTANDING_SCHEMA_INVALID", "empty_response", { status: httpStatus });
    try {
      const value = JSON.parse(text);
      parsedOutputPresent = true;
      return {
        value,
        attempt: safeAttempt({
          attemptNumber, timeoutMs, timeout: false, retryable: false, errorCategory: "",
          httpStatus, providerRequestId, responseBodyPresent, parsedOutputPresent
        })
      };
    } catch {
      throw providerFailure("UNDERSTANDING_SCHEMA_INVALID", "parse_failure", { status: httpStatus });
    }
  } catch (caught) {
    let error = caught;
    if (!error || typeof error !== "object" || error[INTERNAL_PROVIDER_FAILURE] !== true) {
      error = caught && caught.name === "AbortError"
        ? providerFailure("UNDERSTANDING_PROVIDER_TIMEOUT", "timeout", { timeout: true, retryable: true })
        : providerFailure("UNDERSTANDING_SCHEMA_INVALID", "network", { retryable: true });
    }
    error.providerAttempt = safeAttempt({
      attemptNumber,
      timeoutMs,
      timeout: error.timeout,
      retryable: error.retryable,
      errorCategory: error.errorCategory,
      httpStatus,
      providerRequestId,
      responseBodyPresent,
      parsedOutputPresent
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function understandingError(code, providerAttempts) {
  const error = new Error(code);
  error.code = code;
  error.provider = PROVIDER_NAME;
  if (providerAttempts) {
    Object.defineProperty(error, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC, {
      enumerable: false,
      value: providerDiagnostic(providerAttempts)
    });
  }
  return error;
}

function diagnosticInput(input, {
  boundary,
  unitIds = [],
  outputUnitIds = unitIds,
  status = "SUCCESS",
  code = null,
  marker,
  contextResult = "NOT_APPLICABLE",
  nowMs
}) {
  return {
    coreVersion: input.coreVersion,
    traceId: input.traceId,
    boundary,
    inputUnitIds: unitIds,
    outputUnitIds,
    status,
    failureCode: code,
    failureClass: status === "SUCCESS" ? "NONE"
      : code === "UNDERSTANDING_PROVIDER_TIMEOUT" ? "PROVIDER_TIMEOUT" : "CONTRACT",
    contextResult,
    lifecycleResult: "NOT_APPLICABLE",
    routeResult: "NOT_APPLICABLE",
    canonicalResult: "NOT_APPLICABLE",
    targetMarker: marker,
    timestamp: timestamp(nowMs)
  };
}

function emit(traceEmitter, input, details) {
  traceEmitter.emit(diagnosticInput(input, details));
}

function envelopeWireFailure(value, understandingTurnInput) {
  if (!exactKeys(value, ["understandingOutput", "contextLinkCandidates"])) return "UNKNOWN_WIRE_FIELD";
  const outputValidation = validateUnderstandingOutputV1(value.understandingOutput);
  if (!outputValidation.ok) return outputValidation.code;
  if (value.understandingOutput.turnId !== understandingTurnInput.turnId) return "UNDERSTANDING_SCHEMA_INVALID";
  const linksValidation = validateContextLinkCandidates(value.contextLinkCandidates);
  if (!linksValidation.ok) {
    if (linksValidation.code === "CONTEXT_LINK_DUPLICATE") return linksValidation.code;
    if (["UNKNOWN_WIRE_FIELD", "UNDERSTANDING_CARDINALITY_INVALID"].includes(linksValidation.code)) {
      return linksValidation.code;
    }
    return "UNDERSTANDING_SCHEMA_INVALID";
  }
  const units = value.understandingOutput.units;
  const links = value.contextLinkCandidates;
  if (units.length !== links.length) return "UNDERSTANDING_SCHEMA_INVALID";
  const linkById = new Map(links.map((link) => [link.contextLinkCandidateId, link]));
  if (linkById.size !== links.length || units.some((unit) => {
    const link = linkById.get(unit.contextLinkCandidateId);
    return !link || link.unitId !== unit.unitId;
  })) return "UNDERSTANDING_SCHEMA_INVALID";
  return null;
}

function normalizeUnitEvidence(unit, linkCandidates, sourceEvents) {
  const unitEvidence = validateAndNormalizeSourceEvidence(unit.evidenceRefs, sourceEvents);
  if (!unitEvidence.ok) return unitEvidence;
  const slotCandidates = [];
  const validatedEvidenceRefs = [...unitEvidence.value];
  for (const slot of unit.slotCandidates) {
    const slotEvidence = validateAndNormalizeSourceEvidence(slot.evidenceRefs, sourceEvents);
    if (!slotEvidence.ok) return slotEvidence;
    validatedEvidenceRefs.push(...slotEvidence.value);
    slotCandidates.push({ ...slot, evidenceRefs: slotEvidence.value });
  }
  const normalizedLinkCandidates = [];
  for (const linkCandidate of linkCandidates) {
    const linkEvidence = validateAndNormalizeSourceEvidence(linkCandidate.evidenceRefs, sourceEvents);
    if (!linkEvidence.ok) return linkEvidence;
    validatedEvidenceRefs.push(...linkEvidence.value);
    normalizedLinkCandidates.push({ ...linkCandidate, evidenceRefs: linkEvidence.value });
  }
  return {
    ok: true,
    value: {
      unit: { ...unit, evidenceRefs: unitEvidence.value, slotCandidates },
      linkCandidates: normalizedLinkCandidates,
      validatedEvidenceRefs
    }
  };
}

async function callOpenAIUnderstandingV1(understandingTurnInput, options = {}) {
  const inputValidation = validateUnderstandingTurnInput(understandingTurnInput);
  if (!inputValidation.ok) throw understandingError(inputValidation.code);
  if (!buildPublicCatalogIdentityProjection(understandingTurnInput)) {
    throw understandingError("PROPERTY_SCOPE_INVALID");
  }
  const apiKey = String(options.apiKey || "").trim();
  const model = String(options.model || "").trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!apiKey || !model || typeof fetchImpl !== "function") {
    throw understandingError("UNDERSTANDING_SCHEMA_INVALID");
  }
  const timeoutMs = boundedPositiveInteger(options.timeoutMs, DEFAULT_PROVIDER_TIMEOUT_MS);
  const retryDelayMs = boundedRetryDelay(options.retryDelayMs);
  const waitImpl = typeof options.waitImpl === "function" ? options.waitImpl : waitForRetry;
  const requestIdFactory = typeof options.requestIdFactory === "function" ? options.requestIdFactory : crypto.randomUUID;
  const nowMs = typeof options.nowMs === "function" ? options.nowMs : Date.now;
  const defaultRoundTimeoutMs = timeoutMs * MAX_PROVIDER_ATTEMPTS + retryDelayMs + 1000;
  const roundTimeoutMs = Math.min(
    boundedPositiveInteger(options.roundTimeoutMs, defaultRoundTimeoutMs),
    defaultRoundTimeoutMs
  );
  const deadlineMs = Date.now() + roundTimeoutMs;
  const traceEmitter = createDiagnosticTraceEmitter({
    traceId: understandingTurnInput.traceId,
    sink: typeof options.onDiagnostic === "function" ? options.onDiagnostic : null
  });
  const attempts = [];
  let providerValue;
  for (let attemptNumber = 1; attemptNumber <= MAX_PROVIDER_ATTEMPTS; attemptNumber += 1) {
    const remainingMs = Math.floor(deadlineMs - Date.now());
    if (remainingMs <= 0) {
      const timeoutError = understandingError("UNDERSTANDING_PROVIDER_TIMEOUT", attempts);
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C02", unitIds: [], outputUnitIds: [], status: "FAILURE",
        code: timeoutError.code, marker: "C02_PROVIDER_TIMEOUT", nowMs
      });
      throw timeoutError;
    }
    try {
      const response = await requestOnce({
        apiKey,
        model,
        fetchImpl,
        timeoutMs: Math.min(timeoutMs, remainingMs),
        requestIdFactory,
        understandingTurnInput
      }, attemptNumber);
      attempts.push(response.attempt);
      providerValue = response.value;
      break;
    } catch (error) {
      if (error.providerAttempt) attempts.push(error.providerAttempt);
      const shouldRetry = attemptNumber === 1
        && error.retryable === true
        && RETRYABLE_TRANSPORT_CATEGORIES.has(error.errorCategory);
      if (shouldRetry) {
        await waitImpl(retryDelayMs);
        continue;
      }
      const code = error.code === "UNDERSTANDING_PROVIDER_TIMEOUT"
        ? "UNDERSTANDING_PROVIDER_TIMEOUT" : "UNDERSTANDING_SCHEMA_INVALID";
      const finalError = understandingError(code, attempts);
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C02", unitIds: [], outputUnitIds: [], status: "FAILURE", code,
        marker: code === "UNDERSTANDING_PROVIDER_TIMEOUT" ? "C02_PROVIDER_TIMEOUT" : "C02_WIRE_SCHEMA_REJECTED",
        nowMs
      });
      throw finalError;
    }
  }

  const wireCode = envelopeWireFailure(providerValue, understandingTurnInput);
  if (wireCode) {
    if (wireCode === "CONTEXT_LINK_DUPLICATE") {
      const rawDuplicateUnits = providerValue.understandingOutput.units;
      const rawDuplicateLinks = providerValue.contextLinkCandidates;
      const duplicateUnitIds = [...new Set(rawDuplicateLinks.map((candidate) => candidate.unitId))];
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C02", unitIds: rawDuplicateUnits.map((unit) => unit.unitId),
        marker: "C02_UNDERSTANDING_RECEIVED", nowMs
      });
      const duplicatePreparedUnits = [];
      const duplicateLinkSet = new Set();
      for (const rawUnit of rawDuplicateUnits) {
        const matchingLinks = rawDuplicateLinks.filter((candidate) =>
          candidate.contextLinkCandidateId === rawUnit.contextLinkCandidateId
          && candidate.unitId === rawUnit.unitId);
        matchingLinks.forEach((candidate) => duplicateLinkSet.add(candidate));
        const normalized = normalizeUnitEvidence(rawUnit, matchingLinks, understandingTurnInput.sourceEvents);
        if (!normalized.ok) {
          emit(traceEmitter, understandingTurnInput, {
            boundary: "C04", unitIds: [rawUnit.unitId], outputUnitIds: [], status: "FAILURE",
            code: normalized.code, marker: "C04_SOURCE_EVIDENCE_REJECTED", nowMs
          });
          throw understandingError(normalized.code, attempts);
        }
        duplicatePreparedUnits.push(normalized.value);
        emit(traceEmitter, understandingTurnInput, {
          boundary: "C04", unitIds: [rawUnit.unitId], marker: "C04_SOURCE_EVIDENCE_VALIDATED", nowMs
        });
      }
      for (const orphanLink of rawDuplicateLinks.filter((candidate) => !duplicateLinkSet.has(candidate))) {
        const linkEvidence = validateAndNormalizeSourceEvidence(orphanLink.evidenceRefs, understandingTurnInput.sourceEvents);
        if (!linkEvidence.ok) {
          emit(traceEmitter, understandingTurnInput, {
            boundary: "C04", unitIds: [orphanLink.unitId], outputUnitIds: [], status: "FAILURE",
            code: linkEvidence.code, marker: "C04_SOURCE_EVIDENCE_REJECTED", nowMs
          });
          throw understandingError(linkEvidence.code, attempts);
        }
        emit(traceEmitter, understandingTurnInput, {
          boundary: "C04", unitIds: [orphanLink.unitId], marker: "C04_SOURCE_EVIDENCE_VALIDATED", nowMs
        });
      }
      const duplicateCatalog = buildPublicCatalogIdentitySet(understandingTurnInput);
      const duplicateRegistry = projectCapabilityRegistry(CAPABILITY_REGISTRY);
      for (const prepared of duplicatePreparedUnits) {
        const semantic = validateSemanticUnit({
          unit: prepared.unit,
          validatedEvidenceRefs: prepared.validatedEvidenceRefs,
          understandingTurnInput,
          publicCatalogIdentitySet: duplicateCatalog,
          capabilityRegistryProjection: duplicateRegistry
        });
        if (!semantic.ok) {
          emit(traceEmitter, understandingTurnInput, {
            boundary: "C03", unitIds: [prepared.unit.unitId], outputUnitIds: [], status: "FAILURE",
            code: semantic.code, marker: "C03_SEMANTIC_UNIT_REJECTED", nowMs
          });
          throw understandingError(semantic.code, attempts);
        }
        emit(traceEmitter, understandingTurnInput, {
          boundary: "C03", unitIds: [prepared.unit.unitId], marker: "C03_SEMANTIC_UNIT_VALIDATED", nowMs
        });
      }
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C05", unitIds: duplicateUnitIds, outputUnitIds: [], status: "FAILURE",
        code: wireCode, marker: "C05_CONTEXT_LINK_REJECTED", contextResult: "REJECTED", nowMs
      });
      throw understandingError(wireCode, attempts);
    }
    emit(traceEmitter, understandingTurnInput, {
      boundary: "C02", unitIds: [], outputUnitIds: [], status: "FAILURE",
      code: wireCode, marker: "C02_WIRE_SCHEMA_REJECTED", nowMs
    });
    throw understandingError(wireCode, attempts);
  }

  const rawOutput = providerValue.understandingOutput;
  const rawLinks = providerValue.contextLinkCandidates;
  const unitIds = rawOutput.units.map((unit) => unit.unitId);
  emit(traceEmitter, understandingTurnInput, {
    boundary: "C02", unitIds, marker: "C02_UNDERSTANDING_RECEIVED", nowMs
  });

  const linkById = new Map(rawLinks.map((linkCandidate) => [linkCandidate.contextLinkCandidateId, linkCandidate]));
  const validatedUnits = [];
  const validatedContextLinks = [];
  const publicCatalogIdentitySet = buildPublicCatalogIdentitySet(understandingTurnInput);
  const capabilityRegistryProjection = projectCapabilityRegistry(CAPABILITY_REGISTRY);
  for (const rawUnit of rawOutput.units) {
    const rawLink = linkById.get(rawUnit.contextLinkCandidateId);
    const normalized = normalizeUnitEvidence(rawUnit, [rawLink], understandingTurnInput.sourceEvents);
    if (!normalized.ok) {
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C04", unitIds: [rawUnit.unitId], outputUnitIds: [], status: "FAILURE",
        code: normalized.code, marker: "C04_SOURCE_EVIDENCE_REJECTED", nowMs
      });
      throw understandingError(normalized.code, attempts);
    }
    emit(traceEmitter, understandingTurnInput, {
      boundary: "C04", unitIds: [rawUnit.unitId], marker: "C04_SOURCE_EVIDENCE_VALIDATED", nowMs
    });

    const semantic = validateSemanticUnit({
      unit: normalized.value.unit,
      validatedEvidenceRefs: normalized.value.validatedEvidenceRefs,
      understandingTurnInput,
      publicCatalogIdentitySet,
      capabilityRegistryProjection
    });
    if (!semantic.ok) {
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C03", unitIds: [rawUnit.unitId], outputUnitIds: [], status: "FAILURE",
        code: semantic.code, marker: "C03_SEMANTIC_UNIT_REJECTED", nowMs
      });
      throw understandingError(semantic.code, attempts);
    }
    validatedUnits.push(semantic.value);
    emit(traceEmitter, understandingTurnInput, {
      boundary: "C03", unitIds: [rawUnit.unitId], marker: "C03_SEMANTIC_UNIT_VALIDATED", nowMs
    });

    const contextLink = validateContextLink({
      unit: semantic.value,
      linkCandidate: normalized.value.linkCandidates[0],
      understandingTurnInput,
      validatedEvidenceRefs: normalized.value.validatedEvidenceRefs,
      now: timestamp(nowMs)
    });
    if (!contextLink.ok) {
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C05", unitIds: [rawUnit.unitId], outputUnitIds: [], status: "FAILURE",
        code: contextLink.code, marker: "C05_CONTEXT_LINK_REJECTED", contextResult: "REJECTED", nowMs
      });
      throw understandingError(contextLink.code, attempts);
    }
    validatedContextLinks.push(contextLink.value);
    emit(traceEmitter, understandingTurnInput, {
      boundary: "C05", unitIds: [rawUnit.unitId], marker: "C05_CONTEXT_LINK_VALIDATED",
      contextResult: "VALIDATED", nowMs
    });
  }

  const result = {
    understandingOutput: deepFreeze(detach(rawOutput)),
    contextLinkCandidates: deepFreeze(detach(rawLinks)),
    validatedUnits: deepFreeze(validatedUnits),
    validatedContextLinks: deepFreeze(validatedContextLinks)
  };
  Object.defineProperty(result, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: providerDiagnostic(attempts)
  });
  return deepFreeze(result);
}

module.exports = {
  OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC,
  callOpenAIUnderstandingV1,
  instructions,
  openAiUnderstandingV1ProviderSchema
};
