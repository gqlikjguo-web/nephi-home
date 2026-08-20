"use strict";

const {
  createConversationStateV3,
  createConversationTaskV3
} = require("../conversation-contracts/conversation-state-v3");
const {
  evaluateTaskReadiness
} = require("../conversation-contracts/task-readiness");
const {
  getCapabilityDefinition
} = require("./capability-registry");
const { resolveEntity } = require("./entity-resolver");

const PENDING_STATUSES = new Set(["pending", "needs_clarification"]);
const CONTEXT_EXCLUDED_STATUSES = new Set(["expired", "cancelled"]);
const LODGING_PLANNER_TYPES = new Set([
  "availability",
  "available_dates",
  "room_options",
  "bundle_availability",
  "capacity",
  "price",
  "total_price"
]);

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function runtimeScope(scope = {}) {
  return {
    propertyId: String(scope.propertyId || ""),
    channel: String(scope.channel || scope.channelId || ""),
    userId: String(scope.userId || scope.lineUserId || "")
  };
}

function currentTask(task, now) {
  return task
    && !CONTEXT_EXCLUDED_STATUSES.has(task.status)
    && Date.parse(task.expiresAt) > Date.parse(now);
}

function inventoryForTask(task) {
  if (task.productType === "bundle") {
    return {
      mode: "bundle_only",
      entityId: task.bundleId,
      features: []
    };
  }
  if (task.productType === "room_type") {
    return {
      mode: "room_only",
      entityId: task.roomTypeId,
      features: []
    };
  }
  return {
    mode: "any",
    entityId: null,
    features: []
  };
}

function temporalForTask(task) {
  if (!task.checkIn && !task.searchFrom) return null;
  return {
    resolutionStatus: "resolved",
    checkIn: task.checkIn,
    checkOut: task.checkOut,
    nights: task.checkIn && task.checkOut ? null : null,
    searchRange: task.searchFrom && task.searchTo
      ? { from: task.searchFrom, to: task.searchTo }
      : null,
    fields: {}
  };
}

function approvedProductForTask(task, catalog) {
  const entity = task && task.entity || {};
  const resolved = catalog && resolveEntity(catalog, entity);
  const approved = resolved && resolved.status === "resolved" && resolved.entity;
  if (approved && approved.category === "bundle") return { productType: "bundle", productId: approved.canonicalId, roomTypeId: null, bundleId: approved.canonicalId };
  if (approved && approved.category === "room") return { productType: "room_type", productId: approved.canonicalId, roomTypeId: approved.canonicalId, bundleId: null };
  return { productType: "any", productId: null, roomTypeId: null, bundleId: null };
}

function buildContextSnapshotV3(state, scope = {}) {
  const now = String(scope.now || new Date().toISOString());
  const expectedScope = runtimeScope(scope);
  const sameScope = state
    && state.scope
    && state.scope.propertyId === expectedScope.propertyId
    && state.scope.channel === expectedScope.channel
    && state.scope.userId === expectedScope.userId;
  return {
    scope: {
      propertyId: expectedScope.propertyId,
      channelId: expectedScope.channel,
      userId: expectedScope.userId
    },
    generatedAt: now,
    cycles: sameScope
      ? state.tasks.filter((task) => currentTask(task, now)).map((task) => ({
        requestCycleId: task.taskId,
        requestKind: task.taskType,
        status: task.status,
        confirmedInputs: {
          stay: {
            checkIn: task.checkIn,
            checkOut: task.checkOut,
            nights: null,
            guests: task.guestCount,
            searchRange: task.searchFrom && task.searchTo
              ? { from: task.searchFrom, to: task.searchTo }
              : null
          },
          inventory: inventoryForTask(task),
          topic: {
            capabilityType: task.taskType,
            canonicalId: task.entityId,
            category: task.entityCategory,
            detailIntent: task.detailIntent,
            detailFields: []
          }
        },
        temporalResult: temporalForTask(task),
        sourceEvidenceRefs: [],
        contextReuseExpiresAt: task.expiresAt,
        pendingRequestId: PENDING_STATUSES.has(task.status)
          ? task.taskId
          : null
      }))
      : []
  };
}

