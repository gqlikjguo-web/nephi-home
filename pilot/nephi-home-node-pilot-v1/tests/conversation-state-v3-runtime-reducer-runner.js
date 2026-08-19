"use strict";

const assert = require("node:assert/strict");
const {
  createConversationStateV3,
  createConversationTaskV3
} = require("../lib/conversation-contracts/conversation-state-v3");
const {
  buildContextSnapshotV3,
  decideContextExecutionV3,
  executionConditionsV3,
  reduceConversationStateV3
} = require("../lib/conversation-engine-v2/conversation-state-v3-reducer");
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");
const { canonicalizeExecutionItem } = require("../lib/conversation-engine-v2/canonicalizer");
const { buildCanonicalFormalRequest } = require("../lib/conversation-engine-v2/formal-request");

const NOW = "2026-07-30T07:00:00.000Z";
const FUTURE = "2026-07-31T07:00:00.000Z";
const scope = {
  propertyId: "property_alpha",
  channel: "line:alpha",
  userId: "Ualpha"
};
const catalog = {
  propertyId: scope.propertyId,
  timezone: "Asia/Taipei",
  rooms: [
    { canonicalId: "room-double", category: "room" },
    { canonicalId: "room-quad", category: "room" },
    { canonicalId: "bundle-all", category: "bundle" }
  ],
  amenities: [],
  policies: [],
  faqs: []
};

function fieldProvenanceFromHistory(requestCycleId, historyTurn, productHistoryTurn = historyTurn) {
  const context = (sourceHistoryTurn) => ({
    provenance: "context",
    sourceHistoryTurnRefs: [sourceHistoryTurn],
    candidateRequestCycleRefs: [requestCycleId],
    historyTurnBound: true
  });
  const none = {
    provenance: null,
    sourceHistoryTurnRefs: [],
    candidateRequestCycleRefs: []
  };
  return {
    checkIn: context(historyTurn),
    checkOut: context(historyTurn),
    guestCount: { ...none },
    product: context(productHistoryTurn),
    searchRange: { ...none }
  };
}

function pendingPricingTask(overrides = {}) {
  return createConversationTaskV3({
    taskId: "pricing-task",
    taskType: "pricing",
    productType: "any",
    productId: null,
    roomTypeId: null,
    bundleId: null,
    checkIn: null,
    checkOut: null,
    guestCount: null,
    entityId: null,
    entityCategory: null,
    detailIntent: "general",
    knownFields: ["productType"],
    missingFields: ["checkIn", "checkOut"],
    status: "pending",
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: FUTURE,
    ...overrides
  });
}

const previous = createConversationStateV3({
  ...scope,
  tasks: [pendingPricingTask()],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});

const snapshot = buildContextSnapshotV3(previous, {
  propertyId: scope.propertyId,
  channelId: scope.channel,
  lineUserId: scope.userId,
  now: NOW
});
assert.equal(snapshot.cycles.length, 1);
assert.equal(snapshot.cycles[0].requestCycleId, "pricing-task");
assert.equal(snapshot.cycles[0].requestKind, "pricing");
assert.equal(snapshot.cycles[0].pendingRequestId, "pricing-task");

const dateOnlyPlannerTask = {
  candidateIndex: 0,
  taskId: "date-only",
  type: "available_dates",
  sourceText: "7/30",
  detailIntent: "general",
  requestedOutputs: ["availability"],
  eligibilityEvidence: { kind: "none", sourceText: "" },
  dependsOnStayContext: true,
  entity: {
    category: "other",
    rawText: "",
    canonicalCandidate: null,
    confidence: 0.99
  },
  stayCandidate: {
    dateExpression: {
      rawText: "7/30",
      kind: "absolute",
      anchor: "message_time"
    },
    checkInCandidate: "2026-07-30",
    checkOutCandidate: null,
    nightsCandidate: 1,
    guestCountCandidate: null
  },
  confidence: 0.99
};
const decision = decideContextExecutionV3({
  state: previous,
  relations: [{
    candidateIndex: 0,
    relationKind: "state_slot_supplement",
    stateAction: "continue",
    requestCycleId: "pricing-task",
    reasonCode: "planner_structured_context_continue",
    evidenceRefs: [{
      eventId: "event-date",
      messageRef: "",
      startOffset: 0,
      endOffset: 4,
      quote: "7/30"
    }]
  }],
  plannerTasks: [dateOnlyPlannerTask],
  now: NOW
});
assert.equal(decision.resumedPending, true);
assert.equal(decision.executionItems.length, 1);
assert.equal(decision.executionItems[0].requestCycleId, "pricing-task");
assert.equal(decision.executionItems[0].task.type, "price");
assert.equal(
  decision.executionItems[0].task.stayCandidate.checkInCandidate,
  "2026-07-30"
);
assert.equal(decision.relations[0].stateAction, "continue");
assert.equal(decision.relations[0].requestCycleId, "pricing-task");
assert.equal(decision.contextDecision.reasonCode, "planner_structured_context_continue");

