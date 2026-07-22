"use strict";

const RELATIONS = new Set(["new_request", "continue", "modify", "answer_clarification", "new_topic", "acknowledgement"]);
const OPERATIONS = new Set(["set", "replace", "clear", "keep"]);
const TASK_TYPES = new Set(["availability", "available_dates", "room_options", "bundle_availability", "capacity", "price", "total_price", "amenity", "amenity_list", "policy", "property_fact", "booking_request", "human_help", "high_risk", "unknown"]);
const ENTITY_CATEGORIES = new Set(["room", "bundle", "room_feature", "amenity", "activity", "policy", "payment", "cancellation", "transport", "check_in", "check_out", "other"]);
const DATE_KINDS = new Set(["absolute", "relative", "weekday", "weekend", "range", "contextual", "none"]);
const ANCHORS = new Set(["message_time", "previous_check_in", "previous_check_out", "none"]);
const ELIGIBILITY_EVIDENCE_KINDS = new Set(["none", "person", "room", "plan", "booking_mode", "identity", "stated_condition"]);
const { DETAIL_INTENTS } = require("./detail-intent");
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
function controlledRequestedOutputs(task) {
  if (task.entity && task.entity.canonicalCandidate === "location") return ["map_url"];
  if (["amenity", "policy", "property_fact"].includes(task.type)) return [task.detailIntent === "general" ? "answer" : task.detailIntent];
  return task.requestedOutputs;
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
  else value.tasks.forEach((task, index) => {
    const entity = task && task.entity;
    const eligibilityEvidence = task && task.eligibilityEvidence;
    if (!task || !text(task.taskId, 80) || !TASK_TYPES.has(task.type) || !text(task.sourceText, 500) || !task.sourceText.trim()
      || (task.detailIntent !== undefined && !DETAIL_INTENTS.has(task.detailIntent)) || !Array.isArray(task.requestedOutputs) || typeof task.dependsOnStayContext !== "boolean" || !confidence(task.confidence)
      || !eligibilityEvidence || typeof eligibilityEvidence !== "object" || Array.isArray(eligibilityEvidence) || !ELIGIBILITY_EVIDENCE_KINDS.has(eligibilityEvidence.kind) || !text(eligibilityEvidence.sourceText || "", 200)
      || !entity || !ENTITY_CATEGORIES.has(entity.category) || !text(entity.rawText || "", 200) || (!entity.rawText && !["availability", "available_dates", "bundle_availability", "room_options", "capacity", "price", "total_price"].includes(task.type))
      || !(entity.canonicalCandidate === null || text(entity.canonicalCandidate, 120)) || !confidence(entity.confidence)) errors.push(`tasks.${index}`);
  });
  if (!Array.isArray(value.ambiguities)) errors.push("ambiguities");
  if (!Array.isArray(value.missingInformation)) errors.push("missingInformation");
  if (typeof value.needsHuman !== "boolean" || typeof value.shouldIgnore !== "boolean" || !text(value.reason, 120)) errors.push("safety");
  return { ok: errors.length === 0, errors };
}

function applyPlannerSemanticContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.tasks)) return value;
  const acceptedTasks = [], repairedTasks = [], rejectedTasks = [];
  const tasks = value.tasks.map((original, index) => {
    let task = { ...original, eligibilityEvidence: normalizeEligibilityEvidence(original && original.eligibilityEvidence), entity: original && original.entity ? { ...original.entity } : original && original.entity };
    const entity = task && task.entity;
    if (!entity) return task;

    if (entity.canonicalCandidate === "location") {
      const changed = task.type !== "property_fact" || entity.category !== "transport" || task.detailIntent !== "general";
      task = { ...task, type: "property_fact", detailIntent: "general", requestedOutputs: ["map_url"], entity: { ...entity, category: "transport", canonicalCandidate: "location" } };
      if (changed) repairedTasks.push({ taskId: task.taskId, index, reason: "location_contract_mismatch" });
    } else if (task.type === "property_fact" && entity.category === "transport" && entity.canonicalCandidate === null) {
      task = { ...task, detailIntent: "general", requestedOutputs: ["map_url"], entity: { ...entity, canonicalCandidate: "location" } };
      repairedTasks.push({ taskId: task.taskId, index, reason: "transport_location_candidate_missing" });
    } else if (task.type === "property_fact" && entity.category === "other" && entity.canonicalCandidate === null) {
      rejectedTasks.push({ taskId: task.taskId, index, reason: "unresolved_property_fact" });
      task = { ...task, type: "unknown", detailIntent: "general", requestedOutputs: ["answer"], entity: { ...entity, category: "other", canonicalCandidate: null } };
    }

    if (task.detailIntent === "eligibility" && !hasExplicitEligibilityEvidence(task)) {
      task = { ...task, detailIntent: "general", eligibilityEvidence: { kind: "none", sourceText: "" } };
      repairedTasks.push({ taskId: task.taskId, index, reason: "eligibility_evidence_missing" });
    }
    task = { ...task, requestedOutputs: controlledRequestedOutputs(task) };
    if (!repairedTasks.some((item) => item.index === index) && !rejectedTasks.some((item) => item.index === index)) acceptedTasks.push({ taskId: task.taskId, index });
    return task;
  });
  return { ...value, tasks, semanticValidation: { acceptedTasks, repairedTasks, rejectedTasks } };
}