function plannerTypeForTask(task) {
  if (task.taskType === "pricing") return "price";
  if (task.taskType === "location") return "property_fact";
  const definition = getCapabilityDefinition(task.taskType);
  if (definition) {
    return definition.acceptedCandidateTypes.includes(task.taskType)
      ? task.taskType
      : definition.acceptedCandidateTypes[0];
  }
  return task.taskType;
}

function requestedOutputsForTask(task) {
  if (task.taskType === "pricing") return ["price"];
  if (task.taskType === "location") return ["map_url"];
  return ["answer"];
}

function plannerTaskFromState(stateTask, currentPlannerTask) {
  return {
    ...clone(currentPlannerTask),
    candidateIndex: currentPlannerTask.candidateIndex,
    taskId: stateTask.taskId,
    type: plannerTypeForTask(stateTask),
    sourceText: currentPlannerTask.sourceText,
    detailIntent: currentPlannerTask.detailIntent
      || stateTask.detailIntent
      || "general",
    requestedOutputs: requestedOutputsForTask(stateTask),
    dependsOnStayContext: [
      "availability",
      "pricing",
      "available_dates",
      "room_options",
      "capacity"
    ].includes(stateTask.taskType),
    // The reducer has approved this as a continuation.  Its persisted task,
    // rather than the untrusted Planner entity text, is therefore the sole
    // authority for the resumed task's topic and product.
    entity: {
      category: stateTask.entityCategory || (
        stateTask.productType === "bundle"
          ? "bundle"
          : stateTask.productType === "room_type"
            ? "room"
            : "other"
      ),
      rawText: "",
      canonicalCandidate: stateTask.entityId
        || stateTask.productId
        || null,
      confidence: 1
    }
  };
}

function suppliedSlotFields(task) {
  const stay = task && task.stayCandidate || {};
  const entity = task && task.entity || {};
  const supplied = new Set();
  if (stay.checkInCandidate || (
    stay.dateExpression && stay.dateExpression.rawText
  )) supplied.add("checkIn");
  if (stay.checkOutCandidate || Number.isInteger(stay.nightsCandidate)) {
    supplied.add("checkOut");
  }
  if (Number.isInteger(stay.guestCountCandidate)) {
    supplied.add("guestCount");
  }
  if (entity.canonicalCandidate && entity.category === "room") {
    supplied.add("productId");
    supplied.add("roomTypeId");
  }
  if (entity.canonicalCandidate && entity.category === "bundle") {
    supplied.add("productId");
    supplied.add("bundleId");
  }
  return supplied;
}

function isSlotOnlyLodgingTurn(task) {
  const stay = task && task.stayCandidate || {};
  const entity = task && task.entity || {};
  const hasDate = Boolean(
    stay.checkInCandidate
    || stay.checkOutCandidate
    || stay.dateExpression && stay.dateExpression.rawText
  );
  const hasNights = Number.isInteger(stay.nightsCandidate);
  const hasStandaloneNights = hasNights && !hasDate;
  const hasGuests = Number.isInteger(stay.guestCountCandidate);
  const hasProduct = Boolean(
    entity.canonicalCandidate
    && ["room", "bundle"].includes(entity.category)
  );
  const hasOtherEntity = Boolean(
    entity.canonicalCandidate
    && !["room", "bundle"].includes(entity.category)
  );
  const hasRangeOrCheckOut = Boolean(
    stay.dateExpression && stay.dateExpression.kind === "range"
  );
  const suppliedSlotKindCount = [hasDate, hasStandaloneNights, hasGuests, hasProduct]
    .filter(Boolean).length;
  const entityRawTextPresent = Boolean(String(entity.rawText || "").trim());
  const sourceEqualsDateExpression = String(task && task.sourceText || "").trim()
    === String(stay.dateExpression && stay.dateExpression.rawText || "").trim();
  let finalSlotOnlyResult = Boolean(
    task && LODGING_PLANNER_TYPES.has(task.type)
  );
  if (finalSlotOnlyResult && hasOtherEntity) finalSlotOnlyResult = false;
  if (finalSlotOnlyResult && suppliedSlotKindCount !== 1) {
    finalSlotOnlyResult = false;
  }
  if (finalSlotOnlyResult && hasDate) {
    finalSlotOnlyResult = !hasRangeOrCheckOut
      && !entityRawTextPresent
      && sourceEqualsDateExpression;
  } else if (finalSlotOnlyResult && hasStandaloneNights) {
    finalSlotOnlyResult = !entityRawTextPresent;
  } else if (finalSlotOnlyResult && hasProduct) {
    finalSlotOnlyResult = true;
  } else if (finalSlotOnlyResult) {
    finalSlotOnlyResult = hasGuests && !entityRawTextPresent;
  }
  return {
    result: finalSlotOnlyResult,
    diagnostic: {
      hasDate,
      hasRangeOrCheckOut,
      hasStandaloneNights,
      hasGuests,
      hasProduct,
      hasOtherEntity,
      suppliedSlotKindCount,
      entityRawTextPresent,
      sourceEqualsDateExpression,
      finalSlotOnlyResult
    }
  };
}