const mixedPrevious = createConversationStateV3({
  ...scope,
  tasks: [
    pendingPricingTask(),
    createConversationTaskV3({
      taskId: "parking-task",
      taskType: "parking",
      productType: "any",
      productId: null,
      roomTypeId: null,
      bundleId: null,
      checkIn: null,
      checkOut: null,
      guestCount: null,
      entityId: "parking",
      entityCategory: "amenity",
      detailIntent: "general",
      knownFields: ["productType"],
      missingFields: [],
      status: "answered",
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: FUTURE
    })
  ],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
const mixedDecision = decideContextExecutionV3({
  state: mixedPrevious,
  relations: [],
  plannerTasks: [dateOnlyPlannerTask],
  now: NOW
});
assert.equal(mixedDecision.resumedPending, true);
assert.equal(mixedDecision.executionItems[0].requestCycleId, "pricing-task");

const repeatedNewRequest = decideContextExecutionV3({
  state: previous,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "pricing-task",
    type: "availability",
    sourceText: "new independent request"
  }],
  now: NOW
});
assert.notEqual(
  repeatedNewRequest.executionItems[0].requestCycleId,
  "pricing-task",
  "a repeated Planner task id must not merge a new request into stale state"
);

const pendingCapacityState = createConversationStateV3({
  ...scope,
  tasks: [pendingPricingTask({
    taskId: "pending-capacity-task",
    taskType: "capacity",
    productType: "room_type",
    productId: "room-double",
    roomTypeId: "room-double",
    entityId: "room-double",
    entityCategory: "room",
    knownFields: ["productType", "productId", "roomTypeId"],
    missingFields: ["checkIn", "checkOut", "guestCount"]
  })],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
const newBundlePriceRequest = decideContextExecutionV3({
  state: pendingCapacityState,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "bundle-price-request",
    type: "price",
    sourceText: "bundle price request",
    requestedOutputs: ["price"],
    entity: {
      category: "bundle",
      rawText: "whole property",
      canonicalCandidate: "bundle-all",
      confidence: 0.99
    },
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }],
  catalog,
  now: NOW
});
assert.equal(newBundlePriceRequest.executionItems[0].requestCycleId, "bundle-price-request");
assert.equal(newBundlePriceRequest.executionItems[0].task.type, "price");
assert.equal(newBundlePriceRequest.contextDecision.action, "start");

const saturdayPriceContinuation = decideContextExecutionV3({
  state: previous,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "planner-availability",
    type: "availability",
    sourceText: "星期六",
    stayCandidate: {
      ...dateOnlyPlannerTask.stayCandidate,
      dateExpression: {
        rawText: "星期六",
        kind: "weekday",
        anchor: "message_time"
      },
      checkInCandidate: null
    }
  }],
  catalog,
  now: NOW
});
assert.equal(saturdayPriceContinuation.executionItems[0].requestCycleId, "pricing-task");
assert.equal(saturdayPriceContinuation.executionItems[0].task.type, "price");

const nightsPriceContinuation = decideContextExecutionV3({
  state: previous,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "planner-availability-nights",
    type: "availability",
    sourceText: "住一晚",
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: 1,
      guestCountCandidate: null
    }
  }],
  catalog,
  now: NOW
});
assert.equal(nightsPriceContinuation.executionItems[0].requestCycleId, "pricing-task");
assert.equal(nightsPriceContinuation.executionItems[0].task.type, "price");

