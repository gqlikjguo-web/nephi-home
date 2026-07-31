"use strict";

const providerFixture = require(
  "./fixtures/conversation-contract-postgres-properties.json"
);
const {
  ConversationEngineV2
} = require("../lib/conversation-engine-v2/engine");

const EVENT_TIMESTAMP = Date.parse("2026-07-30T15:00:00+08:00");
const NOW = () => new Date("2026-07-30T07:00:00.000Z");
const property = providerFixture.properties.find(
  (candidate) => candidate.propertyId === "property_alpha"
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stay({
  rawText = "",
  kind = "none",
  checkInCandidate = null,
  checkOutCandidate = null,
  nightsCandidate = null,
  guestCountCandidate = null
} = {}) {
  return {
    dateExpression: {
      rawText,
      kind,
      anchor: rawText ? "message_time" : "none"
    },
    checkInCandidate,
    checkOutCandidate,
    nightsCandidate,
    guestCountCandidate
  };
}

function task({
  taskId,
  type,
  sourceText,
  category = "other",
  rawText = "",
  canonicalCandidate = null,
  requestedOutputs = ["answer"],
  dependsOnStayContext = false
}) {
  return {
    candidateIndex: 0,
    taskId,
    type,
    sourceText,
    detailIntent: "general",
    requestedOutputs,
    eligibilityEvidence: {
      kind: "none",
      sourceText: ""
    },
    dependsOnStayContext,
    entity: {
      category,
      rawText,
      canonicalCandidate,
      confidence: 0.99
    },
    confidence: 0.99
  };
}

function plan({
  message,
  taskValue,
  stayValue = stay(),
  relation = "new_request",
  missingInformation = []
}) {
  return {
    schemaVersion: 2,
    discourse: {
      relation,
      confidence: 0.99
    },
    stateOperations: [],
    stay: stayValue,
    tasks: [taskValue],
    contextRelationCandidates: [{
      candidateIndex: 0,
      kind: relation,
      candidateRequestCycleRefs: [],
      evidenceRefs: [{
        eventId: "",
        messageRef: "",
        startOffset: 0,
        endOffset: message.length,
        quote: message
      }]
    }],
    ambiguities: [],
    missingInformation,
    needsHuman: false,
    shouldIgnore: false,
    reason: "phase1_runtime_gap_fixture"
  };
}

function withEventEvidence(output, sourceEvents) {
  const source = sourceEvents[0];
  return {
    ...clone(output),
    contextRelationCandidates: output.contextRelationCandidates.map(
      (relation) => ({
        ...relation,
        evidenceRefs: relation.evidenceRefs.map((evidence) => ({
          ...evidence,
          eventId: source.eventId,
          endOffset: source.messageText.length,
          quote: source.messageText
        }))
      })
    )
  };
}

function harness(plans) {
  const queue = plans.map(clone);
  const states = new Map();
  const diagnostics = [];
  const resolverCalls = [];
  const stateWrites = [];
  const key = (propertyId, channelId, userId) =>
    `${propertyId}:${channelId}:${userId}`;
  const engine = new ConversationEngineV2({
    planner: {
      classify: async ({ sourceEvents }) =>
        withEventEvidence(queue.shift(), sourceEvents)
    },
    composer: null,
    persistence: {
      getConversationState: (propertyId, channelId, userId) =>
        clone(states.get(key(propertyId, channelId, userId)) || null),
      setConversationState: (propertyId, channelId, userId, value) =>
        {
          const stored = clone(value);
          stateWrites.push({
            propertyId,
            channelId,
            userId,
            state: stored
          });
          states.set(key(propertyId, channelId, userId), stored);
        },
      appendMessageLog: (_propertyId, value) => ({
        ...value,
        reviewId: value.needsReview ? `review-${value.eventId}` : ""
      }),
      updateMessageEvent: () => ({})
    },
    getProperty: (propertyId) =>
      propertyId === property.propertyId ? clone(property) : null,
    availabilityResolver: (query) => {
      resolverCalls.push(clone(query));
      return {
        ...query,
        availabilityReliable: true,
        rooms: clone(property.rooms),
        lineUrl: ""
      };
    },
    availableDatesResolver: (query) => {
      resolverCalls.push(clone(query));
      return {
        status: "answered",
        source: "availability_resolver",
        dates: []
      };
    },
    listPriceOverrides: () => [],
    now: NOW,
    diagnosticDetail: true,
    onDiagnostic: (entry) => diagnostics.push(clone(entry))
  });
  return {
    engine,
    diagnostics,
    resolverCalls,
    stateWrites,
    state: (channelId, userId) =>
      clone(states.get(key(property.propertyId, channelId, userId)) || null)
  };
}

function input(channelId, userId, eventId, messageText) {
  return {
    customerId: property.propertyId,
    channelId,
    lineUserId: userId,
    eventId,
    eventTimestamp: EVENT_TIMESTAMP,
    messageText
  };
}

function traceSummary(diagnostics, traceId) {
  const entries = diagnostics.filter((entry) => entry.traceId === traceId);
  const stages = entries.map((entry) => entry.stage);
  const context = entries.find(
    (entry) => entry.stage === "context_validation"
  );
  const pending = entries.filter(
    (entry) => entry.stage === "pending_request"
  );
  const canonical = entries.find(
    (entry) => entry.stage === "canonical_request"
  );
  const executor = entries.find(
    (entry) => entry.stage === "executor"
  );
  const finalDecision = entries.find(
    (entry) => entry.stage === "final_decision"
  );
  const requiredPipelineStages = [
    "planner",
    "context_validation",
    "pending_request",
    "canonical_request",
    "temporal",
    "state",
    "formal_request",
    "query_plan",
    "executor",
    "claim_validator",
    "final_decision"
  ];
  return {
    stages,
    pipelineCoverage: Object.fromEntries(
      requiredPipelineStages.map((stage) => [
        stage,
        stages.includes(stage)
      ])
    ),
    completePipelineObserved: requiredPipelineStages.every(
      (stage) => stages.includes(stage)
    ),
    contextRelations: (context && context.acceptedRelations || []).map(
      (relation) => ({
        candidateIndex: relation.candidateIndex,
        relationKind: relation.relationKind || relation.kind,
        stateAction: relation.stateAction,
        requestCycleIdPresent: Boolean(relation.requestCycleId)
      })
    ),
    pending: pending.filter((entry) => (
      entry.action || entry.reasonCode || entry.capability
        || Array.isArray(entry.missingFields)
    )).map((entry) => ({
      action: entry.action,
      reasonCode: entry.reasonCode,
      capability: entry.capability,
      missingFields: entry.missingFields
    })),
    canonical: (canonical && canonical.items || []).map((item) => ({
      taskId: item.taskId,
      capability: item.capability,
      lodgingProduct: item.lodgingProduct || null,
      entityStatus: item.canonicalEntity.status,
      entityCategory: item.canonicalEntity.category,
      entityId: item.canonicalEntity.canonicalId,
      resolverId: item.resolverId,
      requiredFields: item.requiredFields
    })),
    executor: (executor && executor.results || []).map((result) => ({
      taskId: result.taskId,
      status: result.status,
      reason: result.reason
    })),
    finalDecision: finalDecision
      ? {
        action: finalDecision.decision,
        reasonCode: finalDecision.reasonCode
      }
      : null
  };
}

async function pricingFollowupGap() {
  const firstMessage = "請問一晚費用多少呢";
  const secondMessage = "7/30";
  const runtime = harness([
    plan({
      message: firstMessage,
      taskValue: task({
        taskId: "pricing",
        type: "price",
        sourceText: firstMessage,
        requestedOutputs: ["price"],
        dependsOnStayContext: true
      }),
      missingInformation: ["stay.checkIn"]
    }),
    plan({
      message: secondMessage,
      taskValue: task({
        taskId: "date-only",
        type: "available_dates",
        sourceText: secondMessage,
        requestedOutputs: ["availability"],
        dependsOnStayContext: true
      }),
      stayValue: stay({
        rawText: secondMessage,
        kind: "absolute",
        checkInCandidate: "2026-07-30",
        nightsCandidate: 1
      })
    })
  ]);

  const first = await runtime.engine.process(
    input("line:pricing-gap", "Upricing-gap", "evt-pricing-gap-1", firstMessage)
  );
  const second = await runtime.engine.process(
    input("line:pricing-gap", "Upricing-gap", "evt-pricing-gap-2", secondMessage)
  );
  const pricingAnswered = second.taskResults.some(
    (result) => ["price", "total_price"].includes(result.type)
      && result.status === "answered"
  );
  const state = runtime.state("line:pricing-gap", "Upricing-gap");
  const pendingCapabilities = (state && state.pendingRequests || [])
    .map((pending) => pending.capability);
  const trace = traceSummary(runtime.diagnostics, second.traceId);
  const persisted = runtime.state("line:pricing-gap", "Upricing-gap");
  const v3IsSoleAuthority = Boolean(
    persisted
    && persisted.schemaVersion === 3
    && Array.isArray(persisted.tasks)
    && !Object.hasOwn(persisted, "pendingRequests")
    && !Object.hasOwn(persisted, "requestCycles")
  );
  const gapReproduced = !pricingAnswered
    && trace.completePipelineObserved
    && pendingCapabilities.includes("price")
    && trace.contextRelations.some((relation) => (
      relation.relationKind === "new_request"
      && relation.stateAction === "start"
    ))
    && trace.pending.some((entry) => (
      entry.action === "unchanged"
      && entry.reasonCode === "start"
    ))
    && trace.canonical.some((item) => (
      item.taskId === "date-only"
      && item.capability === "availability"
    ));
  return {
    caseId: "incident_pricing_then_date",
    desired: {
      originalTask: "pricing",
      suppliedSlot: "checkIn/checkOut",
      outcome: "answered"
    },
    actual: {
      firstTaskStatuses: first.taskResults.map((result) => ({
        type: result.type,
        status: result.status,
        missingInputs: result.missingInputs || []
      })),
      secondTaskStatuses: second.taskResults.map((result) => ({
        type: result.type,
        status: result.status,
        reason: result.reason || ""
      })),
      originalPricingAnswered: pricingAnswered,
      pendingCapabilities,
      persistedSchemaVersion: persisted && persisted.schemaVersion,
      v3IsSoleAuthority,
      stateWriteCount: runtime.stateWrites.length,
      finalDecision: second.finalDecision,
      replyText: second.replyText
    },
    gapReproduced,
    failureStage: pricingAnswered
      ? null
      : gapReproduced
        ? "context_relation_to_reducer"
        : "unexpected_runtime_or_fixture_shape",
    trace,
    passed: pricingAnswered
      && v3IsSoleAuthority
      && runtime.stateWrites.length === 2
  };
}

async function explicitBundleGap() {
  const message = "7/30可以包棟嗎";
  const runtime = harness([
    plan({
      message,
      taskValue: task({
        taskId: "bundle-availability",
        type: "availability",
        sourceText: message,
        category: "bundle",
        rawText: "包棟",
        canonicalCandidate: "alpha-whole-house",
        requestedOutputs: ["availability"],
        dependsOnStayContext: true
      }),
      stayValue: stay({
        rawText: "7/30",
        kind: "absolute",
        checkInCandidate: "2026-07-30",
        nightsCandidate: 1
      })
    })
  ]);
  const result = await runtime.engine.process(
    input(
      "line:bundle-gap",
      "Ubundle-gap",
      "evt-bundle-gap",
      message
    )
  );
  const summary = traceSummary(runtime.diagnostics, result.traceId);
  const canonical = summary.canonical[0] || {};
  const answered = result.taskResults.some(
    (taskResult) => taskResult.status === "answered"
  );
  const providerRequest = runtime.resolverCalls[0] || {};
  const consistent = canonical.capability === "bundle_availability"
    && canonical.lodgingProduct
    && canonical.lodgingProduct.productType === "bundle"
    && canonical.lodgingProduct.productId === "alpha-whole-house"
    && canonical.entityCategory === "bundle"
    && canonical.entityId === "alpha-whole-house"
    && canonical.resolverId === "availability_resolver"
    && providerRequest.customerId === "property_alpha"
    && providerRequest.roomType === "alpha-whole-house"
    && providerRequest.queryMode === "bundle_only"
    && !Object.hasOwn(providerRequest, "sourceText");
  const gapReproduced = !answered
    && summary.completePipelineObserved
    && canonical.capability === "unknown"
    && canonical.entityStatus === "resolved"
    && canonical.entityCategory === "bundle"
    && canonical.entityId === "alpha-whole-house"
    && canonical.resolverId === "human_handoff"
    && result.finalDecision.action === "handoff"
    && result.finalDecision.reasonCode === "unknown";
  return {
    caseId: "incident_explicit_date_bundle",
    desired: {
      taskType: "availability",
      productType: "bundle",
      productId: "alpha-whole-house",
      resolverId: "availability_resolver",
      outcome: "answered"
    },
    actual: {
      canonical,
      providerRequest,
      taskStatuses: result.taskResults.map((taskResult) => ({
        type: taskResult.type,
        status: taskResult.status,
        reason: taskResult.reason || ""
      })),
      answered,
      finalDecision: result.finalDecision,
      replyText: result.replyText
    },
    gapReproduced,
    failureStage: answered && consistent
      ? null
      : gapReproduced
        ? "canonicalizer_capability_selection"
        : "unexpected_runtime_or_fixture_shape",
    trace: summary,
    passed: answered && consistent
  };
}

async function availabilityThenDate() {
  const firstMessage = "availability";
  const secondMessage = "8/2";
  const runtime = harness([
    plan({
      message: firstMessage,
      taskValue: task({
        taskId: "availability",
        type: "availability",
        sourceText: firstMessage,
        requestedOutputs: ["availability"],
        dependsOnStayContext: true
      }),
      missingInformation: ["stay.checkIn"]
    }),
    plan({
      message: secondMessage,
      taskValue: task({
        taskId: "date-slot",
        type: "available_dates",
        sourceText: secondMessage,
        requestedOutputs: ["availability"],
        dependsOnStayContext: true
      }),
      stayValue: stay({
        rawText: secondMessage,
        kind: "absolute",
        checkInCandidate: "2026-08-02",
        nightsCandidate: 1
      })
    })
  ]);
  const first = await runtime.engine.process(input(
    "line:availability-followup",
    "Uavailability-followup",
    "evt-availability-followup-1",
    firstMessage
  ));
  const second = await runtime.engine.process(input(
    "line:availability-followup",
    "Uavailability-followup",
    "evt-availability-followup-2",
    secondMessage
  ));
  const providerRequest = runtime.resolverCalls[0] || {};
  return {
    caseId: "availability_then_date",
    actual: {
      firstStatus: first.taskResults[0].status,
      secondStatus: second.taskResults[0].status,
      secondType: second.taskResults[0].type,
      providerRequest
    },
    passed: first.taskResults[0].status === "needs_clarification"
      && second.taskResults[0].status === "answered"
      && second.taskResults[0].type === "availability"
      && providerRequest.checkIn === "2026-08-02"
      && providerRequest.checkOut === "2026-08-03"
  };
}

async function bundleThenDate() {
  const firstMessage = "bundle availability";
  const secondMessage = "8/3";
  const runtime = harness([
    plan({
      message: firstMessage,
      taskValue: task({
        taskId: "bundle-availability",
        type: "availability",
        sourceText: firstMessage,
        category: "bundle",
        rawText: "Alpha Whole House",
        canonicalCandidate: "alpha-whole-house",
        requestedOutputs: ["availability"],
        dependsOnStayContext: true
      }),
      missingInformation: ["stay.checkIn"]
    }),
    plan({
      message: secondMessage,
      taskValue: task({
        taskId: "date-slot",
        type: "available_dates",
        sourceText: secondMessage,
        requestedOutputs: ["availability"],
        dependsOnStayContext: true
      }),
      stayValue: stay({
        rawText: secondMessage,
        kind: "absolute",
        checkInCandidate: "2026-08-03",
        nightsCandidate: 1
      })
    })
  ]);
  const first = await runtime.engine.process(input(
    "line:bundle-followup",
    "Ubundle-followup",
    "evt-bundle-followup-1",
    firstMessage
  ));
  const second = await runtime.engine.process(input(
    "line:bundle-followup",
    "Ubundle-followup",
    "evt-bundle-followup-2",
    secondMessage
  ));
  const providerRequest = runtime.resolverCalls[0] || {};
  const canonical = traceSummary(
    runtime.diagnostics,
    second.traceId
  ).canonical[0] || {};
  return {
    caseId: "bundle_then_date",
    actual: {
      firstStatus: first.taskResults[0] && first.taskResults[0].status,
      stateAfterFirst: first.state,
      firstCanonical: traceSummary(
        runtime.diagnostics,
        first.traceId
      ).canonical[0],
      canonical,
      providerRequest
    },
    passed: second.taskResults[0].status === "answered"
      && canonical.capability === "bundle_availability"
      && canonical.lodgingProduct.productType === "bundle"
      && providerRequest.roomType === "alpha-whole-house"
      && providerRequest.queryMode === "bundle_only"
  };
}

async function capacityThenGuestCount() {
  const firstMessage = "capacity on 8/4";
  const secondMessage = "4 guests";
  const runtime = harness([
    plan({
      message: firstMessage,
      taskValue: task({
        taskId: "capacity",
        type: "capacity",
        sourceText: firstMessage,
        category: "room",
        rawText: "family",
        canonicalCandidate: "alpha-family",
        requestedOutputs: ["capacity"],
        dependsOnStayContext: true
      }),
      stayValue: stay({
        rawText: "8/4",
        kind: "absolute",
        checkInCandidate: "2026-08-04",
        nightsCandidate: 1
      }),
      missingInformation: ["stay.guests"]
    }),
    plan({
      message: secondMessage,
      taskValue: task({
        taskId: "guest-slot",
        type: "capacity",
        sourceText: secondMessage,
        requestedOutputs: ["capacity"],
        dependsOnStayContext: true
      }),
      stayValue: stay({ guestCountCandidate: 4 })
    })
  ]);
  const first = await runtime.engine.process(input(
    "line:capacity-followup",
    "Ucapacity-followup",
    "evt-capacity-followup-1",
    firstMessage
  ));
  const second = await runtime.engine.process(input(
    "line:capacity-followup",
    "Ucapacity-followup",
    "evt-capacity-followup-2",
    secondMessage
  ));
  const providerRequest = runtime.resolverCalls[0] || {};
  return {
    caseId: "capacity_then_guest_count",
    actual: {
      firstMissing: first.taskResults[0].missingInputs,
      secondStatus: second.taskResults[0].status,
      providerRequest
    },
    passed: first.taskResults[0].status === "needs_clarification"
      && first.taskResults[0].missingInputs.includes("guestCount")
      && second.taskResults[0].status === "answered"
      && providerRequest.guests === 4
      && providerRequest.roomType === "alpha-family"
      && providerRequest.checkIn === "2026-08-04"
  };
}

(async () => {
  const cases = [
    await pricingFollowupGap(),
    await explicitBundleGap(),
    await availabilityThenDate(),
    await bundleThenDate(),
    await capacityThenGuestCount()
  ];
  const report = {
    suite: "conversation-contract-runtime-green",
    expectedStatus: "GREEN",
    caseCount: cases.length,
    passCount: cases.filter((item) => item.passed).length,
    failCount: cases.filter((item) => !item.passed).length,
    cases
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.failCount > 0) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