function automaticPendingRelation(state, plannerTasks, relations, now) {
  const plannerTaskCount = Array.isArray(plannerTasks) ? plannerTasks.length : 0;
  const result = (reasonCode, relation = null, details = {}) => ({
    relation,
    diagnostic: {
      reasonCode,
      plannerTaskCount,
      explicitRelationPresent: false,
      slotOnlyLodgingTurn: false,
      clarificationCandidateCount: 0,
      compatibleCandidateCount: 0,
      continuationSelected: false,
      ...details
    }
  });
  if (plannerTaskCount !== 1) {
    return result("planner_task_count_not_one");
  }
  const task = plannerTasks[0];
  const relation = (relations || []).find(
    (candidate) => candidate.candidateIndex === task.candidateIndex
  );
  if (relation && ["continue", "replace", "end"].includes(
    relation.stateAction
  )) return result("explicit_relation_present", null, {
    explicitRelationPresent: true
  });
  const slotPredicate = isSlotOnlyLodgingTurn(task);
  if (!slotPredicate.result) {
    return result("not_slot_only_lodging_turn", null, {
      slotPredicateDiagnostic: slotPredicate.diagnostic
    });
  }
  const supplied = suppliedSlotFields(task);
  const lodgingTaskTypes = new Set([
    "availability",
    "pricing",
    "available_dates",
    "room_options",
    "capacity"
  ]);
  const slotCompatible = (candidate) => {
    if (!currentTask(candidate, now) || !lodgingTaskTypes.has(candidate.taskType)) {
      return false;
    }
    if (supplied.has("productId") && candidate.taskType !== contractTaskType(task.type)) {
      return false;
    }
    if (PENDING_STATUSES.has(candidate.status)) {
      return candidate.missingFields.some((field) => supplied.has(field))
        || supplied.has("productId");
    }
    return candidate.status === "answered";
  };
  const compatibleCandidates = state.tasks.filter(slotCompatible);
  const clarificationCandidates = compatibleCandidates.filter((candidate) => (
    candidate.status === "needs_clarification"
  ));
  if (clarificationCandidates.length > 1) {
    return result("clarification_focus_ambiguous", null, {
      slotOnlyLodgingTurn: true,
      clarificationCandidateCount: clarificationCandidates.length,
      compatibleCandidateCount: compatibleCandidates.length,
      slotPredicateDiagnostic: slotPredicate.diagnostic
    });
  }
  let candidates = clarificationCandidates.length === 1
    ? clarificationCandidates
    : compatibleCandidates;
  if (
    clarificationCandidates.length === 0
    && candidates.length > 1
    && candidates.every((candidate) => candidate.status === "answered")
  ) {
    const taskType = contractTaskType(task.type);
    const entity = task.entity || {};
    const productScope = entity.category === "bundle" && entity.canonicalCandidate
      ? `bundle:${entity.canonicalCandidate}`
      : entity.category === "room" && entity.canonicalCandidate
        ? `room_type:${entity.canonicalCandidate}`
        : null;
    const candidateScope = (candidate) => candidate.productType === "bundle"
      ? `bundle:${candidate.bundleId || candidate.productId || ""}`
      : candidate.productType === "room_type"
        ? `room_type:${candidate.roomTypeId || candidate.productId || ""}`
        : null;
    if (
      productScope
      && candidates.every((candidate) => (
        candidate.taskType === taskType
        && candidateScope(candidate) === productScope
      ))
    ) {
      const latestTimestamp = Math.max(...candidates.map(
        (candidate) => Date.parse(candidate.updatedAt)
      ));
      const latest = candidates.filter(
        (candidate) => Date.parse(candidate.updatedAt) === latestTimestamp
      );
      if (Number.isFinite(latestTimestamp) && latest.length === 1) {
        candidates = latest;
      }
    }
  }
  if (candidates.length !== 1) {
    return result("no_unique_compatible_candidate", null, {
      slotOnlyLodgingTurn: true,
      clarificationCandidateCount: clarificationCandidates.length,
      compatibleCandidateCount: candidates.length,
      slotPredicateDiagnostic: slotPredicate.diagnostic
    });
  }
  const target = candidates[0];
  return result("continuation_selected", {
    ...(relation || {
      candidateIndex: task.candidateIndex,
      evidenceRefs: []
    }),
    relationKind: "state_slot_supplement",
    stateAction: "continue",
    requestCycleId: target.taskId,
    reasonCode: "unique_pending_slot_update"
  }, {
    slotOnlyLodgingTurn: true,
    clarificationCandidateCount: clarificationCandidates.length,
    compatibleCandidateCount: candidates.length,
    continuationSelected: true,
    slotPredicateDiagnostic: slotPredicate.diagnostic
  });
}