const answeredPricingTask = pendingPricingTask({
  checkIn: "2026-07-30",
  checkOut: "2026-07-31",
  knownFields: ["productType", "checkIn", "checkOut"],
  missingFields: [],
  status: "answered"
});
const answeredPricingState = createConversationStateV3({
  ...scope,
  tasks: [answeredPricingTask],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
const durationOnlyCandidate = {
  ...dateOnlyPlannerTask,
  taskId: "duration-only-candidate",
  type: "availability",
  sourceText: "duration follow-up",
  stayCandidate: {
    dateExpression: { rawText: "", kind: "none", anchor: "none" },
    checkInCandidate: null,
    checkOutCandidate: null,
    nightsCandidate: 1,
    guestCountCandidate: null
  }
};
const answeredPriceDurationContinuation = decideContextExecutionV3({
  state: answeredPricingState,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [durationOnlyCandidate],
  catalog,
  now: NOW
});
assert.equal(answeredPriceDurationContinuation.executionItems[0].requestCycleId, "pricing-task");
assert.equal(answeredPriceDurationContinuation.executionItems[0].task.type, "price");
assert.equal(answeredPriceDurationContinuation.executionItems[0].task.stayCandidate.nightsCandidate, 1);
assert.equal(answeredPriceDurationContinuation.contextDecision.reasonCode, "unique_pending_slot_update");

const ambiguousAnsweredPricingState = createConversationStateV3({
  ...scope,
  tasks: [answeredPricingTask, pendingPricingTask({
    taskId: "second-answered-pricing-task",
    checkIn: "2026-08-01",
    checkOut: "2026-08-02",
    knownFields: ["productType", "checkIn", "checkOut"],
    missingFields: [],
    status: "answered"
  })],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
const ambiguousAnsweredDuration = decideContextExecutionV3({
  state: ambiguousAnsweredPricingState,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [durationOnlyCandidate],
  catalog,
  now: NOW
});
assert.notEqual(ambiguousAnsweredDuration.executionItems[0].requestCycleId, "pricing-task");
assert.notEqual(ambiguousAnsweredDuration.executionItems[0].requestCycleId, "second-answered-pricing-task");

const answeredBundlePricingTasks = Array.from({ length: 7 }, (_, index) => {
  const minute = String(10 + index).padStart(2, "0");
  return pendingPricingTask({
    taskId: `answered-bundle-pricing-${index + 1}`,
    productType: "bundle",
    productId: "bundle-all",
    bundleId: "bundle-all",
    checkIn: index === 6 ? "2026-09-05" : "2026-08-29",
    checkOut: index === 6 ? "2026-09-06" : "2026-08-30",
    entityId: "bundle-all",
    entityCategory: "bundle",
    knownFields: ["productType", "productId", "bundleId", "checkIn", "checkOut"],
    missingFields: [],
    status: "answered",
    createdAt: `2026-07-30T06:${minute}:00.000Z`,
    updatedAt: `2026-07-30T06:${minute}:00.000Z`
  });
});
const repeatedBundlePriceState = createConversationStateV3({
  ...scope,
  tasks: answeredBundlePricingTasks,
  createdAt: answeredBundlePricingTasks[0].createdAt,
  updatedAt: answeredBundlePricingTasks.at(-1).updatedAt,
  expiresAt: FUTURE
});
const repeatedBundlePriceFollowup = decideContextExecutionV3({
  state: repeatedBundlePriceState,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "current-bundle-price",
    type: "price",
    sourceText: "bundle price follow-up",
    entity: {
      category: "bundle",
      rawText: "bundle",
      canonicalCandidate: "bundle-all",
      confidence: 0.99
    },
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    }
  }],
  catalog,
  now: NOW
});
assert.equal(
  repeatedBundlePriceFollowup.executionItems[0].requestCycleId,
  "answered-bundle-pricing-7",
  "an exact bundle price follow-up must continue the unique latest answered cycle"
);
assert.equal(repeatedBundlePriceFollowup.executionItems[0].task.type, "price");
assert.equal(repeatedBundlePriceFollowup.executionItems[0].transition.contextTask.checkIn, "2026-09-05");
assert.equal(repeatedBundlePriceFollowup.executionItems[0].transition.contextTask.checkOut, "2026-09-06");

const answeredAvailability = createConversationStateV3({
  ...scope,
  tasks: [pendingPricingTask({
    taskId: "availability-task",
    taskType: "availability",
    checkIn: "2026-07-30",
    checkOut: "2026-07-31",
    knownFields: ["productType", "checkIn", "checkOut"],
    missingFields: [],
    status: "answered"
  })],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
const modifiedGuestCount = decideContextExecutionV3({
  state: answeredAvailability,
  relations: [{
    candidateIndex: 0,
    relationKind: "modify_existing",
    stateAction: "replace",
    requestCycleId: "availability-task",
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "change-guests",
    type: "booking_request",
    sourceText: "改四個",
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: 4
    }
  }],
  catalog,
  now: NOW
});
assert.equal(modifiedGuestCount.executionItems[0].requestCycleId, "availability-task");
assert.equal(modifiedGuestCount.executionItems[0].task.type, "availability");
assert.equal(modifiedGuestCount.executionItems[0].task.stayCandidate.guestCountCandidate, 4);

const changedRoomScope = decideContextExecutionV3({
  state: answeredAvailability,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "availability-room-quad",
    type: "availability",
    sourceText: "那四人房呢？",
    entity: {
      category: "room",
      rawText: "四人房",
      canonicalCandidate: "room-quad",
      confidence: 0.99
    },
    stayCandidate: null
  }],
  catalog,
  now: NOW
});
assert.equal(changedRoomScope.executionItems[0].requestCycleId, "availability-task");
assert.equal(changedRoomScope.executionItems[0].task.type, "availability");
assert.deepEqual(changedRoomScope.executionItems[0].transition.approvedProduct, {
  productType: "room_type",
  productId: "room-quad",
  roomTypeId: "room-quad",
  bundleId: null
});

