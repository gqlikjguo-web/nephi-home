"use strict";

const RELATIONS = new Set(["new_request", "continue", "modify", "answer_clarification", "new_topic", "acknowledgement"]);
const OPERATIONS = new Set(["set", "replace", "clear", "keep"]);
const TASK_TYPES = new Set(["availability", "available_dates", "room_options", "bundle_availability", "capacity", "price", "total_price", "amenity", "amenity_list", "policy", "property_fact", "booking_request", "human_help", "high_risk", "unknown"]);
const ENTITY_CATEGORIES = new Set(["room", "bundle", "room_feature", "amenity", "activity", "policy", "payment", "cancellation", "transport", "check_in", "check_out", "other"]);
const DATE_KINDS = new Set(["absolute", "relative", "weekday", "weekend", "range", "contextual", "none"]);
const ANCHORS = new Set(["message_time", "previous_check_in", "previous_check_out", "none"]);
const ELIGIBILITY_EVIDENCE_KINDS = new Set(["none", "person", "room", "plan", "booking_mode", "identity", "stated_condition"]);
const CONTEXT_RELATION_KINDS = new Set(["new_request", "supplement_existing", "modify_existing", "end_existing", "relation_uncertain"]);
const { DETAIL_INTENTS } = require("./detail-intent");
const { resolveEntity } = require("./entity-resolver");
const { getCapabilityDefinition } = require("./capability-registry");
const PLANNER_OPERATION_PATHS = new Set([
  "*",
  "stay.dateExpression.rawText",
  "stay.dateExpression.kind",
  "stay.dateExpression.anchor",
  "stay.checkInCandidate",
  "stay.checkOutCandidate",
  "stay.nightsCandidate",
  "stay.guestCountCandidate",
  "inventory.mode",
  "inventory.entityId",
  "inventory.features"
]);

function confidence(value) { return typeof value === "number" && value >= 0 && value <= 1; }
function text(value, limit = 500) { return typeof value === "string" && value.length <= limit; }
function normalizedText(value) { return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("zh-TW"); }
function normalizeEligibilityEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "none", sourceText: "" };
  const kind = ELIGIBILITY_EVIDENCE_KINDS.has(value.kind) ? value.kind : "none";
  return { kind, sourceText: kind === "none" ? "" : String(value.sourceText || "").slice(0, 200) };
}
function hasExplicitEligibilityEvidence(task) {
  const evidence = normalizeEligibilityEvidence(task && task.eligibilityEvidence);
  const source = normalizedText(task && task.sourceText);
  const excerpt = normalizedText(evidence.sourceText);
  return evidence.kind !== "none" && Boolean(excerpt) && source.includes(excerpt);
}
function validStayCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expression = value.dateExpression;
  return Boolean(expression && typeof expression === "object" && !Array.isArray(expression)
    && text(expression.rawText || "", 200) && DATE_KINDS.has(expression.kind) && ANCHORS.has(expression.anchor)
    && (value.checkInCandidate === null || text(value.checkInCandidate, 40))
    && (value.checkOutCandidate === null || text(value.checkOutCandidate, 40))
    && (value.nightsCandidate === null || Number.isInteger(value.nightsCandidate) && value.nightsCandidate >= 1 && value.nightsCandidate <= 60)
    && (value.guestCountCandidate === null || Number.isInteger(value.guestCountCandidate) && value.guestCountCandidate >= 1 && value.guestCountCandidate <= 100));
}
function controlledRequestedOutputs(task) {
  if (task.entity && task.entity.category === "transport") return ["map_url"];
  if (["amenity", "policy", "property_fact"].includes(task.type)) return [task.detailIntent === "general" ? "answer" : task.detailIntent];
  return task.requestedOutputs;
}