function decideContextExecutionV3({
  state,
  relations = [],
  plannerTasks = [],
  catalog,
  now
}) {
  const effectiveRelations = [...(relations || [])];
  const automaticPending = automaticPendingRelation(
    state,
    plannerTasks,
    effectiveRelations,
    now
  );
  const automaticRelation = automaticPending.relation;
  if (automaticRelation) {
    const relationIndex = effectiveRelations.findIndex(
      (relation) => relation.candidateIndex === automaticRelation.candidateIndex
    );
    if (relationIndex === -1) effectiveRelations.push(automaticRelation);
    else effectiveRelations[relationIndex] = automaticRelation;
  }
  const relationByCandidate = new Map(effectiveRelations.map(
    (relation) => [relation.candidateIndex, relation]
  ));
  const endedTaskIds = [...new Set(effectiveRelations
    .filter((relation) => (
      relation.stateAction === "end"
      && relation.requestCycleId
      && state.tasks.some(
        (task) => task.taskId === relation.requestCycleId
      )
    ))
    .map((relation) => relation.requestCycleId))];
  let resumedPending = false;
  const executionItems = plannerTasks.flatMap((task) => {
    const relation = relationByCandidate.get(task.candidateIndex);
    if (relation && relation.stateAction === "end") return [];
    if (relation && ["continue", "replace"].includes(relation.stateAction)) {
      const target = state.tasks.find(
        (candidate) => candidate.taskId === relation.requestCycleId
          && currentTask(candidate, now)
      );
      if (target) {
        const currentProduct = approvedProductForTask(task, catalog);
        const contextInventory = inventoryForTask(target);
        const contextProduct = contextInventory.mode === "bundle_only"
          ? { productType: "bundle", productId: target.productId, roomTypeId: null, bundleId: target.bundleId }
          : contextInventory.mode === "room_only"
            ? { productType: "room_type", productId: target.productId, roomTypeId: target.roomTypeId, bundleId: null }
            : { productType: "any", productId: null, roomTypeId: null, bundleId: null };
        resumedPending = resumedPending || PENDING_STATUSES.has(target.status);
        const preserveCurrentSemantic = contractTaskType(task.type) !== target.taskType
          && suppliedSlotFields(task).size === 0;
        const contextTask = preserveCurrentSemantic
          ? {
            ...plannerTaskFromState(target, task),
            type: task.type,
            requestedOutputs: clone(task.requestedOutputs),
            dependsOnStayContext: task.dependsOnStayContext,
            detailIntent: task.detailIntent || target.detailIntent || "general"
          }
          : plannerTaskFromState(target, task);
        return [{
          candidateIndex: task.candidateIndex,
          requestCycleId: target.taskId,
          task: contextTask,
          transition: {
            reasonCode: relation.reasonCode || (
              relation.stateAction === "replace"
                ? "replace_existing_task"
                : "continue_existing_task"
            ),
            contextTask: target,
            approvedProduct: currentProduct.productType === "any" ? contextProduct : currentProduct,
            slotSources: {
              checkIn: task.stayCandidate && task.stayCandidate.checkInCandidate ? "current_turn" : target.checkIn ? "completed_or_pending_context" : "absent",
              checkOut: task.stayCandidate && (task.stayCandidate.checkOutCandidate || Number.isInteger(task.stayCandidate.nightsCandidate)) ? "current_turn" : target.checkOut ? "completed_or_pending_context" : "absent",
              product: task.entity && task.entity.canonicalCandidate ? "current_turn" : target.productId ? "completed_or_pending_context" : "absent"
            }
          }
        }];
      }
    }
    const requestedCycleId = String(task.lodgingScopeId || task.taskId);
    const repeatedTaskId = state.tasks.some(
      (candidate) => candidate.taskId === requestedCycleId
    );
    const newRequestCycleId = repeatedTaskId
      ? `${requestedCycleId}#${Number(state.revision || 0) + 1}-${task.candidateIndex}`
      : requestedCycleId;
    return [{
      candidateIndex: task.candidateIndex,
      requestCycleId: relation && relation.requestCycleId
        || newRequestCycleId,
      task,
      transition: { reasonCode: "new_task", contextTask: null, approvedProduct: approvedProductForTask(task, catalog), slotSources: { checkIn: task.stayCandidate && task.stayCandidate.checkInCandidate ? "current_turn" : "absent", checkOut: task.stayCandidate && (task.stayCandidate.checkOutCandidate || Number.isInteger(task.stayCandidate.nightsCandidate)) ? "current_turn" : "absent", product: task.entity && task.entity.canonicalCandidate ? "current_turn" : "absent" } }
    }];
  });
  const primary = effectiveRelations.find(
    (relation) => relation.stateAction && relation.stateAction !== "none"
  ) || {
    candidateIndex: null,
    stateAction: "none",
    requestCycleId: null
  };
  return {
    contextDecision: {
      action: primary.stateAction || "none",
      requestCycleId: primary.requestCycleId || null,
      candidateIndex: primary.candidateIndex,
      reasonCode: primary.reasonCode || primary.stateAction || "none"
    },
    contextDecisions: effectiveRelations.map((relation) => ({
      candidateIndex: relation.candidateIndex,
      action: relation.stateAction || "none",
      requestCycleId: relation.requestCycleId || (
        plannerTasks.find(
          (task) => task.candidateIndex === relation.candidateIndex
        ) || {}
      ).taskId || null,
      referencedRequestCycleId: relation.requestCycleId || null
    })),
    executionItems,
    executionTasks: executionItems.map((item) => item.task),
    relations: effectiveRelations,
    endedTaskIds,
    resumedPending,
    automaticPendingDiagnostic: automaticPending.diagnostic
  };
}