function plannerJsonSchema() {
  const stringEnum = (values) => ({ type: "string", enum: [...values] });
  return {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "discourse", "stateOperations", "stay", "tasks", "ambiguities", "missingInformation", "needsHuman", "shouldIgnore", "reason"],
    properties: {
      schemaVersion: { type: "integer", const: 2 },
      discourse: { type: "object", additionalProperties: false, required: ["relation", "confidence"], properties: { relation: stringEnum(RELATIONS), confidence: { type: "number", minimum: 0, maximum: 1 } } },
      stateOperations: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["field", "operation", "value", "sourceText"], properties: { field: stringEnum(PLANNER_OPERATION_PATHS), operation: stringEnum(OPERATIONS), value: { type: ["string", "integer", "boolean", "array", "null"], items: { type: "string" } }, sourceText: { type: "string", maxLength: 500 } } } },
      stay: { type: "object", additionalProperties: false, required: ["dateExpression", "checkInCandidate", "checkOutCandidate", "nightsCandidate", "guestCountCandidate"], properties: { dateExpression: { type: "object", additionalProperties: false, required: ["rawText", "kind", "anchor"], properties: { rawText: { type: "string", maxLength: 200 }, kind: stringEnum(DATE_KINDS), anchor: stringEnum(ANCHORS) } }, checkInCandidate: { type: ["string", "null"] }, checkOutCandidate: { type: ["string", "null"] }, nightsCandidate: { type: ["integer", "null"], minimum: 1, maximum: 60 }, guestCountCandidate: { type: ["integer", "null"], minimum: 1, maximum: 100 } } },
      tasks: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["taskId", "type", "sourceText", "detailIntent", "requestedOutputs", "eligibilityEvidence", "dependsOnStayContext", "entity", "confidence"], properties: { taskId: { type: "string", maxLength: 80 }, type: stringEnum(TASK_TYPES), sourceText: { type: "string", minLength: 1, maxLength: 500 }, detailIntent: stringEnum(DETAIL_INTENTS), requestedOutputs: { type: "array", items: { type: "string", maxLength: 80 } }, eligibilityEvidence: { type: "object", additionalProperties: false, description: "Explicit guest qualification evidence. Use none for a base availability or permission question. Use a non-none kind only when sourceText quotes the person, room, plan, booking mode, identity, or stated condition that makes this an eligibility question.", required: ["kind", "sourceText"], properties: { kind: stringEnum(ELIGIBILITY_EVIDENCE_KINDS), sourceText: { type: "string", maxLength: 200, description: "Exact excerpt from the task sourceText containing the qualification; empty when kind is none." } } }, dependsOnStayContext: { type: "boolean" }, entity: { type: "object", additionalProperties: false, required: ["category", "rawText", "canonicalCandidate", "confidence"], properties: { category: stringEnum(ENTITY_CATEGORIES), rawText: { type: "string", maxLength: 200 }, canonicalCandidate: { type: ["string", "null"], maxLength: 120 }, confidence: { type: "number", minimum: 0, maximum: 1 } } }, confidence: { type: "number", minimum: 0, maximum: 1 } } } },
      ambiguities: { type: "array", items: { type: "string", maxLength: 300 } }, missingInformation: { type: "array", items: { type: "string", maxLength: 120 } }, needsHuman: { type: "boolean" }, shouldIgnore: { type: "boolean" }, reason: { type: "string", maxLength: 120 }
    }
  };
}

module.exports = { validatePlannerOutput, applyPlannerSemanticContract, plannerJsonSchema, normalizeEligibilityEvidence, TASK_TYPES };