function groundedPropertyFactTask(task, catalog, fallbackStayCandidate = null) {
  const entity = task && task.entity;
  if (!catalog || !entity) return null;
  const rawGrounded = entity.rawText
    ? resolveEntity(catalog, {
      category: "other",
      rawText: entity.rawText,
      canonicalCandidate: null
    })
    : null;
  const candidateGrounded = entity.canonicalCandidate
    && (!rawGrounded || rawGrounded.status === "not_found")
    ? resolveEntity(catalog, {
        category: "other",
        rawText: "",
        canonicalCandidate: entity.canonicalCandidate
      })
    : null;
  const grounded = rawGrounded && rawGrounded.status !== "not_found"
    ? rawGrounded
    : candidateGrounded || rawGrounded;
  const groundedEntity = grounded
    && grounded.status === "resolved"
    && grounded.entity;
  const resolved = groundedEntity || null;
  const preferredType = resolved && (resolved.category === "transport"
    ? "property_fact"
    : resolved.category === "policy"
      ? "policy"
      : "amenity");
  const exactDefinition = resolved && getCapabilityDefinition(resolved.canonicalId);
  if (resolved && exactDefinition
    && exactDefinition.resolverId === "availability_resolver"
    && exactDefinition.riskLevel === "low"
    && exactDefinition.responseMode === "answer") return {
    ...task,
    type: exactDefinition.capability,
    detailIntent: task.detailIntent || "general",
    requestedOutputs: [exactDefinition.capability],
    dependsOnStayContext: true,
    stayCandidate: task.stayCandidate || fallbackStayCandidate,
    entity: {
      ...entity,
      rawText: "",
      category: "other",
      canonicalCandidate: null
    }
  };
  const definition = resolved && (exactDefinition || getCapabilityDefinition(preferredType));
  if (!resolved || !definition
    || definition.resolverId !== "property_catalog"
    || definition.stayDependency !== false
    || definition.riskLevel !== "low"
    || definition.responseMode !== "answer"
    || !definition.acceptedEntityCategories.includes(resolved.category)) return null;
  const type = definition.acceptedCandidateTypes.includes(preferredType)
    ? preferredType
    : definition.acceptedCandidateTypes[0];
  const detailIntent = task.detailIntent || "general";
  return {
    ...task,
    type,
    detailIntent,
    requestedOutputs: resolved.category === "transport" ? ["map_url"] : [detailIntent === "general" ? "answer" : detailIntent],
    dependsOnStayContext: false,
    stayCandidate: null,
    entity: {
      ...entity,
      rawText: entity.rawText,
      category: resolved.category,
      canonicalCandidate: resolved.canonicalId
    }
  };
}

function normalizedUngroundedTaskShape(task) {
  const entity = task && task.entity;
  if (!entity) return task;
  const requestedOutputs = new Set(Array.isArray(task.requestedOutputs) ? task.requestedOutputs : []);
  const requestedInventoryType = requestedOutputs.size === 1
    && requestedOutputs.has("total_price")
    ? "total_price"
    : requestedOutputs.size === 1 && requestedOutputs.has("price")
      ? "price"
      : null;
  if (requestedInventoryType
    && ["availability", "bundle_availability", "room_options"].includes(task.type)
    && ["room", "bundle", "other"].includes(entity.category)) return {
    ...task,
    type: requestedInventoryType,
    dependsOnStayContext: true
  };
  if (task.type === "availability") {
    const standaloneType = ["amenity", "activity", "room_feature"].includes(entity.category)
      ? "amenity"
      : ["policy", "payment", "cancellation", "check_in", "check_out"].includes(entity.category)
        ? "policy"
        : entity.category === "transport"
          ? "property_fact"
          : null;
    if (standaloneType) return {
      ...task,
      type: standaloneType,
      dependsOnStayContext: false,
      stayCandidate: null
    };
  }
  const exactDefinition = getCapabilityDefinition(task.type);
  if (exactDefinition
    && !exactDefinition.acceptedEntityCategories.includes(entity.category)) {
    if (exactDefinition.resolverId === "availability_resolver"
      && exactDefinition.acceptedEntityCategories.includes("other")
      && !["room", "bundle"].includes(entity.category)) return {
      ...task,
      entity: { ...entity, category: "other", rawText: "", canonicalCandidate: null }
    };
    const category = task.type === "policy"
      ? "policy"
      : task.type === "amenity"
        ? "amenity"
        : null;
    if (category) return { ...task, entity: { ...entity, category } };
  }
  return task;
}