function contractTaskType(capability) {
  if (["price", "total_price"].includes(capability)) return "pricing";
  if (capability === "bundle_availability") return "availability";
  return capability;
}

function executionConditionsV3(state, item) {
  const request = item.canonicalRequest;
  const temporal = request.temporalState || {};
  const prior = (state && state.tasks || []).find(
    (task) => task.taskId === item.requestCycleId
  );
  const currentGuests = item.stateInput
    && item.stateInput.confirmedFields
    && item.stateInput.confirmedFields.guests;
  const product = request.lodgingProduct;
  return {
    stay: {
      checkIn: temporal.checkIn || prior && prior.checkIn || null,
      checkOut: temporal.checkOut || prior && prior.checkOut || null,
      nights: Number.isInteger(temporal.nights) ? temporal.nights : null,
      guests: Number.isInteger(currentGuests)
        ? currentGuests
        : prior && prior.guestCount || null,
      searchRange: temporal.searchRange || (
        prior && prior.searchFrom && prior.searchTo
          ? { from: prior.searchFrom, to: prior.searchTo }
          : null
      )
    },
    inventory: product.productType === "bundle"
      ? {
        mode: "bundle_only",
        entityId: product.bundleId,
        features: []
      }
      : product.productType === "room_type"
        ? {
          mode: "room_only",
          entityId: product.roomTypeId,
          features: []
        }
        : {
          mode: "any",
          entityId: null,
          features: []
        },
    topic: {
      capabilityType: request.capability,
      canonicalId: request.canonicalEntity.canonicalId,
      category: request.canonicalEntity.category,
      detailIntent: request.detailIntent,
      detailFields: []
    }
  };
}