const ambiguousPendingState = createConversationStateV3({
  ...scope,
  tasks: [
    pendingPricingTask(),
    pendingPricingTask({ taskId: "second-pricing-task" })
  ],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
const ambiguousContinuation = decideContextExecutionV3({
  state: ambiguousPendingState,
  relations: [],
  plannerTasks: [dateOnlyPlannerTask],
  catalog,
  now: NOW
});
assert.equal(ambiguousContinuation.resumedPending, false);
assert.notEqual(ambiguousContinuation.executionItems[0].requestCycleId, "pricing-task");
assert.notEqual(ambiguousContinuation.executionItems[0].requestCycleId, "second-pricing-task");

const clarificationFocusedPricingState = createConversationStateV3({
  ...scope,
  tasks: [
    pendingPricingTask({
      taskId: "bundle-pricing-focus",
      productType: "bundle",
      productId: "bundle-all",
      bundleId: "bundle-all",
      entityId: "bundle-all",
      entityCategory: "bundle",
      knownFields: ["productType", "productId", "bundleId"],
      status: "needs_clarification"
    }),
    pendingPricingTask({ taskId: "dormant-pricing-cycle" }),
    pendingPricingTask({
      taskId: "dormant-capacity-cycle",
      taskType: "capacity",
      missingFields: ["checkIn", "checkOut", "guestCount"]
    }),
    pendingPricingTask({
      taskId: "answered-availability-cycle",
      taskType: "availability",
      checkIn: "2026-08-29",
      checkOut: "2026-08-30",
      knownFields: ["productType", "checkIn", "checkOut"],
      missingFields: [],
      status: "answered"
    })
  ],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
const focusedDateContinuation = decideContextExecutionV3({
  state: clarificationFocusedPricingState,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "availability-date-only",
    type: "availability",
    sourceText: "9/5",
    stayCandidate: {
      ...dateOnlyPlannerTask.stayCandidate,
      dateExpression: {
        rawText: "9/5",
        kind: "absolute",
        anchor: "message_time"
      },
      checkInCandidate: "2026-09-05"
    }
  }],
  catalog,
  now: NOW
});
assert.equal(focusedDateContinuation.executionItems[0].requestCycleId, "bundle-pricing-focus");
assert.equal(focusedDateContinuation.executionItems[0].task.type, "price");
assert.equal(focusedDateContinuation.executionItems[0].task.entity.category, "bundle");
assert.equal(focusedDateContinuation.executionItems[0].task.entity.canonicalCandidate, "bundle-all");
assert.equal(focusedDateContinuation.executionItems[0].task.stayCandidate.checkInCandidate, "2026-09-05");
assert.deepEqual(focusedDateContinuation.automaticPendingDiagnostic, {
  reasonCode: "continuation_selected",
  plannerTaskCount: 1,
  explicitRelationPresent: false,
  slotOnlyLodgingTurn: true,
  clarificationCandidateCount: 1,
  compatibleCandidateCount: 1,
  continuationSelected: true,
  slotPredicateDiagnostic: {
    hasDate: true,
    hasRangeOrCheckOut: false,
    hasStandaloneNights: false,
    hasGuests: false,
    hasProduct: false,
    hasOtherEntity: false,
    suppliedSlotKindCount: 1,
    entityRawTextPresent: false,
    sourceEqualsDateExpression: true,
    finalSlotOnlyResult: true
  }
});

const absoluteDateWithDerivedCheckout = decideContextExecutionV3({
  state: clarificationFocusedPricingState,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "availability-absolute-date-with-checkout",
    type: "availability",
    sourceText: "9/5",
    stayCandidate: {
      ...dateOnlyPlannerTask.stayCandidate,
      dateExpression: {
        rawText: "9/5",
        kind: "absolute",
        anchor: "message_time"
      },
      checkInCandidate: "2026-09-05",
      checkOutCandidate: "2026-09-06"
    }
  }],
  catalog,
  now: NOW
});
assert.equal(absoluteDateWithDerivedCheckout.executionItems[0].requestCycleId, "bundle-pricing-focus");
assert.equal(absoluteDateWithDerivedCheckout.executionItems[0].task.type, "price");
assert.equal(absoluteDateWithDerivedCheckout.executionItems[0].transition.reasonCode, "unique_pending_slot_update");
assert.equal(absoluteDateWithDerivedCheckout.automaticPendingDiagnostic.slotPredicateDiagnostic.hasRangeOrCheckOut, false);
assert.equal(absoluteDateWithDerivedCheckout.automaticPendingDiagnostic.slotPredicateDiagnostic.finalSlotOnlyResult, true);