// Legacy planner state controls are accepted only for wire compatibility with
// the existing planner provider.  They are discarded at the schema boundary:
// no downstream component receives them as a state input.
function discardLegacyPlannerStateControls(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { stateOperations: _discarded, ...rest } = value;
  return { ...rest, stateOperations: [] };
}

function validatePlannerOutput(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["root"] };
  if (value.schemaVersion !== 2) errors.push("schemaVersion");
  if (!value.discourse || !RELATIONS.has(value.discourse.relation) || !confidence(value.discourse.confidence)) errors.push("discourse");
  if (!Array.isArray(value.stateOperations)) errors.push("stateOperations");
  else value.stateOperations.forEach((item, index) => {
    if (!item || !PLANNER_OPERATION_PATHS.has(item.field) || !OPERATIONS.has(item.operation) || !text(item.sourceText || "", 500)) errors.push(`stateOperations.${index}`);
  });
  const expression = value.stay && value.stay.dateExpression;
  if (!expression || !text(expression.rawText || "", 200) || !DATE_KINDS.has(expression.kind) || !ANCHORS.has(expression.anchor)) errors.push("stay.dateExpression");
  if (!Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > 12) errors.push("tasks");
  else {
    const taskIds = new Set();
    value.tasks.forEach((task, index) => {
      const entity = task && task.entity;
      const eligibilityEvidence = task && task.eligibilityEvidence;
      if (!task || !Number.isInteger(task.candidateIndex) || task.candidateIndex < 0 || !text(task.taskId, 80) || !TASK_TYPES.has(task.type) || !text(task.sourceText, 500) || !task.sourceText.trim()
        || (task.detailIntent !== undefined && !DETAIL_INTENTS.has(task.detailIntent)) || !Array.isArray(task.requestedOutputs) || typeof task.dependsOnStayContext !== "boolean" || !confidence(task.confidence)
        || !eligibilityEvidence || typeof eligibilityEvidence !== "object" || Array.isArray(eligibilityEvidence) || !ELIGIBILITY_EVIDENCE_KINDS.has(eligibilityEvidence.kind) || !text(eligibilityEvidence.sourceText || "", 200)
        || !entity || !ENTITY_CATEGORIES.has(entity.category) || !text(entity.rawText || "", 200) || (!entity.rawText && !["availability", "available_dates", "bundle_availability", "room_options", "capacity", "price", "total_price", "amenity", "policy"].includes(task.type))
        || !(entity.canonicalCandidate === null || text(entity.canonicalCandidate, 120)) || !confidence(entity.confidence)
        || !Object.hasOwn(task, "stayCandidate")
        || (task.dependsOnStayContext && task.stayCandidate === null)
        || (task.stayCandidate !== null && !validStayCandidate(task.stayCandidate))) errors.push(`tasks.${index}`);
      if (task && text(task.taskId, 80)) {
        if (taskIds.has(task.taskId)) errors.push("tasks.taskId.duplicate");
        taskIds.add(task.taskId);
      }
    });
  }
  if (!Array.isArray(value.ambiguities)) errors.push("ambiguities");
  if (!Array.isArray(value.missingInformation)) errors.push("missingInformation");
  if (!Array.isArray(value.contextRelationCandidates) || value.contextRelationCandidates.some((item) => !item || !Number.isInteger(item.candidateIndex) || item.candidateIndex < 0 || !CONTEXT_RELATION_KINDS.has(item.kind) || !Array.isArray(item.candidateRequestCycleRefs) || !Array.isArray(item.evidenceRefs))) errors.push("contextRelationCandidates");
  if (typeof value.needsHuman !== "boolean" || typeof value.shouldIgnore !== "boolean" || !text(value.reason, 120)) errors.push("safety");
  return { ok: errors.length === 0, errors };
}