function statusForOutcome(outcome, readiness, clarificationSelected = false) {
  if (!outcome) {
    return readiness.status === "ready" ? "ready"
      : readiness.status === "missing" ? "pending"
        : "needs_human";
  }
  if (["answered", "no_availability"].includes(outcome.outcome)) {
    return "answered";
  }
  if (outcome.outcome === "not_ready") {
    return ["missing_information", "past_date"].includes(outcome.readinessStatus)
      && readiness.status === "missing"
      ? clarificationSelected ? "needs_clarification" : "pending"
      : "needs_human";
  }
  if (outcome.outcome === "unknown") return "unknown";
  return "needs_human";
}

function reduceConversationStateV3({
  previous,
  canonicalItems = [],
  formalRequests = [],
  executionOutcomes = [],
  endedTaskIds = [],
  clarificationTaskIds = [],
  scope = {}
}) {
  const now = String(scope.now || new Date().toISOString());
  const byTaskId = new Map(
    (previous && previous.tasks || []).map((task) => [
      task.taskId,
      task.status === "needs_clarification"
        ? createConversationTaskV3({ ...task, status: "pending" })
        : task
    ])
  );
  const clarificationIds = new Set(clarificationTaskIds.map(String));
  for (const taskId of new Set(endedTaskIds)) {
    const prior = byTaskId.get(taskId);
    if (!prior) continue;
    byTaskId.set(taskId, createConversationTaskV3({
      ...prior,
      status: "cancelled",
      updatedAt: now
    }));
  }
  const formalByTaskId = new Map(
    formalRequests.map((request) => [request.taskId, request])
  );
  const outcomeByTaskId = new Map(
    executionOutcomes.map((outcome) => [outcome.taskId, outcome])
  );
  for (const item of canonicalItems) {
    const request = item.canonicalRequest;
    const formal = formalByTaskId.get(request.taskId) || {};
    const stay = formal.stay || {};
    const product = request.lodgingProduct;
    const taskType = contractTaskType(request.capability);
    // FormalRequest produces readiness once per canonical task.  State is a
    // downstream consumer of that result, never a second readiness authority.
    if (!formal.readiness || typeof formal.readiness !== "object") {
      throw new TypeError("formal_request_readiness_required");
    }
    const readiness = {
      ...formal.readiness,
      status: formal.readiness.status === "missing_information"
        ? "missing"
        : formal.readiness.status
    };
    const stateTaskId = item.requestCycleId || request.taskId;
    const prior = byTaskId.get(stateTaskId);
    byTaskId.set(stateTaskId, createConversationTaskV3({
      taskId: stateTaskId,
      taskType,
      ...product,
      checkIn: stay.checkIn || null,
      checkOut: stay.checkOut || null,
      guestCount: Number.isInteger(stay.guests) ? stay.guests : null,
      searchFrom: stay.searchRange && stay.searchRange.from || null,
      searchTo: stay.searchRange && stay.searchRange.to || null,
      entityId: request.canonicalEntity.canonicalId,
      entityCategory: request.canonicalEntity.canonicalId
        ? request.canonicalEntity.category
        : null,
      detailIntent: request.detailIntent,
      knownFields: readiness.knownFields,
      missingFields: readiness.missingFields,
      status: statusForOutcome(
        outcomeByTaskId.get(request.taskId),
        readiness,
        clarificationIds.has(request.taskId)
      ),
      createdAt: prior && prior.createdAt || now,
      updatedAt: now,
      expiresAt: new Date(
        Date.parse(now) + 24 * 60 * 60 * 1000
      ).toISOString()
    }));
  }
  const tasks = [...byTaskId.values()];
  const expiries = tasks.map((task) => task.expiresAt).sort();
  return createConversationStateV3({
    ...runtimeScope(scope),
    revision: Number.isInteger(previous && previous.revision)
      ? previous.revision + 1
      : 1,
    tasks,
    createdAt: previous && previous.createdAt || now,
    updatedAt: now,
    expiresAt: expiries.at(-1) || now
  });
}

module.exports = {
  buildContextSnapshotV3,
  decideContextExecutionV3,
  executionConditionsV3,
  reduceConversationStateV3
};
