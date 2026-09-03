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
  OPERATOR_ACTION_CLASSES,
  RISK_CLASSES,
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
  RELATION_KINDS,
  validateContextLinkCandidate
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
const {
  CAPABILITY_REGISTRY_PROJECTION,
  capabilityPolicyFor,
  catalogIdentityRuleFor
} = require("../new-core/capability-subject-policy");
const { validateContextLink, contextRelationEvidenceForValidatedLink, contextLinkFilterDiagnosticFor } = require("../new-core/context-link-validator");
const { createDiagnosticTraceEmitter } = require("../new-core/diagnostic-boundary");
const {
  NEW_CORE_OPENAI_MODEL,
  assertNewCoreOpenAiModelIdentity
} = require("../new-core/openai-model-authority");

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
const TRUSTED_UNDERSTANDING_RESULTS = new WeakSet();
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
  const temporalFields = (kind, checkInCandidate, checkOutCandidate) => ({
    rawText: stringSchema(MAX_QUOTE_LENGTH),
    kind,
    checkInCandidate,
    checkOutCandidate,
    nightsCandidate: { type: ["integer", "null"], minimum: 1 }
  });
  const isoDateCandidate = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", maxLength: 10 };
  return {
    anyOf: [
      { type: "null" },
      objectSchema(temporalFields(
        enumSchema(["absolute_date"], "Only an explicit complete calendar date may use absolute_date."),
        isoDateCandidate,
        { type: "null" }
      ), "A complete source date. checkInCandidate must be a valid YYYY-MM-DD candidate; a date range uses date_range instead."),
      objectSchema(temporalFields(
        enumSchema([...TEMPORAL_KINDS].filter((kind) => kind !== "absolute_date")),
        nullableStringSchema(80),
        nullableStringSchema(80)
      ), "Source meaning only. A complete month/day whose year is omitted is month_day with null date candidates. Other incomplete dates are partial. Never add an implicit year or executable date.")
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

function subjectBranchSchema(understandingTurnInput, capability, kind) {
  const identityRule = catalogIdentityRuleFor(CAPABILITY_REGISTRY_PROJECTION, capability, kind);
  if (identityRule === "NULL") {
    return objectSchema({
      kind: enumSchema([kind]),
      catalogIdentity: enumSchema([null])
    });
  }
  if (!["PUBLIC_CATALOG", "NULL_OR_PUBLIC_CATALOG"].includes(identityRule)) return null;
  const catalogIdentities = understandingTurnInput.publicSubjectCatalog
    .filter((subject) => subject.kind === kind)
    .map((subject) => subject.catalogIdentity);
  const allowedIdentities = identityRule === "NULL_OR_PUBLIC_CATALOG"
    ? [...catalogIdentities, null]
    : catalogIdentities;
  return allowedIdentities.length === 0 ? null : objectSchema({
    kind: enumSchema([kind]),
    catalogIdentity: enumSchema(allowedIdentities)
  });
}

function safetyCandidateSchema(policy) {
  if (policy.safetyShape === "operator_action") {
    return objectSchema({
      operatorActionClass: enumSchema([...OPERATOR_ACTION_CLASSES]),
      riskClass: enumSchema([null])
    }, "Trusted operator-action meaning only; this never chooses reply disposition.");
  }
  if (policy.safetyShape === "risk") {
    return objectSchema({
      operatorActionClass: enumSchema([null]),
      riskClass: enumSchema([...RISK_CLASSES])
    }, "Trusted risk meaning only; this never chooses reply disposition.");
  }
  return { type: "null" };
}

function semanticUnitBranchSchema(understandingTurnInput, capability) {
  const policy = capabilityPolicyFor(CAPABILITY_REGISTRY_PROJECTION, capability);
  if (!policy) {
    const catalogIdentities = understandingTurnInput.publicSubjectCatalog.map((subject) => subject.catalogIdentity);
    const policyOwnedPurposes = new Set(Object.values(CAPABILITY_REGISTRY_PROJECTION)
      .flatMap((candidatePolicy) => candidatePolicy.purposes));
    return objectSchema({
      unitId: stringSchema(),
      evidenceRefs: evidenceArraySchema(),
      purpose: enumSchema([...PURPOSES].filter((purpose) => !policyOwnedPurposes.has(purpose)),
        "Only a source meaning with no declared capability policy may use unsupported."),
      capability: enumSchema([capability], "Unsupported language-derived capability candidate; never answer facts."),
      subject: objectSchema({
        kind: enumSchema(SUBJECT_KINDS),
        catalogIdentity: enumSchema([...new Set([...catalogIdentities, null])])
      }),
      stayDependent: { type: "boolean" },
      temporalCandidate: temporalCandidateSchema(),
      contextLinkCandidateId: stringSchema(),
      safetyCandidate: {
        anyOf: [
          { type: "null" },
          objectSchema({
            operatorActionClass: enumSchema([...OPERATOR_ACTION_CLASSES, null]),
            riskClass: enumSchema([...RISK_CLASSES, null])
          })
        ]
      },
      slotCandidates: arraySchema(slotCandidateSchema(), { maxItems: MAX_SLOT_CANDIDATES }),
      confidenceBand: enumSchema(CONFIDENCE_BANDS)
    }, "An explicitly unsupported semantic candidate that remains fail-closed at C03.");
  }
  const subjectBranches = policy.subjectKinds
    .map((kind) => subjectBranchSchema(understandingTurnInput, capability, kind))
    .filter(Boolean);
  if (subjectBranches.length === 0) return null;
  return objectSchema({
    unitId: stringSchema(),
    evidenceRefs: evidenceArraySchema(),
    purpose: enumSchema(policy.safetyPurposes, "One independent source meaning; do not merge separately actionable meanings."),
    capability: enumSchema([capability], policy.understandingDescription),
    subject: { anyOf: subjectBranches },
    stayDependent: enumSchema([policy.stayDependent]),
    temporalCandidate: temporalCandidateSchema(),
    contextLinkCandidateId: stringSchema(),
    safetyCandidate: safetyCandidateSchema(policy),
    slotCandidates: arraySchema(slotCandidateSchema(), { maxItems: MAX_SLOT_CANDIDATES }),
    confidenceBand: enumSchema(CONFIDENCE_BANDS)
  }, "Exactly one immutable semantic candidate. Do not emit facts, canonical dates, resolver data, state writes, or final copy.");
}

function semanticUnitSchema(understandingTurnInput) {
  return {
    anyOf: [...CAPABILITIES]
      .map((capability) => semanticUnitBranchSchema(understandingTurnInput, capability))
      .filter(Boolean)
  };
}

function contextLinkSchema(understandingTurnInput) {
  const historyRefs = understandingTurnInput.recentConversation.map((event) => objectSchema({
    eventId: { type: "string", enum: [event.eventId], maxLength: MAX_ID_LENGTH },
    messageRef: { type: "string", enum: [event.messageRef], maxLength: MAX_ID_LENGTH }
  }));
  return objectSchema({
    contextLinkCandidateId: stringSchema(),
    unitId: stringSchema(),
    relationKind: enumSchema(RELATION_KINDS,
      "Use NEW_REQUEST unless current-source semantic evidence explicitly supplements, modifies, or terminates one compatible prior cycle."),
    currentSourceEvidenceRefs: evidenceArraySchema(),
    referencedHistoryEventRefs: arraySchema(
      historyRefs.length ? { anyOf: historyRefs } : objectSchema({ eventId: stringSchema(), messageRef: stringSchema() }),
      { maxItems: historyRefs.length ? MAX_EVIDENCE_REFS : 0 }
    )
  }, "One non-authoritative relation evidenced by current source and, only when targeted, cited prior history events. Never emit or select an internal requestCycleId.");
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
    "When the current source message supplies missing values for a prior pending request, represent the composite lodging meaning with its trusted capability and subject identity, use SUPPLEMENT, cite the exact prior history event/message refs, and never emit or infer an internal requestCycleId.",
    "Context relation is semantic evidence, never a lifecycle decision. Use NEW_REQUEST for an independent actionable request, SUPPLEMENT for additional information completing an existing request, MODIFICATION for an explicit change to an existing request, TERMINATION for an explicit end, and NONE only when no conversational relation is expressed. The deterministic core alone chooses START, CONTINUE, MODIFY, END, or NONE.",
    "SUPPLEMENT, MODIFICATION, or TERMINATION requires current-source evidence plus exact referencedHistoryEventRefs. Topic proximity, recency, or a shared date/availability word is not relation evidence. A complete standalone lodging request is NEW_REQUEST with no history refs.",
    "For that continuation, compare only the supplied candidate values with the cycle's missingFields; deterministic routing alone decides whether to answer or clarify.",
    "Capability, subject, stay dependency, and safety meaning are source-derived candidates, but their combination must match one capability-discriminated schema branch. Never use a null subject kind, catalog identity, stay dependency, purpose, or safety shape that conflicts with the selected capability. Context relation remains separate semantic evidence. Never propose ANSWER, CLARIFY, HANDOFF, NO_REPLY, START, CONTINUE, MODIFY, END, or lifecycle NONE.",
    "An occupancy quantity is a guest_count slot and must not by itself select a matched_room_set subject. Select matched_room_set only when the source explicitly names a lodging product type or room category independently of occupancy.",
    "A supplied specific stay date or date range with a question about whether lodging, a room, a room set, or a bundle is available then is availability. A search asking which dates are available, the nearest available date, or upcoming bookable dates is available_dates. Never use available_dates merely because a fixed-date availability question mentions a date.",
    "A request about the property's own address, map, or navigation, or any relationship between the property and any named or unnamed external place, is location with subject kind external_place and null catalog identity. This includes proximity, nearby existence, distance, duration, directions, and navigation meaning. Only identify the relationship; never invent an external-place fact, name, distance, duration, or recommendation.",
    "Set safetyCandidate only for operator_request/booking_operator_request or sensitive_request/high_risk. Exactly one of operatorActionClass and riskClass must be non-null; otherwise safetyCandidate is null.",
    "Temporal candidates preserve source meaning only. Do not invent an implicit year, canonical date, availability, price, policy truth, amenity truth, location fact, or any other formal fact.",
    "Do not emit resolver IDs, query plans, state mutations, final reply text, message-level routing, task indexes, credentials, private data, or fields outside the schema.",
    "When meaning or reference is uncertain, preserve that uncertainty in the declared candidate fields; never invent a catalog identity or Context target.",
    "Before returning, verify that every unit and context link has unique matching IDs and exact source evidence, and that no independently meaningful source request was omitted or merged."
  ].join("\n");
}

function providerVisibleInput(understandingTurnInput) {
  return {
    ...understandingTurnInput,
    recentConversation: understandingTurnInput.recentConversation.map(({ referenceableCycleIds, ...event }) => ({
      ...event,
      referenceableRequestSummaries: referenceableCycleIds.map((requestCycleId) => {
        const cycle = understandingTurnInput.referenceableCycles.find((candidate) => candidate.requestCycleId === requestCycleId);
        return cycle ? {
          requestKind: cycle.requestKind,
          capability: cycle.capability,
          status: cycle.status,
          subject: cycle.subject,
          missingFields: cycle.missingFields,
          confirmedValues: cycle.confirmedValues
        } : null;
      }).filter(Boolean)
    })),
    referenceableCycles: undefined
  };
}

function providerRequestBody(understandingTurnInput) {
  const modelInput = providerVisibleInput(understandingTurnInput);
  return {
    model: NEW_CORE_OPENAI_MODEL,
    safety_identifier: sha256(understandingTurnInput.propertyScope.userId),
    input: [
      { role: "system", content: [{ type: "input_text", text: instructions() }] },
      { role: "developer", content: [{ type: "input_text", text: JSON.stringify(modelInput) }] }
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

function structuredOutputText(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.status !== "completed" || Object.hasOwn(payload, "output_text")
    || !Array.isArray(payload.output)) return null;
  const output = payload.output;
  const parts = output
    .flatMap((item) => Array.isArray(item && item.content) ? item.content : []);
  if (parts.some((part) => part && part.type === "refusal")) return null;
  const unexpected = output.filter((item) => !item || !["reasoning", "message"].includes(item.type));
  const reasoning = output.filter((item) => item && item.type === "reasoning");
  const messages = output.filter((item) => item && item.type === "message");
  if (unexpected.length || reasoning.length > 8 || messages.length !== 1
    || !Array.isArray(messages[0].content) || messages[0].content.length !== 1) return null;
  if (messages[0].status !== undefined && messages[0].status !== "completed") return null;
  if (reasoning.some((item) => item.content !== undefined
    && (!Array.isArray(item.content) || item.content.length !== 0))) return null;
  const part = messages[0].content[0];
  return part && part.type === "output_text" && typeof part.text === "string" && part.text.length > 0
    ? part.text : null;
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

function providerFailure(code, category, {
  timeout = false, retryable = false, status = 0, providerError = {}, resolvedModel = ""
} = {}) {
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
  error.resolvedModel = safeToken(resolvedModel, 160);
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
    parsedOutputPresent: Boolean(details.parsedOutputPresent),
    requestedModel: NEW_CORE_OPENAI_MODEL,
    resolvedModel: safeToken(details.resolvedModel, 160)
  });
}

function providerDiagnostic(attempts, evidence = null) {
  const values = attempts.slice(0, MAX_PROVIDER_ATTEMPTS).map(safeAttempt);
  const retried = values.length > 1;
  return deepFreeze({
    requestedModel: NEW_CORE_OPENAI_MODEL,
    resolvedModel: values.length ? values.at(-1).resolvedModel : "",
    providerAttemptCount: values.length,
    retryPerformed: retried,
    retrySucceeded: retried && values.at(-1).errorCategory === "",
    providerAttempts: values,
    ...(evidence ? { understandingEvidence: evidence } : {})
  });
}

function understandingEvidence(understandingTurnInput, structuredOutput) {
  return deepFreeze({
    providerVisibleInput: detach(providerVisibleInput(understandingTurnInput)),
    providerGuidance: instructions().split("\n").filter((item) => (
      /capability|subject|safetyCandidate|operator_request|booking_operator_request|uncertain/iu.test(item)
    )),
    schemaBranches: {
      policy: semanticUnitBranchSchema(understandingTurnInput, "policy"),
      booking_operator_request: semanticUnitBranchSchema(understandingTurnInput, "booking_operator_request")
    },
    structuredOutput: detach(structuredOutput)
  });
}

async function requestOnce({ apiKey, fetchImpl, timeoutMs, requestIdFactory, understandingTurnInput }, attemptNumber) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let httpStatus = 0;
  let providerRequestId = "";
  let responseBodyPresent = false;
  let parsedOutputPresent = false;
  let resolvedModel = "";
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
      body: JSON.stringify(providerRequestBody(understandingTurnInput))
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
    resolvedModel = read.payload && read.payload.model;
    try {
      assertNewCoreOpenAiModelIdentity(NEW_CORE_OPENAI_MODEL, resolvedModel);
    } catch {
      throw providerFailure("MODEL_IDENTITY_MISMATCH", "model_identity", { status: httpStatus, resolvedModel });
    }
    const text = structuredOutputText(read.payload);
    if (!text) {
      throw providerFailure("UNDERSTANDING_SCHEMA_INVALID", "structured_output_failure", { status: httpStatus, resolvedModel });
    }
    try {
      const value = JSON.parse(text);
      parsedOutputPresent = true;
      return {
        value,
        attempt: safeAttempt({
          attemptNumber, timeoutMs, timeout: false, retryable: false, errorCategory: "",
          httpStatus, providerRequestId, responseBodyPresent, parsedOutputPresent, resolvedModel
        })
      };
    } catch {
      throw providerFailure("UNDERSTANDING_SCHEMA_INVALID", "parse_failure", { status: httpStatus, resolvedModel });
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
      parsedOutputPresent,
      resolvedModel: error.resolvedModel
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function understandingError(code, providerAttempts, schemaViolation = null, rejectedEvidence = null) {
  const error = new Error(code);
  error.code = code;
  error.provider = PROVIDER_NAME;
  if (schemaViolation) error.schemaViolation = deepFreeze(detach(schemaViolation));
  if (rejectedEvidence) error.rejectedEvidence = deepFreeze(detach(rejectedEvidence));
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

function emitOperational(options, entry) {
  if (typeof options.onOperationalDiagnostic !== "function") return;
  try { options.onOperationalDiagnostic(entry); } catch { /* observability is behavior-neutral */ }
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function pathValue(value, path) {
  return String(path).split(".").reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[Number.isInteger(Number(key)) ? Number(key) : key];
  }, value);
}

function safeActual(value, enumLike = false) {
  if (enumLike && (value === null || ["string", "number", "boolean"].includes(typeof value))) {
    const token = safeToken(value === null ? "null" : value, 80);
    return token ? `enum:${token}` : `${valueType(value)}:invalid`;
  }
  return `type:${valueType(value)}`;
}

function expectedForValidationPath(path) {
  const leaf = String(path).split(".").at(-1);
  if (["purpose", "capability", "kind", "confidenceBand", "relationKind", "slot", "operation"].includes(leaf)) {
    return "allowed enum declared by Understanding V1 schema";
  }
  if (["schemaVersion", "nightsCandidate", "startOffset", "endOffset"].includes(leaf)) return "integer in declared range";
  if (["stayDependent"].includes(leaf)) return "boolean";
  if (["units", "slotCandidates", "evidenceRefs", "currentSourceEvidenceRefs", "referencedHistoryEventRefs"].includes(leaf)) return "array with declared cardinality";
  if (["subject", "temporalCandidate", "safetyCandidate"].includes(leaf)) return "declared object or null shape";
  if (leaf === "keys") return "exact declared object fields";
  return "value satisfying Understanding V1 field contract";
}

function validationViolation(code, path, root) {
  const value = pathValue(root, path.replace(/^understandingOutput\./u, ""));
  const leaf = String(path).split(".").at(-1);
  return {
    validationErrorCode: code,
    fieldPath: path,
    expected: expectedForValidationPath(path),
    actual: safeActual(value, ["purpose", "capability", "kind", "confidenceBand", "relationKind", "slot", "operation"].includes(leaf))
  };
}

function envelopeWireFailure(value, understandingTurnInput) {
  if (!exactKeys(value, ["understandingOutput", "contextLinkCandidates"])) return {
    code: "UNKNOWN_WIRE_FIELD",
    violation: { validationErrorCode: "UNKNOWN_WIRE_FIELD", fieldPath: "$", expected: "exact envelope fields", actual: safeActual(value) }
  };
  const outputValidation = validateUnderstandingOutputV1(value.understandingOutput);
  if (!outputValidation.ok) {
    const path = `understandingOutput.${outputValidation.errors[0]}`;
    return { code: outputValidation.code, violation: validationViolation(outputValidation.code, path, value.understandingOutput) };
  }
  if (value.understandingOutput.turnId !== understandingTurnInput.turnId) return {
    code: "UNDERSTANDING_SCHEMA_INVALID",
    violation: { validationErrorCode: "UNDERSTANDING_SCHEMA_INVALID", fieldPath: "understandingOutput.turnId", expected: "enum:C01.turnId", actual: "string:mismatch" }
  };
  const links = value.contextLinkCandidates;
  if (!Array.isArray(links) || links.length > MAX_CONTEXT_LINKS) {
    return { code: "UNDERSTANDING_CARDINALITY_INVALID", violation: { validationErrorCode: "UNDERSTANDING_CARDINALITY_INVALID", fieldPath: "contextLinkCandidates", expected: "array with declared cardinality", actual: safeActual(links) } };
  }
  const units = value.understandingOutput.units;
  for (const [index, candidate] of links.entries()) {
    const validation = validateContextLinkCandidate(candidate);
    if (!validation.ok) {
      const code = validation.unknownWireField ? "UNKNOWN_WIRE_FIELD" : "UNDERSTANDING_SCHEMA_INVALID";
      const localPath = validation.errors[0];
      const path = `contextLinkCandidates.${index}.${localPath}`;
      return { code, violation: validationViolation(code, path, value) };
    }
  }
  const unitKeys = new Set(units.map((unit) => JSON.stringify([unit.unitId, unit.contextLinkCandidateId])));
  const linkIdCounts = new Map();
  for (const candidate of links) {
    linkIdCounts.set(candidate.contextLinkCandidateId, (linkIdCounts.get(candidate.contextLinkCandidateId) || 0) + 1);
  }
  if (units.some((unit) => !links.some((candidate) =>
    candidate.contextLinkCandidateId === unit.contextLinkCandidateId && candidate.unitId === unit.unitId))) {
    return { code: "UNDERSTANDING_SCHEMA_INVALID", violation: { validationErrorCode: "UNDERSTANDING_SCHEMA_INVALID", fieldPath: "contextLinkCandidates", expected: "one matching link for every unitId/contextLinkCandidateId pair", actual: "pair:missing" } };
  }
  if (links.some((candidate) => !unitKeys.has(JSON.stringify([candidate.unitId, candidate.contextLinkCandidateId]))
    && linkIdCounts.get(candidate.contextLinkCandidateId) === 1)) {
    return { code: "UNDERSTANDING_SCHEMA_INVALID", violation: { validationErrorCode: "UNDERSTANDING_SCHEMA_INVALID", fieldPath: "contextLinkCandidates", expected: "every link bound to an emitted unit", actual: "pair:orphan" } };
  }
  const ungroundedTemporalIndex = units.findIndex((unit) => unit.temporalCandidate !== null
    && !unit.evidenceRefs.some((reference) => reference.quote.includes(unit.temporalCandidate.rawText)));
  if (ungroundedTemporalIndex !== -1) {
    return { code: "UNDERSTANDING_SCHEMA_INVALID", violation: {
      validationErrorCode: "UNDERSTANDING_SCHEMA_INVALID",
      fieldPath: `understandingOutput.units.${ungroundedTemporalIndex}.temporalCandidate.rawText`,
      expected: `exact substring of understandingOutput.units.${ungroundedTemporalIndex}.evidenceRefs[].quote`,
      actual: "string:not_grounded"
    } };
  }
  return null;
}

function rejectedEvidenceForWireFailure(value, understandingTurnInput, wireFailure) {
  const fieldPath = String(wireFailure && wireFailure.violation && wireFailure.violation.fieldPath || "");
  const matchedIndex = fieldPath.match(/^understandingOutput\.units\.(\d+)\./u);
  const rejectedUnitIndex = matchedIndex ? Number(matchedIndex[1]) : null;
  const units = value && value.understandingOutput && Array.isArray(value.understandingOutput.units)
    ? value.understandingOutput.units : [];
  const unit = Number.isInteger(rejectedUnitIndex) ? units[rejectedUnitIndex] : null;
  const sourceEvents = Array.isArray(understandingTurnInput && understandingTurnInput.sourceEvents)
    ? understandingTurnInput.sourceEvents : [];
  const rawText = unit && unit.temporalCandidate && typeof unit.temporalCandidate.rawText === "string"
    ? unit.temporalCandidate.rawText : "";
  const evidenceRefs = (unit && Array.isArray(unit.evidenceRefs) ? unit.evidenceRefs : []).slice(0, MAX_EVIDENCE_REFS).map((reference) => {
    const source = sourceEvents.find((event) => event.eventId === reference.eventId
      && event.messageRef === reference.messageRef);
    const sourceText = source && typeof source.messageText === "string" ? source.messageText : "";
    const offsetsValid = Number.isInteger(reference.startOffset) && Number.isInteger(reference.endOffset)
      && reference.startOffset >= 0 && reference.endOffset >= reference.startOffset;
    const sourceExcerpt = offsetsValid ? sourceText.slice(reference.startOffset, reference.endOffset) : "";
    return {
      eventId: reference.eventId,
      messageRef: reference.messageRef,
      startOffset: reference.startOffset,
      endOffset: reference.endOffset,
      quote: reference.quote,
      sourceExcerpt,
      quoteMatchesSource: Boolean(source && offsetsValid && sourceExcerpt === reference.quote)
    };
  });
  return {
    fieldPath,
    validationReason: String(wireFailure && wireFailure.violation && wireFailure.violation.actual || ""),
    rejectedUnitIndex,
    semantic: unit ? {
      purpose: unit.purpose,
      capability: unit.capability,
      subject: unit.subject,
      confidenceBand: unit.confidenceBand
    } : null,
    temporalCandidate: unit && unit.temporalCandidate || null,
    evidenceRefs,
    rawTextInSource: Boolean(rawText && sourceEvents.some((event) =>
      typeof event.messageText === "string" && event.messageText.includes(rawText))),
    rawTextInEvidenceQuote: Boolean(rawText && evidenceRefs.some((reference) =>
      typeof reference.quote === "string" && reference.quote.includes(rawText)))
  };
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
    const linkEvidence = validateAndNormalizeSourceEvidence(linkCandidate.currentSourceEvidenceRefs, sourceEvents);
    if (!linkEvidence.ok) return linkEvidence;
    validatedEvidenceRefs.push(...linkEvidence.value);
    normalizedLinkCandidates.push({ ...linkCandidate, currentSourceEvidenceRefs: linkEvidence.value });
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
  if (Object.hasOwn(options, "model")) throw understandingError("MODEL_IDENTITY_MISMATCH");
  const apiKey = String(options.apiKey || "").trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!apiKey || typeof fetchImpl !== "function") {
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
        ? "UNDERSTANDING_PROVIDER_TIMEOUT"
        : error.code === "MODEL_IDENTITY_MISMATCH"
          ? "MODEL_IDENTITY_MISMATCH" : "UNDERSTANDING_SCHEMA_INVALID";
      const finalError = understandingError(code, attempts);
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C02", unitIds: [], outputUnitIds: [], status: "FAILURE", code,
        marker: code === "UNDERSTANDING_PROVIDER_TIMEOUT" ? "C02_PROVIDER_TIMEOUT" : "C02_WIRE_SCHEMA_REJECTED",
        nowMs
      });
      throw finalError;
    }
  }

  const wireFailure = envelopeWireFailure(providerValue, understandingTurnInput);
  if (wireFailure) {
    emit(traceEmitter, understandingTurnInput, {
      boundary: "C02", unitIds: [], outputUnitIds: [], status: "FAILURE",
      code: wireFailure.code, marker: "C02_WIRE_SCHEMA_REJECTED", nowMs
    });
    throw understandingError(wireFailure.code, attempts, wireFailure.violation,
      rejectedEvidenceForWireFailure(providerValue, understandingTurnInput, wireFailure));
  }

  const rawOutput = providerValue.understandingOutput;
  const rawLinks = providerValue.contextLinkCandidates;
  const unitIds = rawOutput.units.map((unit) => unit.unitId);
  emit(traceEmitter, understandingTurnInput, {
    boundary: "C02", unitIds, marker: "C02_UNDERSTANDING_RECEIVED", nowMs
  });

  const unitKey = (unitId, contextLinkCandidateId) => JSON.stringify([unitId, contextLinkCandidateId]);
  const rawUnitKeys = new Set(rawOutput.units.map((unit) => unitKey(unit.unitId, unit.contextLinkCandidateId)));
  const matchingLinksByUnitId = new Map(rawOutput.units.map((unit) => [
    unit.unitId,
    rawLinks.filter((candidate) => candidate.unitId === unit.unitId
      && candidate.contextLinkCandidateId === unit.contextLinkCandidateId)
  ]));
  const orphanDuplicateLinks = rawLinks.filter((candidate) =>
    !rawUnitKeys.has(unitKey(candidate.unitId, candidate.contextLinkCandidateId)));
  const failuresByUnitId = new Map();
  const recordFailure = (unitId, failureCode, boundary) => {
    if (!failuresByUnitId.has(unitId)) {
      failuresByUnitId.set(unitId, deepFreeze({ unitId, failureCode, boundary }));
    }
  };
  const preparedByUnitId = new Map();
  const orphanEvidenceValid = new Set();

  // C04 is evaluated for every sibling before any C03/C05 work so a failed
  // evidence span cannot short-circuit or reorder another unit's validation.
  for (const rawUnit of rawOutput.units) {
    const normalized = normalizeUnitEvidence(
      rawUnit,
      matchingLinksByUnitId.get(rawUnit.unitId),
      understandingTurnInput.sourceEvents
    );
    if (!normalized.ok) {
      recordFailure(rawUnit.unitId, normalized.code, "C04");
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C04", unitIds: [rawUnit.unitId], outputUnitIds: [], status: "FAILURE",
        code: normalized.code, marker: "C04_SOURCE_EVIDENCE_REJECTED", nowMs
      });
      continue;
    }
    preparedByUnitId.set(rawUnit.unitId, normalized.value);
    emit(traceEmitter, understandingTurnInput, {
      boundary: "C04", unitIds: [rawUnit.unitId], marker: "C04_SOURCE_EVIDENCE_VALIDATED", nowMs
    });
  }
  for (const orphanLink of orphanDuplicateLinks) {
    const linkEvidence = validateAndNormalizeSourceEvidence(orphanLink.currentSourceEvidenceRefs, understandingTurnInput.sourceEvents);
    if (!linkEvidence.ok) {
      recordFailure(orphanLink.unitId, linkEvidence.code, "C04");
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C04", unitIds: [orphanLink.unitId], outputUnitIds: [], status: "FAILURE",
        code: linkEvidence.code, marker: "C04_SOURCE_EVIDENCE_REJECTED", nowMs
      });
      continue;
    }
    orphanEvidenceValid.add(orphanLink);
    emit(traceEmitter, understandingTurnInput, {
      boundary: "C04", unitIds: [orphanLink.unitId], marker: "C04_SOURCE_EVIDENCE_VALIDATED", nowMs
    });
  }

  const validatedUnits = [];
  const validatedContextLinks = [];
  const semanticByUnitId = new Map();
  const publicCatalogIdentitySet = buildPublicCatalogIdentitySet(understandingTurnInput);
  const capabilityRegistryProjection = projectCapabilityRegistry(CAPABILITY_REGISTRY);
  const validOrphanUnitIds = new Set([...orphanEvidenceValid].map((candidate) => candidate.unitId));

  // C03 independently validates every C04-admitted unit in original C02 order.
  for (const rawUnit of rawOutput.units) {
    const normalized = preparedByUnitId.get(rawUnit.unitId);
    if (!normalized || failuresByUnitId.has(rawUnit.unitId)) continue;
    const semantic = validateSemanticUnit({
      unit: normalized.unit,
      validatedEvidenceRefs: normalized.validatedEvidenceRefs,
      understandingTurnInput,
      publicCatalogIdentitySet,
      capabilityRegistryProjection
    });
    if (!semantic.ok) {
      emitOperational(options, { traceId: understandingTurnInput.traceId, stage: "new_core_c03",
        unit: normalized.unit, status: "FAILURE", failureCode: semantic.code, validationErrors: semantic.errors || [], valueOriginFunction: "validateSemanticUnit" });
      recordFailure(rawUnit.unitId, semantic.code, "C03");
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C03", unitIds: [rawUnit.unitId], outputUnitIds: [], status: "FAILURE",
        code: semantic.code, marker: "C03_SEMANTIC_UNIT_REJECTED", nowMs
      });
      continue;
    }
    emitOperational(options, { traceId: understandingTurnInput.traceId, stage: "new_core_c03",
      unit: semantic.value, status: "SUCCESS", failureCode: "", validationErrors: [], valueOriginFunction: "validateSemanticUnit" });
    semanticByUnitId.set(rawUnit.unitId, semantic.value);
    emit(traceEmitter, understandingTurnInput, {
      boundary: "C03", unitIds: [rawUnit.unitId], marker: "C03_SEMANTIC_UNIT_VALIDATED", nowMs
    });
  }

  // C05 admits a unit and its link as one usable pair. A rejected link keeps
  // that unit explicit in failedUnits and cannot remove successful siblings.
  for (const rawUnit of rawOutput.units) {
    const semanticUnit = semanticByUnitId.get(rawUnit.unitId);
    if (!semanticUnit) continue;
    const normalized = preparedByUnitId.get(rawUnit.unitId);
    const matchingLinks = normalized.linkCandidates;
    if (matchingLinks.length !== 1 || validOrphanUnitIds.has(rawUnit.unitId)) {
      recordFailure(rawUnit.unitId, "CONTEXT_LINK_DUPLICATE", "C05");
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C05", unitIds: [rawUnit.unitId], outputUnitIds: [], status: "FAILURE",
        code: "CONTEXT_LINK_DUPLICATE", marker: "C05_CONTEXT_LINK_REJECTED",
        contextResult: "REJECTED", nowMs
      });
      continue;
    }
    const contextLink = validateContextLink({
      unit: semanticUnit,
      linkCandidate: matchingLinks[0],
      understandingTurnInput,
      validatedEvidenceRefs: normalized.validatedEvidenceRefs,
      now: timestamp(nowMs)
    });
    emitOperational(options, { traceId: understandingTurnInput.traceId, stage: "new_core_context_filter",
      unit: semanticUnit, linkCandidate: matchingLinks[0], referenceableCycles: understandingTurnInput.referenceableCycles,
      status: contextLink.ok ? "SUCCESS" : "FAILURE", failureCode: contextLink.code || "", validationErrors: contextLink.errors || [],
      result: contextLink.ok ? contextRelationEvidenceForValidatedLink(contextLink.value, semanticUnit) : null,
      filterDiagnostic: contextLinkFilterDiagnosticFor(contextLink), valueOriginFunction: "validateContextLink" });
    if (!contextLink.ok) {
      recordFailure(rawUnit.unitId, contextLink.code, "C05");
      emit(traceEmitter, understandingTurnInput, {
        boundary: "C05", unitIds: [rawUnit.unitId], outputUnitIds: [], status: "FAILURE",
        code: contextLink.code, marker: "C05_CONTEXT_LINK_REJECTED", contextResult: "REJECTED", nowMs
      });
      continue;
    }
    validatedUnits.push(semanticUnit);
    validatedContextLinks.push(contextLink.value);
    emit(traceEmitter, understandingTurnInput, {
      boundary: "C05", unitIds: [rawUnit.unitId], marker: "C05_CONTEXT_LINK_VALIDATED",
      contextResult: "VALIDATED", nowMs
    });
  }
  for (const orphanLink of orphanDuplicateLinks) {
    if (!orphanEvidenceValid.has(orphanLink) || failuresByUnitId.has(orphanLink.unitId)) continue;
    recordFailure(orphanLink.unitId, "CONTEXT_LINK_DUPLICATE", "C05");
    emit(traceEmitter, understandingTurnInput, {
      boundary: "C05", unitIds: [orphanLink.unitId], outputUnitIds: [], status: "FAILURE",
      code: "CONTEXT_LINK_DUPLICATE", marker: "C05_CONTEXT_LINK_REJECTED",
      contextResult: "REJECTED", nowMs
    });
  }

  const orderedFailureIds = [
    ...rawOutput.units.map((unit) => unit.unitId),
    ...orphanDuplicateLinks.map((candidate) => candidate.unitId)
  ];
  const failedUnits = [...new Set(orderedFailureIds)]
    .filter((unitId) => failuresByUnitId.has(unitId))
    .map((unitId) => failuresByUnitId.get(unitId));

  const result = {
    understandingOutput: deepFreeze(detach(rawOutput)),
    contextLinkCandidates: deepFreeze(detach(rawLinks)),
    validatedUnits: deepFreeze(validatedUnits),
    validatedContextLinks: deepFreeze(validatedContextLinks),
    failedUnits: deepFreeze(failedUnits)
  };
  Object.defineProperty(result, OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: providerDiagnostic(attempts, understandingEvidence(understandingTurnInput, providerValue))
  });
  const trustedResult = deepFreeze(result);
  TRUSTED_UNDERSTANDING_RESULTS.add(trustedResult);
  return trustedResult;
}

function isTrustedUnderstandingResult(value) {
  return Boolean(value) && typeof value === "object"
    && TRUSTED_UNDERSTANDING_RESULTS.has(value);
}

module.exports = {
  OPENAI_UNDERSTANDING_V1_PROVIDER_DIAGNOSTIC,
  callOpenAIUnderstandingV1,
  instructions,
  isTrustedUnderstandingResult,
  openAiUnderstandingV1ProviderSchema
};