const explicitDateRange = decideContextExecutionV3({
  state: clarificationFocusedPricingState,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "availability-explicit-date-range",
    type: "availability",
    sourceText: "9/5-9/6",
    stayCandidate: {
      ...dateOnlyPlannerTask.stayCandidate,
      dateExpression: {
        rawText: "9/5-9/6",
        kind: "range",
        anchor: "message_time"
      },
      checkInCandidate: "2026-09-05",
      checkOutCandidate: "2026-09-06"
    }
  }],
  catalog,
  now: NOW
});
assert.equal(explicitDateRange.executionItems[0].transition.reasonCode, "new_task");
assert.equal(explicitDateRange.automaticPendingDiagnostic.reasonCode, "not_slot_only_lodging_turn");
assert.equal(explicitDateRange.automaticPendingDiagnostic.slotPredicateDiagnostic.hasRangeOrCheckOut, true);
assert.equal(explicitDateRange.automaticPendingDiagnostic.slotPredicateDiagnostic.finalSlotOnlyResult, false);

const rawEntityDateOnlyDecision = decideContextExecutionV3({
  state: clarificationFocusedPricingState,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "availability-date-only-with-raw-entity",
    type: "availability",
    sourceText: "9/5",
    entity: {
      ...dateOnlyPlannerTask.entity,
      rawText: "9/5"
    },
    stayCandidate: {
      ...dateOnlyPlannerTask.stayCandidate,
      dateExpression: {
        rawText: "9/5",
        kind: "absolute",
        anchor: "message_time"
      },
      checkInCandidate: "2026-09-05"
    }
  }],
  catalog,
  now: NOW
});
assert.equal(rawEntityDateOnlyDecision.executionItems[0].transition.reasonCode, "new_task");
assert.equal(rawEntityDateOnlyDecision.contextDecision.action, "start");
assert.deepEqual(rawEntityDateOnlyDecision.automaticPendingDiagnostic, {
  reasonCode: "not_slot_only_lodging_turn",
  plannerTaskCount: 1,
  explicitRelationPresent: false,
  slotOnlyLodgingTurn: false,
  clarificationCandidateCount: 0,
  compatibleCandidateCount: 0,
  continuationSelected: false,
  slotPredicateDiagnostic: {
    hasDate: true,
    hasRangeOrCheckOut: false,
    hasStandaloneNights: false,
    hasGuests: false,
    hasProduct: false,
    hasOtherEntity: false,
    suppliedSlotKindCount: 1,
    entityRawTextPresent: true,
    sourceEqualsDateExpression: true,
    finalSlotOnlyResult: false
  }
});
const bundleFollowup = decideContextExecutionV3({
  state: answeredAvailability,
  relations: [{
    candidateIndex: 0,
    relationKind: "supplement_existing",
    stateAction: "continue",
    requestCycleId: "availability-task",
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "bundle-followup",
    type: "availability",
    sourceText: "bundle followup",
    entity: {
      category: "bundle",
      rawText: "bundle",
      canonicalCandidate: "alpha-whole-house",
      confidence: 0.99
    },
    stayCandidate: null
  }],
  now: NOW
});
assert.equal(bundleFollowup.executionItems[0].requestCycleId, "availability-task");
assert.equal(
  bundleFollowup.executionItems[0].task.entity.canonicalCandidate,
  null,
  "a continue relation must preserve the reducer-selected task topic instead of using the Planner candidate to transition products"
);
assert.deepEqual(
  bundleFollowup.executionItems[0].transition.approvedProduct,
  { productType: "any", productId: null, roomTypeId: null, bundleId: null },
  "a continue relation must keep the reducer-approved product"
);

const executionConditions = executionConditionsV3(previous, {
  requestCycleId: "pricing-task",
  stateInput: {
    confirmedFields: {
      guests: null,
      inventory: null
    }
  },
  canonicalRequest: {
    capability: "price",
    lodgingProduct: {
      productType: "any",
      productId: null,
      roomTypeId: null,
      bundleId: null
    },
    canonicalEntity: {
      status: "not_requested",
      category: "other",
      canonicalId: null
    },
    detailIntent: "general",
    temporalState: {
      resolutionStatus: "resolved",
      checkIn: "2026-07-30",
      checkOut: "2026-07-31",
      nights: 1,
      searchRange: null
    }
  }
});
assert.deepEqual(executionConditions.stay, {
  checkIn: "2026-07-30",
  checkOut: "2026-07-31",
  nights: 1,
  guests: null,
  searchRange: null
});
assert.equal(executionConditions.inventory.mode, "any");