function sourceEventsAreUnicodeNonSubstantive(sourceEvents) {
  const messages = (Array.isArray(sourceEvents) ? sourceEvents : [])
    .map((event) => String(event && event.messageText || "").trim())
    .filter(Boolean);
  return messages.length > 0 && messages.every((message) => /^[\p{P}\p{S}\s]+$/u.test(message));
}

function applyPlannerSemanticContract(value, { catalog, sourceEvents } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.tasks)) return value;
  const acceptedTasks = [], repairedTasks = [], rejectedTasks = [], repairedRelations = [];
  let contextRelationCandidates = value.contextRelationCandidates;
  let tasks = value.tasks.map((original, index) => {
    let task = { ...original, eligibilityEvidence: normalizeEligibilityEvidence(original && original.eligibilityEvidence), entity: original && original.entity ? { ...original.entity } : original && original.entity };
    let entity = task && task.entity;
    if (!entity) return task;

    const groundedTask = groundedPropertyFactTask(task, catalog, value.stay);
    if (groundedTask
      && (task.type !== groundedTask.type
        || task.entity.category !== groundedTask.entity.category
        || task.entity.rawText !== groundedTask.entity.rawText
        || task.entity.canonicalCandidate !== groundedTask.entity.canonicalCandidate)) {
      task = groundedTask;
      entity = task.entity;
      if (task.type === "unknown") {
        rejectedTasks.push({ taskId: task.taskId, index, reason: "property_catalog_entity_conflict" });
      } else {
        repairedTasks.push({ taskId: task.taskId, index, reason: "property_catalog_entity_grounding" });
      }
    }

    if (!groundedTask) {
      const normalizedTask = normalizedUngroundedTaskShape(task);
      if (normalizedTask.type !== task.type
        || normalizedTask.entity.category !== task.entity.category) {
        task = normalizedTask;
        entity = task.entity;
        repairedTasks.push({ taskId: task.taskId, index, reason: "candidate_shape_normalization" });
      }
    }

    if (task.type === "availability" && entity.category === "room" && entity.canonicalCandidate === null && catalog) {
      const inventoryEntity = resolveEntity(catalog, entity);
      if (!["resolved", "matched_set"].includes(inventoryEntity.status)) {
        task = { ...task, entity: { ...entity, category: "other", rawText: "", canonicalCandidate: null } };
        repairedTasks.push({ taskId: task.taskId, index, reason: "generic_availability_entity_unresolved" });
      }
    }

    if (task.type === "property_fact" && task.entity.category === "other" && task.entity.canonicalCandidate === null) {
      rejectedTasks.push({ taskId: task.taskId, index, reason: "unresolved_property_fact" });
      task = { ...task, type: "unknown", detailIntent: "general", requestedOutputs: ["answer"], entity: { ...task.entity, category: "other", canonicalCandidate: null } };
    }

    if (value.discourse && value.discourse.relation === "acknowledgement"
      && ["amenity", "policy", "property_fact"].includes(task.type)
      && !groundedTask) {
      rejectedTasks.push({ taskId: task.taskId, index, reason: "ungrounded_acknowledgement_fact" });
      task = { ...task, type: "unknown", detailIntent: "general", requestedOutputs: ["answer"], entity: { ...task.entity, category: "other", canonicalCandidate: null } };
    }

    if (task.detailIntent === "eligibility" && !hasExplicitEligibilityEvidence(task)) {
      task = { ...task, detailIntent: "general", eligibilityEvidence: { kind: "none", sourceText: "" } };
      repairedTasks.push({ taskId: task.taskId, index, reason: "eligibility_evidence_missing" });
    }
    task = { ...task, requestedOutputs: controlledRequestedOutputs(task) };
    if (!repairedTasks.some((item) => item.index === index) && !rejectedTasks.some((item) => item.index === index)) acceptedTasks.push({ taskId: task.taskId, index });
    return task;
  });
  const acknowledgementWithActionableTask = value.discourse
    && value.discourse.relation === "acknowledgement"
    && tasks.some((task) => task && task.type !== "unknown");
  if (acknowledgementWithActionableTask) {
    const ignoredIndexes = new Set(tasks
      .map((task, index) => task && task.type === "unknown" ? index : -1)
      .filter((index) => index >= 0));
    tasks = tasks.filter((_task, index) => !ignoredIndexes.has(index));
    contextRelationCandidates = Array.isArray(contextRelationCandidates)
      ? contextRelationCandidates.filter((candidate) => !ignoredIndexes.has(candidate.candidateIndex))
      : contextRelationCandidates;
    for (let index = acceptedTasks.length - 1; index >= 0; index -= 1) {
      if (ignoredIndexes.has(acceptedTasks[index].index)) acceptedTasks.splice(index, 1);
    }
    for (const index of ignoredIndexes) {
      rejectedTasks.push({ taskId: value.tasks[index].taskId, index, reason: "acknowledgement_fragment_ignored" });
    }
  }
  const acknowledgementOnly = value.discourse
    && value.discourse.relation === "acknowledgement"
    && tasks.every((task) => task && task.type === "unknown");
  const nonSubstantiveUnknownOnly = tasks.every((task) => task && task.type === "unknown")
    && sourceEventsAreUnicodeNonSubstantive(sourceEvents);
  const silentOnly = acknowledgementOnly || nonSubstantiveUnknownOnly;
  if (silentOnly && Array.isArray(contextRelationCandidates)) {
    const acknowledgementIndexes = new Set(tasks.map((task) => task.candidateIndex));
    contextRelationCandidates = contextRelationCandidates.map((candidate) => {
      if (!candidate || !acknowledgementIndexes.has(candidate.candidateIndex)
        || !Array.isArray(candidate.candidateRequestCycleRefs)) return candidate;
      if (candidate.kind !== "relation_uncertain"
        || candidate.candidateRequestCycleRefs.length > 0) repairedRelations.push({
        candidateIndex: candidate.candidateIndex,
        reason: acknowledgementOnly
          ? "acknowledgement_relation_normalization"
          : "non_substantive_unicode_relation_normalization"
      });
      return {
        ...candidate,
        kind: "relation_uncertain",
        candidateRequestCycleRefs: []
      };
    });
  }
  return {
    ...value,
    tasks,
    contextRelationCandidates,
    shouldIgnore: silentOnly ? true : value.shouldIgnore,
    semanticValidation: { acceptedTasks, repairedTasks, rejectedTasks, repairedRelations }
  };
}