const explicitNewQuestion = decideContextExecutionV3({
  state: previous,
  relations: [{
    candidateIndex: 0,
    relationKind: "new_request",
    stateAction: "start",
    requestCycleId: null,
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "parking",
    type: "amenity",
    sourceText: "有車位嗎",
    dependsOnStayContext: false,
    entity: {
      category: "amenity",
      rawText: "車位",
      canonicalCandidate: "parking",
      confidence: 0.99
    },
    stayCandidate: null
  }],
  now: NOW
});
assert.equal(explicitNewQuestion.resumedPending, false);
assert.equal(explicitNewQuestion.executionItems[0].task.type, "amenity");

const guestOnlyPlannerTask = {
  ...dateOnlyPlannerTask,
  taskId: "guest-only",
  type: "capacity",
  sourceText: "4 guests",
  stayCandidate: {
    dateExpression: {
      rawText: "",
      kind: "none",
      anchor: "none"
    },
    checkInCandidate: null,
    checkOutCandidate: null,
    nightsCandidate: null,
    guestCountCandidate: 4
  }
};
assert.equal(decideContextExecutionV3({
  state: previous,
  relations: [],
  plannerTasks: [guestOnlyPlannerTask],
  now: NOW
}).resumedPending, false, "guest count cannot satisfy a date-only pending task");

const pendingCapacity = createConversationStateV3({
  ...scope,
  tasks: [pendingPricingTask({
    taskId: "capacity-task",
    taskType: "capacity",
    checkIn: "2026-07-30",
    checkOut: "2026-07-31",
    knownFields: ["productType", "checkIn", "checkOut"],
    missingFields: ["guestCount"],
    status: "pending"
  })],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
const automaticGuestContinuation = decideContextExecutionV3({
  state: pendingCapacity,
  relations: [],
  plannerTasks: [guestOnlyPlannerTask],
  now: NOW
});
assert.equal(automaticGuestContinuation.resumedPending, true);
assert.equal(automaticGuestContinuation.executionItems[0].requestCycleId, "capacity-task");
assert.equal(decideContextExecutionV3({
  state: pendingCapacity,
  relations: [{ candidateIndex: guestOnlyPlannerTask.candidateIndex, stateAction: "continue", requestCycleId: "capacity-task", relationKind: "supplement_existing", evidenceRefs: [] }],
  plannerTasks: [guestOnlyPlannerTask],
  now: NOW
}).resumedPending, true, "an explicit structured continuation must remain the context authority");
assert.equal(decideContextExecutionV3({
  state: pendingCapacity,
  relations: [],
  plannerTasks: [guestOnlyPlannerTask, {
    ...dateOnlyPlannerTask,
    candidateIndex: 1,
    taskId: "early-arrival",
    type: "policy",
    dependsOnStayContext: false,
    entity: {
      category: "policy",
      rawText: "early arrival",
      canonicalCandidate: "check_in",
      confidence: 0.99
    },
    stayCandidate: null
  }],
  now: NOW
}).resumedPending, false, "a multi-task turn must not be absorbed into one pending cycle");

const expired = createConversationStateV3({
  ...scope,
  tasks: [pendingPricingTask({
    status: "expired",
    expiresAt: "2026-07-30T06:59:59.000Z"
  })],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: NOW
});
assert.equal(decideContextExecutionV3({
  state: expired,
  relations: [],
  plannerTasks: [dateOnlyPlannerTask],
  now: NOW
}).resumedPending, false);

const ended = decideContextExecutionV3({
  state: mixedPrevious,
  relations: [{
    candidateIndex: 0,
    relationKind: "end_existing",
    stateAction: "end",
    requestCycleId: "pricing-task",
    evidenceRefs: []
  }],
  plannerTasks: [{
    ...dateOnlyPlannerTask,
    taskId: "cancel-pricing",
    type: "unknown",
    sourceText: "cancel that",
    dependsOnStayContext: false,
    entity: {
      category: "other",
      rawText: "cancel that",
      canonicalCandidate: null,
      confidence: 0.99
    },
    stayCandidate: null
  }],
  now: NOW
});
assert.deepEqual(ended.endedTaskIds, ["pricing-task"]);
assert.equal(ended.executionItems.length, 0);
const afterEnd = reduceConversationStateV3({
  previous: mixedPrevious,
  endedTaskIds: ended.endedTaskIds,
  scope: {
    ...scope,
    eventId: "event-end",
    now: NOW
  }
});
assert.equal(
  afterEnd.tasks.find((task) => task.taskId === "pricing-task").status,
  "cancelled"
);
assert.equal(
  afterEnd.tasks.find((task) => task.taskId === "parking-task").status,
  "answered",
  "ending one task must preserve unrelated mixed-task state"
);

const reduced = reduceConversationStateV3({
  previous,
  canonicalItems: [{
    requestCycleId: "pricing-task",
    task: { taskId: "pricing-task" },
    canonicalRequest: {
      taskId: "pricing-task",
      capability: "price",
      lodgingProduct: {
        productType: "any",
        productId: null,
        roomTypeId: null,
        bundleId: null
      },
      canonicalEntity: {
        status: "not_requested",
        category: "other",
        canonicalId: null
      },
      detailIntent: "general"
    }
  }],
  formalRequests: [{
    taskId: "pricing-task",
    readiness: {
      status: "ready",
      knownFields: ["productType", "checkIn", "checkOut"],
      missingFields: [],
      invalidFields: [],
      conflictingFields: []
    },
    stay: {
      checkIn: "2026-07-30",
      checkOut: "2026-07-31",
      guests: null,
      searchRange: null
    }
  }],
  executionOutcomes: [{
    taskId: "pricing-task",
    outcome: "answered"
  }],
  scope: {
    ...scope,
    eventId: "event-date",
    now: NOW
  }
});
assert.equal(reduced.schemaVersion, 3);
assert.equal(reduced.revision, 1);
assert.equal(reduced.tasks[0].taskType, "pricing");
assert.equal(reduced.tasks[0].checkIn, "2026-07-30");
assert.equal(reduced.tasks[0].checkOut, "2026-07-31");
assert.equal(reduced.tasks[0].status, "answered");
assert.equal(Object.hasOwn(reduced, "pendingRequests"), false);
assert.equal(Object.hasOwn(reduced, "requestCycles"), false);

const clarificationReduction = reduceConversationStateV3({
  previous: clarificationFocusedPricingState,
  canonicalItems: [{
    requestCycleId: "current-clarification-cycle",
    task: { taskId: "current-clarification-task" },
    canonicalRequest: {
      taskId: "current-clarification-task",
      capability: "price",
      lodgingProduct: {
        productType: "bundle",
        productId: "bundle-all",
        roomTypeId: null,
        bundleId: "bundle-all"
      },
      canonicalEntity: {
        status: "resolved",
        category: "bundle",
        canonicalId: "bundle-all"
      },
      detailIntent: "general"
    }
  }],
  formalRequests: [{
    taskId: "current-clarification-task",
    readiness: {
      status: "missing_information",
      knownFields: ["productType", "productId", "bundleId"],
      missingFields: ["checkIn", "checkOut"],
      invalidFields: [],
      conflictingFields: []
    },
    stay: {
      checkIn: null,
      checkOut: null,
      guests: null,
      searchRange: null
    }
  }],
  executionOutcomes: [{
    taskId: "current-clarification-task",
    outcome: "not_ready",
    readinessStatus: "missing_information",
    missingFields: ["checkIn", "checkOut"]
  }],
  clarificationTaskIds: ["current-clarification-task"],
  scope: {
    ...scope,
    eventId: "event-current-clarification",
    now: NOW
  }
});
assert.equal(
  clarificationReduction.tasks.find((task) => task.taskId === "bundle-pricing-focus").status,
  "pending",
  "the prior clarification focus must become dormant on the next valid reduction"
);
assert.equal(
  clarificationReduction.tasks.find((task) => task.taskId === "current-clarification-cycle").status,
  "needs_clarification",
  "only a FinalDecision-selected not-ready task may become clarification focus"
);

const handoffReduction = reduceConversationStateV3({
  previous: clarificationFocusedPricingState,
  canonicalItems: clarificationReduction.tasks
    .filter((task) => task.taskId === "current-clarification-cycle")
    .map(() => ({
      requestCycleId: "handoff-cycle",
      task: { taskId: "handoff-task" },
      canonicalRequest: {
        taskId: "handoff-task",
        capability: "price",
        lodgingProduct: {
          productType: "bundle",
          productId: "bundle-all",
          roomTypeId: null,
          bundleId: "bundle-all"
        },
        canonicalEntity: {
          status: "resolved",
          category: "bundle",
          canonicalId: "bundle-all"
        },
        detailIntent: "general"
      }
    })),
  formalRequests: [{
    taskId: "handoff-task",
    readiness: {
      status: "missing_information",
      knownFields: ["productType", "productId", "bundleId"],
      missingFields: ["checkIn", "checkOut"],
      invalidFields: [],
      conflictingFields: []
    },
    stay: { checkIn: null, checkOut: null, guests: null, searchRange: null }
  }],
  executionOutcomes: [{
    taskId: "handoff-task",
    outcome: "not_ready",
    readinessStatus: "missing_information",
    missingFields: ["checkIn", "checkOut"]
  }],
  clarificationTaskIds: [],
  scope: { ...scope, eventId: "event-handoff", now: NOW }
});
assert.equal(
  handoffReduction.tasks.find((task) => task.taskId === "handoff-cycle").status,
  "pending",
  "a not-ready task not selected by a clarification FinalDecision must remain dormant"
);

const answeredBundleContextTask = pendingPricingTask({
  taskId: "answered-bundle-context",
  productType: "bundle",
  productId: "bundle-all",
  bundleId: "bundle-all",
  checkIn: "2026-09-25",
  checkOut: "2026-09-26",
  entityId: "bundle-all",
  entityCategory: "bundle",
  knownFields: ["productType", "productId", "bundleId", "checkIn", "checkOut"],
  missingFields: [],
  status: "answered"
});
const answeredBundleContextState = createConversationStateV3({
  ...scope,
  tasks: [answeredBundleContextTask],
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: FUTURE
});
const answeredBundleContextSnapshot = buildContextSnapshotV3(answeredBundleContextState, {
  propertyId: scope.propertyId,
  channelId: scope.channel,
  lineUserId: scope.userId,
  now: NOW
});

function contextualNewRequestReadiness({ message, capability, taskId, historyTurn, productHistoryTurn = historyTurn }) {
  const task = {
    candidateIndex: 0,
    taskId,
    type: capability,
    sourceText: message,
    detailIntent: "general",
    requestedOutputs: [capability === "price" ? "price" : "availability"],
    eligibilityEvidence: { kind: "none", sourceText: "" },
    dependsOnStayContext: true,
    entity: {
      category: "other",
      rawText: "",
      canonicalCandidate: null,
      confidence: 0.99
    },
    stayCandidate: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    },
    confidence: 0.99
  };
  const plannerOutput = {
    tasks: [task],
    contextRelationCandidates: [{
      candidateIndex: 0,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      fieldProvenance: fieldProvenanceFromHistory("answered-bundle-context", historyTurn, productHistoryTurn),
      evidenceRefs: [{
        eventId: taskId,
        messageRef: "",
        startOffset: 0,
        endOffset: message.length,
        quote: message
      }]
    }]
  };
  const contextValidation = validateUnderstandingContext(
    plannerOutput,
    answeredBundleContextSnapshot,
    {
      sourceEvents: [{ eventId: taskId, messageText: message }],
      scope: {
        propertyId: scope.propertyId,
        channelId: scope.channel,
        lineUserId: scope.userId
      }
    }
  );
  assert.equal(contextValidation.ok, true);
  const contextExecution = decideContextExecutionV3({
    state: answeredBundleContextState,
    relations: contextValidation.relations,
    plannerTasks: [task],
    catalog,
    now: NOW
  });
  const item = canonicalizeExecutionItem({
    item: contextExecution.executionItems[0],
    relation: contextExecution.relations[0],
    contextSnapshot: answeredBundleContextSnapshot,
    catalog,
    guestMessage: message,
    eventTimestamp: Date.parse(NOW)
  });
  const formal = buildCanonicalFormalRequest({
    property: { propertyId: scope.propertyId },
    canonicalRequest: item.canonicalRequest,
    candidateIndex: item.candidateIndex,
    requestCycleId: item.requestCycleId,
    confirmedInputs: executionConditionsV3(answeredBundleContextState, item)
  });
  return { contextExecution, item, formal };
}

const contextCaseA = contextualNewRequestReadiness({
  message: "費用多少",
  capability: "price",
  taskId: "context-a-current",
  historyTurn: 2,
  productHistoryTurn: 1
});
const contextCaseB = contextualNewRequestReadiness({
  message: "還能預訂嗎？",
  capability: "availability",
  taskId: "context-b-current",
  historyTurn: 1
});
assert.deepEqual([
  {
    capability: contextCaseA.item.canonicalRequest.capability,
    bundleId: contextCaseA.item.canonicalRequest.lodgingProduct.bundleId,
    checkIn: contextCaseA.formal.stay.checkIn,
    readiness: contextCaseA.formal.readiness.status
  },
  {
    capability: contextCaseB.item.canonicalRequest.capability,
    bundleId: contextCaseB.item.canonicalRequest.lodgingProduct.bundleId,
    checkIn: contextCaseB.formal.stay.checkIn,
    readiness: contextCaseB.formal.readiness.status
  }
], [
  { capability: "price", bundleId: "bundle-all", checkIn: "2026-09-25", readiness: "ready" },
  { capability: "availability", bundleId: "bundle-all", checkIn: "2026-09-25", readiness: "ready" }
], "A/B must retain their current capability while using only validated historical date and bundle fields despite raw new_request relations");

console.log(JSON.stringify({
  suite: "conversation-state-v3-runtime-reducer",
  caseCount: 31,
  passCount: 31,
  failCount: 0
}));