function plannerJsonSchema() {
  const stringEnum = (values) => ({ type: "string", enum: [...values] });
  return {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "discourse", "stateOperations", "stay", "tasks", "contextRelationCandidates", "ambiguities", "missingInformation", "needsHuman", "shouldIgnore", "reason"],
    properties: {
      schemaVersion: { type: "integer", const: 2 },
      discourse: { type: "object", additionalProperties: false, required: ["relation", "confidence"], properties: { relation: stringEnum(RELATIONS), confidence: { type: "number", minimum: 0, maximum: 1 } } },
      stateOperations: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["field", "operation", "value", "sourceText"], properties: { field: stringEnum(PLANNER_OPERATION_PATHS), operation: stringEnum(OPERATIONS), value: { type: ["string", "integer", "boolean", "array", "null"], items: { type: "string" } }, sourceText: { type: "string", maxLength: 500 } } } },
      stay: { type: "object", additionalProperties: false, required: ["dateExpression", "checkInCandidate", "checkOutCandidate", "nightsCandidate", "guestCountCandidate"], properties: { dateExpression: { type: "object", additionalProperties: false, required: ["rawText", "kind", "anchor"], properties: { rawText: { type: "string", maxLength: 200 }, kind: stringEnum(DATE_KINDS), anchor: stringEnum(ANCHORS) } }, checkInCandidate: { type: ["string", "null"] }, checkOutCandidate: { type: ["string", "null"] }, nightsCandidate: { type: ["integer", "null"], minimum: 1, maximum: 60 }, guestCountCandidate: { type: ["integer", "null"], minimum: 1, maximum: 100 } } },
      tasks: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["candidateIndex", "taskId", "type", "sourceText", "detailIntent", "requestedOutputs", "eligibilityEvidence", "dependsOnStayContext", "entity", "stayCandidate", "confidence"], properties: { candidateIndex: { type: "integer", minimum: 0 }, taskId: { type: "string", maxLength: 80 }, type: stringEnum(TASK_TYPES), sourceText: { type: "string", minLength: 1, maxLength: 500 }, detailIntent: stringEnum(DETAIL_INTENTS), requestedOutputs: { type: "array", items: { type: "string", maxLength: 80 } }, eligibilityEvidence: { type: "object", additionalProperties: false, description: "Explicit guest qualification evidence. Use none for a base availability or permission question. Use a non-none kind only when sourceText quotes the person, room, plan, booking mode, identity, or stated condition that makes this an eligibility question.", required: ["kind", "sourceText"], properties: { kind: stringEnum(ELIGIBILITY_EVIDENCE_KINDS), sourceText: { type: "string", maxLength: 200, description: "Exact excerpt from the task sourceText containing the qualification; empty when kind is none." } } }, dependsOnStayContext: { type: "boolean" }, entity: { type: "object", additionalProperties: false, required: ["category", "rawText", "canonicalCandidate", "confidence"], properties: { category: stringEnum(ENTITY_CATEGORIES), rawText: { type: "string", maxLength: 200 }, canonicalCandidate: { type: ["string", "null"], maxLength: 120 }, confidence: { type: "number", minimum: 0, maximum: 1 } } }, stayCandidate: { type: ["object", "null"], additionalProperties: false, required: ["dateExpression", "checkInCandidate", "checkOutCandidate", "nightsCandidate", "guestCountCandidate"], properties: { dateExpression: { type: "object", additionalProperties: false, required: ["rawText", "kind", "anchor"], properties: { rawText: { type: "string", maxLength: 200 }, kind: stringEnum(DATE_KINDS), anchor: stringEnum(ANCHORS) } }, checkInCandidate: { type: ["string", "null"], maxLength: 40 }, checkOutCandidate: { type: ["string", "null"], maxLength: 40 }, nightsCandidate: { type: ["integer", "null"], minimum: 1, maximum: 60 }, guestCountCandidate: { type: ["integer", "null"], minimum: 1, maximum: 100 } } }, confidence: { type: "number", minimum: 0, maximum: 1 } } } },
      contextRelationCandidates: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["candidateIndex", "kind", "candidateRequestCycleRefs", "evidenceRefs"], properties: { candidateIndex: { type: "integer", minimum: 0 }, kind: stringEnum(CONTEXT_RELATION_KINDS), candidateRequestCycleRefs: { type: "array", items: { type: "string", maxLength: 120 } }, evidenceRefs: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["eventId", "messageRef", "startOffset", "endOffset", "quote"], properties: { eventId: { type: "string", maxLength: 120 }, messageRef: { type: "string", maxLength: 120 }, startOffset: { type: "integer", minimum: 0 }, endOffset: { type: "integer", minimum: 0 }, quote: { type: "string", minLength: 1, maxLength: 500 } } } } } } },
      ambiguities: { type: "array", items: { type: "string", maxLength: 300 } }, missingInformation: { type: "array", items: { type: "string", maxLength: 120 } }, needsHuman: { type: "boolean" }, shouldIgnore: { type: "boolean" }, reason: { type: "string", maxLength: 120 }
    }
  };
}

module.exports = { validatePlannerOutput, applyPlannerSemanticContract, plannerJsonSchema, normalizeEligibilityEvidence, discardLegacyPlannerStateControls, TASK_TYPES };
